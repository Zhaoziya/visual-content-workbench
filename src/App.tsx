import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ChangeEvent } from 'react';
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { EditorView } from '@codemirror/view';
import { getStorageMode, requestWorkingDirectoryPermission, saveDocument, selectWorkingDirectory, supportsWorkingDirectory, workingDirectoryAccess, type DraftRecord, type WorkingDirectory } from './drafts';
import { toBlob } from 'html-to-image';
import JSZip from 'jszip';
import TurndownService from 'turndown';
import { Image as ImageIcon, Download, Save, Settings2, Palette, Upload, ChevronDown, Check, CheckCircle2, FileText, Heading1, Heading2, Heading3, Eye, Bold, Italic, Highlighter, List, ListOrdered, Quote, Code2, Scissors, Minus, Plus, Scan, X, RotateCcw, LoaderCircle, AlertCircle, FolderOpen, Trees } from 'lucide-react';
import { colorRoles, initialDraft, templateLibrary, forPage, colorWithOpacity, pageHeader, type Colors, type Draft, type PageSettings } from './model';
import { makeThemePalette } from './palette';
import ColorEditor from './ColorEditor';
import ThemeSwatch from './ThemeSwatch';
import { parseMarkdown, compactImageReferences, normalizePromptSyntax } from './markdown';
import { paginate, waitForImages, type PaginationResult } from './pagination';
import NotePage, { noteStyle } from './NotePage';
import RichEditor, { type RichEditorHandle } from './RichEditor';

const extensions=[markdown(),EditorView.lineWrapping];
const markdownPaste = new TurndownService({headingStyle:'atx',codeBlockStyle:'fenced',bulletListMarker:'-'});
const emptyPage={blocks:[],gap:24};
function fileData(file:File):Promise<string>{return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result));r.onerror=()=>reject(Error('文件读取失败'));r.readAsDataURL(file);});}
function download(blob:Blob,name:string){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
export function migrateDraft(value:Draft):Draft{
  const {schemes:_schemes,paletteVersion:_version,...draft}=value as Draft&{schemes?:unknown;paletteVersion?:unknown};
  const pageSettings=Object.fromEntries(Object.entries(draft.pageSettings??{}).map(([key,settings])=>{const {pageNumbers:_pageNumbers,...layout}=settings as PageSettings&{pageNumbers?:boolean};return [key,{...layout,header:draft.pageNumbers===undefined?settings.header?.replace(/^\d+\s*\/\s*/,''):settings.header}];}));
  const header=draft.pageNumbers===undefined?draft.header?.replace(/^\d+\s*\/\s*/,''):draft.header;
  return {...draft,header,pageNumbers:draft.pageNumbers??true,pageSettings,templateId:templateLibrary.some(t=>t.id===draft.templateId)?draft.templateId:templateLibrary[0].id};
}
export function validDraft(value:unknown):value is Draft{
  if(!value||typeof value!=='object')return false;const d=value as Draft;
  return d.version===1&&typeof d.title==='string'&&typeof d.subtitle==='string'&&typeof d.body==='string'&&typeof d.footer==='string'
    &&!!d.background&&typeof d.background.paper==='string'&&(!d.background.image||typeof d.background.image==='string')
    &&colorRoles.every(({key})=>/^#[0-9a-f]{6}$/i.test(d.colors?.[key]))&&!!d.assets&&typeof d.assets==='object'
    &&(!d.colorOpacity||(typeof d.colorOpacity==='object'&&Object.entries(d.colorOpacity).every(([key,value])=>colorRoles.some(role=>role.key===key)&&Number.isFinite(value)&&value>=0&&value<=100)))
    &&Object.values(d.assets).every(v=>typeof v==='string')&&Number.isFinite(d.fontSize)&&d.fontSize>=28&&d.fontSize<=52
    &&Number.isFinite(d.spacing)&&d.spacing>=24&&d.spacing<=80&&Number.isFinite(d.overlay)&&d.overlay>=0&&d.overlay<=90
    &&(d.lineHeight===undefined||(Number.isFinite(d.lineHeight)&&d.lineHeight>=1.2&&d.lineHeight<=2.4))
    &&(d.header===undefined||typeof d.header==='string')&&(d.pageNumbers===undefined||typeof d.pageNumbers==='boolean')
    &&[d.footerLine,d.headerEnabled,d.footerEnabled].every(value=>value===undefined||typeof value==='boolean')
    &&(d.imageRadius===undefined||(Number.isFinite(d.imageRadius)&&d.imageRadius>=0&&d.imageRadius<=64))
    &&(!d.pageSettings||(typeof d.pageSettings==='object'&&Object.values(d.pageSettings).every(p=>p&&(p.header===undefined||typeof p.header==='string')&&(p.footer===undefined||typeof p.footer==='string')&&(p.imageRadius===undefined||(Number.isFinite(p.imageRadius)&&p.imageRadius>=0&&p.imageRadius<=64))&&(p.lineHeight===undefined||(Number.isFinite(p.lineHeight)&&p.lineHeight>=1.2&&p.lineHeight<=2.4))&&p.fontSize>=28&&p.fontSize<=52&&p.spacing>=24&&p.spacing<=80&&p.overlay>=0&&p.overlay<=90)));
}
function IconButton({label,onClick,children,disabled=false}:{label:string;onClick:()=>void;children:React.ReactNode;disabled?:boolean}){
  return <button type="button" className="icon-button" title={label} data-tooltip={label} aria-label={label} onClick={onClick} disabled={disabled}>{children}</button>;
}

export default function App({record,onHome}:{record:DraftRecord;onHome:()=>void}){
  const [draft,setDraft]=useState<Draft>(()=>migrateDraft(record.draft));const hydrated=true;
  const [saveState,setSaveState]=useState('已保存');const [panel,setPanel]=useState<'background'|null>(null);
  const [directoryAction,setDirectoryAction]=useState<'save'|'home'|null>(null);
  const [directoryError,setDirectoryError]=useState('');
  const [directoryBusy,setDirectoryBusy]=useState(false);
  const [directoryNeedsAttention,setDirectoryNeedsAttention]=useState(false);
  const [permissionIssue,setPermissionIssue]=useState(false);
  const savedDraft=useRef(draft);
  const latestDraft=useRef(draft);
  latestDraft.current=draft;
  const directoryDialog=useRef<HTMLDialogElement>(null);
  const directoryHandle=useRef<WorkingDirectory|null>(null);
  const [editingColor,setEditingColor]=useState<{key:keyof Colors;label:string;anchor:HTMLButtonElement}|null>(null);
  const closeColor=useCallback(()=>setEditingColor(null),[]);
  const [selectedPage,setSelectedPage]=useState(0);const [pageSettingsOpen,setPageSettingsOpen]=useState(false);
  const [mobileTab,setMobileTab]=useState<'editor'|'preview'>('editor');const [zoom,setZoom]=useState<number|null>(null);
  const [previewWidth,setPreviewWidth]=useState(700);const [message,setMessage]=useState('');
  const [paletteBusy,setPaletteBusy]=useState(false);const [exportProgress,setExportProgress]=useState('');
  const [layout,setLayout]=useState<PaginationResult>({pages:[emptyPage],errors:[]});const [pending,setPending]=useState(true);
  const [bodyMode,setBodyMode]=useState<'source'|'rendered'>('source');
  const [previewMode,setPreviewMode]=useState<'pages'|'long'>('pages');
  const [longHeight,setLongHeight]=useState(1660);
  const [longErrors,setLongErrors]=useState<string[]>([]);
  const longExport=useRef<HTMLDivElement>(null);
  const longContent=useMemo(()=>({blocks:parseMarkdown(draft.body,draft.assets).filter(block=>!block.breakBefore).map(block=>block.html),gap:forPage(draft,0).spacing}),[draft.body,draft.assets,draft.spacing,draft.pageSettings]);
  useEffect(()=>{
    const node=longExport.current?.querySelector<HTMLElement>('.note-sheet');if(!node)return;
    let active=true;const observer=new ResizeObserver(()=>setLongHeight(Math.ceil(node.getBoundingClientRect().height)));observer.observe(node);
    waitForImages(node).then(errors=>{if(active)setLongErrors([...new Set(errors.filter(Boolean))]);});
    return()=>{active=false;observer.disconnect();};
  },[longContent]);
  const [layoutRequest,setLayoutRequest]=useState(0);
  const immediateLayout=useRef(false);
  const richEditor=useRef<RichEditorHandle>(null);
  const editor=useRef<ReactCodeMirrorRef>(null),preview=useRef<HTMLDivElement>(null),measure=useRef<HTMLDivElement>(null),exports=useRef<HTMLDivElement>(null);
  const importInput=useRef<HTMLInputElement>(null),backgroundInput=useRef<HTMLInputElement>(null),imageInput=useRef<HTMLInputElement>(null);
  const backgroundRequest=useRef(0);
  const update=(values:Partial<Draft>)=>setDraft(d=>({...d,...values}));
  useEffect(()=>{
    if(!hydrated||savedDraft.current===draft)return;
    setSaveState('未保存');let active=true;
    const timer=setTimeout(()=>{
      setSaveState('保存中');
      saveDocument(record.id,draft).then(()=>{
        savedDraft.current=draft;
        if(active&&latestDraft.current===draft){setSaveState('已保存');setDirectoryNeedsAttention(false);}
      }).catch(async()=>{
        if(active&&latestDraft.current===draft){setSaveState('保存失败');try{const mode=await getStorageMode();if(active)setDirectoryNeedsAttention(mode==='folder');}catch{}}
      });
    },800);
    return()=>{active=false;clearTimeout(timer);};
  },[draft,hydrated,record.id]);
  useEffect(()=>{
    if(directoryAction&&!directoryDialog.current?.open)directoryDialog.current?.showModal();
    if(!directoryAction&&directoryDialog.current?.open)directoryDialog.current.close();
  },[directoryAction]);
  useEffect(()=>{if(!message)return;const timer=setTimeout(()=>setMessage(''),5000);return()=>clearTimeout(timer);},[message]);
  useEffect(()=>{const body=normalizePromptSyntax(draft.body);const compact=compactImageReferences(body,draft.assets);if(compact||body!==draft.body)setDraft(previous=>previous.body===draft.body?{...previous,body,...compact}:previous);},[draft.body,draft.assets]);
  useEffect(()=>{
    const el=preview.current;if(!el)return;
    const observer=new ResizeObserver(([entry])=>setPreviewWidth(entry.contentRect.width));observer.observe(el);return()=>observer.disconnect();
  },[mobileTab]);
  useEffect(()=>{
    let cancelled=false;setPending(true);
    const delay=immediateLayout.current?0:200;
    immediateLayout.current=false;
    const timer=setTimeout(async()=>{
      try{
        await document.fonts.ready;if(cancelled||!measure.current)return;
        const sheets=measure.current.querySelectorAll<HTMLElement>('.note-sheet');
        const capacities=[...sheets].map(s=>s.querySelector<HTMLElement>('.note-footer')!.offsetTop-48-s.querySelector<HTMLElement>('.note-content')!.offsetTop);
        if(capacities[0]<120)throw Error('标题区域过高，请缩短标题或副标题。');
        const blocks=parseMarkdown(draft.body,draft.assets);
        const result=await paginate(blocks,measure.current,capacities[0],capacities[1],draft.spacing,index=>{
          const resolved=forPage(draft,index);
          const sample=sheets[index===0?0:1];
          const header=sample.querySelector<HTMLElement>('.note-kicker')!;
          header.textContent=pageHeader(resolved,index);header.style.display=resolved.headerEnabled===false||resolved.header===''?'none':'';
          const footerText=sample.querySelector<HTMLElement>('.note-footer span:first-child')!;footerText.textContent=resolved.footer;footerText.style.display=resolved.footerEnabled===false?'none':'';
          sample.querySelector<HTMLElement>('.note-footer span:last-child')!.style.display=resolved.pageNumbers===false?'none':'';
          const capacity=sample.querySelector<HTMLElement>('.note-footer')!.offsetTop-48-sample.querySelector<HTMLElement>('.note-content')!.offsetTop;
          return {...resolved,capacity};
        });
        if(!cancelled)setLayout(result);
      }catch(e){if(!cancelled)setLayout({pages:[emptyPage],errors:[e instanceof Error?e.message:'分页失败，请检查内容。']});}
      finally{if(!cancelled)setPending(false);}
    },delay);
    return()=>{cancelled=true;clearTimeout(timer);};
  },[draft.title,draft.subtitle,draft.body,draft.assets,draft.fontSize,draft.spacing,draft.lineHeight,draft.header,draft.footer,draft.pageNumbers,draft.footerLine,draft.headerEnabled,draft.footerEnabled,draft.pageSettings,hydrated,layoutRequest]);
  useEffect(()=>{setSelectedPage(index=>Math.min(index,layout.pages.length-1));},[layout.pages.length]);
  const currentPage=forPage(draft,selectedPage);
  const currentTemplate=templateLibrary.find(t=>t.id===draft.templateId)??templateLibrary[0];
  function updatePage(values:Partial<PageSettings>){
    setDraft(previous=>{
      const resolved=forPage(previous,selectedPage);
      return {...previous,pageSettings:{...previous.pageSettings,[selectedPage]:{fontSize:resolved.fontSize,spacing:resolved.spacing,lineHeight:resolved.lineHeight,overlay:resolved.overlay,imageRadius:resolved.imageRadius,header:resolved.header,footer:resolved.footer,...values}}};
    });
  }
  function resetPage(){
    const defaults=forPage(initialDraft,selectedPage);
    updatePage({fontSize:defaults.fontSize,spacing:defaults.spacing,lineHeight:defaults.lineHeight,overlay:defaults.overlay,imageRadius:defaults.imageRadius});
    setMessage('本页已恢复模板默认排版');
  }
  function applyToAll(){setDraft(previous=>{const resolved=forPage(previous,selectedPage);const values:PageSettings={fontSize:resolved.fontSize,spacing:resolved.spacing,lineHeight:resolved.lineHeight,overlay:resolved.overlay,imageRadius:resolved.imageRadius};const pageSettings=Object.fromEntries(Object.entries(previous.pageSettings??{}).map(([index,settings])=>[index,{...values,header:settings.header,footer:settings.footer}]));return {...previous,...values,pageSettings};});setMessage('当前页排版已应用至所有页面，页眉页脚文字保持不变');}
  function selectPage(index:number){setSelectedPage(index);preview.current?.querySelector<HTMLElement>(`[data-page-index="${index}"]`)?.scrollIntoView({block:'start',behavior:'smooth'});}
  const scale=zoom??Math.min(0.6,Math.max(0.1,(previewWidth-48)/1242));
  const titleName=(draft.title.split('\n')[0]||'未命名笔记').replace(/[\\/:*?"<>|]/g,'').slice(0,50);

  async function chooseBackground(background:Draft['background']){
    const request=++backgroundRequest.current;setPaletteBusy(true);
    try{const palette=await makeThemePalette(background);if(request!==backgroundRequest.current)return;update({background,...palette,colorOpacity:{}});setMessage('主题与配色已更新');}
    catch{setMessage('背景读取失败，请选择 PNG、JPG 或 WebP 图片。');}
    finally{if(request===backgroundRequest.current)setPaletteBusy(false);}
  }
  async function resetColors(){
    const request=++backgroundRequest.current;setPaletteBusy(true);
    try{const {colors}=await makeThemePalette(draft.background);if(request!==backgroundRequest.current)return;update({colors,colorOpacity:{}});setEditingColor(null);setMessage('已恢复当前主题的默认颜色');}
    catch{setMessage('默认颜色读取失败，请检查背景图片。');}
    finally{if(request===backgroundRequest.current)setPaletteBusy(false);}
  }
  async function backgroundUpload(e:ChangeEvent<HTMLInputElement>){const file=e.target.files?.[0];e.target.value='';if(!file)return;
    if(file.size>15*1024*1024){setMessage('背景图片请控制在 15 MB 以内。');return;}
    try{await chooseBackground({id:'upload',name:file.name,image:await fileData(file),paper:'#f5f7fb'});}catch{setMessage('图片无法读取');}
  }
  function insert(before:string,after='',fallback=''){
    setBodyMode('source');
    const view=editor.current?.view;if(!view)return;
    const range=view.state.selection.main;const selected=view.state.sliceDoc(range.from,range.to)||fallback;
    const value=before+selected+after;view.dispatch({changes:{from:range.from,to:range.to,insert:value},selection:{anchor:range.from+before.length,head:range.from+before.length+selected.length}});view.focus();
  }
  function format(action:Parameters<RichEditorHandle['format']>[0],before:string,after='',fallback=''){
    if(bodyMode==='rendered')richEditor.current?.format(action);
    else insert(before,after,fallback);
  }
  function insertPageBreak(){
    if(bodyMode==='rendered'){
      immediateLayout.current=true;richEditor.current?.pageBreak();setLayoutRequest(n=>n+1);return;
    }
    const view=editor.current?.view;
    const position=view?.state.selection.main.head??draft.body.length;
    const marker='\n\n<!-- pagebreak -->\n\n';
    immediateLayout.current=true;
    if(view)view.dispatch({changes:{from:position,insert:marker},selection:{anchor:position+marker.length}});
    else update({body:draft.body.slice(0,position)+marker+draft.body.slice(position)});
    setBodyMode('source');setLayoutRequest(n=>n+1);
    requestAnimationFrame(()=>editor.current?.view?.focus());
  }
  async function imageUpload(e:ChangeEvent<HTMLInputElement>){const file=e.target.files?.[0];e.target.value='';if(!file)return;
    if(file.size>15*1024*1024){setMessage('正文图片请控制在 15 MB 以内。');return;}
    try{const data=await fileData(file);const img=new Image();img.src=data;await img.decode();update({assets:{...draft.assets,[file.name]:data}});if(bodyMode==='rendered')richEditor.current?.image(data,file.name);else insert(`\n\n![${file.name.replace(/[\[\]]/g,'')}](`,')\n\n',file.name);}
    catch{setMessage('正文图片无法读取');}
  }
  async function pasteImages(e:React.ClipboardEvent){
    const files=[...e.clipboardData.files].filter(file=>file.type.startsWith('image/'));if(!files.length)return;
    e.preventDefault();e.stopPropagation();
    try{for(const file of files){if(file.size>15*1024*1024){setMessage('正文图片请控制在 15 MB 以内。');continue;}const source=await fileData(file);const image=new Image();image.src=source;await image.decode();const name=`图片-${crypto.randomUUID().slice(0,8)}.png`;setDraft(previous=>({...previous,assets:{...previous.assets,[name]:source}}));if(bodyMode==='rendered')richEditor.current?.image(source,name);else insert(`\n\n![图片](${name})\n\n`);}}
    catch{setMessage('剪贴板图片无法读取');}
  }
  async function importDraft(e:ChangeEvent<HTMLInputElement>){const file=e.target.files?.[0];e.target.value='';if(!file)return;
    try{const text=await file.text();if(file.name.endsWith('.json')){const value=JSON.parse(text);if(!validDraft(value))throw Error('草稿文件格式不正确');setDraft(migrateDraft(value));}
      else{const lines=text.split('\n');const first=lines[0].match(/^#\s+(.+)$/);update({...(first?{title:first[1]}:{}),body:first?lines.slice(1).join('\n').trim():text});}
      setMessage('草稿已导入');
    }catch(e){setMessage(e instanceof Error?e.message:'导入失败');}
  }
  async function showDirectoryRecovery(action:'save'|'home',reason=''){
    try{const access=await workingDirectoryAccess();directoryHandle.current=access.handle??null;setDirectoryError(reason||(!access.handle?'原工作目录连接已丢失，请重新选择目录。':''));}
    catch{directoryHandle.current=null;setDirectoryError(reason||'无法检查工作目录权限，请重新选择目录。');}
    setPermissionIssue(true);setDirectoryNeedsAttention(true);setDirectoryAction(action);
  }
  function showSaveFailure(action:'save'|'home',reason:string){
    setPermissionIssue(false);setDirectoryNeedsAttention(false);setDirectoryError(reason);setDirectoryAction(action);
  }
  async function saveDraft(exitAfter=false){
    setSaveState('保存中');
    const snapshot=latestDraft.current;
    let mode:Awaited<ReturnType<typeof getStorageMode>>=null;
    try{
      mode=await getStorageMode();
      if(mode==='folder'){
        const access=await workingDirectoryAccess();
        if(access.permission!=='granted'){
          directoryHandle.current=access.handle??null;
          setDirectoryError(access.handle?'':'原工作目录连接已丢失，请重新选择目录。');
          setPermissionIssue(true);setDirectoryNeedsAttention(true);setSaveState('保存失败');setDirectoryAction(exitAfter?'home':'save');
          return;
        }
      }
      await saveDocument(record.id,snapshot);
      savedDraft.current=snapshot;
      if(latestDraft.current!==snapshot){if(exitAfter)await saveDraft(true);return;}
      setSaveState('已保存');setDirectoryNeedsAttention(false);
      if(exitAfter)onHome();
      else setMessage(mode==='folder'?'草稿已保存到工作目录和当前浏览器':'草稿已保存到当前浏览器');
    }catch(failure){
      setSaveState('保存失败');
      const isPermissionError=failure instanceof DOMException&&['NotAllowedError','SecurityError'].includes(failure.name);
      const reason=failure instanceof Error?failure.message:'未知错误';
      if(mode==='folder'&&isPermissionError)await showDirectoryRecovery(exitAfter?'home':'save',`工作目录没有写入权限：${reason}`);
      else if(exitAfter)showSaveFailure('home',`保存失败：${reason}`);
      else {setDirectoryNeedsAttention(false);setMessage(`保存失败：${reason}`);}
    }
  }
  function closeDirectoryRecovery(){setDirectoryAction(null);directoryDialog.current?.close();}
  async function authorizeDirectory(){
    if(!directoryAction||directoryBusy||!directoryHandle.current)return;
    const action=directoryAction;setDirectoryBusy(true);setDirectoryError('');
    try{
      if(await requestWorkingDirectoryPermission(directoryHandle.current)!=='granted'){
        setDirectoryError('未获得写入权限，请授权或重新选择目录。');return;
      }
      closeDirectoryRecovery();void saveDraft(action==='home');
    }catch{setDirectoryError('授权失败，请重新选择工作目录。');}
    finally{setDirectoryBusy(false);}
  }
  async function reselectDirectory(){
    if(!directoryAction||directoryBusy)return;
    const action=directoryAction;setDirectoryBusy(true);setDirectoryError('');
    try{await selectWorkingDirectory(validDraft);closeDirectoryRecovery();void saveDraft(action==='home');}
    catch(failure){if(failure instanceof DOMException&&failure.name==='AbortError')return;setDirectoryError(failure instanceof Error?failure.message:'无法连接工作目录，请重试。');}
    finally{setDirectoryBusy(false);}
  }
  async function returnHome(){
    if(savedDraft.current===latestDraft.current){onHome();return;}
    await saveDraft(true);
  }
  async function exportImages(index?:number){
    if(pending||layout.errors.length){setMessage('请先处理预览中的排版或图片问题。');return;}
    setExportProgress('准备图片');
    try{
      await document.fonts.ready;
      const elements=[...exports.current!.querySelectorAll<HTMLElement>('.note-sheet')];
      const chosen=index===undefined?elements.map((node,i)=>({node,i})):[{node:elements[index],i:index}];
      const imageErrors=await waitForImages(exports.current!);if(imageErrors.some(Boolean))throw Error('图片尚未完整加载，暂时无法导出。');
      const zip=new JSZip();
      for(let n=0;n<chosen.length;n++){
        const {node,i}=chosen[n];const body=node.querySelector<HTMLElement>('.note-content')!;
        if(body.offsetTop+body.offsetHeight>node.querySelector<HTMLElement>('.note-footer')!.offsetTop-40)throw Error(`第 ${i+1} 页内容超出范围，请调整正文大小或手动分页。`);
        setExportProgress(`导出 ${n+1} / ${chosen.length}`);
        const blob=await toBlob(node,{pixelRatio:1,width:1242,height:1660,skipFonts:true,cacheBust:false});
        if(!blob)throw Error('图片生成失败');
        if(index!==undefined)download(blob,`${titleName}-${String(i+1).padStart(2,'0')}.png`);
        else zip.file(`${String(i+1).padStart(2,'0')}.png`,blob);
      }
      if(index===undefined){setExportProgress('打包图片');download(await zip.generateAsync({type:'blob',compression:'STORE'}),`${titleName}-图片.zip`);}
      setMessage('图片已生成并下载');
    }catch(e){setMessage(e instanceof Error?e.message:'导出失败，请重试。');}
    finally{setExportProgress('');}
  }

  async function exportLongImage(){
    setExportProgress('生成长图');
    try{
      await document.fonts.ready;
      const node=longExport.current?.querySelector<HTMLElement>('.note-sheet');if(!node)throw Error('长图尚未就绪，请稍后重试。');
      const errors=await waitForImages(node);if(errors.some(Boolean))throw Error(errors.filter(Boolean).join('；'));
      const height=Math.ceil(node.getBoundingClientRect().height);
      if(height>30000||1242*height>32000000)throw Error('内容超出浏览器长图导出尺寸，请减少内容或使用分页导出。');
      const blob=await toBlob(node,{pixelRatio:1,width:1242,height,skipFonts:true,skipAutoScale:true,cacheBust:false});
      if(!blob)throw Error('长图生成失败，请重试或使用分页导出。');
      download(blob,`${titleName}-长图.png`);setMessage('长图已生成并下载');
    }catch(e){setMessage(e instanceof Error?e.message:'长图导出失败，请使用分页导出。');}
    finally{setExportProgress('');}
  }

  const toggle=(value:typeof panel)=>setPanel(p=>p===value?null:value);
  return <main className="app-shell">
    <header className="app-header glass">
      <IconButton label="返回主页" onClick={returnHome}><Trees size={26}/></IconButton>
      <div className="document-heading"><FileText size={20}/><h1 title={draft.title||'未命名草稿'}>{draft.title.split('\n')[0]||'未命名草稿'}</h1></div>
      {directoryNeedsAttention&&saveState==='保存失败'?<button type="button" className="save-status status-error save-reconnect" title="重新连接工作目录并保存" onClick={()=>void showDirectoryRecovery('save')}><AlertCircle size={16}/><span>保存失败 · 重新授权</span></button>:<span className={`save-status ${saveState==='保存失败'?'status-error':''}`} role="status">{saveState==='保存失败'?<AlertCircle size={16}/>:saveState==='保存中'?<LoaderCircle size={16} className="spin"/>:<CheckCircle2 size={16}/>}<span>{saveState==='已保存'?'已自动保存':saveState}</span></span>}
      <div className="header-actions"><IconButton label="保存草稿" onClick={()=>void saveDraft()}><Save size={20}/></IconButton><button className="button" disabled={!!exportProgress||!!longErrors.length} onClick={exportLongImage}>{exportProgress==='生成长图'?<LoaderCircle size={20} className="spin"/>:<Download size={20}/>}<span>{exportProgress==='生成长图'?exportProgress:'导出长图'}</span></button><button className="button primary" disabled={!!exportProgress||pending||!!layout.errors.length} onClick={()=>exportImages()}>{exportProgress&&exportProgress!=='生成长图'?<LoaderCircle size={20} className="spin"/>:<Download size={20}/>}<span>{exportProgress&&exportProgress!=='生成长图'?exportProgress:'导出图片'}</span></button></div>
    </header>
    <section className="theme-toolbar glass" aria-label="主题工具栏">
      <button className={`button theme-selector ${panel==='background'?'selected':''}`} onClick={()=>toggle('background')} aria-expanded={panel==='background'}><Palette size={20}/><span>模板库</span><ChevronDown size={16}/></button><span className="active-template-name">{currentTemplate.name} · {draft.background.name}</span>
      <div className="toolbar-divider"/>
      <div className="quick-colors">{colorRoles.map(({key,label})=><button key={key} className="quick-color" title={label} aria-label={`编辑${label}`} aria-expanded={editingColor?.key===key} onClick={e=>setEditingColor(editingColor?.key===key?null:{key,label,anchor:e.currentTarget})}><span className="color-swatch"><i style={{background:colorWithOpacity(draft.colors[key],draft.colorOpacity?.[key]??100)}}/></span><span>{label}</span></button>)}<button className="button quiet reset-colors" title="恢复当前主题的默认颜色" onClick={()=>void resetColors()} disabled={paletteBusy}>{paletteBusy?<LoaderCircle className="spin" size={16}/>:<RotateCcw size={16}/>}<span>恢复默认</span></button></div>
    </section>
    {panel&&<section className="settings-panel glass" aria-label="主题与排版设置">
      <div className="settings-top"><div className="template-options" role="group" aria-label="模板选择">{templateLibrary.map(template=><button key={template.id} className={`template-option ${currentTemplate.id===template.id?'active':''}`} aria-pressed={currentTemplate.id===template.id} disabled={paletteBusy} onClick={()=>{if(template.id===currentTemplate.id)return;update({templateId:template.id});chooseBackground(template.themes[0]);}}>{template.name}</button>)}</div><IconButton label="关闭设置" onClick={()=>setPanel(null)}><X size={20}/></IconButton></div>
      {panel==='background'&&<><div className="theme-list-label">主题</div><div className="background-settings"><div className="template-list">{currentTemplate.themes.map(b=><button className={`template-item ${draft.background.id===b.id?'active':''}`} key={b.id} aria-label={b.name} aria-pressed={draft.background.id===b.id} onClick={()=>chooseBackground(b)} disabled={paletteBusy}><ThemeSwatch background={b} selected={draft.background.id===b.id}/><span>{b.name}</span></button>)}<button className={`template-item template-upload ${draft.background.id==='upload'?'active':''}`} disabled={paletteBusy} onClick={()=>backgroundInput.current?.click()}><span className="template-swatch" style={draft.background.id==='upload'?{backgroundImage:`url(${JSON.stringify(draft.background.image)})`}:undefined}>{draft.background.id==='upload'?<Check size={20}/>:<Upload size={24}/>}</span><span>手动上传</span></button></div></div></>}
    </section>}
    <nav className="mobile-tabs" aria-label="工作区"><button className={mobileTab==='editor'?'active':''} onClick={()=>setMobileTab('editor')}>编辑</button><button className={mobileTab==='preview'?'active':''} onClick={()=>setMobileTab('preview')}>预览 · {previewMode==='long'?'长图':`${layout.pages.length} 页`}</button></nav>
    <div className={`workspace tab-${mobileTab}`}>
      <section className="editor-panel glass" aria-label="笔记编辑" onPasteCapture={pasteImages}>
        <div className="panel-header"><h2>草稿</h2><button className="button quiet" onClick={()=>importInput.current?.click()}><FolderOpen size={20}/>导入</button></div>
        <div className="title-module"><label htmlFor="note-title">标题</label><textarea id="note-title" rows={2} value={draft.title} onChange={e=>update({title:e.target.value})} placeholder="笔记标题"/><label className="subtitle-label" htmlFor="note-subtitle">副标题</label><input id="note-subtitle" value={draft.subtitle} onChange={e=>update({subtitle:e.target.value})} placeholder="副标题（可选）"/></div>
        <div className="body-heading"><h3>正文</h3></div>
        <div className="format-toolbar" aria-label="正文格式">
          <IconButton label="一级标题" onClick={()=>format('h1','# ','','标题')}><Heading1 size={20}/></IconButton><IconButton label="二级标题" onClick={()=>format('h2','## ','','标题')}><Heading2 size={20}/></IconButton><IconButton label="三级标题" onClick={()=>format('h3','### ','','标题')}><Heading3 size={20}/></IconButton><IconButton label="加粗" onClick={()=>format('bold','**','**','重点文字')}><Bold size={20}/></IconButton><IconButton label="文本高亮" onClick={()=>format('highlight','<mark>','</mark>','高亮文字')}><Highlighter size={20}/></IconButton><IconButton label="斜体" onClick={()=>format('italic','*','*','强调文字')}><Italic size={20}/></IconButton><span className="toolbar-divider"/>
          <IconButton label="无序列表" onClick={()=>format('bullet','- ','','列表内容')}><List size={20}/></IconButton><IconButton label="有序列表" onClick={()=>format('ordered','1. ','','列表内容')}><ListOrdered size={20}/></IconButton><IconButton label="引用" onClick={()=>format('quote','> ','','补充说明')}><Quote size={20}/></IconButton><IconButton label="提示词块" onClick={()=>format('prompt','\n```提示词\n','\n```\n','提示词内容')}><Code2 size={20}/></IconButton><IconButton label="插入图片" onClick={()=>imageInput.current?.click()}><ImageIcon size={20}/></IconButton><IconButton label="手动分页" onClick={insertPageBreak}><Scissors size={20}/></IconButton>
          <div className="body-mode" role="group" aria-label="正文显示方式"><button className={bodyMode==='source'?'active':''} title="Markdown 源码" aria-label="Markdown 源码" aria-pressed={bodyMode==='source'} onClick={()=>setBodyMode('source')}><Code2 size={20}/></button><button className={bodyMode==='rendered'?'active':''} title="渲染预览" aria-label="渲染预览" aria-pressed={bodyMode==='rendered'} onClick={()=>setBodyMode('rendered')}><Eye size={20}/></button></div>
        </div>
        <div className="markdown-editor" hidden={bodyMode!=='source'} onPasteCapture={e=>{const html=e.clipboardData.getData('text/html');if(html&&!e.clipboardData.getData('text/plain').includes('```')){e.preventDefault();insert(markdownPaste.turndown(html));}}}>
          <CodeMirror ref={editor} theme="dark" value={draft.body} extensions={extensions} onChange={value=>update({body:value})} height="100%" basicSetup={{foldGutter:false,highlightActiveLine:false,highlightActiveLineGutter:false}} aria-label="Markdown 正文"/>
        </div>
        <div className="body-preview" hidden={bodyMode!=='rendered'} aria-label="正文渲染预览">
          <RichEditor ref={richEditor} value={draft.body} assets={draft.assets} onChange={body=>update({body})}/>
        </div>
        <div className="editor-status"><span><FileText size={14}/>本地草稿</span><span>{draft.body.replace(/\s/g,'').length.toLocaleString()} 字</span></div>
      </section>
      <section className="preview-panel glass" aria-label="笔记预览">
        <div className="panel-header"><div className="preview-heading"><h2>图文预览</h2><span className="page-count"><i/>{previewMode==='long'?'长图':pending?'排版中':`${layout.pages.length} 页`}</span></div><div className="preview-mode" role="group" aria-label="预览模式"><button aria-pressed={previewMode==='pages'} onClick={()=>{setPreviewMode('pages');preview.current?.scrollTo(0,0);}}>分页</button><button aria-pressed={previewMode==='long'} onClick={()=>{setPreviewMode('long');preview.current?.scrollTo(0,0);}}>长图</button></div><div className="zoom-controls"><IconButton label="缩小" disabled={scale<=0.25} onClick={()=>setZoom(Math.max(.25,scale-.05))}><Minus size={18}/></IconButton><span>{Math.round(scale*100)}%</span><IconButton label="放大" disabled={scale>=1} onClick={()=>setZoom(Math.min(1,scale+.05))}><Plus size={18}/></IconButton><IconButton label="适合宽度" onClick={()=>setZoom(null)}><Scan size={20}/></IconButton>{previewMode==='pages'&&<button className={`icon-button ${pageSettingsOpen?'selected':''}`} title="排版设置" aria-label="排版设置" aria-expanded={pageSettingsOpen} onClick={()=>setPageSettingsOpen(v=>!v)}><Settings2 size={20}/></button>}</div></div>
        {(previewMode==='long'?longErrors:layout.errors).length>0&&<div className="preview-errors" role="alert"><AlertCircle size={18}/><span>{(previewMode==='long'?longErrors:layout.errors).join('；')}</span></div>}
        <div className="preview-body">
        <div className="preview-scroll" ref={preview}>
          {previewMode==='long'?<div className="preview-item long-preview" style={{width:1242*scale}}><div className="page-actions"><span>1242 × {longHeight} px</span></div><div className="page-frame" style={{width:1242*scale,height:longHeight*scale}}><div style={{transform:`scale(${scale})`,transformOrigin:'top left'}}><NotePage draft={forPage(draft,0)} content={longContent} index={0} total={1} long/></div></div></div>:layout.pages.map((content,index)=><div className={`preview-item ${selectedPage===index?'page-selected':''}`} data-page-index={index} key={index} style={{width:1242*scale}}><div className="page-actions"><button className="page-select" aria-label={`选择第 ${index+1} 页`} aria-pressed={selectedPage===index} onClick={()=>selectPage(index)}>{String(index+1).padStart(2,'0')} / {String(layout.pages.length).padStart(2,'0')}</button><button aria-label={`下载第 ${index+1} 页`} title="下载此页" disabled={!!exportProgress||pending||!!layout.errors.length} onClick={()=>exportImages(index)}><Download size={16}/></button></div><div className="page-frame" onClick={()=>setSelectedPage(index)} style={{width:1242*scale,height:1660*scale}}><div style={{transform:`scale(${scale})`,transformOrigin:'top left'}}><NotePage draft={forPage(draft,index)} content={content} index={index} total={layout.pages.length}/></div></div></div>)}
        </div>
        {pageSettingsOpen&&previewMode==='pages'&&<aside className="page-layout-settings" aria-label="排版设置">
          <div className="page-settings-heading"><h3>排版设置</h3><IconButton label="收起排版设置" onClick={()=>setPageSettingsOpen(false)}><X size={18}/></IconButton></div>
          <div className="layout-global-settings"><h3>全局</h3><label className="page-number-toggle">显示页码<input aria-label="显示页码" type="checkbox" checked={draft.pageNumbers!==false} onChange={e=>update({pageNumbers:e.target.checked})}/></label><label className="page-number-toggle">显示底部分割线<input aria-label="显示底部分割线" type="checkbox" checked={draft.footerLine!==false} onChange={e=>update({footerLine:e.target.checked})}/></label><label className="page-number-toggle">启用页眉<input aria-label="启用页眉" type="checkbox" checked={draft.headerEnabled!==false} onChange={e=>update({headerEnabled:e.target.checked})}/></label><label className="page-number-toggle">启用页脚<input aria-label="启用页脚" type="checkbox" checked={draft.footerEnabled!==false} onChange={e=>update({footerEnabled:e.target.checked})}/></label></div>
          <div className="layout-single-settings"><h3>单页排版</h3>
          <label className="page-picker">当前页<select value={selectedPage} onChange={e=>selectPage(Number(e.target.value))}>{layout.pages.map((_,index)=><option key={index} value={index}>第 {index+1} 页</option>)}</select></label>
          <label>正文大小 <span>{currentPage.fontSize}px</span><input aria-label="本页正文大小" type="range" min="28" max="52" step="2" value={currentPage.fontSize} onChange={e=>updatePage({fontSize:Number(e.target.value)})}/></label>
          <label>段落间距 <span>{currentPage.spacing}px</span><input aria-label="本页段落间距" type="range" min="24" max="80" step="4" value={currentPage.spacing} onChange={e=>updatePage({spacing:Number(e.target.value)})}/></label>
          <label>行距 <span>{(currentPage.lineHeight??1.65).toFixed(2)} 倍</span><input aria-label="本页行距" type="range" min="1.2" max="2.4" step="0.05" value={currentPage.lineHeight??1.65} onChange={e=>updatePage({lineHeight:Number(e.target.value)})}/></label>
          <label>背景遮罩 <span>{currentPage.overlay}%</span><input aria-label="本页背景遮罩" type="range" min="0" max="90" step="5" value={currentPage.overlay} onChange={e=>updatePage({overlay:Number(e.target.value)})}/></label>
          <label>图片圆角 <span>{currentPage.imageRadius??8}px</span><input aria-label="本页图片圆角" type="range" min="0" max="64" step="2" value={currentPage.imageRadius??8} onChange={e=>updatePage({imageRadius:Number(e.target.value)})}/></label>
          <button className="button quiet" onClick={resetPage}><RotateCcw size={18}/>恢复本页默认</button>
          <button className="button" onClick={applyToAll}><Check size={18}/>应用至所有页面</button>
          </div>
          <div className="document-text-settings"><h3>页眉与页脚</h3>{draft.headerEnabled!==false&&<label>页眉文字<textarea aria-label="页眉文字" rows={2} value={currentPage.header??'VIBE NOTES'} onChange={e=>updatePage({header:e.target.value})}/></label>}{draft.footerEnabled!==false&&<label>页脚文字<textarea aria-label="页脚文字" rows={3} value={currentPage.footer} onChange={e=>updatePage({footer:e.target.value})}/></label>}</div>
        </aside>}
        </div>
      </section>
    </div>
    {editingColor&&<ColorEditor label={editingColor.label} color={draft.colors[editingColor.key]} opacity={draft.colorOpacity?.[editingColor.key]??100} anchor={editingColor.anchor} onColor={value=>setDraft(previous=>({...previous,colors:{...previous.colors,[editingColor.key]:value}}))} onOpacity={value=>setDraft(previous=>({...previous,colorOpacity:{...previous.colorOpacity,[editingColor.key]:value}}))} onClose={closeColor}/>}
    <dialog className="storage-choice directory-access editor-directory-access" ref={directoryDialog} aria-labelledby="editor-directory-access-title" onCancel={event=>{event.preventDefault();if(!directoryBusy)closeDirectoryRecovery();}} onClose={()=>setDirectoryAction(null)}>
      <h2 id="editor-directory-access-title">{permissionIssue?'重新连接工作目录':'草稿未保存'}</h2>
      <p>{permissionIssue?'保存前需要重新确认工作目录的写入权限。':'请重试保存；也可以不保存当前改动，直接返回主页。'}</p>
      <div className="storage-choice-actions">
        {permissionIssue?<>
          {directoryHandle.current&&<button className="storage-folder" type="button" disabled={directoryBusy} onClick={()=>void authorizeDirectory()}><FolderOpen size={16}/>重新授权工作目录</button>}
          <button type="button" disabled={directoryBusy||!supportsWorkingDirectory()} onClick={()=>void reselectDirectory()}><FolderOpen size={16}/>重新选择目录</button>
        </>:<button type="button" disabled={directoryBusy} onClick={()=>{const action=directoryAction;closeDirectoryRecovery();void saveDraft(action==='home');}}>重试保存</button>}
      </div>
      {directoryError&&<p className="storage-error" role="alert">{directoryError}</p>}
      <div className="editor-directory-footer">
        {directoryAction==='home'&&<button type="button" className="storage-discard" disabled={directoryBusy} onClick={()=>{closeDirectoryRecovery();onHome();}}>不保存并返回主页</button>}
        <button type="button" className="storage-cancel" disabled={directoryBusy} onClick={closeDirectoryRecovery}>留在编辑页</button>
      </div>
    </dialog>
    {message&&<div className="toast" role="status"><CheckCircle2 size={18}/>{message}<button aria-label="关闭消息" onClick={()=>setMessage('')}><X size={16}/></button></div>}
    <input hidden type="file" ref={importInput} accept=".md,.markdown,.txt,.json" onChange={importDraft}/><input hidden type="file" ref={backgroundInput} accept="image/png,image/jpeg,image/webp,image/gif" onChange={backgroundUpload}/><input hidden type="file" ref={imageInput} accept="image/png,image/jpeg,image/webp,image/gif" onChange={imageUpload}/>
    <div className="render-stage" ref={measure} style={noteStyle(draft)} aria-hidden="true"><NotePage draft={forPage(draft,0)} content={emptyPage} index={0} total={layout.pages.length}/><NotePage draft={forPage(draft,1)} content={emptyPage} index={1} total={layout.pages.length}/></div>
    <div className="render-stage" ref={exports} aria-hidden="true">{layout.pages.map((content,index)=><NotePage key={index} draft={forPage(draft,index)} content={content} index={index} total={layout.pages.length}/>)}</div>
    <div className="render-stage" ref={longExport} aria-hidden="true"><NotePage draft={forPage(draft,0)} content={longContent} index={0} total={1} long/></div>
  </main>;
}

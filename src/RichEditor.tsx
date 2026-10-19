import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useEditor, EditorContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import { Node, Mark, mergeAttributes } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table';
import TurndownService from 'turndown';
import { markdownToRichHTML, escapeHTML } from './markdown';

const Prompt = Node.create({
  name:'prompt', group:'block', content:'paragraph+', defining:true,
  addAttributes(){return {label:{default:'提示词',parseHTML:element=>element.getAttribute('data-label')??'提示词'}};},
  parseHTML(){return [{tag:'div[data-prompt]',contentElement:'.prompt-content'}];},
  renderHTML({node,HTMLAttributes}){return ['div',mergeAttributes(HTMLAttributes,{'data-prompt':'true','data-label':node.attrs.label,class:'note-prompt'}),...(node.attrs.label?[['span',{class:'note-prompt-label',contenteditable:'false'},node.attrs.label]]:[]),['div',{class:'prompt-content'},0]];},
});
const Highlight=Mark.create({name:'highlight',parseHTML(){return [{tag:'mark'}];},renderHTML(){return ['mark',{},0];}});
const PageBreak=Node.create({
  name:'pageBreak',group:'block',atom:true,selectable:true,
  parseHTML(){return [{tag:'div[data-page-break]'}];},
  renderHTML(){return ['div',{'data-page-break':'true',class:'body-page-break',contenteditable:'false'},'分页'];},
});
function ResizableImage({node,updateAttributes,selected}:NodeViewProps){
  const wrapper=useRef<HTMLSpanElement>(null);const cleanup=useRef<()=>void>(()=>{});
  const [width,setWidth]=useState<number|null>(node.attrs.width);
  useEffect(()=>setWidth(node.attrs.width),[node.attrs.width]);
  useEffect(()=>()=>cleanup.current(),[]);
  function start(e:React.PointerEvent,corner:string){
    e.preventDefault();e.stopPropagation();cleanup.current();
    const element=wrapper.current!;const rect=element.getBoundingClientRect();
    const parent=element.closest('.tiptap')!;const available=parent.clientWidth;
    const initial=rect.width/available*100;let latest=initial;
    const move=(event:PointerEvent)=>{
      const dx=(event.clientX-e.clientX)*(corner.endsWith('left')?-1:1);
      const dy=(event.clientY-e.clientY)*(corner.startsWith('top')?-1:1)*rect.width/Math.max(1,rect.height);
      const delta=Math.abs(dx)>=Math.abs(dy)?dx:dy;
      latest=Math.round(Math.max(10,Math.min(100,initial+delta/available*100)));setWidth(latest);
    };
    const finish=()=>{cleanup.current();updateAttributes({width:latest});};
    window.addEventListener('pointermove',move);window.addEventListener('pointerup',finish,{once:true});window.addEventListener('pointercancel',finish,{once:true});
    cleanup.current=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',finish);window.removeEventListener('pointercancel',finish);};
  }
  return <NodeViewWrapper as="span" className={`resizable-image ${selected?'selected':''}`} style={width?{width:`${width}%`}:undefined}>
    <span ref={wrapper} className="image-resize-surface" contentEditable={false}><img src={node.attrs.src} alt={node.attrs.alt??''} draggable={false}/>{['top-left','top-right','bottom-left','bottom-right'].map(corner=><button type="button" key={corner} className={`image-resize-handle ${corner}`} aria-label={`调整图片大小 ${corner}`} title="拖动调整图片大小" onPointerDown={e=>start(e,corner)} onKeyDown={e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();updateAttributes({width:Math.max(10,Math.min(100,(width??100)+(e.key==='ArrowRight'?5:-5)))});}}}/>)}</span>
  </NodeViewWrapper>;
}
const AssetImage=Image.extend({
  addAttributes(){return {...this.parent?.(),width:{default:null,parseHTML:element=>{const value=element.getAttribute('width');return value?.endsWith('%')?Math.max(10,Math.min(100,parseFloat(value)))||null:null;},renderHTML:attributes=>attributes.width?{width:`${attributes.width}%`}:{}},assetName:{default:null,parseHTML:element=>element.getAttribute('data-asset-name'),renderHTML:attributes=>attributes.assetName?{'data-asset-name':attributes.assetName}:{}}};},
  addNodeView(){return ReactNodeViewRenderer(ResizableImage,{as:'span'});},
});
const converter = new TurndownService({headingStyle:'atx',codeBlockStyle:'fenced',bulletListMarker:'-',emDelimiter:'*'});
converter.addRule('highlight',{filter:'mark',replacement:content=>`<mark>${content}</mark>`});
converter.addRule('sizedImage',{filter:node=>node instanceof HTMLImageElement&&!!node.getAttribute('width')?.endsWith('%'),replacement:(_content,node)=>{const img=node as HTMLImageElement;return `<img src="${escapeHTML(img.getAttribute('src')??'')}" alt="${escapeHTML(img.alt)}" width="${escapeHTML(img.getAttribute('width')??'100%')}">`;}});
converter.addRule('pageBreak',{filter:node=>node instanceof HTMLElement&&node.hasAttribute('data-page-break'),replacement:()=> '\n\n<!-- pagebreak -->\n\n'});
converter.addRule('prompt',{
  filter:node=>node instanceof HTMLElement&&node.hasAttribute('data-prompt'),
  replacement:(_content,node)=>{
    const element=node as HTMLElement;
    const label=(element.getAttribute('data-label')??'').replace(/[\r\n]/g,' ');
    const lines=[...element.querySelectorAll('.prompt-content > p')].map(p=>converter.turndown(p.innerHTML)).join('\n');
    const fence='`'.repeat(Math.max(3,...[...lines.matchAll(/`+/g)].map(m=>m[0].length+1)));
    return `\n\n${fence}${label}\n${lines}\n${fence}\n\n`;
  },
});
converter.addRule('table',{
  filter:'table',replacement:(_content,node)=>{
    const rows=[...(node as HTMLTableElement).rows];if(!rows.length)return '';
    const cells=rows.map(row=>[...row.cells].map(cell=>converter.turndown(cell.innerHTML).replace(/\|/g,'\\|').replace(/\n/g,'<br>')));
    const columns=Math.max(...cells.map(row=>row.length));
    const format=(row:string[])=>'| '+Array.from({length:columns},(_,i)=>row[i]||'').join(' | ')+' |';
    return '\n\n'+[format(cells[0]),format(Array(columns).fill('---')),...cells.slice(1).map(format)].join('\n')+'\n\n';
  },
});
function toMarkdown(html:string,assets:Record<string,string>){
  const container=document.createElement('div');container.innerHTML=html;
  container.querySelectorAll('img').forEach(img=>{
    const src=img.getAttribute('src')||'';
    const name=img.getAttribute('data-asset-name');
    if(name){img.setAttribute('src',name);return;}
    const match=Object.entries(assets).find(([,value])=>value===src);
    if(match)img.setAttribute('src',match[0]);
    else if(src.startsWith(`${import.meta.env.BASE_URL}assets/`)||src.startsWith('/assets/')){
      const prefix=src.startsWith('/assets/')?'/assets/':`${import.meta.env.BASE_URL}assets/`;
      try{img.setAttribute('src',decodeURIComponent(src.slice(prefix.length)));}catch{ /* Retain malformed URLs as-is. */ }
    }
  });
  return converter.turndown(container.innerHTML);
}
export type RichEditorHandle={
  format:(action:'h1'|'h2'|'h3'|'bold'|'italic'|'highlight'|'bullet'|'ordered'|'quote'|'prompt')=>void;
  pageBreak:()=>void;image:(source:string,alt:string)=>void;
};

const RichEditor=forwardRef<RichEditorHandle,{value:string;assets:Record<string,string>;onChange:(value:string)=>void}>(function RichEditor({value,assets,onChange},ref){
  const callbacks=useRef({onChange,assets});callbacks.current={onChange,assets};
  const lastEmitted=useRef(value);
  const editor=useEditor({
    extensions:[StarterKit.configure({link:{openOnClick:false},underline:false}),Highlight,AssetImage.configure({inline:true,allowBase64:true}),Table.configure({resizable:false}),TableRow,TableHeader,TableCell,Prompt,PageBreak],
    content:markdownToRichHTML(value,assets),immediatelyRender:false,
    editorProps:{attributes:{'aria-label':'可编辑正文预览',role:'textbox','aria-multiline':'true'}},
    onUpdate:({editor})=>{
      const text=toMarkdown(editor.getHTML(),callbacks.current.assets);lastEmitted.current=text;callbacks.current.onChange(text);
    },
  });
  useEffect(()=>{
    if(!editor||value===lastEmitted.current)return;
    lastEmitted.current=value;editor.commands.setContent(markdownToRichHTML(value,assets),{emitUpdate:false});
  },[value,assets,editor]);
  useImperativeHandle(ref,()=>({
    format(action){
      if(!editor)return;const chain=editor.chain().focus();
      switch(action){
        case 'h1':chain.toggleHeading({level:1}).run();break;
        case 'h2':chain.toggleHeading({level:2}).run();break;
        case 'h3':chain.toggleHeading({level:3}).run();break;
        case 'bold':chain.toggleBold().run();break;
        case 'italic':chain.toggleItalic().run();break;
        case 'highlight':chain.toggleMark('highlight').run();break;
        case 'bullet':chain.toggleBulletList().run();break;
        case 'ordered':chain.toggleOrderedList().run();break;
        case 'quote':chain.toggleBlockquote().run();break;
        case 'prompt':{
          const {from,to}=editor.state.selection;
          const paragraphs:Record<string,unknown>[]=[];
          if(from!==to)editor.state.doc.nodesBetween(from,to,(node,position)=>{
            if(!node.isTextblock)return;
            const content=node.content.cut(Math.max(0,from-position-1),Math.min(node.content.size,to-position-1));
            if(content.size)paragraphs.push({type:'paragraph',content:content.toJSON()});
            return false;
          });
          chain.insertContentAt({from,to},{type:'prompt',attrs:{label:'提示词'},content:paragraphs.length?paragraphs:[{type:'paragraph',...(from===to?{content:[{type:'text',text:'提示词内容'}]}:{})}]}).run();break;
        }
      }
    },
    pageBreak(){editor?.chain().focus().insertContent([{type:'pageBreak'},{type:'paragraph'}]).run();},
    image(source,alt){editor?.chain().focus().insertContent({type:'image',attrs:{src:source,alt,assetName:alt}}).run();},
  }),[editor]);
  return <EditorContent editor={editor} className="rich-editor-content"/>;
});
export default RichEditor;

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight, FolderOpen, Monitor, Plus, LoaderCircle, Trash2 } from 'lucide-react';
import App, { validDraft } from './App';
import { forPage, initialDraft } from './model';
import { parseMarkdown } from './markdown';
import NotePage from './NotePage';
import { deleteDocument, getStorageMode, listDocuments, migrateLegacy, saveDocument, selectWorkingDirectory, supportsWorkingDirectory, useBrowserStorage, type DraftRecord, type StorageMode } from './drafts';
import './home.css';
import DraftTransition, { type FlightOrigin } from './DraftTransition';
import CaptureInspiration from './CaptureInspiration';
import { assetUrl } from './assetPath';

const bubbleSizes = [294, 216, 258, 188, 232, 210, 242, 198, 230, 184].map(size => size * .75);
const bubbleHeights = [[30, 65, 0, 95, 35], [340, 420, 335, 405, 350]];
const bubbleOffsets = [[-24, 20, 0, -30, 18], [15, -30, 30, -5, -25]];

function DraftMiniature({ record, scale }: { record: DraftRecord; scale: number }) {
  const pageDraft = useMemo(() => forPage(record.draft, 0), [record.draft]);
  const content = useMemo(() => {
    const blocks = parseMarkdown(record.draft.body, record.draft.assets);
    const breakIndex = blocks.findIndex(block => block.breakBefore);
    return { blocks: blocks.slice(0, breakIndex < 0 ? undefined : breakIndex).map(block => block.html), gap: pageDraft.spacing };
  }, [record.draft, pageDraft]);
  return <div className="draft-miniature"><div className="draft-miniature-page" style={{ transform: `scale(${scale})` }}><NotePage draft={pageDraft} content={content} index={0} total={1}/></div></div>;
}

export default function Workspace() {
  const [documents, setDocuments] = useState<DraftRecord[]>([]);
  const [editing, setEditing] = useState<DraftRecord | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [storageMode, setStorageMode] = useState<StorageMode | null>(null);
  const [pendingCreate, setPendingCreate] = useState<{ origin: FlightOrigin | null; fromLibrary: boolean } | null>(null);
  const [storageError, setStorageError] = useState('');
  const [storageBusy, setStorageBusy] = useState(false);
  const [fadeIntoEditor, setFadeIntoEditor] = useState(false);
  const [libraryPage, setLibraryPage] = useState(0);
  const [selectedDraft, setSelectedDraft] = useState<string | null>(null);
  const [visitedPreviews, setVisitedPreviews] = useState<Set<string>>(() => new Set());
  const pageCount = Math.max(1, Math.ceil(documents.length / 10));
  const currentPage = Math.min(libraryPage, pageCount - 1);
  const visibleDocuments = documents.slice(currentPage * 10, (currentPage + 1) * 10);
  const topCount = Math.ceil(visibleDocuments.length / 2);
  const bubbleSlots = visibleDocuments.map((_record, index) => {
    if (visibleDocuments.length === 1) return { x: 0, y: 175, size: bubbleSizes[index] };
    if (visibleDocuments.length === 2) return { x: index ? 170 : -170, y: index ? 170 : 125, size: bubbleSizes[index] };
    const row = index < topCount ? 0 : 1;
    const rowIndex = row ? index - topCount : index;
    const rowCount = row ? visibleDocuments.length - topCount : topCount;
    return { x: (rowIndex - (rowCount - 1) / 2) * 290 + bubbleOffsets[row][rowIndex], y: bubbleHeights[row][rowIndex], size: bubbleSizes[index] };
  });
  const selectedIndex = visibleDocuments.findIndex(record => record.id === selectedDraft);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [captureFrozen, setCaptureFrozen] = useState(false);
  const deleteLock = useRef(false);
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scene = useRef<HTMLElement>(null);
  const backgroundVideo = useRef<HTMLVideoElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const storageDialog = useRef<HTMLDialogElement>(null);
  const jar = useRef<HTMLButtonElement>(null);
  const editorStage = useRef<HTMLDivElement>(null);
  const creating = useRef(false);
  const opening = useRef(false);
  const focusAfterJourney = useRef(false);
  const [journey, setJourney] = useState<FlightOrigin|null>(null);
  const [capture,setCapture]=useState<FlightOrigin|null>(null);
  function showPreview(id: string) {
    if (collapseTimer.current) clearTimeout(collapseTimer.current);
    collapseTimer.current = null;
    setSelectedDraft(id);
    setVisitedPreviews(current => current.has(id) ? current : new Set(current).add(id));
  }
  function hidePreview(id: string) {
    if (collapseTimer.current) clearTimeout(collapseTimer.current);
    collapseTimer.current = setTimeout(() => setSelectedDraft(current => current === id ? null : current), 300);
  }
  useEffect(() => () => { if (collapseTimer.current) clearTimeout(collapseTimer.current); }, []);
  useEffect(() => {
    if (pendingCreate && !storageDialog.current?.open) storageDialog.current?.showModal();
    if (!pendingCreate && storageDialog.current?.open) storageDialog.current.close();
  }, [pendingCreate]);
  const completeJourney = useCallback(() => {
    focusAfterJourney.current = true;
    setCaptureFrozen(false);
    setJourney(null);
    creating.current = false;
  }, []);
  useEffect(() => {
    if (journey || !editing || !focusAfterJourney.current) return;
    let frame = 0, attempts = 0;
    const focus = () => {
      const content = editorStage.current?.querySelector<HTMLElement>('.cm-content');
      if (content && !editorStage.current?.inert) {
        content.focus({ preventScroll: true });
        focusAfterJourney.current = false;
      } else if (++attempts < 60) frame = requestAnimationFrame(focus);
    };
    frame = requestAnimationFrame(focus);
    return () => cancelAnimationFrame(frame);
  }, [journey, editing]);

  async function refresh() {
    const records = (await listDocuments()).filter(record => validDraft(record.draft));
    setDocuments(records);
    return records;
  }
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        await migrateLegacy(validDraft);
        const records = await listDocuments();
        if (!active) return;
        const valid = records.filter(record => validDraft(record.draft));
        setDocuments(valid);
        setStorageMode((await getStorageMode()) ?? (valid.length ? 'browser' : null));
        const id = new URLSearchParams(location.hash.slice(1)).get('draft');
        setEditing(valid.find(record => record.id === id) ?? null);
      } catch { if (active) setError('草稿读取失败，请刷新重试。'); }
      finally { if (active) setBusy(false); }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const video = backgroundVideo.current;
    if (!video) return;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const syncPlayback = () => {
      if (motion.matches || (editing && !journey && !fadeIntoEditor)) {
        video.pause();
        setVideoPlaying(false);
      } else if (libraryOpen || captureFrozen) {
        video.pause();
      } else {
        void video.play().catch(() => setVideoPlaying(false));
      }
    };
    syncPlayback();
    motion.addEventListener('change', syncPlayback);
    return () => motion.removeEventListener('change', syncPlayback);
  }, [editing, journey, fadeIntoEditor, libraryOpen, captureFrozen]);

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (!libraryOpen) opening.current = false;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (libraryOpen) {
      if (!node.open) node.showModal();
      const mouth = jar.current?.querySelector('.jar-art')?.getBoundingClientRect();
      const box = node.getBoundingClientRect();
      if (mouth) node.style.transformOrigin = `${mouth.left + mouth.width / 2 - box.left}px ${mouth.top + mouth.height * .16 - box.top}px`;
    } else if (!node.open) return;
    const flights: Animation[] = [];
    const mouth = jar.current?.querySelector('.jar-art')?.getBoundingClientRect();
    if (!reduced && mouth) node.querySelectorAll<HTMLElement>('.draft-item').forEach((item, index) => {
      const box = item.getBoundingClientRect();
      const origin = `translate(${mouth.left + mouth.width / 2 - box.left - box.width / 2}px,${mouth.top + mouth.height * .16 - box.top - box.height / 2}px) scale(.06)`;
      const frames = [{ transform:origin, opacity:0 }, { transform:getComputedStyle(item).transform, opacity:1 }];
      flights.push(item.animate(libraryOpen ? frames : [...frames].reverse(), { duration:libraryOpen ? 620 : 350, delay:libraryOpen ? 140 + index * 45 : index * 15, easing:'cubic-bezier(.22,.75,.24,1)', fill:'backwards' }));
    });
    const animation = node.animate([{ opacity:libraryOpen ? 0 : 1 }, { opacity:libraryOpen ? 1 : 0 }],
      { duration:reduced ? 120 : libraryOpen ? 300 : 450, fill:'both' });
    animation.finished.then(() => { if (!libraryOpen) node.close(); }).catch(() => {});
    return () => { animation.cancel(); flights.forEach(flight => flight.cancel()); };
  }, [libraryOpen]);

  useEffect(() => {
    const node = scene.current;
    if (!node || editing || capture || matchMedia('(prefers-reduced-motion: reduce)').matches || !matchMedia('(pointer: fine)').matches) return;
    let x = 0, y = 0, targetX = 0, targetY = 0, frame = 0;
    const move = (event: PointerEvent) => {
      if (libraryOpen) return;
      targetX = (event.clientX / innerWidth - .5) * 16;
      targetY = (event.clientY / innerHeight - .5) * 12;
    };
    const reset = () => { targetX = 0; targetY = 0; };
    const tick = () => {
      x += (targetX - x) * .065; y += (targetY - y) * .065;
      node.style.setProperty('--scene-x', `${x.toFixed(2)}px`);
      node.style.setProperty('--scene-y', `${y.toFixed(2)}px`);
      frame = requestAnimationFrame(tick);
    };
    node.addEventListener('pointermove', move);
    node.addEventListener('pointerleave', reset);
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); node.removeEventListener('pointermove', move); node.removeEventListener('pointerleave', reset); };
  }, [editing, libraryOpen, capture]);

  function open(record: DraftRecord) {
    setLibraryOpen(false);
    dialog.current?.close();
    history.replaceState(null, '', `#draft=${encodeURIComponent(record.id)}`);
    setEditing(record);
  }
  async function chooseDraft(record: DraftRecord, source: HTMLButtonElement) {
    if (opening.current) return;
    opening.current = true;
    try {
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
        const animation = source.animate([{ transform:'scale(1)', opacity:1 }, { transform:'scale(1.04)', opacity:.5 }], { duration:180, easing:'ease-out' });
        await animation.finished;
      }
      if (!opening.current) return;
      const box = source.getBoundingClientRect();
      setJourney({ x:box.left + box.width / 2, y:box.top + box.height / 2 });
      open(record);
    } catch { /* An interrupted selection leaves the library available. */ }
    finally { opening.current = false; }
  }
  async function create(event: MouseEvent<HTMLButtonElement>) {
    if (creating.current || busy) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const origin = { x: rect.right - 24, y: rect.top + rect.height / 2 };
    beginDraft(origin, false);
  }
  function beginDraft(origin: FlightOrigin | null, fromLibrary: boolean) {
    if (creating.current || busy) return;
    if (!storageMode) { setStorageError(''); setPendingCreate({ origin, fromLibrary }); return; }
    continueDraft(origin, fromLibrary);
  }
  function continueDraft(origin: FlightOrigin | null, fromLibrary: boolean) {
    if (fromLibrary) { void createDraft(null, true); return; }
    if(!capture&&!matchMedia('(prefers-reduced-motion: reduce)').matches){setLibraryOpen(false);setCaptureFrozen(false);setCapture(origin);return;}
    void createDraft(origin);
  }
  async function chooseStorage(mode: StorageMode) {
    if (!pendingCreate || storageBusy) return;
    const intent = pendingCreate;
    setStorageBusy(true); setStorageError('');
    try {
      if (mode === 'folder') { await selectWorkingDirectory(validDraft); await refresh(); }
      else await useBrowserStorage();
      setStorageMode(mode);
      setPendingCreate(null);
      continueDraft(intent.origin, intent.fromLibrary);
    } catch (failure) {
      if (failure instanceof DOMException && failure.name === 'AbortError') return;
      setStorageError(failure instanceof Error ? failure.message : '工作目录不可用，请重试或选择浏览器存储。');
    } finally { setStorageBusy(false); }
  }
  async function createDraft(origin:FlightOrigin|null, fromLibrary=false){
    if(creating.current)return;
    creating.current=true;
    setBusy(true); setError('');
    try {
      const draft = structuredClone(initialDraft);
      Object.assign(draft, { title: '', subtitle: '', body: '', assets: {}, pageSettings: {} });
      const record = await saveDocument(crypto.randomUUID(), draft);
      setCapture(null);
      if (fromLibrary) {
        setFadeIntoEditor(!matchMedia('(prefers-reduced-motion: reduce)').matches);
        focusAfterJourney.current = true;
      } else if (origin) setJourney({ ...origin, isNew: true });
      open(record);
    } catch { creating.current = false; setCapture(null); setCaptureFrozen(false); setError('新建失败，请检查浏览器存储权限后重试。'); }
    finally { setBusy(false); }
  }
  async function home() {
    history.replaceState(null, '', location.pathname + location.search);
    setFadeIntoEditor(false);
    setEditing(null);
    try { await refresh(); } catch { setError('草稿列表读取失败，请重试。'); }
  }
  async function showLibrary() {
    if (libraryOpen) {
      setLibraryOpen(false);
      dialog.current?.close();
    } else {
      setCapture(null);setLibraryPage(0);setSelectedDraft(null);setLibraryOpen(true);
      try { await refresh(); } catch { setError('草稿列表读取失败，请重试。'); }
    }
  }
  async function removeDraft(id: string) {
    if (deleteLock.current) return;
    deleteLock.current = true;
    setDeleting(true); setDeleteError('');
    try {
      await deleteDocument(id);
      setDocuments(previous => previous.filter(record => record.id !== id));
      setDeleteTarget(null);
      requestAnimationFrame(() => dialog.current?.querySelector<HTMLButtonElement>('.library-actions .forest-cta')?.focus());
    } catch { setDeleteError('删除失败，草稿仍然保留，请重试。'); }
    finally { deleteLock.current = false; setDeleting(false); }
  }
  return <><main className={`forest-home ${capture?'is-catching':''} ${libraryOpen?'library-is-open':''}`} ref={scene} hidden={!!editing&&!journey&&!fadeIntoEditor} inert={!!journey||fadeIntoEditor}>
    <img className="forest-backdrop" src={assetUrl('assets/home/forest-original-v1.png')} alt="" fetchPriority="high" />
    <video ref={backgroundVideo} className={`forest-backdrop forest-video ${videoPlaying?'is-playing':''}`} autoPlay muted loop playsInline preload="auto" aria-hidden="true" onPlaying={()=>setVideoPlaying(true)} onError={()=>setVideoPlaying(false)}>
      <source src={assetUrl('assets/home/forest-home-v3.mp4')} type="video/mp4" />
    </video>
    <div className="forest-atmosphere" aria-hidden="true" />
    <div className="forest-copy">
      <h1>灵感收集器</h1>
      <p>拾起微光，写成故事。</p>
      <button className="forest-cta" onClick={create} disabled={busy}>
        <span>新建草稿</span>{busy ? <LoaderCircle className="spin" size={22}/> : <ArrowRight size={26}/>}
      </button>
    </div>
    <div className="forest-foreground" aria-hidden="true"><i/><i/><i/></div>
    <button ref={jar} className="forest-jar" aria-label={libraryOpen ? '关闭草稿' : '打开草稿'} aria-haspopup="dialog" disabled={busy} onClick={showLibrary}>
      <span className="jar-art" aria-hidden="true">
        <img className="jar-body" src={assetUrl('assets/home/firefly-jar-open-v1.png')} alt="" />
        <img className="jar-lid" src={assetUrl('assets/home/firefly-jar-wood-v3.png')} alt="" />
        <i className="jar-spark"/><i className="jar-spark"/><i className="jar-spark"/>
      </span>
      <span className="jar-caption">我的草稿 · {documents.length}</span>
    </button>
    {capture&&<CaptureInspiration origin={capture} onCatch={createDraft} onFreeze={()=>{backgroundVideo.current?.pause();setCaptureFrozen(true);}} onCancel={()=>{setCapture(null);setCaptureFrozen(false);}}/>}
    {error && <p className="forest-error" role="alert">{error}</p>}
    <dialog className="draft-library" ref={dialog} aria-label="草稿箱" onCancel={event => { event.preventDefault(); setLibraryOpen(false); }} onClose={() => { setLibraryOpen(false); setSelectedDraft(null); if (collapseTimer.current) clearTimeout(collapseTimer.current); setDeleteTarget(null); setDeleteError(''); if(!editing&&!capture) jar.current?.focus(); }} onClick={event => { if (event.target === event.currentTarget) { const box = event.currentTarget.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) setLibraryOpen(false); } }}>
      <header><div className="library-actions"><button className="forest-cta" autoFocus onClick={() => beginDraft(null,true)} disabled={busy}><Plus size={18}/><span>新建草稿</span></button></div></header>
      <div className="library-list" key={currentPage}>
        {visibleDocuments.map((record,index) => { const slot=bubbleSlots[index]; const neighbor=selectedIndex>=0&&selectedIndex!==index&&Math.hypot(slot.x-bubbleSlots[selectedIndex].x,slot.y-bubbleSlots[selectedIndex].y)<340; const dx=neighbor?slot.x-bubbleSlots[selectedIndex].x:0,dy=neighbor?slot.y-bubbleSlots[selectedIndex].y:0,distance=Math.hypot(dx,dy)||1; return <div className={`draft-item ${selectedDraft===record.id?'is-selected':''} ${neighbor?'is-neighbor':''}`} key={record.id} style={{'--bubble-x':`${visibleDocuments.length===1?0:slot.x}px`,'--bubble-y':`${slot.y}px`,'--bubble-size':`${slot.size}px`,'--bubble-x-compact':`${(visibleDocuments.length===1?0:slot.x)*.72}px`,'--bubble-y-compact':`${slot.y*.82}px`,'--avoid-x':`${dx/distance*48}px`,'--avoid-y':`${dy/distance*36}px`} as CSSProperties} onMouseEnter={()=>showPreview(record.id)} onMouseLeave={()=>hidePreview(record.id)} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node))hidePreview(record.id);}}>{deleteTarget===record.id?<div className="draft-delete-confirm" role="group" aria-label="确认删除草稿"><p>删除“{record.draft.title.split('\n')[0]||'未命名草稿'}”？</p><small>草稿及其中的图片将被删除，此操作无法撤销。</small><div><button className="library-cancel" disabled={deleting} onClick={()=>{setDeleteTarget(null);setDeleteError('');requestAnimationFrame(()=>dialog.current?.querySelector<HTMLButtonElement>(`[data-delete-id="${CSS.escape(record.id)}"]`)?.focus());}}>取消</button><button className="library-delete-confirm" disabled={deleting} onClick={()=>removeDraft(record.id)}>{deleting?<LoaderCircle size={18} className="spin"/>:<Trash2 size={18}/>}确认删除</button></div></div>:<><button className="draft-row" aria-label={`打开草稿：${record.draft.title.split('\n')[0]||'未命名草稿'}`} onFocus={()=>showPreview(record.id)} onClick={event => chooseDraft(record,event.currentTarget)}>
          <span className="draft-bubble"><span className="draft-glow" aria-hidden="true"/><strong>{record.draft.title.split('\n')[0] || '未命名草稿'}</strong></span>
          <small className="draft-date">{new Date(record.updatedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</small>
        </button><div className="draft-bubble-panel" aria-hidden="true">{visitedPreviews.has(record.id)&&<DraftMiniature record={record} scale={slot.size*.76/1242}/>}</div><button className="library-icon draft-delete" data-delete-id={record.id} title="删除草稿" aria-label={`删除草稿：${record.draft.title.split('\n')[0]||'未命名草稿'}`} onFocus={()=>showPreview(record.id)} onClick={()=>{setSelectedDraft(null);setDeleteTarget(record.id);setDeleteError('');}}><Trash2 size={20}/></button></>}</div>; })}
        {!documents.length && <p className="library-empty">还没有草稿</p>}
      </div>
      {deleteError&&<p className="library-error" role="alert">{deleteError}</p>}
      {pageCount>1&&<nav className="library-pagination" aria-label="草稿分页"><button className="library-icon" title="上一页" aria-label="上一页" disabled={currentPage===0||deleting} onClick={()=>{setLibraryPage(currentPage-1);setSelectedDraft(null);setDeleteTarget(null);}}><ChevronLeft size={22}/></button><span>{currentPage+1} / {pageCount}</span><button className="library-icon" title="下一页" aria-label="下一页" disabled={currentPage===pageCount-1||deleting} onClick={()=>{setLibraryPage(currentPage+1);setSelectedDraft(null);setDeleteTarget(null);}}><ChevronRight size={22}/></button></nav>}
    </dialog>
    <dialog className="storage-choice" ref={storageDialog} aria-labelledby="storage-choice-title" onCancel={event => { event.preventDefault(); if (!storageBusy) setPendingCreate(null); }} onClose={() => setPendingCreate(null)}>
      <h2 id="storage-choice-title">草稿保存在哪里？</h2>
      <p>选择本地工作目录后，草稿会同时保存在文件夹和当前浏览器中。以后重新选择同一目录，可以读取其中的草稿。</p>
      <div className="storage-choice-actions">
        <button type="button" className="storage-folder" onClick={() => void chooseStorage('folder')} disabled={storageBusy || !supportsWorkingDirectory()}><FolderOpen size={20}/>选择本地工作目录</button>
        <button type="button" className="storage-browser" onClick={() => void chooseStorage('browser')} disabled={storageBusy}><Monitor size={20}/>仅保存在浏览器</button>
      </div>
      <p className="storage-warning">仅保存在浏览器时，清除浏览器或站点数据会使草稿丢失。</p>
      {!supportsWorkingDirectory() && <p className="storage-warning">当前浏览器不支持选择本地工作目录。</p>}
      {storageError && <p className="storage-error" role="alert">{storageError}</p>}
      <button type="button" className="storage-cancel" onClick={() => setPendingCreate(null)} disabled={storageBusy}>取消</button>
    </dialog>
  </main>
    {editing&&<div ref={editorStage} className={`draft-editor-stage ${journey?'is-entering':''} ${fadeIntoEditor?'is-fading':''}`} inert={!!journey} onAnimationEnd={event=>{if(event.target===event.currentTarget)setFadeIntoEditor(false);}} key={editing.id}><App record={editing} onHome={home}/></div>}
    {journey&&<DraftTransition origin={journey} editor={editorStage} onComplete={completeJourney}/>}
  </>;
}

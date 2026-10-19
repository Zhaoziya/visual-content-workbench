import type { CSSProperties } from 'react';
import { colorWithOpacity, pageHeader, type Draft, type Colors } from './model';
import type { PageContent } from './pagination';
import { onColor, compositeColor, luminance } from './palette';
import { resolveAssetUrl } from './assetPath';

export function noteStyle(draft:Draft):CSSProperties {
  const c=draft.colors;
  const color=(key:keyof Colors)=>colorWithOpacity(c[key],draft.colorOpacity?.[key]??100);
  const paper=compositeColor(c.paper,'#ffffff',draft.colorOpacity?.paper??100);
  const panel=compositeColor(c.panel,paper,draft.colorOpacity?.panel??100);
  return { '--note-text':color('text'),'--note-secondary':color('secondary'),'--note-accent':color('accent'),'--note-highlight':color('highlight'),
    '--note-paper':color('paper'),'--note-panel':color('panel'),'--note-prompt-surface':colorWithOpacity(luminance(c.paper)<.2?compositeColor(c.panel,c.paper,80):compositeColor('#ffffff',c.panel,82),draft.colorOpacity?.panel??100),'--note-border':color('border'),'--note-font':`${draft.fontSize}px`,'--note-image-radius':`${draft.imageRadius??8}px`,
    '--note-overlay':draft.overlay/100,'--note-line-height':draft.lineHeight??1.65,'--note-on-accent':onColor(compositeColor(c.accent,panel,draft.colorOpacity?.accent??100)),'--note-on-highlight':onColor(compositeColor(c.highlight,paper,draft.colorOpacity?.highlight??100)),
    backgroundImage:draft.background.image?`url(${JSON.stringify(resolveAssetUrl(draft.background.image))})`:'none',
  } as CSSProperties;
}

export default function NotePage({draft,content,index,total,long=false}:{draft:Draft;content:PageContent;index:number;total:number;long?:boolean}) {
  return <article className={`note-sheet ${index===0?'note-cover':''} ${long?'note-long':''}`} style={{...noteStyle(draft),'--note-image-max-height':long?'none':`${content.imageMaxHeight??1200}px`} as CSSProperties}>
    <div className="note-tint" />
    <header className="note-header">
      <div className="note-kicker" style={{display:draft.headerEnabled===false||draft.header===''?'none':undefined}}>{pageHeader(draft,index)}</div>
      {index===0&&<><h1 className="note-cover-title">{draft.title||'未命名笔记'}</h1>{draft.subtitle&&<p className="note-subtitle">{draft.subtitle}</p>}</>}
    </header>
    <div className="note-content" style={{gap:content.gap,'--note-gap':`${content.gap}px`} as CSSProperties}>
      {content.blocks.map((html,i)=><div className="note-group" key={i} dangerouslySetInnerHTML={{__html:html}} />)}
    </div>
    <footer className="note-footer" style={{borderTop:draft.footerLine===false?'none':undefined}}><span style={{display:draft.footerEnabled===false?'none':undefined}}>{draft.footer}</span><span style={{display:long||draft.pageNumbers===false?'none':undefined}}>{String(index+1).padStart(2,'0')} / {String(total).padStart(2,'0')}</span></footer>
  </article>;
}

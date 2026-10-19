import { marked, type Token, type Tokens } from 'marked';
import DOMPurify from 'dompurify';
import { assetUrl, resolveAssetUrl } from './assetPath';

export type Block = { html: string; heading: boolean; breakBefore?: boolean };
const builtins:Record<string,string>={'首页.png':assetUrl('assets/首页.png'),'设计稿1 .png':assetUrl('assets/设计稿1 .png'),'设计稿2.png':assetUrl('assets/设计稿2.png')};
export const escapeHTML=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function normalizePromptSyntax(source:string){
  return marked.lexer(source,{gfm:true}).map(token=>{
    let raw=token.raw;
    marked.walkTokens([token],nested=>{
      if(nested.type==='code'&&/^prompt(?:\s|$)/.test(nested.lang??'')){
        const label=(nested.lang??'').slice(6).trim();
        const replacement=nested.raw.replace(/^([ \t]*)(`{3,}|~{3,})[^\r\n]*/,(_line,indent,fence)=>`${indent}${fence}${label||'提示词'}`);
        raw=raw.replace(nested.raw,replacement);
      }
    });return raw;
  }).join('');
}
function promptLabel(lang?:string){const text=lang?.trim();if(!text)return null;const match=text.match(/^(?:提示词|prompt)\s+(.+)$/);return match?match[1].trim():text;}
function plainFence(text:string,assets:Record<string,string>){return prepareHTML(text.split('\n').filter(line=>line.trim()).map(line=>`<p>${marked.parseInline(line,{async:false})}</p>`).join(''),assets);}

function prepareHTML(html:string,assets:Record<string,string>,decorateLists=true) {
  const wrapper=document.createElement('div');
  wrapper.innerHTML=DOMPurify.sanitize(html,{FORBID_TAGS:['style','script','iframe','form','input','button'],FORBID_ATTR:['style']});
  wrapper.querySelectorAll('img').forEach(img=>{
    const raw=img.getAttribute('src')||'';
    let name=raw;try{name=decodeURIComponent(raw.split('/').at(-1)||raw);}catch{ /* Use the literal filename when percent encoding is invalid. */ }
    const src=resolveAssetUrl(assets[raw]||assets[name]||builtins[name]||raw);
    if(!/^(data:image\/(?:png|jpeg|webp|gif|svg\+xml);|https?:\/\/)/i.test(src)&&!src.startsWith(assetUrl('assets/'))) img.src=assetUrl('missing-image');
    else img.src=src;
    if(assets[raw]||builtins[raw])img.setAttribute('data-asset-name',raw);
    const width=img.getAttribute('width');
    if(width?.endsWith('%')&&Number.isFinite(parseFloat(width)))img.style.width=`${Math.max(10,Math.min(100,parseFloat(width)))}%`;
    img.crossOrigin='anonymous';img.loading='eager';
    img.setAttribute('draggable','false');
  });
  wrapper.querySelectorAll('a').forEach(a=>{a.target='_blank';a.rel='noopener noreferrer';});
  wrapper.querySelectorAll('ol').forEach(list=>{
    let number=Number(list.getAttribute('start')??1);
    for(const child of [...list.children]){
      if(child.tagName!=='LI')continue;
      if(child.hasAttribute('value'))number=Number(child.getAttribute('value'));
      child.setAttribute('data-list-number',String(number++).padStart(2,'0'));
      const content=child.firstElementChild?.tagName==='P'?child.firstElementChild:child;
      const lineBreak=[...content.childNodes].find(node=>node.nodeName==='BR');
      if(lineBreak&&decorateLists){
        const title=document.createElement('span');title.className='note-list-title';
        while(content.firstChild&&content.firstChild!==lineBreak)title.append(content.firstChild);
        content.insertBefore(title,lineBreak);lineBreak.remove();
      }
    }
  });
  const images=wrapper.querySelectorAll('img');
  if(images.length&&wrapper.textContent?.trim()===''){
    const figure=document.createElement('div');figure.className=images.length>1?'note-images note-images-pair':'note-images';
    images.forEach(img=>figure.append(img));wrapper.replaceChildren(figure);
  }
  return wrapper.innerHTML;
}

export function compactImageReferences(source:string,assets:Record<string,string>){
  const resources={...assets};let changed=false;
  const store=(src:string)=>{
    const existing=Object.entries(resources).find(([,value])=>value===src)?.[0];if(existing)return existing;
    const name=`图片-${crypto.randomUUID().slice(0,8)}.png`;resources[name]=src;return name;
  };
  const body=marked.lexer(source,{gfm:true}).map(token=>{
    let raw=token.raw;
    marked.walkTokens([token],nested=>{
      if(nested.type==='image'&&nested.href.startsWith('data:image/')){raw=raw.replace(nested.raw,nested.raw.replace(nested.href,store(nested.href)));changed=true;}
    });
    if(token.type==='html'&&raw.includes('data:image/')){
      const container=document.createElement('div');container.innerHTML=raw;
      container.querySelectorAll('img').forEach(img=>{const src=img.getAttribute('src')??'';if(src.startsWith('data:image/')){img.setAttribute('src',store(src));changed=true;}});
      raw=container.innerHTML+'\n';
    }
    return raw;
  }).join('');
  return changed?{body,assets:resources}:null;
}

export function parseMarkdown(source:string,assets:Record<string,string>):Block[] {
  const blocks:Block[]=[];
  const tokens=marked.lexer(source,{gfm:true,breaks:true});
  const render=(token:Token)=>prepareHTML(marked.parser(Object.assign([token],{links:tokens.links}),{async:false,gfm:true,breaks:true}) as string,assets);
  for(const token of tokens){
    if(token.type==='space')continue;
    if(token.type==='hr'||(token.type==='html'&&token.raw.trim()==='<!-- pagebreak -->')){blocks.push({html:'',heading:false,breakBefore:true});continue;}
    if(token.type==='code'){
      const label=promptLabel(token.lang)??'';
      const lines=plainFence(token.text,assets);
      blocks.push({heading:false,html:`<div class="note-prompt">${label?`<span class="note-prompt-label">${escapeHTML(label)}</span>`:''}${lines}</div>`});continue;
    }
    if(token.type==='list'){
      const list=token as Tokens.List;
      list.items.forEach((item,index)=>{
        const single={...list,items:[item],start:list.ordered?Number(list.start||1)+index:undefined};
        blocks.push({heading:false,html:render(single)});
      });continue;
    }
    blocks.push({html:render(token),heading:token.type==='heading'});
  }
  return blocks.filter(b=>b.html.trim()||b.breakBefore);
}

export function markdownToRichHTML(source:string,assets:Record<string,string>):string {
  const tokens=marked.lexer(source,{gfm:true,breaks:true});
  return tokens.map(token=>{
    if(token.type==='hr'||(token.type==='html'&&token.raw.trim()==='<!-- pagebreak -->'))return '<div data-page-break="true"></div>';
    if(token.type==='code'){
      const label=escapeHTML(promptLabel(token.lang)??'');
      const paragraphs=plainFence(token.text,assets);
      return `<div data-prompt="true" data-label="${label}"><div class="prompt-content">${paragraphs}</div></div>`;
    }
    return prepareHTML(marked.parser(Object.assign([token],{links:tokens.links}),{async:false,gfm:true,breaks:true}) as string,assets,false);
  }).join('');
}

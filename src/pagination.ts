import type { Block } from './markdown';
export type PageContent={blocks:string[];gap:number;imageMaxHeight?:number};
export type PaginationResult={pages:PageContent[];errors:string[]};

export async function waitForImages(node:HTMLElement) {
  return Promise.all([...node.querySelectorAll('img')].map(async img=>{
    try{await img.decode();return '';}catch{return `图片无法加载：${img.alt||img.getAttribute('src')}`;}
  }));
}

export async function paginate(blocks:Block[],host:HTMLElement,firstHeight:number,normalHeight:number,preferredGap:number,pageStyle?:(index:number)=>{fontSize:number;spacing:number;capacity?:number;lineHeight?:number}):Promise<PaginationResult> {
  const errors:string[]=[];
  const measure=document.createElement('div');measure.className='note-content';measure.style.width='1106px';measure.style.gap='24px';measure.style.setProperty('--note-gap','24px');host.append(measure);
  function height(html:string){
    if(pageStyle){const style=pageStyle(pages.length-1);measure.style.setProperty('--note-font',`${style.fontSize}px`);measure.style.setProperty('--note-line-height',String(style.lineHeight??1.65));}
    measure.style.setProperty('--note-image-max-height',`${limit()}px`);
    measure.innerHTML=html;
    for(const group of [...measure.children] as HTMLElement[]){
      const images=[...group.querySelectorAll('img')];if(!images.length)continue;
      const display=images.map(img=>img.style.display);images.forEach(img=>{img.style.display='none';});
      const reserved=group.offsetHeight;
      images.forEach((img,i)=>{img.style.display=display[i];img.style.maxHeight=`${Math.max(1,limit()-reserved)}px`;});
    }
    return measure.offsetHeight;
  }
  // Keep consecutive headings with the next body block before filling pages.
  const groups:Block[]=[];
  for(let i=0;i<blocks.length;i++){
    const b=blocks[i];let html=b.html;
    if(b.heading)while(i+1<blocks.length&&!blocks[i+1].breakBefore){html+=blocks[++i].html;if(!blocks[i].heading)break;}
    groups.push({...b,html});
  }
  measure.innerHTML=groups.map(g=>`<div class="note-group">${g.html}</div>`).join('');
  const imageErrors=await waitForImages(measure);errors.push(...imageErrors.filter(Boolean));
  measure.querySelectorAll('img').forEach(img=>{if(!img.getAttribute('width')?.endsWith('%'))img.width=img.naturalWidth||640;img.height=img.naturalHeight||400;});
  [...measure.children].forEach((element,index)=>{groups[index].html=element.innerHTML;});
  // Images remain in the decoded browser cache when measurement HTML is replaced.
  let pages:PageContent[]=[{blocks:[],gap:preferredGap}];
  const limit=()=>pageStyle?.(pages.length-1).capacity??(pages.length===1?firstHeight:normalHeight);
  function newPage(){if(pages.at(-1)!.blocks.length)pages.push({blocks:[],gap:preferredGap});}
  function fits(html:string){return height(pages.at(-1)!.blocks.concat(html).map(h=>`<div class="note-group">${h}</div>`).join(''))<=limit();}

  function append(html:string) {
    if(fits(html)){pages.at(-1)!.blocks.push(measure.lastElementChild!.innerHTML);return;}
    newPage();
    if(fits(html)){pages.at(-1)!.blocks.push(measure.lastElementChild!.innerHTML);return;}
    const holder=document.createElement('div');holder.innerHTML=html;
    if(holder.children.length>1){
      [...holder.children].forEach(child=>append(child.outerHTML));return;
    }
    const textNode=holder.querySelector('p');
    // Split a long plain paragraph on measured line boundaries, preserving rich inline markup.
    if(textNode&&!holder.querySelector('img,pre,table,.note-prompt')&&holder.children.length===1){
      const text=textNode.textContent||'';let offset=0;
      const nodes:Text[]=[];const walker=document.createTreeWalker(textNode,NodeFilter.SHOW_TEXT);let current:Node|null;
      while((current=walker.nextNode()))nodes.push(current as Text);
      function fragment(start:number,end:number){
        const range=document.createRange();let n=0;
        for(const node of nodes){const next=n+node.length;if(start>=n&&start<next)range.setStart(node,start-n);if(end>n&&end<=next){range.setEnd(node,end-n);break;}n=next;}
        const clone=document.createElement('p');clone.append(range.cloneContents());return clone.outerHTML;
      }
      while(offset<text.length){
        let low=offset,high=text.length;
        while(low<high){const mid=Math.ceil((low+high)/2);if(fits(fragment(offset,mid)))low=mid;else high=mid-1;}
        if(low===offset){errors.push('存在超过单页容量的段落，请缩短内容或降低正文大小。');pages.at(-1)!.blocks.push(html);break;}
        if(low<text.length&&low>offset&&/[\uD800-\uDBFF]/.test(text[low-1]))low--;
        pages.at(-1)!.blocks.push(fragment(offset,low));offset=low;if(offset<text.length)newPage();
      }
      return;
    }
    errors.push('有一组内容超过单页高度，请拆分提示词、列表条目或调整图片。');pages.at(-1)!.blocks.push(html);
  }
  for(const group of groups){if(group.breakBefore){newPage();continue;}append(group.html);}
  pages=pages.filter((p,i)=>p.blocks.length||i===0);
  pages.forEach((page,index)=>{
    if(pageStyle){const style=pageStyle(index);measure.style.setProperty('--note-font',`${style.fontSize}px`);measure.style.setProperty('--note-line-height',String(style.lineHeight??1.65));}
    const capacity=pageStyle?.(index).capacity??(index===0?firstHeight:normalHeight);
    page.imageMaxHeight=capacity;measure.style.setProperty('--note-image-max-height',`${capacity}px`);
    measure.innerHTML=page.blocks.map(h=>`<div class="note-group">${h}</div>`).join('');
    measure.style.gap='0px';measure.style.setProperty('--note-gap','0px');const natural=measure.offsetHeight;
    const gap=pageStyle?.(index).spacing??preferredGap;
    page.gap=page.blocks.length>1?Math.max(24,Math.min(gap,(capacity-natural)/(page.blocks.length-1))):24;
  });
  measure.remove();return {pages,errors:[...new Set(errors)]};
}

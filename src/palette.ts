import { type Background, type Colors } from './model';

type RGB = [number, number, number];
type Swatch = { color:string; count:number; lab:RGB };
const rgb=(color:string):RGB=>[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)) as RGB;
const hex=(values:RGB)=>'#'+values.map(v=>Math.round(Math.min(255,Math.max(0,v))).toString(16).padStart(2,'0')).join('');
const mix=(a:string,b:string,t:number)=>hex(rgb(a).map((v,i)=>v*(1-t)+rgb(b)[i]*t) as RGB);
const linear=(v:number)=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4;
export function luminance(color:string){const [r,g,b]=rgb(color).map(v=>linear(v/255));return r*.2126+g*.7152+b*.0722;}
export function contrast(a:string,b:string){const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
export function onColor(background:string){return contrast('#ffffff',background)>=contrast('#101820',background)?'#ffffff':'#101820';}
export function compositeColor(color:string,background:string,opacity=100){return mix(background,color,opacity/100);}
export function readable(color:string,background:string,target=4.5){return readableOn(color,[background],target);}
function readableOn(color:string,backgrounds:string[],target=4.5){
  const endpoint=backgrounds.reduce((sum,b)=>sum+luminance(b),0)/backgrounds.length>.3?'#101820':'#ffffff';
  for(let i=0;i<=100;i++){const candidate=mix(color,endpoint,i/100);if(backgrounds.every(b=>contrast(candidate,b)>=target))return candidate;}
  return endpoint;
}
function lab(color:string):RGB {
  const [r,g,b]=rgb(color).map(v=>linear(v/255));
  const l=Math.cbrt(.4122214708*r+.5363325363*g+.0514459929*b);
  const m=Math.cbrt(.2119034982*r+.6806995451*g+.1073969566*b);
  const s=Math.cbrt(.0883024619*r+.2817188376*g+.6299787005*b);
  return [.2104542553*l+.793617785*m-.0040720468*s,1.9779984951*l-2.428592205*m+.4505937099*s,.0259040371*l+.7827717662*m-.808675766*s];
}
const distance=(a:RGB,b:RGB)=>Math.hypot(...a.map((v,i)=>v-b[i]));
const chroma=(color:string)=>{const [,a,b]=lab(color);return Math.hypot(a,b);};
function mergeColors(pixels:string[]):Swatch[]{
  const histogram=new Map<string,{count:number;sum:RGB}>();
  for(const color of pixels){const c=rgb(color);const key=c.map(v=>Math.floor(v/16)).join(',');const bin=histogram.get(key)??{count:0,sum:[0,0,0]};bin.count++;bin.sum=bin.sum.map((v,i)=>v+c[i]) as RGB;histogram.set(key,bin);}
  const bins=[...histogram.values()].map(b=>{const color=hex(b.sum.map(v=>v/b.count) as RGB);return {color,count:b.count,lab:lab(color)};}).sort((a,b)=>b.count-a.count);
  const clusters:Swatch[]=[];
  for(const bin of bins){
    const closest=clusters.reduce<Swatch|undefined>((best,c)=>!best||distance(c.lab,bin.lab)<distance(best.lab,bin.lab)?c:best,undefined);
    if(closest&&distance(closest.lab,bin.lab)<.07){closest.color=mix(closest.color,bin.color,bin.count/(closest.count+bin.count));closest.count+=bin.count;closest.lab=lab(closest.color);}
    else clusters.push({...bin});
  }
  return clusters.sort((a,b)=>b.count-a.count);
}
async function analyzeImage(source:string){
  const image=new Image();image.crossOrigin='anonymous';image.src=source;await image.decode();
  const canvas=document.createElement('canvas');canvas.width=124;canvas.height=166;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)throw Error('浏览器不支持图片取色');
  const scale=Math.max(canvas.width/image.naturalWidth,canvas.height/image.naturalHeight);
  // Match the exported sheet's centered cover crop, not a stretched square thumbnail.
  ctx.drawImage(image,(canvas.width-image.naturalWidth*scale)/2,(canvas.height-image.naturalHeight*scale)/2,image.naturalWidth*scale,image.naturalHeight*scale);
  const data=ctx.getImageData(0,0,canvas.width,canvas.height).data;
  const pixels:string[]=[],readingPixels:string[]=[];
  for(let y=0;y<166;y+=2)for(let x=0;x<124;x+=2){const i=(y*124+x)*4;if(data[i+3]<128)continue;const color=hex([data[i],data[i+1],data[i+2]]);pixels.push(color);if(x>=7&&x<=117&&y>=6&&y<=156)readingPixels.push(color);}
  return {swatches:mergeColors(pixels),readingPixels};
}
export async function sampleImage(source:string):Promise<string[]>{return (await analyzeImage(source)).swatches.slice(0,8).map(s=>s.color);}
function baseFromSamples(swatches:Swatch[],fallback:string):Colors {
  const total=swatches.reduce((n,s)=>n+s.count,0);
  const dominant=swatches[0]?.color??fallback;
  const representatives=swatches.filter(s=>s.count>=total*.005).sort((a,b)=>chroma(b.color)*Math.sqrt(b.count)-chroma(a.color)*Math.sqrt(a.count));
  const colored=representatives.find(s=>chroma(s.color)>.045);
  const main=colored?.color??dominant;
  const accent=representatives.find(s=>chroma(s.color)>.06&&distance(s.lab,lab(main))>.16)?.color??main;
  const paper=mix(dominant,'#ffffff',.72),panel=mix(dominant,'#ffffff',.55);
  const ink=colored?'#101820':'#171717';
  return {paper,panel,text:mix(main,ink,.78),secondary:mix(main,ink,.55),accent,highlight:mix(accent,'#ffffff',.62),border:mix(main,paper,.55)};
}
function recommendedOverlay(colors:Colors,pixels:string[]):number {
  if(!pixels.length)return 0;
  for(let opacity=0;opacity<=90;opacity+=5){
    let readablePixels=0;
    for(const pixel of pixels){const background=mix(pixel,colors.paper,opacity/100);if(contrast(colors.text,background)>=4.5&&contrast(colors.secondary,background)>=4.5)readablePixels++;}
    if(readablePixels/pixels.length>=.95)return opacity;
  }
  return 90;
}
export async function makeThemePalette(background:Background):Promise<{colors:Colors;overlay:number}> {
  const preset=background.colors;
  if(preset)return {colors:{...preset},overlay:0};
  const analysis=background.image?await analyzeImage(background.image):{swatches:mergeColors([background.paper]),readingPixels:[]};
  const colors=baseFromSamples(analysis.swatches,background.paper);
  colors.text=readableOn(colors.text,[colors.paper,colors.panel],7);
  colors.secondary=readableOn(colors.secondary,[colors.paper,colors.panel],5.2);
  return {colors,overlay:recommendedOverlay(colors,analysis.readingPixels)};
}

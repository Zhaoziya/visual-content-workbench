import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { RgbaColorPicker } from 'react-colorful';
import { colorWithOpacity } from './model';

export default function ColorEditor({label,color,opacity,anchor,onColor,onOpacity,onClose}:{label:string;color:string;opacity:number;anchor:HTMLButtonElement;onColor:(value:string)=>void;onOpacity:(value:number)=>void;onClose:()=>void}){
  const panel=useRef<HTMLDivElement>(null);const [position,setPosition]=useState({left:8,top:8});
  const [hex,setHex]=useState(color);useEffect(()=>setHex(color),[color]);
  const channels=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16));
  useLayoutEffect(()=>{
    const place=()=>{const rect=anchor.getBoundingClientRect();const width=panel.current?.offsetWidth??280,height=panel.current?.offsetHeight??250;setPosition({left:Math.max(8,Math.min(rect.left,innerWidth-width-8)),top:rect.bottom+height+16<innerHeight?rect.bottom+8:Math.max(8,rect.top-height-8)});};
    place();window.addEventListener('resize',place);window.addEventListener('scroll',place,true);return()=>{window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);};
  },[anchor]);
  useEffect(()=>{
    panel.current?.querySelector<HTMLElement>('[role="slider"]')?.focus();
    const outside=(e:PointerEvent)=>{if(!panel.current?.contains(e.target as Node)&&!anchor.contains(e.target as Node))onClose();};
    const keyboard=(e:KeyboardEvent)=>{if(e.key==='Escape'){onClose();anchor.focus();}};
    document.addEventListener('pointerdown',outside);document.addEventListener('keydown',keyboard);return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',keyboard);};
  },[anchor,onClose]);
  return createPortal(<div ref={panel} className="color-editor glass" role="dialog" aria-label={`${label}编辑`} style={position}>
    <div className="color-editor-heading"><h3>{label}</h3><button className="icon-button" title="关闭颜色编辑" aria-label="关闭颜色编辑" onClick={()=>{onClose();anchor.focus();}}><X size={18}/></button></div>
    <RgbaColorPicker color={{r:channels[0],g:channels[1],b:channels[2],a:opacity/100}} onChange={value=>{onColor('#'+[value.r,value.g,value.b].map(channel=>Math.round(channel).toString(16).padStart(2,'0')).join(''));onOpacity(Math.round(value.a*100));}} aria-label={`${label}颜色与透明度`}/>
    <div className="color-editor-value"><label htmlFor="color-hex">HEX</label><input id="color-hex" aria-label={`${label}色值`} value={hex} maxLength={7} onChange={e=>setHex(e.target.value)} onBlur={()=>{if(/^#[\da-f]{6}$/i.test(hex))onColor(hex);else setHex(color);}} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}}/></div>
    <div className="color-alpha-controls"><label htmlFor="color-alpha">透明度</label><input id="color-alpha" aria-label={`${label}透明度数值`} type="number" min="0" max="100" value={opacity} onChange={e=>onOpacity(Math.max(0,Math.min(100,Number(e.target.value))))}/><span>%</span></div>
    <div className="color-alpha-preview"><span style={{background:colorWithOpacity(color,opacity)}}/></div>
  </div>,document.body);
}

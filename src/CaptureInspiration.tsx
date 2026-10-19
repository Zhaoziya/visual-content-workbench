import { useEffect, useId, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { FlightOrigin } from './DraftTransition';
import './capture.css';

function distanceToSegment(point: FlightOrigin, start: FlightOrigin, end: FlightOrigin) {
  const dx = end.x - start.x, dy = end.y - start.y;
  const progress = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(point.x - start.x - progress * dx, point.y - start.y - progress * dy);
}

function randomStart(origin: FlightOrigin): FlightOrigin {
  let best = { x: innerWidth / 2, y: innerHeight / 2 };
  let bestDistance = 0;
  for (let i = 0; i < 12; i++) {
    const point = {
      x: Math.max(40, Math.min(innerWidth - 40, innerWidth * (.12 + Math.random() * .76))),
      y: Math.max(40, Math.min(innerHeight - 40, innerHeight * (.14 + Math.random() * .72))),
    };
    const distance = Math.hypot(point.x - origin.x, point.y - origin.y);
    if (distance > 220) return point;
    if (distance > bestDistance) { best = point; bestDistance = distance; }
  }
  return best;
}

export default function CaptureInspiration({ origin, onCatch, onFreeze, onCancel }: {
  origin: FlightOrigin; onCatch: (point: FlightOrigin) => void; onFreeze: () => void; onCancel: () => void;
}) {
  const net = useRef<HTMLDivElement>(null), insect = useRef<HTMLButtonElement>(null);
  const pointer = useRef(origin), position = useRef(randomStart(origin));
  const callbacks = useRef({onCatch,onFreeze,onCancel}); callbacks.current={onCatch,onFreeze,onCancel};
  const caught = useRef(false), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [captured,setCaptured]=useState(false);
  const shapeId=useId();
  const catchFly = () => {
    if(caught.current)return;
    caught.current=true;setCaptured(true);
    insect.current?.classList.remove('is-fleeing');
    const point={...position.current};pointer.current=point;
    callbacks.current.onFreeze();
    timer.current=setTimeout(()=>callbacks.current.onCatch(point),260);
  };
  const catchRef=useRef(catchFly);catchRef.current=catchFly;
  useEffect(()=>{
    let frame=0,last=performance.now();const started=last;
    let velocityX=0,velocityY=0;
    let phase:'wander'|'flee'|'coast'='wander';
    let detectedAt=0,phaseEndsAt=0,cooldownUntil=0,nextTargetAt=0;
    let fleeX=0,fleeY=0;
    let lastPointer={...pointer.current};
    let wanderTarget={...position.current};
    const fine=matchMedia('(pointer:fine)').matches;
    const chooseTarget=(time:number)=>{
      wanderTarget={
        x:Math.max(40,Math.min(innerWidth-40,position.current.x+(Math.random()-.5)*560)),
        y:Math.max(40,Math.min(innerHeight-40,position.current.y+(Math.random()-.5)*380)),
      };
      nextTargetAt=time+650+Math.random()*650;
    };
    const move=(event:PointerEvent)=>{if(!caught.current)pointer.current={x:event.clientX,y:event.clientY};};
    const key=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!caught.current)callbacks.current.onCancel();};
    const tick=(time:number)=>{
      const dt=Math.min((time-last)/1000,.05);last=time;
      const p=position.current,target=pointer.current;
      if(!caught.current){
        if(fine&&time-started>500&&distanceToSegment(p,lastPointer,target)<44) catchRef.current();
        else {
          const awayX=p.x-target.x, awayY=p.y-target.y;
          const distance=Math.hypot(awayX,awayY);
          if(phase==='flee'&&time>=phaseEndsAt){phase='coast';phaseEndsAt=time+420;}
          if(phase==='coast'&&time>=phaseEndsAt){phase='wander';nextTargetAt=0;}
          if(phase==='wander'&&fine&&time-started>450&&time>=cooldownUntil&&distance<170){
            if(!detectedAt)detectedAt=time;
            if(time-detectedAt>=110){
              phase='flee';phaseEndsAt=time+300;cooldownUntil=time+850;detectedAt=0;
              let dx=awayX/(distance||1),dy=awayY/(distance||1);
              if(p.x<110&&dx<0)dx=-dx;
              if(p.x>innerWidth-110&&dx>0)dx=-dx;
              if(p.y<110&&dy<0)dy=-dy;
              if(p.y>innerHeight-110&&dy>0)dy=-dy;
              const length=Math.hypot(dx,dy)||1;
              fleeX=dx/length;fleeY=dy/length;
            }
          } else detectedAt=0;
          if(phase==='flee'){
            const turn=1-Math.exp(-dt*22);
            velocityX+=(fleeX*520-velocityX)*turn;
            velocityY+=(fleeY*520-velocityY)*turn;
          } else if(phase==='coast'){
            const drag=Math.exp(-dt*3.5);
            velocityX*=drag;velocityY*=drag;
          } else {
            const dx=wanderTarget.x-p.x,dy=wanderTarget.y-p.y;
            const gap=Math.hypot(dx,dy);
            if(time>=nextTargetAt||gap<24)chooseTarget(time);
            const goalX=wanderTarget.x-p.x,goalY=wanderTarget.y-p.y;
            const goalDistance=Math.hypot(goalX,goalY)||1;
            const speed=Math.min(fine?220:140,Math.max(fine?160:90,goalDistance*2.5));
            const turn=1-Math.exp(-dt*6);
            velocityX+=(goalX/goalDistance*speed-velocityX)*turn;
            velocityY+=(goalY/goalDistance*speed-velocityY)*turn;
          }
          p.x=Math.max(40,Math.min(innerWidth-40,p.x+velocityX*dt));
          p.y=Math.max(40,Math.min(innerHeight-40,p.y+velocityY*dt));
          insect.current?.classList.toggle('is-fleeing',phase==='flee');
        }
        lastPointer={...target};
      }
      if(net.current)net.current.style.transform=`translate3d(${pointer.current.x}px,${pointer.current.y}px,0)`;
      if(insect.current)insect.current.style.transform=`translate3d(${p.x}px,${p.y}px,0)`;
      frame=requestAnimationFrame(tick);
    };
    frame=requestAnimationFrame(tick);window.addEventListener('pointermove',move);window.addEventListener('keydown',key);
    return()=>{cancelAnimationFrame(frame);clearTimeout(timer.current);window.removeEventListener('pointermove',move);window.removeEventListener('keydown',key);};
  },[]);
  return <div className={`capture-layer ${captured?'is-captured':''}`}>
    <div ref={net} className="capture-net" aria-hidden="true"><svg viewBox="0 0 180 180" fill="none">
      <defs>
        <linearGradient id={`${shapeId}-cloth`} x1="110" y1="48" x2="32" y2="138" gradientUnits="userSpaceOnUse"><stop stopColor="var(--net-cloth)" stopOpacity=".38"/><stop offset="1" stopColor="var(--net-edge)" stopOpacity=".16"/></linearGradient>
        <pattern id={`${shapeId}-mesh`} width="17" height="17" patternUnits="userSpaceOnUse" patternTransform="rotate(24)"><path d="M0 0H17V17" stroke="var(--net-thread)" strokeOpacity=".48" strokeWidth="1.2"/></pattern>
        <clipPath id={`${shapeId}-bag`}><path d="M63.53 37.21C48 73 47 103 17 117C4 123 17 143 42 140C80 138 112 111 136.47 82.79A43 31 32 0 1 63.53 37.21Z"/></clipPath>
      </defs>
      <path d="M63.53 37.21C48 73 47 103 17 117C4 123 17 143 42 140C80 138 112 111 136.47 82.79A43 31 32 0 1 63.53 37.21Z" fill={`url(#${shapeId}-cloth)`} stroke="var(--net-thread)" strokeOpacity=".65" strokeWidth="2"/>
      <g clipPath={`url(#${shapeId}-bag)`}><path d="M0 25H150V155H0Z" fill={`url(#${shapeId}-mesh)`}/><path d="M67 47C72 94 39 118 18 123M101 70C91 112 59 135 35 138" stroke="var(--net-thread)" strokeOpacity=".36" strokeWidth="1.5"/></g>
      <path d="M128 83L170 153" stroke="var(--net-wood-edge)" strokeWidth="10" strokeLinecap="round"/>
      <path d="M128 83L170 153" stroke="var(--net-wood)" strokeWidth="6" strokeLinecap="round"/>
      <path d="M133 91L165 144" stroke="var(--net-wood-light)" strokeOpacity=".65" strokeWidth="1.5" strokeLinecap="round"/>
      <ellipse cx="100" cy="60" rx="43" ry="31" transform="rotate(32 100 60)" fill="var(--net-cloth)" fillOpacity=".03" stroke="var(--net-edge)" strokeWidth="9"/>
      <ellipse cx="100" cy="60" rx="43" ry="31" transform="rotate(32 100 60)" stroke="var(--net-ring)" strokeWidth="5"/>
      <ellipse cx="100" cy="59" rx="42" ry="30" transform="rotate(32 100 59)" stroke="var(--net-highlight)" strokeOpacity=".8" strokeWidth="1"/>
    </svg></div>
    <button ref={insect} className="capture-fly" aria-label="捕捉萤火虫" onClick={catchFly}><span className="flight-wing left"/><span className="flight-wing right"/><span className="flight-body"/></button>
    <button className="capture-cancel" onClick={onCancel} aria-label="取消捕捉" disabled={captured}><X size={18}/>取消</button>
    <span className="capture-announcement" role="status">{captured?'已捕获灵感':'正在捕捉灵感'}</span>
  </div>;
}

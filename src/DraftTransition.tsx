import { useLayoutEffect, useRef, type RefObject } from 'react';
import './transition.css';

export type FlightOrigin = { x: number; y: number; isNew?: boolean };

export default function DraftTransition({ origin, editor, onComplete }: {
  origin: FlightOrigin; editor: RefObject<HTMLDivElement | null>; onComplete: () => void;
}) {
  const light = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const stage = editor.current;
    if (!stage) { onComplete(); return; }
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const withLight = !!origin.isNew && !reduced;
    const duration = reduced ? 100 : withLight ? 760 : 220;
    let active = true, completed = false;
    stage.style.visibility = 'visible';
    const stageAnimation = stage.animate(!withLight ? [{opacity:0},{opacity:1}] : [
      {opacity:0,offset:0}, {opacity:0,offset:.2}, {opacity:1,offset:1},
    ], {
      duration, easing:'cubic-bezier(.22,.7,.25,1)', fill:'both',
    });
    const animations: Animation[] = [stageAnimation];
    const fly = light.current;
    if (fly && withLight) {
      fly.style.left = `${origin.x}px`;
      fly.style.top = `${origin.y}px`;
      const content = stage.querySelector<HTMLElement>('.cm-content')?.getBoundingClientRect();
      const targetX = Math.max(36, Math.min(innerWidth - 36, (content?.left ?? innerWidth * .35) + 24));
      const targetY = Math.max(36, Math.min(innerHeight - 36, (content?.top ?? innerHeight * .4) + 32));
      const dx = targetX - origin.x, dy = targetY - origin.y;
      const lift = Math.min(90, Math.max(36, Math.abs(dy) * .2));
      animations.push(fly.animate([
        {transform:'translate3d(0,0,0) scale(1)',opacity:1,offset:0},
        {transform:`translate3d(${dx * .28}px,${dy * .2 - lift}px,0) scale(1.12)`,opacity:1,offset:.34},
        {transform:`translate3d(${dx * .72}px,${dy * .66 - lift * .45}px,0) scale(.7)`,opacity:.9,offset:.7},
        {transform:`translate3d(${dx}px,${dy}px,0) scale(.15)`,opacity:0,offset:1},
      ], {duration,easing:'ease-in-out',fill:'both'}));
    }
    const finish = () => { if(active&&!completed){completed=true;onComplete();} };
    Promise.allSettled(animations.map(animation => animation.finished)).then(finish);
    const key = (event:KeyboardEvent) => { if(event.key==='Escape')finish(); };
    window.addEventListener('keydown',key);
    return () => { active=false;animations.forEach(animation => animation.cancel());stage.style.visibility='';window.removeEventListener('keydown',key); };
  }, [origin,editor,onComplete]);
  return origin.isNew ? <div className="draft-transition" aria-hidden="true"><span ref={light} className="journey-light"><span className="flight-wing left"/><span className="flight-wing right"/><span className="flight-body"/></span></div> : null;
}

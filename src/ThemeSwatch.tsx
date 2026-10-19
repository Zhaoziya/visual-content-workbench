import { Check } from 'lucide-react';
import { type Background, ocean } from './model';
import { resolveAssetUrl } from './assetPath';

export default function ThemeSwatch({background,selected}:{background:Background;selected:boolean}){
  const colors=background.colors??ocean;
  return <span className="template-swatch theme-preview" style={{backgroundColor:background.paper,backgroundImage:background.image?`url(${JSON.stringify(resolveAssetUrl(background.image))})`:'none'}} aria-hidden="true">
    <span className="theme-preview-content">
      <span className="theme-preview-title" style={{color:colors.text}}>Aa</span>
      <span className="theme-preview-line" style={{background:colors.text}}/>
      <span className="theme-preview-line secondary" style={{background:colors.secondary}}/>
      <span className="theme-preview-accents"><i style={{background:colors.accent}}/><i style={{background:colors.highlight}}/><i style={{background:colors.panel,borderColor:colors.border}}/></span>
    </span>
    {selected&&<Check className="theme-selection-mark" size={18} style={{color:colors.text}}/>}
  </span>;
}

import { assetUrl } from './assetPath';

export type Colors = { text: string; secondary: string; accent: string; highlight: string; paper: string; panel: string; border: string };
export type Background = { id: string; name: string; image?: string; paper: string; colors?:Colors };
export type PageSettings = { fontSize:number; spacing:number; overlay:number; lineHeight?:number; header?:string; footer?:string; imageRadius?:number };
export type Draft = {
  version: 1; title: string; subtitle: string; body: string; background: Background; colors: Colors;
  assets: Record<string, string>; fontSize: number; spacing: number; overlay: number; footer: string;
  pageSettings?:Record<number,PageSettings>; header?:string; lineHeight?:number; templateId?:string; colorOpacity?:Partial<Record<keyof Colors,number>>; pageNumbers?:boolean; footerLine?:boolean; headerEnabled?:boolean; footerEnabled?:boolean; imageRadius?:number;
};
export function colorWithOpacity(color:string,opacity=100){const channels=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16));return `rgba(${channels.join(',')},${opacity/100})`;}
export function forPage(draft:Draft,index:number):Draft {
  const settings=draft.pageSettings?.[index];
  return {...draft,lineHeight:draft.lineHeight??1.65,imageRadius:draft.imageRadius??8,...settings,pageNumbers:draft.pageNumbers??true,footerLine:draft.footerLine??true,headerEnabled:draft.headerEnabled??true,footerEnabled:draft.footerEnabled??true,header:settings?.header??draft.header,footer:settings?.footer??draft.footer};
}
export function pageHeader(draft:Draft,_index:number){return draft.header??'VIBE NOTES';}
export const colorRoles: { key: keyof Colors; label: string }[] = [
  { key: 'text', label: '主文字' }, { key: 'secondary', label: '辅助文字' }, { key: 'accent', label: '重点色' },
  { key: 'highlight', label: '强调色' }, { key: 'paper', label: '背景色' }, { key: 'panel', label: '提示框' }, { key: 'border', label: '边框色' },
];
export const ocean: Colors = { text:'#073b67', secondary:'#43758a', accent:'#f15145', highlight:'#ffd64f', paper:'#c9f7f2', panel:'#a9e6e8', border:'#76cbd0' };
export const themes: Background[] = [
  { id:'nordic-fjord',name:'北欧深邃峡湾',paper:'#2c3e50',colors:{paper:'#2c3e50',panel:'#354b60',text:'#ffffff',secondary:'#9fb3c8',accent:'#9fb3c8',highlight:'#5b7b9a',border:'#5b7b9a'} },
  { id:'ocean', name:'海蓝主题', image:assetUrl('assets/poster-background.png'), paper:'#c9f7f2',colors:ocean },
  { id:'minimalist',name:'极简灰度',paper:'#ffffff',colors:{paper:'#ffffff',panel:'#f5f5f7',text:'#1d1d1f',secondary:'#86868b',accent:'#1d1d1f',highlight:'#f5f5f7',border:'#86868b'} },
  { id:'mediterranean',name:'地中海微风',paper:'#ffffff',colors:{paper:'#ffffff',panel:'#edf4fa',text:'#1a5b9c',secondary:'#1a5b9c',accent:'#e87a5d',highlight:'#f4d03f',border:'#1a5b9c'} },
  { id:'cyber',name:'深邃科技',paper:'#0a0e17',colors:{paper:'#0a0e17',panel:'#1f2937',text:'#f5f5f7',secondary:'#a9b7ca',accent:'#3b82f6',highlight:'#10b981',border:'#3b82f6'} },
  { id:'tech-minimalism',name:'极简科技秩序',paper:'#ffffff',colors:{paper:'#ffffff',panel:'#f4f6fa',text:'#1a1c23',secondary:'#8a94a6',accent:'#0055ff',highlight:'#0055ff',border:'#8a94a6'} },
  { id:'neo-brutalism',name:'绝对张力新粗野',paper:'#f4f4f0',colors:{paper:'#f4f4f0',panel:'#f4f4f0',text:'#111111',secondary:'#111111',accent:'#ff3300',highlight:'#ccff00',border:'#111111'} },
  { id:'nostalgia',name:'七十年代怀旧',paper:'#f2e6d8',colors:{paper:'#f2e6d8',panel:'#f2e6d8',text:'#403829',secondary:'#6b7045',accent:'#d97a38',highlight:'#e6b33d',border:'#6b7045'} },
  { id:'bio-organic',name:'科技自然共生',paper:'#f0f5f1',colors:{paper:'#f0f5f1',panel:'#e4eee6',text:'#1e2d24',secondary:'#4a7c59',accent:'#4a7c59',highlight:'#a1c1a5',border:'#a1c1a5'} },
  { id:'earthy',name:'品牌温度感知',paper:'#f4ece6',colors:{paper:'#f4ece6',panel:'#d4c5b9',text:'#2c2a29',secondary:'#6d625b',accent:'#a88b7d',highlight:'#d4c5b9',border:'#a88b7d'} },
  { id:'vintage-reel',name:'复古时光胶卷',paper:'#f1f0ea',colors:{paper:'#f1f0ea',panel:'#f1f0ea',text:'#302b27',secondary:'#4b6056',accent:'#4b6056',highlight:'#eac274',border:'#4b6056'} },
  { id:'vintage-film',name:'复古胶片时光',paper:'#3b413c',colors:{paper:'#3b413c',panel:'#48504a',text:'#f5efeb',secondary:'#e0b56a',accent:'#e0b56a',highlight:'#a85a46',border:'#a85a46'} },
];
export type NoteTemplate = { id:string; name:string; themes:Background[] };
export const templateLibrary:NoteTemplate[]=[{id:'classic',name:'经典图文',themes}];
export const initialDraft: Draft = {
  version:1, title:'用 AI 做前端\n我的实战心得', subtitle:'比奇堡基金助手 · 从页面结构到细节打磨',
  body:'![比奇堡基金助手首页](首页.png)\n\n上一篇分享了作品，这次聊聊它的界面是怎么做出来的。实际做下来，我觉得**明确页面结构、写清视觉规范、提前准备素材**是三个重要的步骤。\n\n---\n\n# 页面结构\n\n先把功能拆成页面和区域，再告诉 AI 用户会怎么操作。\n\n## 以一个数据页面为例\n\n1. **顶部：汇总指标**\n   先看到总体情况，再往下看具体数据。\n2. **中间：数据列表**\n   列表展示主要信息，点击后进入详情。\n3. **详情：突出重要内容**\n   最重要的信息应该占据更大空间。\n\n> 结构不必一开始就细到每个像素，但内容、顺序和操作入口要明确。\n\n# 视觉规范\n\n让 AI 先写一份 Markdown 形式的主题视觉规范。\n\n- **主题与关键词**：海底、宝藏、钱币、气泡。\n- **色彩体系**：主色、辅助色、背景色、涨跌状态色。\n- **文字层级**：标题、正文、辅助文字的字号与字重。\n- **组件风格**：卡片、按钮、表格和弹窗。\n\n# 细节打磨\n\n## 常见问题：对齐和间距\n\n单看一个组件可能没问题，放回完整页面以后就会发现标题和卡片边缘不齐。\n\n```prompt 布局规则\n页面边距统一为 24px。\n同类组件之间采用统一间距。\n新增组件与相邻组件的边缘对齐。\n```\n\n## 与 AI 分工\n\nAI 帮我处理图片、编写组件和补充图标，但*创作者自己的判断*也很重要。\n\n![设计稿 1](设计稿1 .png) ![设计稿 2](设计稿2.png)',
  templateId:'classic',background: themes[0], colors:themes[0].colors!, assets:{}, fontSize:36, spacing:48, overlay:0, footer:'',
};


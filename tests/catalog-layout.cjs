'use strict';
// Browser layout approximation from real WXML/SCSS and explicit fixtures.
// This does not compile WeChat code or constitute device acceptance.
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const componentNames=['app-header','food-thumb','empty-state'];
const components=Object.fromEntries(componentNames.map(n=>[n,read(`miniprogram/components/${n}/index.wxml`)]));
const css=read('miniprogram/app.scss')+read('miniprogram/pages/catalog/index.scss')+componentNames.map(n=>read(`miniprogram/components/${n}/index.scss`)).join('\n');
const template=read('miniprogram/pages/catalog/index.wxml');
async function main(){
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{})});
 const out=path.join(root,'tests/results/catalog-layout');fs.mkdirSync(out,{recursive:true});
 const results=[];
 try{
  for(const width of [320,375,430])for(const selected of [0,1,30]){
   const page=await browser.newPage({viewport:{width,height:812},deviceScaleFactor:1});
   const data={familyName:'家庭点菜',today:'2026-09-11',memberName:'家人',memberInitial:'家',draftCount:selected,pending:false,q:'',categoryNames:['全部分类'],categoryIndex:0,loading:false,nextCursor:null,dishes:[{id:'a',name:'香菇土豆炖鸡块（长菜名布局样例）',categoryName:'荤菜',estimatedMinutes:30,ratingText:'★ 5.0 · 2 条评价',selectedCount:selected,tone:'braise',coverURL:''},{id:'b',name:'酸辣土豆丝',categoryName:'素菜',estimatedMinutes:10,ratingText:'未评价',selectedCount:0,tone:'green',coverURL:''}]};
   await page.setContent('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>');
   await page.evaluate(({template,components,data,css,width})=>{
    const esc=x=>String(x==null?'':x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
    const value=(s,d)=>{try{return Function('d',`with(d){return (${s})}`)(d)}catch{return ''}};
    const expr=(s,d)=>{const full=/^\{\{([^{}]*)\}\}$/.exec(s);return full?value(full[1],d):s.replace(/\{\{([\s\S]*?)\}\}/g,(_,x)=>value(x,d))};
    function render(source,d){const t=document.createElement('template');t.innerHTML=source.replace(/<([\w-]+)([^>]*?)\/>/g,(_,tag,attrs)=>['input','img'].includes(tag)?`<${tag}${attrs}>`:`<${tag}${attrs}></${tag}>`);return children(t.content,d)}
    function children(parent,d){let taken=false;return Array.from(parent.childNodes).map(n=>{
      if(n.nodeType===3)return esc(expr(n.textContent,d));
      if(n.nodeType!==1)return '';
      if(n.hasAttribute('wx:if')){taken=!!expr(n.getAttribute('wx:if'),d);if(!taken)return ''}
      else if(n.hasAttribute('wx:else')){if(taken)return '';taken=true}
      else if(n.hasAttribute('wx:elif')){if(taken)return '';taken=!!expr(n.getAttribute('wx:elif'),d);if(!taken)return ''}
      else taken=false;
      return node(n,d);
    }).join('')}
    function node(n,d,loop=false){
     if(n.hasAttribute('wx:for')&&!loop){const items=expr(n.getAttribute('wx:for'),d)||[];return Array.from(items).map((item,index)=>node(n,{...d,[n.getAttribute('wx:for-item')||'item']:item,[n.getAttribute('wx:for-index')||'index']:index},true)).join('')}
     let tag=n.tagName.toLowerCase();
     if(components[tag]){const props={...d,failed:false,large:false};for(const a of n.attributes){const key=Object.keys(props).find(k=>k.toLowerCase()===a.name)||a.name;props[key]=expr(a.value,d)}return render(components[tag],props)}
     if(tag==='block'||tag==='slot')return children(n,d);
     tag=({view:'div',text:'span',image:'img',picker:'div'})[tag]||tag;
     let attrs='';for(const a of n.attributes){if(a.name.startsWith('wx:')||a.name.startsWith('bind')||a.name.startsWith('catch'))continue;const v=expr(a.value,d);if(a.name==='disabled'&&!v)continue;attrs+=` ${a.name}="${esc(v)}"`}
     return `<${tag}${attrs}>${children(n,d)}</${tag}>`;
    }
    const style=document.createElement('style');style.textContent='html,body{margin:0}div,span,button,input,textarea,img{box-sizing:border-box}span{overflow-wrap:anywhere}button{font-family:inherit;border:0;cursor:pointer}input{border:0;background:none;font-family:inherit}'+css.replace(/(^|\n)page\s*\{/g,'$1body {').replace(/([\d.]+)rpx/g,(_,v)=>Number(v)*width/750+'px');document.head.append(style);document.body.innerHTML=render(template,data);
   },{template,components,data,css,width});
   const defects=await page.evaluate(()=>Array.from(document.querySelectorAll('.checkout,.dish-row,button')).filter(el=>{const r=el.getBoundingClientRect();return r.width>0&&(r.left< -1||r.right>innerWidth+1)}).map(el=>({className:el.className,text:el.textContent.trim()})));
   assert.deepEqual(defects,[],`width=${width}, selected=${selected}`);
   if(selected)assert.equal(await page.locator('.checkout-go').isVisible(),true);
   await page.screenshot({path:path.join(out,`catalog-${width}-${selected}.png`),fullPage:true});
   results.push({width,selected,status:'passed'});await page.close();
  }
 }finally{await browser.close()}
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({kind:'WXML/CSS browser approximation, not WeChat runtime',results},null,2));
 console.log(`Catalog layout: ${results.length} fixture/width combinations passed`);
}
main().catch(e=>{console.error(e);process.exitCode=1});

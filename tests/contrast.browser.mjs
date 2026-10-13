// Optional Playwright/Chromium audit. Fictional data; no provider requests.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {createApp} from '../server.mjs';
const {chromium}=createRequire(import.meta.url)('playwright');
const out=process.env.MFH_AUDIT_DIR||'/tmp/mfh-contrast';
await mkdir(out,{recursive:true});
const results=[],errors=[];let calls=0;
const app=createApp({root:process.env.MFH_APP_ROOT,initialConfig:{provider:'openai',apiKey:'DUMMY-LOCAL-TEST',model:'fake'},fetchImpl:async()=>{calls++;throw Error('No provider calls allowed')}});
await new Promise(r=>app.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.MFH_CHROMIUM_PATH||'/usr/bin/chromium'});
const saved=p=>p.waitForFunction(()=>document.querySelector('#saveStatus').textContent===MFH_LOCALES[document.querySelector('#language').value].saved);
function installAudit(){
  const rgb=s=>{const n=s.match(/[\d.]+/g)?.map(Number);return n?.length>=3?[...n.slice(0,3),n[3]??1]:[0,0,0,0]};
  const over=(a,b)=>a.slice(0,3).map((v,i)=>v*a[3]+b[i]*(1-a[3]));
  const bg=e=>!e?[255,255,255]:over(rgb(getComputedStyle(e).backgroundColor),bg(e.parentElement));
  const luminance=c=>c.map(x=>x/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
  const ratio=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
  const name=e=>e.id?'#'+e.id:e.tagName.toLowerCase()+(e.dataset.action?'[data-action='+e.dataset.action+']':e.dataset.i18n?'[data-i18n='+e.dataset.i18n+']':e.className?'.'+String(e.className).trim().replace(/\s+/g,'.'):'');
  const visible=e=>e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})&&!e.closest('[hidden],:disabled,[aria-hidden="true"]');
  function sample(e,pseudo=null){
    const s=getComputedStyle(e,pseudo),back=bg(e);let opacity=Number(s.opacity);
    for(let a=pseudo?e:e.parentElement;a;a=a.parentElement)opacity*=Number(getComputedStyle(a).opacity);
    const raw=rgb(s.color);raw[3]*=opacity;const front=over(raw,back);
    const threshold=parseFloat(s.fontSize)>=24||(parseFloat(s.fontSize)>=18.6667&&parseInt(s.fontWeight)>=700)?3:4.5;
    return {element:name(e)+(pseudo||''),color:s.color,background:back,opacity,fontSize:s.fontSize,fontWeight:s.fontWeight,ratio:ratio(front,back),threshold};
  }
  window.auditText=(root=document.body)=>{
    const list=[];
    for(const e of [root,...root.querySelectorAll('*')]){
      if(!visible(e)||e.matches('script,style,option'))continue;
      if([...e.childNodes].some(n=>n.nodeType===Node.TEXT_NODE&&n.textContent.trim())||e.matches('input:not([type=checkbox]):not([type=radio]),textarea,select'))list.push(sample(e));
      if(e.matches('[placeholder]')&&e.getAttribute('placeholder'))list.push(sample(e,'::placeholder'));
    }
    return list;
  };
  window.auditFocus=e=>{const s=getComputedStyle(e),back=bg(parseFloat(s.outlineOffset)<0?e:e.parentElement);return {element:name(e),focused:e===document.activeElement,focusVisible:e.matches(':focus-visible'),outline:s.outlineStyle,outlineWidth:parseFloat(s.outlineWidth),offset:s.outlineOffset,color:s.outlineColor,background:back,ratio:ratio(over(rgb(s.outlineColor),back),back),threshold:3}};
}
async function audit(p,label,lang,width){
  await p.mouse.move(0,0);
  const scope=await p.locator('dialog[open]').count()?'dialog[open]':'body';
  const base=await p.locator(scope).evaluate(e=>auditText(e));
  results.push(...base.map(x=>({...x,label,lang,width,state:'default',kind:'text'})));
  assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),label+' horizontal overflow');
  const controls=p.locator(scope).locator('button:visible:not(:disabled),input:visible:not(:disabled),textarea:visible,select:visible,summary:visible,a:visible');
  for(let i=0;i<await controls.count();i++){
    const e=controls.nth(i);
    // Check enabled controls; a radio group has one sequential Tab stop.
    const eligible=await e.evaluate(e=>!e.matches('.skip-link,input[type=radio]:not(:checked)'));
    if(!eligible)continue;
    await e.hover();
    results.push(...(await e.evaluate(e=>auditText(e))).map(x=>({...x,label,lang,width,state:'hover',kind:'text'})));
    await e.focus();await p.keyboard.press('Tab');await p.keyboard.press('Shift+Tab');
    const f=await e.evaluate(e=>auditFocus(e));results.push({...f,label,lang,width,state:'focus+hover',kind:'focus'});
    await p.mouse.move(0,0);
    results.push({...await e.evaluate(e=>auditFocus(e)),label,lang,width,state:'focus',kind:'focus'});
  }
}
try{
  for(const lang of (process.env.MFH_LANGS||'zh,en,es').split(','))for(const width of (process.env.MFH_WIDTHS||'320,390,1440').split(',').map(Number)){
    const c=await browser.newContext({locale:lang,viewport:{width,height:900},reducedMotion:'reduce'}),p=await c.newPage();
    p.on('pageerror',e=>errors.push(e.message));await p.addInitScript(installAudit);
    await p.goto('http://127.0.0.1:'+app.address().port);await saved(p);
    const fixture=await p.evaluate(lang=>{const x=MFHCore.newProject(lang);x.title='Fictional book';x.person='Fictional narrator';x.chapters=[{id:MFHCore.uuid(),title:'Fictional chapter',content:'Fictional paragraph for contrast testing.',approved:false,origin:'manual'}];x.activeChapter=x.chapters[0].id;x.answers=[{id:MFHCore.uuid(),sourceId:'A1',question:'Fictional question',answer:'Fictional answer',include:true}];return x},lang);
    await p.locator('#backupFile').setInputFiles({name:'fictional.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture))});
    await p.waitForFunction(()=>document.querySelector('#bookTitle').value==='Fictional book');await saved(p);
    // Hide no UI: expand actual settings and audit the rendered surfaces.
    await p.locator('#bookSettings>summary').click();await audit(p,'book',lang,width);
    await p.locator('#deskChapterList button').hover();await p.screenshot({path:`${out}/${lang}-${width}-directory-hover.png`,fullPage:true});await p.locator('#bookTitle').focus();await p.screenshot({path:`${out}/${lang}-${width}-cover.png`,fullPage:true});
    await p.click('.steps [data-step="1"]');await p.locator('#interviewTools>summary').click();await audit(p,'interview',lang,width);
    await p.click('#archiveTab');await audit(p,'archive',lang,width);
    await p.click('.steps [data-step="2"]');await p.locator('#chapterComposer>summary').click();await p.locator('.other-methods>summary').click();await audit(p,'writing',lang,width);
    await p.locator('#chapterText').focus();await p.screenshot({path:`${out}/${lang}-${width}-writing.png`,fullPage:true});
    await p.click('#focusChapterButton');await audit(p,'focus-dialog',lang,width);await p.locator('#chapterText').focus();await p.screenshot({path:`${out}/${lang}-${width}-focus.png`,fullPage:true});await p.keyboard.press('Escape');
    await p.click('#chapterFinderButton');await audit(p,'finder',lang,width);await p.keyboard.press('Escape');
    await p.click('.steps [data-step="3"]');await audit(p,'export',lang,width);
    await p.locator('#workspaceTools>summary').click();await p.locator('#workspaceTools [data-action=help]').click();await audit(p,'help',lang,width);
    await p.locator('#workspaceTools>summary').click();await p.locator('#workspaceTools [data-action=handoff]').click();await audit(p,'handoff',lang,width);
    await p.locator('#workspaceTools>summary').click();await p.locator('#workspaceTools [data-action=connect]').click();await audit(p,'connection',lang,width);await p.keyboard.press('Escape');
    await c.close();console.log('AUDITED',lang,width);
  }
  const failures=results.filter(x=>x.ratio<x.threshold||(x.kind==='focus'&&(!x.focused||!x.focusVisible||x.outline==='none'||x.outlineWidth<2)));
  await writeFile(out+'/results.json',JSON.stringify({results,failures,errors,providerCalls:calls},null,2));
  console.log('MEASUREMENTS',results.length,'FAILURES',failures.length);
  assert.deepEqual(errors,[]);assert.equal(calls,0);assert.equal(failures.length,0,'contrast/focus failures; see results.json');
}finally{await browser.close();app.closeAllConnections();await new Promise(r=>app.close(r))}

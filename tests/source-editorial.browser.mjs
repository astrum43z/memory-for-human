// Style-only regression; MFH_APP_ROOT can select a combined preview with PR5.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createApp} from '../server.mjs';
const {chromium}=createRequire(import.meta.url)('playwright'),C=globalThis.MFHCore;
let calls=0;const errors=[],posts=[];
const app=createApp({...(process.env.MFH_APP_ROOT?{root:process.env.MFH_APP_ROOT}:{}),fetchImpl:async()=>{calls++;throw Error('No provider');}});
await new Promise(r=>app.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium'});
async function data(p){return p.evaluate(async()=>{const db=await new Promise(r=>{const q=indexedDB.open('memory-for-human',1);q.onsuccess=()=>r(q.result)});const x=await new Promise(r=>{const q=db.transaction('projects').objectStore('projects').get(localStorage.getItem('mfh-active'));q.onsuccess=()=>r(q.result)});db.close();return x;});}
try{for(const lang of ['zh','en','es'])for(const width of [320,390,1440])for(const reduced of [false,true]){
 const ctx=await browser.newContext({locale:lang==='zh'?'zh-CN':lang,viewport:{width,height:900},reducedMotion:reduced?'reduce':'no-preference'}),p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(r.method()==='POST'||!new URL(r.url()).hostname.match(/^(127\.0\.0\.1|localhost)$/))posts.push(r.url());});
 await p.goto(`http://127.0.0.1:${app.address().port}`);
 const x=C.newProject(lang);x.title='Fictional sources layout';x.answers=[{id:C.uuid(),sourceId:'A1',question:'Fictional memory / 虚构回忆 / Recuerdo ficticio',answer:'Only fictional words.',include:true,date:''},{id:C.uuid(),sourceId:'A2',question:'An excluded fictional memory',answer:'Excluded fictional words.',include:false,date:''}];x.materials=[{id:C.uuid(),sourceId:'M1',name:'Fictional material / 虚构材料 / Material ficticio',content:('Fictional café beside the river. 虚构的回忆。\n\n').repeat(50)+'deep-marker <img src=x onerror=alert(1)>',include:false}];
 await p.locator('#backupFile').setInputFiles({name:'fictional.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(x))});await p.waitForFunction(()=>document.querySelector('#bookTitle').value==='Fictional sources layout');await p.click('[data-step="1"]');
 const initial=await data(p),search=await p.locator('#sourceSearch').count()>0;
 assert(await p.locator('.editorial-sources').isVisible());
 assert.equal(await p.locator('.editorial-sources').evaluate(e=>getComputedStyle(e).borderTopWidth),'0px');
 if(search){
  await p.fill('#sourceSearch','deep-marker');assert.equal(await p.locator('.source-record').count(),1);
  const summary=p.locator('#materials summary');await summary.focus();await p.keyboard.press('Enter');await p.waitForFunction(()=>document.querySelector('#materials .source-content').textContent.includes('deep-marker'));
  await p.keyboard.press('Tab');assert(await p.locator('#materials input').evaluate(e=>e===document.activeElement));assert(!await p.locator('#materials input').isChecked());
  const paragraph=p.locator('#materials .source-content');assert.equal(await paragraph.innerText(),x.materials[0].content);
  assert(await paragraph.evaluate(e=>e.getBoundingClientRect().width<=660.5&&parseFloat(getComputedStyle(e).fontSize)>=18));assert.equal(await p.locator('#materials img').count(),0);
  assert.equal(await p.locator('#materials .source-inclusion').innerText(),await p.evaluate(()=>window.MFH_LOCALES[document.querySelector('#language').value].sourceExcluded));
  assert(await p.locator('#materials .source-id').isVisible());
  if(reduced)assert.equal(await p.locator('#materials .source-body').evaluate(e=>getComputedStyle(e).animationName),'none');
  await summary.focus();await p.keyboard.press('Space');await p.waitForFunction(()=>!document.querySelector('#materials details').open);
  await p.fill('#sourceSearch','no-matching-fiction');assert.equal(await p.locator('.source-record').count(),0);assert(await p.locator('#materials .empty').isVisible());
  await p.locator('#clearSourceSearch').focus();await p.keyboard.press('Enter');assert(await p.locator('#sourceSearch').evaluate(e=>e===document.activeElement));assert.equal(await p.locator('.source-record').count(),3);
  await p.locator('#materials summary').click();
 }
 for(const choice of await p.locator('.editorial-sources .material-choice').all())if(await choice.isVisible()){
  assert((await choice.boundingBox()).height>=48);assert(await choice.locator('input').evaluate(e=>e.getBoundingClientRect().width>=20));
 }
 for(const btn of await p.locator('.editorial-sources button').all())if(await btn.isVisible())assert((await btn.boundingBox()).height>=44);
 assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 const unchanged=await data(p);assert.deepEqual(unchanged.answers,initial.answers);assert.deepEqual(unchanged.materials,initial.materials);assert.deepEqual(C.context(unchanged),C.context(initial));
 // Explicit choice still uses the original control and persistence path.
 await p.locator('#materials input[type="checkbox"]').check();await p.waitForFunction(async()=>{const db=await new Promise(r=>{const q=indexedDB.open('memory-for-human',1);q.onsuccess=()=>r(q.result)});const x=await new Promise(r=>{const q=db.transaction('projects').objectStore('projects').get(localStorage.getItem('mfh-active'));q.onsuccess=()=>r(q.result)});db.close();return x.materials[0].include;});
 assert((await data(p)).materials[0].include);await p.locator('#materials input[type="checkbox"]').uncheck();
 await p.locator('.sidebar [data-action="new"]').click();await p.waitForFunction(()=>document.querySelector('#bookTitle').value==='');await p.click('[data-step="1"]');assert(await p.locator('#materials .empty').isVisible());assert.equal(await p.locator('#materials input').count(),0);
 await ctx.close();console.log(`PASS ${lang} ${width}px reduced=${reduced}, PR5=${search}: typography, long text, controls, search/focus, empty state, unchanged context and explicit selection`);
}assert.equal(calls,0);assert.deepEqual(posts,[]);assert.deepEqual(errors,[]);console.log('PASS 18 style scenarios; zero API POSTs/external requests/provider calls/page errors.');}finally{await browser.close();await new Promise(r=>{app.close(r);app.closeAllConnections();});}

// Optional style/semantic regression; MFH_APP_ROOT selects a combined PR6 preview.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,readFile} from 'node:fs/promises';
import {createApp} from '../server.mjs';
const {chromium}=createRequire(import.meta.url)('playwright'),C=globalThis.MFHCore;
let calls=0;const errors=[],requests=[],output=process.env.MFH_SCREENSHOT_DIR;if(output)await mkdir(output,{recursive:true});
const app=createApp({...(process.env.MFH_APP_ROOT?{root:process.env.MFH_APP_ROOT}:{}),fetchImpl:async()=>{calls++;throw Error('No provider');}});await new Promise(r=>app.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium'});
const saved=p=>p.waitForFunction(()=>document.querySelector('#saveStatus').textContent===window.MFH_LOCALES[document.querySelector('#language').value].saved);
async function file(p,action){const event=p.waitForEvent('download');await p.locator(`[data-panel="3"] [data-action="${action}"]`).click();return readFile(await(await event).path(),'utf8');}
try{for(const lang of ['zh','en','es'])for(const width of [320,390,1440])for(const reduced of [false,true]){
 const ctx=await browser.newContext({locale:lang==='zh'?'zh-CN':lang,viewport:{width,height:900},reducedMotion:reduced?'reduce':'no-preference'}),p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(r.method()==='POST'||!new URL(r.url()).hostname.match(/^(127\.0\.0\.1|localhost)$/))requests.push(r.url());});
 await p.goto(`http://127.0.0.1:${app.address().port}`);await saved(p);
 const x=C.newProject(lang);x.title=('Fictional delivery / 虚构交付 / Entrega ficticia · ').repeat(3);x.workingAnswer='UNFINISHED-FICTION';x.answers=[{id:C.uuid(),sourceId:'A1',question:'Fictional question',answer:'ANSWER-FICTION',include:false,date:''}];x.materials=[{id:C.uuid(),sourceId:'M1',name:'Fictional material',content:'MATERIAL-FICTION',include:false}];x.chapters=Array.from({length:12},(_,i)=>({id:C.uuid(),title:('Fictional long chapter / 虚构长章节 / Capítulo ficticio · ').repeat(i===3?5:1)+i,content:`CHAPTER-FICTION-${i}`,approved:i<4,origin:'manual'}));x.activeChapter=x.chapters[0].id;
 await p.locator('#backupFile').setInputFiles({name:'fictional.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(x))});await p.waitForFunction(title=>document.querySelector('#bookTitle').value===title,x.title);await saved(p);await p.click('[data-step="3"]');
 const overview=await p.locator('#exportOverview').count()>0;
 assert.equal(await p.locator('.editorial-export').evaluate(e=>getComputedStyle(e).borderTopWidth),'0px');
 if(overview){
  assert.equal(await p.locator('#exportCounts').innerText(),await p.evaluate(()=>window.MFH_LOCALES[document.querySelector('#language').value].exportCounts.replace('{total}',12).replace('{reviewed}',4).replace('{drafts}',8)));
  assert.equal(await p.locator('#exportReviewNote').innerText(),await p.evaluate(()=>window.MFH_LOCALES[document.querySelector('#language').value].exportDraftNote));assert(await p.locator('#exportReviewNote').isVisible());assert(await p.locator('.manuscript-scope').isVisible());
  await p.locator('#exportDirectory summary').focus();await p.keyboard.press('Enter');assert.equal(await p.locator('#exportChapterList li').count(),12);
  await p.locator('#exportChapterList button').first().focus();await p.keyboard.press('Enter');assert(await p.locator('#chapterEditor').evaluate(e=>e===document.activeElement));assert.equal(await p.locator('#chapterText').inputValue(),x.chapters[4].content);
  if(await p.locator('#focusChapterButton').count()){
   await p.locator('#focusChapterButton').focus();await p.keyboard.press('Enter');assert.equal(await p.locator('#chapterText').count(),1);await p.fill('#chapterText',x.chapters[4].content+' EDITED');await saved(p);
   await p.evaluate(()=>{window.closedFocus=new Promise(r=>document.querySelector('#chapterFocusDialog').addEventListener('close',()=>r(),{once:true}));});await p.keyboard.press('Escape');await p.evaluate(()=>window.closedFocus);assert(await p.locator('#focusChapterButton').evaluate(e=>e===document.activeElement));x.chapters[4].content+=' EDITED';
  }
  await p.locator('#returnToExport').click();assert(await p.locator('#exportOverview').evaluate(e=>e===document.activeElement));
 }
 const backup=JSON.parse(await file(p,'backup'));assert.equal(backup.workingAnswer,x.workingAnswer);assert.equal(backup.answers[0].answer,'ANSWER-FICTION');assert.equal(backup.materials[0].content,'MATERIAL-FICTION');assert.equal(backup.materials[0].include,false);assert.deepEqual(backup.chapters.map(c=>c.approved),x.chapters.map(c=>c.approved));
 const markdown=await file(p,'exportMD');assert.equal(markdown,await p.evaluate(data=>window.MFHCore.markdown(data,window.MFH_LOCALES[document.querySelector('#language').value]),backup));for(const c of x.chapters)assert(markdown.includes(c.content));for(const text of ['UNFINISHED-FICTION','ANSWER-FICTION','MATERIAL-FICTION'])assert(!markdown.includes(text));
 for(const button of await p.locator('.editorial-export button').all())if(await button.isVisible()){assert((await button.boundingBox()).height>=44);assert(!await button.isDisabled());}
 assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 // Unsaved content remains downloadable; visual layout must not hide failure/recovery.
 await p.click('[data-step="2"]');await p.selectOption('#chapters',backup.chapters[0].id);
 await p.evaluate(()=>{window.failWrites=true;const original=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(stores,mode,...args){if(mode==='readwrite'&&window.failWrites)throw Error('Synthetic failure');return original.call(this,stores,mode,...args);};});
 await p.fill('#chapterText','UNSAVED-FICTION');await p.waitForFunction(()=>document.querySelector('#saveStatus').textContent===window.MFH_LOCALES[document.querySelector('#language').value].saveFailed);await p.click('[data-step="3"]');
 if(await p.locator('#saveRecovery').count())assert(await p.locator('#saveRecovery').isVisible());assert.equal(JSON.parse(await file(p,'backup')).chapters[0].content,'UNSAVED-FICTION');assert((await file(p,'exportMD')).includes('UNSAVED-FICTION'));
 if(output&&width===390&&!reduced){await p.locator('#toast').waitFor({state:'hidden'});await p.locator('#main').evaluate(e=>e.scrollIntoView({block:'start'}));await p.screenshot({path:`${output}/failure-${lang}.png`});}
 await p.evaluate(()=>window.failWrites=false);if(await p.locator('#retrySave').count())await p.locator('#retrySave').click();else{await p.click('[data-step="2"]');await p.fill('#chapterText','RECOVERED-FICTION');}await saved(p);
 await p.locator('.sidebar [data-action="new"]').click();await p.waitForFunction(()=>document.querySelector('#bookTitle').value==='');await p.click('[data-step="3"]');const empty=JSON.parse(await file(p,'backup'));assert.equal(empty.chapters.length,0);
 if(overview){assert(await p.locator('#exportDirectory').isHidden());assert(await p.locator('#exportReviewNote').isVisible());assert.equal(await p.locator('#exportOverview').getAttribute('data-state'),'empty');}
 if(output&&width===390&&!reduced){await p.locator('#toast').waitFor({state:'hidden'});await p.locator('[data-panel="3"]').evaluate(e=>e.scrollIntoView({block:'start'}));await p.screenshot({path:`${output}/empty-${lang}.png`});}
 await ctx.close();console.log(`PASS ${lang} ${width}px reduced=${reduced}, PR6=${overview}: draft/full export distinction, long titles, keyboard return/focus, failure/current backup/recovery and empty state`);
}assert.equal(calls,0);assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);console.log('PASS 18 scenarios; zero API POSTs/external requests/provider calls/page errors.');}finally{await browser.close();await new Promise(r=>{app.close(r);app.closeAllConnections();});}

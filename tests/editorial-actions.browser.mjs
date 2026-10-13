import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {createApp} from '../server.mjs';
const {chromium}=createRequire(import.meta.url)('playwright'),C=globalThis.MFHCore;
const errors=[],posts=[];let calls=0;
const app=createApp({...(process.env.MFH_APP_ROOT?{root:process.env.MFH_APP_ROOT}:{}),fetchImpl:async()=>{calls++;throw Error('No provider');}});
await new Promise(r=>app.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium'});
const saved=p=>p.waitForFunction(()=>document.querySelector('#saveStatus').textContent===window.MFH_LOCALES[document.querySelector('#language').value].saved);
try{
 for(const lang of ['zh','en','es'])for(const width of [320,1440])for(const reduced of [false,true]){
  const context=await browser.newContext({locale:lang==='zh'?'zh-CN':lang,viewport:{width,height:900},reducedMotion:reduced?'reduce':'no-preference'}),p=await context.newPage();
  p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(r.method()==='POST')posts.push(r.url());});
  await p.goto(`http://127.0.0.1:${app.address().port}`);await saved(p);
  const fixture=C.newProject(lang);fixture.title='Fictional actions check';fixture.chapters=[{id:C.uuid(),title:'Fictional existing chapter',content:'Fictional text to preserve.',origin:'manual',approved:false}];fixture.activeChapter=fixture.chapters[0].id;
  await p.locator('#backupFile').setInputFiles({name:'fictional.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture))});await p.waitForFunction(()=>document.querySelector('#bookTitle').value==='Fictional actions check');await p.click('[data-step="2"]');
  assert(!await p.locator('#chapterComposer').evaluate(e=>e.open));assert(await p.locator('[data-action="reviewAI"]').isVisible());
  const notice=p.locator('#chapterEditor [data-i18n="sendNotice"]');
  const visibleNotice=await notice.count()>0&&await notice.isVisible();
  await p.locator('[data-action="newChapter"]').focus();await p.keyboard.press('Enter');
  const opened=await p.locator('#chapterComposer').evaluate(e=>e.open),focused=await p.locator('#nextChapterTitle').evaluate(e=>e===document.activeElement);
  if(process.env.MFH_EXPECT_OLD){console.log(JSON.stringify({lang,width,reduced,visibleNotice,opened,focused}));assert.equal(visibleNotice,false);assert.equal(opened,false);assert.equal(focused,false);await context.close();continue;}
  assert(visibleNotice,'Review disclosure must be visible before invoking AI');assert(opened,'New chapter must expand its target');assert(focused,'New chapter must focus the visible title input');
  assert.equal(await p.locator('[data-action="reviewAI"]').getAttribute('aria-describedby'),'reviewSendNotice');
  assert(await notice.evaluate(e=>e.textContent===window.MFH_LOCALES[document.querySelector('#language').value].sendNotice));
  assert.equal(await p.locator('#chapterText').inputValue(),fixture.chapters[0].content);
  await p.fill('#nextChapterTitle','Fictional next title');await p.locator('#chapterComposer>summary').click();await p.locator('[data-action="newChapter"]').click();assert.equal(await p.locator('#nextChapterTitle').inputValue(),'');assert(await p.locator('#nextChapterTitle').isVisible());
  await p.locator('#chapterComposer>summary').click();assert(await notice.isVisible());
  await p.locator('[data-action="reviewAI"]').focus();await p.keyboard.press('Enter');assert(await notice.isVisible());
  await p.click('[data-step="1"]');await p.click('[data-step="2"]');assert(await notice.isVisible());
  await p.fill('#chapterText','Fictional updated text retained.');await saved(p);
  await p.evaluate(()=>{window.failWrites=true;const original=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(stores,mode,...args){if(mode==='readwrite'&&window.failWrites)throw Error('Synthetic failure');return original.call(this,stores,mode,...args);};});
  await p.fill('#chapterText','Fictional unsaved text retained.');await p.waitForFunction(()=>document.querySelector('#saveStatus').textContent===window.MFH_LOCALES[document.querySelector('#language').value].saveFailed);
  await p.locator('[data-action="newChapter"]').click();assert.equal(await p.locator('#chapterText').inputValue(),'Fictional unsaved text retained.');assert(await notice.isVisible());
  await p.evaluate(()=>window.failWrites=false);
  if(await p.locator('#retrySave').count())await p.locator('#retrySave').click();else await p.fill('#chapterText','Fictional unsaved text retained. Recovered.');
  await saved(p);const text=await p.locator('#chapterText').inputValue();
  await p.click('[data-step="3"]');const download=p.waitForEvent('download');await p.locator('[data-panel="3"] [data-action="backup"]').click();const data=JSON.parse(await readFile(await(await download).path(),'utf8'));assert.equal(data.chapters.length,1);assert.equal(data.chapters[0].content,text);assert.equal(data.chapters[0].title,fixture.chapters[0].title);
  await p.reload();await saved(p);await p.click('[data-step="2"]');assert.equal(await p.locator('#chapterText').inputValue(),text);assert(await notice.isVisible());
  await p.click('[data-action="new"]');await p.waitForFunction(()=>document.querySelector('#bookTitle').value==='');await p.click('[data-step="2"]');assert(await p.locator('#chapterComposer').evaluate(e=>e.open));await p.locator('[data-action="newChapter"]').focus();await p.keyboard.press('Enter');assert(await p.locator('#nextChapterTitle').evaluate(e=>e===document.activeElement));assert(await p.locator('.composer-content [data-i18n="sendNotice"]').isVisible());assert(!await p.locator('[data-action="reviewAI"]').isVisible());
  assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await context.close();console.log(`PASS ${lang} ${width}px reduced=${reduced}: existing/empty, keyboard/click, visible review disclosure, return, failure recovery and reload`);
 }
 assert.equal(calls,0);assert.deepEqual(posts,[]);assert.deepEqual(errors,[]);console.log('PASS 12 scenarios; zero API POSTs/provider calls/page errors.');
}finally{await browser.close();await new Promise(r=>{app.close(r);app.closeAllConnections();});}

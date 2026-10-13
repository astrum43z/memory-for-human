// Optional real-browser regression: complete long questions remain inside the page.
// Run with installed Playwright/Chromium; MFH_APP_ROOT can reproduce on an older tree.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {createApp} from '../server.mjs';
const {chromium}=createRequire(import.meta.url)('playwright'),C=globalThis.MFHCore;
let calls=0;const errors=[],requests=[],app=createApp({...(process.env.MFH_APP_ROOT?{root:process.env.MFH_APP_ROOT}:{}),fetchImpl:async()=>{calls++;throw Error('No provider calls');}});
await new Promise(r=>app.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.MFH_CHROMIUM_PATH||'/usr/bin/chromium'});
const saved=p=>p.waitForFunction(()=>document.querySelector('#saveStatus').textContent===window.MFH_LOCALES[document.querySelector('#language').value].saved);
const words={zh:['你还记得河边的旧书店吗？','那天下午，我和姐姐沿着河边慢慢走。'],en:['Do you remember the old bookshop by the river?','That afternoon my sister and I walked beside the river.'],es:['¿Recuerdas la antigua librería junto al río?','Aquella tarde mi hermana y yo caminamos junto al río.']};
try {
 for(const lang of ['zh','en','es'])for(const width of [320,390,1440])for(const reduced of [false,true]){
  const context=await browser.newContext({locale:lang==='zh'?'zh-CN':lang,viewport:{width,height:900},reducedMotion:reduced?'reduce':'no-preference'}),p=await context.newPage();
  p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(r.method()==='POST'||new URL(r.url()).hostname!=='127.0.0.1')requests.push(r.url());});
  await p.goto(`http://127.0.0.1:${app.address().port}`);await saved(p);
  const x=C.newProject(lang);x.title='Fictional interview';x.aiQuestion=words[lang][0]+' '+('ArchiveReference0123456789'.repeat(14))+' '+words[lang][0].repeat(3);x.workingAnswer=words[lang][1].repeat(60);
  await p.locator('#backupFile').setInputFiles({name:'fictional.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(x))});await p.waitForFunction(title=>document.querySelector('#bookTitle').value===title,x.title);await saved(p);await p.click('[data-step="1"]');
  assert.equal(await p.locator('#language').inputValue(),lang);assert.equal(await p.locator('#questionText').innerText(),x.aiQuestion);assert.equal(await p.locator('#answer').inputValue(),x.workingAnswer);
  const dimensions=await p.locator('#questionText').evaluate(e=>({width:e.clientWidth,scroll:e.scrollWidth,page:document.documentElement.scrollWidth,viewport:innerWidth}));assert(dimensions.scroll<=dimensions.width+1,JSON.stringify(dimensions));assert(dimensions.page<=dimensions.viewport+1,JSON.stringify(dimensions));
  // Keyboard order and a visible input focus indicator stay intact.
  await p.locator('#answer').focus();assert.notEqual(await p.locator('#answer').evaluate(e=>getComputedStyle(e).outlineStyle),'none');await p.keyboard.press('Tab');assert.equal(await p.evaluate(()=>document.activeElement.dataset.action),'saveAnswer');await p.keyboard.press('Tab');assert.equal(await p.evaluate(()=>document.activeElement.dataset.action),'skip');await p.keyboard.press('Enter');
  await p.locator('#interviewDraftDialog').waitFor();assert.equal(await p.locator('#interviewDraftQuestion').innerText(),x.aiQuestion);await p.keyboard.press('Escape');await p.waitForFunction(()=>!document.querySelector('#interviewDraftDialog').open);assert.equal(await p.locator('#answer').inputValue(),x.workingAnswer);assert.equal(await p.locator('#questionText').innerText(),x.aiQuestion);
  // A rapid repeated trigger must not save twice or replace the original question.
  await p.evaluate(()=>{document.querySelector('[data-action="skip"]').click();document.querySelector('[data-action="skip"]').click();});await p.locator('#interviewDraftDialog').waitFor();await p.locator('#keepInterviewDraft').focus();await p.keyboard.press('Enter');await p.waitForFunction(()=>!document.querySelector('#interviewDraftDialog').open);
  await p.locator('[data-action="skip"]').click();await p.locator('#interviewDraftDialog').waitFor();await p.evaluate(()=>{document.querySelector('#saveInterviewDraft').click();document.querySelector('#saveInterviewDraft').click();});await p.waitForFunction(()=>!document.querySelector('#interviewDraftDialog').open);await saved(p);assert.equal(await p.locator('#answer').inputValue(),'');
  await p.click('[data-step="3"]');const download=p.waitForEvent('download');await p.locator('[data-panel="3"] [data-action="backup"]').click();const data=JSON.parse(await readFile(await(await download).path(),'utf8'));assert.equal(data.answers.length,1);assert.equal(data.answers[0].question,x.aiQuestion);assert.equal(data.answers[0].answer,x.workingAnswer);assert.equal(data.answers[0].include,true);assert.equal(data.questionIndex,1);
  await p.reload();await p.click('[data-step="1"]');assert.equal(await p.locator('#answer').inputValue(),'');assert.notEqual(await p.locator('#questionText').innerText(),x.aiQuestion);
  console.log(`PASS ${lang} ${width}px reduced=${reduced}: full long question/answer, no overflow, keyboard, cancellation, rapid repeated save, backup and reload`);await context.close();
 }
 assert.equal(calls,0);assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);console.log('PASS 18 scenarios; zero provider calls, API POSTs, external requests and page errors.');
} finally {await browser.close();await new Promise(r=>{app.close(r);app.closeAllConnections();});}

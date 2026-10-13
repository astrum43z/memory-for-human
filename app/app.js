(async function () {
  'use strict';
  const C = window.MFHCore, locales = window.MFH_LOCALES, questions = window.MFH_QUESTIONS;
  const $ = id => document.getElementById(id);
  new MutationObserver(() => { $('writingSaveStatus').textContent = $('saveStatus').textContent; }).observe($('saveStatus'), {childList:true, characterData:true, subtree:true});
  let lang = 'zh', project, db, projects = [], step = 0, mode = 'workspace', faq = 0, token = '', connection = null, connectionVersion = 0, busy = false, editingAnswer = '', recognition = null, toastTimer;
  try { lang = localStorage.getItem('mfh-language') || navigator.language.slice(0, 2); } catch (_) {}
  if (!locales[lang]) lang = 'zh';
  const t = key => key.split('.').reduce((a, p) => a?.[p], locales[lang]) || key;
  const node = (tag, text, cls) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; };
  const toast = message => { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 5500); };
  function errorText(code) { return t(({AUTH:'apiAuth',RATE_LIMIT:'apiLimit',MODEL:'apiModel',TIMEOUT:'apiTimeout',CONTEXT_TOO_LARGE:'contextLarge',INVALID_PROJECT:'invalidProject',TOO_LARGE:'tooLarge',NO_CONNECTION:'needConnect',MODEL_REQUIRED:'missingModel',KEY_REQUIRED:'missingKey',INVALID_RESULT:'invalidResult',INVALID_CONFIG:'invalidConfig'})[code] || 'aiFailure'); }
  function remember(key, value) { try { localStorage.setItem(key, value); } catch (_) {} }
  const getAll = () => new Promise((resolve, reject) => { const r = db.transaction('projects').objectStore('projects').getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  function saveStatus(message) { $('saveStatus').textContent = message; $('focusSaveStatus').textContent = message; }
  const saveRecords = new Map();
  let changingProject = false;
  function saveRecord(id) {
    if (!saveRecords.has(id)) saveRecords.set(id, {revision:0, committed:0, durable:'', pending:false, failed:false, conflict:false, stored:null, writes:Promise.resolve()});
    return saveRecords.get(id);
  }
  function renderSaveState() {
    const state = saveRecord(project.id);
    const saved = !state.pending && !state.failed && state.durable === JSON.stringify(project);
    saveStatus(t(state.conflict ? 'saveConflict' : saved ? 'saved' : state.failed || !db ? 'saveFailed' : 'saving'));
    $('saveRecovery').hidden = !state.failed && !state.conflict && !!db;
    $('saveRecoveryTitle').dataset.i18n = state.conflict ? 'saveConflictHint' : 'saveRecoveryHint';
    $('saveRecoveryTitle').textContent = t($('saveRecoveryTitle').dataset.i18n);
    $('retrySave').disabled = state.pending || state.conflict;
  }
  function persistSnapshot(snapshot, state) {
    // Serialize durable writes, independently of delayed UI completion callbacks.
    const finished = {};
    finished.promise = new Promise((resolve, reject) => Object.assign(finished, {resolve, reject}));
    const write = state.writes.then(() => new Promise((resolve, reject) => {
      if (state.conflict) { reject(new Error('SAVE_CONFLICT')); return; }
      const tx = db.transaction('projects', 'readwrite'), store = tx.objectStore('projects');
      const record = {...snapshot, _mfhRevision:C.uuid()}, serialized = JSON.stringify(record);
      const request = store.get(snapshot.id);
      request.onsuccess = () => {
        // Compare the exact baseline as well as its persisted token. This also
        // detects writes from older tabs that do not retain revision metadata.
        const current = request.result === undefined ? null : JSON.stringify(request.result);
        if (current !== state.stored) { state.conflict = true; tx.abort(); return; }
        store.put(record);
      };
      tx.addEventListener('complete', () => { state.stored = serialized; resolve(); });
      tx.addEventListener('abort', () => reject(state.conflict ? new Error('SAVE_CONFLICT') : tx.error || new Error('SAVE_ABORTED')));
      tx.oncomplete = () => finished.resolve();
      tx.onabort = () => reject(state.conflict ? new Error('SAVE_CONFLICT') : tx.error || new Error('SAVE_ABORTED'));
      tx.onerror = () => {}; // Abort is the final outcome; never advance the baseline on error.
    }));
    state.writes = write.catch(() => {});
    write.catch(finished.reject);
    return finished.promise;
  }
  async function save(target = project) {
    if (saveRecord(target.id).conflict) { renderSaveState(); return false; }
    target.updatedAt = new Date().toISOString();
    const snapshot = structuredClone(target), serialized = JSON.stringify(snapshot);
    const state = saveRecord(target.id), revision = ++state.revision;
    state.pending = true; renderSaveState();
    try {
      if (!db) throw new Error('STORAGE_UNAVAILABLE');
      await persistSnapshot(snapshot, state);
      // Completion callbacks can arrive late. Never replace a newer snapshot or status.
      if (revision > state.committed) {
        state.committed = revision; state.durable = serialized;
        const i = projects.findIndex(p => p.id === snapshot.id); if (i >= 0) projects[i] = snapshot; else projects.push(snapshot);
      }
      if (revision === state.revision) { state.pending = false; state.failed = false; }
      renderProjects(); renderSaveState();
      return revision === state.revision && serialized === JSON.stringify(target);
    } catch (_) {
      if (revision === state.revision) { state.pending = false; state.failed = true; }
      renderSaveState(); return false;
    }
  }
  async function changeProject(next, nextStep = 0) {
    if (busy || changingProject) { $('projects').value = project.id; return false; }
    if (next.id === project.id) return false;
    changingProject = true;
    const previous = project;
    $('projects').value = previous.id;
    try {
      if (!await save(previous) || project !== previous) return false;
      project = next; remember('mfh-active', project.id); step = nextStep;
      $('reviewPanel').hidden = true;
      render();
      await save();
      return true;
    } finally { changingProject = false; }
  }
  function translate() {
    document.documentElement.lang = {zh:'zh-CN',en:'en',es:'es'}[lang]; $('language').value = lang;
    document.querySelectorAll('[data-i18n]').forEach(e => e.textContent = t(e.dataset.i18n));
    document.querySelectorAll('[data-placeholder]').forEach(e => e.placeholder = t(e.dataset.placeholder));
    document.querySelectorAll('[data-i18n-label]').forEach(e=>e.setAttribute('aria-label',t(e.dataset.i18nLabel)));
    $('projects').setAttribute('aria-label', t('books')); $('chapters').setAttribute('aria-label', t('chapters')); $('handoffText').setAttribute('aria-label', t('handoff'));$('language').setAttribute('aria-label',t('language'));document.querySelector('.steps').setAttribute('aria-label',t('myBook'));
    $('checklist').replaceChildren(...t('checklist').map(s => node('li', s)));
    $('readmeLink').href = `preview/README${lang === 'zh' ? '' : '.' + lang}.html`;
    $('productionLink').href = lang === 'zh' ? 'preview/guide.html#production' : `preview/guide.${lang}.html#usage`;
  }
  function renderProjects() {
    const selected = project.id;
    const choices = projects.some(p => p.id === selected) ? projects : [...projects, project];
    $('projects').replaceChildren(...choices.map(p => { const e = node('option', p.title || t('untitled')); e.value = p.id; return e; }));
    $('projects').value = selected;
    renderDesk();
  }
  function renderDesk() {
    const hasWords = !!(project.chapters.length || project.answers.length || project.workingAnswer || project.materials.length);
    $('deskHeading').textContent = t(hasWords ? 'deskReturnTitle' : 'deskTitle');
    $('deskHint').textContent = t(hasWords ? 'deskReturnHint' : 'deskHint');
    $('continueBook').textContent = t(project.chapters.length ? 'continueBook' : hasWords ? 'continueStory' : 'beginStory');
    $('deskCounts').textContent = t('deskCounts').replace('{chapters}', project.chapters.length).replace('{sources}', project.answers.length + project.materials.length);
    $('coverAuthor').textContent = project.person || t('coverAuthor');
    $('deskEmpty').hidden = !!project.chapters.length;
    $('deskChapterList').replaceChildren(...project.chapters.slice(0,5).map((chapter,index) => {
      const item=node('li'), button=node('button',undefined,'desk-chapter');
      button.dataset.action='openDeskChapter';button.dataset.id=chapter.id;
      const text=node('span',undefined,'desk-chapter-copy');
      text.append(node('strong',chapter.title || t('chapter')),node('small',t(chapter.approved ? 'reviewed' : 'draftStatus')));
      button.append(node('span',String(index+1).padStart(2,'0'),'desk-chapter-number'),text,node('span','↗','desk-arrow'));item.append(button);return item;
    }));
    if (project.chapters.length > 5) { const item=node('li'),button=node('button',t('allChapters'),'quiet');button.dataset.action='openContents';item.append(button);$('deskChapterList').append(item); }
  }
  function showStoryView(view) {
    const archive=view==='archive';
    if ($('interviewView').hidden !== archive) interviewEpoch++;
    if (archive) stopInterviewVoice();
    $('interviewView').hidden=archive;$('archiveView').hidden=!archive;
    $('interviewTab').setAttribute('aria-pressed',String(!archive));$('archiveTab').setAttribute('aria-pressed',String(archive));
  }
  async function openDeskChapter(id) {
    if(busy || !project.chapters.some(c=>c.id===id))return;
    project.activeChapter=id;renderChapters();$('reviewPanel').hidden=true;showStep(2);
    $('editChapterTitle').focus({preventScroll:true});await save();
  }
  function renderScenes() {
    $('scenes').replaceChildren(...C.scenes.map(s => {
      const label = node('label', undefined, 'scene-option'), input = document.createElement('input'); input.type = 'radio'; input.name = 'scene'; input.value = s; input.checked = project.scene === s;
      label.append(input, node('strong', t(`scenes.${s}`)), node('small', t(`sceneNotes.${s}`))); return label;
    }));
  }
  function currentQuestion() { const q = questions[lang][project.scene]; return project.aiQuestion || q[project.questionIndex % q.length]; }
  function renderQuestion() { $('questionText').textContent = currentQuestion(); }
  // Search and expansion belong to this view, never to the saved project or AI context.
  let sourceProjectId = '', sourceQuery = '';
  const expandedSources = new Set();
  const searchText = value => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
  function matchesSource(source) {
    const text = `[${source.sourceId}] ${source.question ?? source.name ?? ''} ${source.answer ?? source.content ?? ''}`;
    return searchText(text).includes(searchText(sourceQuery.trim()));
  }
  function sourceFeedback(source, message) {
    return matchesSource(source) ? message : t('sourceOutsideSearch');
  }
  function sourceNotice(message) { if (!saveRecord(project.id).failed && !saveRecord(project.id).conflict) toast(message); }
  function sourceSummary(group, id) {
    return Array.from($(group).querySelectorAll('details')).find(e => e.dataset.recordId === id)?.querySelector('summary');
  }
  function focusSource(group, id) { (sourceSummary(group, id) || $('sourceSearch')).focus({preventScroll:true}); }
  function renderSourceList(group) {
    if (sourceProjectId !== project.id) {
      sourceProjectId = project.id; sourceQuery = ''; expandedSources.clear(); $('sourceSearch').value = '';
    }
    const list = $(group), answer = group === 'answers', sources = project[group];
    const focusedId = list.contains(document.activeElement) ? document.activeElement.closest('details')?.dataset.recordId : null;
    const records = sources.filter(matchesSource).map(source => {
      const record = node('details', undefined, 'source-record'), summary = node('summary');
      const key = group + ':' + source.id, included = answer ? source.include !== false : source.include;
      record.dataset.recordId = source.id; record.dataset.sourceId = source.sourceId; record.open = expandedSources.has(key);
      record.addEventListener('toggle', () => {
        if (!record.isConnected) return;
        if (record.open) expandedSources.add(key); else expandedSources.delete(key);
        fullText.textContent = record.open ? content : '';
      });
      const meta = node('span', undefined, 'source-meta');
      meta.append(node('span', `[${source.sourceId}]`, 'source-id'), node('span', t(included ? 'sourceIncluded' : 'sourceExcluded'), 'source-inclusion'));
      const content = answer ? source.answer : source.content, excerpt = content.replace(/\s+/g, ' ').trim();
      const arrow = node('span', '›', 'source-arrow'); arrow.setAttribute('aria-hidden', 'true');
      summary.append(meta, node('span', answer ? source.question : source.name, 'source-title'), node('span', excerpt.slice(0,140) + (excerpt.length > 140 ? '…' : ''), 'source-excerpt'), arrow);
      const body = node('div', undefined, 'source-body'), choice = node('label', undefined, 'material-choice'), checkbox = document.createElement('input');
      checkbox.type = 'checkbox'; checkbox.checked = included;
      checkbox.dataset[answer ? 'answerSource' : 'material'] = source.id;
      checkbox.setAttribute('aria-label', `${t('includeAI')} · ${source.sourceId}`);
      choice.append(checkbox, node('span', t('includeAI')));
      const tools = node('div', undefined, 'tools');
      for (const action of [answer ? 'editAnswer' : 'editMaterial', answer ? 'deleteAnswer' : 'deleteMaterial']) {
        const label = t(action.startsWith('edit') ? 'edit' : 'remove'), button = node('button', label, 'quiet small');
        button.dataset.action = action; button.dataset.id = source.id; button.setAttribute('aria-label', `${label} · ${source.sourceId}`); tools.append(button);
      }
      const fullText = node('p', record.open ? content : '', 'source-content');
      summary.addEventListener('click', () => { if (!record.open) fullText.textContent = content; });
      body.append(fullText, choice, tools); record.append(summary, body); return record;
    });
    list.replaceChildren(...(records.length ? records : [node('p', t(sources.length ? 'sourceNoMatches' : answer ? 'noAnswers' : 'noMaterials'), 'empty')]));
    const all = [...project.answers, ...project.materials];
    $('sourceSearchStatus').textContent = t('sourceResults').replace('{shown}', all.filter(matchesSource).length).replace('{total}', all.length);
    $('clearSourceSearch').disabled = !sourceQuery;
    if (focusedId) focusSource(group, focusedId);
  }
  function renderAnswers() { renderSourceList('answers'); }
  function renderMaterials() { renderSourceList('materials'); }
  function updateSourceInclusion(input) {
    input.closest('details').querySelector('.source-inclusion').textContent = t(input.checked ? 'sourceIncluded' : 'sourceExcluded');
  }
  $('sourceSearch').addEventListener('input', () => { sourceQuery = $('sourceSearch').value; renderAnswers(); renderMaterials(); });
  $('clearSourceSearch').addEventListener('click', () => { sourceQuery = ''; $('sourceSearch').value = ''; $('sourceSearch').focus({preventScroll:true}); renderAnswers(); renderMaterials(); });
  const activeChapter = () => project.chapters.find(c => c.id === project.activeChapter);
  function renderWritingEntry() {
    const ready = project.answers.some(a => a.include !== false) || project.materials.some(m => m.include);
    const localFirst = ready && !connection && !project.chapters.length;
    $('writingAIButton').classList.toggle('primary', !localFirst);
    $('writingLocalButton').classList.toggle('primary', localFirst);
    $('noChapter').dataset.i18n = ready ? 'firstChapterReady' : 'noChapters';
    $('noChapter').textContent = t($('noChapter').dataset.i18n);
  }
  function renderComposer() {
    $('writingBookTitle').textContent = project.title || t('writingTitle');
    const index = project.chapters.findIndex(c => c.id === project.activeChapter);
    $('writingChapterPosition').textContent = index < 0 ? '' : `${t('chapter')} ${index + 1} / ${project.chapters.length}`;
    $('writingChapterPosition').hidden = index < 0;
    const composer = $('chapterComposer'), empty = !project.chapters.length;
    const addButton=document.querySelector('[data-action="newChapter"]');addButton.dataset.i18n=empty?'firstChapter':'newChapter';addButton.textContent=t(addButton.dataset.i18n);
    if (composer.dataset.empty !== String(empty)) { composer.open = empty; composer.dataset.empty = String(empty); }
    for (const action of ['writeAI','collect','pasteDraft']) {
      const button = document.querySelector(`[data-action="${action}"]`);
      const parent = $(button.classList.contains('primary') ? 'organizerPrimary' : 'organizerAlternatives');
      if (button.parentElement !== parent) parent.append(button);
    }
  }
  function renderChapters() {
    renderWritingEntry();
    renderComposer();
    const c = activeChapter(); $('chapters').replaceChildren(...project.chapters.map(c => { const o = node('option', c.title || t('chapter')); o.value = c.id; return o; }));
    $('chapters').value = project.activeChapter; $('chapters').disabled = !project.chapters.length; $('noChapter').hidden = !!c; $('chapterEditor').hidden = !c;
    $('chapterFinderButton').disabled = busy || !project.chapters.length;
    $('focusChapterButton').hidden = !c;
    if (c) { $('editChapterTitle').value = c.title; $('chapterText').value = c.content; }
    updateChapterBadge();
  }
  function updateChapterBadge() {
    renderExportOverview();
    const c = activeChapter(); if (!c) return;
    $('chapterStatus').textContent = t(c.approved ? 'reviewed' : 'draftStatus'); $('approvalButton').textContent = t(c.approved ? 'unapprove' : 'approve'); $('chapterOrigin').textContent = t({ai:'originAI',source:'originSource',manual:'originManual'}[c.origin]);
  }
  let chapterEditorHeight = '';
  function sizeFocusEditor() {
    if (!$('chapterFocusDialog').open) return;
    const field = $('chapterText'), scroll = $('chapterFocusDialog').scrollTop;
    field.style.height = 'auto'; field.style.height = field.scrollHeight + 'px';
    $('chapterFocusDialog').scrollTop = scroll;
  }
  function focusChapter() {
    if (busy || !activeChapter() || $('chapterFocusDialog').open) return;
    $('focusHelp').open = false;
    chapterEditorHeight = $('chapterText').style.height;
    $('focusEditorSlot').before($('saveRecovery'));
    $('focusEditorSlot').append($('chapterEditor'));
    document.body.classList.add('chapter-focus-open');
    $('chapterFocusDialog').showModal();
    $('chapterFocusDialog').scrollTop = 0;
    sizeFocusEditor();
    $('focusTitle').focus({preventScroll:true});
  }
  $('chapterFocusDialog').addEventListener('close', () => {
    $('workspacePanel').before($('saveRecovery'));
    $('chapterEditorAnchor').before($('chapterEditor'));
    $('chapterText').style.height = chapterEditorHeight;
    document.body.classList.remove('chapter-focus-open');
    $('focusChapterButton').focus({preventScroll:true});
  });
  $('chapterText').addEventListener('input', sizeFocusEditor);
  window.addEventListener('resize', sizeFocusEditor);
  let exportReviewProject = '', exportOverviewProject = '';
  function renderExportOverview() {
    const chapters = project.chapters, drafts = chapters.filter(c => !c.approved);
    if (exportOverviewProject !== project.id) { exportOverviewProject = project.id; $('exportDirectory').open = false; }
    $('exportBookTitle').textContent = project.title || t('untitled');
    $('exportCounts').textContent = t('exportCounts').replace('{total}', chapters.length).replace('{reviewed}', chapters.length - drafts.length).replace('{drafts}', drafts.length);
    $('exportOverview').dataset.state = !chapters.length ? 'empty' : drafts.length ? 'draft' : 'reviewed';
    $('exportReviewNote').textContent = t(!chapters.length ? 'exportEmptyNote' : drafts.length ? 'exportDraftNote' : 'exportReviewedNote');
    $('checkNextDraft').hidden = !drafts.length; $('checkNextDraft').dataset.id = drafts[0]?.id || '';
    $('exportDirectory').hidden = !chapters.length;
    // The hidden overview needs current counts, but not a rebuilt directory on every keystroke.
    if (step !== 3) return;
    $('exportChapterList').replaceChildren(...chapters.map((chapter, index) => {
      const row = node('li', undefined, 'manuscript-chapter'), number = node('span', String(index + 1).padStart(2, '0'), 'manuscript-number');
      number.setAttribute('aria-hidden', 'true');
      const text = node('div', undefined, 'manuscript-chapter-text');
      text.append(node('span', chapter.title || t('chapter'), 'manuscript-chapter-title'), node('span', t(chapter.approved ? 'reviewed' : 'draftStatus'), 'manuscript-chapter-state'));
      row.dataset.reviewed = String(chapter.approved); row.append(number, text);
      if (!chapter.approved) {
        const button = node('button', t('exportInspect'), 'quiet small'); button.dataset.action = 'inspectExportChapter'; button.dataset.id = chapter.id;
        button.setAttribute('aria-label', `${t('exportInspect')}: ${chapter.title || t('chapter')}`); row.append(button);
      }
      return row;
    }));
  }
  async function inspectExportChapter(id) {
    if (busy) { toast(t('busy')); return; }
    if (!project.chapters.some(c => c.id === id)) return;
    project.activeChapter = id; renderChapters(); $('reviewPanel').hidden = true;
    exportReviewProject = project.id; showStep(2);
    $('chapterEditor').focus({preventScroll:true}); $('chapterEditor').scrollIntoView({behavior:'auto',block:'start'});
    // Finish navigation before saving, so completion cannot override a later user action.
    await save();
  }
  const chapterSearchText = text => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  function chapterSearchOffset(text, needle) {
    const match = chapterSearchText(text).indexOf(needle);
    if (match < 0) return -1;
    // Accent folding changes offsets; keep the excerpt anchored in the original text.
    let original = 0, folded = 0;
    for (const point of text) {
      folded += chapterSearchText(point).length;
      if (folded > match) return original;
      original += point.length;
    }
    return -1;
  }
  function renderChapterFinder() {
    const query = $('chapterQuery').value.trim(), needle = chapterSearchText(query);
    const rows = project.chapters.flatMap((chapter, index) => {
      if (needle && !chapterSearchText(chapter.title + '\n' + chapter.content).includes(needle)) return [];
      const row = node('li'), button = node('button', undefined, 'finder-chapter');
      button.dataset.action = 'chooseChapter'; button.dataset.id = chapter.id;
      const current = chapter.id === project.activeChapter;
      if (current) button.setAttribute('aria-current', 'true');
      const number = node('span', String(index + 1).padStart(2, '0'), 'finder-number');
      const text = node('span', undefined, 'finder-text');
      text.append(node('span', chapter.title || t('chapter'), 'finder-title'));
      const content = chapter.content.replace(/\s+/g, ' ').trim();
      const match = needle ? chapterSearchOffset(content, needle) : -1, start = Math.max(0, match - 36);
      const excerpt = (start ? '…' : '') + content.slice(start, start + 150) + (content.length > start + 150 ? '…' : '');
      text.append(node('span', excerpt, 'finder-excerpt'), node('span', [current ? t('currentChapter') : '', t(chapter.approved ? 'reviewed' : 'draftStatus')].filter(Boolean).join(' · '), 'finder-state'));
      button.append(number, text); row.append(button); return [row];
    });
    $('chapterMatchesList').replaceChildren(...rows); $('noChapterMatches').hidden = !!rows.length;
    $('chapterMatches').textContent = t('chapterMatches').replace('{shown}', rows.length).replace('{total}', project.chapters.length);
    $('clearChapterQuery').disabled = !$('chapterQuery').value;
  }
  function findChapter() {
    if (busy || !project.chapters.length || $('chapterFinder').open) return;
    $('chapterQuery').value = ''; renderChapterFinder(); $('chapterFinder').showModal(); $('chapterQuery').focus();
  }
  async function chooseChapter(id) {
    if (busy || !$('chapterFinder').open || !project.chapters.some(c => c.id === id)) return;
    project.activeChapter = id; $('chapterFinder').close(); renderChapters(); $('reviewPanel').hidden = true;
    $('editChapterTitle').focus({preventScroll:true}); $('editChapterTitle').scrollIntoView({behavior:'auto',block:'center'});
    // Selection is immediate; a late save must not restore an older view or focus.
    await save();
  }
  $('chapterQuery').addEventListener('input', renderChapterFinder);
  $('clearChapterQuery').addEventListener('click', () => { $('chapterQuery').value = ''; renderChapterFinder(); $('chapterQuery').focus(); });
  let interviewEpoch = 0, pendingInterviewChange = null, interviewSaving = false;
  function stopInterviewVoice() {
    if (!recognition) return;
    const previous = recognition; recognition = null; previous.abort(); $('voiceButton').textContent = t('voice');
  }
  function changedInterview(change, includeAnswer) {
    const next = structuredClone(project);
    if (includeAnswer) {
      next.answers.push({id:C.uuid(),sourceId:'A'+next.nextAnswer++,include:true,question:currentQuestion(),answer:$('answer').value.trim(),date:new Date().toISOString()});
      next.workingAnswer = ''; next.questionIndex++; next.aiQuestion = '';
    } else if (change.kind === 'skip') { next.questionIndex++; next.aiQuestion = ''; }
    if (change.kind === 'scene') { next.scene = change.value; next.questionIndex = 0; next.aiQuestion = ''; }
    if (change.kind === 'language') next.language = change.value;
    if (change.kind === 'import') next.aiQuestion = change.question;
    return next;
  }
  async function askInterviewQuestion() {
    const epoch = interviewEpoch, id = project.id, version = connectionVersion;
    const result = await requestAI('interview');
    if (!result || epoch !== interviewEpoch || id !== project.id || version !== connectionVersion || $('answer').value.trim() || step !== 1 || mode !== 'workspace') return;
    project.aiQuestion = result.slice(0,2000); interviewEpoch++; renderQuestion(); await save();
  }
  function applyInterviewChange(next, change) {
    project = next;
    if (change.kind === 'language') { lang = change.value; remember('mfh-language', lang); }
    interviewEpoch++;
    const oldMode = mode; render(); showMode(oldMode);
    if (step === 1 && mode === 'workspace') $('answer').focus({preventScroll:true});
    else if (change.kind === 'scene') $('scenes').querySelector('input:checked')?.focus({preventScroll:true});
    else if (change.kind === 'language') $('language').focus({preventScroll:true});
  }
  async function continueInterviewChange(change) {
    if (change.kind === 'ai') await askInterviewQuestion();
    if (change.kind === 'import') {
      await addChapter(change.content, 'manual', change.title);
      $('returnedAI').value = ''; renderQuestion();
    }
  }
  async function commitInterviewChange() {
    if (!pendingInterviewChange || interviewSaving || saveRecord(project.id).conflict) return;
    const change = pendingInterviewChange, next = changedInterview(change, true);
    interviewSaving = true; $('keepInterviewDraft').disabled = true; $('saveInterviewDraft').disabled = true;
    $('interviewDraftStatus').textContent = t('saving');
    const saved = await save(next);
    interviewSaving = false; $('keepInterviewDraft').disabled = false; $('saveInterviewDraft').disabled = saveRecord(project.id).conflict;
    if (!saved) { $('interviewDraftStatus').textContent = t(saveRecord(project.id).conflict ? 'saveConflictHint' : 'draftSaveFailed'); (saveRecord(project.id).conflict ? $('keepInterviewDraft') : $('saveInterviewDraft')).focus(); return; }
    pendingInterviewChange = null; $('interviewDraftDialog').close(); applyInterviewChange(next, change); sourceNotice(sourceFeedback(next.answers.at(-1),t('answerSaved')));
    await continueInterviewChange(change);
  }
  async function changeInterview(change) {
    if (interviewSaving || $('interviewDraftDialog').open) return;
    if (change.kind === 'ai' && (!connection || busy)) { toast(t(connection ? 'busy' : 'needConnect')); return; }
    interviewEpoch++; stopInterviewVoice();
    const hasAnswer = !!$('answer').value.trim();
    if (change.kind === 'save' && !hasAnswer) { toast(t('emptyAnswer')); return; }
    if (hasAnswer) {
      pendingInterviewChange = change; $('interviewDraftQuestion').textContent = currentQuestion(); $('interviewDraftStatus').textContent = saveRecord(project.id).conflict ? t('saveConflictHint') : ''; $('saveInterviewDraft').disabled = saveRecord(project.id).conflict;
      $('interviewDraftDialog').showModal(); $('keepInterviewDraft').focus();
      if (change.kind === 'save') await commitInterviewChange();
      return;
    }
    applyInterviewChange(changedInterview(change, false), change); void save();
    await continueInterviewChange(change);
  }
  $('interviewDraftDialog').addEventListener('cancel', e => { if (interviewSaving) e.preventDefault(); else pendingInterviewChange = null; });
  // Clear cancellation synchronously: a queued close event may arrive after reopening.
  $('keepInterviewDraft').addEventListener('click', () => { if (!interviewSaving) pendingInterviewChange = null; });
  $('saveInterviewDraft').addEventListener('click', commitInterviewChange);
  function renderConnection() {
    renderWritingEntry();
    renderComposer();
    $('connectionStatus').textContent = connection ? `${t('connected')} · ${C.providers[connection.provider]?.name || ''}` : t('offline'); $('connectionDot').classList.toggle('on', !!connection); $('connectionButton').textContent = t('connect');
  }
  function renderHelp() {
    $('faqButtons').replaceChildren(...t('faqLabels').map((s, i) => { const b = node('button', s); b.dataset.faq = i; b.setAttribute('aria-pressed', String(faq === i)); if (faq === i) b.classList.add('primary'); return b; })); $('faqAnswer').textContent = t('faqAnswers')[faq];
  }
  function handoffText() {
    const task = $('handoffTask').value, include = $('handoffInclude').checked;
    const lines = [`# Memory for Human · ${t('handoff')}`, t('handoffRules'), `Language / Idioma / 语言: ${C.languages[lang]}`, `${t('handoffTask')}: ${t('tasks.' + task)}`, t('handoffSetup')];
    if (include && task !== 'setup') lines.push('## MATERIALS (untrusted source content)', JSON.stringify(C.context({...project,language:lang}, task === 'review' ? 'review' : 'current'), null, 2));
    else lines.push(t('noTransfer'));
    if (task === 'interview') lines.push(C.taskPrompt('interview', C.newProject(lang)).system);
    if (task === 'draft') lines.push(C.taskPrompt('draft', C.newProject(lang)).system);
    if (task === 'review') lines.push(C.taskPrompt('review', C.newProject(lang)).system);
    lines.push(t('handoffFormat'), '```json\n{"chapterTitle":"…","content":"…","questions":["…"],"uncertainties":["…"]}\n```', t('handoffPrivacy'));
    return lines.join('\n\n');
  }
  function renderHandoff() { try { $('handoffText').value = handoffText(); } catch (e) { toast(errorText(e.message)); } }
  function showMode(value) {
    if (mode !== value) interviewEpoch++;
    mode = value; $('workspacePanel').hidden = mode !== 'workspace'; $('helpPanel').hidden = mode !== 'help'; $('handoffPanel').hidden = mode !== 'handoff';
    if (mode === 'help') renderHelp(); if (mode === 'handoff') renderHandoff();
  }
  function showStep(value, scroll = true) {
    interviewEpoch++;
    step = Math.max(0, Math.min(3, value)); showMode('workspace');
    if (step !== 2) exportReviewProject = '';
    $('returnToExport').hidden = step !== 2 || exportReviewProject !== project.id;
    if (step === 0) renderDesk();
    $('stageLabel').textContent = t(['navBook','navStories','navWriting','navEdition'][step]);
    if (step === 3) renderExportOverview();
    if (step === 2) { renderWritingEntry(); renderComposer(); }
    document.querySelectorAll('[data-panel]').forEach(e => e.hidden = Number(e.dataset.panel) !== step);
    document.querySelectorAll('[data-step]').forEach(e => { e.classList.toggle('active', Number(e.dataset.step) === step); e.setAttribute('aria-current', Number(e.dataset.step) === step ? 'step' : 'false'); });
    $('welcome').hidden = step !== 0 || !!project.title || !!project.answers.length; $('backButton').hidden = step === 0; $('nextButton').hidden = step === 3;
    if (scroll && innerWidth < 700) $('main').scrollIntoView({behavior:'auto', block:'start'});
  }
  function render() {
    translate(); renderProjects(); renderScenes(); renderQuestion(); renderAnswers(); renderMaterials(); renderChapters(); renderConnection(); renderHelp(); renderHandoff();
    for (const [id, key] of [['bookTitle','title'],['person','person'],['reader','reader'],['target','target'],['answer','workingAnswer']]) $(id).value = project[key];
    renderSaveState(); showStep(step, false); showMode(mode);
  }
  function download(name, content, type) {
    const url = URL.createObjectURL(new Blob([content], {type})), a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
  const filename = () => (project.title || t('untitled')).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 80);
  async function api(path, data) {
    if (!token) throw new Error('NO_CONNECTION');
    const response = await fetch(path, {method:'POST', headers:{'Content-Type':'application/json','X-MFH-Session':token}, body:JSON.stringify(data)});
    const result = await response.json(); if (!response.ok) throw new Error(result.code || 'AI_ERROR'); return result;
  }
  async function requestAI(kind, extra = '') {
    if (!connection) { toast(t('needConnect')); return null; }
    if (busy) return null;
    busy = true; $('busyLine').hidden = false; document.querySelectorAll('[data-ai]').forEach(b => b.disabled = true);$('chapters').disabled=true;$('chapterFinderButton').disabled=true;$('focusChapterButton').disabled=true;
    const snapshot = structuredClone(project), projectId = project.id;
    try { const prompt = C.taskPrompt(kind, {...snapshot,language:lang}, extra); const result = await api('/api/generate', {...prompt,kind}); if (project.id !== projectId) return null; if(result.truncated){toast(t('outputTruncated'));return result.text+'\n\n['+t('outputTruncated')+']';}return result.text; }
    catch (e) { toast(errorText(e.message)); return null; }
    finally { busy = false; $('busyLine').hidden = true; document.querySelectorAll('[data-ai]').forEach(b => b.disabled = false);$('chapters').disabled=!project.chapters.length;$('chapterFinderButton').disabled=!project.chapters.length;$('focusChapterButton').disabled=false; }
  }
  async function addChapter(content, origin = 'manual', title = '') {
    if (!content.trim()) { toast(t('invalidResult')); return; }
    const c = {id:C.uuid(), title:title || $('nextChapterTitle').value.trim() || `${t('chapter')} ${project.chapters.length + 1}`, content, origin, approved:false, updatedAt:new Date().toISOString()};
    project.chapters.push(c); project.activeChapter = c.id; $('nextChapterTitle').value = ''; $('reviewPanel').hidden = true; renderChapters(); showStep(2); const saved = await save(); if (saved) toast(t('chapterAdded'));
  }
  async function importAIResult() {
    let content = $('returnedAI').value.trim(), title = '', question = '';
    if (!content) { toast(t('invalidResult')); return; }
    const candidate = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    if (candidate.startsWith('{')) {
      let obj; try { obj = JSON.parse(candidate); } catch (_) { toast(t('invalidResult')); return; }
      if (typeof obj.content !== 'string' || obj.content.length > 200000) { toast(t('invalidResult')); return; }
      content = obj.content; title = typeof obj.chapterTitle === 'string' ? obj.chapterTitle.slice(0,300) : '';
      if (Array.isArray(obj.uncertainties) && obj.uncertainties.length) content += '\n\n' + t('reviewResult') + '\n' + obj.uncertainties.filter(s => typeof s === 'string').map(s => '- ' + s).join('\n');
      if (Array.isArray(obj.questions) && typeof obj.questions[0] === 'string') question = obj.questions[0].slice(0,2000);
    }
    if (question) { await changeInterview({kind:'import',question,content:content.slice(0,200000),title}); return; }
    await addChapter(content.slice(0,200000), 'manual', title); $('returnedAI').value = ''; renderQuestion();
  }
  function printMemoir() {
    if (!project.chapters.length) { toast(t('needChapter')); return; }
    const title = node('h1', project.title || t('untitled')); const children = [title];
    if (project.person) children.push(node('p', project.person, 'hint'));
    project.chapters.forEach(c => { const s = node('section', undefined, 'print-chapter'); s.append(node('h2', c.title || t('chapter')), node('p', t(c.approved?'reviewed':'draftStatus'),'hint')); for (const paragraph of c.content.split(/\n\s*\n/)) s.append(node('p', paragraph)); children.push(s); }); $('printView').replaceChildren(...children); window.print();
  }
  const actions = {
    focusChapter,
    desk:()=>showStep(0), continueBook:()=>{showStoryView('interview');showStep(project.chapters.length?2:1);},
    openArchive:()=>{showStep(1);showStoryView('archive');},showArchive:()=>showStoryView('archive'),showInterview:()=>showStoryView('interview'),
    goWriting:()=>showStep(2),openDeskChapter,openContents:()=>{showStep(2);findChapter();},
    inspectExportChapter,
    returnToExport: () => { showStep(3); $('exportOverview').focus({preventScroll:true}); $('exportOverview').scrollIntoView({behavior:'auto',block:'start'}); },
    findChapter, chooseChapter,
    workspace: () => showMode('workspace'), help: () => showMode('help'), handoff: () => showMode('handoff'), start: () => { $('welcome').hidden = true; showStep(0); $('bookTitle').focus(); },
    next: () => showStep(step + 1), back: () => showStep(step - 1),
    new: () => changeProject(C.newProject(lang)),
    demo: async () => { const next=C.newProject(lang); next.title=t('demoName'); next.scene='life'; next.materials.push({id:C.uuid(),sourceId:'M'+next.nextMaterial++,name:t('demoNotice'),content:t('demoNotice'),include:true}); next.answers.push({id:C.uuid(),sourceId:'A'+next.nextAnswer++,include:true,question:t('demoQuestion'),answer:t('demoAnswer'),date:new Date().toISOString()}); if(await changeProject(next,1))toast(t('demoNotice')); },
    retrySave: () => save(),
    saveAnswer: () => changeInterview({kind:'save'}),
    skip: () => changeInterview({kind:'skip'}),
    askAI: () => changeInterview({kind:'ai'}),
    voice: () => {
      if(recognition){recognition.stop();return;} const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
      if(!Recognition){toast(t('voiceUnavailable'));return;} const r=new Recognition(); recognition=r; r.lang={zh:'zh-CN',en:'en-US',es:'es-ES'}[lang]; r.interimResults=false; r.continuous=false;
      r.onresult=async e=>{ if(recognition!==r)return;interviewEpoch++;$('answer').value += ($('answer').value?'\n':'')+Array.from(e.results).map(x=>x[0].transcript).join(' '); project.workingAnswer=$('answer').value; await save(); };
      r.onerror=()=>{if(recognition===r)toast(t('voiceFailed'));}; r.onend=()=>{if(recognition!==r)return;recognition=null;$('voiceButton').textContent=t('voice');};
      try{r.start();$('voiceButton').textContent=t('stopVoice');}catch(_){recognition=null;toast(t('voiceFailed'));}
    },
    editAnswer: (id) => { const a=project.answers.find(a=>a.id===id); if(!a)return; editingAnswer=id;$('editQuestion').value=a.question;$('editAnswer').value=a.answer;$('editAnswerDialog').showModal(); },
    deleteAnswer: async id => { if(!confirm(t('deleteConfirm')))return;project.answers=project.answers.filter(a=>a.id!==id);await save();renderAnswers();sourceNotice(t('sourceRemoved')); },
    addText: () => { $('materialForm').reset();$('materialForm').dataset.edit='';$('materialDialog').showModal(); },
    editMaterial: id => { const m=project.materials.find(m=>m.id===id);if(!m)return;$('materialName').value=m.name;$('materialContent').value=m.content;$('materialForm').dataset.edit=id;$('materialDialog').showModal(); },
    deleteMaterial: async id => { if(!confirm(t('deleteConfirm')))return;project.materials=project.materials.filter(m=>m.id!==id);await save();renderMaterials();sourceNotice(t('sourceRemoved')); },
    importText: () => $('textFile').click(),
    writeAI: async () => { if(!project.answers.some(a=>a.include!==false)&&!project.materials.some(m=>m.include)){toast(t('needSources'));return;}const result=await requestAI('draft',$('nextChapterTitle').value);if(result)await addChapter(result,'ai'); },
    collect: async () => { if(!project.answers.some(a=>a.include!==false)&&!project.materials.some(m=>m.include)){toast(t('needSources'));return;}await addChapter(C.sourceDraft(project,locales[lang]),'source'); },
    pasteDraft: () => { showMode('handoff');$('returnedAI').focus(); },
    newChapter: () => { $('chapterComposer').open=true;$('nextChapterTitle').value='';$('nextChapterTitle').scrollIntoView({block:'center',behavior:'auto'});$('nextChapterTitle').focus({preventScroll:true}); },
    reviewAI: async () => { if(!activeChapter()?.content.trim()){toast(t('needChapter'));return;} const result=await requestAI('review');if(result){$('reviewOutput').textContent=result;$('reviewPanel').hidden=false;} },
    approve: async () => { const c=activeChapter();if(!c)return;c.approved=!c.approved;await save();updateChapterBadge(); },
    deleteChapter: async () => { if(!activeChapter()||!confirm(t('deleteConfirm')))return;project.chapters=project.chapters.filter(c=>c.id!==project.activeChapter);project.activeChapter=project.chapters[0]?.id||'';$('reviewPanel').hidden=true;renderChapters();await save(); },
    backup: () => { download(filename()+'.mfh.json',JSON.stringify(C.publicProject(project),null,2),'application/json');toast(t('backupDone')); }, restore: () => $('backupFile').click(),
    exportMD: () => download(filename()+'.md',C.markdown(project,locales[lang]),'text/markdown;charset=utf-8'), print: printMemoir,
    explainAI: async () => { const result=await requestAI('explain',$('explainQuestion').value||t('faqLabels')[faq]);if(result){$('explainOutput').textContent=result;$('explainOutput').hidden=false;} },
    copyHandoff: async () => { try{await navigator.clipboard.writeText($('handoffText').value);toast(t('copied'));}catch(_){$('handoffText').select();toast(t('copyFailed'));} },
    downloadHandoff: () => download('MFH-AI-'+lang+'.md',$('handoffText').value,'text/markdown;charset=utf-8'), importResult: importAIResult,
    connect: () => { $('fileMode').hidden=!!token;$('connectionError').hidden=true;$('connectionDialog').showModal(); },
    disconnect: async () => { connectionVersion++;if(token)await api('/api/disconnect',{});connection=null;$('apiKey').value='';renderConnection();toast(t('disconnected')); }
  };
  function restoreNavigationFocus(source) {
    const active = document.activeElement;
    const visible = element => {
      if (!element?.getClientRects().length) return false;
      for (let parent=element.parentElement;parent;parent=parent.parentElement) {
        if (parent.tagName==='DETAILS' && !parent.open && !parent.querySelector('summary')?.contains(element)) return false;
      }
      return true;
    };
    // Preserve explicit focus (including dialogs), and only repair a control
    // hidden by navigation or a disclosure closing after its action completes.
    if (visible(source) || (active !== document.body && visible(active))) return;
    const target = mode === 'help' ? $('helpPanel').querySelector('h1')
      : mode === 'handoff' ? $('handoffPanel').querySelector('h1')
      : step === 0 ? $('deskHeading')
      : step === 1 ? ($('interviewView').hidden ? $('archiveView').querySelector('h2') : $('answer'))
      : step === 2 ? ($('chapterEditor').hidden ? $('writingBookTitle') : $('editChapterTitle'))
      : $('exportOverview');
    if (!target?.getClientRects().length) return;
    if (!target.matches('input,textarea,select,button,[tabindex]')) target.tabIndex = -1;
    target.focus({preventScroll:true}); target.scrollIntoView({block:'center',behavior:'auto'});
  }
  document.addEventListener('click', async e => {
    const close=e.target.closest('[data-close]');if(close){$(close.dataset.close).close();return;}
    const nextStep=e.target.closest('[data-step]');if(nextStep){showStep(Number(nextStep.dataset.step));return;}
    const faqButton=e.target.closest('[data-faq]');if(faqButton){faq=Number(faqButton.dataset.faq);renderHelp();return;}
    const button=e.target.closest('[data-action]');if(!button||!project)return;
    $('workspaceTools').open=false;
    try{await actions[button.dataset.action]?.(button.dataset.id);restoreNavigationFocus(button);}catch(err){toast(errorText(err.message));}
  });
  $('workspaceTools').addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();$('workspaceTools').open=false;$('workspaceTools').querySelector('summary').focus();}});
  $('language').addEventListener('change',()=>{const value=$('language').value;$('language').value=lang;void changeInterview({kind:'language',value});});
  $('projects').addEventListener('change',async()=>{const selected=projects.find(p=>p.id===$('projects').value);if(selected)await changeProject(structuredClone(selected));});
  $('scenes').addEventListener('change',e=>{const value=e.target.value;renderScenes();$('scenes').querySelector('input:checked')?.focus({preventScroll:true});void changeInterview({kind:'scene',value});});
  for(const [id,key] of [['bookTitle','title'],['person','person'],['reader','reader'],['target','target'],['answer','workingAnswer']]) $(id).addEventListener(id==='target'?'change':'input',()=>{if(id==='answer')interviewEpoch++;project[key]=$(id).value;void save();});
  $('materials').addEventListener('change',async e=>{const m=project.materials.find(m=>m.id===e.target.dataset.material);if(m){m.include=e.target.checked;updateSourceInclusion(e.target);await save();}});
  $('answers').addEventListener('change',async e=>{const a=project.answers.find(a=>a.id===e.target.dataset.answerSource);if(a){a.include=e.target.checked;updateSourceInclusion(e.target);await save();}});
  for(const [id,key] of [['editChapterTitle','title'],['chapterText','content']])$(id).addEventListener('input',()=>{const c=activeChapter();if(!c)return;c[key]=$(id).value;c.approved=false;c.updatedAt=new Date().toISOString();updateChapterBadge();void save();});
  $('chapters').addEventListener('change',async()=>{
    project.activeChapter=$('chapters').value;
    // Bind the visible editor to this chapter before another input event can run.
    $('reviewPanel').hidden=true;renderChapters();
    await save();
  });
  for(const id of ['handoffTask','handoffInclude'])$(id).addEventListener('change',renderHandoff);
  $('provider').addEventListener('change',()=>{const p=C.providers[$('provider').value];$('model').value=p.model;$('baseURL').value=p.baseURL;if($('provider').value==='custom')$('advanced').open=true;});
  $('connectionForm').addEventListener('submit',async e=>{
    e.preventDefault();if(!token){toast(t('fileMode'));return;}const provider=$('provider').value,apiKey=$('apiKey').value.trim(),model=$('model').value.trim();
    if(provider!=='custom'&&!apiKey){toast(t('missingKey'));return;}if(!model){$('advanced').open=true;toast(t('missingModel'));return;}
    const version=++connectionVersion;
    $('connectSubmit').disabled=true;$('connectSubmit').textContent=t('connecting');$('connectionError').hidden=true;
    try{
      const result=await api('/api/connect',{provider,apiKey,model,baseURL:$('baseURL').value.trim()});
      // Ignore even a successful response if the user disconnected before it arrived.
      if(version!==connectionVersion)return;
      connection=result;$('apiKey').value='';$('connectionDialog').close();renderConnection();toast(t('connected'));
    }
    catch(err){if(version===connectionVersion){$('connectionError').textContent=errorText(err.message);$('connectionError').hidden=false;}}
    finally{$('connectSubmit').disabled=false;$('connectSubmit').textContent=t('connectButton');}
  });
  $('materialForm').addEventListener('submit',async e=>{
    e.preventDefault();const name=$('materialName').value.trim(),content=$('materialContent').value.trim();if(!name||!content)return;
    let record=project.materials.find(m=>m.id===$('materialForm').dataset.edit);
    if(record){record.name=name;record.content=content;}else{record={id:C.uuid(),sourceId:'M'+project.nextMaterial++,name,content,include:false};project.materials.push(record);}
    await save();renderMaterials();$('materialDialog').close();focusSource('materials',record.id);sourceNotice(sourceFeedback(record,t('sourceUpdated')));
  });
  $('editAnswerForm').addEventListener('submit',async e=>{
    e.preventDefault();const a=project.answers.find(a=>a.id===editingAnswer);
    if(a){a.question=$('editQuestion').value;a.answer=$('editAnswer').value;await save();renderAnswers();}
    $('editAnswerDialog').close();focusSource('answers',editingAnswer);if(a)sourceNotice(sourceFeedback(a,t('sourceUpdated')));
  });
  $('textFile').addEventListener('change',async()=>{
    let added=false, outsideSearch=false, rejected=false;
    for(const file of $('textFile').files){if(!/\.(txt|md|csv|json)$/i.test(file.name)){rejected=true;toast(t('unsupportedFile'));continue;}if(file.size>1024*1024){rejected=true;toast(t('tooLarge'));continue;}const record={id:C.uuid(),sourceId:'M'+project.nextMaterial++,name:file.name,content:await file.text(),include:false};project.materials.push(record);added=true;outsideSearch ||= !matchesSource(record);}
    await save();renderMaterials();$('textFile').value='';if(added&&!rejected)sourceNotice(t(outsideSearch?'sourceOutsideSearch':'sourceUpdated'));
  });
  $('backupFile').addEventListener('change',async()=>{const file=$('backupFile').files[0];if(!file)return;try{if(file.size>20*1024*1024)throw new Error('TOO_LARGE');const restored=C.validateProject(JSON.parse(await file.text()));if(await changeProject(restored))toast(t('restoreDone'));}catch(err){toast(errorText(err.message==='TOO_LARGE'?'TOO_LARGE':'INVALID_PROJECT'));}$('backupFile').value='';});
  try {
    db=await new Promise((resolve,reject)=>{const r=indexedDB.open('memory-for-human',1);r.onupgradeneeded=()=>r.result.createObjectStore('projects',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    const storedProjects = await getAll();
    projects=storedProjects.map(p=>C.validateProject(p,true));
    for (let i=0;i<projects.length;i++) { const state=saveRecord(projects[i].id); state.stored=JSON.stringify(storedProjects[i]); state.durable=JSON.stringify(projects[i]); }
    let id;try{id=localStorage.getItem('mfh-active');}catch(_){}project=projects.find(p=>p.id===id)||projects[0]||C.newProject(lang);project.language=lang;
    // Merely opening another tab must not create a new persisted revision.
    if (saveRecord(project.id).stored !== null) { saveRecord(project.id).durable=JSON.stringify(project);renderSaveState(); } else await save();
  }catch(_){project=C.newProject(lang);projects=[project];toast(t('storageUnavailable'));}
  window.addEventListener('beforeunload',e=>{if(saveRecord(project.id).conflict||saveRecord(project.id).durable!==JSON.stringify(project)){e.preventDefault();e.returnValue='';}});
  $('model').value=C.providers.openai.model;$('baseURL').value=C.providers.openai.baseURL;render();
  if(location.protocol!=='file:'){
    try{const r=await fetch('/api/session');if(r.ok){const session=await r.json();token=session.token;connection=session.connection||null;renderConnection();}}catch(_){}
  }
})();

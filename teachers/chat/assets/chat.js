
document.addEventListener('DOMContentLoaded', () => {
  'use strict';
  const app = document.getElementById('teacher-chat-app');
  const DATA_BASE_URL = app.dataset.baseUrl, API_BASE = app.dataset.apiBase;
  const SHOW_LIMIT = 12, MAX_COMMENTS_IN_CONTEXT = 18, TIMEOUT_MS = 30000;
  const chatMessages = document.getElementById('chatMessages'), chatInput = document.getElementById('chatInput'),
        sendBtn = document.getElementById('sendBtn'), chatMode = document.getElementById('chatMode'),
        showCitations = document.getElementById('showCitations');
  let indexData = null, metadata = null, courseData = null;
  const teacherChunks = new Map(), queryCache = new Map(), CACHE_TTL = 3600000;
  function cacheGet(key) {
    const v = queryCache.get(key);
    if (!v || Date.now() - v.t > CACHE_TTL) { queryCache.delete(key); return null; }
    return v.data;
  }
  function cacheSet(key, data) { queryCache.set(key, { t: Date.now(), data }); }
  function appendMessage(role, content, citations = null) {
    const el = document.createElement('div'); el.className = `message ${role}`;
    const bubble = document.createElement('div'); bubble.className = 'bubble'; bubble.textContent = content; el.appendChild(bubble);
    if (citations && citations.length && showCitations.checked) {
      const cite = document.createElement('div'); cite.className = 'citations';
      cite.innerHTML = '<strong>证据片段：</strong><br>' + citations.map((c, i) => `${i+1}. ${c}`).join('<br>');
      el.appendChild(cite);
    }
    chatMessages.appendChild(el); chatMessages.scrollTop = chatMessages.scrollHeight;
  }
  function setSendingState(sending) {
    sendBtn.disabled = sending; chatInput.disabled = sending;
    if (sending) sendBtn.classList.add('loading'); else sendBtn.classList.remove('loading');
  }
  async function fetchJSON(url, retries = 2) {
    for (let i = 0; i <= retries; i++) {
      try {
        const res = await fetch(url, { cache: 'no-cache' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return await res.json();
      } catch (e) {
        if (i === retries) throw e; await new Promise(r => setTimeout(r, 200 * (i + 1)));
      }
    }
  }
  async function ensureInitialData() {
    if (indexData) return;
    const [i, m, c] = await Promise.all([ fetchJSON(`${DATA_BASE_URL}index.json`), fetchJSON(`${DATA_BASE_URL}metadata.json`), fetchJSON(`${DATA_BASE_URL}courses.json`)]);
    indexData = i; metadata = m; courseData = c;
  }
  async function ensureTeacherChunk(chunkId) {
    if (teacherChunks.has(chunkId)) return;
    teacherChunks.set(chunkId, await fetchJSON(`${DATA_BASE_URL}teachers_${chunkId}.json`));
  }
  function findTeacherById(id) {
    const idx = indexData.find(t => t.id === id);
    if (!idx) return null;
    const chunk = teacherChunks.get(idx.c);
    return chunk ? chunk.find(x => x.id === id) : null;
  }
  function detectEntities(question) {
    const q = (question || '').toLowerCase().trim();
    if (!q) return { teachers: [], courses: [] };
    const tokens = q.split(/[\s,，。；;、]+/).filter(Boolean);
    const matchedTeachers = indexData.filter(t => { for (const tok of tokens) if (tok && (t.s || '').toLowerCase().includes(tok)) return true; return false; }).slice(0, SHOW_LIMIT);
    const matchedCourses = Object.keys(courseData || {}).filter(name => { for (const tok of tokens) if (tok && name.toLowerCase().includes(tok)) return true; return false; }).slice(0, SHOW_LIMIT);
    return { teachers: matchedTeachers, courses: matchedCourses };
  }
  function retrieveComments(question, teacherIds = []) {
    const q = (question || '').toLowerCase();
    let results = [];
    for (const tMeta of indexData) {
      if (teacherIds.length && !teacherIds.includes(tMeta.id)) continue;
      const chunk = teacherChunks.get(tMeta.c);
      if (!chunk) continue;
      const tFull = chunk.find(x => x.id === tMeta.id);
      if (!tFull || !Array.isArray(tFull.m)) continue;
      for (const c of tFull.m) {
        let score = c.p || 0;
        if (q && (c.c || '').toLowerCase().includes(q)) score += 8;
        results.push({ content: c.c, up: c.u, teacherName: tFull.n, score });
      }
    }
    return results.sort((a, b) => b.score - a.score).slice(0, MAX_COMMENTS_IN_CONTEXT);
  }
  function buildContext({ teachers = [], courses = [], comments = [] }) {
    const teacherSummaries = teachers.map(t => {
        const full = findTeacherById(t.id);
        if (!full) return '';
        const gpa = (Array.isArray(full.g) && full.g.length) ? full.g.slice(0, 5).map(c => `${c[0]}:${(+c[1]||0).toFixed(2)}`).join('|') : '无';
        return `老师:${full.n}|学院:${full.d}|评分:${(+full.r||0).toFixed(2)}(${full.rc}人)|GPA:${gpa}`;
    }).filter(Boolean);
    const courseSummaries = courses.map(name => {
        const top = (courseData[name]||[]).sort((a,b)=>+b.g- +a.g).slice(0,5).map(x=>`${x.t}:${(+x.g||0).toFixed(2)}`).join('|');
        return `课程:${name}|绩点排行:${top||'无'}`;
    });
    const commentSummaries = comments.map(c => `【${c.teacherName}|👍${c.up}】${(c.content||'').slice(0,120)}`);
    const context = [
      '你是助教机器人。优先使用以下数据回答。无法确定时必须说明不知道；不要编造事实。保持客观中立。',
      '找不到相关数据时，提示“未检索到相关数据”，并建议用户改用拼音/缩写。',
      teacherSummaries.length ? '【教师元信息】\n' + teacherSummaries.join('\n') : '',
      courseSummaries.length ? '【课程/绩点信息】\n' + courseSummaries.join('\n') : '',
      commentSummaries.length ? '【相关评论】\n' + commentSummaries.join('\n') : ''
    ].filter(Boolean).join('\n\n');
    return { context, citations: commentSummaries.slice(0, 5) };
  }
  async function handleSend() {
    const question = (chatInput.value || '').trim();
    if (!question) return;
    appendMessage('user', question);
    chatInput.value = '';
    setSendingState(true);
    const cacheKey = JSON.stringify({ q: question, m: chatMode.value });
    const cached = cacheGet(cacheKey);
    if (cached) {
      appendMessage('ai', cached.answer, cached.citations);
      setSendingState(false);
      return;
    }
    try {
      await ensureInitialData();
      const entities = detectEntities(question);
      await Promise.all([...new Set(entities.teachers.map(t => t.c))].map(cid => ensureTeacherChunk(cid)));
      const comments = retrieveComments(question, entities.teachers.map(t => t.id));
      const mode = chatMode.value;
      const { context, citations } = buildContext({ teachers: mode === 'course' ? [] : entities.teachers, courses: mode === 'teacher' ? [] : entities.courses, comments });
      const ctrl = new AbortController(), timer = setTimeout(()=>ctrl.abort(), TIMEOUT_MS);
      const resp = await fetch(`${API_BASE}/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'system', content: context }, { role: 'user', content: question }], model: 'glm-4.5-flash' }), signal: ctrl.signal });
      clearTimeout(timer);
      if (!resp.ok) throw new Error(`网关请求失败: ${resp.status}`);
      const data = await resp.json();
      const answer = data?.choices?.[0]?.message?.content || '（无内容）';
      appendMessage('ai', answer, citations);
      cacheSet(cacheKey, { answer, citations });
    } catch (e) {
      appendMessage('ai', `抱歉，请求出错。请稍后再试。\n错误: ${e.message}`);
    } finally {
      setSendingState(false);
    }
  }
  sendBtn.addEventListener('click', handleSend);
  chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }});
  appendMessage('ai', '你好！我是教师与课程助手。\n你可以问我关于老师、课程、GPA和学生评价的问题。');
});

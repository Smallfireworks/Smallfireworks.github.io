
document.addEventListener('DOMContentLoaded', function() {
  'use strict';

  const searchApp = document.getElementById('teacher-search-app');
  const DATA_BASE_URL = searchApp.dataset.baseUrl;
  
  const DISPLAY_LIMIT = 60;
  const SLICE_RENDER_BATCH = 20;
  const SEARCH_DEBOUNCE = 260;
  const MAX_RETRY = 2;

  let indexData = null, metadata = null, courseData = null;
  let loadedTeachers = new Map();
  let searchRequestCounter = 0;
  let deptActiveIndex = -1;
  let teacherCommentsSortState = new Map();

  const searchInput = document.getElementById('searchInput');
  const clearSearchBtn = document.getElementById('clearSearch');
  const departmentInput = document.getElementById('departmentInput');
  const departmentDropdown = document.getElementById('departmentDropdown');
  const teacherList = document.getElementById('teacher-list');
  const modalContainer = document.getElementById('modal-container');
  const backToTopButton = document.getElementById('back-to-top');

  function debounce(func, wait) {
    let timeout;
    return function(...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), wait);
    };
  }

  async function fetchWithRetry(url, retries = MAX_RETRY) {
    for (let i = 0; i <= retries; i++) {
      try {
        const res = await fetch(url, { cache: 'no-cache' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return await res.json();
      } catch (err) {
        if (i === retries) throw err;
        await new Promise(r => setTimeout(r, 150 * (i + 1)));
      }
    }
  }
  
  async function loadInitialData() {
    try {
      const [i, m, c] = await Promise.all([
        fetchWithRetry(`${DATA_BASE_URL}index.json`),
        fetchWithRetry(`${DATA_BASE_URL}metadata.json`),
        fetchWithRetry(`${DATA_BASE_URL}courses.json`)
      ]);
      indexData = i; metadata = m; courseData = c;
    } catch (error) {
      console.error('Error loading initial data:', error);
      teacherList.innerHTML = '<p class="info-message">数据加载失败，请检查网络或稍后重试。</p>';
    }
  }

  function renderSkeletonLoader(count) {
    const skeletonCard = `
      <div class="skeleton-card" aria-hidden="true">
        <div class="teacher-header"><div class="skeleton-line title shimmer"></div><div class="skeleton-line dept shimmer"></div></div>
        <div class="skeleton-line text shimmer"></div><div class="skeleton-line w-75 shimmer"></div>
      </div>`;
    return Array(count).fill(skeletonCard).join('');
  }

  async function searchTeachers() {
    const currentRequest = ++searchRequestCounter;
    const searchTerm = searchInput.value.toLowerCase().trim();
    const deptTerm = (departmentInput.value || '').toLowerCase().trim();

    clearSearchBtn.classList.toggle('hidden', searchInput.value.length === 0);

    if (!indexData) return;

    if (searchTerm === '' && deptTerm === '') {
      teacherList.innerHTML = '<p class="initial-message">请输入教师姓名、拼音或选择学院以开始查询。</p>';
      return;
    }

    teacherList.innerHTML = renderSkeletonLoader(4);
    
    const matched = indexData.filter(t => 
        (!searchTerm || (t.s && t.s.includes(searchTerm))) &&
        (!deptTerm || (t.d && t.d.toLowerCase().includes(deptTerm)))
    );

    if (currentRequest !== searchRequestCounter) return;

    if (matched.length === 0) {
      teacherList.innerHTML = '<p class="info-message">没有找到符合条件的老师。</p>';
      return;
    }

    const toRender = matched.slice(0, DISPLAY_LIMIT);
    const chunkIds = new Set(toRender.map(t => t.c));

    try {
      await Promise.all(Array.from(chunkIds).map(loadTeacherChunk));
    } catch (error) {
      if (currentRequest === searchRequestCounter) teacherList.innerHTML = '<p class="info-message">加载教师数据时出错，请稍后重试。</p>';
      return;
    }
    if (currentRequest !== searchRequestCounter) return;

    teacherList.innerHTML = '';
    let offset = 0;
    function renderBatch() {
      if (currentRequest !== searchRequestCounter) return;
      const slice = toRender.slice(offset, offset + SLICE_RENDER_BATCH);
      const html = slice.map(idx => {
        const data = loadedTeachers.get(idx.c)?.find(x => x.id === idx.id);
        return data ? renderTeacherCard(data, searchTerm) : '';
      }).join('');
      teacherList.insertAdjacentHTML('beforeend', html);
      offset += SLICE_RENDER_BATCH;
      if (offset < toRender.length) {
        requestIdleCallback(renderBatch, { timeout: 200 });
      } else if (matched.length > DISPLAY_LIMIT) {
        teacherList.insertAdjacentHTML('beforeend', `<p class="info-message">结果过多，仅显示前 ${DISPLAY_LIMIT} 条（共 ${matched.length} 条）。</p>`);
      }
    }
    renderBatch();
  }
  
  async function loadTeacherChunk(chunkId) {
    if (loadedTeachers.has(chunkId)) return;
    const url = `${DATA_BASE_URL}teachers_${chunkId}.json`;
    try {
      const data = await fetchWithRetry(url);
      loadedTeachers.set(chunkId, data);
    } catch (error) {
      console.error(`Error loading chunk ${chunkId}:`, error); throw error;
    }
  }

  function highlightTerm(text, term) {
    if (!term) return text;
    const regex = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return text.replace(regex, '<strong>$1</strong>');
  }

  function renderTeacherCard(t, searchTerm) {
    const hasGpa = Array.isArray(t.g) && t.g.length > 0;
    const hasComments = Array.isArray(t.m) && t.m.length > 0;
    const displayName = searchTerm ? highlightTerm(t.n, searchTerm) : t.n;
    
    let html = `<div class="teacher-card" role="article" aria-labelledby="teacher-name-${t.id}"><div class="teacher-header"><span id="teacher-name-${t.id}" class="teacher-name">${displayName}</span><span class="teacher-dept">${t.d || ''}</span></div><div class="teacher-stats"><span><b>评分:</b> ${(parseFloat(t.r) || 0).toFixed(2)} (${t.rc}人)</span><span><b>热度:</b> ${t.h}</span></div>`;
    if (hasGpa) html += `<button type="button" class="collapsible" aria-expanded="false" aria-controls="gpa-${t.id}" data-cid="${t.id}">课程GPA信息 (${t.g.length})</button><div class="collapsible-content" id="gpa-${t.id}"><div class="content-inner">${renderGpaTable(t)}</div></div>`;
    if (hasComments) {
      const sortBy = teacherCommentsSortState.get(t.id) || 'popularity';
      html += `<button type="button" class="collapsible" aria-expanded="false" aria-controls="comments-${t.id}" data-cid="${t.id}">学生评价 (${t.m.length})</button><div class="collapsible-content" id="comments-${t.id}" data-teacher-id="${t.id}"><div class="content-inner">${renderCommentsContainer(t, sortBy)}</div></div>`;
    }
    if (!hasGpa && !hasComments) html += `<p style="text-align:center;color:#888;padding:15px 0;">暂无课程GPA或学生评价数据</p>`;
    html += `</div>`;
    return html;
  }

  function renderGpaTable(t) { return `<table class="gpa-table" aria-label="课程GPA"><thead><tr><th>课程名</th><th>平均绩点±标准差</th><th>选课人数</th></tr></thead><tbody>${t.g.map(c => `<tr><td><a href="#" class="course-link" data-course-name="${c[0]}" data-teacher-name="${t.n}">${c[0]}</a></td><td>${(parseFloat(c[1])||0).toFixed(2)} ± ${(parseFloat(c[3])||0).toFixed(2)}</td><td>${c[2] === 0 ? '500+' : c[2]}</td></tr>`).join('')}</tbody></table>`; }
  function renderCommentsContainer(teacher, sortBy = 'popularity') { return `<div class="comment-controls"><span class="comment-count-display">共 ${teacher.m.length} 条</span><div class="comment-sort-buttons"><button class="sort-btn ${sortBy === 'popularity' ? 'active' : ''}" data-sort="popularity">按人气</button><button class="sort-btn ${sortBy === 'time' ? 'active' : ''}" data-sort="time">按时间</button></div></div><div class="comments-list">${renderSortedComments(teacher.m, sortBy)}</div>`; }
  function renderSortedComments(comments, sortBy) {
    const sorted = [...comments].sort((a, b) => (sortBy === 'time') ? (b.t || '').localeCompare(a.t || '') : (b.p || 0) - (a.p || 0));
    return sorted.map(c => `<div class="comment"><div class="comment-body" style="white-space: pre-wrap;">${(c.c || '').replace(/\n/g, '\n')}</div><div class="comment-meta"><span>${c.t || ''}</span><span class="comment-likes"><span class="like">👍 ${c.u || 0}</span> | <span class="dislike">👎 ${c.d || 0}</span></span></div></div>`).join('');
  }

  function showCourseModal(courseName, currentTeacherName) {
    const courseInfo = courseData[courseName]; if (!courseInfo) return;
    const modalId = `modal-title-${courseName.replace(/\W/g, '-')}`;
    const rows = [...courseInfo].sort((a,b) => (parseFloat(b.g)||0) - (parseFloat(a.g)||0)).map(t => `<tr class="${t.t === currentTeacherName ? 'highlight-row' : ''}"><td>${t.t}</td><td>${(parseFloat(t.g)||0).toFixed(2)} ± ${(parseFloat(t.s)||0).toFixed(2)}</td><td>${t.n === 0 ? '500+' : t.n}</td></tr>`).join('');
    modalContainer.innerHTML = `<div class="modal-overlay visible" role="dialog" aria-modal="true" aria-labelledby="${modalId}"><div class="modal-content"><div class="modal-header"><h2 class="modal-title" id="${modalId}">${courseName}</h2><button class="modal-close" aria-label="关闭">×</button></div><div class="table-container"><table class="gpa-table"><thead><tr><th>老师姓名</th><th>平均绩点±标准差</th><th>人数</th></tr></thead><tbody>${rows}</tbody></table></div></div></div>`;
    modalContainer.classList.remove('modal-hidden'); modalContainer.setAttribute('aria-hidden', 'false'); document.body.classList.add('modal-open');
    modalContainer.querySelector('.modal-close').focus();
  }
  function closeModal() {
    const overlay = modalContainer.querySelector('.modal-overlay');
    if (overlay) { overlay.classList.remove('visible'); overlay.querySelector('.modal-content').style.transform = 'scale(0.95)'; }
    document.body.classList.remove('modal-open'); modalContainer.setAttribute('aria-hidden', 'true');
    setTimeout(() => { modalContainer.classList.add('modal-hidden'); modalContainer.innerHTML = ''; }, 300);
  }

  function updateDepartmentDropdown() {
    if (!metadata) return;
    const filter = (departmentInput.value || '').toLowerCase();
    const filtered = metadata.d.filter(dept => dept.toLowerCase().includes(filter));
    if (filtered.length === 0) { departmentDropdown.classList.add('hidden'); return; }
    departmentDropdown.innerHTML = filtered.map((dept, i) => `<div class="dept-dropdown-item ${i===0?'active':''}" role="option" data-value="${dept}">${dept}</div>`).join('');
    deptActiveIndex = 0; departmentDropdown.classList.remove('hidden');
  }
  function moveDeptActive(delta) {
    const items = Array.from(departmentDropdown.querySelectorAll('.dept-dropdown-item'));
    if (items.length === 0) return;
    items[deptActiveIndex].classList.remove('active');
    deptActiveIndex = (deptActiveIndex + delta + items.length) % items.length;
    items[deptActiveIndex].classList.add('active');
    items[deptActiveIndex].scrollIntoView({ block: 'nearest' });
  }

  const debouncedSearch = debounce(searchTeachers, SEARCH_DEBOUNCE);
  searchInput.addEventListener('input', debouncedSearch);
  departmentInput.addEventListener('input', () => { updateDepartmentDropdown(); debouncedSearch(); });
  departmentInput.addEventListener('focus', updateDepartmentDropdown);
  clearSearchBtn.addEventListener('click', () => { searchInput.value = ''; searchInput.focus(); debouncedSearch(); });
  document.addEventListener('click', (e) => {
    if (!departmentInput.contains(e.target) && !departmentDropdown.contains(e.target)) departmentDropdown.classList.add('hidden');
    if (e.target.classList.contains('dept-dropdown-item')) { departmentInput.value = e.target.dataset.value; departmentDropdown.classList.add('hidden'); departmentInput.focus(); searchTeachers(); }
  });
  departmentInput.addEventListener('keydown', (e) => {
    if (departmentDropdown.classList.contains('hidden')) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); moveDeptActive(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveDeptActive(-1); }
    else if (e.key === 'Enter') { const active = departmentDropdown.querySelector('.dept-dropdown-item.active'); if (active) { departmentInput.value = active.dataset.value; departmentDropdown.classList.add('hidden'); searchTeachers(); } }
    else if (e.key === 'Escape') { departmentDropdown.classList.add('hidden'); }
  });
  teacherList.addEventListener('click', e => {
    const target = e.target;
    if (target.classList.contains('collapsible')) { target.classList.toggle('active'); const isExpanded = target.classList.contains('active'); target.setAttribute('aria-expanded', isExpanded); const content = target.nextElementSibling; if (content) content.style.maxHeight = isExpanded ? (content.scrollHeight + 'px') : null; }
    else if (target.matches('.course-link, .course-link *')) { e.preventDefault(); const link = target.closest('.course-link'); showCourseModal(link.dataset.courseName, link.dataset.teacherName); }
    else if (target.matches('.sort-btn') && !target.classList.contains('active')) {
      e.preventDefault(); const sortBy = target.dataset.sort; const contentWrapper = target.closest('.collapsible-content'); const teacherId = parseInt(contentWrapper.dataset.teacherId, 10);
      const idx = indexData.find(t => t.id === teacherId); if (!idx) return;
      const teacher = loadedTeachers.get(idx.c)?.find(x => x.id === teacherId); if (!teacher) return;
      const commentsListEl = contentWrapper.querySelector('.comments-list'); const sortButtons = contentWrapper.querySelectorAll('.sort-btn');
      commentsListEl.innerHTML = renderSortedComments(teacher.m, sortBy);
      sortButtons.forEach(btn => btn.classList.remove('active')); target.classList.add('active');
      teacherCommentsSortState.set(teacherId, sortBy);
      if (contentWrapper.style.maxHeight) contentWrapper.style.maxHeight = contentWrapper.scrollHeight + 'px';
    }
  });
  modalContainer.addEventListener('click', e => { if (e.target.matches('.modal-overlay, .modal-close, .modal-close *')) closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modalContainer.classList.contains('modal-hidden')) closeModal(); });
  window.addEventListener('scroll', () => { backToTopButton.classList.toggle('visible', window.scrollY > 300); }, { passive: true });
  backToTopButton.addEventListener('click', () => { window.scrollTo({ top: 0, behavior: 'smooth' }); });

  (async () => {
    teacherList.innerHTML = renderSkeletonLoader(3);
    await loadInitialData();
    if (indexData) {
      teacherList.innerHTML = '<p class="initial-message">请输入教师姓名、拼音或选择学院以开始查询。</p>';
    }
  })();
});

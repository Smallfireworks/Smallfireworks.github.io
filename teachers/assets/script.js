
document.addEventListener('DOMContentLoaded', function() {
    'use strict';
    const DATA_BASE_URL = '/teachers/data/';
    const DISPLAY_LIMIT = 50;
    
    let indexData = null, metadata = null, courseData = null;
    let loadedTeachers = new Map();
    let searchRequestCounter = 0;
    
    const searchApp = document.getElementById('teacher-search-app');
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
    
    async function loadInitialData() {
        try {
            const [indexRes, metaRes, courseRes] = await Promise.all([
                fetch(`${DATA_BASE_URL}index.json`),
                fetch(`${DATA_BASE_URL}metadata.json`),
                fetch(`${DATA_BASE_URL}courses.json`)
            ]);
            if (!indexRes.ok || !metaRes.ok || !courseRes.ok) throw new Error('Failed to load initial data');
            indexData = await indexRes.json();
            metadata = await metaRes.json();
            courseData = await courseRes.json();
        } catch (error) {
            console.error('Error loading initial data:', error);
            teacherList.innerHTML = '<p class="info-message">数据加载失败，请刷新页面重试。</p>';
        }
    }
    
    function renderSkeletonLoader(count) {
        const skeletonCard = `<div class="skeleton-card" aria-hidden="true"><div class="teacher-header"><div class="skeleton-line title shimmer"></div><div class="skeleton-line dept shimmer"></div></div><div class="skeleton-line text shimmer"></div><div class="skeleton-line w-75 shimmer"></div></div>`;
        return Array(count).fill(skeletonCard).join('');
    }
    
    async function searchTeachers() {
        const currentRequest = ++searchRequestCounter;
        const searchTerm = searchInput.value.toLowerCase().trim();
        const deptTerm = departmentInput.value.toLowerCase().trim();
        
        clearSearchBtn.classList.toggle('hidden', searchTerm === '');
        
        if (!indexData) return;
        if (searchTerm === '' && deptTerm === '') {
            teacherList.innerHTML = '<p class="initial-message">请输入教师姓名、拼音或选择学院以开始查询。</p>';
            return;
        }
        
        teacherList.innerHTML = renderSkeletonLoader(5);
        
        const matchedTeachers = indexData.filter(teacher => 
            (!searchTerm || teacher.search_string.includes(searchTerm)) &&
            (!deptTerm || (teacher.dept && teacher.dept.toLowerCase().includes(deptTerm)))
        );
        
        if (currentRequest !== searchRequestCounter) return;
        
        if (matchedTeachers.length === 0) {
            teacherList.innerHTML = '<p class="info-message">没有找到符合条件的老师。</p>';
            return;
        }
        
        const teachersToRender = matchedTeachers.slice(0, DISPLAY_LIMIT);
        const chunksToLoad = new Set(teachersToRender.map(t => t.chunk_id));
        
        try {
            await Promise.all(Array.from(chunksToLoad).map(loadTeacherChunk));
        } catch (error) {
            if (currentRequest === searchRequestCounter) {
                 teacherList.innerHTML = '<p class="info-message">加载教师数据时出错，请稍后重试。</p>';
            }
            return;
        }

        if (currentRequest !== searchRequestCounter) return;

        teacherList.innerHTML = teachersToRender.map(teacherIndex => {
            const teacherData = loadedTeachers.get(teacherIndex.chunk_id)?.find(t => t.id === teacherIndex.id);
            return teacherData ? renderTeacherCard(teacherData, searchTerm) : '';
        }).join('');
        
        if (matchedTeachers.length > DISPLAY_LIMIT) {
            teacherList.insertAdjacentHTML('beforeend', `<p class="info-message">结果过多，仅显示前 ${DISPLAY_LIMIT} 条（共 ${matchedTeachers.length} 条）。</p>`);
        }
    }

    async function loadTeacherChunk(chunkId) {
        if (loadedTeachers.has(chunkId)) return;
        try {
            const response = await fetch(`${DATA_BASE_URL}teachers_${chunkId}.json`);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            loadedTeachers.set(chunkId, await response.json());
        } catch (error) { 
            console.error(`Error loading chunk ${chunkId}:`, error);
            throw error;
        }
    }
    
    function highlightTerm(text, term) {
        if (!term) return text;
        const regex = new RegExp(`(${term.replace(/[-\/\^$*+?.()|[\]{}]/g, '\\$&')})`, 'gi');
        return text.replace(regex, '<strong>$1</strong>');
    }

    function renderTeacherCard(teacher, searchTerm) {
        const hasGpa = Array.isArray(teacher.gpa_info) && teacher.gpa_info.length > 0;
        const hasComments = Array.isArray(teacher.comments) && teacher.comments.length > 0;
        
        const gpaHtml = hasGpa ? `<button type="button" class="collapsible" aria-expanded="false" aria-controls="gpa-${teacher.id}">课程GPA信息 (${teacher.gpa_info.length})</button><div class="collapsible-content" id="gpa-${teacher.id}"><div class="content-inner"><table class="gpa-table"><thead><tr><th>课程名</th><th>平均绩点±标准差</th><th>选课人数</th></tr></thead><tbody>${teacher.gpa_info.map(c=>`<tr><td><a href="#" class="course-link" data-course-name="${c[0]}" data-teacher-name="${teacher.姓名}">${c[0]}</a></td><td>${(parseFloat(c[1])||0).toFixed(2)} ± ${(parseFloat(c[3])||0).toFixed(2)}</td><td>${c[2] === 0 ? '500+' : c[2]}</td></tr>`).join('')}</tbody></table></div></div>` : '';
        const commentsHtml = hasComments ? `<button type="button" class="collapsible" aria-expanded="false" aria-controls="comments-${teacher.id}">学生评价 (${teacher.comments.length})</button><div class="collapsible-content" id="comments-${teacher.id}" data-teacher-id="${teacher.id}"><div class="content-inner">${renderCommentsContainer(teacher)}</div></div>` : '';
        const noDataMsg = !hasGpa && !hasComments ? '<p style="text-align:center;color:#888;padding:15px 0;">暂无课程GPA或学生评价数据</p>' : '';
        const displayName = searchTerm ? highlightTerm(teacher.姓名, searchTerm) : teacher.姓名;

        return `<div class="teacher-card" role="article" aria-labelledby="teacher-name-${teacher.id}"><div class="teacher-header"><span id="teacher-name-${teacher.id}" class="teacher-name">${displayName}</span><span class="teacher-dept">${teacher.学院}</span></div><div class="teacher-stats"><span><b>评分:</b> ${(parseFloat(teacher.评分)||0).toFixed(2)} (${teacher.评分人数}人)</span><span><b>热度:</b> ${teacher.热度}</span></div>${gpaHtml}${commentsHtml}${noDataMsg}</div>`;
    }

    function renderCommentsContainer(teacher, sortBy = 'popularity') {
        const comments = teacher.comments || [];
        const controls = `<div class="comment-controls"><span class="comment-count-display">共 ${comments.length} 条</span><div class="comment-sort-buttons"><button class="sort-btn ${sortBy === 'popularity' ? 'active' : ''}" data-sort="popularity">按人气</button><button class="sort-btn ${sortBy === 'time' ? 'active' : ''}" data-sort="time">按时间</button></div></div>`;
        return controls + `<div class="comments-list">${renderSortedComments(comments, sortBy)}</div>`;
    }

    function renderSortedComments(comments, sortBy) {
        const sortedComments = [...comments].sort((a, b) => {
            if (sortBy === 'time') {
                return (b.发表时间 || '').localeCompare(a.发表时间 || '');
            }
            return (b.点赞减去点踩数量 || 0) - (a.点赞减去点踩数量 || 0);
        });

        return sortedComments.map(c => {
                const safeContent = (c.内容 || '').replace(/\n/g, '\n');
                return `<div class="comment"><div class="comment-body" style="white-space: pre-wrap;">${safeContent}</div><div class="comment-meta"><span>${c.发表时间}</span><span class="comment-likes"><span class="like">👍 ${c.点赞量}</span> | <span class="dislike">👎 ${c.点踩量}</span></span></div></div>`;
        }).join('');
    }

    function showCourseModal(courseName, currentTeacherName) {
        const courseInfo = courseData[courseName];
        if (!courseInfo) return;
        const modalId = `modal-title-${courseName.replace(/\W/g, '-')}`;
        const renderCount = (count) => count === 0 ? '500+' : count;
        modalContainer.innerHTML = `<div class="modal-overlay visible" role="dialog" aria-modal="true" aria-labelledby="${modalId}"><div class="modal-content"><div class="modal-header"><h2 class="modal-title" id="${modalId}">${courseName}</h2><button class="modal-close" aria-label="关闭">×</button></div><div class="table-container"><table class="gpa-table"><thead><tr><th>老师姓名</th><th>平均绩点±标准差</th><th>人数</th></tr></thead><tbody>${[...courseInfo].sort((a,b)=>parseFloat(b.avg_gpa)-parseFloat(a.avg_gpa)).map(t=>`<tr class="${t.teacher===currentTeacherName?'highlight-row':''}"><td>${t.teacher}</td><td>${(parseFloat(t.avg_gpa)||0).toFixed(2)} ± ${(parseFloat(t.std_dev)||0).toFixed(2)}</td><td>${renderCount(t.count)}</td></tr>`).join('')}</tbody></table></div></div></div>`;
        modalContainer.classList.remove('modal-hidden');
        document.body.classList.add('modal-open');
        modalContainer.querySelector('.modal-close').focus();
    }

    function closeModal() {
        const overlay = modalContainer.querySelector('.modal-overlay');
        if(overlay) overlay.classList.remove('visible');
        document.body.classList.remove('modal-open');
        setTimeout(() => { modalContainer.classList.add('modal-hidden'); modalContainer.innerHTML = ''; }, 300);
    }
    
    function updateDepartmentDropdown() {
        if (!metadata) return;
        const filter = departmentInput.value.toLowerCase();
        const filteredDepts = metadata.departments.filter(dept => dept.toLowerCase().includes(filter));
        if (filteredDepts.length === 0) { departmentDropdown.classList.add('hidden'); return; }
        departmentDropdown.innerHTML = filteredDepts.map(dept => `<div class="dept-dropdown-item" role="option" data-value="${dept}">${dept}</div>`).join('');
        departmentDropdown.classList.remove('hidden');
    }

    const debouncedSearch = debounce(searchTeachers, 300);
    searchInput.addEventListener('input', debouncedSearch);
    departmentInput.addEventListener('input', () => { updateDepartmentDropdown(); debouncedSearch(); });
    departmentInput.addEventListener('focus', updateDepartmentDropdown);

    clearSearchBtn.addEventListener('click', () => {
        searchInput.value = '';
        searchInput.focus();
        debouncedSearch();
    });

    document.addEventListener('click', (e) => {
        if (!departmentInput.contains(e.target) && !departmentDropdown.contains(e.target)) departmentDropdown.classList.add('hidden');
        if (e.target.classList.contains('dept-dropdown-item')) {
            departmentInput.value = e.target.dataset.value;
            departmentDropdown.classList.add('hidden');
            departmentInput.focus();
            searchTeachers();
        }
    });

    window.addEventListener('scroll', () => { backToTopButton.classList.toggle('visible', window.scrollY > 300); }, { passive: true });
    backToTopButton.addEventListener('click', () => { window.scrollTo({ top: 0, behavior: 'smooth' }); });

    teacherList.addEventListener('click', e => {
        const target = e.target;
        if (target.classList.contains('collapsible')) {
            target.classList.toggle('active');
            const isExpanded = target.classList.contains('active');
            target.setAttribute('aria-expanded', isExpanded);
            const content = target.nextElementSibling;
            if(content) content.style.maxHeight = isExpanded ? content.scrollHeight + 'px' : null;
        } else if (target.matches('.course-link, .course-link *')) {
            e.preventDefault();
            const link = target.closest('.course-link');
            showCourseModal(link.dataset.courseName, link.dataset.teacherName);
        } else if (target.matches('.sort-btn:not(.active)')) {
            e.preventDefault();
            const sortBy = target.dataset.sort;
            const contentWrapper = target.closest('.collapsible-content');
            const teacherId = parseInt(contentWrapper.dataset.teacherId, 10);
            const chunkId = indexData.find(t=>t.id === teacherId).chunk_id;
            const teacher = loadedTeachers.get(chunkId).find(t => t.id === teacherId);
            
            if (teacher) {
                const commentsListEl = contentWrapper.querySelector('.comments-list');
                const sortButtons = contentWrapper.querySelectorAll('.sort-btn');
                
                commentsListEl.innerHTML = renderSortedComments(teacher.comments, sortBy);
                
                sortButtons.forEach(btn => btn.classList.remove('active'));
                target.classList.add('active');
                
                if (contentWrapper.style.maxHeight) {
                    contentWrapper.style.maxHeight = contentWrapper.scrollHeight + 'px';
                }
            }
        }
    });

    modalContainer.addEventListener('click', e => { if (e.target.matches('.modal-overlay, .modal-close, .modal-close *')) closeModal(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modalContainer.classList.contains('modal-hidden')) closeModal(); });
    
    (async () => {
        teacherList.innerHTML = renderSkeletonLoader(3);
        await loadInitialData();
        if(indexData) {
            teacherList.innerHTML = '<p class="initial-message">请输入教师姓名、拼音或选择学院以开始查询。</p>';
        }
    })();
});

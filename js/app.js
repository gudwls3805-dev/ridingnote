// =========================================
// 라이딩노트 프론트엔드 스크립트
// 1) 모바일 메뉴  2) 현재 섹션 메뉴 표시
// 3) AI 코스 추천 (fetch → /api/recommend)  4) 체크리스트 진행률
// =========================================

const SLOW_NOTICE_MS = 8000;   // 8초가 지나면 "조금만 기다려 주세요" 안내
const TIMEOUT_MS = 30000;      // 30초가 지나면 요청을 중단하고 타임아웃 안내
const NOTE_LIMIT = 200;

// ---------- 1. 모바일 메뉴 ----------
const menuToggle = document.querySelector('.menu-toggle');
const siteNav = document.querySelector('#site-nav');

menuToggle.addEventListener('click', () => {
  const isOpen = siteNav.classList.toggle('open');
  menuToggle.setAttribute('aria-expanded', String(isOpen));
  menuToggle.setAttribute('aria-label', isOpen ? '메뉴 닫기' : '메뉴 열기');
});

// 메뉴를 누르면 모바일 메뉴를 닫는다
siteNav.querySelectorAll('a').forEach((link) => {
  link.addEventListener('click', () => {
    siteNav.classList.remove('open');
    menuToggle.setAttribute('aria-expanded', 'false');
  });
});

// ---------- 2. 스크롤 위치에 맞춰 메뉴 강조 ----------
const navLinks = [...siteNav.querySelectorAll('a')];
const sectionObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (!entry.isIntersecting) return;
    navLinks.forEach((a) => {
      a.classList.toggle('active', a.getAttribute('href') === `#${entry.target.id}`);
    });
  });
}, { rootMargin: '-45% 0px -50% 0px' });
document.querySelectorAll('main section[id]').forEach((s) => sectionObserver.observe(s));

// ---------- 3. AI 코스 추천 ----------
const form = document.querySelector('#course-form');
const originInput = document.querySelector('#origin');
const noteInput = document.querySelector('#note');
const noteCount = document.querySelector('#note-count');
const submitBtn = document.querySelector('#submit-btn');
const formMessage = document.querySelector('#form-message');
const resultBox = document.querySelector('#result');

// 추가 요청 글자 수 표시
noteInput.addEventListener('input', () => {
  const len = noteInput.value.length;
  noteCount.textContent = len;
  noteCount.parentElement.classList.toggle('over', len > NOTE_LIMIT);
});

originInput.addEventListener('input', () => {
  originInput.classList.remove('invalid');
  hideMessage();
});

function showMessage(text, type = 'error') {
  formMessage.textContent = text;
  formMessage.className = `form-message${type === 'info' ? ' info' : ''}`;
  formMessage.hidden = false;
}

function hideMessage() {
  formMessage.hidden = true;
}

function setLoading(isLoading) {
  submitBtn.disabled = isLoading;   // 중복 클릭(중복 과금) 방지
  submitBtn.textContent = isLoading ? '코스 고르는 중…' : '코스 추천받기';
}

function renderLoading() {
  resultBox.innerHTML = `
    <div class="result-loading">
      <div class="spinner"></div>
      <p id="loading-text">조건에 맞는 길을 찾고 있어요…</p>
    </div>`;
}

function renderEmpty(text) {
  resultBox.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'result-empty';
  box.textContent = text;
  resultBox.appendChild(box);
}

// 작은 DOM 헬퍼: AI가 만든 글자는 innerHTML이 아니라 textContent로 넣어 XSS를 막는다
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function listSection(title, items, listClass) {
  const frag = document.createDocumentFragment();
  if (!items || items.length === 0) return frag;
  frag.appendChild(el('h4', null, title));
  const ul = el('ul', `plain ${listClass || ''}`);
  items.forEach((item) => ul.appendChild(el('li', null, item)));
  frag.appendChild(ul);
  return frag;
}

function renderCourses(courses) {
  resultBox.innerHTML = '';

  courses.forEach((course, i) => {
    const card = el('article', 'card course-card');

    const head = el('div', 'course-head');
    head.appendChild(el('span', 'course-num', String(i + 1)));
    head.appendChild(el('h3', null, course.name));
    card.appendChild(head);

    if (course.summary) card.appendChild(el('p', 'course-summary', course.summary));

    const meta = el('div', 'course-meta');
    if (course.duration) meta.appendChild(el('span', null, `⏱ ${course.duration}`));
    if (course.distance) meta.appendChild(el('span', null, `🛣 ${course.distance}`));
    if (meta.children.length) card.appendChild(meta);

    // 경유지: 누르면 네이버지도 검색으로 이동
    if (course.waypoints.length) {
      const ol = el('ol', 'waypoints');
      course.waypoints.forEach((place) => {
        const li = el('li');
        const a = el('a', null, place);
        a.href = `https://map.naver.com/p/search/${encodeURIComponent(place)}`;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        li.appendChild(a);
        ol.appendChild(li);
      });
      card.appendChild(ol);
    }

    card.appendChild(listSection('휴식·식사 포인트', course.stops));
    card.appendChild(listSection('주의사항', course.cautions, 'cautions'));
    resultBox.appendChild(card);
  });

  resultBox.appendChild(el('p', 'result-note',
    'AI 추천이므로 실제 도로 사정과 다를 수 있어요. 출발 전 지도 앱으로 경로를 꼭 확인하세요.'));
}

function getFormData() {
  const fd = new FormData(form);
  return {
    origin: (fd.get('origin') || '').trim(),
    duration: fd.get('duration'),
    style: fd.get('style'),
    displacement: fd.get('displacement'),
    note: (fd.get('note') || '').trim(),
  };
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  hideMessage();

  const data = getFormData();

  // [실패 처리 1] 빈 입력: 서버에 보내기 전에 막는다
  if (!data.origin) {
    originInput.classList.add('invalid');
    originInput.focus();
    showMessage('출발 지역을 입력해 주세요.');
    return;
  }
  if (data.note.length > NOTE_LIMIT) {
    noteInput.focus();
    showMessage(`추가 요청은 ${NOTE_LIMIT}자까지 입력할 수 있어요.`);
    return;
  }

  setLoading(true);
  renderLoading();

  // [실패 처리 3] 지연/타임아웃: 8초 뒤 안내, 30초 뒤 요청 중단
  const controller = new AbortController();
  const slowTimer = setTimeout(() => {
    const text = document.querySelector('#loading-text');
    if (text) text.textContent = '코스를 고르는 중이에요. 조금만 기다려 주세요.';
  }, SLOW_NOTICE_MS);
  const timeoutTimer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch('/api/recommend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      signal: controller.signal,
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null; // 서버가 JSON이 아닌 응답(예: Vercel 오류 페이지)을 줄 때
    }

    // [실패 처리 2] API 오류 (4xx/5xx)
    if (!response.ok) {
      const message = payload?.error || `잠시 후 다시 시도해 주세요. (오류 ${response.status})`;
      showMessage(message);
      renderEmpty('추천을 불러오지 못했어요.');
      return;
    }

    if (!payload?.courses?.length) {
      showMessage('추천 결과가 비어 있어요. 조건을 바꿔 다시 시도해 주세요.');
      renderEmpty('추천을 불러오지 못했어요.');
      return;
    }

    renderCourses(payload.courses);
    // 모바일에서는 결과가 폼 아래에 있으므로 결과로 스크롤
    if (window.innerWidth < 1024) {
      resultBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      showMessage('응답이 너무 늦어요. 조건을 줄여서 다시 시도해 주세요.');
    } else {
      showMessage('네트워크 연결을 확인하고 다시 시도해 주세요.');
    }
    renderEmpty('추천을 불러오지 못했어요.');
  } finally {
    clearTimeout(slowTimer);
    clearTimeout(timeoutTimer);
    setLoading(false);
  }
});

// ---------- 4. 체크리스트 진행률 ----------
const checkboxes = document.querySelectorAll('.check-card input[type="checkbox"]');
const checkProgress = document.querySelector('#check-progress');

function updateProgress() {
  const done = [...checkboxes].filter((c) => c.checked).length;
  checkProgress.textContent = `${done} / ${checkboxes.length}`;
}
checkboxes.forEach((c) => c.addEventListener('change', updateProgress));
updateProgress();

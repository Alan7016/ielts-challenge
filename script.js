/* ============================================
   IELTS MARATHON — shared logic
   ============================================ */

// ---------- Auth gate (used on every page that requires a login) ----------
// Every protected page must load supabase-config.js and the Supabase JS CDN
// script BEFORE this file. Call requireAuth(onReady) once the page loads;
// onReady receives the logged-in user's profile row (full_name, role, group_id).
let _sbClient = null;
function getSupabaseClient() {
  if (!_sbClient) _sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
  return _sbClient;
}

async function requireAuth(onReady) {
  const sb = getSupabaseClient();
  const { data: { session } } = await sb.auth.getSession();

  if (!session) {
    const returnTo = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `${pathToRoot()}login.html?returnTo=${returnTo}`;
    return;
  }

  const { data: profile } = await sb.from('profiles').select('full_name, role, group_id').eq('id', session.user.id).single();

  const gate = document.getElementById('gate');
  const content = document.getElementById('content');
  if (gate) gate.style.display = 'none';
  if (content) content.style.display = 'block';

  const greeting = document.getElementById('user-greeting');
  if (greeting && profile) greeting.textContent = profile.full_name;

  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      await sb.auth.signOut();
      window.location.href = `${pathToRoot()}login.html`;
    });
  }

  if (onReady) onReady(profile, session.user);
}

// Figures out how many '../' are needed to reach the project root,
// so the auth redirect works the same from index.html and from days/dayN.html.
function pathToRoot() {
  return window.location.pathname.includes('/days/') ? '../' : '';
}

// ---------- Stopwatch ----------
function initStopwatch(displayId, startBtnId, pauseBtnId, resetBtnId) {
  const display = document.getElementById(displayId);
  const startBtn = document.getElementById(startBtnId);
  const pauseBtn = document.getElementById(pauseBtnId);
  const resetBtn = document.getElementById(resetBtnId);
  let seconds = 0;
  let timer = null;

  function render() {
    const m = String(Math.floor(seconds / 60)).padStart(2, '0');
    const s = String(seconds % 60).padStart(2, '0');
    display.textContent = `${m}:${s}`;
  }

  startBtn.addEventListener('click', () => {
    if (timer) return;
    timer = setInterval(() => { seconds++; render(); }, 1000);
    startBtn.disabled = true;
    pauseBtn.disabled = false;
  });
  pauseBtn.addEventListener('click', () => {
    clearInterval(timer);
    timer = null;
    startBtn.disabled = false;
    pauseBtn.disabled = true;
  });
  resetBtn.addEventListener('click', () => {
    clearInterval(timer);
    timer = null;
    seconds = 0;
    render();
    startBtn.disabled = false;
    pauseBtn.disabled = true;
  });

  pauseBtn.disabled = true;
  render();
}

// ---------- Word counter ----------
function initWordCounter(textareaId, countId) {
  const textarea = document.getElementById(textareaId);
  const countEl = document.getElementById(countId);
  function update() {
    const text = textarea.value.trim();
    const count = text.length ? text.split(/\s+/).length : 0;
    countEl.textContent = count;
  }
  textarea.addEventListener('input', update);
  update();
}

// ---------- Copy button ----------
function initCopyButton(buttonId, textareaId) {
  const btn = document.getElementById(buttonId);
  const textarea = document.getElementById(textareaId);
  btn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(textarea.value);
      const original = btn.textContent;
      btn.textContent = 'Copied ✓';
      setTimeout(() => { btn.textContent = original; }, 1500);
    } catch (err) {
      textarea.select();
      document.execCommand('copy');
    }
  });
}

// ---------- Vocab task checker ----------
function checkVocab() {
  document.querySelectorAll('.vocab-item').forEach((item) => {
    const select = item.querySelector('select');
    const feedback = item.querySelector('.vocab-feedback');
    const correct = select.dataset.answer;
    if (select.value === '') {
      feedback.textContent = '';
      return;
    }
    if (select.value === correct) {
      feedback.textContent = '✓ correct';
      feedback.style.color = 'var(--good)';
    } else {
      feedback.textContent = '✗ try again';
      feedback.style.color = 'var(--warn)';
    }
  });
}

// ---------- Chunk toggle on sample answer ----------
function initChunkToggle(toggleId, sampleId) {
  const toggle = document.getElementById(toggleId);
  const sample = document.getElementById(sampleId);
  toggle.addEventListener('click', () => {
    sample.classList.toggle('hide-chunks');
    toggle.textContent = sample.classList.contains('hide-chunks')
      ? 'Show useful language'
      : 'Hide useful language';
  });
}

// ---------- Comprehension quiz (pass a containerId so reading and listening quizzes score independently) ----------
function checkComprehension(containerId, scoreId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const scope = container.querySelectorAll('.q-item');

  scope.forEach((item) => {
    const selected = item.querySelector('input[type="radio"]:checked');
    const result = item.querySelector('.q-result');
    item.querySelectorAll('label').forEach(l => l.classList.remove('answer'));
    item.classList.remove('correct', 'incorrect');

    if (!selected) {
      result.textContent = 'No answer selected.';
      result.style.color = 'var(--muted)';
      return;
    }
    const label = selected.closest('label');
    const isCorrect = selected.dataset.correct === 'true';
    label.classList.add('answer');
    if (isCorrect) {
      item.classList.add('correct');
      result.textContent = '✓ Correct';
      result.style.color = 'var(--good)';
    } else {
      item.classList.add('incorrect');
      result.textContent = '✗ Not quite — review and try again.';
      result.style.color = 'var(--warn)';
      const correctLabel = item.querySelector('input[data-correct="true"]').closest('label');
      correctLabel.style.borderColor = 'var(--good)';
    }
  });

  const scoreEl = document.getElementById(scoreId);
  if (scoreEl) {
    const total = scope.length;
    const correct = container.querySelectorAll('.q-item.correct').length;
    scoreEl.textContent = `Score: ${correct} / ${total}`;
  }
}

// ---------- Show/hide toggle (used for the listening transcript) ----------
function initCollapseToggle(buttonId, targetId, showLabel, hideLabel) {
  const btn = document.getElementById(buttonId);
  const target = document.getElementById(targetId);
  target.classList.add('collapsed');
  btn.textContent = showLabel;
  btn.addEventListener('click', () => {
    const nowCollapsed = target.classList.toggle('collapsed');
    btn.textContent = nowCollapsed ? showLabel : hideLabel;
  });
}

// ---------- Combined checker: radio-based q-items AND free-text note-completion inputs ----------
function checkAllAnswers(containerId, scoreId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  let total = 0;
  let correct = 0;

  // Radio-based q-items (T/F/NG, MCQ, etc.)
  container.querySelectorAll('.q-item').forEach((item) => {
    total++;
    const selected = item.querySelector('input[type="radio"]:checked');
    const result = item.querySelector('.q-result');
    item.querySelectorAll('label').forEach(l => l.classList.remove('answer'));
    item.classList.remove('correct', 'incorrect');

    if (!selected) {
      if (result) { result.textContent = 'No answer selected.'; result.style.color = 'var(--muted)'; }
      return;
    }
    const label = selected.closest('label');
    const isCorrect = selected.dataset.correct === 'true';
    label.classList.add('answer');
    if (isCorrect) {
      correct++;
      item.classList.add('correct');
      if (result) { result.textContent = '✓ Correct'; result.style.color = 'var(--good)'; }
    } else {
      item.classList.add('incorrect');
      if (result) { result.textContent = '✗ Not quite'; result.style.color = 'var(--warn)'; }
      const correctLabel = item.querySelector('input[data-correct="true"]');
      if (correctLabel) correctLabel.closest('label').style.borderColor = 'var(--good)';
    }
  });

  // Free-text note-completion inputs
  container.querySelectorAll('.text-answer').forEach((input) => {
    total++;
    const accepted = input.dataset.correct.split('/').map(s => s.trim().toLowerCase());
    const userVal = input.value.trim().toLowerCase();
    input.classList.remove('correct', 'incorrect');
    if (accepted.includes(userVal) && userVal !== '') {
      correct++;
      input.classList.add('correct');
      input.style.borderColor = 'var(--good)';
    } else {
      input.classList.add('incorrect');
      input.style.borderColor = 'var(--warn)';
      input.title = `Correct answer: ${input.dataset.correct}`;
    }
  });

  const scoreEl = document.getElementById(scoreId);
  if (scoreEl) scoreEl.textContent = `Score: ${correct} / ${total}`;
}

// ============================================
// TASK FLOW ENGINE — one task visible at a time, dots + Previous/Next,
// completion screen with confetti. Each day's HTML calls initTaskFlow(dayNumber, totalTasks).
// A task is considered "complete" (Next enabled) if every input.text-answer,
// select, and radio-group inside it has a value, OR — for link-out tasks —
// its confirm checkbox is ticked. Tasks with nothing to fill in are always complete.
// ============================================
function initTaskFlow(dayNumber, totalTasks) {
  const STATE_KEY = `marathon_day${dayNumber}_state`;
  let current = 1;
  try {
    const saved = JSON.parse(sessionStorage.getItem(STATE_KEY) || 'null');
    if (saved && saved.current) current = saved.current;
  } catch (e) {}

  const dotsWrap = document.getElementById('dots');
  for (let i = 1; i <= totalTasks; i++) {
    const d = document.createElement('div');
    d.className = 'dot';
    d.dataset.dot = i;
    dotsWrap.appendChild(d);
  }

  const doneTasks = {};

  function saveState() {
    try { sessionStorage.setItem(STATE_KEY, JSON.stringify({ current, doneTasks })); } catch (e) {}
  }

  function isTaskComplete(n) {
    const container = document.getElementById('task' + n);
    if (!container) return true;
    const confirmBox = container.querySelector('.confirm-row input[type="checkbox"]');
    if (confirmBox) return confirmBox.checked;

    const texts = container.querySelectorAll('input.text-answer, input[type="text"]:not(.no-check)');
    for (const t of texts) { if (t.value.trim() === '') return false; }
    const selects = container.querySelectorAll('select');
    for (const s of selects) { if (s.value === '') return false; }
    const radioNames = {};
    container.querySelectorAll('input[type="radio"]').forEach(r => {
      if (!(r.name in radioNames)) radioNames[r.name] = false;
      if (r.checked) radioNames[r.name] = true;
    });
    for (const g in radioNames) { if (!radioNames[g]) return false; }
    return true;
  }

  function refreshDots() {
    document.querySelectorAll('.dot').forEach(d => {
      const n = +d.dataset.dot;
      d.classList.toggle('done', !!doneTasks[n]);
      d.classList.toggle('current', n === current);
    });
  }

  function refreshNextButton() {
    const btn = document.getElementById('nextBtn');
    if (btn) btn.disabled = !isTaskComplete(current);
  }

  function showTask(n) {
    document.querySelectorAll('.task').forEach(t => t.classList.remove('active'));
    document.getElementById('task' + n).classList.add('active');
    document.getElementById('navInfo').textContent = `Task ${n} of ${totalTasks}`;
    document.getElementById('prevBtn').disabled = (n === 1);
    const nextBtn = document.getElementById('nextBtn');
    nextBtn.textContent = (n === totalTasks) ? 'Finish →' : 'Next →';
    refreshDots();
    refreshNextButton();
    window.scrollTo(0, 0);
  }

  function goPrev() {
    if (current > 1) { current--; saveState(); showTask(current); }
  }

  function goNext() {
    doneTasks[current] = true;
    saveState();
    refreshDots();
    if (current < totalTasks) {
      current++;
      saveState();
      showTask(current);
    } else {
      document.getElementById('completionScreen').classList.add('show');
      fireConfetti();
    }
  }

  function reviewDay() {
    document.getElementById('completionScreen').classList.remove('show');
    current = 1;
    saveState();
    showTask(1);
  }

  document.getElementById('prevBtn').addEventListener('click', goPrev);
  document.getElementById('nextBtn').addEventListener('click', goNext);
  const reviewBtn = document.getElementById('reviewBtn');
  if (reviewBtn) reviewBtn.addEventListener('click', reviewDay);

  document.addEventListener('input', refreshNextButton);
  document.addEventListener('change', refreshNextButton);

  showTask(current);
  initHighlightTool(dayNumber);
}

function fireConfetti() {
  const canvas = document.getElementById('confettiCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const colors = ['#3457d5', '#1f9d55', '#d5490f', '#f4b731'];
  const pieces = [];
  for (let i = 0; i < 130; i++) {
    pieces.push({
      x: Math.random() * canvas.width,
      y: -20 - Math.random() * canvas.height * 0.5,
      w: 6 + Math.random() * 6,
      h: 8 + Math.random() * 8,
      color: colors[Math.floor(Math.random() * colors.length)],
      speed: 2 + Math.random() * 3,
      drift: -1.5 + Math.random() * 3,
      rotation: Math.random() * 360,
      spin: -6 + Math.random() * 12
    });
  }
  const start = Date.now();
  function frame() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    pieces.forEach(p => {
      p.y += p.speed; p.x += p.drift; p.rotation += p.spin;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation * Math.PI / 180);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    });
    if (Date.now() - start < 3000) requestAnimationFrame(frame);
    else ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  requestAnimationFrame(frame);
}

// ---------- Text-selection highlight tool (persists per day via localStorage) ----------
function initHighlightTool(dayNumber) {
  const tools = document.getElementById('hlTools');
  const hlBtn = document.getElementById('hlBtn');
  const hlClear = document.getElementById('hlClear');
  if (!tools || !hlBtn || !hlClear) return;
  const HL_KEY = `marathon_hl_day${dayNumber}`;

  function save() {
    const texts = [];
    document.querySelectorAll('.hl').forEach(el => texts.push(el.textContent));
    try { localStorage.setItem(HL_KEY, JSON.stringify(texts)); } catch (e) {}
  }

  function apply(t) {
    if (!t.trim()) return;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        let p = n.parentNode;
        while (p) {
          const tag = p.tagName || '';
          if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'BUTTON' || p.className === 'hl') return NodeFilter.FILTER_REJECT;
          p = p.parentNode;
        }
        return n.textContent.indexOf(t) >= 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      }
    });
    let node, found = false;
    while ((node = walker.nextNode()) && !found) {
      const idx = node.textContent.indexOf(t);
      if (idx >= 0) {
        const r = document.createRange();
        r.setStart(node, idx);
        r.setEnd(node, idx + t.length);
        try {
          const sp = document.createElement('span');
          sp.className = 'hl';
          r.surroundContents(sp);
          found = true;
        } catch (e) {}
      }
    }
  }

  function restore() {
    try { JSON.parse(localStorage.getItem(HL_KEY) || '[]').forEach(apply); } catch (e) {}
  }

  document.addEventListener('mouseup', (e) => {
    if (tools.contains(e.target)) return;
    setTimeout(() => {
      const s = getSelection();
      if (!s || s.isCollapsed) { tools.style.display = 'none'; return; }
      const r = s.getRangeAt(0);
      if (!r.toString().trim()) { tools.style.display = 'none'; return; }
      const rc = r.getBoundingClientRect();
      tools.style.display = 'flex';
      tools.style.left = Math.max(8, rc.left + scrollX + rc.width / 2 - tools.offsetWidth / 2) + 'px';
      tools.style.top = Math.max(8, rc.top + scrollY - tools.offsetHeight - 8) + 'px';
    }, 1);
  });
  document.addEventListener('mousedown', (e) => {
    if (!tools.contains(e.target)) tools.style.display = 'none';
  });

  hlBtn.onclick = function () {
    const s = getSelection();
    if (!s || !s.rangeCount) return;
    const r = s.getRangeAt(0);
    try {
      const sp = document.createElement('span');
      sp.className = 'hl';
      r.surroundContents(sp);
    } catch (e) {}
    s.removeAllRanges();
    tools.style.display = 'none';
    save();
  };
  hlClear.onclick = function () {
    const s = getSelection();
    if (!s || !s.rangeCount) return;
    const r = s.getRangeAt(0);
    document.querySelectorAll('.hl').forEach(x => {
      if (r.intersectsNode(x)) {
        const p = x.parentNode;
        while (x.firstChild) p.insertBefore(x.firstChild, x);
        p.removeChild(x);
        p.normalize();
      }
    });
    s.removeAllRanges();
    tools.style.display = 'none';
    save();
  };

  restore();
}

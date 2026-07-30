/* ============================================
   IELTS MARATHON — shared logic
   Change ACCESS_CODE below to whatever code you give your students.
   No server, no storage: the code just has to be typed once per link.
   ============================================ */
const ACCESS_CODE = "MARATHON30";

// ---------- Gate (used on every page) ----------
// A page is unlocked if the URL has ?code=CORRECT_CODE.
// index.html builds day links with the code baked in, so once someone
// unlocks the marathon once, every day link they click stays unlocked.
function getCodeFromURL() {
  const params = new URLSearchParams(window.location.search);
  return params.get('code') || '';
}

function initGate(onUnlock) {
  const gate = document.getElementById('gate');
  const content = document.getElementById('content');
  const submitted = getCodeFromURL();

  if (submitted === ACCESS_CODE) {
    if (gate) gate.style.display = 'none';
    if (content) content.style.display = 'block';
    if (onUnlock) onUnlock(ACCESS_CODE);
    return;
  }

  if (gate) gate.style.display = 'flex';
  if (content) content.style.display = 'none';

  const form = document.getElementById('gate-form');
  const input = document.getElementById('gate-input');
  const error = document.getElementById('gate-error');
  if (!form) return;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const val = (input.value || '').trim();
    if (val === ACCESS_CODE) {
      const url = new URL(window.location.href);
      url.searchParams.set('code', val);
      window.location.href = url.toString();
    } else {
      error.textContent = 'Wrong code — check with your teacher and try again.';
      input.select();
    }
  });
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

// ---------- Scroll-spy for the leg nav ----------
function initLegNavSpy() {
  const nav = document.getElementById('leg-nav');
  if (!nav) return;
  const links = Array.from(nav.querySelectorAll('a'));
  const sections = links
    .map(l => document.querySelector(l.getAttribute('href')))
    .filter(Boolean);

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const id = '#' + entry.target.id;
      links.forEach(l => l.classList.toggle('active', l.getAttribute('href') === id));
    });
  }, { rootMargin: '-40% 0px -55% 0px', threshold: 0 });

  sections.forEach(s => observer.observe(s));
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

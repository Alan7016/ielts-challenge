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
// ANSWER + PROGRESS PERSISTENCE
// Every field the student fills in is saved to the 'answers' table, tied to
// their account (not their browser) — so it follows them across devices and
// survives closing the tab. 'progress' tracks which tasks are done and locked.
// ============================================
async function saveAnswer(userId, day, task, fieldId, value, isCorrect) {
  const sb = getSupabaseClient();
  await sb.from('answers').upsert(
    { student_id: userId, day, task, field_id: fieldId, value: String(value), is_correct: isCorrect, updated_at: new Date().toISOString() },
    { onConflict: 'student_id,day,field_id' }
  );
}

// Works out whether a filled-in field was correct, straight from the
// grading data already on the element (data-answer / data-correct).
// Returns null for ungraded fields (essays, confirm checkboxes, score entry).
function computeIsCorrect(el) {
  if (el.tagName === 'SELECT' && el.dataset.answer !== undefined) {
    return el.value === el.dataset.answer;
  }
  if (el.type === 'radio') {
    return el.dataset.correct === 'true';
  }
  if (el.classList.contains('text-answer')) {
    const accepted = (el.dataset.correct || '').split('/').map(s => s.trim().toLowerCase());
    return accepted.includes(el.value.trim().toLowerCase());
  }
  return null;
}

async function saveProgress(userId, day, task, completed, locked) {
  const sb = getSupabaseClient();
  await sb.from('progress').upsert(
    { student_id: userId, day, task, completed, locked, updated_at: new Date().toISOString() },
    { onConflict: 'student_id,day,task' }
  );
}

async function loadDayState(userId, day) {
  const sb = getSupabaseClient();
  const [{ data: answers }, { data: progress }] = await Promise.all([
    sb.from('answers').select('field_id, value').eq('student_id', userId).eq('day', day),
    sb.from('progress').select('task, completed, locked').eq('student_id', userId).eq('day', day)
  ]);
  const answerMap = {};
  (answers || []).forEach(r => { answerMap[r.field_id] = r.value; });
  const progressMap = {};
  (progress || []).forEach(r => { progressMap[r.task] = { completed: r.completed, locked: r.locked }; });
  return { answerMap, progressMap };
}

// Writes a saved value back into its input. Radio groups are keyed 'radio_<name>'
// since individual radio inputs don't have unique ids.
function restoreField(fieldId, value) {
  if (fieldId.startsWith('radio_')) {
    const name = fieldId.replace('radio_', '');
    const el = document.querySelector(`input[name="${name}"][value="${value}"]`);
    if (el) el.checked = true;
    return;
  }
  const el = document.getElementById(fieldId);
  if (!el) return;
  if (el.type === 'checkbox') el.checked = (value === 'true');
  else el.value = value;
}

// Disables every interactive element in a task so a completed task can be
// viewed but never edited. Runs the task's check function first (if it has
// one) so correct/incorrect coloring is visible in the frozen state.
function freezeTask(taskNum, checkFn) {
  const container = document.getElementById('task' + taskNum);
  if (!container) return;
  if (checkFn) { try { checkFn(); } catch (e) {} }
  container.querySelectorAll('input, select, textarea, button').forEach(el => { el.disabled = true; });
}

// ============================================
// TASK FLOW ENGINE — one task visible at a time, dots + Previous/Next,
// completion screen with confetti. Each day's HTML calls:
//   initTaskFlow(dayNumber, totalTasks, userId, checkFns)
// checkFns is optional: { taskNumber: () => yourCheckFunction() } for any
// task that has a "Check answers" button, so freezing it shows the graded state.
// A task is considered "complete" (Next enabled) if every input.text-answer,
// select, and radio-group inside it has a value, OR — for link-out tasks —
// its confirm checkbox is ticked. Tasks with nothing to fill in are always complete.
// ============================================
async function initTaskFlow(dayNumber, totalTasks, userId, checkFns) {
  checkFns = checkFns || {};
  let current = 1;
  const doneTasks = {};
  const lockedTasks = {};

  const dotsWrap = document.getElementById('dots');
  for (let i = 1; i <= totalTasks; i++) {
    const d = document.createElement('div');
    d.className = 'dot';
    d.dataset.dot = i;
    dotsWrap.appendChild(d);
  }

  // ---- Load everything saved so far, restore field values, freeze locked tasks ----
  const { answerMap, progressMap } = await loadDayState(userId, dayNumber);
  Object.keys(answerMap).forEach(fieldId => restoreField(fieldId, answerMap[fieldId]));
  for (let i = 1; i <= totalTasks; i++) {
    const p = progressMap[i];
    if (p && p.completed) doneTasks[i] = true;
    if (p && p.locked) {
      lockedTasks[i] = true;
      freezeTask(i, checkFns[i]);
    }
  }
  // Resume right after the last completed task, or at 1 if nothing's done yet.
  current = 1;
  for (let i = 1; i <= totalTasks; i++) { if (doneTasks[i]) current = Math.min(i + 1, totalTasks); }

  function isTaskComplete(n) {
    if (lockedTasks[n]) return true;
    const container = document.getElementById('task' + n);
    if (!container) return true;
    const confirmBox = container.querySelector('.confirm-row input[type="checkbox"]');
    if (confirmBox) return confirmBox.checked;

    const questionBoxes = container.querySelectorAll('.question-box[data-field]');
    if (questionBoxes.length > 0) {
      for (const qb of questionBoxes) { if (!qb.classList.contains('recorded')) return false; }
      return true;
    }

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
    if (current > 1) { current--; showTask(current); }
  }

  async function goNext() {
    // Lock the task the student is leaving — from now on it's frozen.
    if (!lockedTasks[current]) {
      lockedTasks[current] = true;
      doneTasks[current] = true;
      await saveProgress(userId, dayNumber, current, true, true);
      freezeTask(current, checkFns[current]);
    }
    refreshDots();
    if (current < totalTasks) {
      current++;
      showTask(current);
    } else {
      document.getElementById('completionScreen').classList.add('show');
      fireConfetti();
    }
  }

  function reviewDay() {
    document.getElementById('completionScreen').classList.remove('show');
    current = 1;
    showTask(1);
  }

  document.getElementById('prevBtn').addEventListener('click', goPrev);
  document.getElementById('nextBtn').addEventListener('click', goNext);
  const reviewBtn = document.getElementById('reviewBtn');
  if (reviewBtn) reviewBtn.addEventListener('click', reviewDay);

  // ---- Autosave: any field the student fills in gets written to Supabase ----
  const debTimers = {};
  function fieldKeyFor(el) {
    if (el.type === 'radio') return 'radio_' + el.name;
    return el.id || null;
  }
  document.getElementById('content').addEventListener('input', handleFieldChange);
  document.getElementById('content').addEventListener('change', handleFieldChange);
  function handleFieldChange(e) {
    const el = e.target;
    if (!['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)) return;
    const taskEl = el.closest('.task');
    if (!taskEl) return;
    const taskNum = +taskEl.dataset.task;
    if (lockedTasks[taskNum]) return; // frozen, ignore
    const fieldId = fieldKeyFor(el);
    if (!fieldId) return;
    const value = el.type === 'checkbox' ? (el.checked ? 'true' : 'false') : el.value;
    const isCorrect = computeIsCorrect(el);
    clearTimeout(debTimers[fieldId]);
    debTimers[fieldId] = setTimeout(() => saveAnswer(userId, dayNumber, taskNum, fieldId, value, isCorrect), 500);
    refreshNextButton();
  }

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

// ============================================
// SPEAKING RECORDER — one control per question. Records via the mic,
// uploads once to private storage, then locks permanently (no re-record).
// Call initRecordControl for each question box on page load.
// ============================================
async function initRecordControl(box, userId, day, task, fieldId) {
  const sb = getSupabaseClient();
  const path = `${day}/${userId}/${fieldId}.webm`;
  const recordBtn = box.querySelector('.record-btn');
  const statusEl = box.querySelector('.record-status');
  const playerWrap = box.querySelector('.record-player');

  async function showLocked() {
    const { data: signed } = await sb.storage.from('speaking-recordings').createSignedUrl(path, 3600);
    recordBtn.style.display = 'none';
    statusEl.textContent = '✓ Recorded (locked — one attempt only)';
    statusEl.style.color = 'var(--good)';
    box.classList.add('recorded');
    if (signed) {
      playerWrap.innerHTML = `<audio controls src="${signed.signedUrl}" style="width:100%; margin-top:8px;"></audio>`;
    }
  }

  // Already recorded in a previous session? Lock it immediately.
  const { data: existing } = await sb.from('answers').select('value').eq('student_id', userId).eq('day', day).eq('field_id', fieldId).maybeSingle();
  if (existing) {
    await showLocked();
    return;
  }

  let mediaRecorder = null;
  let chunks = [];
  let timerInterval = null;
  let seconds = 0;

  recordBtn.addEventListener('click', async () => {
    if (recordBtn.dataset.state === 'idle') {
      const confirmed = confirm('You only have ONE attempt to record this answer. Once you press Stop, it is submitted permanently and cannot be redone. Make sure you\'re ready before you start.');
      if (!confirmed) return;

      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (err) {
        statusEl.textContent = 'Microphone access denied — check your browser permissions.';
        statusEl.style.color = 'var(--warn)';
        return;
      }

      chunks = [];
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      mediaRecorder.start();

      seconds = 0;
      recordBtn.dataset.state = 'recording';
      recordBtn.textContent = '⏹ Stop (00:00)';
      recordBtn.classList.add('recording');
      timerInterval = setInterval(() => {
        seconds++;
        const m = String(Math.floor(seconds / 60)).padStart(2, '0');
        const s = String(seconds % 60).padStart(2, '0');
        recordBtn.textContent = `⏹ Stop (${m}:${s})`;
      }, 1000);

    } else if (recordBtn.dataset.state === 'recording') {
      clearInterval(timerInterval);
      recordBtn.disabled = true;
      recordBtn.textContent = 'Uploading…';

      mediaRecorder.stop();
      mediaRecorder.stream.getTracks().forEach(t => t.stop());
      await new Promise(resolve => { mediaRecorder.onstop = resolve; });

      const blob = new Blob(chunks, { type: 'audio/webm' });
      const { error: uploadError } = await sb.storage.from('speaking-recordings').upload(path, blob, { contentType: 'audio/webm' });

      if (uploadError) {
        statusEl.textContent = 'Upload failed — check your connection and reload to try again.';
        statusEl.style.color = 'var(--warn)';
        recordBtn.textContent = '⏹ Stop';
        recordBtn.disabled = false;
        return;
      }

      await sb.from('answers').upsert(
        { student_id: userId, day, task, field_id: fieldId, value: path, updated_at: new Date().toISOString() },
        { onConflict: 'student_id,day,field_id' }
      );

      await showLocked();
    }
  });
}

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

// Tracks the logged-in user's role for this page load, set by requireAuth.
// initTaskFlow and initRecordControl read this to bypass locking for admins
// without needing every single day file to be edited individually.
let currentUserRole = null;

async function requireAuth(onReady) {
  const sb = getSupabaseClient();
  const { data: { session } } = await sb.auth.getSession();

  if (!session) {
    const returnTo = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `${pathToRoot()}login.html?returnTo=${returnTo}`;
    return;
  }

  const { data: profile } = await sb.from('profiles').select('full_name, role, group_id, avatar_url, challenge, level').eq('id', session.user.id).single();
  currentUserRole = profile ? profile.role : null;

  // Day pages hardcode "← Board" to point at the student board — for admin,
  // that link should return to the admin dashboard instead. Fixed here
  // rather than in all 18 day files individually.
  if (currentUserRole === 'admin') {
    const backHome = document.getElementById('back-home');
    if (backHome) backHome.href = pathToRoot() + 'admin-dashboard.html#days';
  }

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

// ============================================
// SHARED HELPERS — profile picture, week bounds, streaks
// Used by profile.html and leaderboard.html.
// ============================================

// Uploads/replaces a student's avatar (stored as avatars/<user_id>/avatar.<ext>
// — the storage RLS policy checks the folder, so the path must match it —
// re-upload naturally overwrites the old one) and updates profiles.avatar_url.
async function uploadAvatar(userId, file) {
  const sb = getSupabaseClient();
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const path = `${userId}/avatar.${ext}`;
  const { error: uploadError } = await sb.storage.from('avatars').upload(path, file, { upsert: true, contentType: file.type });
  if (uploadError) return { error: uploadError };
  const { data: pub } = sb.storage.from('avatars').getPublicUrl(path);
  // Cache-bust so the new picture shows immediately instead of the old cached one.
  const url = `${pub.publicUrl}?v=${Date.now()}`;
  // Goes through a security-definer RPC rather than a direct table update,
  // since students don't (and shouldn't) have a broad UPDATE policy on
  // profiles — this function can only ever touch your own avatar_url.
  const { error: profileError } = await sb.rpc('update_own_avatar', { new_avatar_url: url });
  if (profileError) return { error: profileError };
  return { url };
}

// Weeks are day 1–7, 8–14, 15–21, etc. Returns [startDay, endDay] for
// whichever week `day` falls in.
function getWeekBounds(day) {
  const weekIndex = Math.floor((day - 1) / 7);
  return [weekIndex * 7 + 1, weekIndex * 7 + 7];
}

// Streak = consecutive day numbers (counting back from the highest day
// the student has touched) with at least one completed task. Day-number
// based rather than calendar-based, since that's how the program runs.
function computeDayStreak(daysWithActivity) {
  const uniqueDays = [...new Set(daysWithActivity)].sort((a, b) => b - a);
  if (uniqueDays.length === 0) return 0;
  let streak = 1;
  for (let i = 1; i < uniqueDays.length; i++) {
    if (uniqueDays[i] === uniqueDays[i - 1] - 1) streak++;
    else break;
  }
  return streak;
}

function initialsFor(fullName) {
  if (!fullName) return '?';
  const parts = fullName.trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase();
}


// so the auth redirect works the same from index.html and from days/dayN.html.
function pathToRoot() {
  return window.location.pathname.includes('/days/') ? '../' : '';
}

// ============================================
// FAVICON — injected here (rather than edited into every HTML file) so it
// applies site-wide, including all days/dayN.html files, automatically.
// ============================================
(function setFavicon() {
  const root = pathToRoot();
  const icons = [
    { rel: 'icon', type: 'image/x-icon', href: root + 'favicon.ico' },
    { rel: 'icon', type: 'image/png', sizes: '32x32', href: root + 'favicon-32x32.png' },
    { rel: 'icon', type: 'image/png', sizes: '16x16', href: root + 'favicon-16x16.png' },
    { rel: 'icon', type: 'image/png', sizes: '192x192', href: root + 'favicon-192x192.png' },
    { rel: 'apple-touch-icon', href: root + 'apple-touch-icon.png' }
  ];
  icons.forEach(attrs => {
    const link = document.createElement('link');
    Object.entries(attrs).forEach(([k, v]) => link.setAttribute(k, v));
    document.head.appendChild(link);
  });
})();

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
// ============================================
// SAVE STATUS BANNER — a small fixed banner that appears only when a save
// actually fails, so a student never loses work without knowing about it.
// Injected on first use; no changes needed to any day's HTML.
// ============================================
function getSaveBanner() {
  let el = document.getElementById('saveStatusBanner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'saveStatusBanner';
    el.style.cssText = 'position:fixed; bottom:16px; left:50%; transform:translateX(-50%); z-index:9999; padding:10px 20px; border-radius:10px; font:600 13.5px var(--body, sans-serif); box-shadow:0 6px 18px #00000030; display:none;';
    document.body.appendChild(el);
  }
  return el;
}
function showSaveWarning() {
  const el = getSaveBanner();
  el.textContent = '⚠️ Connection issue — your last answer may not have saved. Retrying automatically…';
  el.style.background = '#d5490f'; el.style.color = '#fff';
  el.style.display = 'block';
}
function showSaveRecovered() {
  const el = getSaveBanner();
  if (el.style.display === 'none') return; // wasn't showing a warning, nothing to recover from
  el.textContent = '✓ Saved';
  el.style.background = '#1f9d55'; el.style.color = '#fff';
  setTimeout(() => { el.style.display = 'none'; }, 2000);
}

async function saveAnswer(userId, day, task, fieldId, value, isCorrect) {
  const sb = getSupabaseClient();
  const res = await sb.from('answers').upsert(
    { student_id: userId, day, task, field_id: fieldId, value: String(value), is_correct: isCorrect, updated_at: new Date().toISOString() },
    { onConflict: 'student_id,day,field_id' }
  );
  if (res.error) {
    console.error('Answer save failed:', res.error);
    showSaveWarning();
    // one silent retry after a short delay — covers a brief network blip without bothering the student
    setTimeout(async () => {
      const retry = await sb.from('answers').upsert(
        { student_id: userId, day, task, field_id: fieldId, value: String(value), is_correct: isCorrect, updated_at: new Date().toISOString() },
        { onConflict: 'student_id,day,field_id' }
      );
      if (!retry.error) showSaveRecovered();
    }, 3000);
  } else {
    showSaveRecovered();
  }
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

// ============================================
// POINTS ENGINE
// Auto-awards points when a task is locked in (see goNext()).
// Manual categories (writing, bonus_*) are entered by teachers/checkers
// in their dashboards and never touched here.
// ============================================
const POINTS_MAX = {
  article: 3, video: 3, speaking: 3, reading_listening: 5,
  writing: 5, bonus_article: 2, bonus_video: 2, bonus_reading_listening: 3
};

function pctToPoints(pct) {
  if (pct >= 90) return 3;
  if (pct >= 70) return 2.5;
  if (pct >= 40) return 1.5;
  if (pct >= 10) return 0.5;
  return 0;
}

// Scores every gradable field inside a task container (radios, selects,
// text-answer gap fills) — works for both the article task (MCQ + vocab)
// and the video task (MCQ + gap fill + vocab) without needing to know
// which task number they landed on that day.
function computeTaskAccuracy(container) {
  let total = 0, correct = 0;
  const seenGroups = new Set();
  container.querySelectorAll('input[type="radio"][data-correct]').forEach(r => {
    if (seenGroups.has(r.name)) return;
    seenGroups.add(r.name);
    total++;
    const checked = container.querySelector(`input[name="${r.name}"]:checked`);
    if (checked && checked.dataset.correct === 'true') correct++;
  });
  container.querySelectorAll('select[data-answer]').forEach(s => {
    total++;
    if (s.value === s.dataset.answer) correct++;
  });
  container.querySelectorAll('input.text-answer[data-correct]').forEach(t => {
    total++;
    const accepted = (t.dataset.correct || '').split('/').map(x => x.trim().toLowerCase());
    if (accepted.includes(t.value.trim().toLowerCase())) correct++;
  });
  return { correct, total, pct: total ? (correct / total * 100) : 0 };
}

// Figures out which points category a task belongs to, purely from what's
// inside its container — so this works across every day's layout without
// needing to hardcode task numbers (they shift day to day).
function detectTaskCategory(container) {
  if (container.querySelector('.question-box[data-field^="speaking-"]')) return 'speaking';
  if (container.querySelector('iframe[src*="youtube"]')) return 'video';
  const linkOut = container.querySelector('a.link-out');
  if (linkOut) {
    const href = linkOut.getAttribute('href') || '';
    if (href.includes('passage-') || href.includes('listening-')) return 'reading_listening';
    return null; // e.g. the plain "read the article" confirm task — not scored on its own
  }
  if (container.querySelector('input[type="radio"][data-correct], select[data-answer]')) return 'article';
  return null; // writing / sample-answer / task1-report — ungraded here, or manual
}

async function saveTaskPoints(userId, day, category, points, extra) {
  extra = extra || {};
  const sb = getSupabaseClient();
  const payload = {
    student_id: userId, day, category, points,
    max_points: POINTS_MAX[category] || null,
    percent: extra.percent != null ? extra.percent : null,
    awarded_by: extra.awardedBy || 'system',
    comment: extra.comment || null,
    updated_at: new Date().toISOString()
  };
  const res = await sb.from('points').upsert(payload, { onConflict: 'student_id,day,category' });
  if (res.error) console.error('Points save failed:', res.error);
}

// Called right after a task locks in (see goNext()). Silently does nothing
// for task types that aren't auto-scored (writing, sample answer, etc.).
async function autoAwardPoints(userId, day, taskContainer) {
  const category = detectTaskCategory(taskContainer);
  if (!category) return;

  if (category === 'speaking') {
    // isTaskComplete() already guarantees every set is fully recorded
    // before Next unlocks, so reaching here means all-or-nothing = 3 pts.
    await saveTaskPoints(userId, day, 'speaking', 3);
  } else if (category === 'reading_listening') {
    await saveTaskPoints(userId, day, 'reading_listening', 5);
  } else if (category === 'article' || category === 'video') {
    const { correct, total, pct } = computeTaskAccuracy(taskContainer);
    const points = pctToPoints(pct);
    await saveTaskPoints(userId, day, category, points, { percent: Math.round(pct) });
  }
}

async function saveProgress(userId, day, task, completed, locked) {
  const sb = getSupabaseClient();
  const res = await sb.from('progress').upsert(
    { student_id: userId, day, task, completed, locked, updated_at: new Date().toISOString() },
    { onConflict: 'student_id,day,task' }
  );
  if (res.error) {
    console.error('Progress save failed:', res.error);
    showSaveWarning();
    setTimeout(async () => {
      const retry = await sb.from('progress').upsert(
        { student_id: userId, day, task, completed, locked, updated_at: new Date().toISOString() },
        { onConflict: 'student_id,day,task' }
      );
      if (!retry.error) showSaveRecovered();
    }, 3000);
  }
}

async function loadDayState(userId, day) {
  const sb = getSupabaseClient();
  const [{ data: answers, error: aErr }, { data: progress, error: pErr }] = await Promise.all([
    sb.from('answers').select('field_id, value').eq('student_id', userId).eq('day', day),
    sb.from('progress').select('task, completed, locked').eq('student_id', userId).eq('day', day)
  ]);
  if (aErr || pErr) {
    console.error('Failed to load saved progress:', aErr || pErr);
    const el = getSaveBanner();
    el.textContent = "⚠️ Couldn't load your saved progress — if you've done this day before, please refresh rather than redoing it.";
    el.style.background = '#d5490f'; el.style.color = '#fff';
    el.style.display = 'block';
  }
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
  // speaking-set-btn is excluded so students can still browse back into a
  // completed speaking task and relisten to their recordings for self-review
  // — they just can't record again, since the record button itself is
  // already permanently hidden once a recording locks in (see showLocked()).
  container.querySelectorAll('input, select, textarea, button:not(.speaking-set-btn):not(.phrase-toggle)').forEach(el => { el.disabled = true; });
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
  const isAdmin = currentUserRole === 'admin';
  let current = 1;
  const doneTasks = {};
  const lockedTasks = {};

  if (isAdmin) {
    const banner = document.createElement('div');
    banner.className = 'wrap';
    banner.style.cssText = 'padding-top:16px;';
    banner.innerHTML = `<p style="font-family:var(--mono); font-size:0.78rem; color:var(--accent); background:var(--accent-soft); display:inline-block; padding:6px 14px; border-radius:8px;">🔑 Admin preview — nothing on this page is saved, and every task is unlocked</p>`;
    document.querySelector('header.day-header').insertAdjacentElement('afterend', banner);
  }

  const dotsWrap = document.getElementById('dots');
  for (let i = 1; i <= totalTasks; i++) {
    const d = document.createElement('div');
    d.className = 'dot';
    d.dataset.dot = i;
    dotsWrap.appendChild(d);
  }

  // Admins get a blank, read-through page — no saved state to restore, no
  // locked tasks to freeze (they have no progress rows, and shouldn't gain any).
  if (!isAdmin) {
    // ---- Load everything saved so far, restore field values, freeze locked tasks ----
    const { answerMap, progressMap } = await loadDayState(userId, dayNumber);
    Object.keys(answerMap).forEach(fieldId => restoreField(fieldId, answerMap[fieldId]));
    for (let i = 1; i <= totalTasks; i++) {
      const p = progressMap[i];
      if (p && p.completed) doneTasks[i] = true;
      if (p && p.locked) {
        lockedTasks[i] = true;
        freezeTask(i, checkFns[i]);
        // Backfills points for tasks completed before this feature existed,
        // or simply re-affirms them on every load — upsert makes this safe
        // to repeat, it just rewrites the same row.
        const taskContainer = document.getElementById('task' + i);
        if (taskContainer) autoAwardPoints(userId, dayNumber, taskContainer);
      }
    }
  }
  // Resume right after the last completed task, or at 1 if nothing's done yet.
  current = 1;
  for (let i = 1; i <= totalTasks; i++) { if (doneTasks[i]) current = Math.min(i + 1, totalTasks); }

  function isTaskComplete(n) {
    if (isAdmin) return true;
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
  window.refreshTaskFlowNext = refreshNextButton;

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
    // Admins skip all of this: no confirm dialog, no lock, no save, no points.
    if (!isAdmin && !lockedTasks[current]) {
      const container = document.getElementById('task' + current);
      const freeTextBox = container.querySelector('textarea.no-check');
      if (freeTextBox) {
        const wordCount = freeTextBox.value.trim() ? freeTextBox.value.trim().split(/\s+/).length : 0;
        const sure = confirm(
          `You're about to submit your response (${wordCount} words). Once you continue, it will be locked and you won't be able to edit it again. Are you sure you're finished?`
        );
        if (!sure) return;
      }
      lockedTasks[current] = true;
      doneTasks[current] = true;
      await saveProgress(userId, dayNumber, current, true, true);
      await autoAwardPoints(userId, dayNumber, container);
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
    if (isAdmin) return; // admin preview never writes to the database
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
// SPEAKING QUESTION TEXT — maps a field_id to its actual question,
// so dashboards can show real text instead of a generic label.
// ============================================
const SPEAKING_QUESTIONS = {
  'speaking-occupation-q1': 'Do you work or are you a student?',
  'speaking-occupation-q2': 'What work do you do? / What subjects are you studying?',
  'speaking-occupation-q3': 'Why did you choose that job/career?',
  'speaking-occupation-q4': 'Why did you choose to study that subject?',
  'speaking-occupation-q5': 'Do you like your job?',
  'speaking-hometown-q1': 'Please describe your hometown a little.',
  'speaking-hometown-q2': 'What is your town well-known for?',
  'speaking-hometown-q3': 'Do you like your hometown?',
  'speaking-hometown-q4': 'Is that a big city or a small place?',
  'speaking-hometown-q5': 'How long have you been living there?',
  'speaking-reading-q1': 'Do you like reading?',
  'speaking-reading-q2': 'What books do you like to read?',
  'speaking-reading-q3': 'What book did you read recently?',
  'speaking-reading-q4': 'What did you learn from it?',
  'speaking-reading-q5': 'Do you prefer to read on paper or on a screen?',
  'speaking-city-part2': 'Part 2 — Describe a city you\'ve been to and want to visit again.',
  'speaking-city-q1': 'What is the difference between living in the countryside and the city?',
  'speaking-city-q2': 'Do you prefer to live in the city or in the countryside?',
  'speaking-city-q3': 'Is it good for elderly people to live in large cities?',
  'speaking-family-part2': 'Part 2 — Describe a family member that did something that made you feel proud.',
  'speaking-family-q1': 'On what occasions would adults feel proud of themselves?',
  'speaking-family-q2': 'Is it a good idea to reward children for doing homework or housework?',
  'speaking-family-q3': 'What would children do to make their parents proud?',
  'speaking-p1-q1': 'Part 1 — What kind of gifts are popular in your country?',
  'speaking-p1-q2': 'Part 1 — What\'s the best gift you have ever received?',
  'speaking-p1-q3': 'Part 1 — What do you give others as gifts?',
  'speaking-p1-q4': 'Part 1 — What gift have you received recently?',
  'speaking-p1-q5': 'Part 1 — How do we choose gifts?',
  'speaking-p2-job': 'Part 2 — Describe your perfect job.',
  'speaking-p3-q1': 'Part 3 — What kind of jobs do children like?',
  'speaking-p3-q2': 'Part 3 — How can people find a perfect job?',
  'speaking-p3-q3': 'Part 3 — What factors should people take into account when choosing a job?',
  'speaking-morning-q1': 'Do you like to get up early?',
  'speaking-morning-q2': 'What is your morning routine?',
  'speaking-morning-q3': 'What do you usually do in the morning?',
  'speaking-morning-q4': 'What did you do in the morning when you were little?',
  'speaking-morning-q5': 'Do you spend your mornings doing the same things on both weekends and weekdays?',
  'speaking-hobby-q1': 'Do you have any hobbies?',
  'speaking-hobby-q2': 'Do you have the same hobbies as your family members?',
  'speaking-hobby-q3': 'Did you have any hobbies when you were a child?',
  'speaking-hobby-q4': 'Do you have a hobby that you\'ve had since childhood?',
  'speaking-sports-q1': 'Have you ever been part of a sports team?',
  'speaking-sports-q2': 'Are team sports popular in your culture?',
  'speaking-sports-q3': 'Do you like watching team games?',
  'speaking-sports-q4': 'What are the differences between team sports and individual sports?',
  'speaking-relax-part2': 'Part 2 — Describe a place in your home where you like to relax.',
  'speaking-relax-q1': 'Part 3 — Why is it difficult for some people to relax?',
  'speaking-relax-q2': 'Part 3 — Do you think there should be classes for training young people and children how to relax?',
  'speaking-relax-q3': 'Part 3 — Which is more important, mental relaxation or physical relaxation?',
  'speaking-relax-q4': 'Part 3 — Do people in your country exercise after work?',
  'speaking-relax-q5': 'Part 3 — What are the benefits of doing exercise?',
  'speaking-cantlive-part2': 'Part 2 — Describe something you can\'t live without (not a computer or phone).',
  'speaking-cantlive-q1': 'Part 3 — Do you think that keeping old things in a family is a great way to connect with the past?',
  'speaking-cantlive-q2': 'Part 3 — Why do grown-ups hate to throw away old things?',
  'speaking-cantlive-q3': 'Part 3 — How have people\'s shopping habits changed in recent decades?',
  'speaking-cantlive-q4': 'Part 3 — How has the way people buy things changed?',
  'speaking-cantlive-q5': 'Part 3 — How do shops attract customers?',
  'speaking-typing-q1': 'Do you type on a desktop or laptop keyboard every day?',
  'speaking-typing-q2': 'When did you learn how to type on a keyboard?',
  'speaking-typing-q3': 'How do you improve your typing?',
  'speaking-walking-q1': 'Do you walk a lot?',
  'speaking-walking-q2': 'Did you often go outside to have a walk when you were a child?',
  'speaking-walking-q3': 'Why do people like to walk in parks?',
  'speaking-walking-q4': 'Where would you like to take a long walk if you had the chance?',
  'speaking-walking-q5': 'Where have you gone for a walk lately?',
  'speaking-buildings-q1': 'Do you take photos of buildings?',
  'speaking-buildings-q2': 'Is there a building that you would like to visit?',
  'speaking-smiling-part2': 'Part 2 — Describe an occasion when you saw a lot of people smiling.',
  'speaking-smiling-q1': 'Part 3 — Do you think people who like to smile are more friendly?',
  'speaking-smiling-q2': 'Part 3 — Why do most people smile in photographs?',
  'speaking-smiling-q3': 'Part 3 — Do women smile more than men? Why?',
  'speaking-smiling-q4': 'Part 3 — Do people smile more when they are younger or older?',
  'speaking-advice-part2': 'Part 2 — Describe a time when you gave advice to others.',
  'speaking-advice-q1': 'Part 3 — What problems can people face if they ask many different people for advice?',
  'speaking-advice-q2': 'Part 3 — Why do some people like to ask others for advice on almost everything?',
  'speaking-advice-q3': 'Part 3 — In general, what kind of person is most suitable for giving advice to others?',
  'speaking-advice-q4': 'Part 3 — Should people prepare before giving advice?',
  'speaking-views-q1': 'Do you like taking pictures of different views?',
  'speaking-views-q2': 'Do you prefer views in urban areas or rural areas?',
  'speaking-views-q3': 'Do you prefer views in your own country or in other countries?',
  'speaking-scenery-q1': 'Do you like to take pictures of good scenery?',
  'speaking-scenery-q2': 'Do you look out the window at the scenery when travelling by bus or car?',
  'speaking-scenery-q3': 'Do you prefer the mountains or the sea?',
  'speaking-scenery-q4': 'What are the most beautiful sights you have seen while travelling?',
  'speaking-childhood-q1': 'What did you enjoy doing as a child?',
  'speaking-childhood-q2': 'Did you enjoy your childhood?',
  'speaking-childhood-q3': 'Did you prefer to do activities alone or with a group of people when you were a child?',
  'speaking-app-part2': 'Part 2 — Describe an app or program in your computer or phone.',
  'speaking-app-q1': 'Part 3 — What are the drawbacks of having too many apps?',
  'speaking-app-q2': 'Part 3 — Why do some people not like using apps?',
  'speaking-app-q3': 'Part 3 — What are the most and the least popular apps in your country?',
  'speaking-job-part2': 'Part 2 — Describe a country in which you would like to work or live for a short period of time.',
  'speaking-job-q1': 'Part 3 — Why do people like travelling?',
  'speaking-job-q2': 'Part 3 — What jobs can people do abroad for a short period of time?',
  'speaking-job-q3': 'Part 3 — Is it good that now people have an opportunity to work abroad?',
  'speaking-possession-part2': 'Part 2 — Describe an important old thing that your family has kept for a long time.',
  'speaking-possession-q1': 'Part 3 — What are the differences between the things that people keep today and the things that people kept in the past?',
  'speaking-possession-q2': 'Part 3 — As well as family photographs, what are some other things that people keep in their family for a long time?',
  'speaking-possession-q3': 'Part 3 — In your culture, what sorts of things do people pass down from generation to generation?',
  'speaking-stages-q1': 'How do people remember each stage of their lives?',
  'speaking-stages-q2': 'At what age do you think people are the happiest?',
  'speaking-stages-q3': 'Do you enjoy being the age you are now?',
  'speaking-stages-q4': 'What did you often do with your friends in your childhood?',
  'speaking-stages-q5': 'Do you have any plans for the next five years?',
  'speaking-routine-q1': 'How do you organise your study time?',
  'speaking-routine-q2': 'What is your daily study routine?',
  'speaking-routine-q3': 'Do you ever change your plans?',
  'speaking-routine-q4': 'Have you ever changed your routine?',
  'speaking-routine-q5': "What's your favourite time of the day?",
  'speaking-animals-q1': "What's your favourite animal?",
  'speaking-animals-q2': 'Have you ever had a pet?',
  'speaking-animals-q3': "What's the most popular animal in your country?",
  'speaking-animals-q4': 'Where do you prefer to keep your pet, indoors or outdoors?',
  'speaking-cartrip-part2': 'Part 2 — Describe a long bike, motorbike, or car trip that you would like to take.',
  'speaking-cartrip-q1': 'Part 3 — How are transportation systems in rural and urban areas different?',
  'speaking-cartrip-q2': 'Part 3 — Which mode of transport is more popular in your country, a bicycle or car?',
  'speaking-cartrip-q3': 'Part 3 — Do you think air pollution comes mostly from mobile vehicles?',
  'speaking-shop-part2': 'Part 2 — Describe a shop you often visit.',
  'speaking-shop-q1': "Part 3 — Do you think that people buy a lot of things that they don't need?",
  'speaking-shop-q2': 'Part 3 — Do you often buy more than you expected?',
  'speaking-imagination-part2': 'Part 2 — Describe a time you needed to use your imagination.',
  'speaking-imagination-q1': 'Part 3 — What kind of jobs require imagination?',
  'speaking-imagination-q2': 'Part 3 — Do scientists need imagination in their work?',
  'speaking-imagination-q3': 'Part 3 — Do you think adults can have lots of imagination?',
  'speaking-imagination-q4': "Part 3 — What subjects are helpful for children's imagination?",
  'speaking-daysoff-q1': 'When was the last time you had a few days off?',
  'speaking-daysoff-q2': 'What do you do when you have days off?',
  'speaking-daysoff-q3': 'What would you like to do if you had a day off tomorrow?',
  'speaking-daysoff-q4': 'Do you usually spend your days off with your parents or with your friends?',
  'speaking-food-q1': 'What kinds of food do you particularly like?',
  'speaking-food-q2': 'What kinds of food are most popular in your country?',
  'speaking-food-q3': "Is there any food you don't like?",
  'speaking-food-q4': 'What kind of food did you like when you were young?',
  'speaking-keys-q1': 'Have you ever locked yourself out?',
  'speaking-keys-q2': "Do you think it's a good idea to leave your keys with a neighbour?",
  'speaking-keys-q3': 'Have you ever lost your keys?',
  'speaking-keys-q4': 'Do you always bring a lot of keys with you?',
  'speaking-film-part2': 'Part 2 — Describe a film you watched and enjoyed.',
  'speaking-film-q1': 'Part 3 — What makes a movie a blockbuster?',
  'speaking-film-q2': 'Part 3 — Are actors and actresses important to movies?',
  'speaking-film-q3': 'Part 3 — Do you think films with famous actors or actresses are more likely to become successful films?',
  'speaking-film-q4': 'Part 3 — What kinds of movies are successful in your country?',
  'speaking-film-q5': 'Part 3 — Do people in your country still like to go to a cinema?',
  'speaking-story-part2': 'Part 2 — Describe a story you read recently.',
  'speaking-story-q1': 'Part 3 — Why do most children like listening to stories before bedtime?',
  'speaking-story-q2': 'Part 3 — Is a good storyline important for a movie?',
  'speaking-story-q3': 'Part 3 — Why do children like hearing the same bedtime story?',
  'speaking-person-part2': 'Part 2 — Describe a person who solved a problem in a smart way.',
  'speaking-person-q1': 'Part 3 — Are people born clever or need to learn to be clever?',
  'speaking-person-q2': 'Part 3 — Why are some children more intelligent than others?',
  'speaking-person-q3': 'Part 3 — Do you think society needs people with different types of intelligence?',
  'speaking-person-q4': 'Part 3 — Does modern society need talents of all kinds?',
  'speaking-person-q5': 'Part 3 — How do children become smart at school?',
  'speaking-memory-q1': 'How do you remember important things?',
  'speaking-memory-q2': 'Are you good at memorising things?',
  'speaking-memory-q3': 'Have you ever forgotten something important?',
  'speaking-memory-q4': 'What do you need to remember in your daily life?',
  'speaking-sparetime-q1': 'What free time activities are popular with people in your country?',
  'speaking-sparetime-q2': 'What do you do when you have free time?',
  'speaking-sparetime-q3': 'Who do you usually spend your spare time with?',
  'speaking-crowded-q1': 'Do most people like crowded places?',
  'speaking-crowded-q2': 'Do you like crowded places?',
  'speaking-crowded-q3': 'When was the last time you were in a crowded place?',
  'speaking-crowded-q4': 'Is the city where you live crowded?',
  'speaking-crowded-q5': 'Is there a crowded place near where you live?',
  'speaking-nature-part2': 'Part 2 — Describe a person who encouraged you to protect the nature.',
  'speaking-nature-q1': 'Part 3 — How can parents teach their children to protect nature?',
  'speaking-nature-q2': 'Part 3 — Should schools teach children to get close to nature?',
  'speaking-nature-q3': 'Part 3 — Do you think there should be laws to protect nature?',
  'speaking-paidmore-part2': 'Part 2 — Describe an occasion when you paid more than expected.',
  'speaking-paidmore-q1': 'Part 3 — What do young people spend money on?',
  'speaking-paidmore-q2': 'Part 3 — Is it good and necessary to teach children to save money?',
  'speaking-paidmore-q3': 'Part 3 — Do you think it is important to save money?',
  'speaking-paidmore-q4': "Part 3 — Do you think that people buy a lot of things that they don't need?",
  'speaking-helps-part2': 'Part 2 — Describe a person who often helps others.',
  'speaking-helps-q1': 'Part 3 — What can children help parents with?',
  'speaking-helps-q2': 'Part 3 — In your view, should children be taught to help others?',
  'speaking-helps-q3': 'Part 3 — Should children help their parents with household chores?',
  'speaking-helps-q4': 'Part 3 — What kind of help do people need when looking for a new job?',
  'speaking-helps-q5': 'Part 3 — Who should people ask for help, colleagues or family members?',
  'speaking-teachers-q1': 'Would you like to be a teacher?',
  'speaking-teachers-q2': 'Do you think you could be a teacher?',
  'speaking-teachers-q3': 'Did (Do) you have a favourite teacher?',
  'speaking-teachers-q4': 'How does this teacher help you?',
  'speaking-teachers-q5': 'How has your favourite teacher helped you?',
  'speaking-social-q1': 'Do you think you spend too much time on social media?',
  'speaking-social-q2': 'What do people often do on social media?',
  'speaking-dreams-q1': 'What was your dream when you were a child?',
  'speaking-dreams-q2': 'Are you the kind of person who sticks to dreams?',
  'speaking-dreams-q3': 'Do you think you are an ambitious person?',
  'speaking-dreams-q4': 'Are you an ambitious person?',
  'speaking-dreams-q5': 'What is your dream job?',
  'speaking-mirrors-q1': 'Would you use mirrors to decorate your room?',
  'speaking-mirrors-q2': 'Do you usually take a mirror with you?',
  'speaking-mirrors-q3': 'How often do you use a mirror?',
  'speaking-mirrors-q4': 'Do you like looking at yourself in a mirror?',
  'speaking-mirrors-q5': 'Have you ever bought a mirror?',
  'speaking-music-q1': 'Do you prefer sad or happy music?',
  'speaking-music-q2': 'Does happy music make you feel more excited?',
  'speaking-own-part2': 'Part 2 — Describe something you would like to own (but do not currently have).',
  'speaking-own-q1': 'Part 3 — What are the differences between talking with friends online and face-to-face?',
  'speaking-own-q2': 'Part 3 — What technology do people currently use?',
  'speaking-own-q3': 'Part 3 — Does technological development have a negative impact on communication among people?',
  'speaking-own-q4': 'Part 3 — Do you think technology unites or separates people?',
  'speaking-own-q5': "Part 3 — What effects does technology have on people's relationships?",
  'speaking-encourage-part2': "Part 2 — Describe a time when you encouraged someone to do something that they didn't want to do.",
  'speaking-encourage-q1': 'Part 3 — Is the role of a leader important in a group?',
  'speaking-encourage-q2': 'Part 3 — How can leaders encourage employees?',
  'speaking-encourage-q3': 'Part 3 — When should parents encourage their children?',
  'speaking-encourage-q4': 'Part 3 — Do you think some people are better than others at persuading?',
  'speaking-encourage-q5': 'Part 3 — What kind of encouragement should parents give?',
  'speaking-learned-part2': 'Part 2 — Describe one of your friends who learned something new (not from a teacher).',
  'speaking-learned-q1': 'Part 3 — Do you think learning many subjects at one time is better or learning one subject is better?',
  'speaking-learned-q2': 'Part 3 — Do you think learning many subjects is beneficial to your work?',
  'speaking-learned-q3': 'Part 3 — Do you think all teachers should have entertaining teaching styles?',
  'speaking-learned-q4': 'Part 3 — Should teachers make lessons fun?',
  'speaking-learned-q5': 'Part 3 — Is it important for people to learn new skills all life long?',
  'speaking-tidiness-q1': 'Would you say you are a tidy person?',
  'speaking-tidiness-q2': 'Do you like to keep things tidy?',
  'speaking-tidiness-q3': 'How do you keep things tidy?',
  'speaking-tidiness-q4': 'Do you think it is possible for people to be tidy all the time?',
  'speaking-tidiness-q5': 'Did you use to keep your room tidy as a child?',
  'speaking-websites-q1': 'What kinds of websites do you often visit?',
  'speaking-websites-q2': 'What kinds of websites are popular in your country?',
  'speaking-websites-q3': 'What is your favourite website?',
  'speaking-websites-q4': 'Are there any changes to the websites you often visit?',
  'speaking-watches-q1': 'Do you like to wear watches?',
  'speaking-watches-q2': 'Do you think a watch is important for you?',
  'speaking-watches-q3': 'Have you ever received a watch as a gift?',
  'speaking-watches-q4': 'Why do people like expensive watches?',
  'speaking-shopping-q1': 'Do you like shopping?',
  'speaking-shopping-q2': 'How often do you go shopping?',
  'speaking-shopping-q3': 'Do you compare prices when you shop?',
  'speaking-shopping-q4': 'Is it difficult for you to make choices when you shop?',
  'speaking-cars-q1': 'What type of car do you like?',
  'speaking-cars-q2': 'What colour car would you choose to buy?',
  'speaking-cars-q3': 'Do you think car colours are important?',
  'speaking-cars-q4': "What do you usually do when there's a traffic jam?",
  'speaking-cars-q5': 'Do you prefer to be a driver or a passenger?',
  'speaking-planning-part2': 'Part 2 — Describe a person who makes plans a lot and is good at planning.',
  'speaking-planning-q1': 'Part 3 — In general, do you think planning is important?',
  'speaking-planning-q2': 'Part 3 — Do you think everyone in your country makes everyday plans?',
  'speaking-planning-q3': 'Part 3 — Do you think children should plan their future careers?',
  'speaking-planning-q4': 'Part 3 — Should children ask their teachers or parents for advice when making plans?',
  'speaking-planning-q5': 'Part 3 — What activities do we need to plan ahead?',
  'speaking-drawing-part2': 'Part 2 — Describe a child who loves drawing or painting.',
  'speaking-drawing-q1': 'Part 3 — What is the right age for a child to learn drawing?',
  'speaking-drawing-q2': 'Part 3 — Why do most children draw more often than adults do?',
  'speaking-drawing-q3': 'Part 3 — Why do some people visit galleries or museums instead of viewing artworks online?',
  'speaking-drawing-q4': 'Part 3 — Do you think galleries and museums should be free of charge?',
  'speaking-drawing-q5': 'Part 3 — How do artworks inspire people?',
  'speaking-quiet-part2': 'Part 2 — Describe a quiet place that you like to go to.',
  'speaking-quiet-q1': 'Part 3 — Is it hard to find quiet places in cities?',
  'speaking-quiet-q2': 'Part 3 — Can people bring children to these noise-free places?',
  'speaking-quiet-q3': 'Part 3 — What places should be noise-free?',
  'speaking-quiet-q4': 'Part 3 — Are there many quiet places in your city?',
  'speaking-quiet-q5': 'Part 3 — Why do people sometimes prefer to be alone?',
  'speaking-parks-q1': 'Do you like to go to parks?',
  'speaking-parks-q2': 'When was the last time you went to the park?',
  'speaking-parks-q3': 'Do people in your country often go to parks?',
  'speaking-science-q1': 'Do you like science?',
  'speaking-science-q2': 'Did you like science classes when you were young?',
  'speaking-space-q1': 'Do you want to travel in the outer space?',
  'speaking-space-q2': 'What would you do if you had an opportunity?',
  'speaking-space-q3': "Do you think it's necessary to see other planets?",
  'speaking-space-q4': 'Are you interested in films about outer space and stars?',
  'speaking-space-q5': 'Do you like science fiction movies?',
  'speaking-space-q6': 'Have you ever taken a course about stars?',
  'speaking-space-q7': 'Is it important to study stars?',
  'speaking-space-q8': 'Do you want to know more about outer space?',
  'speaking-headphones-q1': 'Do you use headphones?',
  'speaking-headphones-q2': 'In what situations would you use headphones?',
  'speaking-headphones-q3': 'What type of headphones do you use?',
  'speaking-headphones-q4': 'In what situations would you NOT use headphones?',
  'speaking-art-q1': 'Do you like modern art or traditional art?',
  'speaking-art-q2': 'Do you like art?',
  'speaking-art-q3': 'Have you ever visited an art gallery?',
  'speaking-art-q4': 'Do you think it would be interesting for you to be an artist?',
  'speaking-tvprogram-part2': 'Part 2 — Describe a program you like to watch.',
  'speaking-tvprogram-q1': 'Part 3 — What shows do old people and young people watch?',
  'speaking-tvprogram-q2': 'Part 3 — What other programs do you like to watch?',
  'speaking-tvprogram-q3': 'Part 3 — What TV programs are popular in your country?',
  'speaking-tvprogram-q4': 'Part 3 — Do people in your country like to watch foreign TV programs?',
  'speaking-tvprogram-q5': 'Part 3 — Do you think watching talk shows is a waste of time?',
  'speaking-building-part2': "Part 2 — Describe an unusual building you'd like to visit.",
  'speaking-building-q1': 'Part 3 — Is the appearance of a public building as important as its functionality?',
  'speaking-building-q2': 'Part 3 — Is it worth spending a lot of money on the appearance of a building?',
  'speaking-building-q3': 'Part 3 — Is it more important for a building to look good on the outside or on the inside?',
  'speaking-building-q4': 'Part 3 — Why do people like to visit historical places?',
  'speaking-building-q5': 'Part 3 — What types of buildings are popular in your country?',
  'speaking-tvseries-part2': 'Part 2 — Describe a TV series that you like.',
  'speaking-tvseries-q1': 'Part 3 — Do you think parents should limit their children from watching television?',
  'speaking-tvseries-q2': 'Part 3 — Would your family watch TV together?',
  'speaking-tvseries-q3': 'Part 3 — What are the differences in television viewing habits between the elderly and the young?',
  'speaking-tvseries-q4': 'Part 3 — How has technology changed the way people watch television?',
  'speaking-tvseries-q5': 'Part 3 — What do you think about ads in TV series?',
  'speaking-clothes-q1': 'Do you usually wear T-shirts?',
  'speaking-clothes-q2': 'Do you like wearing T-shirts?',
  'speaking-clothes-q3': 'Do you like T-shirts with pictures and prints?',
  'speaking-clothes-q4': 'What colour clothes do you like to wear?',
  'speaking-clothes-q5': "What are the differences between men and women's preference in colour?",
  'speaking-jokes-q1': 'Are you good at telling jokes?',
  'speaking-jokes-q2': 'Do your friends like to tell jokes?',
  'speaking-jokes-q3': 'Do you like to watch comedies?',
  'speaking-morning-q1': 'What is your morning routine?',
  'speaking-morning-q2': 'Do you spend your mornings doing the same things on both weekends and weekdays?',
  'speaking-morning-q3': 'Is breakfast important?',
  'speaking-morning-q4': 'Do you like to get up early?',
  'speaking-history-q1': 'Do you think history is important?',
  'speaking-history-q2': 'Do you like to learn about history?',
  'speaking-history-q3': 'Do you think the internet is a good place to learn about history?',
  'speaking-oldbuildings-q1': 'Are there many old buildings in your city?',
  'speaking-oldbuildings-q2': 'Do you think old buildings should be preserved or replaced with modern ones?',
  'speaking-oldbuildings-q3': 'Have you ever visited a famous old building?',
  'speaking-oldbuildings-q4': 'Why do people like visiting historical buildings?',
  'speaking-place-part2': "Part 2 — Describe a place you'd like to visit in your free time.",
  'speaking-place-q1': 'Part 3 — Why do some people prefer to travel in their own country rather than going abroad?',
  'speaking-place-q2': "Part 3 — Some people don't like to travel abroad. Why?",
  'speaking-place-q3': 'Part 3 — Why do people choose to travel or live abroad?',
  'speaking-cake-part2': 'Part 2 — Describe a special cake you received.',
  'speaking-cake-q1': 'Part 3 — What food do people in your country eat on special occasions?',
  'speaking-cake-q2': 'Part 3 — What is the difference between special food in your country and other countries?',
  'speaking-cake-q3': 'Part 3 — Why do many people like to spend a lot of money on food on special days?',
  'speaking-cake-q4': 'Part 3 — What do you think of people using their mobile phones during a meal?',
  'speaking-cake-q5': "Part 3 — Do you think it's good to communicate when eating with your family?",
  'speaking-buildinglike-part2': 'Part 2 — Describe a building you like or dislike.',
  'speaking-buildinglike-q1': 'Part 3 — What do you think buildings will be like in the future?',
  'speaking-buildinglike-q2': 'Part 3 — Which do most people prefer, living in a bungalow or in a tall building?',
  'speaking-buildinglike-q3': 'Part 3 — Why are taller and taller buildings being constructed nowadays?',
  'speaking-films-q1': 'What kinds of movies do you like best?',
  'speaking-films-q2': 'How often do you go to a cinema to watch a movie?',
  'speaking-films-q3': 'Did you usually go to the cinema when you were a kid?',
  'speaking-films-q4': 'What was the first film that you watched?',
  'speaking-films-q5': 'Do you like to watch movies alone or with your friends?',
  'speaking-sportstv-q1': 'Do you like watching sports programs on TV?',
  'speaking-sportstv-q2': 'Who do you like to watch live sports games with?',
  'speaking-readinghabits-q1': 'Do you prefer to read on paper or on a screen?',
  'speaking-readinghabits-q2': 'When do you need to read carefully and when not?',
  'speaking-readinghabits-q3': 'Do you prefer scanning or detailed reading?',
  'speaking-readinghabits-q4': 'Do you like reading?',
  'speaking-readinghabits-q5': 'What books do you like to read?',
  'speaking-gifts-q1': 'Do you think you are good at choosing gifts?',
  'speaking-gifts-q2': 'Have you ever sent handmade gifts to others?',
  'speaking-gifts-q3': 'What kind of gifts are popular in your country?',
  'speaking-gifts-q4': 'What is the best gift you have ever received?',
  'speaking-early-part2': 'Part 2 — Describe an occasion when you got up extremely early.',
  'speaking-early-q1': 'Part 3 — Why do people get up early?',
  'speaking-early-q2': "Part 3 — Are there any situations when it's not good to arrive early?",
  'speaking-early-q3': 'Part 3 — Is it good to arrive early in any situation?',
  'speaking-early-q4': 'Part 3 — Why do some people stay up late at night?',
  'speaking-early-q5': 'Part 3 — Is it easy to get up early?',
  'speaking-law-part2': 'Part 2 — Describe a new law you would like to introduce in your country.',
  'speaking-law-q1': 'Part 3 — Do people in your country usually obey the law?',
  'speaking-law-q2': 'Part 3 — What are some rules that exist in schools or workplaces in your country?',
  'speaking-law-q3': 'Part 3 — What kind of behaviour is considered good behaviour?',
  'speaking-law-q4': 'Part 3 — How can parents teach children to obey rules?',
  'speaking-law-q5': 'Part 3 — What are the benefits of obeying rules?',
  'speaking-plants-part2': 'Part 2 — Describe a person you know who loves to grow plants (vegetables, fruits, flowers).',
  'speaking-plants-q1': 'Part 3 — Do people in your country like to grow plants?',
  'speaking-plants-q2': 'Part 3 — What are the advantages of growing plants at home?',
  'speaking-plants-q3': 'Part 3 — Do people like to grow vegetables in your country?',
  'speaking-plants-q4': 'Part 3 — What are the advantages of growing vegetables at home?',
  'speaking-plants-q5': 'Part 3 — How do people feel when they eat vegetables that they grew on their own?'
};
function speakingLabel(fieldId) {
  return SPEAKING_QUESTIONS[fieldId] || fieldId.replace('speaking-', '').replace(/-/g, ' ');
}
async function initRecordControl(box, userId, day, task, fieldId) {
  if (currentUserRole === 'admin') {
    const recordBtn = box.querySelector('.record-btn');
    const statusEl = box.querySelector('.record-status');
    if (recordBtn) { recordBtn.disabled = true; recordBtn.textContent = '● Recording disabled in admin preview'; }
    if (statusEl) { statusEl.textContent = ''; }
    return;
  }
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
    if (window.refreshTaskFlowNext) window.refreshTaskFlowNext();
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

  async function attemptSubmit(blob, mimeType) {
    mimeType = mimeType || blob.type || 'audio/webm';
    recordBtn.style.display = 'none';
    statusEl.textContent = 'Uploading…';
    statusEl.style.color = 'var(--muted)';

    const { error: uploadError } = await sb.storage.from('speaking-recordings').upload(path, blob, { contentType: mimeType, upsert: true });

    if (uploadError) {
      statusEl.innerHTML = '';
      statusEl.appendChild(document.createTextNode('Upload failed — check your connection, then '));
      const retryBtn = document.createElement('button');
      retryBtn.className = 'ghost';
      retryBtn.textContent = '🔄 Retry upload';
      retryBtn.style.marginLeft = '6px';
      retryBtn.addEventListener('click', () => attemptSubmit(blob, mimeType));
      statusEl.appendChild(retryBtn);
      statusEl.style.color = 'var(--warn)';
      return;
    }

    const { error: saveError } = await sb.from('answers').upsert(
      { student_id: userId, day, task, field_id: fieldId, value: path, updated_at: new Date().toISOString() },
      { onConflict: 'student_id,day,field_id' }
    );

    if (saveError) {
      statusEl.innerHTML = '';
      statusEl.appendChild(document.createTextNode('Recording uploaded, but saving it failed — '));
      const retryBtn = document.createElement('button');
      retryBtn.className = 'ghost';
      retryBtn.textContent = '🔄 Retry saving';
      retryBtn.style.marginLeft = '6px';
      retryBtn.addEventListener('click', () => attemptSubmit(blob, mimeType));
      statusEl.appendChild(retryBtn);
      statusEl.style.color = 'var(--warn)';
      return;
    }

    await showLocked();
  }

  recordBtn.addEventListener('click', async () => {
    if (recordBtn.dataset.state === 'idle') {
      if (typeof MediaRecorder === 'undefined') {
        statusEl.textContent = 'Recording isn\'t supported in this browser — please try Chrome or Safari, updated to the latest version.';
        statusEl.style.color = 'var(--warn)';
        return;
      }

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

      // Safari/iPhone doesn't support audio/webm — fall back to whatever it does support.
      const mimeCandidates = ['audio/webm', 'audio/mp4', 'audio/aac', 'audio/ogg'];
      const supportedMime = mimeCandidates.find(t => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t));

      chunks = [];
      try {
        mediaRecorder = supportedMime ? new MediaRecorder(stream, { mimeType: supportedMime }) : new MediaRecorder(stream);
      } catch (err) {
        statusEl.textContent = 'Could not start recording on this device — please try a different browser.';
        statusEl.style.color = 'var(--warn)';
        stream.getTracks().forEach(t => t.stop());
        return;
      }
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

      const recordedMime = mediaRecorder.mimeType || 'audio/webm';
      const blob = new Blob(chunks, { type: recordedMime });
      await attemptSubmit(blob, recordedMime);
    }
  });
}

// ============================================
// LIVE DAYS — checks which days/dayN.html files actually exist on the
// server (1-30), instead of relying on a manually maintained list.
// Uploading a day's file is what makes it live; nothing else to edit.
// ============================================
// Days that are full mock exams rather than regular content days.
// Add future mock days here — every dashboard reads from this one place.
const MOCK_DAYS = [11, 18, 25, 30];

async function getLiveDays(folder, maxDays) {
  folder = folder || 'days';
  maxDays = maxDays || 30;
  const checks = await Promise.all(
    Array.from({ length: maxDays }, (_, i) => {
      const day = i + 1;
      return fetch(`${folder}/day${day}.html`, { method: 'HEAD' })
        .then(res => res.ok ? day : null)
        .catch(() => null);
    })
  );
  return checks.filter(d => d !== null);
}

/* ============================================
   IELTS MARATHON — shared logic
   ============================================ */

// ---------- Auth gate (used on every page that requires a login) ----------
// Every protected page must load supabase-config.js and the Supabase JS CDN
// script BEFORE this file. Call requireAuth(onReady) once the page loads;
// onReady receives the logged-in user's profile row (full_name, role, group_id).
let _sbClient = null;
function getSupabaseClient() {
  // keepalive: true tells the browser this request must be allowed to
  // finish even if the page is being unloaded right now (a refresh, a tab
  // close). Without it, a save that's correctly in flight can still be
  // killed mid-request by the very refresh that triggered it — the fix in
  // goNext()/flushPendingSaves gets the save started in time, but only this
  // makes the browser actually let it land.
  //
  // IMPORTANT: browsers cap the total body size of a keepalive request at
  // ~64KB. That's plenty for a text answer, but a speaking recording longer
  // than a couple of seconds blows straight past it — with keepalive on,
  // the browser just kills the upload outright, which looked like "upload
  // failed" for any recording longer than 2-3 seconds. So keepalive is only
  // applied to the small table writes (answers/progress/points), never to
  // storage uploads (audio files, or anything else in Supabase Storage).
  if (!_sbClient) {
    _sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      global: {
        fetch: (url, options = {}) => {
          const isStorageUpload = typeof url === 'string' && url.includes('/storage/v1/object/');
          return fetch(url, isStorageUpload ? options : { ...options, keepalive: true });
        }
      }
    });
  }
  return _sbClient;
}

// Supabase caps a single request at 1,000 rows by default — this pages
// through in 1,000-row batches so a query on a large table (points,
// progress, profiles once enrollment grows) never gets silently truncated.
async function fetchAllRows(buildQuery) {
  const pageSize = 1000;
  let from = 0;
  let all = [];
  while (true) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1);
    if (error) { console.error(error); break; }
    all = all.concat(data || []);
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return all;
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
// A "week" is whatever stretch of days sits between two mocks — not a
// fixed 7-day block. With mocks at days 11/18/25/30, week 3 is 19–24,
// exactly as it should be.
function getWeekBounds(day, mockDaysForTrack) {
  const mocks = (mockDaysForTrack || MOCK_DAYS).slice().sort((a, b) => a - b);
  let start = 1;
  for (const mockDay of mocks) {
    const end = mockDay - 1;
    if (day <= end) return [start, end];
    start = mockDay + 1;
  }
  return [start, Math.max(start, day)];
}

// For the leaderboard's "This week" view specifically — a week's results
// only become visible once that week is genuinely over, not while it's
// still in progress. Returns [start, end] of the most recent week that has
// fully finished (i.e. its mock day has passed), or null if none has
// finished yet. The very first mock day is the boundary before points
// tracking even started, not a real week under this system, so it's
// skipped as a candidate end-of-week — the first real week is the one
// ending at the second mock day.
function getMostRecentCompletedWeek(currentDay, mockDaysForTrack) {
  const mocks = (mockDaysForTrack || MOCK_DAYS).slice().sort((a, b) => a - b);
  let mostRecent = null;
  for (let i = 1; i < mocks.length; i++) {
    if (mocks[i] < currentDay) mostRecent = [mocks[i - 1] + 1, mocks[i]];
  }
  return mostRecent;
}

// Streak = consecutive day numbers (counting back from the highest day
// the student has touched) with at least one completed task. Day-number
// based rather than calendar-based, since that's how the program runs.
// "Today" (for the leaderboard and profile stats) means the day the class
// has actually reached — not simply the highest day file that happens to
// exist in the repo. Days often get built well ahead of when the class
// gets there, so file-existence alone would jump straight to a brand-new,
// empty day the moment it's uploaded. Real submitted points are a much
// more honest signal of where the class actually is.
async function getMostRecentLiveDay(profile) {
  // Challenge 2.0 runs on a fixed calendar schedule — "today" is a known
  // calculation, not something to guess from who has submitted data so
  // far. This also sidesteps the chicken-and-egg problem the old
  // points-guessing approach had at the start of each new day, before
  // anyone had submitted anything yet for it.
  if (profile && profile.challenge === '2.0') {
    return getCurrentDayNumberC2();
  }

  const sb = getSupabaseClient();
  const cfg = trackConfigFor(profile);

  try {
    // A simple, unfiltered "what's the highest day with any points"
    // lookup — deliberately not scoped per-track here, since that would
    // require listing every student's ID in the query, which is exactly
    // the URL-length trap that broke this before. This path is only used
    // for Challenge 1.0 now, which has no other reliable "today" signal.
    const { data } = await sb.from('points').select('day').order('day', { ascending: false }).limit(1);
    if (data && data.length > 0) return data[0].day;
  } catch (e) { /* fall through to the file-existence fallback below */ }

  // Fallback for a brand-new track with no points recorded yet at all —
  // the best available guess is simply the first day that's open.
  const liveDays = await getLiveDays(cfg.folder, cfg.totalDays);
  return liveDays.length ? Math.min(...liveDays) : 1;
}

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
  const path = window.location.pathname;
  if (path.includes('/challenge2/')) return '../../'; // e.g. /challenge2/standard/day1.html — two levels deep
  if (path.includes('/days/')) return '../';           // Challenge 1.0 day pages — one level deep
  return '';
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

// ---------- Spelling & grammar review ----------
// Runs once, right when a writing task locks in — not on every keystroke.
// Uses LanguageTool's free public API (checks both spelling and basic
// grammar in one pass). This is a study aid shown to the student after
// submission, not part of grading — if the check fails or is unavailable
// for any reason, it fails silently rather than blocking anything.
function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Free, instant, no-network check: pulls every number/percentage that
// appears in this day's model sample answer, and flags any that don't
// show up anywhere in the student's own writing — a rough but genuinely
// useful proxy for "did you cover the same key data points as the model
// answer," without needing an AI model to judge it properly.
function extractDataPoints(text) {
  const normalized = text.replace(/per\s*cent/gi, '%').replace(/percent/gi, '%');
  // Matches a properly comma-grouped number (comma only counts when followed
  // by exactly 3 digits, e.g. "38,849") before falling back to a plain
  // digit run. The old version allowed a comma anywhere in the middle,
  // which meant an ordinary sentence comma right after a number — like
  // "2010, and 2016" — got swallowed into the match as "2010,".
  const matches = normalized.match(/\$?\d{1,3}(?:,\d{3})+(?:\.\d+)?%?|\$?\d+(?:\.\d+)?%?/g) || [];
  return [...new Set(matches)];
}

function normalizeToken(token) {
  return token.replace(/,/g, '');
}

function buildDataCoverageHtml(studentText) {
  const sampleEl = document.getElementById('sample-text');
  if (!sampleEl) return '';
  const sampleNumbers = extractDataPoints(sampleEl.textContent || '');
  if (sampleNumbers.length === 0) return '';

  const studentNormalized = studentText.replace(/per\s*cent/gi, '%').replace(/percent/gi, '%').replace(/,/g, '');
  const missing = sampleNumbers.filter(num => !studentNormalized.includes(normalizeToken(num)));
  if (missing.length === 0) return '';

  return '<p class="data-coverage-note"><em>You may have missed mentioning some figures covered in the model answer: ' +
    missing.map(escapeHtml).join(', ') +
    '. Worth double-checking you\'ve covered every key data point.</em></p>';
}

async function runGrammarCheck(textarea) {
  const text = textarea.value;
  if (!text.trim()) return;

  const resultBox = document.createElement('div');
  resultBox.className = 'grammar-review';

  const labelDiv = document.createElement('div');
  labelDiv.className = 'grammar-review-label';
  labelDiv.textContent = '📝 Spelling & grammar review';
  resultBox.appendChild(labelDiv);

  const loadingP = document.createElement('p');
  loadingP.className = 'grammar-review-loading';
  loadingP.textContent = 'Checking your writing…';
  resultBox.appendChild(loadingP);

  // Coverage note is instant (no network needed) and always sits at the
  // end of the box, per how this was asked for — appended now, so its
  // position doesn't depend on whether the grammar check above it
  // resolves quickly or slowly.
  const coverageHtml = buildDataCoverageHtml(text);
  if (coverageHtml) {
    const coverageWrap = document.createElement('div');
    coverageWrap.innerHTML = coverageHtml;
    resultBox.appendChild(coverageWrap);
  }

  textarea.insertAdjacentElement('afterend', resultBox);

  try {
    const res = await fetch('https://api.languagetool.org/v2/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      // "picky" mode catches noticeably more real grammar issues (subject-
      // verb agreement, article/countable-noun errors) than the default
      // mode, which is tuned conservative to avoid false positives.
      body: 'text=' + encodeURIComponent(text) + '&language=en-US&level=picky'
    });
    if (!res.ok) throw new Error('LanguageTool request failed: ' + res.status);
    const data = await res.json();
    const matches = (data.matches || []).slice().sort((a, b) => a.offset - b.offset);

    if (matches.length === 0) {
      loadingP.outerHTML = '<p class="grammar-review-clean">✓ No issues spotted — nice and clean!</p>';
      return;
    }

    let html = '';
    let cursor = 0;
    matches.forEach(m => {
      if (m.offset < cursor) return; // overlapping match, skip to avoid broken markup
      html += escapeHtml(text.slice(cursor, m.offset));
      const flagged = text.slice(m.offset, m.offset + m.length);
      html += '<span class="gr-error">' + escapeHtml(flagged) + '</span>';
      if (m.replacements && m.replacements.length > 0) {
        const suggestion = m.replacements.slice(0, 2).map(r => r.value).join(' / ');
        html += '<span class="gr-suggestion">(' + escapeHtml(suggestion) + ')</span>';
      }
      cursor = m.offset + m.length;
    });
    html += escapeHtml(text.slice(cursor));

    loadingP.outerHTML =
      '<p class="grammar-review-note">Unofficial — for your own reference only, doesn\'t affect your score.</p>' +
      '<div class="grammar-review-text">' + html + '</div>';
  } catch (e) {
    console.warn('Grammar check unavailable:', e);
    loadingP.outerHTML = '<p class="grammar-review-note">Check unavailable right now — this doesn\'t affect your submission.</p>';
  }
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

// ---------- Checkbox-group checker (e.g. "which of these were mentioned?") ----------
function checkCheckboxGroup(className, resultId) {
  const items = document.querySelectorAll('.' + className);
  let correctCount = 0;
  items.forEach((box) => {
    const shouldBeChecked = box.dataset.correct === 'true';
    const label = box.closest('label');
    if (box.checked === shouldBeChecked) {
      correctCount++;
      if (label) { label.style.color = 'var(--good)'; label.style.fontWeight = '600'; }
    } else if (label) {
      label.style.color = 'var(--warn)';
      label.style.fontWeight = '600';
    }
  });
  const resultEl = document.getElementById(resultId);
  if (resultEl) resultEl.textContent = `${correctCount}/${items.length} correct`;
}

// ---------- Flip cards (city photo matching, Challenge 2.0) ----------
function initFlipCards() {
  document.querySelectorAll('.flip-card').forEach((card) => {
    card.addEventListener('click', () => {
      if (card.classList.contains('locked')) return;
      const select = document.getElementById(card.dataset.select);
      if (!select.value) {
        select.style.borderColor = 'var(--warn)';
        select.focus();
        return;
      }
      const isCorrect = select.value === select.dataset.answer;
      card.classList.add('flipped', 'locked', isCorrect ? 'correct' : 'incorrect');
      select.disabled = true;
    });
  });
}


// ---------- Paraphrase hunt (Challenge 2.0) ----------
// Student clicks a question-phrase chip (arming it), then clicks through
// the matching word(s) in the passage one at a time, in order. Some
// answers are one word, others a short phrase — the running selection is
// checked against the target after every click: still a valid prefix,
// keep going; a genuine mismatch flashes red-bold and resets so they can
// retry, without ever revealing the actual answer.
function initParaphraseMatch() {
  let armed = null;
  let buffer = []; // array of { span, word } for the current attempt

  const items = document.querySelectorAll('.para-question-item');
  const words = document.querySelectorAll('.word-token');
  const status = document.getElementById('uf-paraphrase-status');

  function updateStatus() {
    if (!status) return;
    const done = document.querySelectorAll('.para-question-item.matched').length;
    status.textContent = `${done}/${items.length} matched`;
  }

  function clearBuffer() {
    buffer.forEach(b => b.span.classList.remove('pending'));
    buffer = [];
  }

  function flashWrong(span) {
    span.classList.add('wrong');
    setTimeout(() => span.classList.remove('wrong'), 500);
  }

  items.forEach((item) => {
    item.addEventListener('click', () => {
      if (item.classList.contains('matched')) return;
      items.forEach(i => i.classList.remove('selected'));
      clearBuffer();
      armed = item;
      item.classList.add('selected');
    });
  });

  words.forEach((span) => {
    span.addEventListener('click', () => {
      if (!armed || span.classList.contains('matched')) return;

      // Clicking a word already in the current attempt again undoes the
      // whole attempt so far — a simple, discoverable "start over" gesture.
      if (buffer.some(b => b.span === span)) {
        clearBuffer();
        return;
      }

      const target = armed.dataset.answer.toLowerCase();
      const candidate = buffer.map(b => b.word).concat(span.dataset.word).join(' ');

      if (candidate === target) {
        buffer.forEach(b => b.span.classList.remove('pending'));
        buffer.forEach(b => b.span.classList.add('matched'));
        span.classList.add('matched');
        armed.classList.add('matched');
        armed.classList.remove('selected');
        // Sync a paired hidden <select data-answer> (if this item has one),
        // the same trick initLineMatch uses — so a click-to-match task plugs
        // straight into the existing getCompletionStatus/checkAllAnswers/
        // computeTaskAccuracy pipeline (gating, scoring, points) with zero
        // changes needed to any of those three functions.
        if (armed.dataset.syncSelect) {
          const syncSel = document.getElementById(armed.dataset.syncSelect);
          if (syncSel) syncSel.value = syncSel.dataset.answer;
        }
        armed = null;
        buffer = [];
        updateStatus();
      } else if (target.startsWith(candidate)) {
        span.classList.add('pending');
        buffer.push({ span, word: span.dataset.word });
      } else {
        flashWrong(span);
        clearBuffer();
      }
    });
  });

  updateStatus();
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
// ---------- Shared completion-gating for "Check answers" buttons ----------
// Used by both checkAllAnswers and checkComprehension so every existing
// "Check answers" button site-wide gets this behavior automatically, with
// zero changes needed to any individual day file's HTML.
function getCompletionStatus(container) {
  const fields = [];
  container.querySelectorAll('.q-item').forEach(item => {
    fields.push({ el: item, filled: !!item.querySelector('input[type="radio"]:checked') });
  });
  container.querySelectorAll('.text-answer').forEach(input => {
    fields.push({ el: input, filled: input.value.trim() !== '' });
  });
  container.querySelectorAll('select[data-answer]').forEach(sel => {
    fields.push({ el: sel, filled: sel.value.trim() !== '' });
  });
  const total = fields.length;
  const answeredCount = fields.filter(f => f.filled).length;
  const firstUnanswered = fields.find(f => !f.filled);
  return { allFilled: answeredCount === total, firstUnanswered: firstUnanswered ? firstUnanswered.el : null, total, answeredCount };
}

function findCheckButton(containerId) {
  return document.querySelector(`button[onclick*="'${containerId}'"]`);
}

function rejectIncompleteCheck(containerId, scoreId, status) {
  const btn = findCheckButton(containerId);
  if (btn) {
    btn.classList.remove('shake-invalid');
    void btn.offsetWidth;
    btn.classList.add('shake-invalid');
    setTimeout(() => btn.classList.remove('shake-invalid'), 600);
  }
  const scoreEl = document.getElementById(scoreId);
  if (scoreEl) {
    scoreEl.textContent = `⚠ Please answer every question first (${status.answeredCount}/${status.total} done)`;
    scoreEl.style.color = '#dc2626';
  }
  if (status.firstUnanswered) {
    status.firstUnanswered.classList.remove('shake-invalid-field');
    void status.firstUnanswered.offsetWidth;
    status.firstUnanswered.classList.add('shake-invalid-field');
    setTimeout(() => status.firstUnanswered.classList.remove('shake-invalid-field'), 900);
    status.firstUnanswered.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function lockContainer(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.querySelectorAll('.text-answer').forEach(el => { el.disabled = true; });
  container.querySelectorAll('input[type="radio"]').forEach(el => { el.disabled = true; });
  container.querySelectorAll('select[data-answer]').forEach(el => { el.disabled = true; });
  const btn = findCheckButton(containerId);
  if (btn) { btn.disabled = true; btn.textContent = '✓ Checked — locked'; }
}

// ---------- Disable every "Check answers" button until its fields are filled ----------
// checkAllAnswers/checkComprehension already refuse to grade (and shake +
// show "X/Y done") on an incomplete attempt rather than hard-locking it —
// but that only helps if the button gets clicked and the function actually
// runs. This goes one step further and disables the button itself the
// moment its container isn't fully filled, so an empty or partial attempt
// can never be clicked into a 0/N lock in the first place — the exact
// failure mode that leaves a student stuck with no way back in except a
// manual database fix.
//
// Finds every check-answers button on the page itself, from its onclick
// attribute, so no individual day file needs to change or opt in — calling
// this once (from the end of initTaskFlow, after restore has run) covers
// every task on every day automatically, past and future.
function initCheckButtonGating() {
  const content = document.getElementById('content');
  if (!content) return;
  const wired = [];
  content.querySelectorAll('button[onclick]').forEach(btn => {
    const onclick = btn.getAttribute('onclick') || '';
    const m = onclick.match(/(?:checkAllAnswers|checkComprehension)\(\s*'([^']+)'/);
    if (!m) return;
    const container = document.getElementById(m[1]);
    if (!container) return;
    wired.push({ btn, container });
  });
  if (!wired.length) return;

  function refresh() {
    wired.forEach(({ btn, container }) => {
      // Already checked and locked — leave it exactly as lockContainer set it.
      if (btn.textContent.includes('locked')) return;
      const status = getCompletionStatus(container);
      btn.disabled = !status.allFilled;
    });
  }

  content.addEventListener('input', refresh);
  content.addEventListener('change', refresh);
  refresh(); // reflects any answers restoreField already filled in on load
}

// ============================================
// LINE-MATCHING WIDGET — click a word on the left, then its pair on the
// right, and a line connects them (the classic "draw a line between the
// matching pair" textbook exercise, instead of a dropdown).
//
// Deliberately built on top of the existing dropdown infrastructure rather
// than replacing it: each left-hand item has a hidden <select
// data-answer="..."> behind the scenes, and clicking a pair just sets that
// select's value and fires a 'change' event. That means saving, restoring
// on reload, checkAllAnswers grading, the score display, and mechanical
// points all keep working completely unchanged — this only adds a nicer
// visual layer on top.
//
// Expected markup:
// <div class="line-match" id="...">
//   <div class="lm-side lm-left">
//     <button type="button" class="lm-item" data-key="1">1. word</button>
//     ...
//   </div>
//   <svg class="lm-svg"></svg>
//   <div class="lm-side lm-right">
//     <button type="button" class="lm-item" data-key="A">A. definition</button>
//     ...
//   </div>
//   <!-- one hidden select per left item, holding every possible right key
//        as an <option> so .value can be set to any of them -->
//   <select class="lm-hidden-select" id="..." data-lm-key="1" data-answer="A" hidden>
//     <option value="A">A</option><option value="B">B</option>...
//   </select>
// </div>
// ============================================
function initLineMatch(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const svg = container.querySelector('.lm-svg');
  const leftItems = [...container.querySelectorAll('.lm-left .lm-item')];
  const rightItems = [...container.querySelectorAll('.lm-right .lm-item')];
  const hiddenSelects = [...container.querySelectorAll('.lm-hidden-select')];
  const connections = {}; // leftKey -> rightKey
  let selectedLeft = null;

  function hiddenFor(leftKey) {
    return hiddenSelects.find(s => s.dataset.lmKey === leftKey);
  }

  function redraw() {
    if (!svg) return;
    svg.innerHTML = '';
    const svgRect = svg.getBoundingClientRect();
    if (svgRect.width === 0) return; // not laid out yet — a later call (resize, rAF) will redraw
    Object.keys(connections).forEach(leftKey => {
      const rightKey = connections[leftKey];
      const leftEl = leftItems.find(i => i.dataset.key === leftKey);
      const rightEl = rightItems.find(i => i.dataset.key === rightKey);
      if (!leftEl || !rightEl) return;
      const lr = leftEl.getBoundingClientRect();
      const rr = rightEl.getBoundingClientRect();
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', lr.right - svgRect.left);
      line.setAttribute('y1', lr.top + lr.height / 2 - svgRect.top);
      line.setAttribute('x2', rr.left - svgRect.left);
      line.setAttribute('y2', rr.top + rr.height / 2 - svgRect.top);
      line.setAttribute('class', 'lm-line');
      const hidden = hiddenFor(leftKey);
      if (hidden && hidden.classList.contains('correct')) line.classList.add('lm-line-correct');
      if (hidden && hidden.classList.contains('incorrect')) line.classList.add('lm-line-incorrect');
      svg.appendChild(line);
    });
  }

  function refreshItemClasses() {
    leftItems.forEach(item => {
      const key = item.dataset.key;
      item.classList.toggle('lm-linked', !!connections[key]);
      const hidden = hiddenFor(key);
      item.classList.toggle('lm-correct', !!(hidden && hidden.classList.contains('correct')));
      item.classList.toggle('lm-incorrect', !!(hidden && hidden.classList.contains('incorrect')));
    });
    rightItems.forEach(item => {
      const key = item.dataset.key;
      const linkedLeftKey = Object.keys(connections).find(lk => connections[lk] === key);
      item.classList.toggle('lm-linked', !!linkedLeftKey);
      const hidden = linkedLeftKey ? hiddenFor(linkedLeftKey) : null;
      item.classList.toggle('lm-correct', !!(hidden && hidden.classList.contains('correct')));
      item.classList.toggle('lm-incorrect', !!(hidden && hidden.classList.contains('incorrect')));
    });
  }

  function connect(leftKey, rightKey) {
    connections[leftKey] = rightKey;
    const hidden = hiddenFor(leftKey);
    if (hidden) {
      hidden.value = rightKey;
      hidden.dispatchEvent(new Event('change', { bubbles: true }));
    }
    refreshItemClasses();
    redraw();
  }

  leftItems.forEach(item => {
    item.addEventListener('click', () => {
      if (item.disabled) return;
      leftItems.forEach(i => i.classList.remove('lm-selected'));
      selectedLeft = (selectedLeft === item.dataset.key) ? null : item.dataset.key;
      if (selectedLeft) item.classList.add('lm-selected');
    });
  });

  rightItems.forEach(item => {
    item.addEventListener('click', () => {
      if (item.disabled || !selectedLeft) return;
      connect(selectedLeft, item.dataset.key);
      leftItems.forEach(i => i.classList.remove('lm-selected'));
      selectedLeft = null;
    });
  });

  // Restore any connection already saved (e.g. after reloading the page).
  hiddenSelects.forEach(sel => {
    if (sel.value) connections[sel.dataset.lmKey] = sel.value;
  });
  refreshItemClasses();
  requestAnimationFrame(redraw); // wait one frame so layout is settled before measuring positions
  window.addEventListener('resize', redraw);

  // After "Check answers" runs and locks the hidden selects, disable the
  // visible blocks too and repaint the lines in their correct/incorrect
  // colors. checkAllAnswers's onclick already calls this by name — see
  // markLineMatchResult below — so no observer is needed here.
  container._lmRefresh = () => {
    leftItems.forEach(i => { i.disabled = true; });
    rightItems.forEach(i => { i.disabled = true; });
    refreshItemClasses();
    redraw();
  };
}

// Called right after checkAllAnswers grades a container that holds a
// line-match widget — repaints the connecting lines and blocks in their
// correct/incorrect colors, and locks further clicks. Safe to call on a
// container with no line-match widget in it; it just does nothing.
function markLineMatchResult(containerId) {
  const container = document.getElementById(containerId);
  if (container && container._lmRefresh) container._lmRefresh();
}

// ---------- Drag-to-reorder list (sentence/paragraph sequencing exercises) ----------
// Pointer Events, not native HTML5 drag-and-drop — most students open the
// platform on a phone, and native HTML5 DnD has no touch support at all.
// containerId wraps a .dnd-list of .dnd-item[data-key][data-sync-select]
// elements (shuffled order) plus one hidden <select data-answer="N"> per
// item, where N is that item's correct 1-based position — the same
// hidden-select trick initLineMatch and the paraphrase-match sync-select
// use, so a reorder task plugs into the existing getCompletionStatus /
// checkAllAnswers / computeTaskAccuracy pipeline with zero changes there.
function initDragReorder(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const list = container.querySelector('.dnd-list');
  if (!list) return;

  function syncHiddenSelects() {
    [...list.querySelectorAll('.dnd-item')].forEach((item, i) => {
      const sel = document.getElementById(item.dataset.syncSelect);
      // dispatch 'change' (bubbles) so this actually gets picked up and
      // saved — the same thing initLineMatch's connect() does for its own
      // hidden selects. Without this, a reordered answer looks saved but
      // silently never persists.
      if (sel) { sel.value = String(i + 1); sel.dispatchEvent(new Event('change', { bubbles: true })); }
    });
  }

  let dragEl = null, placeholder = null, pointerId = null;

  function onPointerMove(e) {
    if (!dragEl) return;
    e.preventDefault();
    const y = e.clientY;
    dragEl.style.transform = `translateY(${y - dragEl._startY}px)`;
    const items = [...list.querySelectorAll('.dnd-item:not(.dnd-dragging)')].filter(i => i !== placeholder);
    let closest = null, closestOffset = Number.NEGATIVE_INFINITY;
    items.forEach(item => {
      const box = item.getBoundingClientRect();
      const offset = y - (box.top + box.height / 2);
      if (offset < 0 && offset > closestOffset) { closestOffset = offset; closest = item; }
    });
    if (closest) list.insertBefore(placeholder, closest);
    else list.appendChild(placeholder);
  }

  function onPointerUp() {
    if (!dragEl) return;
    try { dragEl.releasePointerCapture(pointerId); } catch (e) {}
    dragEl.classList.remove('dnd-dragging');
    dragEl.style.transform = '';
    list.insertBefore(dragEl, placeholder);
    if (placeholder) placeholder.remove();
    placeholder = null;
    dragEl = null;
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);
    syncHiddenSelects();
  }

  list.querySelectorAll('.dnd-item').forEach(item => {
    item.addEventListener('pointerdown', (e) => {
      if (item.classList.contains('dnd-locked')) return;
      dragEl = item;
      dragEl._startY = e.clientY;
      pointerId = e.pointerId;
      try { item.setPointerCapture(pointerId); } catch (err) {}
      placeholder = document.createElement('div');
      placeholder.className = 'dnd-item dnd-placeholder';
      placeholder.style.height = item.getBoundingClientRect().height + 'px';
      list.insertBefore(placeholder, item.nextSibling);
      item.classList.add('dnd-dragging');
      document.addEventListener('pointermove', onPointerMove);
      document.addEventListener('pointerup', onPointerUp);
    });
  });

  // No initial syncHiddenSelects() call here, deliberately: restoreField
  // (which writes a returning student's saved order into these same hidden
  // selects) runs later, inside initTaskFlow, than this function does — so
  // an unconditional sync here would win the race and silently overwrite
  // real saved progress with the freshly-shuffled starting order on every
  // reload. Each hidden select's shuffled starting position is instead
  // baked into the HTML itself (the pre-selected <option>), so a brand-new
  // student's "Check" button still works before they've dragged anything,
  // and a returning student's restored value simply isn't touched here.
}

// Called after checkAllAnswers has run on a drag-reorder container — colors
// each item green/red by whether it landed in its correct position, and
// stops further dragging (mirrors markLineMatchResult's role for line-match).
function markDragReorderResult(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.querySelectorAll('.dnd-item').forEach(item => {
    item.classList.add('dnd-locked');
    const sel = document.getElementById(item.dataset.syncSelect);
    if (!sel) return;
    item.classList.toggle('dnd-correct', sel.classList.contains('correct'));
    item.classList.toggle('dnd-incorrect', sel.classList.contains('incorrect'));
  });
}

function checkComprehension(containerId, scoreId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const status = getCompletionStatus(container);
  if (!status.allFilled) { rejectIncompleteCheck(containerId, scoreId, status); return; }
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
    scoreEl.style.color = '';
  }
  lockContainer(containerId);
}

// ---------- Show/hide toggle (used for the listening transcript) ----------
function initCollapseToggle(buttonId, targetId, showLabel, hideLabel) {
  const btn = document.getElementById(buttonId);
  const target = document.getElementById(targetId);
  target.style.display = 'none';
  btn.textContent = showLabel;
  btn.addEventListener('click', () => {
    const isCurrentlyVisible = target.style.display !== 'none';
    target.style.display = isCurrentlyVisible ? 'none' : 'block';
    btn.textContent = isCurrentlyVisible ? showLabel : hideLabel;
  });
}

// ---------- Gated answer reveal for "find and correct the mistake" exercises ----------
// The reveal button stays disabled until every textarea matched by
// textareaSelector has something written in it. Once the student clicks
// reveal, their textareas are locked read-only so they can't quietly edit
// their attempt after seeing the answer — a genuine self-check, not a
// look-then-fix.
function initGatedMistakeReveal(buttonId, answerBoxId, textareaSelector) {
  const btn = document.getElementById(buttonId);
  const box = document.getElementById(answerBoxId);
  const textareas = Array.from(document.querySelectorAll(textareaSelector));
  if (!btn || !box || textareas.length === 0) return;
  box.style.display = 'none';
  btn.disabled = true;

  function refresh() {
    const allFilled = textareas.every(t => t.value.trim().length > 0);
    btn.disabled = !allFilled;
  }
  textareas.forEach(t => t.addEventListener('input', refresh));
  refresh();

  btn.addEventListener('click', () => {
    if (window.__flushAllPendingSaves) window.__flushAllPendingSaves();
    box.style.display = 'block';
    textareas.forEach(t => { t.readOnly = true; });
    btn.disabled = true;
    btn.textContent = 'Answers revealed';
  }, { once: true });
}

// ---------- Combined checker: radio-based q-items AND free-text note-completion inputs ----------
function checkAllAnswers(containerId, scoreId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const status = getCompletionStatus(container);
  if (!status.allFilled) { rejectIncompleteCheck(containerId, scoreId, status); return; }
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

  // Dropdown matching questions — the same data-answer pattern as
  // computeTaskAccuracy uses for mechanical points, but this function
  // never had matching support added, so every select-based matching
  // task was silently scoring 0/0 until now.
  container.querySelectorAll('select[data-answer]').forEach((sel) => {
    total++;
    sel.classList.remove('correct', 'incorrect');
    if (sel.value === sel.dataset.answer) {
      correct++;
      sel.classList.add('correct');
      sel.style.borderColor = 'var(--good)';
    } else {
      sel.classList.add('incorrect');
      sel.style.borderColor = 'var(--warn)';
      sel.title = `Correct answer: ${sel.dataset.answer}`;
    }
  });

  const scoreEl = document.getElementById(scoreId);
  if (scoreEl) { scoreEl.textContent = `Score: ${correct} / ${total}`; scoreEl.style.color = ''; }
  lockContainer(containerId);
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

// A big, centered, briefly-shown warning — used for the recording-too-
// short case specifically, where the small bottom save banner isn't
// attention-grabbing enough. Lazily created once, then reused, matching
// the same pattern as getSaveBanner above.
function showBigWarning(message) {
  let el = document.getElementById('bigWarningBanner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'bigWarningBanner';
    el.style.cssText = 'position:fixed; top:50%; left:50%; transform:translate(-50%, -50%) scale(0.9); z-index:10000; padding:28px 40px; border-radius:16px; font:800 1.4rem var(--body, sans-serif); text-align:center; max-width:90vw; box-shadow:0 12px 40px #00000050; background:#dc2626; color:#fff; opacity:0; transition:opacity 0.2s ease, transform 0.2s ease; pointer-events:none;';
    document.body.appendChild(el);
  }
  el.textContent = message;
  // Restart the transition cleanly even if a previous one is still fading.
  el.style.transition = 'none';
  el.style.opacity = '0';
  el.style.transform = 'translate(-50%, -50%) scale(0.9)';
  requestAnimationFrame(() => {
    el.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
    el.style.opacity = '1';
    el.style.transform = 'translate(-50%, -50%) scale(1)';
  });
  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translate(-50%, -50%) scale(0.9)';
  }, 2600);
}

// Shared by saveAnswer/saveProgress/saveTaskPoints. Handles BOTH failure
// shapes a Supabase call can produce: a graceful {error} response, and a
// genuinely thrown exception (the network is actually unreachable for a
// moment, not just slow — a real, common case on a weak mobile signal).
// Previously only the first shape was caught, so a real disconnection blip
// threw an unhandled promise rejection with zero visible warning and no
// retry — the student's typed text stayed on screen looking perfectly
// fine, while nothing ever reached the database. This is very likely why
// some students' answers "were right there" on their own screen but were
// simply absent when checked from anywhere else.
async function upsertWithRetry(table, payload, onConflict) {
  const sb = getSupabaseClient();
  try {
    const res = await sb.from(table).upsert(payload, { onConflict });
    if (res.error) throw res.error;
    showSaveRecovered();
    return true;
  } catch (err) {
    console.error(table + ' save failed:', err);
    showSaveWarning();
    // one silent retry after a short delay — covers a brief network blip
    // without bothering the student
    setTimeout(async () => {
      try {
        const retry = await sb.from(table).upsert(payload, { onConflict });
        if (retry.error) throw retry.error;
        showSaveRecovered();
      } catch (err2) {
        console.error(table + ' retry also failed:', err2);
        // Leave the warning banner up rather than retry again — if the
        // connection is genuinely still down, another silent attempt would
        // just repeat the same failure with no benefit.
      }
    }, 3000);
    return false;
  }
}

async function saveAnswer(userId, day, task, fieldId, value, isCorrect) {
  await upsertWithRetry('answers',
    { student_id: userId, day, task, field_id: fieldId, value: String(value), is_correct: isCorrect, updated_at: new Date().toISOString() },
    'student_id,day,field_id'
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

// ============================================
// POINTS ENGINE
// Auto-awards points when a task is locked in (see goNext()).
// Manual categories (writing, bonus_*) are entered by teachers/checkers
// in their dashboards and never touched here.
// ============================================
const POINTS_MAX = {
  'writing-mini': 2, speaking: 2, 'writing-big': 5
};

// Scores every gradable field inside a task container (radios, selects,
// text-answer gap fills) — works across any task layout without needing
// to know which task number they landed on that day.
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

async function saveTaskPoints(userId, day, category, points, extra) {
  extra = extra || {};
  const payload = {
    student_id: userId, day, category, points,
    max_points: POINTS_MAX[category] || null,
    percent: extra.percent != null ? extra.percent : null,
    awarded_by: extra.awardedBy || 'system',
    comment: extra.comment || null,
    updated_at: new Date().toISOString()
  };
  await upsertWithRetry('points', payload, 'student_id,day,category');
}

// Called right after a task locks in (see goNext()). Silently does nothing
// for task types that aren't auto-scored (writing, sample answer, etc.).
// Mechanical fields (radio, select, text-answer gap fills) earn 1 point
// per correct answer, counted directly — not a flat per-task amount, not
// a percentage. Speaking and writing (mini and big) are no longer
// auto-scored at all here — those are entirely mentor-assigned, per
// question, from the mentor dashboard.
async function autoAwardPoints(userId, day, taskContainer) {
  const hasGradable = taskContainer.querySelector('input[type="radio"][data-correct], select[data-answer], input.text-answer[data-correct]');
  if (!hasGradable) return; // speaking / writing / ungraded — mentor-only, nothing to auto-award
  const { correct } = computeTaskAccuracy(taskContainer);
  const taskEl = taskContainer.id || ('task-' + day);
  await saveTaskPoints(userId, day, 'mech-' + taskEl, correct);
}

async function saveProgress(userId, day, task, completed, locked) {
  await upsertWithRetry('progress',
    { student_id: userId, day, task, completed, locked, updated_at: new Date().toISOString() },
    'student_id,day,task'
  );
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

// ============================================
// COMPUTER-DELIVERED (CDI) READING TOOL CAPTURE
// The self-contained reading-test tool (used via <iframe>) lives in its own
// document and can't call saveAnswer/saveTaskPoints directly. When a student
// clicks Submit inside it, it posts its results to the parent window via
// postMessage; this listens for that message from ONE specific iframe (so
// multiple reading passages on the same day never get mixed up) and saves
// the results into the exact same answers/points/progress tables every
// other task type uses — so mentors and the admin dashboard see it exactly
// like any other graded task.
// ============================================
async function initCdiReadingCapture(userId, day, taskNumber, iframeEl) {
  if (!iframeEl) return;
  if (currentUserRole === 'admin' || currentUserRole === 'mentor') return; // staff preview never writes or restricts

  // Safe default: never block Next on this check. It only gets switched to
  // 'false' below once we've positively confirmed (no errors) that this is
  // a genuinely fresh, unsubmitted attempt. If the lookup below is slow,
  // fails, or errors out for any reason, Next stays exactly as permissive
  // as it always was rather than getting stuck disabled forever.
  iframeEl.dataset.cdiReadingDone = 'true';

  // The message listener is registered unconditionally, up front, so a
  // live submission is always captured even if the completion check below
  // never finishes or throws.
  let isCompleted = false;
  window.addEventListener('message', async (event) => {
    if (event.source !== iframeEl.contentWindow) return;
    const data = event.data;
    if (!data) return;

    // In-progress draft, saved silently so a refresh or a later session
    // picks back up where the student left off. Skipped once the task is
    // genuinely completed, since nothing should overwrite a locked result.
    if (data.type === 'cdi-reading-progress') {
      if (isCompleted) return;
      try {
        await Promise.all((data.items || []).map(item =>
          saveAnswer(userId, day, taskNumber, 'reading-q' + item.n, item.value, null)
        ));
      } catch (e) {}
      return;
    }

    if (data.type !== 'cdi-reading-result') return;
    try {
      await Promise.all((data.items || []).map(item =>
        saveAnswer(userId, day, taskNumber, 'reading-q' + item.n, item.value, item.correct)
      ));
      // 1 point per correct answer, same universal rule as every other
      // mechanical question type — data.score is already that raw count.
      await saveTaskPoints(userId, day, 'mech-task' + taskNumber, data.score || 0);
      await saveProgress(userId, day, taskNumber, true, false);
    } catch (e) {}
    isCompleted = true;
    iframeEl.dataset.cdiReadingDone = 'true';
    if (window.refreshTaskFlowNext) window.refreshTaskFlowNext();
  });

  try {
    const sb = getSupabaseClient();

    // "Completed" means the task itself was marked done (i.e. the student
    // clicked Submit inside the tool) — NOT just that some answer rows exist,
    // since in-progress drafts are now saved as ungraded answer rows too.
    const { data: prog } = await sb.from('progress')
      .select('completed')
      .eq('student_id', userId).eq('day', day).eq('task', taskNumber).eq('completed', true);
    // Never downgrade back to false — if a live submission already flipped
    // this true (via the message listener above) while this query was
    // still in flight, that result stands. Only ever moves false -> true here.
    if (prog && prog.length > 0) isCompleted = true;

    // Whatever's been saved so far — a finished attempt (with is_correct set)
    // or an in-progress draft (is_correct null) — gets fed back into the tool
    // once it loads, instead of showing a dead-end summary or a blank page.
    const { data: existing } = await sb.from('answers')
      .select('field_id, value, is_correct')
      .eq('student_id', userId).eq('day', day).eq('task', taskNumber)
      .like('field_id', 'reading-q%');

    const restoreItems = (existing || [])
      .map(row => ({ n: parseInt(row.field_id.replace('reading-q', ''), 10), value: row.value, correct: row.is_correct }))
      .filter(it => !isNaN(it.n));

    if (restoreItems.length > 0) {
      const sendRestore = () => {
        try { iframeEl.contentWindow.postMessage({ type: 'cdi-reading-restore', items: restoreItems, graded: isCompleted }, '*'); } catch (e) {}
      };
      let ready = false;
      try { ready = iframeEl.contentDocument && iframeEl.contentDocument.readyState === 'complete'; } catch (e) {}
      if (ready) sendRestore(); else iframeEl.addEventListener('load', sendRestore, { once: true });

      if (isCompleted) {
        const correctCount = restoreItems.filter(it => it.correct === true).length;
        const wrapper = iframeEl.closest('.full-bleed') || iframeEl.parentElement;
        wrapper.insertAdjacentHTML('beforebegin', `<p style="color:var(--muted); margin:0 0 10px;">✓ Completed — you scored ${correctCount} / ${restoreItems.length}. Reviewing your answers below (read-only).</p>`);
      }
    }

    // Only now, having positively confirmed there's no completed attempt on
    // record, do we actually gate Next. Any error above skips this line
    // entirely and the safe default from the top of the function stands.
    iframeEl.dataset.cdiReadingDone = isCompleted ? 'true' : 'false';
    if (window.refreshTaskFlowNext) window.refreshTaskFlowNext();
  } catch (e) {
    // DB lookup failed — leave the safe default (Next enabled) in place
    // rather than stranding the student on a task they may have already
    // finished in a previous session.
  }
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
// ---------- Mentor comments — shown to the student on their own work ----------
// Runs automatically for every real student on every day page (wired into
// initTaskFlow, not something each day file needs to call itself). Finds the
// exact field a comment was left on — a writing box by its id, or a speaking
// question by its data-field — and drops a visually distinct feedback box
// right after it, matching mentor_comments to what the mentor dashboard saves.
async function initMentorComments(userId, dayNumber) {
  const sb = getSupabaseClient();
  const { data: comments } = await sb.from('mentor_comments').select('field_id, comment').eq('student_id', userId).eq('day', dayNumber);
  (comments || []).forEach(c => {
    if (!c.comment || !c.comment.trim()) return;
    const anchor = document.getElementById(c.field_id) || document.querySelector('[data-field="' + c.field_id + '"]');
    if (!anchor) return;
    if (anchor.parentElement.querySelector(':scope > .mentor-feedback-box')) return; // don't duplicate on re-run
    const box = document.createElement('div');
    box.className = 'mentor-feedback-box';
    box.innerHTML = '<span class="mentor-feedback-label">💬 Mentor feedback</span>' + c.comment.replace(/</g, '&lt;');
    anchor.insertAdjacentElement('afterend', box);
  });
}

// ---------- PERMANENT SAFETY NET: no field can ever silently fail to save again ----------
// Every "answers are disappearing" bug we've hit so far — on every level,
// found reactively, one file at a time — has traced back to the exact same
// root cause: the autosave system keys every field by its id (or, for
// radios, by its name+value), and silently does nothing if that identity is
// missing. A missing id or a missing radio value doesn't error, doesn't
// warn, doesn't show up in any test unless someone reloads the page and
// checks — it just quietly never saves, while looking completely normal to
// the student typing into it.
//
// Auditing every existing file by hand and patching each one found the bug
// on Standard Day 8 (and earlier, on the new Day 9s) — but that only fixes
// the files someone happened to check. It does nothing for a file nobody's
// looked at yet, or a future day that repeats the same slip. That's the
// actual problem: this bug class can only ever be found reactively, after
// students have already lost work, for as long as fixing it means manually
// auditing HTML.
//
// So instead of relying on every future file being built perfectly, this
// runs automatically on every single day page, for every student, right
// before anything is restored or wired up, and guarantees the two specific
// conditions that have caused every incident so far can no longer exist:
//   1. Every radio button gets a real value="" attribute if it's missing
//      one, numbered by its position within its own name-group — exactly
//      the convention already used everywhere this was fixed by hand.
//      Without this, a restored answer can never be found again on reload,
//      because restoring a radio works by searching for a matching value.
//   2. Every field the autosave system would otherwise key by id — a
//      text-answer input, a plain text input, a required textarea, or any
//      select — gets one automatically if it's missing, derived from its
//      task number and position so it stays stable across reloads for that
//      same page.
// A field that already has what it needs is left completely untouched.
// This makes the entire bug class structurally impossible from here on,
// for every existing day and every day still to be built, without
// depending on anyone remembering to check for it ever again.
function ensureFieldIdentitySafety() {
  const content = document.getElementById('content');
  if (!content) return;

  const radioGroupCounters = {};
  content.querySelectorAll('input[type="radio"]').forEach(r => {
    if (r.hasAttribute('value') && r.getAttribute('value') !== '') return;
    const name = r.name || '';
    const idx = radioGroupCounters[name] || 0;
    radioGroupCounters[name] = idx + 1;
    r.setAttribute('value', String(idx));
    console.warn('[auto-fix] radio was missing value= — assigned automatically so it can be saved/restored:', r.outerHTML.slice(0, 100));
  });

  let autoIdCounter = 0;
  content.querySelectorAll('input.text-answer, input[type="text"]:not(.notes-box), textarea.text-answer, textarea.no-check:not(.notes-box), select').forEach(el => {
    if (el.id) return;
    const taskEl = el.closest('.task');
    const taskNum = taskEl ? taskEl.dataset.task : 'x';
    autoIdCounter += 1;
    el.id = `autoid-task${taskNum}-${autoIdCounter}`;
    console.warn('[auto-fix] field was missing id= — assigned automatically so it can be saved/restored:', el.outerHTML.slice(0, 100));
  });
}

async function initTaskFlow(dayNumber, totalTasks, userId, checkFns) {

  ensureFieldIdentitySafety();
  checkFns = checkFns || {};
  const isAdmin = currentUserRole === 'admin' || currentUserRole === 'mentor';
  let current = 1;
  const doneTasks = {};
  const lockedTasks = {};

  if (isAdmin) {
    const banner = document.createElement('div');
    banner.className = 'wrap';
    banner.style.cssText = 'padding-top:16px;';
    banner.innerHTML = `<p style="font-family:var(--mono); font-size:0.78rem; color:var(--accent); background:var(--accent-soft); display:inline-block; padding:6px 14px; border-radius:8px;">🔑 Staff preview — nothing on this page is saved, and every task is unlocked</p>`;
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
    initMentorComments(userId, dayNumber);
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

    // CDI reading tests live inside an iframe, invisible to the plain-DOM
    // checks below — without this they'd fall through as "nothing to fill
    // in" and Next would be active before the student has even opened it.
    // initCdiReadingCapture sets this dataset flag once a saved/completed
    // result is confirmed (on load) or a fresh submission comes in.
    const readingFrame = container.querySelector('iframe[id^="reading-iframe"]');
    if (readingFrame) return readingFrame.dataset.cdiReadingDone === 'true';

    const questionBoxes = container.querySelectorAll('.question-box[data-field]');
    if (questionBoxes.length > 0) {
      for (const qb of questionBoxes) { if (!qb.classList.contains('recorded')) return false; }
      return true;
    }

    // Plain <input> text fields, PLUS free-answer textareas — every
    // .no-check textarea except .notes-box (which is an optional scratch
    // pad for jotting ideas before recording speech, never a real answer).
    // These were never required before, which is exactly the bug: a task
    // made entirely of "write your answer" textareas had nothing here to
    // check and fell through as "nothing to fill in".
    // Every field meant to hold a written answer — regardless of whether
    // it's a single-line input or a textarea. .no-check inputs were
    // previously excluded here (only .no-check textareas were fixed
    // earlier), which is exactly the inconsistency that let ungraded
    // listening-form inputs slip through with Next already active.
    const texts = container.querySelectorAll('input.text-answer, input[type="text"]:not(.notes-box), textarea.text-answer, textarea.no-check:not(.notes-box)');
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
      // Guarantee whatever was just typed is actually saved before the
      // fields get disabled below — without this, a save still sitting in
      // its debounce window could lose the race against freezeTask, leaving
      // a field that's both empty AND locked with no way to fix it.
      await flushPendingSaves(current);
      lockedTasks[current] = true;
      doneTasks[current] = true;
      await saveProgress(userId, dayNumber, current, true, true);
      await autoAwardPoints(userId, dayNumber, container);
      freezeTask(current, checkFns[current]);
      // Spelling/grammar review — regular days only (24+), never on mock
      // exam days, since those are meant to simulate the real, unassisted
      // test. dayNumber is already known at the call site, so no need to
      // touch every individual day file to enforce this.
      if (freeTextBox && dayNumber >= 24 && !MOCK_DAYS.includes(dayNumber)) {
        runGrammarCheck(freeTextBox);
      }
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
  const pendingSaves = {}; // fieldId -> the save call waiting on its debounce timer
  function fieldKeyFor(el) {
    if (el.type === 'radio') return 'radio_' + el.name;
    return el.id || null;
  }
  // Called right before a task gets locked (Next/Finish), so a save that's
  // still sitting in its 500ms debounce window doesn't get raced by the
  // freeze that follows — otherwise the field can end up both disabled AND
  // never actually saved, which looks like the answer was silently deleted.
  async function flushPendingSaves(taskNum) {
    const container = document.getElementById('task' + taskNum);
    if (!container) return;
    const flushes = [];
    container.querySelectorAll('input, select, textarea').forEach(el => {
      const fieldId = fieldKeyFor(el);
      if (fieldId && pendingSaves[fieldId]) {
        clearTimeout(debTimers[fieldId]);
        flushes.push(pendingSaves[fieldId]());
      }
    });
    // Radio groups: fieldKeyFor above only catches whichever radio the
    // listener last fired on, so also flush by name in case a different
    // one in the same group is what's actually pending.
    container.querySelectorAll('input[type="radio"][name]').forEach(el => {
      const fieldId = 'radio_' + el.name;
      if (pendingSaves[fieldId]) {
        clearTimeout(debTimers[fieldId]);
        flushes.push(pendingSaves[fieldId]());
      }
    });
    await Promise.all(flushes);
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
    const doSave = () => {
      delete pendingSaves[fieldId];
      return saveAnswer(userId, dayNumber, taskNum, fieldId, value, isCorrect);
    };
    pendingSaves[fieldId] = doSave;
    debTimers[fieldId] = setTimeout(doSave, 500);
    refreshNextButton();
  }

  // Same protection as flushPendingSaves above, but for a plain refresh or
  // tab close with no Next click at all — the debounce window is the same
  // vulnerability either way.
  function flushAllPendingSaves() {
    Object.keys(pendingSaves).forEach(fieldId => {
      clearTimeout(debTimers[fieldId]);
      pendingSaves[fieldId]();
    });
  }
  window.addEventListener('pagehide', flushAllPendingSaves);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushAllPendingSaves(); });
  // initGatedMistakeReveal (outside this closure) locks its own textareas
  // read-only independently of Next/freezeTask — this lets it flush too.
  window.__flushAllPendingSaves = flushAllPendingSaves;

  showTask(current);
  initHighlightTool(dayNumber);
  initCheckButtonGating();
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
      // .hl-tools is `position: fixed`, so getBoundingClientRect()'s
      // viewport-relative values are already correct as-is — adding
      // scrollX/scrollY here double-counted the scroll offset, so the
      // further down the page you'd scrolled, the further off the toolbar
      // would land.
      tools.style.left = Math.max(8, rc.left + rc.width / 2 - tools.offsetWidth / 2) + 'px';
      tools.style.top = Math.max(8, rc.top - tools.offsetHeight - 8) + 'px';
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
  'speaking-plants-q5': 'Part 3 — How do people feel when they eat vegetables that they grew on their own?',
  'speaking-town-q1': 'What is your hometown like?',
  'speaking-town-q2': 'How long have you lived there?',
  'speaking-town-q3': 'What do you like about your hometown?',
  'speaking-town-q4': "Is there anything you don't like about it?",
  'speaking-town-q5': "What's the most interesting part of your town?",
  'speaking-town-q6': 'Do you think your town has changed a lot?',
  'speaking-town-q7': 'Would you like to continue living there in the future?',
  'speaking-town-q8': 'Is your hometown a popular place for tourists?',
  'speaking-town-q9': "What's the transport like in your town?",
  'speaking-town-q10': 'How do you think your town will change in the future?',
  'speaking-stayed-1': 'Describe a place you have stayed at.',
  'speaking-livelocation-1': 'Talk about where you live, and where you would prefer to live, and why.',
  'speaking-town2-q1': 'Can you tell me what you do? Do you work, or are you a student?',
  'speaking-town2-q2': 'Where do you come from?',
  'speaking-town2-q3': 'Can you describe your town or city to me?',
  'speaking-town2-q4': 'What do you like about the area where you live?',
  'speaking-town2-q5': 'What things in your town or city do you not like?',
  'speaking-town2-q6': 'How is the area changing?',
  'speaking-town2-q7': 'What do people in your area do in their free time?',
  'speaking-town2-q8': 'What do you think visitors to your town or region should see? Why?'
};
function speakingLabel(fieldId) {
  return SPEAKING_QUESTIONS[fieldId] || fieldId.replace('speaking-', '').replace(/-/g, ' ');
}
async function initRecordControl(box, userId, day, task, fieldId, minSeconds) {
  minSeconds = minSeconds || 0;
  if (currentUserRole === 'admin' || currentUserRole === 'mentor') {
    const recordBtn = box.querySelector('.record-btn');
    const statusEl = box.querySelector('.record-status');
    if (recordBtn) { recordBtn.disabled = true; recordBtn.textContent = '● Recording disabled in staff preview'; }
    if (statusEl) { statusEl.textContent = ''; }
    return;
  }
  const sb = getSupabaseClient();
  const path = `${day}/${userId}/${fieldId}.webm`;

  // Some apps' built-in browsers (Telegram, Instagram, etc.) block
  // microphone access entirely — the Record button would otherwise just
  // look dead with no explanation. Warn upfront rather than after a
  // confusing silent failure.
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
    box.insertAdjacentHTML('afterbegin', `<p style="background:#fff3cd; color:#7c5a12; border-left:4px solid #d97706; padding:8px 12px; border-radius:6px; font-size:0.85rem; margin-bottom:10px;">⚠️ Recording may not work in this browser. If you opened this page inside Telegram, Instagram, or another app, tap the "···" or share icon and choose <strong>"Open in Safari"</strong> or <strong>"Open in Chrome"</strong> first.</p>`);
  }
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

    function showRetry(message, label) {
      statusEl.innerHTML = '';
      statusEl.appendChild(document.createTextNode(message + ' '));
      const retryBtn = document.createElement('button');
      retryBtn.className = 'ghost';
      retryBtn.textContent = label;
      retryBtn.style.marginLeft = '6px';
      retryBtn.addEventListener('click', () => attemptSubmit(blob, mimeType));
      statusEl.appendChild(retryBtn);
      statusEl.style.color = 'var(--warn)';
    }

    let uploadError;
    try {
      ({ error: uploadError } = await sb.storage.from('speaking-recordings').upload(path, blob, { contentType: mimeType, upsert: true }));
    } catch (err) {
      uploadError = err;
    }
    if (uploadError) {
      showRetry('Upload failed — check your connection, then', '🔄 Retry upload');
      return;
    }

    let saveError;
    try {
      ({ error: saveError } = await sb.from('answers').upsert(
        { student_id: userId, day, task, field_id: fieldId, value: path, updated_at: new Date().toISOString() },
        { onConflict: 'student_id,day,field_id' }
      ));
    } catch (err) {
      saveError = err;
    }
    if (saveError) {
      showRetry('Recording uploaded, but saving it failed —', '🔄 Retry saving');
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

      const minWarning = minSeconds > 0 ? ` Your recording must be at least ${Math.ceil(minSeconds/60)} minute${minSeconds > 60 ? 's' : ''} long, or you'll be asked to record it again.` : '';
      const confirmed = confirm('You only have ONE attempt to record this answer. Once you press Stop, it is submitted permanently and cannot be redone.' + minWarning + ' Make sure you\'re ready before you start.');
      if (!confirmed) return;

      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (err) {
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          // This is the case a plain refresh can never fix: once a site's
          // mic permission has been explicitly denied, the browser won't
          // even show the prompt again until the student resets it manually.
          statusEl.innerHTML = '⚠️ This browser has microphone access blocked for this site — refreshing the page will <u>not</u> fix this on its own. On a phone: tap the padlock/site-info icon next to the address bar → Permissions (or Site settings) → turn Microphone <strong>on</strong> → then reload the page. If you opened this link inside Telegram, Instagram, or another app, tap the "···" or share icon and choose <strong>"Open in Safari"</strong> or <strong>"Open in Chrome"</strong> instead — in-app browsers often block the microphone permanently and can\'t be fixed from inside the app.';
        } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
          statusEl.innerHTML = '⚠️ No microphone was found on this device. If you\'re using a laptop with an external mic, make sure it\'s plugged in and try again.';
        } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
          statusEl.innerHTML = '⚠️ Your microphone seems to be in use by another app (a call, another tab, etc.). Close anything else that might be using it and try again.';
        } else {
          statusEl.innerHTML = '⚠️ Microphone access was blocked. If you opened this page inside Telegram, Instagram, or another app, try opening it in Safari or Chrome directly instead — otherwise check your browser\'s microphone permissions for this site.';
        }
        statusEl.style.color = 'var(--warn)';
        statusEl.style.fontWeight = '600';
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
      // Runtime errors after start() (hardware dropped, etc.) — without this,
      // the button just silently stays stuck on "Record" with no explanation.
      mediaRecorder.onerror = (e) => {
        clearInterval(timerInterval);
        statusEl.textContent = 'Recording stopped unexpectedly — please try again. If this keeps happening, try a different browser.';
        statusEl.style.color = 'var(--warn)';
        recordBtn.disabled = false;
        recordBtn.dataset.state = 'idle';
        recordBtn.textContent = '● Record';
        recordBtn.classList.remove('recording');
        stream.getTracks().forEach(t => t.stop());
      };
      // start() itself was previously unguarded — on some devices/browsers
      // this throws even though permission was granted and the recorder
      // constructed fine, and with no catch here the button never updates
      // at all: permission genuinely granted, then total silent failure.
      try {
        mediaRecorder.start();
      } catch (err) {
        statusEl.textContent = 'Could not start recording on this device — please try a different browser, or update your current one to the latest version.';
        statusEl.style.color = 'var(--warn)';
        statusEl.style.fontWeight = '600';
        stream.getTracks().forEach(t => t.stop());
        return;
      }

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

      try {
        mediaRecorder.stop();
      } catch (err) {
        statusEl.textContent = 'Something went wrong finishing the recording — please refresh and try again.';
        statusEl.style.color = 'var(--warn)';
        recordBtn.disabled = false;
        recordBtn.dataset.state = 'idle';
        recordBtn.textContent = '● Record';
        recordBtn.classList.remove('recording');
        mediaRecorder.stream.getTracks().forEach(t => t.stop());
        return;
      }
      mediaRecorder.stream.getTracks().forEach(t => t.stop());
      // onstop should always fire, but if it somehow doesn't, this stops the
      // button from being stuck on "Uploading…" forever with no way out.
      await Promise.race([
        new Promise(resolve => { mediaRecorder.onstop = resolve; }),
        new Promise(resolve => setTimeout(resolve, 5000))
      ]);

      if (minSeconds > 0 && seconds < minSeconds) {
        // Doesn't count as the one permitted attempt — a student stopping
        // early by mistake shouldn't be permanently locked out of ever
        // completing this task. Reset to idle exactly like the empty-
        // recording case just below, so they can simply try again.
        const mins = Math.ceil(minSeconds / 60);
        statusEl.textContent = `That recording was only ${seconds}s — it needs to be at least ${mins} minute${mins > 1 ? 's' : ''} long. Please record it again.`;
        statusEl.style.color = 'var(--warn)';
        recordBtn.style.display = '';
        recordBtn.disabled = false;
        recordBtn.dataset.state = 'idle';
        recordBtn.textContent = '● Record';
        recordBtn.classList.remove('recording');
        showBigWarning(`⏱ Too short! Only ${seconds}s — needs to be at least ${mins} minute${mins > 1 ? 's' : ''}.`);
        // Remove and re-add the shake class so it can re-trigger on a
        // second short attempt in a row, not just the first.
        recordBtn.classList.remove('shake-invalid');
        void recordBtn.offsetWidth; // force a reflow so the animation restarts
        recordBtn.classList.add('shake-invalid');
        setTimeout(() => recordBtn.classList.remove('shake-invalid'), 600);
        return;
      }

      const recordedMime = mediaRecorder.mimeType || 'audio/webm';
      const blob = new Blob(chunks, { type: recordedMime });
      if (blob.size === 0) {
        statusEl.textContent = 'The recording came out empty — please try again.';
        statusEl.style.color = 'var(--warn)';
        recordBtn.disabled = false;
        recordBtn.dataset.state = 'idle';
        recordBtn.textContent = '● Record';
        recordBtn.classList.remove('recording');
        return;
      }
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

// Challenge 2.0's "what day is it" is a fixed calendar schedule, not
// something to guess from submitted data — Day 1 was Tuesday, September
// 15, 2026 (Tashkent time, UTC+5, no DST in Uzbekistan so this offset
// never changes). Every day since is just a calendar offset from that
// anchor. This is what the points/leaderboard system relies on to know
// which day "today" is, independent of whether anyone has submitted
// anything yet.
const C2_DAY1_DATE = '2026-09-15';
function getCurrentDayNumberC2() {
  const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1000;
  const nowTashkent = new Date(Date.now() + TASHKENT_OFFSET_MS);
  const todayDateStr = nowTashkent.toISOString().slice(0, 10);
  const day1 = new Date(C2_DAY1_DATE + 'T00:00:00Z');
  const today = new Date(todayDateStr + 'T00:00:00Z');
  const diffDays = Math.round((today - day1) / 86400000);
  return diffDays + 1;
}
// Every 7th day is a mock, recurring for the whole 45-day course (Day 6,
// 13, 20, 27, 34, 41) — the same pattern for every Challenge 2.0 level.
function mockDaysForC2(totalDays) {
  const days = [];
  for (let d = 6; d <= totalDays; d += 7) days.push(d);
  return days;
}

// The single source of truth for "which folder, how many days, which of
// them are mocks" for a given student. Challenge 1.0 is unchanged; each
// Challenge 2.0 level gets its own folder and day count. Used anywhere
// that needs to know "today" or "how many days total" for a specific
// student — index.html, leaderboard.html, profile.html.
function trackConfigFor(profile) {
  if (profile && profile.challenge === '2.0') {
    const level = profile.level || 'standard';
    const totalDays = 45;
    return {
      folder: `challenge2/${level}`,
      totalDays: totalDays,
      mockDays: mockDaysForC2(totalDays)
    };
  }
  return { folder: 'days', totalDays: 30, mockDays: MOCK_DAYS };
}

// Groups a flat list of groups (each needs .challenge and .level) into
// labeled sections, in a fixed, sensible order — used by every dashboard's
// group picker so Challenge 1.0 and each Challenge 2.0 level are visually
// separated instead of sitting in one undifferentiated grid.
function groupSectionLabel(g) {
  if (g.challenge === '2.0') {
    const level = g.level || 'standard';
    return `Challenge 2.0 — ${level.charAt(0).toUpperCase() + level.slice(1)}`;
  }
  return 'Challenge 1.0';
}

function renderGroupSections(groups, buttonHtmlFn) {
  const order = ['Challenge 1.0', 'Challenge 2.0 — Standard', 'Challenge 2.0 — Advanced', 'Challenge 2.0 — Expert'];
  const sections = {};
  groups.forEach(g => {
    const label = groupSectionLabel(g);
    sections[label] = sections[label] || [];
    sections[label].push(g);
  });
  return order.filter(label => sections[label] && sections[label].length > 0).map(label => `
    <div class="group-section">
      <h3 class="group-section-title">${label}</h3>
      <div class="group-btn-grid">${sections[label].map(buttonHtmlFn).join('')}</div>
    </div>
  `).join('');
}

// ---------- Shared task-count config, used by admin, mentor, and the student board ----------
// Single source of truth for "how many tasks does day N of track X have" —
// previously duplicated per-file, which let it silently drift out of date.
const TRACK_DAY_TOTAL_TASKS = {
  '1.0': { 1: 9, 2: 9, 3: 9, 5: 9, 6: 9, 7: 9, 8: 8, 9: 8, 10: 8, 12: 8, 13: 8, 14: 8, 15: 8, 16: 8 },
  '2.0-standard': { 1: 8, 2: 8, 3: 10, 4: 5, 5: 7, 6: 7, 7: 7, 8: 9, 9: 6 },
  '2.0-advanced': { 1: 6, 2: 7, 3: 9, 4: 7, 5: 4, 7: 7, 8: 5 },
  '2.0-expert': { 1: 6, 2: 7, 3: 9, 4: 8, 5: 4, 7: 8, 8: 7 }
};
function totalTasksForTrack(trackKey, day) { return (TRACK_DAY_TOTAL_TASKS[trackKey] || {})[day] || 9; }

// ---------- Which days has this student actually finished, for a given track? ----------
// A day counts as complete only once every one of its tasks is marked
// completed in the progress table — used to sequentially lock the board so
// a student can't skip ahead to a day they haven't earned yet.
async function getCompletedDaysForStudent(userId, trackKey, maxDay) {
  const sb = getSupabaseClient();
  const { data } = await sb.from('progress').select('day, task').eq('student_id', userId).eq('completed', true);
  const doneTasksByDay = {};
  (data || []).forEach(row => {
    if (!doneTasksByDay[row.day]) doneTasksByDay[row.day] = new Set();
    doneTasksByDay[row.day].add(row.task);
  });
  const completedDays = new Set();
  for (let d = 1; d <= maxDay; d++) {
    const total = totalTasksForTrack(trackKey, d);
    const doneCount = doneTasksByDay[d] ? doneTasksByDay[d].size : 0;
    if (doneCount >= total) completedDays.add(d);
  }
  return completedDays;
}

// ---------- Notification bell — shows unseen mentor feedback ----------
// One shared function, called on any page that has the bell markup (the
// student board first; can be added to day pages the same way later).
// Blinks and shows a red unread count until the student opens the dropdown,
// clicking an item marks it seen and takes them to that day.
async function initNotificationBell(userId, folder) {
  const sb = getSupabaseClient();
  const bell = document.getElementById('notif-bell');
  const badge = document.getElementById('notif-badge');
  const dropdown = document.getElementById('notif-dropdown');
  if (!bell || !badge || !dropdown) return;

  async function loadUnseen() {
    const { data } = await sb.from('mentor_comments')
      .select('id, day, task, field_id, comment, updated_at')
      .eq('student_id', userId)
      .is('seen_at', null)
      .order('updated_at', { ascending: false });
    const items = (data || []).filter(it => it.comment && it.comment.trim());

    if (items.length > 0) {
      badge.textContent = items.length > 9 ? '9+' : String(items.length);
      badge.style.display = 'flex';
      bell.classList.add('has-unread');
    } else {
      badge.style.display = 'none';
      bell.classList.remove('has-unread');
    }

    dropdown.innerHTML = items.length === 0
      ? '<p class="notif-empty">No new feedback</p>'
      : items.map(it => `<a href="${folder}/day${it.day}.html" class="notif-item" data-id="${it.id}">
          <span class="notif-day">Day ${it.day} · Task ${it.task}</span>
          <span class="notif-snippet">${it.comment.slice(0, 70).replace(/</g, '&lt;')}${it.comment.length > 70 ? '…' : ''}</span>
        </a>`).join('');

    dropdown.querySelectorAll('.notif-item').forEach(a => {
      a.addEventListener('click', async () => {
        await sb.from('mentor_comments').update({ seen_at: new Date().toISOString() }).eq('id', a.dataset.id);
      });
    });
  }

  bell.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.classList.toggle('show');
  });
  document.addEventListener('click', (e) => {
    if (!bell.contains(e.target) && !dropdown.contains(e.target)) dropdown.classList.remove('show');
  });

  await loadUnseen();
}

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

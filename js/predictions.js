// ============================================================
//  predictions.js  –  Logic for predictions.html
// ============================================================

let currentUser = null;
let allMatches   = [];     // array of match objects from Firestore
let userPreds    = {};     // { matchId: { home, away } }
let locked       = false;

const GROUP_ORDER    = ['A','B','C','D','E','F','G','H','I','J','K','L'];
const KNOCKOUT_ORDER = ['round32','round16','qf','sf','final'];
const KNOCKOUT_LABEL = {
  round32: 'Round of 32', round16: 'Round of 16',
  qf: 'Quarter-Finals', sf: 'Semi-Finals', final: 'Final'
};

// ── Bootstrap ─────────────────────────────────────────────
(async () => {
  currentUser = await requireAuth();
  buildNav(currentUser.username, currentUser.isAdmin);

  const settings = await loadSettings();
  locked = isPredictionLocked(settings);
  if (locked) {
    document.getElementById('lock-banner').classList.remove('d-none');
    document.getElementById('save-btn').disabled = true;
    document.getElementById('save-btn').textContent = '🔒 Predictions Locked';
  }

  await loadData();
  renderAll();
  updateSummary();
})();

// ── Load data from Firestore ───────────────────────────────
async function loadData() {
  // Load all matches
  const snap = await db.collection('matches').orderBy('sortOrder').get().catch(() =>
    db.collection('matches').get());
  allMatches = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  if (allMatches.length === 0) {
    document.getElementById('no-matches').classList.remove('d-none');
    document.getElementById('save-bar').classList.add('d-none');
    return;
  }

  // Load this user's predictions
  const predSnap = await db.collection('predictions').doc(currentUser.uid)
    .collection('matches').get();
  predSnap.forEach(d => {
    userPreds[d.id] = d.data();
  });
}

// ── Rendering ─────────────────────────────────────────────
function renderAll() {
  renderGroupStage();
  renderKnockoutStage();
}

function renderGroupStage() {
  const container = document.getElementById('group-matches');
  const groupMatches = allMatches.filter(m => m.type === 'group');
  if (groupMatches.length === 0) { container.innerHTML = '<div class="col text-muted">No group stage matches yet.</div>'; return; }

  let html = '';
  for (const grp of GROUP_ORDER) {
    const matches = groupMatches.filter(m => m.group === grp);
    if (matches.length === 0) continue;
    html += `<div class="col-12"><h5 class="text-white bg-success px-3 py-1 rounded">Group ${grp}</h5></div>`;
    for (const m of matches) {
      html += matchCard(m);
    }
  }
  container.innerHTML = html;
  attachInputListeners();
}

function renderKnockoutStage() {
  const container = document.getElementById('knockout-matches');
  const koMatches = allMatches.filter(m => m.type !== 'group');
  if (koMatches.length === 0) {
    container.innerHTML = '<div class="col text-muted py-3">Knockout matches will appear here once the group stage is complete.</div>';
    return;
  }
  let html = '';
  for (const stage of KNOCKOUT_ORDER) {
    const matches = koMatches.filter(m => m.type === stage);
    if (matches.length === 0) continue;
    html += `<div class="col-12"><h5 class="text-white bg-dark px-3 py-1 rounded">${KNOCKOUT_LABEL[stage] || stage}</h5></div>`;
    for (const m of matches) { html += matchCard(m); }
  }
  container.innerHTML = html;
  attachInputListeners();
}

function matchCard(m) {
  const pred = userPreds[m.id] || {};
  const predHome = pred.home !== undefined ? pred.home : '';
  const predAway = pred.away !== undefined ? pred.away : '';
  const pts = calcPoints(pred.home, pred.away, m.actualHome, m.actualAway, m.finished);
  const isFinished = !!m.finished;
  const inputDisabled = locked || isFinished ? 'disabled' : '';

  // Points badge
  let ptsBadge = '';
  if (isFinished && pts !== null) {
    const color = pts === 3 ? 'success' : pts >= 1 ? 'warning' : 'danger';
    ptsBadge = `<span class="badge bg-${color} ms-2">${pts} / 3 pts</span>`;
  } else if (isFinished && pts === null) {
    ptsBadge = `<span class="badge bg-secondary ms-2">No prediction</span>`;
  }

  // Actual score display
  let actualScore = '';
  if (isFinished) {
    actualScore = `<div class="text-center mt-1"><small class="text-success fw-bold">Final: ${m.actualHome} – ${m.actualAway}</small></div>`;
  }

  const homeTeam = m.homeTeam || 'TBD';
  const awayTeam = m.awayTeam || 'TBD';
  const homeFlag = m.homeFlag ? `<img src="${escHtml(m.homeFlag)}" class="flag-icon me-1" alt=""/>` : '';
  const awayFlag = m.awayFlag ? `<img src="${escHtml(m.awayFlag)}" class="flag-icon ms-1" alt=""/>` : '';
  const dateStr  = formatDateToEuropean(m.date || '');

  return `
    <div class="col-12 col-md-6 col-xl-4">
      <div class="card match-card ${isFinished ? 'border-success' : ''}">
        <div class="card-body p-2">
          <div class="d-flex justify-content-between align-items-center small text-muted mb-1">
            <span>${escHtml(dateStr)}</span>
            ${ptsBadge}
          </div>
          <div class="d-flex align-items-center justify-content-between">
            <div class="team-name text-end pe-2 team-home">
              ${homeFlag}
              <span class="team-text">${escHtml(homeTeam)}</span>
            </div>
            <div class="score-inputs d-flex align-items-center gap-1">
              <input type="number" min="0" max="99" class="form-control score-input text-center"
                     data-match="${m.id}" data-side="home"
                     value="${predHome}" ${inputDisabled} placeholder="-"/>
              <span class="fw-bold">–</span>
              <input type="number" min="0" max="99" class="form-control score-input text-center"
                     data-match="${m.id}" data-side="away"
                     value="${predAway}" ${inputDisabled} placeholder="-"/>
            </div>
            <div class="team-name text-start ps-2 team-away">
              ${awayFlag}
              <span class="team-text">${escHtml(awayTeam)}</span>
            </div>
          </div>
          ${actualScore}
        </div>
      </div>
    </div>`;
}

function attachInputListeners() {
  document.querySelectorAll('.score-input').forEach(inp => {
    inp.addEventListener('change', onInputChange);
  });
}

function onInputChange(e) {
  const matchId = e.target.dataset.match;
  const side    = e.target.dataset.side;
  const val     = e.target.value === '' ? null : parseInt(e.target.value, 10);
  if (!userPreds[matchId]) userPreds[matchId] = {};
  userPreds[matchId][side] = val;
  markUnsaved();
}

function markUnsaved() {
  document.getElementById('save-status').textContent = 'Unsaved changes…';
  document.getElementById('save-status').className = 'text-warning';
}

// ── Save ──────────────────────────────────────────────────
async function saveAll() {
  if (locked) return;
  const btn = document.getElementById('save-btn');
  btn.disabled = true; btn.textContent = '💾 Saving…';
  try {
    // Batch write: max 500 ops per batch; for 104 matches this is fine in two batches
    const BATCH_SIZE = 400;
    const entries = Object.entries(userPreds);
    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
      const batch = db.batch();
      for (const [matchId, pred] of entries.slice(i, i + BATCH_SIZE)) {
        if (pred.home === undefined && pred.away === undefined) continue;
        const ref = db.collection('predictions').doc(currentUser.uid)
          .collection('matches').doc(matchId);
        batch.set(ref, {
          home: pred.home !== null ? Number(pred.home) : null,
          away: pred.away !== null ? Number(pred.away) : null,
          savedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      }
      await batch.commit();
    }
    document.getElementById('save-status').textContent = 'All saved ✓';
    document.getElementById('save-status').className = 'text-success';
    showToast('Predictions saved!');
  } catch (ex) {
    showToast('Save failed: ' + ex.message, 'danger');
  } finally {
    btn.disabled = false; btn.textContent = '💾 Save All Predictions';
  }
  updateSummary();
}

// ── Summary bar ───────────────────────────────────────────
function updateSummary() {
  let totalPts = 0, finishedCount = 0, predictedFinished = 0;
  for (const m of allMatches) {
    if (!m.finished) continue;
    finishedCount++;
    const pred = userPreds[m.id];
    if (!pred) continue;
    const pts = calcPoints(pred.home, pred.away, m.actualHome, m.actualAway, true);
    if (pts !== null) { totalPts += pts; predictedFinished++; }
  }
  document.getElementById('summary-bar').innerHTML =
    `<span>🏆 Your total: <strong>${totalPts} pts</strong> from ${predictedFinished}/${finishedCount} played matches</span>
     <span class="badge bg-white text-success fs-6">${totalPts} pts</span>`;
}

// ── Stage toggle ──────────────────────────────────────────
function showStage(stage) {
  document.getElementById('group-panel').classList.toggle('d-none', stage !== 'group');
  document.getElementById('knockout-panel').classList.toggle('d-none', stage !== 'knockout');
  document.querySelectorAll('#stage-tabs .nav-link').forEach((btn, i) => {
    btn.classList.toggle('active', (i === 0 && stage === 'group') || (i === 1 && stage === 'knockout'));
  });
}

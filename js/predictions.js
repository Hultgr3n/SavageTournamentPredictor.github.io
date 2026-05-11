// ============================================================
//  predictions.js  –  Logic for predictions.html
// ============================================================

let currentUser = null;
let allMatches   = [];     // array of match objects from Firestore
let userPreds    = {};     // { matchId: { home, away } }
let locked       = false;
let settings     = {};     // settings including lock dates

const GROUP_ORDER    = ['A','B','C','D','E','F','G','H','I','J','K','L'];
const KNOCKOUT_ORDER = ['round32','round16','qf','sf','final'];
const KNOCKOUT_LABEL = {
  round32: 'Round of 32', round16: 'Round of 16',
  qf: 'Quarter-Finals', sf: 'Semi-Finals', final: 'Final'
};

const KNOCKOUT_TEMPLATE = {
  round32: [
    { date: 'June 29', city: 'Foxborough', home: 'Winner Group A', away: '3rd Group A/B/C/D/F' },
    { date: 'June 30', city: 'East Rutherford', home: 'Winner Group I', away: '3rd Group C/D/F/G/H' },
    { date: 'June 28', city: 'Inglewood', home: 'Runner-up Group A', away: 'Runner-up Group B' },
    { date: 'June 29', city: 'Guadalupe', home: 'Winner Group F', away: 'Runner-up Group C' },
    { date: 'July 2', city: 'Toronto', home: 'Runner-up Group K', away: 'Runner-up Group L' },
    { date: 'July 2', city: 'Inglewood', home: 'Winner Group H', away: 'Runner-up Group J' },
    { date: 'July 1', city: 'Santa Clara', home: 'Winner Group D', away: '3rd Group B/E/F/I/J' },
    { date: 'July 1', city: 'Seattle', home: 'Winner Group G', away: '3rd Group A/E/H/I/J' },
    { date: 'June 29', city: 'Houston', home: 'Winner Group C', away: 'Runner-up Group F' },
    { date: 'June 30', city: 'Arlington', home: 'Runner-up Group E', away: 'Runner-up Group I' },
    { date: 'June 30', city: 'Mexico City', home: 'Winner Group A', away: '3rd Group C/E/F/H/I' },
    { date: 'July 1', city: 'Atlanta', home: 'Winner Group L', away: '3rd Group E/H/I/J/K' },
    { date: 'July 3', city: 'Miami Gardens', home: 'Winner Group J', away: 'Runner-up Group H' },
    { date: 'July 3', city: 'Arlington', home: 'Runner-up Group D', away: 'Runner-up Group G' },
    { date: 'July 2', city: 'Vancouver', home: 'Winner Group B', away: '3rd Group E/F/G/I/J' },
    { date: 'July 3', city: 'Kansas City', home: 'Winner Group K', away: '3rd Group D/E/I/J/L' }
  ],
  round16: [
    { date: 'July 4', city: 'Philadelphia', home: 'Winner Match 74', away: 'Winner Match 77' },
    { date: 'July 4', city: 'Houston', home: 'Winner Match 73', away: 'Winner Match 75' },
    { date: 'July 6', city: 'Arlington', home: 'Winner Match 83', away: 'Winner Match 84' },
    { date: 'July 6', city: 'Seattle', home: 'Winner Match 81', away: 'Winner Match 82' },
    { date: 'July 5', city: 'East Rutherford', home: 'Winner Match 76', away: 'Winner Match 78' },
    { date: 'July 5', city: 'Mexico City', home: 'Winner Match 79', away: 'Winner Match 80' },
    { date: 'July 7', city: 'Atlanta', home: 'Winner Match 86', away: 'Winner Match 88' },
    { date: 'July 7', city: 'Vancouver', home: 'Winner Match 85', away: 'Winner Match 87' }
  ],
  qf: [
    { date: 'July 9', city: 'Foxborough', home: 'Winner Match 89', away: 'Winner Match 90' },
    { date: 'July 10', city: 'Inglewood', home: 'Winner Match 93', away: 'Winner Match 94' },
    { date: 'July 11', city: 'Miami Gardens', home: 'Winner Match 91', away: 'Winner Match 92' },
    { date: 'July 11', city: 'Kansas City', home: 'Winner Match 95', away: 'Winner Match 96' }
  ],
  sf: [
    { date: 'July 14', city: 'Arlington', home: 'Winner Match 97', away: 'Winner Match 98' },
    { date: 'July 15', city: 'Atlanta', home: 'Winner Match 99', away: 'Winner Match 100' }
  ],
  final: [
    { date: 'July 19', city: 'East Rutherford', home: 'Winner Match 101', away: 'Winner Match 102' }
  ],
  thirdPlace: { date: 'July 18', city: 'Miami Gardens', home: 'Loser Match 101', away: 'Loser Match 102' }
};

// ── Bootstrap ─────────────────────────────────────────────
(async () => {
  currentUser = await requireAuth();
  buildNav(currentUser.username, currentUser.isAdmin);

  settings = await loadSettings();
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
    html += renderGroupStandings(grp, matches);
    for (const m of matches) {
      html += matchCard(m, 'group');
    }
  }
  container.innerHTML = html;
  attachInputListeners();
}

function getGroupStandings(groupName) {
  const groupMatches = allMatches.filter(m => m.type === 'group' && m.group === groupName);
  const table = new Map();

  const ensureTeam = (name, flag) => {
    const key = name || 'TBD';
    if (!table.has(key)) {
      table.set(key, {
        team: key, flag: flag || '', p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0,
        h2h: {} // Head-to-head vs other teams
      });
    }
    return table.get(key);
  };

  for (const match of groupMatches) {
    const home = ensureTeam(match.homeTeam || 'TBD', match.homeFlag || '');
    const away = ensureTeam(match.awayTeam || 'TBD', match.awayFlag || '');

    if (!match.finished || match.actualHome === null || match.actualAway === null) continue;

    const homeGoals = Number(match.actualHome);
    const awayGoals = Number(match.actualAway);

    home.p++; away.p++;
    home.gf += homeGoals; home.ga += awayGoals;
    away.gf += awayGoals; away.ga += homeGoals;

    // Initialize h2h records if not present
    if (!home.h2h[away.team]) home.h2h[away.team] = { p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 };
    if (!away.h2h[home.team]) away.h2h[home.team] = { p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 };

    home.h2h[away.team].p++; away.h2h[home.team].p++;
    home.h2h[away.team].gf += homeGoals; home.h2h[away.team].ga += awayGoals;
    away.h2h[home.team].gf += awayGoals; away.h2h[home.team].ga += homeGoals;

    if (homeGoals > awayGoals) {
      home.w++; home.pts += 3;
      away.l++;
      home.h2h[away.team].w++; home.h2h[away.team].pts += 3;
      away.h2h[home.team].l++;
    } else if (homeGoals < awayGoals) {
      away.w++; away.pts += 3;
      home.l++;
      away.h2h[home.team].w++; away.h2h[home.team].pts += 3;
      home.h2h[away.team].l++;
    } else {
      home.d++; away.d++;
      home.pts++; away.pts++;
      home.h2h[away.team].d++; home.h2h[away.team].pts++;
      away.h2h[home.team].d++; away.h2h[home.team].pts++;
    }
  }

  const standings = Array.from(table.values()).map(t => ({ ...t, gd: t.gf - t.ga }));

  // Sort using FIFA tiebreaker rules
  standings.sort((a, b) => {
    // 1. Points
    if (a.pts !== b.pts) return b.pts - a.pts;

    // For teams tied on points, apply head-to-head tiebreakers
    const h2hA = a.h2h[b.team];
    const h2hB = b.h2h[a.team];

    if (h2hA && h2hB) {
      // 2a. Head-to-head points
      if (h2hA.pts !== h2hB.pts) return h2hB.pts - h2hA.pts;
      // 2b. Head-to-head goal difference
      const h2hGdA = h2hA.gf - h2hA.ga;
      const h2hGdB = h2hB.gf - h2hB.ga;
      if (h2hGdA !== h2hGdB) return h2hGdB - h2hGdA;
      // 2c. Head-to-head goals scored
      if (h2hA.gf !== h2hB.gf) return h2hB.gf - h2hA.gf;
    }

    // 3. Overall goal difference
    if (a.gd !== b.gd) return b.gd - a.gd;
    // 4. Overall goals scored
    if (a.gf !== b.gf) return b.gf - a.gf;
    // 5. Alphabetical (team name as tiebreaker if all else fails)
    return a.team.localeCompare(b.team);
  });

  return standings;
}

function renderKnockoutTemplateCard(slot, title = '') {
  const heading = title ? `<div class="small text-muted mb-1">${escHtml(title)}</div>` : '';
  return `
    <div class="border rounded bg-dark-subtle p-2 mb-2" style="min-width: 220px;">
      <div class="small mb-1">${escHtml(slot.date)} – <span class="text-primary">${escHtml(slot.city)}</span></div>
      ${heading}
      <div class="border rounded px-2 py-1 mb-1 bg-white">${escHtml(slot.home)}</div>
      <div class="border rounded px-2 py-1 bg-white">${escHtml(slot.away)}</div>
    </div>`;
}

function renderFullKnockoutTemplate() {
  let html = '<div class="col-12 mb-3">';
  html += '<h6 class="text-warning mb-2">⚽ Full Knockout Bracket (potential matchups)</h6>';
  html += '<div class="small text-muted mb-2">Shows all future paths before teams are confirmed. Placeholders follow official bracket slots.</div>';
  html += '<div style="overflow-x:auto;">';
  html += '<div class="d-flex gap-3 align-items-start" style="min-width:1200px;">';

  const columns = [
    { key: 'round32', label: 'Round of 32' },
    { key: 'round16', label: 'Round of 16' },
    { key: 'qf', label: 'Quarterfinals' },
    { key: 'sf', label: 'Semifinals' },
    { key: 'final', label: 'Final' }
  ];

  for (const col of columns) {
    html += `<div class="flex-grow-1" style="min-width:220px;">`;
    html += `<div class="text-center fw-semibold mb-2 border rounded py-1 bg-light">${escHtml(col.label)}</div>`;
    for (const slot of KNOCKOUT_TEMPLATE[col.key]) {
      html += renderKnockoutTemplateCard(slot);
    }
    if (col.key === 'final') {
      html += '<div class="text-center fw-semibold mb-2 mt-3 border rounded py-1 bg-light">Match for third place</div>';
      html += renderKnockoutTemplateCard(KNOCKOUT_TEMPLATE.thirdPlace);
    }
    html += '</div>';
  }

  html += '</div></div></div>';
  return html;
}

function renderKnockoutStage() {
  const container = document.getElementById('knockout-matches');
  const koMatches = allMatches.filter(m => m.type !== 'group');

  let html = renderFullKnockoutTemplate();

  if (koMatches.length === 0) {
    html += '<div class="col text-muted py-3">No official knockout fixtures in Firestore yet. Template above shows all possible future matches.</div>';
    container.innerHTML = html;
    return;
  }

  for (const stage of KNOCKOUT_ORDER) {
    const matches = koMatches.filter(m => m.type === stage);
    if (matches.length === 0) continue;
    html += `<div class="col-12"><h5 class="text-white bg-dark px-3 py-1 rounded">${KNOCKOUT_LABEL[stage] || stage}</h5></div>`;
    for (const m of matches) {
      html += matchCard(m, 'knockout');
    }
  }

  container.innerHTML = html;
  attachInputListeners();
}
function renderGroupStandings(groupName, matches) {
  const table = new Map();

  const ensureTeam = (name, flag) => {
    const key = name || 'TBD';
    if (!table.has(key)) {
      table.set(key, {
        team: key,
        flag: flag || '',
        p: 0,
        w: 0,
        d: 0,
        l: 0,
        gf: 0,
        ga: 0,
        gd: 0,
        pts: 0,
        h2h: {}
      });
    }
    return table.get(key);
  };

  for (const match of matches) {
    const home = ensureTeam(match.homeTeam || 'TBD', match.homeFlag || '');
    const away = ensureTeam(match.awayTeam || 'TBD', match.awayFlag || '');

    if (!match.finished || match.actualHome === null || match.actualAway === null || match.actualHome === undefined || match.actualAway === undefined) {
      continue;
    }

    const homeGoals = Number(match.actualHome);
    const awayGoals = Number(match.actualAway);

    home.p++; away.p++;
    home.gf += homeGoals; home.ga += awayGoals;
    away.gf += awayGoals; away.ga += homeGoals;

    if (homeGoals > awayGoals) {
      home.w++; home.pts += 3;
      away.l++;
    } else if (homeGoals < awayGoals) {
      away.w++; away.pts += 3;
      home.l++;
    } else {
      home.d++; away.d++;
      home.pts++; away.pts++;
    }
  }

  const standings = Array.from(table.values())
    .map(t => ({ ...t, gd: t.gf - t.ga }))
    .sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || a.team.localeCompare(b.team));

  const rows = standings.map((team, index) => {
    const flag = team.flag ? `<img src="${escHtml(team.flag)}" class="flag-icon me-1" alt=""/>` : '';
    return `<tr>
      <td class="text-muted">${index + 1}</td>
      <td>${flag}${escHtml(team.team)}</td>
      <td class="text-center">${team.p}</td>
      <td class="text-center">${team.w}</td>
      <td class="text-center">${team.d}</td>
      <td class="text-center">${team.l}</td>
      <td class="text-center">${team.gf}</td>
      <td class="text-center">${team.ga}</td>
      <td class="text-center">${team.gd}</td>
      <td class="text-center fw-bold">${team.pts}</td>
    </tr>`;
  }).join('');

  return `
    <div class="col-12 mb-2">
      <div class="card border-0 shadow-sm">
        <div class="card-body p-2 p-md-3">
          <div class="small text-muted mb-2">Standings (visual only, based on finished matches)</div>
          <div class="table-responsive">
            <table class="table table-sm table-striped align-middle mb-0">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Team</th>
                  <th class="text-center">P</th>
                  <th class="text-center">W</th>
                  <th class="text-center">D</th>
                  <th class="text-center">L</th>
                  <th class="text-center">GF</th>
                  <th class="text-center">GA</th>
                  <th class="text-center">GD</th>
                  <th class="text-center">Pts</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>
      </div>
    </div>`;
}

function matchCard(m, stage = null) {
  const pred = userPreds[m.id] || {};
  const predHome = pred.home !== undefined ? pred.home : '';
  const predAway = pred.away !== undefined ? pred.away : '';
  const pts = calcPoints(pred.home, pred.away, m.actualHome, m.actualAway, m.finished);
  const isFinished = !!m.finished;
  const stageLocked = stage ? isPredictionLocked(settings, stage) : locked;
  const inputDisabled = stageLocked || isFinished ? 'disabled' : '';

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

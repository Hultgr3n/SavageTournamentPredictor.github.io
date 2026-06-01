// ============================================================
//  knockout-demo.js - Winner-only knockout bracket QA page
// ============================================================

let currentUser = null;
let settings = {};
let allMatches = [];
let knockoutMatches = [];
let demoPreds = {};
let knockoutLocked = false;
let matchById = new Map();

const KNOCKOUT_ORDER = ['round32', 'round16', 'qf', 'sf', 'final'];
const STAGE_LABEL = {
  round32: 'Round of 32',
  round16: 'Round of 16',
  qf: 'Quarter-Finals',
  sf: 'Semi-Finals',
  final: 'Final'
};

(async () => {
  try {
    currentUser = await requireAuth();
    buildNav(currentUser.username, currentUser.isAdmin);

    if (!currentUser.isAdmin) {
      window.location.href = 'predictions.html';
      return;
    }

    settings = await loadSettings();
    knockoutLocked = isPredictionLocked(settings, 'knockout');
    if (knockoutLocked) {
      document.getElementById('lock-banner').classList.remove('d-none');
      document.getElementById('save-btn').disabled = true;
      document.getElementById('save-btn').textContent = 'Knockout Locked';
    }

    await loadDemoData();
    renderDemoBracket();
    updateDemoSummary();
  } catch (err) {
    console.error('Failed to load knockout demo:', err);
    const root = document.getElementById('knockout-demo-root');
    if (root) {
      root.innerHTML = '<div class="alert alert-danger">Failed to load knockout fixtures. Check Firestore access and data sync.</div>';
    }
    showToast(`Load failed: ${err.message || 'unknown error'}`, 'danger');
  }
})();

async function loadDemoData() {
  const snap = await db.collection('matches').orderBy('sortOrder').get().catch(() => db.collection('matches').get());
  allMatches = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  knockoutMatches = allMatches
    .filter((m) => m.type && m.type !== 'group')
    .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));

  matchById = new Map(knockoutMatches.map((m) => [String(m.id), m]));

  const predSnap = await db
    .collection('predictions')
    .doc(currentUser.uid)
    .collection('matches')
    .get();

  predSnap.forEach((d) => {
    const data = d.data() || {};
    if (typeof data.winnerDemo === 'string' && data.winnerDemo.trim()) {
      demoPreds[d.id] = {
        winner: data.winnerDemo.trim(),
        mode: 'winner-only'
      };
    }
  });
}

function renderDemoBracket() {
  const root = document.getElementById('knockout-demo-root');

  if (knockoutMatches.length === 0) {
    root.innerHTML = '<div class="alert alert-secondary">No knockout matches found in Firestore.</div>';
    return;
  }

  const byStage = {};
  for (const s of KNOCKOUT_ORDER) byStage[s] = [];
  for (const m of knockoutMatches) {
    if (byStage[m.type]) byStage[m.type].push(m);
  }

  let html = '';
  html += '<div class="ko-demo-wrap">';
  html += '<div class="ko-demo-grid">';

  for (const stage of KNOCKOUT_ORDER) {
    const stageMatches = (byStage[stage] || []).sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
    if (stageMatches.length === 0) continue;

    html += `<section class="ko-stage ko-stage-${escHtml(stage)}">`;
    html += `<header class="ko-stage-title">${escHtml(STAGE_LABEL[stage] || stage)}</header>`;
    html += '<div class="ko-stage-matches">';

    for (const match of stageMatches) {
      html += renderMatchNode(match);
    }

    html += '</div>';
    html += '</section>';
  }

  html += '</div>';
  html += '</div>';

  root.innerHTML = html;
  attachWinnerListeners();
}

function renderMatchNode(m) {
  const stageLocked = isPredictionLocked(settings, 'knockout');
  const isFinished = !!m.finished;
  const disabled = stageLocked || isFinished ? 'disabled' : '';

  const options = getWinnerOptionsForMatch(m);
  const predWinner = (demoPreds[m.id] || {}).winner || '';
  const actualWinner = getActualWinner(m);

  const optionHtml = ['<option value="">Select winner</option>']
    .concat(options.map((opt) => `<option value="${escHtml(opt.name)}" ${predWinner === opt.name ? 'selected' : ''}>${escHtml(opt.name)}</option>`))
    .join('');

  const hasActualWinner = !!actualWinner;
  const winnerBadge = hasActualWinner
    ? `<span class="badge ${predWinner && predWinner === actualWinner ? 'bg-success' : 'bg-dark'}">Actual winner: ${escHtml(actualWinner)}</span>`
    : '';

  const dateStr = formatDateToEuropean(m.date || '');
  const homeText = m.homeTeam || 'TBD';
  const awayText = m.awayTeam || 'TBD';

  return `
    <article class="ko-match ${isFinished ? 'ko-match-finished' : ''}">
      <div class="ko-meta">${escHtml(dateStr)} ${winnerBadge}</div>
      <div class="ko-team">${renderTeamLabel(homeText)}</div>
      <div class="ko-picker">
        <select class="form-select form-select-sm ko-winner-select"
          data-match="${escHtml(m.id)}" ${disabled}>${optionHtml}</select>
      </div>
      <div class="ko-team">${renderTeamLabel(awayText)}</div>
    </article>`;
}

function renderTeamLabel(name) {
  const teamName = String(name || 'TBD');
  const flagUrl = resolveFlagForTeamName(teamName);
  const flagImg = flagUrl
    ? `<img class="flag-icon me-2" src="${escHtml(flagUrl)}" alt="${escHtml(teamName)} flag" loading="lazy" referrerpolicy="no-referrer"/>`
    : '';
  return `${flagImg}<span>${escHtml(teamName)}</span>`;
}

function resolveFlagForTeamName(teamName) {
  for (const m of allMatches) {
    if (m.homeTeam === teamName && m.homeFlag) return m.homeFlag;
    if (m.awayTeam === teamName && m.awayFlag) return m.awayFlag;
  }
  return '';
}

function getWinnerOptionsForMatch(match) {
  const collected = new Map();

  const addTeam = (teamName) => {
    const clean = String(teamName || '').trim();
    if (!clean || clean.toLowerCase() === 'tbd') return;
    const existing = collected.get(clean);
    if (existing) return;
    collected.set(clean, { name: clean });
  };

  const maybeAddDirect = (name) => {
    if (isConcreteTeamName(name)) addTeam(name);
  };

  maybeAddDirect(match.homeTeam);
  maybeAddDirect(match.awayTeam);

  if (collected.size === 2) {
    return Array.from(collected.values());
  }

  for (const token of [match.homeTeam, match.awayTeam]) {
    const candidateTeams = resolvePossibleTeamsFromPlaceholder(token, new Set());
    candidateTeams.forEach(addTeam);
  }

  if (collected.size === 0) {
    maybeAddDirect(match.homeTeam);
    maybeAddDirect(match.awayTeam);
  }

  return Array.from(collected.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function isConcreteTeamName(name) {
  const text = String(name || '').trim();
  if (!text || /^tbd$/i.test(text)) return false;
  if (/winner\s+match/i.test(text)) return false;
  if (/loser\s+match/i.test(text)) return false;
  if(/winner\s+group/i.test(text)) return false;
  if(/runner-?up\s+group/i.test(text)) return false;
  if(/3rd\s+group/i.test(text)) return false;
  return true;
}

function resolvePossibleTeamsFromPlaceholder(rawToken, visitedMatchIds) {
  const token = String(rawToken || '').trim();
  if (!token) return [];

  if (isConcreteTeamName(token)) {
    return [token];
  }

  const groupLetters = parseGroupLetters(token);
  if (groupLetters.length > 0) {
    const teams = getTeamsFromGroups(groupLetters);
    if (teams.length > 0) return teams;
  }

  const matchRef = token.match(/match\s*(\d+)/i);
  if (matchRef) {
    const refId = String(matchRef[1]);
    if (visitedMatchIds.has(refId)) return [];
    visitedMatchIds.add(refId);

    const predicted = getPredictedWinnerByMatchId(refId);
    if (predicted) {
      const fromPrediction = [predicted];
      const refMatchForPrediction = matchById.get(refId);
      if (refMatchForPrediction) {
        const fallback = getWinnerOptionsForMatchRecursive(refMatchForPrediction, visitedMatchIds);
        for (const team of fallback) {
          if (team !== predicted) fromPrediction.push(team);
        }
      }
      return fromPrediction;
    }

    const refMatch = matchById.get(refId);
    if (!refMatch) return [];

    const options = getWinnerOptionsForMatchRecursive(refMatch, visitedMatchIds);
    return options;
  }

  return [];
}

function getPredictedWinnerByMatchId(matchId) {
  const winner = (demoPreds[matchId] || {}).winner;
  return typeof winner === 'string' && winner.trim() ? winner.trim() : '';
}

function getWinnerOptionsForMatchRecursive(match, visitedMatchIds) {
  const direct = [];
  const home = String(match.homeTeam || '').trim();
  const away = String(match.awayTeam || '').trim();

  if (isConcreteTeamName(home)) direct.push(home);
  if (isConcreteTeamName(away)) direct.push(away);

  if (direct.length === 2) return direct;

  const out = new Set(direct);
  for (const token of [home, away]) {
    const nested = resolvePossibleTeamsFromPlaceholder(token, visitedMatchIds);
    nested.forEach((t) => out.add(t));
  }

  return Array.from(out);
}

function parseGroupLetters(text) {
  const token = String(text || '');
  const groups = new Set();
  const groupMatches = token.match(/group\s+([a-l](?:\s*\/\s*[a-l])*)/gi) || [];

  for (const gm of groupMatches) {
    const letters = gm
      .replace(/group\s+/i, '')
      .split('/')
      .map((s) => s.trim().toUpperCase())
      .filter((s) => /^[A-L]$/.test(s));
    letters.forEach((l) => groups.add(l));
  }

  return Array.from(groups);
}

function getTeamsFromGroups(groupLetters) {
  const out = new Set();
  for (const g of groupLetters) {
    for (const m of allMatches) {
      if (m.type !== 'group') continue;
      if (String(m.group || '').toUpperCase() !== g) continue;
      if (isConcreteTeamName(m.homeTeam)) out.add(m.homeTeam);
      if (isConcreteTeamName(m.awayTeam)) out.add(m.awayTeam);
    }
  }
  return Array.from(out).sort((a, b) => a.localeCompare(b));
}

function getActualWinner(m) {
  if (!m || !m.finished) return '';

  const explicitWinner = String(
    m.winnerTeam || m.winner_team_name || m.winner || m.winnerName || ''
  ).trim();
  if (explicitWinner) return explicitWinner;

  const home = Number(m.actualHome);
  const away = Number(m.actualAway);
  if (Number.isFinite(home) && Number.isFinite(away)) {
    if (home > away) return String(m.homeTeam || '').trim();
    if (away > home) return String(m.awayTeam || '').trim();
  }

  return '';
}

function attachWinnerListeners() {
  document.querySelectorAll('.ko-winner-select').forEach((sel) => {
    sel.addEventListener('change', onWinnerChange);
  });
}

function onWinnerChange(e) {
  const matchId = e.target.dataset.match;
  const value = String(e.target.value || '').trim();
  if (!demoPreds[matchId]) demoPreds[matchId] = {};
  demoPreds[matchId].winner = value || null;
  demoPreds[matchId].mode = 'winner-only';
  markDemoUnsaved();
  renderDemoBracket();
  updateDemoSummary();
}

function markDemoUnsaved() {
  const node = document.getElementById('save-status');
  node.textContent = 'Unsaved changes...';
  node.className = 'text-warning';
}

function updateDemoSummary() {
  const total = knockoutMatches.length;
  const picked = knockoutMatches.filter((m) => {
    const pred = demoPreds[m.id] || {};
    return !!pred.winner;
  }).length;

  const finished = knockoutMatches.filter((m) => !!m.finished).length;
  let correct = 0;
  let totalPts = 0;

  for (const m of knockoutMatches) {
    if (!m.finished) continue;
    const actual = getActualWinner(m);
    const pred = (demoPreds[m.id] || {}).winner || '';
    if (actual && pred && actual === pred) {
      correct++;
      totalPts += m.type === 'final' ? 5 : 1;
    }
  }

  document.getElementById('summary-bar').innerHTML =
    `<span>Demo knockout picks: <strong>${picked}/${total}</strong> selected</span>` +
    `<span class="badge bg-white text-success fs-6">${totalPts} pts (${correct}/${finished} winners)</span>`;
}

async function saveAllDemoKnockout() {
  if (knockoutLocked) return;

  const missing = knockoutMatches.filter((m) => {
    const winner = (demoPreds[m.id] || {}).winner;
    return !winner;
  });
  if (missing.length > 0) {
    showToast(`Select winners for all knockout matches before saving (${missing.length} missing).`, 'warning');
    return;
  }

  const btn = document.getElementById('save-btn');
  btn.disabled = true;
  btn.textContent = 'Saving...';

  try {
    const entries = Object.entries(demoPreds);
    const BATCH_SIZE = 400;

    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
      const batch = db.batch();
      for (const [matchId, pred] of entries.slice(i, i + BATCH_SIZE)) {
        const ref = db
          .collection('predictions')
          .doc(currentUser.uid)
          .collection('matches')
          .doc(matchId);

        batch.set(
          ref,
          {
            winnerDemo: pred.winner || null,
            modeDemo: 'winner-only',
            savedAtDemo: firebase.firestore.FieldValue.serverTimestamp()
          },
          { merge: true }
        );
      }
      await batch.commit();
    }

    const status = document.getElementById('save-status');
    status.textContent = 'All saved';
    status.className = 'text-success';
    showToast('Demo knockout picks saved.');
  } catch (err) {
    showToast(`Save failed: ${err.message}`, 'danger');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save Demo Knockout Picks';
  }
}

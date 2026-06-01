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
let slotByMatchId = new Map();
let groupSnapshot = new Map();
let connectorResizeAttached = false;
let connectorResizeObserver = null;
let relayoutRafId = 0;

const KNOCKOUT_ORDER = ['round32', 'round16', 'qf', 'sf', 'final'];
const STAGE_LABEL = {
  round32: 'Round of 32',
  round16: 'Round of 16',
  qf: 'Quarter-Finals',
  sf: 'Semi-Finals',
  final: 'Final'
};

const SLOT_BY_MATCH_ID = {
  73: { home: '2A', away: '2B' },
  74: { home: '1E', away: '3A/B/C/D/F' },
  75: { home: '1F', away: '2C' },
  76: { home: '1C', away: '2F' },
  77: { home: '1I', away: '3C/D/F/G/H' },
  78: { home: '2E', away: '2I' },
  79: { home: '1A', away: '3C/E/F/H/I' },
  80: { home: '1L', away: '3E/H/I/J/K' },
  81: { home: '1D', away: '3B/E/F/I/J' },
  82: { home: '1G', away: '3A/E/H/I/J' },
  83: { home: '2K', away: '2L' },
  84: { home: '1H', away: '2J' },
  85: { home: '1B', away: '3E/F/G/I/J' },
  86: { home: '1J', away: '2H' },
  87: { home: '1K', away: '3D/E/I/J/L' },
  88: { home: '2D', away: '2G' },
  89: { home: 'W74', away: 'W77' },
  90: { home: 'W73', away: 'W75' },
  91: { home: 'W76', away: 'W78' },
  92: { home: 'W79', away: 'W80' },
  93: { home: 'W83', away: 'W84' },
  94: { home: 'W81', away: 'W82' },
  95: { home: 'W86', away: 'W88' },
  96: { home: 'W85', away: 'W87' },
  97: { home: 'W89', away: 'W90' },
  98: { home: 'W93', away: 'W94' },
  99: { home: 'W91', away: 'W92' },
  100: { home: 'W95', away: 'W96' },
  101: { home: 'W97', away: 'W98' },
  102: { home: 'W99', away: 'W100' },
  103: { home: 'L101', away: 'L102' },
  104: { home: 'W101', away: 'W102' }
};

const BRACKET_MATCH_IDS = {
  left: {
    round32: [74, 77, 73, 75, 83, 84, 81, 82],
    round16: [89, 90, 93, 94],
    qf: [97, 98],
    sf: [101]
  },
  right: {
    round32: [79, 80, 76, 78, 85, 87, 86, 88],
    round16: [91, 92, 95, 96],
    qf: [99, 100],
    sf: [102]
  },
  center: {
    final: [104],
    third: [103]
  }
};

const SLOT_TEMPLATE = {
  round32: [
    { home: '2A', away: '2B' },
    { home: '1E', away: '3A/B/C/D/F' },
    { home: '1F', away: '2C' },
    { home: '1C', away: '2F' },
    { home: '1I', away: '3C/D/F/G/H' },
    { home: '2E', away: '2I' },
    { home: '1A', away: '3C/E/F/H/I' },
    { home: '1L', away: '3E/H/I/J/K' },
    { home: '1D', away: '3B/E/F/I/J' },
    { home: '1G', away: '3A/E/H/I/J' },
    { home: '2K', away: '2L' },
    { home: '1H', away: '2J' },
    { home: '1B', away: '3E/F/G/I/J' },
    { home: '1J', away: '2H' },
    { home: '1K', away: '3D/E/I/J/L' }
    ,{ home: '2D', away: '2G' }
  ],
  round16: [
    { home: 'W74', away: 'W77' },
    { home: 'W73', away: 'W75' },
    { home: 'W83', away: 'W84' },
    { home: 'W81', away: 'W82' },
    { home: 'W76', away: 'W78' },
    { home: 'W79', away: 'W80' },
    { home: 'W86', away: 'W88' },
    { home: 'W85', away: 'W87' }
  ],
  qf: [
    { home: 'W89', away: 'W90' },
    { home: 'W93', away: 'W94' },
    { home: 'W91', away: 'W92' },
    { home: 'W95', away: 'W96' }
  ],
  sf: [
    { home: 'W97', away: 'W98' },
    { home: 'W99', away: 'W100' }
  ],
  final: [
    { home: 'W101', away: 'W102' }
  ],
  third: [
    { home: 'L101', away: 'L102' }
  ]
};

const ALL_EXPECTED_KNOCKOUT_IDS = Array.from({ length: 32 }, (_, i) => String(73 + i));

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
  buildSlotMap();
  groupSnapshot = buildGroupSnapshot();

  const predSnap = await db
    .collection('predictions')
    .doc(currentUser.uid)
    .collection('matches')
    .get();

  predSnap.forEach((d) => {
    const data = d.data() || {};
    if (typeof data.winnerSideDemo === 'string' && (data.winnerSideDemo === 'home' || data.winnerSideDemo === 'away')) {
      demoPreds[d.id] = {
        winnerSide: data.winnerSideDemo,
        mode: 'winner-only'
      };
      return;
    }
    if (typeof data.winnerDemo === 'string' && data.winnerDemo.trim()) {
      const inferredSide = inferWinnerSideFromLegacyValue(String(d.id), data.winnerDemo.trim());
      demoPreds[d.id] = {
        winnerSide: inferredSide,
        mode: 'winner-only'
      };
    }
  });
}

function buildSlotMap() {
  slotByMatchId = new Map();
  for (const [id, slot] of Object.entries(SLOT_BY_MATCH_ID)) {
    slotByMatchId.set(String(id), slot);
  }
}

function inferWinnerSideFromLegacyValue(matchId, winnerValue) {
  const match = matchById.get(String(matchId));
  if (!match) return '';
  const home = getSideDescriptor(match, 'home', new Set());
  const away = getSideDescriptor(match, 'away', new Set());
  const value = String(winnerValue || '').trim();
  if (!value) return '';
  if (value === home.rawLabel || value === home.optionLabel) return 'home';
  if (value === away.rawLabel || value === away.optionLabel) return 'away';
  return '';
}

function renderDemoBracket() {
  const root = document.getElementById('knockout-demo-root');

  if (knockoutMatches.length === 0) {
    root.innerHTML = '<div class="alert alert-secondary">No knockout matches found in Firestore.</div>';
    return;
  }

  const left = buildSideFromIds(BRACKET_MATCH_IDS.left);
  const right = buildSideFromIds(BRACKET_MATCH_IDS.right);
  const finalMatches = BRACKET_MATCH_IDS.center.final.map((id) => matchById.get(String(id))).filter(Boolean);
  const thirdPlace = BRACKET_MATCH_IDS.center.third.map((id) => matchById.get(String(id))).filter(Boolean);
  const missing = getMissingExpectedKnockoutIds();

  let html = '';
  if (missing.length > 0) {
    html += `<div class="alert alert-warning mb-3">Missing knockout match IDs in Firestore: ${escHtml(missing.join(', '))}</div>`;
  }
  html += '<div class="ko-demo-wrap ko-demo-wrap-mirror">';
  html += '<svg class="ko-connector-svg" aria-hidden="true"></svg>';
  html += '<div class="ko-bracket-layer">';
  html += '<div class="ko-side ko-side-left">';
  html += renderSideStages(left, 'left');
  html += '</div>';
  html += '<div class="ko-center">';
  if (finalMatches.length > 0) {
    html += '<section class="ko-stage ko-stage-final-center" data-center-stage="final">';
    html += '<header class="ko-stage-title">Final</header>';
    html += finalMatches.map((m, i) => renderMatchNode(m, { stage: 'final', side: 'center', index: i })).join('');
    html += '</section>';
  }
  if (thirdPlace.length > 0) {
    html += '<section class="ko-stage ko-stage-third-center" data-center-stage="third">';
    html += '<header class="ko-stage-title">Bronze Match</header>';
    html += thirdPlace.map((m, i) => renderMatchNode(m, { stage: 'third', side: 'center', index: i })).join('');
    html += '</section>';
  }
  html += '</div>';
  html += '<div class="ko-side ko-side-right">';
  html += renderSideStages(right, 'right');
  html += '</div>';
  html += '</div>';
  html += '</div>';

  root.innerHTML = html;
  attachWinnerListeners();
  alignBracketColumns();
  drawBracketConnectors();
  attachConnectorResizeHandler();
  scheduleBracketRelayout();
}

function buildSideFromIds(stageIds) {
  return {
    round32: stageIds.round32.map((id) => matchById.get(String(id))).filter(Boolean),
    round16: stageIds.round16.map((id) => matchById.get(String(id))).filter(Boolean),
    qf: stageIds.qf.map((id) => matchById.get(String(id))).filter(Boolean),
    sf: stageIds.sf.map((id) => matchById.get(String(id))).filter(Boolean)
  };
}

function getMissingExpectedKnockoutIds() {
  const present = new Set(knockoutMatches.map((m) => String(m.id)));
  return ALL_EXPECTED_KNOCKOUT_IDS.filter((id) => !present.has(id));
}

function renderSideStages(sideMap, sideName) {
  const stageOrder = sideName === 'right'
    ? ['sf', 'qf', 'round16', 'round32']
    : ['round32', 'round16', 'qf', 'sf'];
  let html = '<div class="ko-side-grid">';
  for (const stage of stageOrder) {
    const matches = sideMap[stage] || [];
    if (matches.length === 0) continue;
    html += `<section class="ko-stage ko-stage-${escHtml(stage)} ko-stage-${escHtml(sideName)}" data-stage-group="${escHtml(stage)}" data-stage-side="${escHtml(sideName)}">`;
    html += `<header class="ko-stage-title">${escHtml(STAGE_LABEL[stage])}</header>`;
    html += '<div class="ko-stage-matches">';
    html += matches.map((m, i) => renderMatchNode(m, { stage, side: sideName, index: i })).join('');
    html += '</div></section>';
  }
  html += '</div>';
  return html;
}

function buildEmptyBracketSide() {
  return { round32: [], round16: [], qf: [], sf: [] };
}

function getReferencedWinnerMatchIds(matchId) {
  const slot = slotByMatchId.get(String(matchId));
  if (!slot) return [];
  const refs = [];
  for (const token of [slot.home, slot.away]) {
    const t = normalizeSlotToken(token);
    const m = t.match(/^W(\d+)$/i);
    if (m) refs.push(String(m[1]));
  }
  return refs;
}

function collectBranchMatches(rootMatchId, sideBucket, seen = new Set()) {
  const id = String(rootMatchId || '');
  if (!id || seen.has(id)) return;
  seen.add(id);

  const childRefs = getReferencedWinnerMatchIds(id);
  if (childRefs.length > 0) {
    collectBranchMatches(childRefs[0], sideBucket, seen);
    collectBranchMatches(childRefs[1], sideBucket, seen);
  }

  const m = matchById.get(id);
  if (!m) return;
  if (m.type === 'round32' || m.type === 'round16' || m.type === 'qf' || m.type === 'sf') {
    const list = sideBucket[m.type];
    if (list && !list.some((x) => String(x.id) === id)) {
      list.push(m);
    }
  }
}

function buildBracketBranches() {
  const left = buildEmptyBracketSide();
  const right = buildEmptyBracketSide();

  const sfMatches = knockoutMatches
    .filter((m) => m.type === 'sf')
    .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));

  if (sfMatches.length >= 2) {
    collectBranchMatches(String(sfMatches[0].id), left);
    collectBranchMatches(String(sfMatches[1].id), right);
  } else {
    // Fallback if fixture data is incomplete.
    left.round32 = knockoutMatches.filter((m) => m.type === 'round32').slice(0, 8);
    left.round16 = knockoutMatches.filter((m) => m.type === 'round16').slice(0, 4);
    left.qf = knockoutMatches.filter((m) => m.type === 'qf').slice(0, 2);
    left.sf = knockoutMatches.filter((m) => m.type === 'sf').slice(0, 1);

    right.round32 = knockoutMatches.filter((m) => m.type === 'round32').slice(8);
    right.round16 = knockoutMatches.filter((m) => m.type === 'round16').slice(4);
    right.qf = knockoutMatches.filter((m) => m.type === 'qf').slice(2);
    right.sf = knockoutMatches.filter((m) => m.type === 'sf').slice(1);
  }

  return { left, right };
}

function renderMatchNode(m, meta = {}) {
  const stageLocked = isPredictionLocked(settings, 'knockout');
  const isFinished = !!m.finished;
  const disabled = stageLocked || isFinished ? 'disabled' : '';

  const options = getWinnerOptionsForMatch(m);
  const predWinnerSide = (demoPreds[m.id] || {}).winnerSide || '';
  const actualWinnerSide = getActualWinnerSide(m);
  const actualWinnerName = getActualWinnerName(m);

  const optionHtml = ['<option value="">Select winner</option>']
    .concat(options.map((opt) => `<option value="${escHtml(opt.side)}" ${predWinnerSide === opt.side ? 'selected' : ''}>${escHtml(opt.label)}</option>`))
    .join('');

  const hasActualWinner = !!actualWinnerName;
  const winnerBadge = hasActualWinner
    ? `<span class="badge ${predWinnerSide && predWinnerSide === actualWinnerSide ? 'bg-success' : 'bg-dark'}">Actual winner: ${escHtml(actualWinnerName)}</span>`
    : '';

  const dateStr = formatDateToEuropean(m.date || '');
  const homeDesc = getSideDescriptor(m, 'home');
  const awayDesc = getSideDescriptor(m, 'away');
  const dataStage = escHtml(String(meta.stage || m.type || 'unknown'));
  const dataSide = escHtml(String(meta.side || 'unknown'));
  const dataIndex = Number.isFinite(Number(meta.index)) ? Number(meta.index) : 0;

  return `
    <article class="ko-match ${isFinished ? 'ko-match-finished' : ''}"
      data-stage="${dataStage}" data-side="${dataSide}" data-index="${dataIndex}" data-match-id="${escHtml(String(m.id))}">
      <div class="ko-meta">${escHtml(dateStr)} ${winnerBadge}</div>
      <div class="ko-team">${renderTeamLabel(homeDesc.rawLabel, homeDesc.flagUrl)}</div>
      <div class="ko-picker">
        <select class="form-select form-select-sm ko-winner-select"
          data-match="${escHtml(m.id)}" ${disabled}>${optionHtml}</select>
      </div>
      <div class="ko-team">${renderTeamLabel(awayDesc.rawLabel, awayDesc.flagUrl)}</div>
    </article>`;
}

function renderTeamLabel(name, explicitFlagUrl = '') {
  const teamName = String(name || 'TBD');
  const flagUrl = explicitFlagUrl || resolveFlagForTeamName(teamName);
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
  const home = getSideDescriptor(match, 'home', new Set());
  const away = getSideDescriptor(match, 'away', new Set());
  return [
    { side: 'home', label: home.optionLabel },
    { side: 'away', label: away.optionLabel }
  ];
}

function getSideDescriptor(match, side, visitedMatchIds = new Set()) {
  const isHome = side === 'home';
  const teamName = String(isHome ? (match.homeTeam || '') : (match.awayTeam || '')).trim();
  const teamFlag = String(isHome ? (match.homeFlag || '') : (match.awayFlag || '')).trim();

  if (isConcreteTeamName(teamName)) {
    return {
      rawLabel: teamName,
      optionLabel: teamName,
      flagUrl: teamFlag || resolveFlagForTeamName(teamName)
    };
  }

  const slot = slotByMatchId.get(String(match.id));
  const tokenFromSlot = slot ? String(isHome ? slot.home : slot.away) : '';
  const tokenFromData = normalizeSlotToken(teamName);
  const token = tokenFromSlot || tokenFromData || (isHome ? 'HOME' : 'AWAY');

  const options = resolvePossibleTeamsFromPlaceholder(token, visitedMatchIds).filter(Boolean);
  const resolved = options.length === 1 && isConcreteTeamName(options[0]) ? options[0] : '';
  const displayToken = normalizeSlotToken(token);
  let optionLabel = displayToken;
  if (options.length > 0) {
    optionLabel = options.length <= 4
      ? options.join(' / ')
      : `${options.slice(0, 4).join(' / ')} / ...`;
  }

  return {
    rawLabel: resolved || displayToken,
    optionLabel,
    flagUrl: resolved ? resolveFlagForTeamName(resolved) : ''
  };
}

function isConcreteTeamName(name) {
  const text = String(name || '').trim();
  if (!text || /^tbd$/i.test(text)) return false;
  if (/^team$/i.test(text)) return false;
  if (/winner\s+match/i.test(text)) return false;
  if (/loser\s+match/i.test(text)) return false;
  if(/winner\s+group/i.test(text)) return false;
  if(/runner-?up\s+group/i.test(text)) return false;
  if(/3rd\s+group/i.test(text)) return false;
  if (/^[WwLl]\d+$/.test(text)) return false;
  if (/^[123][A-L](?:\/[A-L])*$/.test(text)) return false;
  return true;
}

function resolvePossibleTeamsFromPlaceholder(rawToken, visitedMatchIds) {
  const token = normalizeSlotToken(String(rawToken || '').trim());
  if (!token) return [];

  if (isConcreteTeamName(token)) {
    return [token];
  }

  if (/^[123][A-L](?:\/[A-L])*$/.test(token)) {
    return resolveRankedGroupToken(token);
  }

  const groupLetters = parseGroupLetters(token);
  if (groupLetters.length > 0) {
    const teams = getTeamsFromGroups(groupLetters);
    if (teams.length > 0) return teams;
  }

  const matchRef = token.match(/(?:^W|^L|match\s*)(\d+)/i);
  if (matchRef) {
    const refId = String(matchRef[1]);
    if (visitedMatchIds.has(refId)) return [];
    visitedMatchIds.add(refId);

    const predictedSide = getPredictedWinnerSideByMatchId(refId);
    if (predictedSide) {
      const refMatchForPrediction = matchById.get(refId);
      const picked = refMatchForPrediction ? getSideDescriptor(refMatchForPrediction, predictedSide, visitedMatchIds).rawLabel : '';
      const fromPrediction = picked ? [picked] : [];
      if (refMatchForPrediction) {
        const fallback = getWinnerOptionsForMatchRecursive(refMatchForPrediction, visitedMatchIds);
        for (const team of fallback) {
          if (!fromPrediction.includes(team)) fromPrediction.push(team);
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

function getPredictedWinnerSideByMatchId(matchId) {
  const value = (demoPreds[matchId] || {}).winnerSide;
  return value === 'home' || value === 'away' ? value : '';
}

function getWinnerOptionsForMatchRecursive(match, visitedMatchIds) {
  const home = getSideDescriptor(match, 'home', visitedMatchIds).rawLabel;
  const away = getSideDescriptor(match, 'away', visitedMatchIds).rawLabel;
  const out = new Set();
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

function resolveRankedGroupToken(token) {
  const clean = normalizeSlotToken(token);
  const rank = Number(clean[0]);
  const tail = clean.slice(1);
  const letters = tail.split('/').map((v) => v.trim()).filter((v) => /^[A-L]$/.test(v));
  const out = [];
  for (const letter of letters) {
    const resolved = resolveGroupRankToTeam(rank, letter);
    out.push(resolved || `${rank}${letter}`);
  }
  return out;
}

function resolveGroupRankToTeam(rank, letter) {
  const group = groupSnapshot.get(String(letter || '').toUpperCase());
  if (!group || !group.complete) return '';
  const idx = Number(rank) - 1;
  const row = group.standings[idx];
  if (!row || !row.team || !isConcreteTeamName(row.team)) return '';
  return row.team;
}

function buildGroupSnapshot() {
  const snapshot = new Map();
  const groups = new Set();
  for (const m of allMatches) {
    if (m.type === 'group' && m.group) groups.add(String(m.group).toUpperCase());
  }

  for (const letter of groups) {
    const matches = allMatches.filter((m) => m.type === 'group' && String(m.group || '').toUpperCase() === letter);
    const table = new Map();

    const ensure = (name, flag) => {
      const key = String(name || 'TBD').trim();
      if (!table.has(key)) {
        table.set(key, { team: key, flag: flag || '', p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0 });
      }
      return table.get(key);
    };

    for (const m of matches) {
      const home = ensure(m.homeTeam, m.homeFlag);
      const away = ensure(m.awayTeam, m.awayFlag);
      if (!m.finished || m.actualHome === null || m.actualAway === null || m.actualHome === undefined || m.actualAway === undefined) {
        continue;
      }

      const hg = Number(m.actualHome);
      const ag = Number(m.actualAway);
      if (!Number.isFinite(hg) || !Number.isFinite(ag)) continue;

      home.p += 1;
      away.p += 1;
      home.gf += hg;
      home.ga += ag;
      away.gf += ag;
      away.ga += hg;

      if (hg > ag) {
        home.w += 1;
        away.l += 1;
        home.pts += 3;
      } else if (ag > hg) {
        away.w += 1;
        home.l += 1;
        away.pts += 3;
      } else {
        home.d += 1;
        away.d += 1;
        home.pts += 1;
        away.pts += 1;
      }
    }

    const standings = Array.from(table.values())
      .map((r) => ({ ...r, gd: r.gf - r.ga }))
      .sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || a.team.localeCompare(b.team));

    const complete = matches.length > 0 && matches.every((m) => !!m.finished);
    snapshot.set(letter, { complete, standings });
  }

  return snapshot;
}

function normalizeSlotToken(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';

  let out = raw;
  out = out.replace(/Runner-?up\s+Group\s+([A-L])/ig, '2$1');
  out = out.replace(/Winner\s+Group\s+([A-L])/ig, '1$1');
  out = out.replace(/3rd\s+Group\s+([A-L](?:\/[A-L])*)/ig, '3$1');
  out = out.replace(/Winner\s+Match\s*(\d+)/ig, 'W$1');
  out = out.replace(/Loser\s+Match\s*(\d+)/ig, 'L$1');
  out = out.replace(/\s+/g, '');
  return out.toUpperCase();
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

function getActualWinnerName(m) {
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

function getActualWinnerSide(m) {
  if (!m || !m.finished) return '';

  const winnerName = getActualWinnerName(m);
  if (winnerName) {
    if (winnerName === String(m.homeTeam || '').trim()) return 'home';
    if (winnerName === String(m.awayTeam || '').trim()) return 'away';
  }

  const home = Number(m.actualHome);
  const away = Number(m.actualAway);
  if (Number.isFinite(home) && Number.isFinite(away)) {
    if (home > away) return 'home';
    if (away > home) return 'away';
  }
  return '';
}

function isThirdPlaceMatch(m) {
  const type = String(m.type || '').toLowerCase();
  if (type.includes('third') || type.includes('bronze')) return true;
  if (String(m.id || '') === '103') return true;
  const home = String(m.homeTeam || '').toLowerCase();
  const away = String(m.awayTeam || '').toLowerCase();
  return home.includes('loser match') || away.includes('loser match') ||
    home.includes('runner-up match') || away.includes('runner-up match') ||
    home.includes('runner up match') || away.includes('runner up match');
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
  demoPreds[matchId].winnerSide = (value === 'home' || value === 'away') ? value : null;
  demoPreds[matchId].mode = 'winner-only';
  markDemoUnsaved();
  renderDemoBracket();
  updateDemoSummary();
}

function attachConnectorResizeHandler() {
  if (connectorResizeAttached) return;
  connectorResizeAttached = true;
  window.addEventListener('resize', scheduleBracketRelayout);

  const root = document.getElementById('knockout-demo-root');
  const wrap = root ? root.querySelector('.ko-demo-wrap-mirror') : null;
  if (!wrap) return;

  if (connectorResizeObserver) {
    connectorResizeObserver.disconnect();
  }
  connectorResizeObserver = new ResizeObserver(() => {
    scheduleBracketRelayout();
  });
  connectorResizeObserver.observe(wrap);
}

function scheduleBracketRelayout() {
  if (relayoutRafId) cancelAnimationFrame(relayoutRafId);
  relayoutRafId = requestAnimationFrame(() => {
    relayoutRafId = 0;
    alignBracketColumns();
    drawBracketConnectors();
  });
}

function setStageTranslateY(section, y) {
  if (!section) return;
  section.style.transform = `translateY(${Math.round(y)}px)`;
}

function setMatchTranslateY(node, y) {
  if (!node) return;
  node.style.transform = `translateY(${Math.round(y)}px)`;
}

function getNodeCenterY(node, wrapRect) {
  const r = node.getBoundingClientRect();
  return r.top - wrapRect.top + (r.height / 2);
}

function alignBracketColumns() {
  const root = document.getElementById('knockout-demo-root');
  const wrap = root ? root.querySelector('.ko-demo-wrap-mirror') : null;
  if (!wrap) return;

  // Reset match-level transforms before recalculating.
  wrap.querySelectorAll('.ko-match').forEach((el) => {
    el.style.transform = 'translateY(0px)';
    el.dataset.translateY = '0';
  });

  // Keep center containers static; only cards are translated deterministically.
  wrap.querySelectorAll('[data-center-stage]').forEach((el) => {
    el.style.transform = 'translateY(0px)';
    el.dataset.translateY = '0';
  });

  const wrapRect = wrap.getBoundingClientRect();
  alignSideStages('left', wrapRect);
  alignSideStages('right', wrapRect);
  alignCenterStages(wrapRect);
}

function alignSideStages(side, wrapRect) {
  const transitions = [
    ['round32', 'round16'],
    ['round16', 'qf'],
    ['qf', 'sf']
  ];

  for (const [fromStage, toStage] of transitions) {
    const fromNodes = getStageNodes(fromStage, side);
    const toNodes = getStageNodes(toStage, side);
    if (fromNodes.length < 2 || toNodes.length === 0) continue;

    for (let i = 0; i < toNodes.length; i++) {
      const a = fromNodes[i * 2];
      const b = fromNodes[i * 2 + 1];
      const node = toNodes[i];
      if (!a || !b || !node) continue;

      const targetY = (getNodeCenterY(a, wrapRect) + getNodeCenterY(b, wrapRect)) / 2;
      const currentY = getNodeCenterY(node, wrapRect);
      let delta = targetY - currentY;

      // Nudge only the top-right branch inward rounds so the right side mirrors left.
      if (side === 'right') {
        const h = node.getBoundingClientRect().height || 120;
        if (toStage === 'qf' && i === 0) delta += Math.round(h * 0.35);
        if (toStage === 'sf' && i === 0) delta += Math.round(h * 0.7);
      }

      node.dataset.translateY = String(delta);
      setMatchTranslateY(node, delta);
    }
  }
}

function alignCenterStages(wrapRect) {
  const leftSf = getStageNodes('sf', 'left')[0] || null;
  const rightSf = getStageNodes('sf', 'right')[0] || null;
  const finalSection = document.querySelector('[data-center-stage="final"]');
  const bronzeSection = document.querySelector('[data-center-stage="third"]');
  const finalNode = getStageNodes('final', 'center')[0] || null;
  const bronzeNode = getStageNodes('third', 'center')[0] || null;

  if (finalSection && finalNode && leftSf && rightSf) {
    const target = (getNodeCenterY(leftSf, wrapRect) + getNodeCenterY(rightSf, wrapRect)) / 2;
    const current = getNodeCenterY(finalNode, wrapRect);
    const delta = target - current;
    finalSection.dataset.translateY = String(delta);
    setStageTranslateY(finalSection, delta);
  }

  if (bronzeSection && bronzeNode && finalNode) {
    const finalRect = finalSection ? finalSection.getBoundingClientRect() : finalNode.getBoundingClientRect();
    const bronzeRect = bronzeNode.getBoundingClientRect();
    const targetTop = finalRect.bottom - wrapRect.top + 28;
    const currentTop = bronzeRect.top - wrapRect.top;
    const delta = targetTop - currentTop;
    bronzeSection.dataset.translateY = String(delta);
    setStageTranslateY(bronzeSection, delta);
  }
}

function drawBracketConnectors() {
  const root = document.getElementById('knockout-demo-root');
  const wrap = root ? root.querySelector('.ko-demo-wrap-mirror') : null;
  const svg = wrap ? wrap.querySelector('.ko-connector-svg') : null;
  if (!wrap || !svg) return;

  while (svg.firstChild) svg.removeChild(svg.firstChild);

  const rect = wrap.getBoundingClientRect();
  svg.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);
  svg.setAttribute('width', String(rect.width));
  svg.setAttribute('height', String(rect.height));

  drawRoundConnections(svg, rect, 'left', 'round32', 'round16');
  drawRoundConnections(svg, rect, 'left', 'round16', 'qf');
  drawRoundConnections(svg, rect, 'left', 'qf', 'sf');
  drawRoundConnections(svg, rect, 'right', 'round32', 'round16');
  drawRoundConnections(svg, rect, 'right', 'round16', 'qf');
  drawRoundConnections(svg, rect, 'right', 'qf', 'sf');

  const leftSf = getStageNodes('sf', 'left')[0] || null;
  const rightSf = getStageNodes('sf', 'right')[0] || null;
  const finalNode = getStageNodes('final', 'center')[0] || null;
  const bronzeNode = getStageNodes('third', 'center')[0] || null;

  if (leftSf && finalNode) drawCenterLink(svg, rect, leftSf, finalNode, 'left', 'main');
  if (rightSf && finalNode) drawCenterLink(svg, rect, rightSf, finalNode, 'right', 'main');
  if (leftSf && bronzeNode) drawCenterLink(svg, rect, leftSf, bronzeNode, 'left', 'bronze');
  if (rightSf && bronzeNode) drawCenterLink(svg, rect, rightSf, bronzeNode, 'right', 'bronze');
}

function getStageNodes(stage, side) {
  const root = document.getElementById('knockout-demo-root');
  if (!root) return [];
  return Array.from(root.querySelectorAll(`.ko-match[data-stage="${stage}"][data-side="${side}"]`))
    .sort((a, b) => Number(a.dataset.index || 0) - Number(b.dataset.index || 0));
}

function drawRoundConnections(svg, wrapRect, side, fromStage, toStage) {
  const from = getStageNodes(fromStage, side);
  const to = getStageNodes(toStage, side);
  if (from.length === 0 || to.length === 0) return;

  for (let i = 0; i < to.length; i++) {
    const a = from[i * 2];
    const b = from[i * 2 + 1];
    const t = to[i];
    if (!a || !b || !t) continue;
    drawPairPath(svg, wrapRect, side, a, b, t, 'main');
  }
}

function drawPairPath(svg, wrapRect, side, nodeA, nodeB, targetNode, type) {
  const pa = getEdgePoint(nodeA, wrapRect, side === 'left' ? 'right' : 'left');
  const pb = getEdgePoint(nodeB, wrapRect, side === 'left' ? 'right' : 'left');
  const pt = getEdgePoint(targetNode, wrapRect, side === 'left' ? 'left' : 'right');

  const fromX = pa.x;
  const toX = pt.x;
  const delta = Math.abs(toX - fromX);
  const span = Math.max(24, Math.min(56, delta * 0.45));
  const jointX = side === 'left' ? fromX + span : fromX - span;
  const yTop = Math.min(pa.y, pb.y);
  const yBottom = Math.max(pa.y, pb.y);
  const yMid = (pa.y + pb.y) / 2;

  const d = [
    `M ${pa.x} ${pa.y} H ${jointX}`,
    `M ${pb.x} ${pb.y} H ${jointX}`,
    `M ${jointX} ${yTop} V ${yBottom}`,
    `M ${jointX} ${yMid} H ${pt.x}`,
    `M ${pt.x} ${yMid} V ${pt.y}`
  ].join(' ');

  appendPath(svg, d, type);
}

function drawCenterLink(svg, wrapRect, sideNode, centerNode, side, type) {
  const from = getEdgePoint(sideNode, wrapRect, side === 'left' ? 'right' : 'left');
  const to = getEdgePoint(centerNode, wrapRect, side === 'left' ? 'left' : 'right');
  const delta = Math.abs(to.x - from.x);
  const span = Math.max(24, Math.min(60, delta * 0.5));
  const bendX = side === 'left' ? from.x + span : from.x - span;
  const midY = (from.y + to.y) / 2;

  const d = [
    `M ${from.x} ${from.y} H ${bendX}`,
    `M ${bendX} ${from.y} V ${midY}`,
    `M ${bendX} ${midY} H ${to.x}`,
    `M ${to.x} ${midY} V ${to.y}`
  ].join(' ');

  appendPath(svg, d, type);
}

function appendPath(svg, d, type) {
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', d);
  path.setAttribute('class', type === 'bronze' ? 'ko-connector ko-connector-bronze' : 'ko-connector ko-connector-main');
  svg.appendChild(path);
}

function getEdgePoint(node, wrapRect, edge) {
  const r = node.getBoundingClientRect();
  const y = r.top - wrapRect.top + (r.height / 2);
  if (edge === 'left') return { x: r.left - wrapRect.left, y };
  return { x: r.right - wrapRect.left, y };
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
    return pred.winnerSide === 'home' || pred.winnerSide === 'away';
  }).length;

  const finished = knockoutMatches.filter((m) => !!m.finished).length;
  let correct = 0;
  let totalPts = 0;

  for (const m of knockoutMatches) {
    if (!m.finished) continue;
    const actualSide = getActualWinnerSide(m);
    const predSide = (demoPreds[m.id] || {}).winnerSide || '';
    if (actualSide && predSide && actualSide === predSide) {
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
    const side = (demoPreds[m.id] || {}).winnerSide;
    return side !== 'home' && side !== 'away';
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
            winnerSideDemo: pred.winnerSide || null,
            winnerDemo: pred.winnerSide || null,
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

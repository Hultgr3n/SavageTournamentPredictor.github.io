// ============================================================
//  leaderboard.js  –  Logic for leaderboard.html
// ============================================================

(async () => {
  const me = await requireAuth();
  buildNav(me.username, me.isAdmin);
  await buildLeaderboard(me.uid);
  attachLeaderboardAutoRefresh(me.uid);
})();

let leaderboardRefreshTimer = null;

function scheduleLeaderboardRefresh(myUid) {
  if (leaderboardRefreshTimer) clearTimeout(leaderboardRefreshTimer);
  leaderboardRefreshTimer = setTimeout(() => {
    buildLeaderboard(myUid).catch((err) => console.error('Leaderboard refresh failed:', err));
  }, 250);
}

function attachLeaderboardAutoRefresh(myUid) {
  db.collection('matches').onSnapshot(() => scheduleLeaderboardRefresh(myUid));
  db.collection('users').onSnapshot(() => scheduleLeaderboardRefresh(myUid));
}

function getActualWinnerName(match) {
  if (!match || !match.finished) return '';

  // Check scores first — most reliable, avoids stale winnerTeam from resets.
  // Only fall back to explicit winner fields for equal-score matches (penalties/ET).
  const home = Number(match.actualHome);
  const away = Number(match.actualAway);
  if (Number.isFinite(home) && Number.isFinite(away)) {
    if (home > away) return String(match.homeTeam || '').trim();
    if (away > home) return String(match.awayTeam || '').trim();
  }

  // Equal scores (penalty/ET): use explicit winner field as tiebreaker.
  const explicitWinner = String(
    match.winnerTeam || match.winner_team_name || match.winner || match.winnerName || ''
  ).trim();
  return explicitWinner;
}

function getActualWinnerSide(match) {
  // Derive winner side from scores first — most reliable, avoids placeholder team names
  const home = Number(match.actualHome);
  const away = Number(match.actualAway);
  if (Number.isFinite(home) && Number.isFinite(away)) {
    if (home > away) return 'home';
    if (away > home) return 'away';
  }
  // Penalty/extra-time fallback: use explicit winner name vs team names
  if (match.finished) {
    const winner = getActualWinnerName(match);
    if (winner && winner === String(match.homeTeam || '').trim()) return 'home';
    if (winner && winner === String(match.awayTeam || '').trim()) return 'away';
  }
  return '';
}

// Mirrors the SLOT_BY_MATCH_ID constant in knockout.js — used for chain resolution.
const SLOT_BY_MATCH_ID_LB = {
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

// Resolve the team name the user intended to be in `predSide` of `matchId`
// by following the W-token prediction chain through `allPreds` and `allMatches`.
// Resolve the team that actually advanced into a W-token slot by following match
// scores through the chain.  This avoids trusting homeTeam/awayTeam fields that
// the API pre-populates with the "expected" team (e.g. Netherlands instead of Morocco).
function lbResolveActualTeamFromWToken(token, allMatches, visited = new Set()) {
  const wMatch = String(token || '').match(/^W(\d+)$/i);
  if (!wMatch) return '';
  const sourceId = wMatch[1];
  if (visited.has(sourceId)) return '';
  const next = new Set(visited);
  next.add(sourceId);
  const m = allMatches[sourceId];
  if (!m) return '';
  const h = Number(m.actualHome);
  const a = Number(m.actualAway);
  if (!Number.isFinite(h) || !Number.isFinite(a)) return '';
  const ws = h > a ? 'home' : a > h ? 'away' : null;
  if (!ws) return '';
  // If the winning side of the source match is itself a W-token slot, recurse
  const srcSlot = SLOT_BY_MATCH_ID_LB[Number(sourceId)];
  if (srcSlot) {
    const nextToken = ws === 'home' ? srcSlot.home : srcSlot.away;
    if (/^W\d+$/i.test(String(nextToken || ''))) {
      const chained = lbResolveActualTeamFromWToken(nextToken, allMatches, next);
      if (chained) return chained;
    }
  }
  const name = String(ws === 'home' ? (m.homeTeam || '') : (m.awayTeam || '')).trim();
  return name && !/^(tbd|team)$/i.test(name) && !/^[WwLl]\d+$/.test(name) ? name : '';
}

// Get the actual winner name for a match, resolving W-token slots through the
// real results chain rather than trusting stale homeTeam/awayTeam API fields.
function getResolvedActualWinnerName(matchId, match, allMatches) {
  const winnerSide = getActualWinnerSide(match);
  if (!winnerSide) return '';
  if (allMatches) {
    const slot = SLOT_BY_MATCH_ID_LB[Number(matchId)];
    if (slot) {
      const token = String(winnerSide === 'home' ? slot.home : slot.away);
      if (/^W\d+$/i.test(token)) {
        const resolved = lbResolveActualTeamFromWToken(token, allMatches);
        if (resolved) return resolved;
      }
    }
  }
  return getActualWinnerName(match);
}

function resolveExpectedTeamName(matchId, predSide, allPreds, allMatches, visited = new Set()) {
  const slot = SLOT_BY_MATCH_ID_LB[Number(matchId)];
  if (!slot) return null; // R32 or unknown — no chain needed
  const token = predSide === 'home' ? slot.home : slot.away;
  const wMatch = String(token || '').match(/^W(\d+)$/i);
  if (!wMatch) return null; // Non-W token (e.g. group rank) — can't resolve here
  const sourceId = wMatch[1];
  if (visited.has(sourceId)) return null;
  const nextVisited = new Set(visited);
  nextVisited.add(sourceId);
  const sourcePred = allPreds[sourceId] || {};
  const sourceSide = sourcePred.winnerSide;
  if (sourceSide !== 'home' && sourceSide !== 'away') return null;
  const sourceMatch = allMatches[sourceId];
  if (!sourceMatch) return null;
  const teamName = String(
    sourceSide === 'home' ? (sourceMatch.homeTeam || '') : (sourceMatch.awayTeam || '')
  ).trim();
  // If the team name is concrete, return it
  if (teamName && !/^(tbd|team)$/i.test(teamName) && !/^[WwLl]\d+$/.test(teamName)) {
    return teamName;
  }
  // Recurse for chained W-tokens
  return resolveExpectedTeamName(sourceId, sourceSide, allPreds, allMatches, nextVisited);
}

function scoreKnockoutPrediction(pred, match, matchId, allPreds, allMatches) {
  if (!match || !match.finished) return null;
  // Require valid actual scores — mirrors knockout.html isPlayed check
  if (match.actualHome == null || match.actualAway == null ||
      !Number.isFinite(Number(match.actualHome)) || !Number.isFinite(Number(match.actualAway))) {
    return null;
  }
  // Match ID 104 is the final (worth 10 pts). Mirrors knockout.js updateDemoSummary.
  const weight = String(matchId) === '104' ? 10 : 5;

  // Side prediction ('home' | 'away') from bracket page.
  // For R16+ matches, also try team-name comparison via the prediction chain to
  // handle cases where the team in a W-token slot differs from what was predicted.
  const predictedSide = String(pred?.winnerSide || '').trim();
  if (predictedSide === 'home' || predictedSide === 'away') {
    const actualSide = getActualWinnerSide(match);
    if (!actualSide) return null;
    if (allPreds && allMatches) {
      const expectedTeam = resolveExpectedTeamName(matchId, predictedSide, allPreds, allMatches);
      if (expectedTeam) {
        const actualTeam = getResolvedActualWinnerName(matchId, match, allMatches);
        if (actualTeam) return expectedTeam === actualTeam ? weight : 0;
      }
    }
    return predictedSide === actualSide ? weight : 0;
  }

  // Named winner prediction (legacy explicit team name)
  const actualWinner = getActualWinnerName(match);
  if (!actualWinner) return null;

  const predictedWinner = String(pred?.winner || '').trim();
  if (predictedWinner) {
    return predictedWinner === actualWinner ? weight : 0;
  }

  // Legacy fallback for old knockout score entries.
  const predHome = pred?.home;
  const predAway = pred?.away;
  if (predHome === null || predAway === null || predHome === undefined || predAway === undefined) {
    return null;
  }

  const ph = Number(predHome);
  const pa = Number(predAway);
  if (!Number.isFinite(ph) || !Number.isFinite(pa) || ph === pa) return null;

  const predictedByScore = ph > pa ? String(match.homeTeam || '').trim() : String(match.awayTeam || '').trim();
  return predictedByScore === actualWinner ? weight : 0;
}

async function buildLeaderboard(myUid) {
  const container = document.getElementById('leaderboard-container');

  // 1. Load all finished matches (we need their actual scores)
  const matchSnap = await db.collection('matches').get();
  const matches = {};
  matchSnap.forEach(d => { matches[d.id] = d.data(); });
  const finishedMatches = Object.entries(matches).filter(([, m]) => m.finished);

  // 2. Load users and merge username registry as fallback for legacy visibility.
  const [usersSnap, usernamesSnap] = await Promise.all([
    db.collection('users').get(),
    db.collection('usernames').get()
  ]);

  const usersByUid = new Map();
  usersSnap.forEach((d) => {
    usersByUid.set(d.id, { uid: d.id, ...d.data() });
  });
  usernamesSnap.forEach((d) => {
    const data = d.data() || {};
    const uid = data.uid;
    if (!uid || usersByUid.has(uid)) return;
    usersByUid.set(uid, { uid, username: d.id, isAdmin: false, legacyRegistryOnly: true });
  });
  const users = Array.from(usersByUid.values());

  if (users.length === 0) {
    container.innerHTML = '<div class="alert alert-info">No users found yet.</div>';
    document.getElementById('last-updated').textContent = 'No accounts available to rank.';
    return;
  }

  // 3. For each user, load their predictions and compute total points
  const rows = await Promise.all(users.map(async (u) => {
    const predSnap = await db.collection('predictions').doc(u.uid).collection('matches').get();
    const preds = {};
    predSnap.forEach(d => { preds[d.id] = d.data(); });

    let totalPts = 0;
    let groupPts = 0;
    let knockoutPts = 0;
    let groupPredicted = 0;
    let knockoutCorrect = 0;
    let exactScores = 0;
    const finishedGroup = finishedMatches.filter(([, m]) => m.type === 'group').length;
    const finishedKnockout = finishedMatches.filter(([, m]) => m.type && m.type !== 'group').length;

    for (const [matchId, m] of finishedMatches) {
      const pred = preds[matchId];
      if (!pred) continue;

      const isGroup = m.type === 'group';
      const isKnockout = m.type && m.type !== 'group';

      if (isGroup) {
        const pts = calcPoints(pred.home, pred.away, m.actualHome, m.actualAway, true);
        if (pts === null) continue;
        totalPts += pts;
        groupPts += pts;
        groupPredicted++;
        if (pts === 3 && Number(pred.home) === Number(m.actualHome) && Number(pred.away) === Number(m.actualAway)) {
          exactScores++;
        }
      } else if (isKnockout) {
        const pts = scoreKnockoutPrediction(pred, m, matchId, preds, matches);
        if (pts === null) continue;
        totalPts += pts;
        knockoutPts += pts;
        if (pts > 0) knockoutCorrect++;
      }
    }

    return {
      uid: u.uid,
      username: u.username || 'Unknown',
      totalPts,
      groupPts,
      knockoutPts,
      groupPredicted,
      knockoutCorrect,
      exactScores,
      finishedGroup,
      finishedKnockout
    };
  }));

  // 4. Sort alphabetically until matches finish; otherwise rank by points and tiebreakers.
  if (finishedMatches.length === 0) {
    rows.sort((a, b) => a.username.localeCompare(b.username));
  } else {
    rows.sort((a, b) =>
      b.totalPts - a.totalPts ||
      b.exactScores - a.exactScores ||
      a.username.localeCompare(b.username)
    );
  }

  // 5. Render table
  const rankEmoji = (i) => i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;

  const tableRows = rows.map((r, i) => {
    const isMe = r.uid === myUid;
    return `<tr class="${isMe ? 'table-success fw-bold' : ''}">
      <td>${rankEmoji(i)}</td>
      <td>${escHtml(r.username)}${isMe ? ' <span class="badge bg-success">You</span>' : ''}</td>
      <td class="text-center fw-bold fs-5">${r.totalPts}</td>
      <td class="text-center">${r.groupPts} pts<br><span class="text-muted small">${r.groupPredicted}/${r.finishedGroup}</span></td>
      <td class="text-center">${r.knockoutPts} pts<br><span class="text-muted small">${r.knockoutCorrect}/${r.finishedKnockout} winners</span></td>
      <td class="text-center">${r.exactScores}</td>
    </tr>`;
  }).join('');

  container.innerHTML = `
    <div class="table-responsive">
      <table class="table table-hover align-middle">
        <thead class="table-dark">
          <tr>
            <th>#</th>
            <th>Player</th>
            <th class="text-center">Points</th>
            <th class="text-center">Predicted Group Stage</th>
            <th class="text-center">Predicted Knockout</th>
            <th class="text-center">Exact Group Scores 🎯</th>
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>
    <p class="text-muted small">Group stage: 1 per correct goal + 1 for correct outcome (max 3 per match).
    Knockout stage: correct winner = 5 points, and correct tournament winner (final) = 10 points.
    Tiebreaker: most exact group scores.</p>`;

  document.getElementById('last-updated').textContent =
    finishedMatches.length === 0
      ? 'No finished matches yet. Showing all accounts alphabetically with 0 points.'
      : `Based on ${finishedMatches.length} finished match(es). Auto-refreshes when matches or users change.`;
}

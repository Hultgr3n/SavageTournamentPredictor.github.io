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

  const explicitWinner = String(
    match.winnerTeam || match.winner_team_name || match.winner || match.winnerName || ''
  ).trim();
  if (explicitWinner) return explicitWinner;

  const home = Number(match.actualHome);
  const away = Number(match.actualAway);
  if (!Number.isFinite(home) || !Number.isFinite(away)) return '';
  if (home > away) return String(match.homeTeam || '').trim();
  if (away > home) return String(match.awayTeam || '').trim();
  return '';
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

function scoreKnockoutPrediction(pred, match) {
  if (!match || !match.finished) return null;

  // Side prediction ('home' | 'away') from bracket page — compare sides directly
  // to avoid mismatches when homeTeam/awayTeam still hold placeholder values (e.g. "W73")
  const predictedSide = String(pred?.winnerSide || '').trim();
  if (predictedSide === 'home' || predictedSide === 'away') {
    const actualSide = getActualWinnerSide(match);
    if (!actualSide) return null;
    const weight = match.type === 'final' ? 10 : 5;
    return predictedSide === actualSide ? weight : 0;
  }

  // Named winner prediction (legacy explicit team name)
  const actualWinner = getActualWinnerName(match);
  if (!actualWinner) return null;

  const predictedWinner = String(pred?.winner || '').trim();
  if (predictedWinner) {
    const weight = match.type === 'final' ? 10 : 5;
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
  const weight = match.type === 'final' ? 10 : 5;
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
    let knockoutPredicted = 0;
    let exactScores = 0;
    const finishedGroup = finishedMatches.filter(([, m]) => m.type === 'group').length;
    const finishedKnockout = finishedMatches.filter(([, m]) => m.type !== 'group').length;

    for (const [matchId, m] of finishedMatches) {
      const pred = preds[matchId];
      if (!pred) continue;

      let pts = null;
      if (m.type === 'group') {
        pts = calcPoints(pred.home, pred.away, m.actualHome, m.actualAway, true);
      } else {
        pts = scoreKnockoutPrediction(pred, m);
      }

      if (pts === null) continue;
      totalPts += pts;
      if (m.type === 'group') {
        groupPts += pts;
        groupPredicted++;
        if (pts === 3 && Number(pred.home) === Number(m.actualHome) && Number(pred.away) === Number(m.actualAway)) {
          exactScores++;
        }
      } else {
        knockoutPts += pts;
        knockoutPredicted++;
      }
    }

    return {
      uid: u.uid,
      username: u.username || 'Unknown',
      totalPts,
      groupPts,
      knockoutPts,
      groupPredicted,
      knockoutPredicted,
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
      <td class="text-center">${r.knockoutPts} pts<br><span class="text-muted small">${r.knockoutPredicted}/${r.finishedKnockout}</span></td>
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

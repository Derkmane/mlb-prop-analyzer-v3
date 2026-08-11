export const HHR_DISPLAY_APP_CSS = `
:root {
  color-scheme: dark;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: #081019;
  color: #eef5fb;
}
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; background: radial-gradient(circle at top, #172536 0, #081019 46%, #050a10 100%); }
button, input { font: inherit; }
a { color: inherit; }
.shell { width: min(1500px, 100%); margin: 0 auto; padding: 24px; }
.topbar { display: flex; gap: 20px; justify-content: space-between; align-items: flex-start; margin-bottom: 22px; }
.eyebrow { color: #78b7ff; font-size: .76rem; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; }
h1 { margin: 4px 0 8px; font-size: clamp(1.8rem, 4vw, 3rem); line-height: 1.04; }
.subtle { color: #95a9bb; }
.meta-panel { min-width: 270px; border: 1px solid #25384a; border-radius: 14px; background: #0c1722cc; padding: 14px 16px; }
.meta-row { display: flex; justify-content: space-between; gap: 18px; padding: 4px 0; font-size: .84rem; }
.meta-row span:first-child { color: #8ea3b7; }
.logout-form { margin-top: 10px; }
.button, button { border: 1px solid #38516a; background: #142538; color: #eef5fb; border-radius: 9px; padding: 9px 13px; cursor: pointer; }
.button:hover, button:hover { background: #1b3149; }
.status { margin: 0 0 16px; padding: 12px 14px; border: 1px solid #283e52; border-radius: 10px; background: #0d1925; color: #a9bbca; }
.status.error { border-color: #744049; color: #ffb5bd; background: #261217; }
.board-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; align-items: start; }
.list-panel { border: 1px solid #273b4e; background: #09141fdd; border-radius: 16px; overflow: hidden; }
.list-heading { padding: 18px 18px 14px; border-bottom: 1px solid #213447; position: sticky; top: 0; z-index: 2; background: #0b1723f2; backdrop-filter: blur(12px); }
.list-heading h2 { margin: 0; font-size: 1.15rem; }
.list-heading p { margin: 5px 0 0; color: #8fa5b8; font-size: .84rem; }
.pick-list { display: grid; gap: 12px; padding: 12px; }
.pick-card { border: 1px solid #263c50; border-radius: 13px; background: linear-gradient(145deg, #101e2b, #0b151f); padding: 14px; box-shadow: 0 12px 30px #00000020; }
.pick-head { display: flex; justify-content: space-between; gap: 14px; align-items: flex-start; }
.player-name { margin: 0; font-size: 1.15rem; }
.team-line { margin-top: 3px; color: #91a8bb; font-size: .84rem; }
.rank { display: inline-flex; align-items: center; justify-content: center; min-width: 42px; height: 32px; border-radius: 999px; background: #172b3e; color: #9cc8f7; font-weight: 800; }
.chips { display: flex; flex-wrap: wrap; gap: 7px; margin: 12px 0; }
.chip { border: 1px solid #35516b; border-radius: 999px; padding: 5px 9px; font-size: .76rem; font-weight: 750; background: #102033; }
.chip.higher { border-color: #2f7462; color: #9ff0d1; }
.chip.lower { border-color: #6a526f; color: #e1b2ea; }
.chip.lineup { color: #e7ca8b; border-color: #695834; }
.prob-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 7px; margin: 12px 0; }
.metric { border: 1px solid #21384b; background: #091520; border-radius: 9px; padding: 9px; }
.metric-label { display: block; color: #7f97ab; font-size: .68rem; text-transform: uppercase; letter-spacing: .04em; }
.metric-value { display: block; margin-top: 3px; font-size: .98rem; font-weight: 800; }
.detail-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px 14px; margin: 12px 0; font-size: .82rem; }
.detail-grid strong { color: #a7bdd0; }
.starter { margin-top: 12px; padding: 10px 11px; border-radius: 10px; background: #0a1722; border: 1px solid #20374a; }
.starter-title { margin: 0 0 6px; font-weight: 800; }
.starter-stats { color: #9bb0c1; font-size: .8rem; line-height: 1.55; }
.history { margin-top: 14px; padding-top: 12px; border-top: 1px solid #21384a; }
.history h3 { margin: 0 0 10px; font-size: .92rem; }
.chart { position: relative; height: 130px; display: flex; align-items: flex-end; gap: 6px; padding: 12px 8px 20px; border: 1px solid #21384a; border-radius: 10px; background: #07121c; overflow: hidden; }
.chart-bar-wrap { flex: 1; min-width: 0; height: 100%; display: flex; align-items: flex-end; justify-content: center; position: relative; z-index: 1; }
.chart-bar { width: min(34px, 80%); min-height: 4px; border-radius: 5px 5px 2px 2px; opacity: .9; }
.chart-bar.win { background: #43c894; }
.chart-bar.loss { background: #e36774; }
.chart-bar.void { background: #a8aebb; }
.reference-line { position: absolute; left: 0; right: 0; border-top: 1px dashed #f3c76b; z-index: 0; }
.reference-label { position: absolute; right: 6px; transform: translateY(-100%); color: #f3c76b; font-size: .66rem; background: #07121ccc; padding: 1px 4px; }
.history-table-wrap { overflow-x: auto; margin-top: 8px; }
table { width: 100%; border-collapse: collapse; font-size: .74rem; }
th, td { text-align: left; padding: 6px 5px; border-bottom: 1px solid #1d3040; white-space: nowrap; }
th { color: #8097aa; font-weight: 700; }
.result-win { color: #75e0b7; font-weight: 800; }
.result-loss { color: #ff929c; font-weight: 800; }
.result-void { color: #c7cbd2; font-weight: 800; }
.empty { color: #899eb0; padding: 12px 2px; font-size: .84rem; }
.login-shell { min-height: 100vh; display: grid; place-items: center; padding: 22px; }
.login-card { width: min(420px, 100%); border: 1px solid #2b4257; border-radius: 16px; background: #0b1723; padding: 24px; box-shadow: 0 22px 60px #00000050; }
.login-card h1 { font-size: 1.7rem; }
.login-card label { display: block; margin: 18px 0 7px; color: #a8bac8; font-size: .82rem; }
.login-card input { width: 100%; padding: 12px; border-radius: 9px; border: 1px solid #385067; background: #08111a; color: #fff; }
.login-card button { width: 100%; margin-top: 12px; }
.login-error { margin-top: 12px; color: #ff9ba6; font-size: .84rem; }
@media (max-width: 980px) {
  .board-grid { grid-template-columns: 1fr; }
  .list-heading { position: static; }
}
@media (max-width: 650px) {
  .shell { padding: 14px; }
  .topbar { flex-direction: column; }
  .meta-panel { width: 100%; min-width: 0; }
  .prob-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .detail-grid { grid-template-columns: 1fr; }
  .pick-card { padding: 12px; }
}
`;

export const HHR_DISPLAY_APP_JS = `
(() => {
  'use strict';

  const statusNode = document.getElementById('status');
  const capturedAtNode = document.getElementById('captured-at');
  const boardVersionNode = document.getElementById('board-version');
  const modelVersionNode = document.getElementById('model-version');
  const rationaleNode = document.getElementById('ranking-rationale');
  const lowerList = document.getElementById('hhr-25-lower-list');
  const higherList = document.getElementById('hhr-05-higher-list');

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function percentage(value) {
    return (Number(value) * 100).toFixed(1) + '%';
  }

  function displayNumber(value) {
    return value === null || value === undefined ? '—' : String(value);
  }

  function displayTime(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
  }

  function freshness(value) {
    const captured = new Date(value);
    const ageMs = Date.now() - captured.getTime();
    if (!Number.isFinite(ageMs)) return String(value);
    const minutes = Math.max(0, Math.floor(ageMs / 60000));
    if (minutes < 60) return captured.toLocaleString() + ' · ' + minutes + 'm old';
    const hours = Math.floor(minutes / 60);
    return captured.toLocaleString() + ' · ' + hours + 'h old';
  }

  function addMetric(parent, label, value) {
    const box = element('div', 'metric');
    box.append(element('span', 'metric-label', label));
    box.append(element('span', 'metric-value', percentage(value)));
    parent.append(box);
  }

  function addDetail(parent, label, value) {
    const row = element('div');
    row.append(element('strong', '', label + ': '));
    row.append(document.createTextNode(value));
    parent.append(row);
  }

  function renderStarter(pick, parent) {
    const starterBox = element('div', 'starter');
    starterBox.append(element('div', 'starter-title', 'Opposing starter'));
    if (!pick.opposingStarter) {
      starterBox.append(element('div', 'empty', pick.opposingStarterFailureReason || 'Unavailable'));
      parent.append(starterBox);
      return;
    }
    const starter = pick.opposingStarter;
    starterBox.append(element('div', '', (starter.name || 'Unknown') + ' · ' + (starter.throwingHand || '?') + 'HP · ERA ' + displayNumber(starter.era)));
    const stats = element('div', 'starter-stats');
    stats.append(element('div', '', 'Last 10: ' + starter.last10.starts + ' starts · ' + starter.last10.inningsPitched + ' IP · ' + starter.last10.earnedRuns + ' ER · ' + starter.last10.strikeouts + ' K · WHIP ' + displayNumber(starter.last10.whip)));
    stats.append(element('div', '', 'Season: ' + displayNumber(starter.season.inningsPitched) + ' IP · ' + displayNumber(starter.season.earnedRuns) + ' ER · ' + displayNumber(starter.season.strikeouts) + ' K · WHIP ' + displayNumber(starter.season.whip)));
    starterBox.append(stats);
    parent.append(starterBox);
  }

  function renderHistory(pick, parent) {
    const history = element('section', 'history');
    history.append(element('h3', '', 'Last five appearances'));
    if (!Array.isArray(pick.lastFiveGames) || pick.lastFiveGames.length === 0) {
      history.append(element('div', 'empty', pick.lastFiveGamesFailureReason || 'No appearance history available.'));
      parent.append(history);
      return;
    }

    const maxObserved = Math.max(...pick.lastFiveGames.map((game) => Number(game.hrr)), Number(pick.postedLine), 1);
    const chart = element('div', 'chart');
    const line = element('div', 'reference-line');
    const linePosition = Math.min(100, Math.max(0, (Number(pick.postedLine) / maxObserved) * 100));
    line.style.bottom = linePosition + '%';
    const lineLabel = element('span', 'reference-label', 'Line ' + pick.postedLine);
    lineLabel.style.bottom = linePosition + '%';
    chart.append(line, lineLabel);

    for (const game of pick.lastFiveGames) {
      const wrap = element('div', 'chart-bar-wrap');
      const bar = element('div', 'chart-bar ' + game.selectedSideOutcome);
      bar.style.height = Math.max(4, (Number(game.hrr) / maxObserved) * 100) + '%';
      bar.title = game.gameDate + ': ' + game.hrr + ' H+R+RBI · ' + game.selectedSideOutcome;
      wrap.append(bar);
      chart.append(wrap);
    }
    history.append(chart);

    const tableWrap = element('div', 'history-table-wrap');
    const table = element('table');
    const thead = element('thead');
    const header = element('tr');
    for (const label of ['Date', 'Opp', 'H', 'R', 'RBI', 'H+R+RBI', 'Result']) header.append(element('th', '', label));
    thead.append(header);
    table.append(thead);
    const tbody = element('tbody');
    for (const game of pick.lastFiveGames) {
      const row = element('tr');
      const values = [game.gameDate, game.opponentAbbreviation || game.opponentTeamName, game.hits, game.runs, game.rbi, game.hrr];
      for (const value of values) row.append(element('td', '', value));
      row.append(element('td', 'result-' + game.selectedSideOutcome, game.selectedSideOutcome.toUpperCase()));
      tbody.append(row);
    }
    table.append(tbody);
    tableWrap.append(table);
    history.append(tableWrap);
    parent.append(history);
  }

  function renderPick(pick) {
    const card = element('article', 'pick-card');
    const head = element('div', 'pick-head');
    const identity = element('div');
    identity.append(element('h3', 'player-name', pick.player));
    identity.append(element('div', 'team-line', pick.team + ' vs ' + pick.opponent));
    head.append(identity, element('div', 'rank', '#' + pick.persistedRank));
    card.append(head);

    const chips = element('div', 'chips');
    chips.append(element('span', 'chip ' + pick.selectedSide, String(pick.selectedSide).toUpperCase() + ' ' + pick.postedLine));
    chips.append(element('span', 'chip lineup', String(pick.lineupStatus)));
    card.append(chips);

    const probabilities = element('div', 'prob-grid');
    addMetric(probabilities, 'P(Win)', pick.pWin);
    addMetric(probabilities, 'P(Loss)', pick.pLoss);
    addMetric(probabilities, 'P(Void)', pick.pVoid);
    addMetric(probabilities, 'P(Win|grades)', pick.pWinGivenGrades);
    card.append(probabilities);

    const details = element('div', 'detail-grid');
    addDetail(details, 'Game', displayTime(pick.gameTime));
    addDetail(details, 'Batting order', 'Unavailable in current display archive');
    addDetail(details, 'Multiplier', pick.multiplier === null ? '—' : String(pick.multiplier) + '× · display only');
    addDetail(details, 'American price', pick.americanPrice === null ? '—' : String(pick.americanPrice) + ' · display only');
    card.append(details);

    renderStarter(pick, card);
    renderHistory(pick, card);
    return card;
  }

  function renderList(node, picks) {
    node.replaceChildren();
    if (!Array.isArray(picks) || picks.length === 0) {
      node.append(element('div', 'empty', 'No eligible archived rows for this exact line and side.'));
      return;
    }
    for (const pick of picks) node.append(renderPick(pick));
  }

  async function loadBoard() {
    statusNode.className = 'status';
    statusNode.textContent = 'Loading latest committed HHR display archive…';
    try {
      const response = await fetch('/api/hhr-display-board', { cache: 'no-store', credentials: 'same-origin' });
      if (response.status === 401) {
        window.location.assign('/login');
        return;
      }
      if (!response.ok) throw new Error('board unavailable');
      const board = await response.json();
      capturedAtNode.textContent = freshness(board.capturedAt);
      boardVersionNode.textContent = String(board.boardVersion);
      modelVersionNode.textContent = String(board.modelVersion);
      rationaleNode.textContent = String(board.rankingRationale);
      renderList(lowerList, board.hhr25LowerAlternates);
      renderList(higherList, board.hhr05HigherAlternates);
      statusNode.textContent = 'Loaded ' + board.hhr25LowerAlternates.length + ' Lower 2.5 picks and ' + board.hhr05HigherAlternates.length + ' Higher 0.5 picks. No rows are padded.';
    } catch {
      statusNode.className = 'status error';
      statusNode.textContent = 'Latest HHR display board is unavailable. No stale fallback was loaded.';
    }
  }

  void loadBoard();
})();
`;

export function renderHhrDisplayLoginPage(showError = false): string {
  const error = showError
    ? '<div class="login-error" role="alert">Incorrect password.</div>'
    : '';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>MLB Prop Analyzer</title>
  <link rel="stylesheet" href="/app.css">
</head>
<body>
  <main class="login-shell">
    <section class="login-card">
      <div class="eyebrow">MLB Prop Analyzer V3</div>
      <h1>HHR Board</h1>
      <p class="subtle">Private read-only display of committed pregame HHR evidence.</p>
      <form method="post" action="/login" autocomplete="current-password">
        <label for="password">Password</label>
        <input id="password" name="password" type="password" required autofocus autocomplete="current-password">
        <button type="submit">Open board</button>
      </form>
      ${error}
    </section>
  </main>
</body>
</html>`;
}

export function renderHhrDisplayAppPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>MLB Prop Analyzer — HHR</title>
  <link rel="stylesheet" href="/app.css">
</head>
<body>
  <main class="shell">
    <header class="topbar">
      <div>
        <div class="eyebrow">MLB Prop Analyzer V3</div>
        <h1>Hits + Runs + RBIs</h1>
        <div id="ranking-rationale" class="subtle">Loading ranking rationale…</div>
      </div>
      <aside class="meta-panel" aria-label="Board freshness">
        <div class="meta-row"><span>Capture</span><strong id="captured-at">Loading…</strong></div>
        <div class="meta-row"><span>Board contract</span><strong id="board-version">—</strong></div>
        <div class="meta-row"><span>Model</span><strong id="model-version">—</strong></div>
        <form class="logout-form" method="post" action="/logout"><button type="submit">Sign out</button></form>
      </aside>
    </header>
    <div id="status" class="status" role="status">Loading latest committed HHR display archive…</div>
    <div class="board-grid">
      <section class="list-panel">
        <header class="list-heading"><h2>HHR 2.5 Lower Alt</h2><p>Up to 20 existing archived rows, in persisted probability rank.</p></header>
        <div id="hhr-25-lower-list" class="pick-list"></div>
      </section>
      <section class="list-panel">
        <header class="list-heading"><h2>HHR 0.5 Higher Alt</h2><p>Up to 20 existing archived rows, in persisted probability rank.</p></header>
        <div id="hhr-05-higher-list" class="pick-list"></div>
      </section>
    </div>
  </main>
  <script src="/app.js" defer></script>
</body>
</html>`;
}

export const HHR_DISPLAY_APP_CSS = `
:root {
  color-scheme: dark;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: #071019;
  color: #eef5fb;
}
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; background: radial-gradient(circle at top, #17283b 0, #071019 48%, #04090e 100%); }
button, input { font: inherit; }
.shell { width: min(1480px, 100%); margin: 0 auto; padding: 24px; }
.topbar { display: flex; gap: 20px; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; }
.eyebrow { color: #78b7ff; font-size: .74rem; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; }
h1 { margin: 5px 0 8px; font-size: clamp(2rem, 5vw, 3.3rem); line-height: 1.02; }
.subtle { color: #95a9bb; margin: 0; }
.meta-panel { min-width: 290px; border: 1px solid #2a4055; border-radius: 14px; background: #0b1723dd; padding: 14px 16px; }
.meta-row { display: flex; justify-content: space-between; gap: 18px; padding: 4px 0; font-size: .82rem; }
.meta-row span:first-child { color: #8ea3b7; }
.freshness { font-size: .74rem; font-weight: 900; letter-spacing: .07em; }
.freshness.today { color: #9ff0d1; }
.freshness.stale { color: #ffadb5; }
.freshness.unknown { color: #f2cf8f; }
.controls { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 10px; }
button { border: 1px solid #38516a; background: #142538; color: #eef5fb; border-radius: 9px; padding: 9px 13px; cursor: pointer; }
button:hover { background: #1b3149; }
button:disabled { opacity: .55; cursor: wait; }
.logout-form { margin: 0; }
.logout-form button { width: 100%; }
.status { margin: 0 0 16px; padding: 12px 14px; border: 1px solid #283e52; border-radius: 10px; background: #0d1925; color: #a9bbca; line-height: 1.45; }
.status.error { border-color: #744049; color: #ffb5bd; background: #261217; }
.research-banner { margin: 0 0 16px; padding: 13px 15px; border: 1px solid #7b612f; border-radius: 10px; color: #f0d296; background: #211a0e; font-size: .84rem; font-weight: 750; }
.category-tabs { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin: 0 0 18px; }
.category-tab { min-height: 58px; text-align: center; font-weight: 800; border-radius: 12px; }
.category-tab.active { border-color: #78b7ff; background: #17324a; box-shadow: inset 0 0 0 1px #4b83b7; }
.category-panel { border: 1px solid #273b4e; background: #09141fdd; border-radius: 16px; overflow: hidden; }
.category-panel[hidden] { display: none; }
.category-heading { padding: 18px; border-bottom: 1px solid #213447; }
.category-heading h2 { margin: 0; font-size: 1.35rem; }
.category-heading p { margin: 6px 0 0; color: #8fa5b8; font-size: .84rem; }
.pick-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; padding: 12px; }
.pick-card { border: 1px solid #263c50; border-radius: 13px; background: linear-gradient(145deg, #101e2b, #0b151f); padding: 15px; box-shadow: 0 12px 30px #00000020; }
.pick-card.evidence { border-color: #6b5a39; background: linear-gradient(145deg, #1d1a12, #11130f); }
.pick-head { display: flex; justify-content: space-between; gap: 14px; align-items: flex-start; }
.player-name { margin: 0; font-size: 1.15rem; }
.matchup { margin-top: 4px; color: #91a8bb; font-size: .84rem; }
.market-badge { border: 1px solid #486c8b; border-radius: 999px; padding: 5px 9px; color: #b7d8f5; font-size: .72rem; font-weight: 800; white-space: nowrap; }
.research-label { margin-top: 10px; display: inline-block; border: 1px solid #84692f; background: #241c0c; color: #f4d287; border-radius: 7px; padding: 6px 9px; font-size: .7rem; font-weight: 900; letter-spacing: .06em; }
.chips { display: flex; flex-wrap: wrap; gap: 7px; margin: 12px 0; }
.chip { border: 1px solid #35516b; border-radius: 999px; padding: 5px 9px; font-size: .74rem; font-weight: 750; background: #102033; }
.chip.higher { border-color: #2f7462; color: #9ff0d1; }
.chip.lower { border-color: #6a526f; color: #e1b2ea; }
.chip.lineup { border-color: #695834; color: #e7ca8b; }
.chip.warning { border-color: #7a5a32; color: #f2cf8f; background: #221a0f; }
.prob-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 7px; margin: 12px 0; }
.metric { border: 1px solid #21384b; background: #091520; border-radius: 9px; padding: 9px; }
.metric.primary { border-color: #5c7046; background: #121c12; }
.metric-label { display: block; color: #7f97ab; font-size: .66rem; text-transform: uppercase; letter-spacing: .04em; }
.metric-value { display: block; margin-top: 3px; font-size: .96rem; font-weight: 800; }
.analysis-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 14px; margin-top: 12px; padding-top: 12px; border-top: 1px solid #203346; color: #9db0c0; font-size: .8rem; }
.analysis-grid strong { color: #d4e1eb; }
.section-label { margin: 14px 0 7px; color: #8fa5b8; font-size: .69rem; font-weight: 900; text-transform: uppercase; letter-spacing: .08em; }
.last-five { display: flex; flex-wrap: wrap; gap: 6px; }
.game-result { border: 1px solid #34475b; border-radius: 8px; padding: 6px 8px; font-size: .72rem; background: #0a1621; }
.game-result.cash { border-color: #34745f; color: #9ff0d1; background: #0c211a; }
.game-result.miss { border-color: #74444b; color: #ffb0b8; background: #241116; }
.game-result.void { border-color: #74653d; color: #e6ca8b; background: #211b0f; }
.calibration { margin-top: 12px; border-radius: 9px; padding: 10px 11px; border: 1px solid #3a4e61; background: #0a1722; font-size: .78rem; line-height: 1.4; }
.calibration.failed { border-color: #7c444b; color: #ffb2ba; background: #241216; }
.calibration.passed { border-color: #36715e; color: #a1e7cf; background: #0c211a; }
.calibration.insufficient, .calibration.pending { border-color: #756238; color: #e7cc92; background: #211a0d; }
.calibration strong { display: block; margin-bottom: 3px; color: inherit; }
.empty-state { padding: 42px 22px; text-align: center; color: #a9bbca; }
.empty-state strong { display: block; color: #eef5fb; font-size: 1.05rem; margin-bottom: 7px; }
.evidence-shell { margin-top: 22px; border: 1px solid #5d4b30; border-radius: 16px; background: #16130ddd; overflow: hidden; }
.evidence-heading { padding: 18px; border-bottom: 1px solid #4a3d28; }
.evidence-heading h2 { margin: 0; font-size: 1.25rem; }
.evidence-heading p { margin: 6px 0 0; color: #d1bd93; font-size: .84rem; line-height: 1.45; }
.evidence-group { padding: 14px; border-top: 1px solid #3d3424; }
.evidence-group:first-child { border-top: 0; }
.evidence-group h3 { margin: 0 0 10px; font-size: 1rem; color: #ead8ad; }
.evidence-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.login-shell { min-height: 100vh; display: grid; place-items: center; padding: 22px; }
.login-card { width: min(420px, 100%); border: 1px solid #2b4257; border-radius: 16px; background: #0b1723; padding: 24px; box-shadow: 0 22px 60px #00000050; }
.login-card h1 { font-size: 1.7rem; }
.login-card label { display: block; margin: 18px 0 7px; color: #a8bac8; font-size: .82rem; }
.login-card input { width: 100%; padding: 12px; border-radius: 9px; border: 1px solid #385067; background: #08111a; color: #fff; }
.login-card button { width: 100%; margin-top: 12px; }
.login-error { margin-top: 12px; color: #ff9ba6; font-size: .84rem; }
@media (max-width: 900px) { .pick-list, .evidence-grid { grid-template-columns: 1fr; } }
@media (max-width: 700px) {
  .shell { padding: 14px; }
  .topbar { flex-direction: column; }
  .meta-panel { width: 100%; min-width: 0; }
  .category-tabs { grid-template-columns: 1fr; }
  .category-tab { min-height: 46px; }
  .prob-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .analysis-grid { grid-template-columns: 1fr; }
}
`;

export const HHR_DISPLAY_APP_JS = `
(() => {
  'use strict';

  const statusNode = document.getElementById('status');
  const refreshButton = document.getElementById('refresh-board');
  const capturedAtNode = document.getElementById('captured-at');
  const freshnessNode = document.getElementById('capture-freshness');
  const categoryTabsNode = document.getElementById('category-tabs');
  const categoryPanelsNode = document.getElementById('category-panels');
  const evidenceNode = document.getElementById('archived-evidence');
  let loadInFlight = false;

  const percentFormatter = new Intl.NumberFormat(undefined, {
    style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1,
  });
  const decimalFormatter = new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 1, maximumFractionDigits: 2,
  });
  const centralDateFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
  });

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function percentage(value) {
    return value === null || value === undefined ? 'Unavailable' : percentFormatter.format(Number(value));
  }

  function decimal(value) {
    return value === null || value === undefined ? 'Unavailable' : decimalFormatter.format(Number(value));
  }

  function textValue(value) {
    return value === null || value === undefined || value === '' ? 'Unavailable' : String(value);
  }

  function displayTime(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
  }

  function centralSlateDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : centralDateFormatter.format(date);
  }

  function boardFreshness(value) {
    const capturedSlateDate = centralSlateDate(value);
    const currentSlateDate = centralSlateDate(Date.now());
    if (capturedSlateDate === null || currentSlateDate === null) return 'UNKNOWN';
    return capturedSlateDate === currentSlateDate ? 'TODAY' : 'STALE';
  }

  function chip(text, className) {
    return element('span', 'chip' + (className ? ' ' + className : ''), text);
  }

  function metric(label, value, primary) {
    const node = element('div', 'metric' + (primary ? ' primary' : ''));
    node.append(element('span', 'metric-label', label));
    node.append(element('span', 'metric-value', percentage(value)));
    return node;
  }

  function detail(label, value) {
    const node = element('div');
    node.append(element('strong', null, label + ': '));
    node.append(document.createTextNode(textValue(value)));
    return node;
  }

  function renderLastFive(pick) {
    const wrap = element('div');
    wrap.append(element('div', 'section-label', 'Last five · selected side + current line'));
    const games = element('div', 'last-five');
    if (!Array.isArray(pick.lastFive) || pick.lastFive.length === 0) {
      games.append(element('span', 'game-result', 'Unavailable in archived lineage'));
    } else {
      pick.lastFive.forEach((game) => {
        const label = game.gameDate + ' vs ' + game.opponent + ' · ' + game.actual;
        games.append(element('span', 'game-result ' + game.outcome, label));
      });
    }
    wrap.append(games);
    return wrap;
  }

  function renderCalibration(pick) {
    const calibration = pick.calibration || { status: 'pending', cohort: 'Unavailable', message: 'Calibration evidence unavailable.' };
    const box = element('div', 'calibration ' + calibration.status);
    box.append(element('strong', null, 'Calibration · ' + calibration.cohort + ' · ' + String(calibration.status).toUpperCase()));
    box.append(document.createTextNode(calibration.message));
    return box;
  }

  function renderProductPick(pick) {
    const card = element('article', 'pick-card');
    const head = element('div', 'pick-head');
    const identity = element('div');
    identity.append(element('h3', 'player-name', pick.player));
    identity.append(element('div', 'matchup', pick.team + ' vs ' + pick.opponent + ' · ' + displayTime(pick.gameTime)));
    head.append(identity, element('span', 'market-badge', pick.market));
    card.append(head);
    card.append(element('span', 'research-label', pick.probabilityLabel || 'UNVALIDATED RESEARCH'));

    const chips = element('div', 'chips');
    chips.append(chip(pick.selectedSide === 'higher' ? 'Higher' : 'Lower', pick.selectedSide));
    chips.append(chip('Line ' + pick.postedLine));
    chips.append(chip(pick.offerType === 'baseline' ? 'Baseline' : 'Alternate'));
    if (pick.lineupStatus) chips.append(chip(pick.lineupStatus === 'confirmed' ? 'Lineup confirmed' : 'Lineup projected', 'lineup'));
    card.append(chips);

    const probabilities = element('div', 'prob-grid');
    probabilities.append(metric('P(Win | grades)', pick.pWinGivenGrades, true));
    probabilities.append(metric('P(Win)', pick.pWin, false));
    probabilities.append(metric('P(Loss)', pick.pLoss, false));
    probabilities.append(metric('P(Void)', pick.pVoid, false));
    card.append(probabilities);

    const starter = pick.opposingStarter || {};
    const analysis = element('div', 'analysis-grid');
    analysis.append(detail('Expected PA', decimal(pick.expectedPlateAppearances)));
    analysis.append(detail('Lineup slot', pick.lineupSlot));
    analysis.append(detail('Opposing starter', starter.name));
    analysis.append(detail('Starter hand', starter.hand));
    analysis.append(detail('Starter ERA', starter.era === null || starter.era === undefined ? null : decimal(starter.era)));
    analysis.append(detail('Starter K rate', starter.kRate === null || starter.kRate === undefined ? null : percentage(starter.kRate)));
    analysis.append(detail('Recent workload', starter.recentWorkload));
    analysis.append(detail('Platoon', pick.platoon));
    analysis.append(detail('Team implied runs', pick.teamImpliedRunTotal === null || pick.teamImpliedRunTotal === undefined ? null : decimal(pick.teamImpliedRunTotal)));
    analysis.append(detail('Park', pick.park));
    analysis.append(detail('Captured', displayTime(pick.capturedAt)));
    card.append(analysis);
    card.append(renderLastFive(pick));
    card.append(renderCalibration(pick));
    return card;
  }

  function activateCategory(categoryId) {
    for (const tab of categoryTabsNode.querySelectorAll('[data-category-id]')) {
      const active = tab.dataset.categoryId === categoryId;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    }
    for (const panel of categoryPanelsNode.querySelectorAll('[data-category-panel]')) {
      panel.hidden = panel.dataset.categoryPanel !== categoryId;
    }
  }

  function renderCategories(categories) {
    categoryTabsNode.replaceChildren();
    categoryPanelsNode.replaceChildren();
    categories.forEach((category, index) => {
      const tab = element('button', 'category-tab', category.title);
      tab.type = 'button';
      tab.dataset.categoryId = category.categoryId;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', index === 0 ? 'true' : 'false');
      tab.addEventListener('click', () => activateCategory(category.categoryId));
      categoryTabsNode.append(tab);

      const panel = element('section', 'category-panel');
      panel.dataset.categoryPanel = category.categoryId;
      panel.hidden = index !== 0;
      const heading = element('div', 'category-heading');
      heading.append(element('h2', null, category.title));
      heading.append(element('p', null, 'Top Five · server-ranked by P(Win | grades), then P(Void). Research probabilities are not production calibrated.'));
      panel.append(heading);

      if (!Array.isArray(category.picks) || category.picks.length === 0) {
        const empty = element('div', 'empty-state');
        empty.append(element('strong', null, 'No research-authorized picks right now'));
        empty.append(document.createTextNode(category.emptyState || 'No research-authorized pregame prop is available for this category right now.'));
        panel.append(empty);
      } else {
        const list = element('div', 'pick-list');
        category.picks.forEach((pick) => list.append(renderProductPick(pick)));
        panel.append(list);
      }
      categoryPanelsNode.append(panel);
    });
  }

  function renderEvidencePick(pick, group, capturedAt) {
    const card = element('article', 'pick-card evidence');
    const head = element('div', 'pick-head');
    const identity = element('div');
    identity.append(element('h3', 'player-name', pick.player));
    identity.append(element('div', 'matchup', pick.team + ' vs ' + pick.opponent + ' · ' + displayTime(pick.gameTime)));
    head.append(identity, element('span', 'market-badge', group.market));
    card.append(head);
    const chips = element('div', 'chips');
    chips.append(chip(pick.selectedSide === 'higher' ? 'Higher' : 'Lower', pick.selectedSide));
    chips.append(chip('Line ' + pick.postedLine));
    chips.append(chip('Alternate'));
    chips.append(chip('Archived evidence', 'warning'));
    card.append(chips);
    const probabilities = element('div', 'prob-grid');
    probabilities.append(metric('P(Win | grades)', pick.pWinGivenGrades, true));
    probabilities.append(metric('P(Win)', pick.pWin, false));
    probabilities.append(metric('P(Loss)', pick.pLoss, false));
    probabilities.append(metric('P(Void)', pick.pVoid, false));
    card.append(probabilities);
    const analysis = element('div', 'analysis-grid');
    analysis.append(detail('Captured', displayTime(capturedAt)));
    card.append(analysis);
    return card;
  }

  function renderArchivedEvidence(archivedEvidence) {
    evidenceNode.replaceChildren();
    if (!archivedEvidence) return;
    const heading = element('div', 'evidence-heading');
    heading.append(element('h2', null, 'Archived Research Evidence'));
    heading.append(element('p', null, archivedEvidence.notice));
    evidenceNode.append(heading);
    archivedEvidence.groups.forEach((group) => {
      const groupNode = element('section', 'evidence-group');
      groupNode.append(element('h3', null, group.market + ' · ' + group.title));
      const grid = element('div', 'evidence-grid');
      if (group.picks.length === 0) {
        grid.append(element('div', 'empty-state', 'No archived rows in this evidence slice.'));
      } else {
        group.picks.forEach((pick) => grid.append(renderEvidencePick(pick, group, archivedEvidence.capturedAt)));
      }
      groupNode.append(grid);
      evidenceNode.append(groupNode);
    });
  }

  async function loadBoard() {
    if (loadInFlight) return;
    loadInFlight = true;
    refreshButton.disabled = true;
    statusNode.className = 'status';
    statusNode.textContent = 'Refreshing saved board data…';
    try {
      const response = await fetch('/api/hhr-display-board', { cache: 'no-store' });
      if (response.status === 401) {
        window.location.assign('/login');
        return;
      }
      if (!response.ok) throw new Error('Board request failed with status ' + response.status + '.');
      const board = await response.json();
      const freshness = boardFreshness(board.capturedAt);
      capturedAtNode.textContent = displayTime(board.capturedAt);
      freshnessNode.textContent = freshness;
      freshnessNode.className = 'freshness ' + freshness.toLowerCase();
      renderCategories(board.categories || []);
      renderArchivedEvidence(board.archivedEvidence);
      statusNode.textContent = freshness === 'TODAY'
        ? 'Today’s saved board loaded. Ranked picks are UNVALIDATED RESEARCH, not production-calibrated probabilities.'
        : freshness === 'STALE'
          ? 'STALE saved board — this capture is not from today’s America/Chicago slate. Ranked rows remain research evidence only.'
          : 'Saved board loaded, but capture freshness could not be determined. Ranked rows remain research evidence only.';
    } catch (error) {
      statusNode.className = 'status error';
      statusNode.textContent = error instanceof Error ? error.message : 'Unable to load the saved board.';
    } finally {
      loadInFlight = false;
      refreshButton.disabled = false;
    }
  }

  refreshButton.addEventListener('click', () => void loadBoard());
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
  <title>MLB Prop Analyzer · Login</title>
  <link rel="stylesheet" href="/app.css">
</head>
<body>
  <main class="login-shell">
    <form class="login-card" action="/login" method="post">
      <div class="eyebrow">Private pregame dashboard</div>
      <h1>MLB Prop Analyzer</h1>
      <p class="subtle">Enter the dashboard password to continue.</p>
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
      <button type="submit">Open dashboard</button>
      ${error}
    </form>
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
  <title>MLB Prop Analyzer</title>
  <link rel="stylesheet" href="/app.css">
</head>
<body>
  <main class="shell">
    <header class="topbar">
      <div>
        <div class="eyebrow">Underdog MLB · Pregame</div>
        <h1>MLB Prop Analyzer</h1>
        <p class="subtle">Best available research-ranked picks, with the baseball context behind each one.</p>
      </div>
      <aside class="meta-panel" aria-label="Board status">
        <div class="meta-row"><span>Saved capture</span><strong id="captured-at">Loading…</strong></div>
        <div class="meta-row"><span>Slate freshness</span><strong id="capture-freshness" class="freshness unknown">CHECKING</strong></div>
        <div class="controls">
          <button id="refresh-board" type="button">Refresh</button>
          <form class="logout-form" action="/logout" method="post"><button type="submit">Log out</button></form>
        </div>
      </aside>
    </header>

    <div class="research-banner">UNVALIDATED RESEARCH — rankings use the model’s selected-side probabilities, but displayed percentages are not production-calibrated truth claims. Known calibration misses are shown on the cards.</div>
    <div id="status" class="status" role="status">Loading saved board data…</div>
    <nav id="category-tabs" class="category-tabs" role="tablist" aria-label="Prop categories"></nav>
    <div id="category-panels"></div>
    <section id="archived-evidence" class="evidence-shell" aria-label="Archived research evidence"></section>
  </main>
  <script src="/app.js" defer></script>
</body>
</html>`;
}

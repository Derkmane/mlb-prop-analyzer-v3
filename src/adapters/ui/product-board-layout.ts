import {
  HHR_DISPLAY_APP_CSS as BASE_DISPLAY_APP_CSS,
  HHR_DISPLAY_APP_JS as BASE_DISPLAY_APP_JS,
} from './hhr-display-page.js';

const PRODUCT_BOARD_LAYOUT_CSS = `
/* Product-board presentation override: keep all three canonical categories visible
 * and preserve the server ranking as an unambiguous top-to-bottom list. */
#category-tabs { display: none; }
#category-panels { display: grid; gap: 18px; }
.pick-list { grid-template-columns: 1fr !important; counter-reset: product-pick-rank; }
.pick-list > .pick-card { position: relative; padding-top: 42px; counter-increment: product-pick-rank; }
.pick-list > .pick-card::before {
  content: "#" counter(product-pick-rank);
  position: absolute;
  top: 14px;
  left: 15px;
  color: #78b7ff;
  font-size: .78rem;
  font-weight: 900;
  letter-spacing: .05em;
}
.last-five.graph-ready { display: block; }
.last-five-graph {
  border: 1px solid #263c50;
  border-radius: 10px;
  background: #08131d;
  padding: 12px 10px 9px;
}
.last-five-plot { position: relative; height: 116px; }
.last-five-line {
  position: absolute;
  left: 0;
  right: 0;
  z-index: 3;
  border-top: 1px dashed #e7ca8b;
  pointer-events: none;
}
.last-five-line-label {
  position: absolute;
  right: 2px;
  top: -18px;
  padding: 1px 5px;
  border-radius: 5px;
  background: #211a0d;
  color: #e7ca8b;
  font-size: .62rem;
  font-weight: 900;
  letter-spacing: .03em;
}
.last-five-columns {
  position: absolute;
  inset: 0;
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 8px;
  align-items: end;
}
.last-five-column {
  height: 100%;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  min-width: 0;
  padding-top: 18px;
}
.last-five-bar {
  position: relative;
  width: min(44px, 72%);
  min-height: 4px;
  border: 1px solid #3c5267;
  border-radius: 7px 7px 2px 2px;
  background: #203549;
}
.last-five-bar.cash { border-color: #34745f; background: #1d5d4d; }
.last-five-bar.miss { border-color: #74444b; background: #65323a; }
.last-five-bar.void { border-color: #74653d; background: #66582f; }
.last-five-bar-value {
  position: absolute;
  left: 50%;
  top: -18px;
  transform: translateX(-50%);
  color: #e8f0f6;
  font-size: .68rem;
  font-weight: 900;
}
.last-five-labels {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 8px;
  margin-top: 7px;
  text-align: center;
}
.last-five-label { min-width: 0; font-size: .64rem; line-height: 1.25; color: #8fa5b8; }
.last-five-label strong { display: block; color: #d4e1eb; font-size: .66rem; }
.last-five-legend { margin-top: 8px; color: #8196a9; font-size: .63rem; }
@media (max-width: 700px) {
  .last-five-columns, .last-five-labels { gap: 4px; }
  .last-five-graph { padding-left: 6px; padding-right: 6px; }
}
`;

const PRODUCT_BOARD_LAYOUT_JS = `
(() => {
  'use strict';

  const categoryPanelsNode = document.getElementById('category-panels');
  if (!categoryPanelsNode) return;

  const revealEveryCategory = () => {
    for (const panel of categoryPanelsNode.querySelectorAll('[data-category-panel]')) {
      panel.hidden = false;
    }
  };

  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  };

  const compactDate = (value) => {
    const parts = String(value).split('-');
    return parts.length === 3 ? Number(parts[1]) + '/' + Number(parts[2]) : String(value);
  };

  const decorateLastFiveGraph = (lastFive) => {
    if (!(lastFive instanceof HTMLElement) || lastFive.dataset.graphReady === 'true') return;
    const card = lastFive.closest('.pick-card');
    if (!(card instanceof HTMLElement)) return;

    const lineChip = Array.from(card.querySelectorAll('.chip')).find((node) =>
      String(node.textContent || '').startsWith('Line '),
    );
    const currentLine = Number(String(lineChip?.textContent || '').slice(5));
    if (!Number.isFinite(currentLine)) return;

    const results = Array.from(lastFive.querySelectorAll('.game-result')).flatMap((node) => {
      const raw = String(node.textContent || '');
      const pieces = raw.split(' · ');
      const actual = Number(pieces.at(-1));
      const context = pieces.slice(0, -1).join(' · ');
      const versusIndex = context.indexOf(' vs ');
      if (!Number.isFinite(actual) || versusIndex < 0) return [];
      return [{
        actual,
        gameDate: context.slice(0, versusIndex),
        opponent: context.slice(versusIndex + 4),
        outcome: node.classList.contains('cash')
          ? 'cash'
          : node.classList.contains('miss')
            ? 'miss'
            : node.classList.contains('void')
              ? 'void'
              : '',
      }];
    });
    if (results.length === 0) return;

    const maximumActual = Math.max(...results.map((result) => result.actual));
    const plotMaximum = Math.max(1, maximumActual, currentLine + 0.5);
    const graph = make('div', 'last-five-graph');
    const plot = make('div', 'last-five-plot');
    const line = make('div', 'last-five-line');
    line.style.bottom = String((currentLine / plotMaximum) * 100) + '%';
    line.append(make('span', 'last-five-line-label', 'Line ' + currentLine));
    plot.append(line);

    const columns = make('div', 'last-five-columns');
    const labels = make('div', 'last-five-labels');
    results.forEach((result) => {
      const column = make('div', 'last-five-column');
      const bar = make('div', 'last-five-bar' + (result.outcome ? ' ' + result.outcome : ''));
      bar.style.height = String((result.actual / plotMaximum) * 100) + '%';
      bar.append(make('span', 'last-five-bar-value', result.actual));
      bar.title = result.gameDate + ' vs ' + result.opponent + ' · ' + result.actual;
      column.append(bar);
      columns.append(column);

      const label = make('div', 'last-five-label');
      label.append(make('strong', null, compactDate(result.gameDate)));
      label.append(document.createTextNode(result.opponent));
      labels.append(label);
    });
    plot.append(columns);
    graph.append(plot, labels);
    graph.append(make('div', 'last-five-legend', 'Green = cash · Red = miss · Gold = void · dashed line = current prop line'));

    lastFive.dataset.graphReady = 'true';
    lastFive.classList.add('graph-ready');
    lastFive.replaceChildren(graph);
  };

  const decorateLastFiveGraphs = () => {
    for (const lastFive of categoryPanelsNode.querySelectorAll('.last-five')) {
      decorateLastFiveGraph(lastFive);
    }
  };

  const observer = new MutationObserver(() => {
    revealEveryCategory();
    decorateLastFiveGraphs();
  });
  observer.observe(categoryPanelsNode, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['hidden'],
  });
  revealEveryCategory();
  decorateLastFiveGraphs();
})();
`;

export const HHR_DISPLAY_APP_CSS =
  `${BASE_DISPLAY_APP_CSS}\n${PRODUCT_BOARD_LAYOUT_CSS}`;
export const HHR_DISPLAY_APP_JS =
  `${BASE_DISPLAY_APP_JS}\n${PRODUCT_BOARD_LAYOUT_JS}`;

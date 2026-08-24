import {
  HHR_DISPLAY_APP_CSS as PRODUCT_BOARD_CSS,
  HHR_DISPLAY_APP_JS as PRODUCT_BOARD_JS,
} from './product-board-layout.js';

const TOP_FIVE_RESEARCH_CSS = `
.category-panel { counter-reset: product-pick-rank; }
.category-panel .pick-list { counter-reset: none !important; }
.top-five-research-shell,
.additional-picks-shell {
  margin: 12px;
  border: 1px solid #2b4359;
  border-radius: 13px;
  overflow: hidden;
  background: #08131d;
}
.top-five-research-shell {
  border-color: #6f5e32;
  background: #151208;
}
.research-tool-heading {
  padding: 14px 16px;
  border-bottom: 1px solid #263c50;
}
.top-five-research-shell .research-tool-heading { border-bottom-color: #514322; }
.research-tool-heading h3 { margin: 0; font-size: 1rem; }
.research-tool-heading p {
  margin: 5px 0 0;
  color: #91a6b7;
  font-size: .78rem;
  line-height: 1.4;
}
.top-five-research-shell .research-tool-heading h3 { color: #f1d494; }
.top-five-research-shell .research-tool-heading p { color: #c9b887; }
.top-five-research-list,
.additional-picks-list { padding: 12px; }
.additional-picks-list .pick-card { padding-bottom: 13px; }
@media (max-width: 700px) {
  .top-five-research-shell,
  .additional-picks-shell { margin: 8px; }
}
`;

const TOP_FIVE_RESEARCH_JS = `
(() => {
  'use strict';

  const categoryPanelsNode = document.getElementById('category-panels');
  if (!categoryPanelsNode) return;

  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  };

  const decoratePanel = (panel) => {
    if (!(panel instanceof HTMLElement)) return;
    if (panel.dataset.topFiveResearchReady === 'true') return;

    const subtitle = panel.querySelector('.category-heading p');
    if (subtitle instanceof HTMLElement) {
      subtitle.textContent = 'Eligible picks above 50% · up to 20 · every eligible pick receives full research analysis. Top Five is a highlighted subset only.';
    }

    const pickList = panel.querySelector('.pick-list');
    if (!(pickList instanceof HTMLElement)) {
      panel.dataset.topFiveResearchReady = 'true';
      return;
    }

    const cards = Array.from(pickList.children).filter(
      (node) => node instanceof HTMLElement && node.classList.contains('pick-card'),
    );
    if (cards.length === 0) {
      panel.dataset.topFiveResearchReady = 'true';
      return;
    }

    const researchShell = make('section', 'top-five-research-shell');
    const researchHeading = make('div', 'research-tool-heading');
    researchHeading.append(make('h3', null, 'Top Five Research Highlight'));
    researchHeading.append(
      make(
        'p',
        null,
        'First five already-ranked eligible picks, highlighted for quick review. Every eligible pick receives the same full research analysis. This highlight does not change probability, eligibility, order, or category size.',
      ),
    );
    const researchList = make('div', 'pick-list top-five-research-list');
    cards.slice(0, 5).forEach((card) => researchList.append(card));
    researchShell.append(researchHeading, researchList);

    const additionalCards = cards.slice(5);
    pickList.replaceWith(researchShell);

    if (additionalCards.length > 0) {
      const additionalShell = make('section', 'additional-picks-shell');
      const additionalHeading = make('div', 'research-tool-heading');
      additionalHeading.append(make('h3', null, 'Additional Researched Picks'));
      additionalHeading.append(
        make(
          'p',
          null,
          'Every additional qualifying pick receives the same full research analysis and remains in the unchanged server ranking.',
        ),
      );
      const additionalList = make('div', 'pick-list additional-picks-list');
      additionalCards.forEach((card) => additionalList.append(card));
      additionalShell.append(additionalHeading, additionalList);
      researchShell.after(additionalShell);
    }

    panel.dataset.topFiveResearchReady = 'true';
  };

  const decorateAll = () => {
    for (const panel of categoryPanelsNode.querySelectorAll('[data-category-panel]')) {
      decoratePanel(panel);
    }
  };

  const observer = new MutationObserver(() => decorateAll());
  observer.observe(categoryPanelsNode, { childList: true, subtree: true });
  decorateAll();
})();
`;

export const LIVE_DISPLAY_APP_CSS =
  `${PRODUCT_BOARD_CSS}\n${TOP_FIVE_RESEARCH_CSS}`;
export const LIVE_DISPLAY_APP_JS =
  `${PRODUCT_BOARD_JS}\n${TOP_FIVE_RESEARCH_JS}`;

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

  const observer = new MutationObserver(revealEveryCategory);
  observer.observe(categoryPanelsNode, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['hidden'],
  });
  revealEveryCategory();
})();
`;

export const HHR_DISPLAY_APP_CSS =
  `${BASE_DISPLAY_APP_CSS}\n${PRODUCT_BOARD_LAYOUT_CSS}`;
export const HHR_DISPLAY_APP_JS =
  `${BASE_DISPLAY_APP_JS}\n${PRODUCT_BOARD_LAYOUT_JS}`;

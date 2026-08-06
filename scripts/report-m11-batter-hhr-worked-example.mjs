import { readFile } from 'node:fs/promises';

import {
  buildBatterHhrDirectCompositeDistribution,
  settleBatterHhrDistribution,
} from '../dist/src/features/batter-hhr/index.js';

const artifact = JSON.parse(
  await readFile(
    new URL('../model-artifacts/m11-batter-hhr-direct-composite-v1.json', import.meta.url),
    'utf8',
  ),
);

const terminalOutcomeCategories = [
  'K',
  'UBB',
  'IBB',
  'HBP',
  '1B',
  '2B',
  '3B',
  'HR',
  'ROE',
  'FC',
  'SF',
  'SH',
  'BIP_OUT',
  'CATCHER_INTERFERENCE',
];
const contextAdjustedTerminalOutcomeVector = {
  K: 0.2,
  UBB: 0.08,
  IBB: 0.01,
  HBP: 0.02,
  '1B': 0.14,
  '2B': 0.05,
  '3B': 0.01,
  HR: 0.04,
  ROE: 0.02,
  FC: 0.03,
  SF: 0.03,
  SH: 0.01,
  BIP_OUT: 0.36,
  CATCHER_INTERFERENCE: 0,
};

const distribution = buildBatterHhrDirectCompositeDistribution(artifact, {
  contextAdjustedTerminalOutcomeVector,
  terminalOutcomeCategories,
  expectedPlateAppearances: 4.4,
  lineupSlot: 2,
});
const exactMasses = distribution.statisticDistribution.probabilities;
const displayed = Object.fromEntries(
  Array.from({ length: 9 }, (_, value) => [
    String(value),
    exactMasses[value],
  ]),
);
const tailNinePlus = exactMasses
  .slice(9)
  .reduce((sum, mass) => sum + mass, 0);
const ladder = [0.5, 1.5, 2.5, 3.5].map((line) => ({
  line,
  higher: settleBatterHhrDistribution(distribution, 'higher', line, 1),
  lower: settleBatterHhrDistribution(distribution, 'lower', line, 1),
}));

console.log('=== M11 BATTER HHR WORKED EXAMPLE ===');
console.log(`MODEL VERSION: ${distribution.modelVersion}`);
console.log(`MATHEMATICAL FAMILY: ${distribution.mathematicalFamily}`);
console.log(`MEAN T: ${distribution.mean}`);
console.log(`DISPERSION ALPHA: ${distribution.dispersionAlpha}`);
console.log(`P(T=0..8): ${JSON.stringify(displayed)}`);
console.log(`P(T>=9): ${tailNinePlus}`);
console.log(`SETTLEMENT LADDER: ${JSON.stringify(ladder)}`);
console.log('SAME DISTRIBUTION FOR ALL LINES: true');
console.log('INDEPENDENT MARGINAL CONVOLUTION: false');
console.log('TRIPLE JOINT FORMED: false');
console.log('PRODUCTION ENABLED: false');
console.log('=== END M11 BATTER HHR WORKED EXAMPLE ===');

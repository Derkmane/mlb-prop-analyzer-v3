import fs from 'node:fs';

function replaceOnce(text, oldText, newText, label) {
  const count = text.split(oldText).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one match, found ${count}`);
  return text.replace(oldText, newText);
}

function update(path, transform) {
  const before = fs.readFileSync(path, 'utf8');
  const after = transform(before);
  if (after === before) throw new Error(`${path}: no change produced`);
  fs.writeFileSync(path, after);
}

update('docs/modeling/m8-merge-status-v1.md', (source) => {
  source = replaceOnce(
    source,
    `- Preserved one shared game scenario set for lineup, home/away state, offensive environment, opposing starter, bullpen transition, and team batters faced.`,
    `- Preserved one shared game scenario set for lineup, home/away state, offensive environment, opposing starter, bullpen transition, and team batters faced.\n- Built and validated the shared starter-to-bullpen transition distribution from current-season terminal PA order while conserving starter plus bullpen batters faced to total team batters faced.\n- Under \`CANONICAL_MATH_SPEC.md\` Version 1.5, the fixed-validation nondominated set was \`starter-bf-side-pool-500\`, \`starter-bf-side-pool-1000\`, and \`starter-bf-league\`; the walk-forward nondominated set was only \`starter-bf-side-pool-1000\`; the stable intersection therefore selected \`starter-bf-side-pool-1000\`.\n- The fixed-validation candidate log-loss range was \`2.8480057054840135\` through \`2.850462309846479\`, a span of \`0.0024566043624656095\`. The league limit remained on the fixed-validation frontier because its Brier score \`0.9266005135161092\` was lower than the finite \`500\` and \`1000\` candidates despite its worse log loss. This is selection evidence only; it does not establish a nonzero home/away effect or the downstream ranking impact of the component.`,
    'merge-status starter-bullpen evidence',
  );
  source = replaceOnce(
    source,
    `- Enforced that untouched-test rows cannot enter fitting or candidate selection.`,
    `- Enforced that untouched-test rows cannot enter fitting or candidate selection.\n- Starter-bullpen selection passed 9 focused tests, the real-data shared-environment gate selected \`starter-bf-side-pool-1000\`, the complete \`npm run verify\` gate passed 329 of 329 tests, and GitHub Actions verify run 396 passed on commit \`6af41c3\`.`,
    'merge-status verification evidence',
  );
  return source;
});

update('PROJECT_CHECKLIST.md', (source) => {
  source = replaceOnce(source, '**Version:** 2.0', '**Version:** 2.1', 'checklist version');
  source = replaceOnce(
    source,
    '- [ ] Bullpen transition scenarios.',
    '- [x] Bullpen transition scenarios — selected `starter-bf-side-pool-1000` from the intersection of the fixed-validation and expanding walk-forward proper-score nondominated sets under `CANONICAL_MATH_SPEC.md` Version 1.5; 9 focused tests, the real-data shared-environment gate, the complete 329-test verification gate, and GitHub Actions verify run 396 passed while production remained disabled and untouched-test rows remained sealed.',
    'checklist bullpen transition item',
  );
  source = replaceOnce(
    source,
    '## Changelog\n\n### Version 2.0 — 2026-07-29',
    `## Changelog\n\n### Version 2.1 — 2026-07-29\n\n- Closed the M8 bullpen-transition-scenarios item after the Version 1.5 proper-score nondominated-intersection rule selected \`starter-bf-side-pool-1000\`.\n- Recorded the fixed nondominated set \`{side-pool-500, side-pool-1000, league}\`, the walk-forward nondominated set \`{side-pool-1000}\`, and the single-candidate stable intersection.\n- Recorded 9 focused passing tests, the passing real-data shared-environment gate, the complete 329-of-329 verification gate, and passing GitHub Actions verify run 396.\n- Preserved production-disabled status and the sealed untouched-test period; no real prop was enabled.\n\n### Version 2.0 — 2026-07-29`,
    'checklist changelog',
  );
  return source;
});

fs.unlinkSync(new URL(import.meta.url));
console.log('Applied M8 starter-bullpen evidence sync and removed the temporary script.');

from pathlib import Path

path = Path('test/m9-batter-hits-projected-lineup-equivalence.test.ts')
text = path.read_text()
old = """  const confirmed = await connectM8BatterHitsBaseDistribution({
    pregameBoard: board,
    offer,
    observation: observationFor(offer, 'confirmed'),
    evaluatedAt: SOURCE_CAPTURED_AT,
  });

  assert.deepEqual(projected.dBase, confirmed.dBase);
  assert.equal(projected.baseballInputs.lineupStatus, 'projected');
  assert.equal(confirmed.baseballInputs.lineupStatus, 'confirmed');
  assert.equal(projected.sharedScenarioIdentity, confirmed.sharedScenarioIdentity);
"""
new = """  const confirmed = await connectM8BatterHitsBaseDistribution({
    pregameBoard: board,
    offer,
    observation: observationFor(offer, 'confirmed'),
    evaluatedAt: SOURCE_CAPTURED_AT,
  });
  const confirmedAgain = await connectM8BatterHitsBaseDistribution({
    pregameBoard: board,
    offer,
    observation: observationFor(offer, 'confirmed'),
    evaluatedAt: SOURCE_CAPTURED_AT,
  });

  assert.deepEqual(projected.dBase, confirmed.dBase);
  assert.equal(projected.baseballInputs.lineupStatus, 'projected');
  assert.equal(confirmed.baseballInputs.lineupStatus, 'confirmed');
  assert.equal(projected.sharedScenarioIdentity, confirmed.sharedScenarioIdentity);
  assert.deepEqual(confirmedAgain, confirmed);
  assert.equal(
    confirmedAgain.baseDistributionSha256,
    confirmed.baseDistributionSha256,
  );
  assert.match(confirmed.baseDistributionSha256, /^[a-f0-9]{64}$/u);
"""
if text.count(old) != 1:
    raise SystemExit(f'Expected one determinism insertion point, found {text.count(old)}')
path.write_text(text.replace(old, new))

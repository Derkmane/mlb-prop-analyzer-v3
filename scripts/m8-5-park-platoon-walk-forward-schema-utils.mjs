import { createHash } from 'node:crypto';

function assertPlainObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function assertSha256(value, label) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 string.`);
  }
  return value;
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} must equal ${String(expected)}.`);
  }
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

function parseJson(text, label) {
  if (typeof text !== 'string' || text.length === 0) {
    throw new TypeError(`${label} must be non-empty text.`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

export function verifyAndAdaptFrozenPlatoonWalkForwardArtifact(rawInput) {
  const input = assertPlainObject(rawInput, 'platoon walk-forward lineage input');
  const expectedKeys = [
    'artifact',
    'artifactText',
    'platoonBoundary',
    'platoonBoundaryText',
    'terminalPaOutcome',
    'terminalPaOutcomeText',
  ];
  if (
    JSON.stringify(Object.keys(input).sort()) !==
    JSON.stringify([...expectedKeys].sort())
  ) {
    throw new Error('platoon walk-forward lineage input contains missing or unsupported fields.');
  }

  const artifact = assertPlainObject(
    input.artifact,
    'frozen platoon walk-forward artifact',
  );
  const boundary = assertPlainObject(
    input.platoonBoundary,
    'frozen platoon boundary artifact',
  );
  const terminalPaOutcome = assertPlainObject(
    input.terminalPaOutcome,
    'frozen terminal PA outcome artifact',
  );
  const parsedArtifact = parseJson(
    input.artifactText,
    'frozen platoon walk-forward artifact text',
  );
  const parsedBoundary = parseJson(
    input.platoonBoundaryText,
    'frozen platoon boundary artifact text',
  );
  const parsedTerminalPaOutcome = parseJson(
    input.terminalPaOutcomeText,
    'frozen terminal PA outcome artifact text',
  );
  if (JSON.stringify(parsedArtifact) !== JSON.stringify(artifact)) {
    throw new Error('platoon walk-forward artifact text does not match its parsed value.');
  }
  if (JSON.stringify(parsedBoundary) !== JSON.stringify(boundary)) {
    throw new Error('platoon boundary artifact text does not match its parsed value.');
  }
  if (
    JSON.stringify(parsedTerminalPaOutcome) !==
    JSON.stringify(terminalPaOutcome)
  ) {
    throw new Error('terminal PA outcome artifact text does not match its parsed value.');
  }
  if (artifact.platoonWalkForwardVersion !== 1) {
    throw new Error('frozen platoon walk-forward version must equal 1.');
  }
  if (
    terminalPaOutcome.artifactVersion !== 1 ||
    terminalPaOutcome.modelVersion !== 'm8-terminal-pa-outcome-v1' ||
    terminalPaOutcome.productionEnabled !== false
  ) {
    throw new Error(
      'frozen terminal PA outcome artifact must be production-disabled m8-terminal-pa-outcome-v1.',
    );
  }

  const canonicalIdentity = assertSha256(
    artifact.platoonWalkForwardSha256,
    'frozen platoon walk-forward identity',
  );
  const coherentSourceIdentity = assertSha256(
    artifact.sourceCoherentWalkForwardSha256,
    'platoon walk-forward coherent source identity',
  );
  assertEqual(
    coherentSourceIdentity,
    assertSha256(
      boundary.sourceWalkForwardSha256,
      'platoon boundary coherent walk-forward identity',
    ),
    'platoon walk-forward coherent source identity',
  );
  assertEqual(
    assertSha256(
      artifact.sourceCoherentWalkForwardFileSha256,
      'platoon walk-forward coherent source file identity',
    ),
    assertSha256(
      boundary.sourceWalkForwardFileSha256,
      'platoon boundary coherent walk-forward file identity',
    ),
    'platoon walk-forward coherent source file identity',
  );

  const boundaryIdentity = assertSha256(
    boundary.platoonEvaluationSha256,
    'platoon boundary identity',
  );
  assertEqual(
    assertSha256(
      artifact.sourcePlatoonBoundarySha256,
      'platoon walk-forward boundary source identity',
    ),
    boundaryIdentity,
    'platoon walk-forward boundary source identity',
  );
  assertEqual(
    assertSha256(
      terminalPaOutcome.sourcePlatoonEvaluationSha256,
      'terminal PA outcome boundary source identity',
    ),
    boundaryIdentity,
    'terminal PA outcome boundary source identity',
  );

  const historicalBoundaryFileIdentity = assertSha256(
    artifact.sourcePlatoonBoundaryFileSha256,
    'historical platoon walk-forward boundary source file identity',
  );
  const currentBoundaryFileIdentity = sha256(input.platoonBoundaryText);
  assertEqual(
    assertSha256(
      terminalPaOutcome.sourcePlatoonEvaluationFileSha256,
      'terminal PA outcome boundary source file identity',
    ),
    currentBoundaryFileIdentity,
    'terminal PA outcome boundary source file identity',
  );

  if (
    Object.hasOwn(artifact, 'walkForwardSha256') &&
    artifact.walkForwardSha256 !== coherentSourceIdentity
  ) {
    throw new Error(
      'legacy walk-forward identity alias conflicts with the coherent walk-forward source identity.',
    );
  }

  const sourceJson = JSON.stringify(artifact);
  const adapted = Object.create(
    Object.getPrototypeOf(artifact),
    Object.getOwnPropertyDescriptors(artifact),
  );
  Object.defineProperty(adapted, 'walkForwardSha256', {
    value: coherentSourceIdentity,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  Object.freeze(adapted);

  if (JSON.stringify(adapted) !== sourceJson) {
    throw new Error('platoon walk-forward lineage adaptation changed serialized evidence.');
  }
  return Object.freeze({
    adaptedArtifact: adapted,
    canonicalIdentity,
    coherentSourceIdentity,
    boundaryIdentity,
    historicalBoundaryFileIdentity,
    currentBoundaryFileIdentity,
  });
}

export function finalizeM8_5ParkFrozenBaseParity(rawInput) {
  const input = assertPlainObject(rawInput, 'park frozen-base parity finalization input');
  const parity = assertPlainObject(input.parity, 'park frozen-base parity');
  const canonicalIdentity = assertSha256(
    input.canonicalPlatoonWalkForwardSha256,
    'canonical platoon walk-forward identity',
  );
  const currentSourceIdentity = assertSha256(
    parity.sourcePlatoonWalkForwardSha256,
    'temporary platoon walk-forward source identity',
  );
  if (currentSourceIdentity === canonicalIdentity) {
    throw new Error(
      'coherent source identity and derived platoon walk-forward identity must remain distinct.',
    );
  }
  if (!Array.isArray(parity.predictions)) {
    throw new Error('park frozen-base parity predictions must be an array.');
  }

  const {
    paritySha256: ignoredParitySha256,
    predictions,
    ...temporaryIdentity
  } = parity;
  void ignoredParitySha256;
  const identity = {
    ...temporaryIdentity,
    sourcePlatoonWalkForwardSha256: canonicalIdentity,
  };
  return Object.freeze({
    ...identity,
    paritySha256: sha256(JSON.stringify(identity)),
    predictions,
  });
}

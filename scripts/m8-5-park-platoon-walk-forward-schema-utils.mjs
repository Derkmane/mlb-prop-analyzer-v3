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

export function adaptFrozenPlatoonWalkForwardArtifact(rawArtifact) {
  const artifact = assertPlainObject(
    rawArtifact,
    'frozen platoon walk-forward artifact',
  );
  if (artifact.platoonWalkForwardVersion !== 1) {
    throw new Error('frozen platoon walk-forward version must equal 1.');
  }
  const canonicalIdentity = assertSha256(
    artifact.platoonWalkForwardSha256,
    'frozen platoon walk-forward identity',
  );
  if (
    Object.hasOwn(artifact, 'walkForwardSha256') &&
    artifact.walkForwardSha256 !== canonicalIdentity
  ) {
    throw new Error('legacy walk-forward identity alias conflicts with the canonical platoon identity.');
  }

  const sourceJson = JSON.stringify(artifact);
  const adapted = Object.create(
    Object.getPrototypeOf(artifact),
    Object.getOwnPropertyDescriptors(artifact),
  );
  Object.defineProperty(adapted, 'walkForwardSha256', {
    value: canonicalIdentity,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  Object.freeze(adapted);

  if (JSON.stringify(adapted) !== sourceJson) {
    throw new Error('platoon walk-forward schema adaptation changed serialized evidence.');
  }
  return adapted;
}

function assertObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function assertFiniteNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number.`);
  }
  return value;
}

export function selectUniqueArtifactCopy(rawItems, { label, identityField }) {
  const itemLabel = assertNonEmptyString(label, 'label');
  const field = assertNonEmptyString(identityField, 'identityField');
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new Error(`No ${itemLabel} artifacts were found.`);
  }

  const groups = new Map();
  for (const [index, rawItem] of rawItems.entries()) {
    const item = assertObject(rawItem, `${itemLabel}[${index}]`);
    const value = assertObject(item.value, `${itemLabel}[${index}].value`);
    const identity = assertNonEmptyString(
      value[field],
      `${itemLabel}[${index}].${field}`,
    );
    const group = groups.get(identity) ?? [];
    group.push(item);
    groups.set(identity, group);
  }

  if (groups.size !== 1) {
    throw new Error(`Expected exactly one ${itemLabel} identity; found ${groups.size}.`);
  }

  const [duplicates] = groups.values();
  return duplicates
    .slice()
    .sort((left, right) => String(left.path).localeCompare(String(right.path)))[0];
}

function identityFor(match, index) {
  const pair = assertObject(match, `matches[${index}]`);
  const dataset = assertObject(pair.dataset, `matches[${index}].dataset`);
  const evaluation = assertObject(pair.evaluation, `matches[${index}].evaluation`);
  const datasetValue = assertObject(dataset.value, `matches[${index}].dataset.value`);
  const evaluationValue = assertObject(
    evaluation.value,
    `matches[${index}].evaluation.value`,
  );
  const selectedCandidateId = assertNonEmptyString(
    evaluationValue.selection?.selectedCandidate?.candidateId,
    `matches[${index}].evaluation.selectedCandidateId`,
  );
  const selectedResult = Array.isArray(evaluationValue.results)
    ? evaluationValue.results.find(
        (result) => result?.candidate?.candidateId === selectedCandidateId,
      )
    : null;
  return {
    datasetSha256: assertNonEmptyString(
      datasetValue.datasetSha256,
      `matches[${index}].dataset.datasetSha256`,
    ),
    validationObservationIdsSha256: assertNonEmptyString(
      evaluationValue.cohorts?.validationObservationIdsSha256,
      `matches[${index}].evaluation.validationObservationIdsSha256`,
    ),
    evaluationSha256: assertNonEmptyString(
      evaluationValue.platoonEvaluationSha256,
      `matches[${index}].evaluation.platoonEvaluationSha256`,
    ),
    selectedCandidateId,
    validationCategoricalLogLoss: assertFiniteNumber(
      evaluationValue.selection?.validationCategoricalLogLoss ??
        selectedResult?.validationCategoricalLogLoss,
      `matches[${index}].evaluation.validationCategoricalLogLoss`,
    ),
  };
}

export function selectBestArtifactPair(rawMatches) {
  if (!Array.isArray(rawMatches) || rawMatches.length === 0) {
    throw new Error('No boundary-approved artifact pairs were found.');
  }

  const described = rawMatches.map((match, index) => ({
    match,
    identity: identityFor(match, index),
  }));
  if (new Set(described.map(({ identity }) => identity.datasetSha256)).size !== 1) {
    throw new Error('Boundary evaluations do not share one dataset.');
  }
  if (
    new Set(
      described.map(({ identity }) => identity.validationObservationIdsSha256),
    ).size !== 1
  ) {
    throw new Error('Boundary evaluations do not share one validation cohort.');
  }

  described.sort((left, right) => {
    const lossDifference =
      left.identity.validationCategoricalLogLoss -
      right.identity.validationCategoricalLogLoss;
    if (lossDifference !== 0) return lossDifference;
    return String(left.match.evaluation.path).localeCompare(
      String(right.match.evaluation.path),
    );
  });

  const selected = described[0];
  return Object.freeze({
    selectedMatch: selected.match,
    selectedIdentity: Object.freeze({ ...selected.identity }),
    staleEvaluationPaths: Object.freeze([
      ...new Set(
        described.slice(1).map(({ match }) => String(match.evaluation.path)),
      ),
    ]),
    compared: Object.freeze(
      described.map(({ match, identity }) =>
        Object.freeze({
          path: String(match.evaluation.path),
          selectedCandidateId: identity.selectedCandidateId,
          validationCategoricalLogLoss:
            identity.validationCategoricalLogLoss,
          evaluationSha256: identity.evaluationSha256,
        }),
      ),
    ),
  });
}

export function selectUniqueArtifactPair(rawMatches) {
  return selectBestArtifactPair(rawMatches).selectedMatch;
}

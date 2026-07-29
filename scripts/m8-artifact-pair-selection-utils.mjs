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
  return {
    datasetSha256: assertNonEmptyString(
      datasetValue.datasetSha256,
      `matches[${index}].dataset.datasetSha256`,
    ),
    evaluationSha256: assertNonEmptyString(
      evaluationValue.platoonEvaluationSha256,
      `matches[${index}].evaluation.platoonEvaluationSha256`,
    ),
    selectedCandidateId: assertNonEmptyString(
      evaluationValue.selection?.selectedCandidate?.candidateId,
      `matches[${index}].evaluation.selectedCandidateId`,
    ),
  };
}

export function selectUniqueArtifactPair(rawMatches) {
  if (!Array.isArray(rawMatches) || rawMatches.length === 0) {
    throw new Error('No boundary-approved artifact pairs were found.');
  }

  const groups = new Map();
  for (const [index, match] of rawMatches.entries()) {
    const identity = identityFor(match, index);
    const key = JSON.stringify(identity);
    const group = groups.get(key) ?? [];
    group.push(match);
    groups.set(key, group);
  }

  if (groups.size !== 1) {
    throw new Error(
      `Expected exactly one boundary-approved model identity; found ${groups.size}.`,
    );
  }

  const [duplicates] = groups.values();
  return duplicates
    .slice()
    .sort(
      (left, right) =>
        String(left.evaluation.path).localeCompare(String(right.evaluation.path)) ||
        String(left.dataset.path).localeCompare(String(right.dataset.path)),
    )[0];
}

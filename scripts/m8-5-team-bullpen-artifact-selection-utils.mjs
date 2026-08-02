import { selectUniqueArtifactCopy } from './m8-artifact-pair-selection-utils.mjs';
import { buildM8StarterBullpenDataset } from './m8-starter-bullpen-transition-utils.mjs';

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function assertArray(value, label) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array.`);
  }
  return value;
}

function pathFor(item, index, label) {
  return typeof item?.path === 'string' && item.path.length > 0
    ? item.path
    : `${label}[${index}]`;
}

export function selectM8_5TeamBullpenArtifactPair({
  resolvedCandidates,
  environmentCandidates,
  frozenStarterBullpenDatasetSha256,
}) {
  const resolvedItems = assertArray(
    resolvedCandidates,
    'resolvedCandidates',
  );
  const environmentItems = assertArray(
    environmentCandidates,
    'environmentCandidates',
  );
  const frozenDatasetSha256 = assertNonEmptyString(
    frozenStarterBullpenDatasetSha256,
    'frozenStarterBullpenDatasetSha256',
  );

  const lineageMatches = [];
  const rejectedResolvedPaths = [];
  for (const [index, item] of resolvedItems.entries()) {
    try {
      const rebuilt = buildM8StarterBullpenDataset(item?.value);
      if (rebuilt.datasetSha256 === frozenDatasetSha256) {
        lineageMatches.push(item);
      }
    } catch {
      rejectedResolvedPaths.push(
        pathFor(item, index, 'resolvedCandidates'),
      );
    }
  }

  const resolved = selectUniqueArtifactCopy(lineageMatches, {
    label:
      'resolved categorical dataset matching the frozen starter-bullpen dataset lineage',
    identityField: 'datasetSha256',
  });
  const matchingEnvironments = environmentItems.filter(
    (item) =>
      item?.value?.sourceResolvedDatasetSha256 ===
      resolved.value.datasetSha256,
  );
  const teamEnvironment = selectUniqueArtifactCopy(matchingEnvironments, {
    label:
      'team offensive-environment dataset matching the frozen-lineage resolved dataset',
    identityField: 'datasetSha256',
  });

  return Object.freeze({
    resolved,
    teamEnvironment,
    resolvedCandidateCount: resolvedItems.length,
    frozenLineageCopyCount: lineageMatches.length,
    matchingEnvironmentCopyCount: matchingEnvironments.length,
    rejectedResolvedPaths: Object.freeze(
      rejectedResolvedPaths.slice().sort(),
    ),
  });
}

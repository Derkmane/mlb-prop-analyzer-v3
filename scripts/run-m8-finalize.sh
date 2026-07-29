#!/usr/bin/env bash
set -euo pipefail

branch="agent/m8-recency-weighting"

git pull --ff-only origin "$branch"
npm run build

node scripts/run-m8-terminal-pa-outcome-gate.mjs
node scripts/run-m8-shared-offensive-environment-v2-gate.mjs
node scripts/run-m8-batter-hits-freeze-gate.mjs

git add \
  model-artifacts/m8-terminal-pa-outcome-v1.json \
  model-artifacts/m8-shared-offensive-environment-v2.json \
  model-artifacts/m8-batter-hits-complete-candidate-v1.json
if ! git diff --cached --quiet; then
  git commit -m "Freeze complete M8 Batter Hits candidate"
fi
git push origin "$branch"

npm run build
set +e
node scripts/run-m8-batter-hits-untouched-test-safe.mjs
status=$?
set -e

if [[ -f model-artifacts/m8-batter-hits-untouched-test-v1.json ]]; then
  git add model-artifacts/m8-batter-hits-untouched-test-v1.json
  if ! git diff --cached --quiet; then
    git commit -m "Record M8 untouched Batter Hits test"
  fi
  git push origin "$branch"
fi

exit "$status"

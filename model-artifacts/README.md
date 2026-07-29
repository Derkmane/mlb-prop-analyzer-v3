# Frozen model artifacts

This directory contains reviewed, versioned runtime model artifacts generated from approved current-season evidence.

Rules:

- fitting and evaluation code remains under `scripts/`
- runtime code may read frozen JSON artifacts from this directory but may not import fitting code
- every artifact must preserve source hashes, model version, fitting and validation windows, untouched-test status, and `productionEnabled`
- an artifact with `productionEnabled: false` cannot authorize a real prediction or ranking
- generated scratch datasets and intermediate evaluations remain outside this directory

The first planned artifact is `m8-starter-retention-v1.json`. It must remain production-disabled until its one-time untouched-test gate passes.

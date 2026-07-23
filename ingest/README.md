# Minimal Feature proposal ingest

The ingest command validates one explicit Feature proposal against the current
tree and prints a unified dry-run diff. It does not classify a proposal with a
model, derive parentage, create component nodes, or write formal data by
default.

```bash
python3 -m ingest.feature_proposal \
  --data data/features.yaml \
  --proposal ingest/examples/feature-proposal.yaml
```

Only an explicit `--apply` atomically replaces the data file after appending
exactly one Feature:

```bash
python3 -m ingest.feature_proposal \
  --data data/features.yaml \
  --proposal path/to/proposal.yaml \
  --apply
```

The accepted proposal is a Feature mapping (or `{feature: ...}` wrapper) with:

- stable lowercase `feat-*` ID and an existing single `parent_id`;
- `kind: feature` and a lifecycle status declared in `Project.md`;
- explicit summary, hypothesis, design, and parent-relative delta;
- structured implementation and evidence lists;
- auxiliary Feature references that do not affect structural parentage; and
- canonical per-field provenance with named `sources` and a complete `fields`
  mapping.

Each non-empty delta operation must retain `target`, `before`, `after`,
`rationale`, and an `evidence_ids` list. Proposed work may have empty
implementation/evidence lists;
validating, analyzed, and abandoned work must retain evidence.

The repository's `schema/feature-tree.schema.json` is applied to the complete
post-append document before a diff is accepted or a write occurs.

## Concept OLMo candidate bundle

The evidence-backed multi-Feature candidate is generated and validated without
using the single-Feature apply path:

```bash
python3 -m ingest.build_concept_olmo_proposals
python3 -m ingest.validate_concept_proposals
```

The output is `ingest/proposals/concept-olmo-feature-tree.json`. It contains
candidate Feature records plus boundary-confidence and commit-classification
metadata. Validation temporarily combines only those Feature records with the
canonical root; it never applies them to `data/feature-tree.json`.

## template-test view overlay

`scripts/build_template_test_overlay.py` reads the explicitly configured public
Issue/PR pairs in `ingest/template-test-overlay.config.json`, extracts display
metadata, model configuration, implementation files and W&B summary metrics,
then writes a sanitized view-only overlay:

```bash
python3 scripts/build_template_test_overlay.py
```

The adapter never stores the raw Issue/PR body. W&B query strings and credential
material are removed before JSON is written. `--fallback-existing` keeps the
last checked-in safe snapshot when GitHub is temporarily unavailable.

The Pages workflow refreshes this overlay hourly. External display fields may
replace mapped local display fields, while local Feature identity, structural
parentage and relations remain canonical. Details expose both identities and
the temporary equivalence assumption.

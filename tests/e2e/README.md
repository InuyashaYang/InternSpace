# IS-S01 / IS-S02 contract tests

Run source, schema, tree, and ingest contracts:

```bash
pytest -q tests/e2e/test_contract.py
```

Run the independent browser contract against formal `data/feature-tree.json`:

```bash
web/node_modules/.bin/playwright test --config tests/e2e/playwright.config.mjs
```

The browser suite uses the repository's installed Playwright package and
system Chromium, starts the existing read-only local server, stores all test
artifacts under `/tmp`, and never routes a success fixture over the formal data.

Run the commit-pinned Concept OLMo source and proposal contracts with:

```bash
pytest -q tests/e2e/test_concept_olmo_proposals.py
python3 -m ingest.validate_concept_proposals
```

The validator combines only the canonical root with the candidate Features in
memory. It never applies the proposal to `data/feature-tree.json`.

# MapThis release workflow

Every product change moves through these gates:

`Manager → Designer → Builder → Tester → Documentation → User approval → Merge`

The canonical requirements live in [`AGENTS.md`](../AGENTS.md). This document is
the operating checklist.

## Start a feature

```bash
git status --short --branch
git fetch thauu
git switch main
git pull --ff-only thauu main
git remote get-url thauu
git rev-parse HEAD
git switch -c codex/<short-feature-name>
mkdir -p docs/features/<short-feature-name>
cp docs/features/TEMPLATE.md docs/features/<short-feature-name>/release.md
```

The Manager runs these commands, records the remote and baseline SHA in the
feature release file, and commits that initial context before Design or Build.
Do not continue if the tree contains unexplained changes. The local `main` must
match the freshly fetched `thauu/main` before using the diff command below.

## Automated quality gate

Run from the repository root:

```bash
git diff --check thauu/main...HEAD
node --test test/*.test.mjs
node --check webui/app.js
node --check webui/project-state.js
node --check webui/map-geometry.js
node --check netlify/functions/search.mjs
node --check netlify/functions/map-data.mjs
```

GitHub runs the equivalent base-aware gate for pushes and pull requests targeting
`main`.

## Production-shaped testing

When a change touches search, map data, environment variables, redirects, or
Netlify Functions:

```bash
npx netlify dev
```

Use the URL printed by Netlify. Verify at least one search request and one map-data
request through `/api/*`; do not call provider APIs directly from browser code.

## Browser matrix

- Desktop: 1440×900
- Mobile: 390×844
- Large mobile: 430×932
- Narrow safety check: 320px wide
- One tablet-sized viewport when layout is affected

For creation-flow changes, verify search, result disambiguation, map generation,
styles, detail, extent, framing, Exact Spot, phone/desktop/print previews, and all
applicable PNG/JPEG downloads. Inspect downloaded dimensions, fonts, framing,
inscription, and OpenStreetMap attribution.

Use public, synthetic test places only. Never put a user-provided exact location,
inscription, search history, or generated image into committed screenshots,
fixtures, logs, URLs, or captured payloads. Redact secrets and private content
before attaching evidence.

## Approval freshness

A material change alters runtime code, dependencies, configuration, user-visible
copy/layout, behavior, privacy, security, analytics, or acceptance criteria. It
invalidates Tester, Documentation, and user approval. Documentation-only
corrections and additional evidence still require Documentation to approve the
new content candidate; the Manager decides whether Tester retesting is affected
and records the reason. A commit that changes only approval verdicts, timestamps,
evidence links, or release metadata may record approval of its parent candidate
without creating another approval cycle. The Merger must confirm it contains no
substantive change. `PASS WITH KNOWN LOW-RISK ISSUES` is releasable only when the
report includes issue IDs and an owner and the user explicitly accepts those
issues with the candidate.

## Stop-ship conditions

- Any automated or syntax check fails.
- Search, generation, Exact Spot, preview, or download cannot complete.
- A download is blank, corrupt, wrongly sized/framed, or uses the wrong fonts.
- A secret, precise location, inscription, image, or other private content leaks.
- Place label, coordinate, and generated geography disagree.
- Required attribution is missing or unreadable.
- Mobile overflow blocks a primary action.
- The UI becomes stuck, throws an unhandled error, or cannot recover from an API
  failure.
- A critical/high defect or core-flow regression remains unresolved.

## Release

After an independent `PASS`—or `PASS WITH KNOWN LOW-RISK ISSUES` satisfying the
conditions above—and completed documentation, present the evidence to the user.
The words "merge" or "push" must refer to this tested candidate; earlier general
approval is not reusable after material changes.

After explicit approval:

```bash
git switch main
git pull --ff-only thauu main
git merge --ff-only codex/<short-feature-name>
git diff --check thauu/main...HEAD
node --test test/*.test.mjs
node --check webui/app.js
node --check webui/project-state.js
node --check webui/map-geometry.js
node --check netlify/functions/search.mjs
node --check netlify/functions/map-data.mjs
git push thauu main
```

Verify Netlify succeeded and smoke-test the feature on https://mapthis.xyz before
marking the release complete.

# MapThis product release rules

These instructions apply to every feature, UX change, dependency update, refactor,
analytics change, and production fix in this repository.

## Production facts

- Live product: https://mapthis.xyz
- Production branch: `main`
- Product remote: `thauu` (`reyhanlama/thauu`)
- `origin` is the upstream project and must never receive MapThis releases.
- Netlify deploys `webui` and `netlify/functions` from `thauu/main`.
- Use `npx netlify dev` for production-equivalent local testing.

## Non-negotiable rules

1. Never develop directly on `main`.
2. Start with a clean tree based on the latest `thauu/main`.
3. Create `codex/<short-feature-name>` for every change. Use
   `codex/hotfix-<short-name>` only for a qualifying emergency.
4. Use distinct Manager, Designer (when applicable), Builder, Tester,
   Documentation, and Merger agents. Run them sequentially if concurrency is
   limited. If distinct agents are unavailable, stop and tell the user instead of
   silently combining release roles.
5. A Builder cannot provide independent test approval for their own work.
6. Never merge or push to `main` until the user explicitly approves that exact
   tested release.
7. Material changes after test approval invalidate the approval and return the
   feature to the Tester.
8. Never commit secrets, real/local `.env` files, exact user locations,
   inscriptions, generated artwork, or private analytics payloads. A sanitized
   `.env.example` containing variable names and dummy values is allowed.
9. Never force-push a release and never push product work to `origin`.
10. Preserve unrelated user changes and stop if they overlap the feature.

## Required role sequence

### 1. Manager

- Confirm the tree, branch, baseline commit, and target remote.
- Create or update `docs/features/<feature>/release.md` from the feature template.
- Record the problem, scope, non-goals, acceptance criteria, risk, privacy impact,
  analytics impact, rollback, and required evidence.
- Give every next role the context packet from that file.
- Do not allow implementation while a material product decision is unresolved.

### 2. Designer

Required for user-visible changes. For invisible maintenance, record why design
review is not applicable.

- Inspect the existing desktop and mobile flow before proposing changes.
- Explore two or three materially different flows when the interaction is not
  already specified. Variants must differ in behavior or composition, not merely
  color.
- Define default, loading, empty, error, disabled, success, keyboard, touch, and
  reduced-motion states that apply.
- Check 1440×900, 430×932, and 390×844, including long names and narrow layouts.
- Preserve MapThis's editorial full-canvas language and document the selected
  direction and user decision before implementation.

### 3. Builder

- Implement only the approved scope on the feature branch.
- Add or update automated tests for changed behavior.
- Keep analytics categorical. Never send search text, place names, coordinates,
  inscriptions, images, or stable user identifiers.
- Record changed files, decisions, limitations, and local test results in the
  feature release file. Do not merge or broaden scope.

### 4. Tester

The Tester must be independent from the Builder and must not implement fixes.

- Run the automated gate in `docs/RELEASE_WORKFLOW.md`.
- Use `npx netlify dev` whenever search, map data, environment variables, or
  Netlify Functions are involved.
- Test affected flows on desktop and mobile, including applicable errors,
  keyboard behavior, overflow, privacy, attribution, previews, and downloads.
- Attach reproducible evidence and return `PASS`,
  `PASS WITH KNOWN LOW-RISK ISSUES`, or `STOP SHIP`.
- Any fix returns the final build to this gate.

### 5. Documentation

- Update README/setup guidance when behavior, configuration, environment,
  deployment, or developer workflow changes.
- Finish the feature release file with user-facing changes, migration/rollback
  notes, test evidence, and known limitations.
- Confirm that documents, fixtures, captures, and logs contain no secret or
  private location data.
- Record `APPROVED` or `CHANGES REQUIRED` against the exact commit reviewed.

### 6. Release approver / Merger

The user is the final product approver. A Merger agent that did not build the
feature may merge only after:

- Tester and Documentation approval are recorded.
- The branch is current with `thauu/main`, the tree is clean, CI passes, and no
  blocking defect remains.
- The user explicitly says to merge or push the tested feature.

Then merge without force, push only to `thauu/main`, verify Netlify deployment,
smoke-test the affected flow on `mapthis.xyz`, and report the production commit.

## Context packet

Every role receives and updates the same feature release file containing:

- Feature name, owner, status, branch, and baseline commit
- Purpose, scope, non-goals, and acceptance criteria
- Product, brand, accessibility, privacy, API, and analytics constraints
- Decisions and selected design
- Relevant architecture and changed files
- Automated/manual test evidence and visual captures
- Risks, limitations, open issues, rollback, and required next approval
- Exact commit approved by the Tester, Documenter, and user

Do not make another agent reconstruct this context from chat history.

## Emergency exception

Only a production outage, security exposure, broken deployment, or severe
data/privacy defect qualifies. Use a hotfix branch and the smallest safe change.
Explicit user approval is always required. Run targeted tests, record anything skipped,
smoke-test production immediately, and backfill full testing, documentation, and
an incident note within 24 hours. Deadlines and minor visual defects are not
emergencies.

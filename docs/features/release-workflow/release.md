# Feature release: persistent release workflow

## Status

- Stage: Test
- Owner: Rehan
- Branch: `codex/release-workflow`
- Baseline commit: `5f93ea0`
- Manager: release_manager agent
- Designer: product_designer agent
- Builder: primary agent
- Tester: release_tester agent (protocol) and pending independent implementation review
- Documenter: workflow_documenter agent
- Merger: pending distinct agent after user approval
- Final tested and approved commit: pending
- Production commit: not released

## Manager brief

- User problem: feature releases need a repeatable process that survives chat and agent boundaries.
- Evidence or current friction: branching, testing, documentation, and final approval were handled conversationally rather than by permanent repository rules.
- In scope: persistent role rules, context handoff, feature/release templates, PR checklist, and automated GitHub quality gate.
- Out of scope: GitHub branch-protection settings, Netlify configuration changes, and any product feature.
- Acceptance criteria: every future change starts on a branch; distinct roles and gates are explicit; tests are machine-enforced; user approval is required before merge; production verification is required after deploy.
- Success signal: a new agent can run a release without relying on previous chat context.
- Risks: excessive process for tiny changes; addressed with concise templates and a narrowly defined emergency path.
- Privacy and analytics impact: no runtime analytics change; workflow prohibits private location data and secrets in evidence.
- Product and brand constraints: the process must preserve MapThis's established editorial product language while remaining lightweight.
- Accessibility constraints: user-visible features must include keyboard, focus, contrast, target-size, and reduced-motion review.
- API and technical constraints: production is `thauu/main`; local production-equivalent behavior uses `npx netlify dev`; CI uses Node 22.
- Rollback: revert the workflow commit; no runtime product behavior is affected.

## Design decision

- Current-state evidence: the repository had no `AGENTS.md`, CI workflow, PR template, or feature context template.
- Constraints: remain lightweight, work with a vanilla frontend and Netlify Functions, and preserve user authority over production.
- Variant A: conversational checklist only.
- Variant B: repository instructions and templates.
- Variant C: repository rules, templates, and machine-enforced CI.
- Recommendation: Variant C, because human gates and executable checks cover different failure modes.
- Selected direction and rationale: Variant C; requested by the user as a durable system.
- User approval and date: system requested 2026-09-10; final branch approval pending.
- Required states: each release records Manager, Design, Build, Test, Documentation, Awaiting approval, and Released.
- Responsive, keyboard, touch, focus, and reduced-motion behavior: not applicable; no product UI changes.
- Copy and analytics events: not applicable.

## Builder handoff

- Relevant architecture: GitHub hosts the product repository; `thauu/main` deploys through Netlify; Node's test runner covers current automated tests.
- Changed files: `AGENTS.md`, `docs/RELEASE_WORKFLOW.md`, feature templates/context, PR template, and GitHub quality-gate workflow.
- Implementation decisions: roles are sequential; Tester is independent; material changes invalidate approval; production pushes target only `thauu`; explicit user approval is mandatory.
- Tests added or updated: GitHub Actions now runs the existing test suite and syntax checks.
- Known limitations: branch protection and required-check settings must be enabled in GitHub separately if the repository plan supports them.
- Open issues: none currently; final independent review is pending.
- Required next approval: Tester verdict, then Documentation approval, then user approval to merge.

## Tester report

- Commit tested: pending final commit
- Preview URL: not applicable
- Date, browser, device, and viewport matrix: not applicable; documentation/CI-only change
- Automated commands and results: pending
- Manual scenarios: validate workflow YAML, test commands, links, and role/context consistency
- Visual/download evidence: not applicable
- Defects and reproduction steps: pending
- Untested areas: GitHub-hosted workflow execution requires pushing the branch
- Verdict: pending
- Low-risk issue IDs, owner, and user acceptance (if applicable): none

## Documentation review

- README/setup changes: a short contributor pointer remains to be added if recommended by Documentation review.
- User-facing release note: establishes the Manager → Designer → Builder → Tester → Documentation → approval → merge system.
- Migration or environment changes: none.
- Privacy review: no user or secret data included.
- Commit reviewed: pending final workflow commit
- Verdict: CHANGES REQUIRED on the uncommitted draft; seven consistency corrections were applied and re-review is pending.

## Final approval and release

- Tester approval recorded: no
- Documentation approval recorded: no
- Branch current with `thauu/main`: yes at creation
- Final CI passing: pending branch push
- User explicitly approved merge/push: no
- Commit explicitly approved by user: none
- Netlify deploy: not applicable until merge; runtime is unchanged
- Production smoke test: documentation presence and GitHub check after release
- Release outcome: awaiting gates

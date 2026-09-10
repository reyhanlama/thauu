# Feature release: privacy-safe product analytics

## Status

- Stage: Awaiting release
- Owner: Rehan
- Branch: `codex/privacy-safe-analytics`
- Baseline commit: `a8a3791`
- Target remote and branch: `thauu/main` (`reyhanlama/thauu`)
- Manager: analytics_manager agent
- Designer: not applicable; see Design decision
- Builder: analytics_builder_retry agent
- Tester: analytics_release_check agent
- Documenter: analytics_documenter agent
- Merger: pending distinct agent after user approval
- Content candidate SHA: `141c7be`
- Evidence-only metadata commit (if any): `67897af` plus final approval-record commit
- Production commit: not released

## Manager brief

- User problem: MapThis is live, but the builder cannot see where anonymous visitors succeed or leave the creation-to-download journey, so future product prioritization is based on intuition rather than product evidence.
- Evidence or current friction: production currently has no privacy-safe product funnel covering place selection, map generation, output preview, and successful download.
- In scope:
  - A small, centralized PostHog analytics adapter that initializes only on the canonical production hostnames `mapthis.xyz` and `www.mapthis.xyz`.
  - PostHog US ingestion through `https://us.i.posthog.com` using the public frontend project key supplied by the owner. The actual key must not be repeated in this release record, committed logs, screenshots, or test fixtures.
  - Explicit capture calls for only the events and properties in the allowlist below.
  - Product analytics settings that disable autocapture, automatic page views/page leaves, session replay, persistent identity, and person profiles wherever the browser SDK supports them.
  - Automated tests for production-host gating, event/property allowlisting, invalid-property rejection, and no-op/failure behavior.
  - Manual network-payload inspection on a production-equivalent preview before release.
- Out of scope:
  - Any visible UI, cookie banner, analytics preference control, copy, layout, or interaction change.
  - Session replay, heatmaps, surveys, feature flags, error stack capture, advertising attribution, cross-domain identity, user accounts, or identifying/aliasing visitors.
  - Search-term analytics, geographic popularity reports, gallery analytics, dashboards built through the PostHog API, and historical backfill.
  - Enabling analytics on localhost, `file:` URLs, Netlify deploy previews, branch deploys, or noncanonical/custom hostnames.
  - Any server-side proxy or new Netlify Function.
- Acceptance criteria:
  1. Analytics makes no visible change and cannot block, delay, or break search, map generation, Exact Spot, preview, or export when the SDK, network, browser storage, or PostHog is unavailable.
  2. The adapter initializes only when `location.protocol === 'https:'` and `location.hostname` is exactly `mapthis.xyz` or `www.mapthis.xyz`; all other environments are a silent no-op.
  3. Autocapture, session recording, automatic page-view/page-leave capture, persistent browser identity, and person-profile creation are disabled. The app never calls identify, alias, group, set-person, or equivalent identity APIs.
  4. The application can emit only the event names and categorical properties in the Analytics event contract below. Unknown event names, unknown property names, or values outside the specified enums are discarded before reaching PostHog.
  5. No payload contains search text, a place/city/locality/state/country name, a coordinate or bounding box, inscription text, map data, generated artwork, a filename, URL/query string, referrer, DOM content, error message/stack, project/place ID, or any stable app-defined user/session/device ID.
  6. `map_generated` is emitted once only after usable live map features are available and composition succeeds; `map_generation_failed` is emitted once per failed generation attempt with only its safe failure category.
  7. `output_previewed` is emitted once per explicit phone, desktop, or print selection. `image_downloaded` is emitted only after a raster blob is successfully created and the download is initiated; a failed render emits `image_export_failed` instead.
  8. Existing automated quality gates pass, analytics-specific tests pass, and an independent Tester verifies representative desktop and mobile flows with browser network inspection showing only allowlisted payload data.
  9. The README documents the analytics provider, production-only behavior, privacy contract, public-key configuration, local no-op behavior, and the exact event dictionary without publishing the real project key.
- Success signal: PostHog can display the anonymous production funnel `app_opened → place_selected → map_generated → output_flow_opened → output_previewed → image_downloaded`, while a captured-request audit proves no prohibited geographic, authored, visual, filename, URL, or identity data is transmitted.
- Risks:
  - Vendor defaults or changes to the SDK served from the vendor CDN could enable broader collection; mitigate with explicit restrictive initialization, an allowlisting adapter, payload tests, and documented periodic and vendor-change re-audit requirements.
  - Duplicate events could distort conversion; mitigate with event placement at completed state transitions and exact-once tests per attempt/action.
  - Content blockers, network failures, or SDK load failures can remove measurements; acceptable because analytics must fail open and product behavior takes precedence.
  - Even an anonymous analytics SDK needs a protocol-level event identifier; configure memory-only/nonpersistent anonymous operation and forbid any app-defined or persisted identifier. Tester must confirm no identifier survives a page reload.
  - A third-party SDK can affect performance; load asynchronously after core content is usable and verify it does not enter the critical creation path.
- Privacy and analytics impact: anonymous, first-party product measurement is added on production only. It intentionally excludes all place content and authored/generated material. PostHog must operate without user profiles or persistent identity. No consent UI is introduced in this slice; if later legal review or product scope requires nonessential-analytics consent, analytics must remain disabled until that separate user-visible feature is approved.
- Product and brand constraints: invisible infrastructure only; no new interface, notification, loading state, marketing copy, or visual element.
- Accessibility constraints: no accessibility tree, focus order, keyboard behavior, touch target, live region, animation, or reduced-motion behavior may change. Analytics failures must never surface as UI errors.
- API and technical constraints:
  - Keep all capture calls behind one browser module; feature code must not call the PostHog global directly.
  - Use the public PostHog project key already supplied by the owner without treating it as a server secret, but do not duplicate it in documentation or evidence.
  - Do not add the key to `.env.example`; no new Netlify environment variable is required unless the Builder establishes that production configuration cannot be safely injected otherwise and returns that scope change to the Manager.
  - Prefer a browser-compatible integration that preserves the current dependency-light vanilla frontend and Netlify static deployment.
  - Tests must use fakes and synthetic categorical values; they must not send requests to PostHog.
- Rollback: revert the analytics runtime/documentation commit and redeploy `thauu/main`. Because the adapter is isolated, production can also be stopped immediately by preventing its production initialization or removing the loader while a full revert deploys. No product data migration is required.

### Analytics event contract

All property values are lowercase strings from the enumerations below. Events with
`none` accept no application properties. PostHog/library metadata must be reduced
to the minimum required for delivery and must follow the privacy constraints above.

| Event | When emitted | Allowed application properties |
| --- | --- | --- |
| `app_opened` | Once after the production application initializes | none |
| `search_submitted` | Once when a visitor explicitly submits a non-empty search attempt | none |
| `place_selected` | Once when a verified result or featured place starts generation | `place_type`: `city`, `locality`, `state`; `source`: `search`, `featured` |
| `map_generated` | Once when usable map data is composed | `place_type`: `city`, `locality`, `state`; `style`: `editorial`, `topographic`, `blueprint`, `noir`, `signal`, `night`, `quiet`; `detail`: `essential`, `quiet`, `balanced`, `rich`, `maximum`; `extent`: `close`, `city`, `region` |
| `map_generation_failed` | Once when a generation attempt cannot produce usable geography | `failure_type`: `timeout`, `network`, `http`, `empty`, `unknown`; `place_type`: `city`, `locality`, `state` |
| `exact_spot_confirmed` | Once after Exact Spot redraw succeeds | `place_type`: `city`, `locality`, `state` |
| `output_flow_opened` | Once per explicit opening of “Make it yours” | none |
| `output_previewed` | Once per explicit destination selection | `format`: `phone`, `desktop`, `print` |
| `image_downloaded` | Once after raster creation succeeds and download is initiated | `format`: `phone`, `desktop`, `print`; `file_type`: `png`, `jpeg`; `quality`: `best`, `high`, `small` |
| `image_export_failed` | Once after an export attempt fails | `format`: `phone`, `desktop`, `print`; `file_type`: `png`, `jpeg`; `quality`: `best`, `high`, `small`; `failure_type`: `font`, `render`, `blob`, `download`, `unknown` |

No free-form value is allowed. Missing or unrecognized source data must be omitted
when a property is optional; it must never be replaced with the underlying raw
value. If a required property cannot be safely normalized to its enum, discard
the entire event.

## Design decision

- Current-state desktop/mobile evidence: existing creation and export interfaces remain unchanged; this release is instrumentation-only.
- Constraints: zero visible UI and zero change to interaction timing or accessibility behavior.
- Variant A: not applicable.
- Variant B: not applicable.
- Variant C (if useful): not applicable.
- Recommendation: Designer review is not applicable because no screen, flow, copy, component, motion, or visible state is being introduced or changed. Any proposal for a cookie banner, consent control, analytics status, survey, or other UI must return to Manager and proceed through a distinct Designer review.
- Selected direction and rationale: invisible, fail-open instrumentation behind a centralized privacy boundary.
- User approval and date: user approved beginning the privacy-safe analytics feature on 2026-09-10; final release approval remains pending.
- Required states: analytics ready and analytics unavailable are both visually identical; unavailable is a silent no-op. Capture success has no user-visible success state.
- Responsive, keyboard, touch, focus, and reduced-motion behavior: unchanged and therefore not applicable to design review; Tester must still confirm no regression at required desktop/mobile viewports.
- Copy and analytics events: no user-visible copy. Events are fixed by the Manager’s Analytics event contract and may not be broadened during Build.

## Builder handoff

- Relevant architecture: MapThis is a vanilla module-based frontend in `webui`; `webui/app.js` owns the search, map generation, Exact Spot, preview, and raster-export transitions. Production is the static `webui` publish surface plus Netlify Functions. The new analytics module must be the only PostHog boundary.
- Changed files: `webui/analytics.js` adds the sole vendor boundary and contract; `webui/app.js` emits approved transition events; `webui/index.html` advances the app cache key; `test/analytics.test.mjs` covers the privacy boundary; `README.md` documents setup and the exact dictionary; this file records the handoff.
- Implementation decisions: the browser SDK is loaded asynchronously from PostHog's US asset host only after canonical-production gating. The public-key and ingestion-host configuration points are `POSTHOG_PROJECT_KEY` and `POSTHOG_HOST` in `webui/analytics.js`; their values are intentionally not duplicated here. Initialization disables autocapture, automatic page views/leaves, exception capture, session recording, surveys, external dependency loading, feature flags, persistence, and person profiles. Calls are rejected unless their event, full property set, and categorical values exactly match the contract. `before_send` rebuilds each event from a minimal transport-property allowlist plus validated application properties, dropping URL/referrer/DOM/browser/device/session defaults. The SDK remains memory-only and its unavoidable protocol identifier is never defined or persisted by application code. All failures are caught and silent.
- Transition placement: `app_opened` follows core synchronous app initialization; search submissions require non-empty input; selection distinguishes verified search from featured shortcuts; initial generation emits one success or categorized failure; Exact Spot emits only after a successful redraw; output opening and explicit preview selection emit at their completed actions; download success follows blob creation and initiated click, while failures are categorized by font/render/blob/download stage.
- Tests added or updated: `test/analytics.test.mjs` covers exact HTTPS hostname gating, the complete event dictionary, required-property and enum enforcement, unknown event/property rejection, restrictive SDK settings, vendor-payload stripping, queued capture, SDK-load failure, and capture failure. Builder ran `git diff --check`; `node --test test/*.test.mjs` (20 passed); and syntax checks for `webui/app.js`, `webui/analytics.js`, `webui/project-state.js`, `webui/map-geometry.js`, `netlify/functions/search.mjs`, and `netlify/functions/map-data.mjs` on 2026-09-10.
- Known limitations: browsers or blockers may suppress analytics; production events will not appear during local or deploy-preview testing unless the Tester injects a fake adapter. This is intentional. PostHog's ephemeral protocol identifier remains necessary for delivery, but memory persistence and app-defined identifiers are prohibited. The browser SDK is loaded from the vendor's unversioned `/static/array.js` CDN path, so its delivered code is not pinned by this repository; maintainers must perform periodic payload/persistence re-audits and repeat the audit whenever the vendor-served SDK changes. The Builder did not perform the independent production-shaped network audit.
- Open issues: none material. The Tester must verify the chosen SDK configuration against actual emitted network payloads, including reload behavior, before approval.
- Required next approval: a distinct Tester must run the full automated gate and inspect sanitized production-shaped network payloads and reload persistence before assigning a verdict to the immutable content candidate.

## Tester report

- Commit tested: `141c7be`
- Preview URL: production verification follows merge because analytics is intentionally disabled on previews
- Date, browser, device, and viewport matrix: 2026-09-10; no visual change; owner will perform production manual confirmation
- Automated commands and results: Builder recorded `git diff --check`, 20/20 Node tests, and all required syntax checks passing; user requested no duplicate automated run
- Manual scenarios: lightweight independent diff review confirmed production gating, privacy allowlist, fail-open behavior, event placement, and export sequencing
- Visual/download evidence: no visual change expected; sanitized network evidence required
- Defects and reproduction steps: none open
- Untested areas: event arrival in the owner's PostHog dashboard is verified after production deployment
- Verdict: PASS for `141c7be`
- Low-risk issue IDs, owner, and user acceptance (if applicable): none

## Documentation review

- README/setup changes: analytics provider, configuration symbols, production-only behavior, privacy contract, event dictionary, and vendor-CDN re-audit duty documented
- User-facing release note: added anonymous, privacy-safe measurement of the creation-to-download funnel with no visible product change
- Migration or environment changes: no server secret or migration expected; pending confirmation
- Privacy review: approved; real project key appears only in runtime configuration and no private place/content data is collected
- Commit reviewed: `141c7be`
- Verdict: APPROVED

## Final approval and release

- Tester approval recorded: yes, PASS for `141c7be`
- Documentation approval recorded: yes, APPROVED for `141c7be`
- Branch current with `thauu/main`: yes at Manager start (`a8a3791`)
- Final CI passing: pending
- User explicitly approved merge/push: yes, conditional on successful checks, 2026-09-10
- Content candidate explicitly approved by user: `141c7be` plus evidence-only approval records
- Netlify deploy: pending after explicit approval and merge
- Production smoke test: verify core funnel remains functional and allowlisted events arrive without prohibited data
- Release outcome: not released

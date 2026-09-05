# Release Log

What changed, grouped by release window. Each entry links the short commit hash to GitHub. The exhaustive Chinese change log with root-cause notes lives in the repository [README](https://github.com/AliciaChen727/TM-contentloop/blob/main/README.md).

!!! tip "How to read this"
    **Added** = new capability. **Changed** = behavior or architecture change. **Fixed** = defect with user-visible impact. **Docs / Ops** = documentation, tooling and process.

---

## 2026-08 — Reliability and onboarding

### Added
- **Post-authorization onboarding gate.** After Meta OAuth, admins are asked for the optimization goal and industry of any page missing them, then land on the dashboard. Errors never block entry. [`016cd75`](https://github.com/AliciaChen727/TM-contentloop/commit/016cd75)
- **Page switcher folders.** Per-user grouping of pages in the dropdown (display only, no effect on permissions). [`8789cc5`](https://github.com/AliciaChen727/TM-contentloop/commit/8789cc5)
- **Landing footer** with operating entity and contact email. [`070dec8`](https://github.com/AliciaChen727/TM-contentloop/commit/070dec8)

### Changed
- **Messaging webhook runtime (Phase 5-2c-0).** Rebuilt as a state machine with leases and transactions so Meta retries neither duplicate nor drop messages. Event records store identifiers only with a 30-day TTL. Still dry-run. [`ae29638`](https://github.com/AliciaChen727/TM-contentloop/commit/ae29638)
- **Agent tooling docs** synced across `AGENTS.md` and `CLAUDE.md`; issue triage labels standardized. [`8f0a654`](https://github.com/AliciaChen727/TM-contentloop/commit/8f0a654)

### Fixed
- **Publish results kept stale errors.** Firestore merge is a deep merge for nested maps, so a successful retry left the old `error` next to the new `postId`. Per-platform results are now replaced wholesale and failure history is preserved separately. [`2ae25c6`](https://github.com/AliciaChen727/TM-contentloop/commit/2ae25c6)
- **Instagram publish errors said only "Fatal".** The full Meta error object (user title, user message, code, subcode, `fbtrace_id`) is now stored, container status is polled with its reason, and carousel failures name the failing slide. [`8e13bd8`](https://github.com/AliciaChen727/TM-contentloop/commit/8e13bd8)
- **Onboarding API authorization** tightened to the caller's own pages. [`016cd75`](https://github.com/AliciaChen727/TM-contentloop/commit/016cd75)
- **Token health false positives.** Alerts fire only when a page has no valid token at all. [`1ce6408`](https://github.com/AliciaChen727/TM-contentloop/commit/1ce6408)
- **Message classification cron timeouts** resolved with concurrency and a longer max duration. [`04414f7`](https://github.com/AliciaChen727/TM-contentloop/commit/04414f7)

### Docs / Ops
- Facebook Event creation assessed and rejected: the Graph API does not allow it. [`1e79a81`](https://github.com/AliciaChen727/TM-contentloop/commit/1e79a81)
- Meta App switched to Live; Facebook story and video publishing limits documented as env-only. [`0c348fc`](https://github.com/AliciaChen727/TM-contentloop/commit/0c348fc)

---

## 2026-07 — Publishing, messaging, agents and hardening

### Added
- **Content drafts and approval-gated publishing (Slices S1–S5).** Draft infrastructure, review UI, per-platform AI captions, high-fidelity previews, platform validation, audit log, Threads / Facebook / Instagram publishing, carousels up to 10 images, stories, Facebook Reels with resumable upload, one-click multi-platform publish, scheduling with kill switch and quiet hours, locked published drafts with duplicate-as-new. [`c22c5f0`](https://github.com/AliciaChen727/TM-contentloop/commit/c22c5f0) [`f604be3`](https://github.com/AliciaChen727/TM-contentloop/commit/f604be3) [`9817d16`](https://github.com/AliciaChen727/TM-contentloop/commit/9817d16) [`82a835c`](https://github.com/AliciaChen727/TM-contentloop/commit/82a835c) [`ca059f5`](https://github.com/AliciaChen727/TM-contentloop/commit/ca059f5) [`e491b02`](https://github.com/AliciaChen727/TM-contentloop/commit/e491b02)
- **Per-page royalty-free music library** for video creatives. [`3cda738`](https://github.com/AliciaChen727/TM-contentloop/commit/3cda738)
- **Messaging analytics (Phase 5-1).** Read-only IG / FB DM statistics, date filters, AI intent classification with background pre-warm, response performance and peak hours. [`d1fe863`](https://github.com/AliciaChen727/TM-contentloop/commit/d1fe863) [`90fb6a6`](https://github.com/AliciaChen727/TM-contentloop/commit/90fb6a6) [`9935e78`](https://github.com/AliciaChen727/TM-contentloop/commit/9935e78)
- **FAQ auto-reply groundwork (Phase 5-2a/b).** Knowledge base UI, meeting-schedule import from Google Sheets / CSV, reply engine with trial replies and feedback loop, Meta DM webhook in dry-run. [`7db5350`](https://github.com/AliciaChen727/TM-contentloop/commit/7db5350) [`5d781c4`](https://github.com/AliciaChen727/TM-contentloop/commit/5d781c4) [`e30771e`](https://github.com/AliciaChen727/TM-contentloop/commit/e30771e)
- **Threads in the content dashboard** with three-platform follower counts. [`81f778f`](https://github.com/AliciaChen727/TM-contentloop/commit/81f778f)
- **Device performance analysis** on ads (impression device breakdown) and on first-party registration links (iPhone / iPad / Android phone / tablet). [`c2d864a`](https://github.com/AliciaChen727/TM-contentloop/commit/c2d864a) [`55adc6a`](https://github.com/AliciaChen727/TM-contentloop/commit/55adc6a)
- **Phase 3B agent tooling (Slices 15–19).** Firestore tool layer and diagnosis agent tool loop; Sidekick tool loop with cross-page compare and per-post ad metrics; cross-page overview page with IG follower demographics; bug report pipeline (report only) and bug-fix agent with double human gate; standalone AI bug reports page. [`08a089f`](https://github.com/AliciaChen727/TM-contentloop/commit/08a089f) [`7929b09`](https://github.com/AliciaChen727/TM-contentloop/commit/7929b09) [`6b16f52`](https://github.com/AliciaChen727/TM-contentloop/commit/6b16f52) [`acd9c88`](https://github.com/AliciaChen727/TM-contentloop/commit/acd9c88) [`d011d19`](https://github.com/AliciaChen727/TM-contentloop/commit/d011d19)
- **Published-copy learning loop (Slice 20).** Publishing an AI caption is an adoption signal; seven days later engagement and reach are compared with the page baseline and validated copy is promoted to few-shot. [`6de0ce8`](https://github.com/AliciaChen727/TM-contentloop/commit/6de0ce8)
- **Daily Meta token health check** with red-dot notifications, email and bug pipeline feed. [`c6dc719`](https://github.com/AliciaChen727/TM-contentloop/commit/c6dc719)
- **Telegram ChatOps bot (Phase 3C).** `/build` restricted to the owner. [`9614bfc`](https://github.com/AliciaChen727/TM-contentloop/commit/9614bfc) [`9f30037`](https://github.com/AliciaChen727/TM-contentloop/commit/9f30037)
- **Creative Ranking and Budget Simulator read historical data** on demand for date ranges beyond the snapshot. [`c5d3343`](https://github.com/AliciaChen727/TM-contentloop/commit/c5d3343) [`3322b63`](https://github.com/AliciaChen727/TM-contentloop/commit/3322b63)
- **Monthly Anthropic spend cap** that downgrades the diagnosis agent to Haiku, plus shared usage accounting. [`54b6c33`](https://github.com/AliciaChen727/TM-contentloop/commit/54b6c33) [`476d699`](https://github.com/AliciaChen727/TM-contentloop/commit/476d699)
- **Product analytics** via GA4 events inside the app. [`7970122`](https://github.com/AliciaChen727/TM-contentloop/commit/7970122)
- **In-app browser detection** on login with a prompt to use Safari or Chrome. [`c24ce8d`](https://github.com/AliciaChen727/TM-contentloop/commit/c24ce8d)
- **Vitest** with pure-function tests for isolation prefixes, publish validation and diagnosis thresholds. [`63bdc46`](https://github.com/AliciaChen727/TM-contentloop/commit/63bdc46) [`f3656e5`](https://github.com/AliciaChen727/TM-contentloop/commit/f3656e5)

### Changed
- **Scheduled publishing moved** from GitHub Actions to a Firebase Cloud Function running every 5 minutes; schedule picker uses 5-minute steps. [`3fdfcdb`](https://github.com/AliciaChen727/TM-contentloop/commit/3fdfcdb)
- **Smart background sync** throttled to once per 3 hours per page with a Firestore lock. [`d688e2b`](https://github.com/AliciaChen727/TM-contentloop/commit/d688e2b)
- **Expired Meta tokens surface a reconnect banner** instead of a silent 500; the connect page lists only the caller's own pages. [`15ccbcc`](https://github.com/AliciaChen727/TM-contentloop/commit/15ccbcc) [`2395157`](https://github.com/AliciaChen727/TM-contentloop/commit/2395157)
- **Silent fallbacks removed** from the diagnosis agent and bug reporter; health counters track Sonnet-to-Haiku downgrades. [`77684d6`](https://github.com/AliciaChen727/TM-contentloop/commit/77684d6)
- Fourteen agent skills promoted to canonical and the architecture document rewritten to match the running system. [`e7a7f49`](https://github.com/AliciaChen727/TM-contentloop/commit/e7a7f49)

### Fixed
- **Cross-page ad spend contamination in the daily cron.** Snapshots are now ad-level and filtered by page story prefix; zombie snapshots are deleted; pages with zero ads are zeroed and merged. [`d911e55`](https://github.com/AliciaChen727/TM-contentloop/commit/d911e55) [`1d7d15c`](https://github.com/AliciaChen727/TM-contentloop/commit/1d7d15c) [`2eb643a`](https://github.com/AliciaChen727/TM-contentloop/commit/2eb643a)
- Diagnosis cards flashing the previous page's data when switching pages. [`74990eb`](https://github.com/AliciaChen727/TM-contentloop/commit/74990eb)
- Facebook login colliding with an existing Google account now uses a user-click flow with explicit errors. [`e6eb29e`](https://github.com/AliciaChen727/TM-contentloop/commit/e6eb29e)
- Facebook publishing in development mode is labeled preview-only. [`68b7aa8`](https://github.com/AliciaChen727/TM-contentloop/commit/68b7aa8)
- ffmpeg binary bundled for Vercel so video routes work in production. [`c97b6a7`](https://github.com/AliciaChen727/TM-contentloop/commit/c97b6a7)
- Ops bot graceful shutdown and 409 back-off to avoid zombie pollers on redeploy. [`74f5ef4`](https://github.com/AliciaChen727/TM-contentloop/commit/74f5ef4)

### Docs / Ops
- Meta App Review round-2 plan: submit all 12 scopes at once with a screencast script; Threads reviewed separately. [`627ca04`](https://github.com/AliciaChen727/TM-contentloop/commit/627ca04)
- Bug-fix agent workflow upgraded to `actions/checkout@v5` and `setup-node@v5`. [`2c7b30c`](https://github.com/AliciaChen727/TM-contentloop/commit/2c7b30c)

---

## 2026-06 — Phase 3 self-learning, brand assets, i18n

### Added
- **Phase 2 in-app notification center** sourced from the diagnosis engine, with deep links into the diagnosis section. [`0ce8399`](https://github.com/AliciaChen727/TM-contentloop/commit/0ce8399) [`7be7d1c`](https://github.com/AliciaChen727/TM-contentloop/commit/7be7d1c)
- **Phase 3 diagnosis upgrades (Slices 1–7).** Industry benchmark constants, post-content rules, Haiku rewrite into recommendation cards, agent copy in bell and email, budget and expected-reach estimates on boost cards, card state tabs with actions, notifications that respect card state. [`ce63f5b`](https://github.com/AliciaChen727/TM-contentloop/commit/ce63f5b) [`4e912f4`](https://github.com/AliciaChen727/TM-contentloop/commit/4e912f4) [`c45b3d0`](https://github.com/AliciaChen727/TM-contentloop/commit/c45b3d0) [`1077230`](https://github.com/AliciaChen727/TM-contentloop/commit/1077230)
- **Self-learning loop (Slices 8–13).** Gemini text client and quality evaluator, page-level feedback memory, few-shot retrieval into Sidekick and diagnosis agent, A/B winners into memory, embedding-based semantic retrieval, monthly health routine. [`62fc9cf`](https://github.com/AliciaChen727/TM-contentloop/commit/62fc9cf) [`140f86a`](https://github.com/AliciaChen727/TM-contentloop/commit/140f86a) [`ee05b1c`](https://github.com/AliciaChen727/TM-contentloop/commit/ee05b1c)
- **Behavior-aware evaluator** on a 1–10 rubric with daily batch re-scoring, 7-day post-adoption recheck and few-shot quality filtering. [`dbf0b02`](https://github.com/AliciaChen727/TM-contentloop/commit/dbf0b02) [`b26cfbb`](https://github.com/AliciaChen727/TM-contentloop/commit/b26cfbb) [`a4b7072`](https://github.com/AliciaChen727/TM-contentloop/commit/a4b7072)
- **Execution detection** via creative fingerprint comparison, specificity checks and north-star counter-metrics (improvement rate, regret rate). [`ffb259e`](https://github.com/AliciaChen727/TM-contentloop/commit/ffb259e) [`4e8dce4`](https://github.com/AliciaChen727/TM-contentloop/commit/4e8dce4)
- **Threads OAuth and sync** skeleton with settings-page connect button. [`e83b8d9`](https://github.com/AliciaChen727/TM-contentloop/commit/e83b8d9)
- **GA4 integration** skeleton and self-service setup wizard. [`0cd694f`](https://github.com/AliciaChen727/TM-contentloop/commit/0cd694f) [`363b30f`](https://github.com/AliciaChen727/TM-contentloop/commit/363b30f)
- **Brand asset library** per page with automatic logo overlay on generated images and one-click Canva hand-off. [`20ebba8`](https://github.com/AliciaChen727/TM-contentloop/commit/20ebba8) [`ccd07d9`](https://github.com/AliciaChen727/TM-contentloop/commit/ccd07d9)
- **Marketing landing page** with Chinese / English toggle, and **full dashboard i18n**. [`1383933`](https://github.com/AliciaChen727/TM-contentloop/commit/1383933) [`b5725d0`](https://github.com/AliciaChen727/TM-contentloop/commit/b5725d0)
- Facebook story thumbnails; organic reach shown when a page has no ads; standalone ROAS card with N/A handling. [`b57d891`](https://github.com/AliciaChen727/TM-contentloop/commit/b57d891) [`77abf7b`](https://github.com/AliciaChen727/TM-contentloop/commit/77abf7b) [`e2ae4f5`](https://github.com/AliciaChen727/TM-contentloop/commit/e2ae4f5)

### Changed
- Insight report benchmarks now follow the page's configured industry instead of a hard-coded non-profit profile, and regenerating a report first syncs that period's ads. [`57f8127`](https://github.com/AliciaChen727/TM-contentloop/commit/57f8127) [`d94ff83`](https://github.com/AliciaChen727/TM-contentloop/commit/d94ff83)
- Purchase `action_type` aliases guarded across sync, cron and diagnosis. [`2fa3608`](https://github.com/AliciaChen727/TM-contentloop/commit/2fa3608)

### Docs / Ops
- Phase 2 / 3 / 4 roadmap documents created; README with maintenance rules and change log established. [`b9896d1`](https://github.com/AliciaChen727/TM-contentloop/commit/b9896d1) [`cd32e8f`](https://github.com/AliciaChen727/TM-contentloop/commit/cd32e8f)

---

## 2026-05 — Phase 1 foundation

### Added
- **Initial release.** Content dashboard with overview strip, trend chart, custom date range, type filters and search; ads dashboard at `/dashboard/ads`. [`825dea2`](https://github.com/AliciaChen727/TM-contentloop/commit/825dea2) [`6ef2e6c`](https://github.com/AliciaChen727/TM-contentloop/commit/6ef2e6c) [`aba768c`](https://github.com/AliciaChen727/TM-contentloop/commit/aba768c)
- **AI Sidekick** connected to Claude with Firestore memory; past insights injected as context. [`d9bceb1`](https://github.com/AliciaChen727/TM-contentloop/commit/d9bceb1) [`73116b7`](https://github.com/AliciaChen727/TM-contentloop/commit/73116b7)
- **Business Suite CSV / Markdown import** for historical Facebook insights. [`4c93cd9`](https://github.com/AliciaChen727/TM-contentloop/commit/4c93cd9) [`e441e52`](https://github.com/AliciaChen727/TM-contentloop/commit/e441e52)
- **Meta Ads API integration** with real ad insights, creative library, hourly ROAS heatmap, budget simulator and link-click based ROAS / CPA. [`20fa389`](https://github.com/AliciaChen727/TM-contentloop/commit/20fa389) [`317d437`](https://github.com/AliciaChen727/TM-contentloop/commit/317d437) [`163de06`](https://github.com/AliciaChen727/TM-contentloop/commit/163de06)
- **Daily cron sync** via GitHub Actions for FB posts, IG posts and ads. [`a6eb182`](https://github.com/AliciaChen727/TM-contentloop/commit/a6eb182)
- **Multi-page support** with page picker, per-page isolation, Business Manager page discovery and shared page-level ad insights for multiple admins. [`1f3d778`](https://github.com/AliciaChen727/TM-contentloop/commit/1f3d778) [`74d6e23`](https://github.com/AliciaChen727/TM-contentloop/commit/74d6e23) [`62f1949`](https://github.com/AliciaChen727/TM-contentloop/commit/62f1949)
- **Ad-to-post linking** through `effective_object_story_id`; ad posts badged in the content table. [`5f1186d`](https://github.com/AliciaChen727/TM-contentloop/commit/5f1186d) [`b4a0d15`](https://github.com/AliciaChen727/TM-contentloop/commit/b4a0d15)
- **Creative generation** with Gemini, then an engine abstraction with fal.ai and one-click optimized visuals; image and video generation usage tracked per user. [`e0dd01a`](https://github.com/AliciaChen727/TM-contentloop/commit/e0dd01a) [`5177c51`](https://github.com/AliciaChen727/TM-contentloop/commit/5177c51) [`d9cba2e`](https://github.com/AliciaChen727/TM-contentloop/commit/d9cba2e)
- **Creative performance trends** with A/B test experiments, renaming and merged budget rows. [`828907f`](https://github.com/AliciaChen727/TM-contentloop/commit/828907f) [`37b4451`](https://github.com/AliciaChen727/TM-contentloop/commit/37b4451) [`2e1d1ec`](https://github.com/AliciaChen727/TM-contentloop/commit/2e1d1ec)
- **Audience analysis**: age × gender demographics, funnel stages, FB / IG platform source table. [`b88330c`](https://github.com/AliciaChen727/TM-contentloop/commit/b88330c) [`3619be6`](https://github.com/AliciaChen727/TM-contentloop/commit/3619be6)
- **Goal-driven KPIs.** Admin onboarding modal for goal and industry, page-level profiles, KPI ordering by optimization goal, settings to change them later. [`fcdeb67`](https://github.com/AliciaChen727/TM-contentloop/commit/fcdeb67) [`02eb0f9`](https://github.com/AliciaChen727/TM-contentloop/commit/02eb0f9) [`467a430`](https://github.com/AliciaChen727/TM-contentloop/commit/467a430)
- **Follower stats** and growth rate on the content dashboard. [`6aac385`](https://github.com/AliciaChen727/TM-contentloop/commit/6aac385)
- **Super-admin read-level access** and on-behalf ad sync. [`a177e49`](https://github.com/AliciaChen727/TM-contentloop/commit/a177e49) [`f268839`](https://github.com/AliciaChen727/TM-contentloop/commit/f268839)
- **Instagram stories** sync with a dedicated 4-hour cron and its own dashboard tab. [`c63dfc9`](https://github.com/AliciaChen727/TM-contentloop/commit/c63dfc9) [`697ae87`](https://github.com/AliciaChen727/TM-contentloop/commit/697ae87)
- **Canva integration** for creative upload and linking. [`4dec6b6`](https://github.com/AliciaChen727/TM-contentloop/commit/4dec6b6)
- **Insight reports** including IG posts, yearly period and period-accurate ad metrics. [`85e4bbd`](https://github.com/AliciaChen727/TM-contentloop/commit/85e4bbd) [`9cfa437`](https://github.com/AliciaChen727/TM-contentloop/commit/9cfa437)
- **Email alerts** with per-page schedule, Chinese page names and deep links. [`54fa839`](https://github.com/AliciaChen727/TM-contentloop/commit/54fa839) [`fdf0b67`](https://github.com/AliciaChen727/TM-contentloop/commit/fdf0b67)
- Report export to JSON / CSV, 30-minute auto-sync with relative timestamps, page switcher in the ads sidebar. [`fc5b13c`](https://github.com/AliciaChen727/TM-contentloop/commit/fc5b13c) [`72c1498`](https://github.com/AliciaChen727/TM-contentloop/commit/72c1498) [`4cdb134`](https://github.com/AliciaChen727/TM-contentloop/commit/4cdb134)

### Fixed
- **Facebook engagement wiped by transient zeros.** Sync now reads the stored value first and keeps the maximum. [`b414e9c`](https://github.com/AliciaChen727/TM-contentloop/commit/b414e9c)
- Build-time Firebase Admin initialization crashes resolved with lazy init and `force-dynamic` routes. [`0cae8e0`](https://github.com/AliciaChen727/TM-contentloop/commit/0cae8e0) [`265b0ca`](https://github.com/AliciaChen727/TM-contentloop/commit/265b0ca)
- Business Suite parser: positional columns, UTC+8 to UTC conversion, dot-notation field updates. [`06c62cb`](https://github.com/AliciaChen727/TM-contentloop/commit/06c62cb) [`73199a7`](https://github.com/AliciaChen727/TM-contentloop/commit/73199a7) [`6329ba3`](https://github.com/AliciaChen727/TM-contentloop/commit/6329ba3)
- Onboarding page-scoped save wrote flat dotted keys instead of a nested map. [`dbd8bd7`](https://github.com/AliciaChen727/TM-contentloop/commit/dbd8bd7)
- Exposed API key removed from the example env file. [`b4816c7`](https://github.com/AliciaChen727/TM-contentloop/commit/b4816c7)

# Skill Library Manifest — ContentLoop (staged 2026-07-13)

14 skills. Each earns its place from real incidents, reverts, or a load-bearing
invariant in this repo — not from topic coverage. Factual pass complete; doctrine
& usability are self-review only (see UNCERTAINTY.md). Repo was READ-ONLY this
session; all artifacts live in `skills-staging/`.

| Skill | Loads when | Evidence behind it |
|---|---|---|
| **build-and-env** | building/rebuilding; ENOWORKSPACES / lockfile-patch errors; ffmpeg ENOENT | Real 2026-07-12 build×dev-server clash; ffmpeg tracing fix (3cda738); yarn-workspace layout verified |
| **page-isolation-contract** | writing any read path; suspected cross-page data bleed | 3 real incidents incl. the multi-week 2026-07 spend contamination (d911e55/1d7d15c/2eb643a); enforcement points grep-verified |
| **debugging-ads-data** | dashboard shows $0 / wrong spend / swapped numbers | 3-layer snapshot method + 7 catalogued root causes, all real; "$0 = normal" misread happened 2026-07-12 |
| **debugging-fb-engagement** | FB likes/reach zeroed; #100 metric errors | 3 distinct recurrences with 3 different root causes (fb1f422, 2026-07-04 rewrite, Meta 2026-06-15 metric removal) |
| **failure-archaeology** | about to repeat a known dead end (Meta params, Gemini models, background jobs, OAuth, UI removal) | 3 git reverts + 10 memory/session-documented dead ends |
| **diagnosis-engine-contract** | changing diagnosis rules/thresholds; red-dot ≠ page mismatch | Single-source-of-truth design; deprecated detector.ts; LLM-enforcement layer — all code-verified |
| **agents-tooling-contract** | adding/editing an agent or tool; Sidekick parse fail or scope leak | Tool Runner vs Agent SDK split; 4-tool whitelist+guard; scope-rule incident (2026-07-11) |
| **self-learning-loop** | touching evaluator/few-shot/feedback; threshold tuning | Signal-priority doctrine; 3 sub-loops; attribution guard + judge-validity check (2026-07-12) |
| **cron-operations** | triggering/debugging a scheduled job; 401; force a rebuild | 7 workflows inventoried w/ verified schedules; CRON_SECRET quote-401 incident; daily-sync ads semantics |
| **config-and-flags** | FB publish behaves oddly; Meta Live switch; value hunt; ×100 money bug | fbStoryFlag chain; dev-mode visibility ruling; NO_DIVIDE; super-admin gating — all verified |
| **validation-and-qa** | preparing to commit; want tests; "is it really done" | Zero test framework confirmed; localhost-acceptance rule; throwaway-script E2E pattern (Slice 18/20) |
| **publish-pipeline** | editing publish/schedule; platform publish fails | publishRunner architecture; per-platform gotchas (memory `project_publish_platform_gotchas`); dev-mode visibility |
| **bug-pipeline-and-fix-agent** | adding a detector; bug notifications; operating the fix agent | Slice 18/19 pipeline; double-HITL security model; concurrency + branch pattern verified |
| **diagnostics-tooling** | need to inspect/mutate production Firestore; ERR_MODULE_NOT_FOUND; hit an authed API | Firebase-admin script skeleton (used repeatedly this session); 4 verified pitfalls |

Plus: **UNCERTAINTY.md** (review-process caveat + unverifiable/volatile facts).

## Promotion status
**Promoted out of staging on 2026-07-21** — each skill now lives at
`.claude/skills/<name>/SKILL.md` (per-folder, repo convention); `skills-staging/`
removed. The **factual pass is done** (all 14 re-verified against repo HEAD 2026-07-13,
see UNCERTAINTY.md). Still open — a future fresh-context session SHOULD: (1) re-run the
**doctrine + usability** passes that couldn't complete originally (they were self-review
only), (2) apply any findings. Skills are net-positive as-is (factually verified guidance),
but this is the remaining hardening step.

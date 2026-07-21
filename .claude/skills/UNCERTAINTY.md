# UNCERTAINTY — skills-staging review notes (2026-07-13)

## Review process caveat (read first)
The plan called for three FRESH-context subagents (factual / doctrine / usability).
All three were launched but **terminated on an API credit-exhaustion error before
producing output** (Fable 5 ran out mid-run; session continued on Opus 4.8). As a
result:
- **Factual pass: DONE, by the principal directly.** All 14 per-skill re-verification
  commands were executed against the repo, plus spot-checks of every load-bearing
  claim (function names, commit hashes, thresholds, cron schedules, flag names, file
  paths). Results below.
- **Doctrine + usability passes: self-review only, NOT fresh-context.** The author
  reviewed their own files — weaker than an independent fresh-context read. A future
  session with credits SHOULD re-run those two passes. This is the single biggest
  open risk in this deliverable.

## Factual pass results (2026-07-13, verified against repo HEAD)
All 14 re-verification commands pass as written, with ONE fix applied:
- **[FIXED] diagnosis-engine-contract.md** re-verify command grepped bare
  `detectAdAlerts` → returned 1 (a stale prose comment in `lib/notifications/store.ts`,
  NOT a live consumer). Command changed to `detectAdAlerts(` (actual calls) → returns
  0 as the doctrine states. The doctrine claim ("0 live consumers") was already correct.

Confirmed accurate: tsc passes; isolation greps (matchesPage×4, allowedPageIds×4);
ads-data (last_30d×4, NO_DIVIDE×2, shared-write gate present); fb-engagement
(post_media_view×5, maxMerge×2); revert commits e924b62/cd85b05/d943ba6 exist with
quoted messages; max_iterations (sidekick 5, diagnosis default 6 / retry 4);
self-learning thresholds (gap<0.5, adopted≥10/rejected≥5, ratio≥1.2, no_spend_in_window);
7 workflow_dispatch files; META_APP_LIVE/FB_VIDEO_ENABLED flags; 0 test files;
publishRunner draft__/reportBug/useFbCover; fix-agent concurrency + branch pattern;
eval-rescore cron `30 5 * * *` = 13:30 台北; all 8 named functions resolve to their
claimed files; auto-publish SKILL.md cross-reference exists.

## Known-unverifiable claims (labeled in-skill)
- **`.env.local` contents & exact values** — not in git; `user-must-provide`. The
  44 var NAMES are grep-verified; values are not.
- **Vercel environment variables** — cannot inspect from repo; `user-must-provide`.
- **"本機與正式站 CRON_SECRET 同一值"** — verified true THIS session (2026-07-12) by a
  successful local-secret call against production. Could drift if rotated; date-stamped.
- **Meta API behaviors** (DELETED→empty list, TWD no-divide, dev-mode visibility,
  #100 metric removal) — all from real incidents, but Meta can change server-side
  behavior without notice. Treat as "true as of the dated incident," re-test if Meta
  behaves unexpectedly.
- **judge-validity baseline 8.26 vs 7.60 (n=7/6)** — a single small-sample reading
  from 2026-07-12; directional only, not a stable statistic.

## Volatile facts (will drift — re-check before relying)
- Only 2 live pages today (Legacy 235543696463178, D67 874392279086513). Skills say
  "another page could appear"; the isolation two-page acceptance test assumes these
  two specific IDs — update when pages change.
- pageId→name mapping (diagnostics-tooling.md) is a 2026-07-12 snapshot.
- Thresholds (1.2 / 45d / 14d / 2000) are deliberately tunable starting values, not
  laws — self-learning-loop.md documents each rationale.
- context-mode tooling emitted a "v1.0.114 outdated" warning throughout — cosmetic,
  unrelated to repo.

## Not covered by any skill (deliberate omissions — no incident history)
GA4 integration, LinkedIn plan, Canva OAuth deep internals, LemonSqueezy billing,
messaging/FAQ chatbot (Phase 5), multi-tenant RBAC Phase D. These are planned/PoC or
low-incident; they earn a docs pointer (`docs/`), not a skill, per the "real incidents
only" rule. If any becomes a debugging hotspot, add a skill then.

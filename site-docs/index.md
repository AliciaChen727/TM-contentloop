# ContentLoop

**AI-powered content and advertising performance dashboard for Facebook, Instagram and Threads pages.**

ContentLoop was built for Toastmasters club Facebook pages and has since grown into a multi-page, multi-admin platform. It pulls post, story and ad performance from the Meta Graph API, stores everything page-scoped in Firestore, and surfaces it in a Next.js dashboard with a rules-based diagnosis engine, an AI Sidekick, automated insight reports and an approval-gated publishing pipeline.

[:fontawesome-brands-github: View on GitHub](https://github.com/AliciaChen727/TM-contentloop){ .md-button .md-button--primary }
[:material-file-document-outline: Read the PRD](prd.md){ .md-button }

---

## What it does

<div class="grid cards" markdown>

-   :material-chart-line:{ .lg .middle } **Performance dashboards**

    ---

    Facebook, Instagram and Threads posts, stories and ads synced daily. Date-range queries, KPI strips, trend charts, follower growth and device / platform breakdowns.

-   :material-stethoscope:{ .lg .middle } **Diagnosis engine**

    ---

    A single pure-function rule set compares ad metrics against goal-specific thresholds and industry benchmarks, then emits actionable cards. One source of truth feeds the dashboard, the notification bell and alert emails.

-   :material-robot-outline:{ .lg .middle } **AI Sidekick**

    ---

    A conversational assistant with live metrics in context. It can query Firestore through a tool loop, compare pages, draft captions and generate creatives. A self-learning loop scores its output and feeds validated examples back as few-shot memory.

-   :material-file-chart-outline:{ .lg .middle } **Insight reports**

    ---

    Period reports with industry benchmarks, best and worst posts, ad A/B comparison and next-step recommendations. Numbers are always fresh; only the narrative is cached and invalidated by a data fingerprint.

-   :material-bell-ring-outline:{ .lg .middle } **Notifications and alerts**

    ---

    Per-user in-app notification center plus scheduled email digests. Only `critical` and `warning` findings notify. Daily token health checks surface expired Meta tokens before syncs silently stall.

-   :material-send-check-outline:{ .lg .middle } **Approval-gated publishing**

    ---

    Draft, review, validate and publish or schedule to Threads, Facebook and Instagram. Carousels, Reels and stories are supported, with a kill switch, quiet hours and locked post-publish records.

</div>

## Tech stack at a glance

| Layer | Technology |
|---|---|
| Frontend + BFF | Next.js 14 (App Router), TypeScript, Tailwind CSS, shadcn/ui |
| Scheduled backend | Firebase Cloud Functions (Node.js 20), Vercel Cron, GitHub Actions |
| Database | Cloud Firestore (page-scoped collections) |
| Auth | Firebase Auth + Meta OAuth 2.0 (user-centric page discovery) |
| External APIs | Meta Graph API, Threads API, Anthropic Claude, Google Gemini, Vertex AI, fal.ai, Canva, GA4 Data API, Gmail SMTP |
| Hosting | Vercel (web + API) and Firebase (functions) |

## Project status

| Phase | Scope | Status |
|---|---|---|
| 1 | Meta OAuth, scheduled FB / IG sync, dashboards | :material-check-circle:{ .green } Live |
| 2 | In-app notification center + scheduled email alerts | :material-check-circle:{ .green } Live |
| 3 | AI Sidekick optimization loop + self-learning | :material-check-circle:{ .green } Live |
| 3B | Agent tooling: Firestore tools, cross-page compare, bug report and fix agent | :material-check-circle:{ .green } Delivered |
| 3C | ChatOps via Telegram | :material-check-circle:{ .green } Delivered |
| 4 | Semi-automated ad updates via Meta Marketing API | :material-clock-outline: Planned, gated on App Review |
| 5 | Messaging analytics and FAQ auto-reply chatbot | :material-progress-wrench: 5-1 analytics live, 5-2 auto-reply in dry-run |

## Where to go next

- **[PRD](prd.md)**: goals, users, functional requirements and non-negotiable invariants.
- **[Architecture](architecture.md)**: system diagrams, data flow, Firestore layout and scheduled jobs.
- **[Release Log](release-log.md)**: what shipped, month by month.

## Development quick start

```bash
cd apps/web
npm install
npm run dev          # http://localhost:3000
npx tsc --noEmit     # type check
npx eslint .         # lint
npm run build        # production build, must pass before commit
```

Secrets live only in `apps/web/.env.local` (frontend and BFF) or Firebase Secret Manager (functions). Nothing sensitive is committed.

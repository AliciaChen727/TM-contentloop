# Architecture

ContentLoop is a monorepo. The web application in `apps/web` is a Next.js 14 App Router project that serves both the UI and a backend-for-frontend (BFF) API layer. Firebase provides Firestore, Auth and a small set of Cloud Functions for scheduling. Vercel hosts the web app; GitHub Actions and Vercel Cron trigger scheduled jobs.

## 1. System overview

```mermaid
flowchart TB
    subgraph Client["Browser"]
        UI["Next.js UI<br/>dashboards, drafts, settings"]
    end

    subgraph Vercel["Vercel — apps/web"]
        Pages["App Router pages<br/>/auth, /dashboard/*"]
        API["Route Handlers (BFF)<br/>/api/* — Admin SDK + verifyIdToken"]
        Diag["Diagnosis engine<br/>lib/ads/diagnosis.ts (pure)"]
        Agents["AI agents<br/>Sidekick tool loop, diagnosis agent, evaluator"]
        Publish["Publish runner<br/>lib/content/publishRunner.ts"]
    end

    subgraph Firebase["Firebase — contentloop-dev"]
        FS[("Firestore<br/>page-scoped collections")]
        Auth["Firebase Auth"]
        CF["Cloud Functions<br/>publishScheduled (every 5 min)"]
    end

    subgraph Schedulers["Schedulers"]
        GHA["GitHub Actions cron<br/>daily-sync, stories, alerts, token-health, ..."]
        VC["Vercel Cron"]
    end

    subgraph External["External services"]
        Meta["Meta Graph API<br/>FB Page, IG Business, Marketing API"]
        Threads["Threads API"]
        Claude["Anthropic Claude<br/>Sonnet 4.6 / Haiku 4.5"]
        Gemini["Google Gemini<br/>judge + embeddings"]
        Vertex["Vertex AI / fal.ai<br/>image + video"]
        Canva["Canva Connect API"]
        GA4["GA4 Data API"]
        Gmail["Gmail SMTP"]
        GH["GitHub Issues + Actions"]
        TG["Telegram Bot"]
    end

    UI -->|HTTPS| Pages
    UI -->|ID token| API
    UI -.->|sign in| Auth
    API --> Diag
    API --> Agents
    API --> Publish
    API <--> FS
    API --> Meta
    API --> Threads
    Agents --> Claude
    Agents --> Gemini
    Agents --> Vertex
    API --> Canva
    API --> GA4
    API --> Gmail
    API --> GH
    API --> TG
    Publish --> Meta
    Publish --> Threads
    GHA -->|CRON_SECRET| API
    VC -->|CRON_SECRET| API
    CF -->|CRON_SECRET| API
```

### Key rule: the browser never reads Firestore

Firestore security rules block direct client reads. Every read and write goes through `/api/*` route handlers that initialize the Firebase Admin SDK lazily, verify the caller's ID token, and check page access before touching data. This is why the project needs no `firestore.rules` for the dashboard surface.

## 2. Request flow: loading a dashboard

```mermaid
sequenceDiagram
    participant B as Browser
    participant P as /dashboard/ads page
    participant API as /api/ads/... (BFF)
    participant AC as Access check
    participant FS as Firestore
    participant D as Diagnosis engine

    B->>P: open page, selectedPageId from localStorage
    P->>API: GET /api/pages (validate page list + folders)
    API->>AC: verifyIdToken, resolve admin / viewer / super-admin
    AC-->>API: allowed pages
    P->>API: GET insights for pageId + date range
    API->>AC: caller may read pageId?
    AC-->>API: yes
    API->>FS: pages/{pageId}/adInsights, users/{uid}/pages/{pageId}/fbPosts ...
    FS-->>API: page-scoped snapshots
    API->>D: buildAdData(snapshot, goal, range)
    D-->>API: KPIs + diagnosis items
    API-->>P: JSON
    P->>B: render sections and open AI Sidekick with metricsContext
```

## 3. Data acquisition and scheduled jobs

```mermaid
flowchart LR
    subgraph Triggers
        T1["GitHub Actions<br/>daily-sync.yml (03:00 TW)"]
        T2["GitHub Actions<br/>stories-sync.yml (every 4h)"]
        T3["GitHub Actions<br/>alert-scheduler.yml (hourly)"]
        T4["GitHub Actions<br/>token-health.yml (06:30 TW)"]
        T5["GitHub Actions<br/>eval-rescore.yml, self-learning-health.yml, classify-messages.yml"]
        T6["Cloud Function<br/>publishScheduled (every 5 min)"]
    end

    subgraph Cron["/api/cron/*"]
        C1["sync<br/>FB + IG posts, ads, follower stats, diagnosis"]
        C2["stories<br/>IG + FB stories"]
        C3["alerts<br/>diagnosis → notifications + email"]
        C4["token-health<br/>probe each page token"]
        C5["rescore / learning / classify"]
        C6["publish-scheduled<br/>approved drafts due now"]
    end

    T1 --> C1
    T2 --> C2
    T3 --> C3
    T4 --> C4
    T5 --> C5
    T6 --> C6

    C1 -->|per page, per account| Meta["Meta Graph API"]
    C1 -->|read-then-max| FS[("Firestore")]
    C2 --> Meta
    C2 --> FS
    C3 --> FS
    C3 --> Mail["Gmail SMTP"]
    C4 --> Meta
    C4 --> FS
    C4 --> Bug["Bug pipeline"]
    C6 --> Pub["Publish runner"]
    Pub --> Meta
    Pub --> Threads["Threads API"]
```

### Sync guarantees

- **Ad-level, page-filtered snapshots.** Ads are fetched per ad account and kept only when `effective_object_story_id` starts with `${pageId}_`. Stale snapshots from accounts that no longer carry the page's ads are zeroed and self-healed.
- **Read-then-max on engagement.** A transient zero from the API never overwrites a stored true value. New posts with no prior value are written as-is.
- **Pagination in chunks.** Post history is paged through completely; per-post insight calls are chunked to avoid Graph API batch failures.
- **Token errors are explicit.** An `OAuthException` that requires re-authorization marks `tokenValid: false` on the token document and shows a reconnect banner instead of a silent stall.

## 4. Diagnosis engine: one source, three consumers

```mermaid
flowchart TB
    R["lib/ads/diagnosis.ts<br/>pure rules: goal thresholds + industry benchmarks"]
    R --> A["Dashboard diagnosis section<br/>client-side, user-selected date range"]
    R --> B["processAlerts<br/>canonical snapshot → bell + email<br/>(critical / warning only)"]
    R --> C["Diagnosis agent cards<br/>Claude tool loop → Haiku fallback<br/>scored by Gemini evaluator"]
    A & B & C --> S["Card state: open / done / skipped<br/>skipped stays silent, done re-notifies on regression"]
```

Stored diagnoses live at `pages/{pageId}/adInsights/latest` and are refreshed by the daily cron, by manual sync, and by the alert cron when the stored copy is older than the last sync.

## 5. AI agent layer

```mermaid
flowchart LR
    subgraph Sidekick["AI Sidekick (claude-sonnet-4-6)"]
        SK["Chat with metricsContext"]
        TL["Tool loop"]
        Tools["Allow-listed tools<br/>read Firestore (page-bounded)<br/>compare_pages<br/>per-post ad metrics"]
        SK --> TL --> Tools
    end

    subgraph Learning["Self-learning loop"]
        Ev["Quality evaluator<br/>gemini-2.5-flash judge, 1–10"]
        FB["Feedback memory<br/>pages/{pageId}/sidekickFeedback"]
        FS7["7-day outcome attribution<br/>vs. page baseline"]
        Few["Few-shot retrieval<br/>gemini-embedding-001"]
        Ev --> FB --> FS7 --> Few
        Few --> SK
    end

    subgraph Ops["Ops agents"]
        BR["Bug reporter<br/>classify → dedupe → notify → GitHub Issue"]
        BF["Bug-fix agent<br/>manual dispatch → edits → PR (humans merge)"]
        OB["Telegram ops bot<br/>/status, /build (owner only)"]
        BR --> BF
    end

    Sidekick --> Ev
    Cost["Monthly spend cap<br/>→ downgrade to Haiku"] --> Sidekick
```

Agents are implemented with the Anthropic SDK directly (tool runner for analysis, Agent SDK for the code-fixing workflow). No LangChain.

## 6. Publishing pipeline

```mermaid
flowchart TB
    D["Draft<br/>captions per platform, media, tags"] --> V["validateDraft<br/>platform limits"]
    V -->|fail| D
    V -->|pass| A["Approved<br/>(human gate)"]
    A -->|Publish now| PR["publishRunner"]
    A -->|Schedule| S["scheduledAt"]
    S --> CF["publishScheduled<br/>Cloud Function, 5 min"] --> PR
    KS["Kill switch + quiet hours"] -.blocks.-> PR
    PR --> TH["Threads<br/>post → wait → reply"]
    PR --> FBp["Facebook<br/>photo / carousel / Reels resumable / story"]
    PR --> IGp["Instagram<br/>container → poll FINISHED → publish"]
    TH & FBp & IGp --> Res["publishResults per platform<br/>full error object kept, no stale merge"]
    Res --> Lock["Published = locked<br/>duplicate as new draft"]
    Res --> Learn["Adoption signal → learning loop"]
```

## 7. Firestore data model

```mermaid
erDiagram
    USERS ||--o{ USER_META_TOKENS : "metaTokens/{pageId}"
    USERS ||--o{ USER_PAGES : "pages/{pageId}"
    USER_PAGES ||--o{ FB_POSTS : "fbPosts"
    USER_PAGES ||--o{ IG_POSTS : "igPosts"
    USER_PAGES ||--o{ IG_STORIES : "igStories"
    USERS ||--o{ NOTIFICATIONS : "notifications/{type__pageId__date}"
    USERS ||--o{ USER_SETTINGS : "settings (apiKeys, pageFolders)"

    PAGES ||--o{ ADMINS : "admins/{uid}"
    PAGES ||--o{ VIEWER_ACCESS : "viewerAccess"
    PAGES ||--|| AD_INSIGHTS : "adInsights/latest"
    PAGES ||--o{ SIDEKICK_CONVERSATIONS : "sidekickConversations"
    PAGES ||--o{ SIDEKICK_FEEDBACK : "sidekickFeedback"
    PAGES ||--o{ CONTENT_DRAFTS : "contentDrafts"
    PAGES ||--o{ BRAND_ASSETS : "brandAssets"
    PAGES ||--o{ INSIGHT_REPORTS : "insightReports (cached narrative)"
    PAGES ||--o{ DM_INBOX : "messages inbox + classifications"

    USERS {
        string uid PK
        string email
        string locale
    }
    USER_META_TOKENS {
        string pageId PK
        string pageName
        string accessToken "encrypted"
        bool tokenValid
    }
    PAGES {
        string pageId PK
        string optimizationGoal "clicks|conversion|reach|event"
        string industry
        string ownerUid
    }
    AD_INSIGHTS {
        object summary
        array diagnosis
        object diagnosisCounts
        timestamp syncedAt
    }
```

### Path conventions

| Path | Scope | Notes |
|---|---|---|
| `users/{uid}/pages/{pageId}/fbPosts`, `igPosts` | Page-scoped | Preferred read path. |
| `users/{uid}/fbPosts`, `igPosts` | Legacy multi-page | Read only as fallback; FB filtered by `${pageId}_` ID prefix; IG never read when `pageId` is known. |
| `pages/{pageId}/...` | Shared per page | Ads, diagnoses, conversations, drafts, admins. Written by the syncing admin, readable by all admins and viewers of that page. |
| `metaWebhookEvents/{mid}` | Top-level | Identifiers only, 30-day TTL. Message bodies go to the page-scoped inbox. |

## 8. Authentication and authorization

```mermaid
flowchart LR
    Login["Firebase Auth<br/>Google or Facebook provider<br/>authDomain = app domain"] --> Token["ID token in every /api call"]
    Token --> Verify["verifyIdToken (Admin SDK)"]
    Verify --> Resolve{"Resolve role for pageId"}
    Resolve -->|"metaTokens/pageId exists"| Admin["Admin / Owner"]
    Resolve -->|"pages/pageId/viewerAccess"| Viewer["Viewer (read-only)"]
    Resolve -->|allow-list| Super["Super-admin (read all)"]
    Resolve -->|none| Deny["403"]
```

Meta OAuth is a separate step after Firebase sign-in. It discovers every page the connecting user manages and stores one page token per page under that user. The first connector of a page is recorded as its owner.

## 9. Repository layout

```text
TM-contentloop/
├─ apps/web/                 # Next.js app: UI + BFF API (main codebase)
│  ├─ app/                   # App Router pages and /api route handlers
│  ├─ components/            # React components (ads/, content/, analytics/ ...)
│  ├─ lib/                   # Pure logic: ads/diagnosis, sidekick/, meta/, publish/, ai/
│  └─ next.config.mjs        # includes /__/auth/* rewrite for same-origin auth
├─ functions/                # Firebase Cloud Functions (publishScheduled)
├─ .github/workflows/        # Cron triggers, bug-fix agent, docs deploy
├─ docs/                     # Planning documents (single source of truth per phase)
├─ site-docs/                # This documentation site (MkDocs)
├─ CLAUDE.md / AGENTS.md     # Project rules for AI collaborators
└─ README.md                 # Project summary + detailed change log
```

## 10. Deployment

```mermaid
flowchart LR
    Dev["Local: tsc + eslint + next build<br/>owner verifies on localhost"] --> Push["git push main"]
    Push --> Vercel["Vercel build + deploy<br/>web app + API"]
    Push --> Docs["GitHub Actions<br/>mkdocs build → GitHub Pages"]
    Fn["functions/ change"] --> FBDeploy["firebase deploy --only functions"]
    Secrets["Secrets: .env.local (local), Vercel env (prod),<br/>Firebase Secret Manager (functions), GitHub Actions secrets (cron)"]
```

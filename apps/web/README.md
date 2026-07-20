# ContentLoop Web

Toastmasters 分會用的 AI 廣告／內容成效儀表板。從 FB 粉專與連動 IG 抓貼文、廣告成效，存入 Firestore，並用 Next.js 儀表板呈現 AI 診斷、洞察報告、AI Sidekick 與通知。

## Project Notes

- Meta Ads MCP 下一階段評估：[docs/meta-ads-mcp-next-phase-plan.md](docs/meta-ads-mcp-next-phase-plan.md)

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## 變更紀錄

- 2026-07-20：AI Sidekick 英文模式增加 English-only / next-week plan repair，並修正長 action item 撐壞對話版面。commit: pending
- 2026-07-20：AI Draft validation 訊息支援英文 UI，避免 App Review 錄影中出現中文警示。commit: ccbe53a
- 2026-07-20：Meta OAuth 授權連接 URL 加上 `locale=en_US`，讓 App Review 錄影優先顯示英文授權流程。commit: included in this commit
- 2026-07-17：新增 Meta Ads MCP 下一階段優化參考，定位為內部研究 / Phase 4 原型工具，不取代正式資料同步與自動化後端。commit: included in this commit

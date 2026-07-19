export default function PrivacyPage() {
  return (
    <main style={{ maxWidth: 680, margin: '0 auto', padding: '48px 24px', fontFamily: 'system-ui, sans-serif', color: '#1e293b', lineHeight: 1.7 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>Privacy Policy</h1>
      <p style={{ fontSize: 13, color: '#64748b', marginBottom: 40 }}>Last updated: July 2026</p>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>1. About ContentLoop</h2>
        <p style={{ fontSize: 14 }}>
          ContentLoop is a social media analytics and content tool that helps page administrators view performance insights for their Facebook Pages and Instagram Business accounts, and — after explicit manual approval — draft and publish posts to their own Pages. We do not sell, rent, or share your personal data with third parties.
        </p>
        <p style={{ fontSize: 14, marginTop: 8 }}>
          ContentLoop is operated by <strong>Pei-Wen Chen</strong> as an individual, who is the data controller responsible for the personal data processed through this service.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>2. Data We Collect</h2>
        <ul style={{ fontSize: 14, paddingLeft: 20 }}>
          <li style={{ marginBottom: 6 }}><strong>Account information:</strong> Your name and email address obtained through Google or Facebook login.</li>
          <li style={{ marginBottom: 6 }}><strong>Page list:</strong> The list of Facebook Pages you manage, so you can select which of your own Pages to view. If your Pages are managed through Meta Business Manager, we also read the list of Pages under that Business Manager for the same purpose — solely to let you find and connect your own Pages, and to verify you manage a Page before showing any of its data. We never modify or claim any business asset or ad account.</li>
          <li style={{ marginBottom: 6 }}><strong>Facebook Page data:</strong> Page access tokens, post content and performance metrics (reach, impressions, views, reactions, comments, shares, clicks), follower counts, and ad-account insights (impressions, clicks, spend, CTR, CPA) — only for Pages you explicitly authorize.</li>
          <li style={{ marginBottom: 6 }}><strong>Instagram data:</strong> Basic profile information, media (posts), post insights, and Story metrics (views, reach, exits) for Instagram Business accounts linked to your authorized Facebook Page.</li>
          <li style={{ marginBottom: 6 }}><strong>Content you create:</strong> Drafts you compose or approve in ContentLoop, and a record of posts published to your own Pages on your behalf after your explicit approval.</li>
          <li style={{ marginBottom: 6 }}><strong>Usage data:</strong> Feature usage logs for improving the service (e.g., number of AI-generated images or videos). We use Google Analytics 4, which sets cookies to measure aggregate product usage such as page views, returning visits, and which features are clicked. This is limited to product-improvement analytics — we do not send your message content, tokens, or the personal data of your Page&apos;s followers to Google Analytics.</li>
        </ul>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>3. How We Use Your Data</h2>
        <ul style={{ fontSize: 14, paddingLeft: 20 }}>
          <li style={{ marginBottom: 6 }}>Display performance analytics on your dashboard</li>
          <li style={{ marginBottom: 6 }}>Provide AI-powered content suggestions and insights</li>
          <li style={{ marginBottom: 6 }}>Publish or schedule posts to your own Facebook Page and linked Instagram Business account — only after you explicitly approve each draft. ContentLoop never publishes automatically.</li>
          <li style={{ marginBottom: 6 }}>Maintain your account and preferences</li>
        </ul>
        <p style={{ fontSize: 14 }}>We do not use your data for advertising or share it with any third parties beyond what is necessary to operate the service.</p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>4. Data Retention</h2>
        <p style={{ fontSize: 14 }}>
          Your data is retained as long as your account is active. You may request deletion of your data at any time by contacting us.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>5. Third-Party Services</h2>
        <p style={{ fontSize: 14 }}>
          ContentLoop uses the following third-party services to operate:
        </p>
        <ul style={{ fontSize: 14, paddingLeft: 20 }}>
          <li style={{ marginBottom: 6 }}>Firebase (Google) — authentication and data storage</li>
          <li style={{ marginBottom: 6 }}>Meta Graph API — fetching Facebook and Instagram insights</li>
          <li style={{ marginBottom: 6 }}>Anthropic Claude API — AI-powered content suggestions</li>
          <li style={{ marginBottom: 6 }}>Google Cloud Vertex AI — AI image and video generation</li>
          <li style={{ marginBottom: 6 }}>Google Analytics 4 (Google) — aggregate product usage analytics (uses cookies)</li>
        </ul>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>6. Your Rights</h2>
        <p style={{ fontSize: 14 }}>
          You may request access to, correction of, or deletion of your personal data at any time. To revoke ContentLoop&apos;s access to your Facebook or Instagram data, you can remove the app from your Facebook settings at any time.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>7. Contact</h2>
        <p style={{ fontSize: 14 }}>
          If you have any questions about this Privacy Policy, please contact Pei-Wen Chen at:{' '}
          <a href="mailto:courage727@gmail.com" style={{ color: '#3B6FD4' }}>courage727@gmail.com</a>
        </p>
      </section>
    </main>
  )
}

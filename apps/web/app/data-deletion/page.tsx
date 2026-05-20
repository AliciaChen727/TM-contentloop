export default function DataDeletionPage() {
  return (
    <main style={{ maxWidth: 680, margin: '0 auto', padding: '48px 24px', fontFamily: 'system-ui, sans-serif', color: '#1e293b', lineHeight: 1.7 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>Data Deletion Instructions</h1>
      <p style={{ fontSize: 13, color: '#64748b', marginBottom: 40 }}>用戶資料刪除說明</p>

      <section style={{ marginBottom: 32 }}>
        <p style={{ fontSize: 14 }}>
          If you would like to delete your personal data associated with ContentLoop, please follow the steps below.
        </p>
        <p style={{ fontSize: 14, marginTop: 8, color: '#64748b' }}>
          如果你希望刪除 ContentLoop 中與你相關的個人資料，請依照以下步驟操作。
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>How to Request Data Deletion</h2>
        <ol style={{ fontSize: 14, paddingLeft: 20 }}>
          <li style={{ marginBottom: 10 }}>
            Send an email to{' '}
            <a href="mailto:courage727@gmail.com" style={{ color: '#3B6FD4' }}>courage727@gmail.com</a>
            {' '}with the subject line: <strong>Data Deletion Request</strong>
          </li>
          <li style={{ marginBottom: 10 }}>
            Include the email address or Facebook account name associated with your ContentLoop account.
          </li>
          <li style={{ marginBottom: 10 }}>
            We will process your request and confirm deletion within <strong>30 days</strong>.
          </li>
        </ol>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>What Will Be Deleted</h2>
        <ul style={{ fontSize: 14, paddingLeft: 20 }}>
          <li style={{ marginBottom: 6 }}>Your account information (name, email)</li>
          <li style={{ marginBottom: 6 }}>Facebook Page access tokens stored by ContentLoop</li>
          <li style={{ marginBottom: 6 }}>Your post performance data and analytics history</li>
          <li style={{ marginBottom: 6 }}>Your preferences and settings</li>
        </ul>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Revoke Facebook Access</h2>
        <p style={{ fontSize: 14 }}>
          You can also immediately revoke ContentLoop&apos;s access to your Facebook account by visiting:{' '}
          <strong>Facebook Settings → Security and Login → Apps and Websites</strong> and removing ContentLoop.
        </p>
      </section>

      <section>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Contact</h2>
        <p style={{ fontSize: 14 }}>
          For any questions, contact us at:{' '}
          <a href="mailto:courage727@gmail.com" style={{ color: '#3B6FD4' }}>courage727@gmail.com</a>
        </p>
      </section>
    </main>
  )
}

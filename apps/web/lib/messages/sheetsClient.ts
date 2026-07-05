// Read a Google Sheet the owner has shared (Viewer) with our service account.
// Same SA-share pattern as GA4 (lib/analytics/gaClient) — no per-user OAuth.
// Requires the Google Sheets API enabled on the GCP project.
import { GoogleAuth } from 'google-auth-library'

/** The SA email the owner must share their sheet with (shown in the UI). */
export function sheetsServiceAccountEmail(): string {
  return process.env.GA_SA_CLIENT_EMAIL || process.env.FIREBASE_ADMIN_CLIENT_EMAIL || ''
}

async function getAccessToken(): Promise<string> {
  const clientEmail = process.env.GA_SA_CLIENT_EMAIL || process.env.FIREBASE_ADMIN_CLIENT_EMAIL || ''
  const privateKey = (process.env.GA_SA_PRIVATE_KEY || process.env.FIREBASE_ADMIN_PRIVATE_KEY || '').replace(/\\n/g, '\n')
  if (!clientEmail || !privateKey) throw new Error('Service Account not configured')
  const auth = new GoogleAuth({
    credentials: { client_email: clientEmail, private_key: privateKey },
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  })
  const token = await auth.getAccessToken()
  if (!token) throw new Error('Failed to obtain Google access token')
  return token
}

export function parseSheetUrl(url: string): { id: string; gid: string | null } | null {
  const idM = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)
  if (!idM) return null
  const gidM = url.match(/[#&?]gid=(\d+)/)
  return { id: idM[1], gid: gidM ? gidM[1] : null }
}

// Read the target tab's cells and flatten to text (tab-separated cells, newline
// rows) so lib/messages/parseSchedule can extract dates wherever they sit.
export async function readSheetAsText(sheetUrl: string): Promise<string> {
  const parsed = parseSheetUrl(sheetUrl)
  if (!parsed) throw new Error('無法辨識 Google Sheet 網址')
  const token = await getAccessToken()
  const authHeader = { Authorization: `Bearer ${token}` }

  // Map gid → tab title (values API needs a title, not a gid).
  const metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${parsed.id}?fields=sheets.properties(sheetId,title)`, { headers: authHeader })
  const meta = await metaRes.json()
  if (!metaRes.ok || meta.error) throw new Error(meta.error?.message ?? '讀取試算表失敗（確認已共享給服務帳號、且已開啟 Sheets API）')
  const sheets: { properties?: { sheetId?: number; title?: string } }[] = meta.sheets ?? []
  const target = parsed.gid != null
    ? sheets.find(s => String(s.properties?.sheetId) === parsed.gid)
    : sheets[0]
  const title = target?.properties?.title ?? sheets[0]?.properties?.title
  if (!title) throw new Error('找不到工作表分頁')

  const range = encodeURIComponent(`'${title}'!A1:Z2000`)
  const valRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${parsed.id}/values/${range}`, { headers: authHeader })
  const val = await valRes.json()
  if (!valRes.ok || val.error) throw new Error(val.error?.message ?? '讀取工作表內容失敗')
  const rows: string[][] = val.values ?? []
  return rows.map(r => r.map(c => String(c ?? '')).join('\t')).join('\n')
}

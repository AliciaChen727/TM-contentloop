'use client'
import { useState } from 'react'

type L = (zh: string, en: string) => string

const EM_URL = 'https://business.facebook.com/events_manager2'

// Full-screen guided wizard for obtaining a Meta Conversions API dataset + token.
// The flow has many Meta-side footguns (App vs Website dataset, which business owns
// the ad account, where the Dataset ID actually is), so each step pins the gotcha.
// Screenshots that contain NO real IDs are embedded as images; the three steps whose
// real screenshots showed account numbers are reproduced as mockups with placeholder
// IDs so nothing private ships in the public bundle.
export function CapiSetupWizard({
  L, configured, onSave, onClose,
}: {
  L: L
  configured: boolean
  onSave: (pixelId: string, token: string) => Promise<{ ok: boolean; msg: string }>
  onClose: () => void
}) {
  const [i, setI] = useState(0)
  const [pixelId, setPixelId] = useState('')
  const [token, setToken] = useState('')
  const [status, setStatus] = useState<'idle' | 'saving' | 'ok' | 'err'>('idle')
  const [msg, setMsg] = useState('')

  async function doSave() {
    if (!pixelId.trim() || !token.trim()) return
    setStatus('saving'); setMsg('')
    const r = await onSave(pixelId.trim(), token.trim())
    setStatus(r.ok ? 'ok' : 'err'); setMsg(r.msg)
  }

  const steps: { title: string; body: React.ReactNode }[] = [
    {
      title: L('第 0 步：先選對「商家組合」', 'Step 0: pick the right Business Portfolio first'),
      body: (
        <>
          <p>{L('最重要、也最常被忽略：你實際投放的廣告帳號掛在哪個商家組合底下，整個流程就要在那個商家情境下做。',
            'Most important and most-missed: whichever Business Portfolio owns the ad account you actually run ads on — do everything under that portfolio.')}</p>
          <Mockup>
            <div className="space-y-1.5">
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px]">
                <b>D67 Toastmasters</b> · <span className="text-red-600">{L('0 個廣告帳號 ⚠️ 不能用', '0 ad accounts ⚠️ unusable')}</span>
              </div>
              <div className="rounded-md border border-green-300 bg-green-50 px-3 py-2 text-[12px]">
                <b>Legacy Toastmasters Club</b> · <span className="text-green-700">{L('✓ 有你的廣告帳號 act_••••••', '✓ owns your ad account act_••••••')}</span>
              </div>
            </div>
          </Mockup>
          <Tip>{L('右上角商家選單 → 選「有廣告帳號」的那個。若選到 0 帳號的商家，之後沒帳號可共用、ROAS 永遠歸不到。',
            'Top-right business switcher → choose the one WITH an ad account. Pick a 0-account portfolio and you’ll have nothing to share to later — ROAS never attributes.')}</Tip>
        </>
      ),
    },
    {
      title: L('第 1 步：舊的資料集多半不能用', 'Step 1: your existing datasets usually can’t be used'),
      body: (
        <>
          <p>{L('開 Events Manager，看你現有的資料集。若它的分頁有「Facebook SDK」、設定頁全是「應用程式編號 / iOS / SKAdNetwork」→ 那是 App 資料集，沒有網站 CAPI 權杖，不能用。',
            'Open Events Manager and look at existing datasets. If a dataset has a “Facebook SDK” tab and its settings are all “App ID / iOS / SKAdNetwork” → it’s an App dataset with no web CAPI token. Unusable.')}</p>
          <Tip>{L('你需要的是「網站」資料集（設定裡有「Conversions API」、沒有「Facebook SDK」分頁）。下一步來建一個。',
            'You need a Website dataset (Settings has “Conversions API”, no “Facebook SDK” tab). Next step creates one.')}</Tip>
          <ExtLink L={L} />
        </>
      ),
    },
    {
      title: L('第 2 步：建一個「網站」資料集', 'Step 2: create a Website dataset'),
      body: (
        <>
          <p>{L('Events Manager 左上角綠色「＋ 連結資料」→ 選「網站」→ 命名（例：ContentLoop Web）→ 類別留空 → 建立。',
            'Events Manager top-left green “＋ Connect data” → choose “Website” → name it (e.g. ContentLoop Web) → leave category blank → Create.')}</p>
          <Tip>{L('若「網站 → 繼續」沒反應：開無痕視窗或關掉廣告攔截器再試（這是 Meta 前端常見 bug）。',
            'If “Website → Continue” does nothing: try an incognito window or disable ad blockers (a common Meta front-end bug).')}</Tip>
        </>
      ),
    },
    {
      title: L('第 3 步：選「設定轉換 API」', 'Step 3: choose “Set up Conversions API”'),
      body: (
        <>
          <p>{L('建好後它問你連結方式 → 選「設定轉換 API」，不是「Meta 像素」（我們不在網站貼程式碼）。',
            'It then asks how to connect → choose “Set up Conversions API”, NOT “Meta Pixel” (we don’t place code on a website).')}</p>
          <Shot src="/guides/capi/step-convapi.png" alt="Set up Conversions API option" />
        </>
      ),
    },
    {
      title: L('第 4 步：選事件', 'Step 4: choose events'),
      body: (
        <>
          <p>{L('勾「完成註冊（CompleteRegistration）」和「購買（Purchase）」即可。其他留著無害——ContentLoop 只會送這兩個。',
            'Check “CompleteRegistration” and “Purchase”. Others are harmless — ContentLoop only sends these two.')}</p>
          <Shot src="/guides/capi/step-events.png" alt="Choose events" />
        </>
      ),
    },
    {
      title: L('第 5 步：事件詳情', 'Step 5: event details'),
      body: (
        <>
          <p>{L('「顧客資料參數」加勾「點擊編號（fbc）」和「用戶端 IP 位址」——這正是 ContentLoop 會送的，配對率最好。',
            'Under “Customer information parameters”, also check “Click ID (fbc)” and “Client IP address” — exactly what ContentLoop sends, for the best match quality.')}</p>
          <Tip>{L('Email / 電話 / 姓名「不要」勾——報名表在第三方，我們拿不到這些。',
            'Do NOT check email / phone / name — the form is on a third party; we don’t have those.')}</Tip>
        </>
      ),
    },
    {
      title: L('第 6 步：產生存取權杖', 'Step 6: generate access token'),
      body: (
        <>
          <p>{L('一路按「繼續」到「查看指示」→ 點「開啟實作指南」（不要按 email 寄送）→ 找「產生存取權杖」→ 按下去 → 立刻複製。',
            'Keep clicking “Continue” to “Review instructions” → “Open implementation guide” (don’t email it) → find “Generate access token” → click → copy immediately.')}</p>
          <Tip>{L('權杖是 EAA 開頭的一長串。Facebook 不會幫你存，關掉就要重產——先貼到記事本備份。',
            'The token is a long string starting with EAA. Facebook won’t store it — back it up to a notepad before closing.')}</Tip>
        </>
      ),
    },
    {
      title: L('第 7 步：與廣告帳號共用', 'Step 7: share with your ad account'),
      body: (
        <>
          <p>{L('把這個網站資料集分享給「實際跑廣告的帳號」，ROAS 才歸得到。',
            'Share this Website dataset with the ad account you actually run ads on — required for ROAS to attribute.')}</p>
          <Mockup>
            <div className="text-[12px] font-semibold text-gray-700">{L('選擇要與此資料集連結的廣告帳號', 'Choose the ad account to link')}</div>
            <label className="mt-2 flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-[12px]">
              <input type="checkbox" checked readOnly className="accent-blue-600" />
              <span>{L('你的廣告帳號 act_••••••••', 'Your ad account act_••••••••')}</span>
            </label>
          </Mockup>
        </>
      ),
    },
    {
      title: L('第 8 步：找 Dataset ID 並完成', 'Step 8: find the Dataset ID & finish'),
      body: (
        <>
          <p>{L('Dataset ID 在「網址列」最準——看 implementation_instructions/ 後面、? 前面那串：',
            'The Dataset ID is most reliable in the URL bar — the part after implementation_instructions/ and before ?:')}</p>
          <Mockup>
            <div className="break-all rounded-md bg-gray-900 px-3 py-2 font-mono text-[11px] text-gray-200">
              …/implementation_instructions/<span className="rounded bg-green-600/80 px-1 text-white">{L('你的 Dataset ID', 'YOUR_DATASET_ID')}</span>?business_id=<span className="rounded bg-red-500/70 px-1 text-white">{L('商家ID·不是這個', 'business_id · NOT this')}</span>
            </div>
          </Mockup>
          <Tip>{L('別把 business_id、應用程式編號（App ID）、擁有者編號當成 Dataset ID——都不是。',
            'Don’t mistake business_id, App ID, or owner ID for the Dataset ID — none of them are.')}</Tip>

          <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
            <label className="mb-1 block text-xs font-semibold text-gray-600">Pixel / Dataset ID</label>
            <input value={pixelId} onChange={e => setPixelId(e.target.value)} placeholder="1234567890"
              className="mb-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            <label className="mb-1 block text-xs font-semibold text-gray-600">Conversions API access token</label>
            <input value={token} onChange={e => setToken(e.target.value)} type="password"
              placeholder={configured ? L('（已儲存，留空不變）', '(saved — leave blank to keep)') : 'EAAB...'}
              className="mb-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            {msg && <p className={`mb-2 text-xs ${status === 'ok' ? 'text-green-600' : 'text-red-500'}`}>{msg}</p>}
            <button onClick={doSave} disabled={status === 'saving' || !pixelId.trim() || !token.trim()}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:bg-gray-300">
              {status === 'saving' ? L('測試連線中…', 'Testing…') : L('儲存並測試連線', 'Save & test connection')}
            </button>
            <p className="mt-2 text-[11px] text-amber-600">
              {L('⚠️ 一定要在正式站 (tm-contentloop.vercel.app) 設定，localhost 存的正式站解不開。',
                '⚠️ Set this up on production (tm-contentloop.vercel.app); values saved on localhost won’t decrypt on prod.')}
            </p>
          </div>
        </>
      ),
    },
  ]

  const last = i === steps.length - 1
  const step = steps[i]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-xl flex-col rounded-2xl bg-white shadow-xl" onClick={e => e.stopPropagation()}>
        {/* Header + progress */}
        <div className="border-b border-gray-100 px-5 pt-4 pb-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-gray-800">🧭 {L('Meta 轉換回報設定精靈', 'Meta Conversion Setup Wizard')}</span>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-700">✕</button>
          </div>
          <div className="mt-3 flex gap-1">
            {steps.map((_, n) => (
              <div key={n} className={`h-1.5 flex-1 rounded-full ${n <= i ? 'bg-blue-600' : 'bg-gray-200'}`} />
            ))}
          </div>
          <div className="mt-1 text-[11px] text-gray-400">{i + 1} / {steps.length}</div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <h3 className="mb-2 text-base font-bold text-gray-900">{step.title}</h3>
          <div className="space-y-3 text-[13px] leading-relaxed text-gray-700">{step.body}</div>
        </div>

        {/* Footer nav */}
        <div className="flex items-center justify-between border-t border-gray-100 px-5 py-3">
          <button onClick={() => setI(n => Math.max(0, n - 1))} disabled={i === 0}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-500 disabled:opacity-40">
            ← {L('上一步', 'Back')}
          </button>
          {!last ? (
            <button onClick={() => setI(n => Math.min(steps.length - 1, n + 1))}
              className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white">
              {L('下一步', 'Next')} →
            </button>
          ) : (
            <button onClick={onClose} className="rounded-lg bg-gray-800 px-4 py-1.5 text-sm font-semibold text-white">
              {L('完成', 'Done')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function Tip({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">💡 {children}</div>
}

function Mockup({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">{children}</div>
}

function ExtLink({ L }: { L: L }) {
  return (
    <a href={EM_URL} target="_blank" rel="noopener noreferrer"
      className="inline-block rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-[12px] font-semibold text-blue-700 hover:bg-blue-100">
      {L('開啟 Events Manager ↗', 'Open Events Manager ↗')}
    </a>
  )
}

function Shot({ src, alt }: { src: string; alt: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className="w-full rounded-lg border border-gray-200" />
}

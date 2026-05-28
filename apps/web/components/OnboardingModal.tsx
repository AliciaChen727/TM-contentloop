'use client'

import { useState } from 'react'

export type OptimizationGoal = 'clicks' | 'conversion' | 'reach' | 'event'
export type Industry = 'ecommerce' | 'education' | 'event' | 'personal_brand' | 'other'

interface Props {
  idToken: string
  onDone: () => void
}

type Submission = { skip: true } | { skip: false; optimizationGoal: OptimizationGoal; industry: Industry }

const GOAL_OPTIONS: { value: OptimizationGoal; title: string; desc: string }[] = [
  { value: 'clicks', title: '提升點擊率', desc: '主推 CTR、CPC、連結點擊數' },
  { value: 'conversion', title: '提升轉換與 ROI', desc: '主推 ROAS、CPA、轉換數' },
  { value: 'reach', title: '擴大品牌觸及', desc: '主推 CPM、觸及人數、曝光次數' },
  { value: 'event', title: '活動報名推廣', desc: '主推 CTR、CPL、連結頁面瀏覽' },
]

const INDUSTRY_OPTIONS: { value: Industry; title: string }[] = [
  { value: 'ecommerce', title: '電商 / 零售' },
  { value: 'education', title: '課程 / 教育訓練' },
  { value: 'event', title: '活動 / 社群組織' },
  { value: 'personal_brand', title: '個人品牌 / 自媒體' },
  { value: 'other', title: '其他' },
]

export function OnboardingModal({ idToken, onDone }: Props) {
  const [step, setStep] = useState<1 | 2>(1)
  const [goal, setGoal] = useState<OptimizationGoal | null>(null)
  const [industry, setIndustry] = useState<Industry | null>(null)
  const [saving, setSaving] = useState(false)

  async function save(payload: Submission) {
    setSaving(true)
    const body = payload.skip ? { skip: true } : { optimizationGoal: payload.optimizationGoal, industry: payload.industry }
    const res = await fetch('/api/user/onboarding', {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    setSaving(false)
    if (res.ok) onDone()
  }

  function handleNext() {
    if (step === 1 && goal) setStep(2)
    else if (step === 2 && goal && industry) save({ skip: false, optimizationGoal: goal, industry })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl">
        <div className="border-b border-gray-100 px-6 py-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-400">Step {step} / 2</span>
            <div className="flex gap-1">
              <span className={`h-1.5 w-8 rounded-full ${step >= 1 ? 'bg-blue-500' : 'bg-gray-200'}`} />
              <span className={`h-1.5 w-8 rounded-full ${step >= 2 ? 'bg-blue-500' : 'bg-gray-200'}`} />
            </div>
          </div>
        </div>

        <div className="px-6 py-5">
          {step === 1 ? (
            <>
              <h2 className="text-lg font-bold text-gray-900">你最在乎哪個廣告目標？</h2>
              <p className="mt-1 mb-4 text-sm text-gray-500">我們會根據你的目標，推薦最重要的成效指標</p>
              <div className="space-y-2">
                {GOAL_OPTIONS.map(opt => {
                  const active = goal === opt.value
                  return (
                    <button
                      key={opt.value}
                      onClick={() => setGoal(opt.value)}
                      className={`w-full rounded-xl border p-3 text-left transition ${active ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white hover:border-gray-300'}`}
                    >
                      <div className={`text-sm font-semibold ${active ? 'text-blue-700' : 'text-gray-800'}`}>{opt.title}</div>
                      <div className="mt-0.5 text-xs text-gray-500">{opt.desc}</div>
                    </button>
                  )
                })}
              </div>
            </>
          ) : (
            <>
              <h2 className="text-lg font-bold text-gray-900">你的粉專主要經營什麼？</h2>
              <p className="mt-1 mb-4 text-sm text-gray-500">幫助 AI Sidekick 給出更精準的診斷建議</p>
              <div className="space-y-2">
                {INDUSTRY_OPTIONS.map(opt => {
                  const active = industry === opt.value
                  return (
                    <button
                      key={opt.value}
                      onClick={() => setIndustry(opt.value)}
                      className={`w-full rounded-xl border p-3 text-left transition ${active ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white hover:border-gray-300'}`}
                    >
                      <div className={`text-sm font-semibold ${active ? 'text-blue-700' : 'text-gray-800'}`}>{opt.title}</div>
                    </button>
                  )
                })}
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-gray-100 px-6 py-4">
          <button
            onClick={() => save({ skip: true })}
            disabled={saving}
            className="text-sm text-gray-500 hover:text-gray-700 disabled:opacity-40"
          >
            跳過
          </button>
          <div className="flex gap-2">
            {step === 2 && (
              <button
                onClick={() => setStep(1)}
                disabled={saving}
                className="rounded-lg px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50"
              >
                上一步
              </button>
            )}
            <button
              onClick={handleNext}
              disabled={saving || (step === 1 ? !goal : !industry)}
              className="rounded-lg bg-[#1877F2] px-5 py-2 text-sm font-semibold text-white hover:bg-[#166FE5] disabled:opacity-40"
            >
              {step === 1 ? '下一步' : saving ? '儲存中⋯' : '完成'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

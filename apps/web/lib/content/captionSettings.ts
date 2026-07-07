// AI caption settings (Agent 自動發布). Pure config — shared by the settings
// UI (CaptionSettings.tsx) and the caption API prompt builder. Grounds AI copy
// in the page's goal, tone, required facts (industry-customized), language, CTA.
// See docs/agent-auto-publish-plan.md.

import type { Industry } from '@/lib/profile-types'

export type CopyGoal = 'signups' | 'awareness' | 'sales' | 'brand'

export interface CaptionSettings {
  tone: string
  goal: CopyGoal
  language: 'zh' | 'en'
  cta: string
  info: Record<string, string>   // required-info field values (industry-specific)
}

// Copy goals — each carries suggested CTAs so the CTA stays aligned with intent.
export const COPY_GOALS: { key: CopyGoal; zh: string; en: string; ctas: string[]; ctasEn: string[] }[] = [
  { key: 'signups',   zh: '增加報名轉換', en: 'Drive sign-ups',   ctas: ['立即報名', '私訊報名', '報名連結在下方'], ctasEn: ['Sign up now', 'DM to register', 'Link below'] },
  { key: 'sales',     zh: '增加商品銷售', en: 'Drive sales',      ctas: ['立即購買', '下單連結在下方', '把握限時優惠'], ctasEn: ['Shop now', 'Order link below', 'Limited offer'] },
  { key: 'awareness', zh: '增加曝光互動', en: 'Grow reach',       ctas: ['追蹤我們', '留言分享你的想法', '標記一位朋友'], ctasEn: ['Follow us', 'Comment below', 'Tag a friend'] },
  { key: 'brand',     zh: '建立品牌形象', en: 'Build brand',      ctas: ['了解更多', '認識我們'], ctasEn: ['Learn more', 'Get to know us'] },
]

export const TONE_PRESETS: { zh: string; en: string }[] = [
  { zh: '溫暖鼓勵', en: 'Warm & encouraging' },
  { zh: '專業正式', en: 'Professional' },
  { zh: '活潑俏皮', en: 'Playful' },
  { zh: '簡潔有力', en: 'Punchy & concise' },
  { zh: '故事感', en: 'Storytelling' },
]

export interface RequiredField { key: string; zh: string; en: string; placeholder?: string }

// Required-info fields customized per industry (image/product/event facts the AI
// should weave in — never invent). Falls back to `other` for unknown industries.
export const INDUSTRY_FIELDS: Record<Industry, RequiredField[]> = {
  ecommerce: [
    { key: 'product', zh: '商品名稱', en: 'Product name' },
    { key: 'price', zh: '價格', en: 'Price', placeholder: 'NT$…' },
    { key: 'features', zh: '商品特色', en: 'Key features' },
    { key: 'promo', zh: '優惠 / 折扣', en: 'Promo / discount' },
  ],
  education: [
    { key: 'course', zh: '課程名稱', en: 'Course name' },
    { key: 'host', zh: '講師 / 主辦', en: 'Instructor / host' },
    { key: 'time', zh: '時間', en: 'Time' },
    { key: 'fee', zh: '費用', en: 'Fee' },
    { key: 'highlight', zh: '課程亮點', en: 'Highlights' },
  ],
  event: [
    { key: 'event', zh: '活動名稱', en: 'Event name' },
    { key: 'place', zh: '地點', en: 'Location' },
    { key: 'time', zh: '時間', en: 'Time' },
    { key: 'fee', zh: '費用', en: 'Fee', placeholder: '免費 / NT$…' },
    { key: 'highlight', zh: '活動亮點', en: 'Highlights' },
  ],
  personal_brand: [
    { key: 'topic', zh: '主題', en: 'Topic' },
    { key: 'highlight', zh: '亮點 / 賣點', en: 'Hook / value' },
    { key: 'link', zh: '連結', en: 'Link' },
  ],
  other: [
    { key: 'name', zh: '名稱', en: 'Name' },
    { key: 'info', zh: '重點資訊', en: 'Key info' },
  ],
}

export function fieldsForIndustry(industry?: Industry | null): RequiredField[] {
  return INDUSTRY_FIELDS[industry ?? 'other'] ?? INDUSTRY_FIELDS.other
}

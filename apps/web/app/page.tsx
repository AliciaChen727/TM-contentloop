import type { Metadata } from 'next'
import HomeClient from './home-client'

const BASE = 'https://tm-contentloop.vercel.app'

const META = {
  zh: {
    title: 'ContentLoop — AI 廣告與內容成效儀表板',
    description:
      '自動抓取 FB 粉專與 IG 的貼文、廣告與限動成效，用 AI 診斷問題、生成洞察報告、提供可執行建議，讓你少花時間對數字、多花時間做對的內容。',
  },
  en: {
    title: 'ContentLoop — AI Ad & Content Performance Dashboard',
    description:
      'Automatically pull performance data from your FB Page and IG posts, ads, and stories. Let AI diagnose issues, generate insight reports, and deliver actionable advice—so you spend less time crunching numbers and more time creating the right content.',
  },
} as const

type Props = { searchParams: { lang?: string } }

function resolveLang(searchParams: Props['searchParams']): 'zh' | 'en' {
  return searchParams.lang === 'en' ? 'en' : 'zh'
}

export function generateMetadata({ searchParams }: Props): Metadata {
  const lang = resolveLang(searchParams)
  const m = META[lang]
  return {
    title: m.title,
    description: m.description,
    alternates: {
      // 各語言版本的標準連結，並提供 hreflang 讓搜尋引擎索引到正確語言。
      canonical: lang === 'en' ? `${BASE}/?lang=en` : `${BASE}/`,
      languages: {
        'zh-Hant': `${BASE}/?lang=zh`,
        en: `${BASE}/?lang=en`,
        'x-default': `${BASE}/`,
      },
    },
    openGraph: {
      title: m.title,
      description: m.description,
      url: lang === 'en' ? `${BASE}/?lang=en` : BASE,
      locale: lang === 'en' ? 'en_US' : 'zh_TW',
      type: 'website',
    },
  }
}

export default function Page({ searchParams }: Props) {
  return <HomeClient initialLang={resolveLang(searchParams)} />
}

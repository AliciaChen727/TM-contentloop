// Fetch a page's best-performing past posts as style few-shot for AI caption
// generation. STRICTLY page-scoped (reads the owner's pages/{pageId}/fbPosts|
// igPosts only — never legacy multi-page collections) per CLAUDE.md isolation.
// Returns short caption snippets, highest engagement first, for the model to
// learn voice/structure from — NOT to copy.

import { adminDb } from '@/lib/firebase/admin'
import { resolvePageOwnerUid } from '@/lib/auth/superadmin'

const SCAN = 60          // recent posts to score per platform
const SNIPPET = 280      // max chars per example

interface Example { text: string; score: number; platform: 'FB' | 'IG' }

function snippet(s: string): string {
  const clean = (s ?? '').replace(/\s+/g, ' ').trim()
  return clean.length > SNIPPET ? `${clean.slice(0, SNIPPET)}…` : clean
}

export async function fetchTopPostExamples(pageId: string, limit = 4): Promise<string[]> {
  const ownerUid = await resolvePageOwnerUid(pageId)
  if (!ownerUid) return []
  const pageRef = adminDb.collection('users').doc(ownerUid).collection('pages').doc(pageId)

  const [fbSnap, igSnap] = await Promise.all([
    pageRef.collection('fbPosts').orderBy('createdTime', 'desc').limit(SCAN).get().catch(() => null),
    pageRef.collection('igPosts').orderBy('timestamp', 'desc').limit(SCAN).get().catch(() => null),
  ])

  const examples: Example[] = []
  for (const d of fbSnap?.docs ?? []) {
    const data = d.data()
    const text = data.message ?? ''
    if (!text.trim()) continue
    const i = data.insights ?? {}
    examples.push({ text, platform: 'FB', score: (i.reactions ?? 0) + (i.comments ?? 0) + (i.shares ?? 0) })
  }
  for (const d of igSnap?.docs ?? []) {
    const data = d.data()
    const text = data.caption ?? ''
    if (!text.trim()) continue
    const i = data.insights ?? {}
    examples.push({ text, platform: 'IG', score: (i.likes ?? 0) + (i.comments ?? 0) + (i.shares ?? 0) + (i.saved ?? 0) })
  }

  return examples
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(e => snippet(e.text))
    .filter(Boolean)
}

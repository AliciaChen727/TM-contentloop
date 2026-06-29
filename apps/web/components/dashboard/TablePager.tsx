'use client'

import { useLang } from '@/lib/i18n/LanguageProvider'

// Shared footer pager for the dashboard post tables. Pagination is client-side over the
// already-fetched (date-range-bounded) rows — 200 per page. Sorting happens before paging
// in the parent table, so the pager always reflects the current sort order.
export function TablePager({ page, pageSize, total, onPage }: {
  page: number; pageSize: number; total: number; onPage: (p: number) => void
}) {
  const { L } = useLang()
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)

  const btn = (disabled: boolean): React.CSSProperties => ({
    padding: '3px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600,
    border: '1px solid var(--ad-border)', background: 'var(--ad-surface)',
    color: disabled ? 'var(--ad-text3)' : 'var(--ad-blue)',
    cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1,
  })

  return (
    <div style={{ padding: '10px 16px', borderTop: '1px solid var(--ad-border)', fontSize: 11.5, color: 'var(--ad-text3)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
      <span>{L(`共 ${total} 筆，顯示 ${from}–${to}`, `${total} records · showing ${from}–${to}`)}</span>
      {pageCount > 1 && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <button style={btn(page <= 1)} disabled={page <= 1} onClick={() => onPage(page - 1)}>← {L('上一頁', 'Prev')}</button>
          <span style={{ color: 'var(--ad-text2)', fontWeight: 600 }}>{L(`第 ${page} / ${pageCount} 頁`, `Page ${page} / ${pageCount}`)}</span>
          <button style={btn(page >= pageCount)} disabled={page >= pageCount} onClick={() => onPage(page + 1)}>{L('下一頁', 'Next')} →</button>
        </span>
      )}
    </div>
  )
}

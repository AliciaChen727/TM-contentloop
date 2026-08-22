import { describe, it, expect } from 'vitest'
import { formatMetaError, mediaName } from './publishIg'

describe('formatMetaError', () => {
  // 2026-08-17 實際發生：IG 輪播發布失敗，Firestore / bug 回報 / UI 三處都只存到 "Fatal"，
  // 完全無從追查。修復後至少要保住 code 與 fbtrace_id。
  it('保留 code 與 fbtrace_id（Fatal 回歸案例）', () => {
    const out = formatMetaError({
      error: { message: 'Fatal', type: 'OAuthException', code: -1, fbtrace_id: 'AbC123xyz' },
    }, 400)
    expect(out).toContain('Fatal')
    expect(out).toContain('code -1')
    expect(out).toContain('trace AbC123xyz')
    expect(out).toContain('OAuthException')
  })

  it('error_user_title / error_user_msg 優先於無資訊量的 message', () => {
    const out = formatMetaError({
      error: {
        message: 'Fatal',
        error_user_title: '媒體格式不支援',
        error_user_msg: '圖片長寬比需介於 4:5 與 1.91:1 之間',
        code: 36003,
      },
    })
    expect(out.startsWith('媒體格式不支援')).toBe(true)
    expect(out).toContain('4:5')
    expect(out).toContain('code 36003')
    expect(out).toContain('Fatal')   // 原始 message 仍保留，不吞掉
  })

  it('不重複輸出同一句話', () => {
    const out = formatMetaError({ error: { message: '同一句', error_user_msg: '同一句', code: 1 } })
    expect(out.match(/同一句/g)?.length).toBe(1)
  })

  it('沒有 error 物件時退回 HTTP 狀態碼', () => {
    expect(formatMetaError({}, 503)).toBe('ig 503')
    expect(formatMetaError({})).toBe('ig request failed')
  })

  it('只有 message 時不硬塞空括號', () => {
    expect(formatMetaError({ error: { message: '單純錯誤' } })).toBe('單純錯誤')
  })
})

describe('mediaName', () => {
  it('從 Firebase Storage URL 取出檔名', () => {
    const u = 'https://firebasestorage.googleapis.com/v0/b/contentloop-dev.firebasestorage.app/o/uploads%2Fuid%2Fdrafts%2F1786859885766-IMG_1234.jpg?alt=media&token=abc'
    expect(mediaName(u)).toBe('1786859885766-IMG_1234.jpg')
  })

  it('URL 壞掉時退回尾段而不是 throw', () => {
    expect(mediaName('not a url')).toBe('not a url')
  })
})

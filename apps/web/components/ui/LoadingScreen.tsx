'use client'

import { useEffect, useRef } from 'react'
import { useLang } from '@/lib/i18n/LanguageProvider'

// Motion Prompt #126 · MIT License (c) 2026 Shohei Ohtaki · https://showheyohtaki.github.io/motion-prompt/#126
// Adapted: stage background dropped and colours swapped for the light dashboard theme.
const W = 539
const H = 208
const CYCLE_MS = 4700
const STATIC_PROGRESS = 0.7 // shown instead of the animation under prefers-reduced-motion
const COLORS = { path: '#CFCAC2', trail: '#4FC9A4', wingTop: '#3B6FD4', wingBottom: '#C2D4F5', fold: '#2A54AB' }

const pathX = (th: number) => 270 + 112 * th - 150 * Math.sin(th)
const pathY = (th: number) => 106 - 74 * Math.cos(th)

function drawFrame(k: CanvasRenderingContext2D, progress: number) {
  k.clearRect(0, 0, W, H)

  k.save()
  k.setLineDash([2, 15])
  k.lineCap = 'round'
  k.strokeStyle = COLORS.path
  k.lineWidth = 6
  k.beginPath()
  for (let i = 0; i <= 400; i++) {
    const th = -Math.PI + (2 * Math.PI * i) / 400
    if (i) k.lineTo(pathX(th), pathY(th))
    else k.moveTo(pathX(th), pathY(th))
  }
  k.stroke()
  k.restore()

  const th = -Math.PI + 2 * Math.PI * progress

  k.save()
  k.lineCap = 'round'
  k.strokeStyle = COLORS.trail
  for (let j = 0; j < 24; j++) {
    const a = th - j * 0.03
    const b = th - (j + 1) * 0.03
    k.globalAlpha = 0.9 * (1 - j / 24)
    k.lineWidth = 7 * (1 - j / 30)
    k.beginPath()
    k.moveTo(pathX(a), pathY(a))
    k.lineTo(pathX(b), pathY(b))
    k.stroke()
  }
  k.restore()

  k.save()
  k.translate(pathX(th), pathY(th))
  k.rotate(Math.atan2(74 * Math.sin(th), 112 - 150 * Math.cos(th)))
  k.fillStyle = COLORS.wingTop
  k.beginPath(); k.moveTo(32, 0); k.lineTo(-22, -22); k.lineTo(-12, 0); k.closePath(); k.fill()
  k.fillStyle = COLORS.wingBottom
  k.beginPath(); k.moveTo(32, 0); k.lineTo(-22, 22); k.lineTo(-12, 0); k.closePath(); k.fill()
  k.fillStyle = COLORS.fold
  k.beginPath(); k.moveTo(32, 0); k.lineTo(-12, 0); k.lineTo(-6, 9); k.closePath(); k.fill()
  k.restore()
}

function PlaneMotionPath() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const k = canvasRef.current?.getContext('2d')
    if (!k) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      drawFrame(k, STATIC_PROGRESS)
      return
    }
    let raf = 0
    const tick = (now: number) => {
      drawFrame(k, (now % CYCLE_MS) / CYCLE_MS)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  return <canvas ref={canvasRef} className="cl-loading-canvas" width={W} height={H} aria-hidden="true" />
}

// Friendly loading state: a paper plane loops along a dotted path while the label
// stays clearly readable. Drop inside any centered container (or use fullscreen).
export function LoadingScreen({ label, fullscreen = false }: { label?: string; fullscreen?: boolean }) {
  const { L } = useLang()
  const body = (
    <div className="cl-loading">
      <PlaneMotionPath />
      <p className="cl-loading-text">{label ?? L('載入中', 'Loading')}</p>
    </div>
  )
  if (!fullscreen) return body
  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50">{body}</main>
  )
}

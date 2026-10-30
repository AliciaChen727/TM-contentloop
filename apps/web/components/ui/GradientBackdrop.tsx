'use client'

import { useEffect, useRef } from 'react'

// Motion Prompt #095 · MIT License (c) 2026 Shohei Ohtaki · https://showheyohtaki.github.io/motion-prompt/#095
// Adapted: headline and button dropped; the canvas stretches to fill its positioned parent.
// Gradients are smooth, so a small backing canvas scaled up by CSS keeps full-screen use cheap.
const W = 539
const H = 208
const CYCLE_MS = 4800
const BASE = '#FFF1EB'
const BLOBS: [color: string, x: number, y: number, r: number, ax: number, ay: number, phase: number][] = [
  ['#FF6B35', 150, 60, 230, 70, 30, 0],
  ['#FFB08F', 380, 40, 210, 60, 40, 2.1],
  ['#3B6FD4', 330, 150, 240, 80, 30, 4.2],
  ['#9DB6FB', 90, 170, 200, 50, 35, 1.0],
]

function drawFrame(k: CanvasRenderingContext2D, angle: number) {
  k.globalAlpha = 1
  k.fillStyle = BASE
  k.fillRect(0, 0, W, H)
  k.globalAlpha = 0.85
  for (const [color, x0, y0, r, ax, ay, phase] of BLOBS) {
    const x = x0 + ax * Math.cos(angle + phase)
    const y = y0 + ay * Math.sin(angle + phase)
    const g = k.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, color)
    g.addColorStop(1, 'rgba(255,255,255,0)')
    k.fillStyle = g
    k.fillRect(0, 0, W, H)
  }
}

// Decorative floating gradient. Parent must be positioned with overflow-hidden (the canvas
// overscans so the blur has no soft edge); content above it needs `relative`.
export function GradientBackdrop({ className = '' }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const k = canvasRef.current?.getContext('2d')
    if (!k) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      drawFrame(k, 0)
      return
    }
    let raf = 0
    const tick = (now: number) => {
      drawFrame(k, (2 * Math.PI * (now % CYCLE_MS)) / CYCLE_MS)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <canvas
      ref={canvasRef}
      width={W}
      height={H}
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover blur-2xl ${className}`}
    />
  )
}

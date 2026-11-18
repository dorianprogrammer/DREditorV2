import { FONT_FAMILIES, type Frame, type TextItem, type TransitionKind } from '@shared/project'

type Ctx = CanvasRenderingContext2D
export type Media = HTMLVideoElement | HTMLImageElement

export function mediaSize(el: Media): { w: number; h: number } {
  if (el instanceof HTMLVideoElement) return { w: el.videoWidth, h: el.videoHeight }
  return { w: el.naturalWidth, h: el.naturalHeight }
}

export const isDrawable = (el: Media | undefined): el is Media => {
  if (!el) return false
  const { w, h } = mediaSize(el)
  return w > 0 && h > 0
}

const blurCanvas = document.createElement('canvas')

/**
 * Draws media fitted inside the frame (9:16 or 16:9) over a blurred, darker copy of itself,
 * matching the ffmpeg export (scale down, blur, scale up, darken).
 */
export function drawFitted(ctx: Ctx, el: Media, W: number, H: number): void {
  const { w, h } = mediaSize(el)
  if (!w || !h) return
  // A tiny canvas with the frame's shape: drawing into it and scaling it up gives a cheap blur.
  const [bw, bh] = W < H ? [27, 48] : [48, 27]
  if (blurCanvas.width !== bw || blurCanvas.height !== bh) {
    blurCanvas.width = bw
    blurCanvas.height = bh
  }
  const b = blurCanvas.getContext('2d')!
  const cover = Math.max(blurCanvas.width / w, blurCanvas.height / h)
  b.drawImage(el, (blurCanvas.width - w * cover) / 2, (blurCanvas.height - h * cover) / 2, w * cover, h * cover)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(blurCanvas, 0, 0, W, H)
  ctx.fillStyle = 'rgba(0,0,0,0.22)'
  ctx.fillRect(0, 0, W, H)
  const fit = Math.min(W / w, H / h)
  ctx.drawImage(el, (W - w * fit) / 2, (H - h * fit) / 2, w * fit, h * fit)
}

/** Draws a transition between A (outgoing) and B (incoming) at progress p (0..1), like ffmpeg's xfade. */
export function drawTransition(
  ctx: Ctx,
  kind: TransitionKind,
  p: number,
  drawA: () => void,
  drawB: () => void,
  W: number,
  H: number
): void {
  const ease = p
  switch (kind) {
    case 'fade':
      drawA()
      ctx.save()
      ctx.globalAlpha = ease
      drawB()
      ctx.restore()
      break
    case 'slide':
      ctx.save()
      ctx.translate(-W * ease, 0)
      drawA()
      ctx.restore()
      ctx.save()
      ctx.translate(W * (1 - ease), 0)
      drawB()
      ctx.restore()
      break
    case 'circle': {
      drawA()
      ctx.save()
      ctx.beginPath()
      ctx.arc(W / 2, H / 2, (Math.hypot(W, H) / 2) * ease, 0, Math.PI * 2)
      ctx.clip()
      drawB()
      ctx.restore()
      break
    }
    case 'zoom':
      drawB()
      ctx.save()
      ctx.globalAlpha = 1 - ease
      ctx.translate(W / 2, H / 2)
      ctx.scale(1 + ease, 1 + ease)
      ctx.translate(-W / 2, -H / 2)
      drawA()
      ctx.restore()
      break
    default:
      drawB()
  }
}

// ---------- Text ----------

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export const contrastOn = (hex: string): string => (luminance(hex) > 0.35 ? '#111111' : '#ffffff')

interface TextLayout {
  lines: string[]
  lineH: number
  widths: number[]
  /** Bounding box in canvas pixels. */
  box: { x: number; y: number; w: number; h: number }
}

function fontFor(t: TextItem, px: number): string {
  const weight = t.font === 'bold' || t.font === 'impact' ? 400 : 700
  return `${weight} ${px}px ${FONT_FAMILIES[t.font]}`
}

function wrap(ctx: Ctx, text: string, maxW: number): string[] {
  const out: string[] = []
  for (const para of text.split('\n')) {
    const words = para.split(/\s+/).filter(Boolean)
    if (!words.length) {
      out.push('')
      continue
    }
    let line = words[0]
    for (const w of words.slice(1)) {
      const test = `${line} ${w}`
      if (ctx.measureText(test).width <= maxW) line = test
      else {
        out.push(line)
        line = w
      }
    }
    out.push(line)
  }
  return out
}

export function layoutText(ctx: Ctx, t: TextItem, scale: number, frame: Frame): TextLayout {
  const px = t.size * scale
  ctx.font = fontFor(t, px)
  const lines = wrap(ctx, t.text || ' ', frame.w * 0.86 * scale)
  const widths = lines.map((l) => ctx.measureText(l).width)
  const lineH = px * 1.18
  const pad = t.style === 'box' ? px * 0.3 : px * 0.12
  const w = Math.max(...widths, px) + pad * 2
  const h = lines.length * lineH + pad * 2
  const cx = t.x * frame.w * scale
  const cy = t.y * frame.h * scale
  return { lines, lineH, widths, box: { x: cx - w / 2, y: cy - h / 2, w, h } }
}

export function drawText(ctx: Ctx, t: TextItem, scale: number, frame: Frame): void {
  const L = layoutText(ctx, t, scale, frame)
  const px = t.size * scale
  const cx = t.x * frame.w * scale
  const top = t.y * frame.h * scale - (L.lines.length * L.lineH) / 2
  ctx.save()
  ctx.font = fontFor(t, px)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  ctx.miterLimit = 2

  L.lines.forEach((line, i) => {
    const y = top + L.lineH * (i + 0.5)
    if (t.style === 'box') {
      if (!line) return
      const padX = px * 0.28
      const w = L.widths[i] + padX * 2
      const h = L.lineH + px * 0.08
      ctx.fillStyle = t.color
      ctx.beginPath()
      ctx.roundRect(cx - w / 2, y - h / 2, w, h, px * 0.22)
      ctx.fill()
      ctx.fillStyle = contrastOn(t.color)
      ctx.fillText(line, cx, y + px * 0.04)
    } else if (t.style === 'outline') {
      ctx.strokeStyle = luminance(t.color) < 0.05 ? '#ffffff' : '#111111'
      ctx.lineWidth = px * 0.16
      ctx.strokeText(line, cx, y)
      ctx.fillStyle = t.color
      ctx.fillText(line, cx, y)
    } else {
      ctx.shadowColor = 'rgba(0,0,0,0.75)'
      ctx.shadowBlur = px * 0.22
      ctx.shadowOffsetY = px * 0.06
      ctx.fillStyle = t.color
      ctx.fillText(line, cx, y)
    }
  })
  ctx.restore()
}

export function drawSelectionBox(ctx: Ctx, t: TextItem, scale: number, frame: Frame): void {
  const { box } = layoutText(ctx, t, scale, frame)
  ctx.save()
  ctx.strokeStyle = '#ffd23f'
  ctx.lineWidth = 3
  ctx.setLineDash([10, 8])
  ctx.strokeRect(box.x - 6, box.y - 6, box.w + 12, box.h + 12)
  ctx.restore()
}

/** Rough areas TikTok covers with its own buttons and caption. */
export function drawSafeZone(ctx: Ctx, W: number, H: number): void {
  const zones = [
    { x: 0, y: 0, w: W, h: H * 0.09, label: 'Menú de TikTok' },
    { x: W * 0.84, y: H * 0.36, w: W * 0.16, h: H * 0.5, label: 'Botones' },
    { x: 0, y: H * 0.8, w: W * 0.84, h: H * 0.2, label: 'Nombre y descripción' }
  ]
  ctx.save()
  for (const z of zones) {
    ctx.fillStyle = 'rgba(255, 79, 139, 0.28)'
    ctx.fillRect(z.x, z.y, z.w, z.h)
    ctx.strokeStyle = 'rgba(255, 79, 139, 0.9)'
    ctx.lineWidth = 2
    ctx.setLineDash([8, 6])
    ctx.strokeRect(z.x + 1, z.y + 1, z.w - 2, z.h - 2)
    ctx.fillStyle = '#ffffff'
    ctx.font = `700 ${Math.round(W * 0.03)}px "Nunito Variable", sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.save()
    ctx.translate(z.x + z.w / 2, z.y + z.h / 2)
    if (z.h > z.w * 1.5) ctx.rotate(-Math.PI / 2)
    ctx.fillText(z.label, 0, 0)
    ctx.restore()
  }
  ctx.restore()
}

/** Renders one text item to a transparent full-size PNG for the ffmpeg export. */
export async function renderTextPng(t: TextItem, frame: Frame): Promise<Uint8Array> {
  const canvas = document.createElement('canvas')
  canvas.width = frame.w
  canvas.height = frame.h
  drawText(canvas.getContext('2d')!, t, 1, frame)
  const blob = await new Promise<Blob>((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error('No se pudo crear la imagen del texto'))), 'image/png')
  )
  return new Uint8Array(await blob.arrayBuffer())
}

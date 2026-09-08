/** Minimal SVG string builder. No DOM required, so this works in tests and in the browser. */

export type AttrValue = string | number | undefined | null | false
export type Attrs = Record<string, AttrValue>

const ESC: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESC[c])
}

/** Round to 3dp and drop trailing zeros, so path data stays readable. */
export function n(v: number): string {
  if (!Number.isFinite(v)) return '0'
  const r = Math.round(v * 1000) / 1000
  return String(r)
}

function attrs(a: Attrs): string {
  const parts: string[] = []
  for (const [k, v] of Object.entries(a)) {
    if (v === undefined || v === null || v === false) continue
    parts.push(`${k}="${esc(typeof v === 'number' ? n(v) : String(v))}"`)
  }
  return parts.length ? ' ' + parts.join(' ') : ''
}

/** Build an element. Pass `children` to get a container, omit it for a self-closing tag. */
export function el(tag: string, a: Attrs = {}, children?: string | string[]): string {
  if (children === undefined) return `<${tag}${attrs(a)}/>`
  const body = Array.isArray(children) ? children.join('') : children
  return `<${tag}${attrs(a)}>${body}</${tag}>`
}

export function g(a: Attrs, children: string | string[]): string {
  return el('g', a, children)
}

/** Path data builder — keeps commands terse and consistently rounded. */
export class Path {
  private d: string[] = []
  M(x: number, y: number) { this.d.push(`M${n(x)} ${n(y)}`); return this }
  L(x: number, y: number) { this.d.push(`L${n(x)} ${n(y)}`); return this }
  C(x1: number, y1: number, x2: number, y2: number, x: number, y: number) {
    this.d.push(`C${n(x1)} ${n(y1)} ${n(x2)} ${n(y2)} ${n(x)} ${n(y)}`); return this
  }
  Q(x1: number, y1: number, x: number, y: number) {
    this.d.push(`Q${n(x1)} ${n(y1)} ${n(x)} ${n(y)}`); return this
  }
  A(rx: number, ry: number, rot: number, large: 0 | 1, sweep: 0 | 1, x: number, y: number) {
    this.d.push(`A${n(rx)} ${n(ry)} ${rot} ${large} ${sweep} ${n(x)} ${n(y)}`); return this
  }
  Z() { this.d.push('Z'); return this }
  toString() { return this.d.join('') }
}

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export function boxUnion(boxes: Box[]): Box {
  if (!boxes.length) return { x: 0, y: 0, w: 0, h: 0 }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const b of boxes) {
    x0 = Math.min(x0, b.x)
    y0 = Math.min(y0, b.y)
    x1 = Math.max(x1, b.x + b.w)
    y1 = Math.max(y1, b.y + b.h)
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

export function pad(b: Box, p: number): Box {
  return { x: b.x - p, y: b.y - p, w: b.w + 2 * p, h: b.h + 2 * p }
}

/** Deterministic hash → [0,1) PRNG, so "hand-drawn" jitter is stable across renders. */
export function seededRandom(seed: string): () => number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return () => {
    h ^= h << 13; h >>>= 0
    h ^= h >>> 17
    h ^= h << 5; h >>>= 0
    return h / 4294967296
  }
}

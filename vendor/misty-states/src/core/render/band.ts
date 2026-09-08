/**
 * Rewrite gradient-filled rectangles as stacks of solid-colour bands.
 *
 * A smooth `<linearGradient>` is a *shading pattern* in PDF. Most readers draw
 * it, but Apple's PDFKit — Preview, Quick Look, Safari — does not render a
 * shading once the drawing is embedded in another document (a Form XObject, as
 * `\includegraphics` produces). The gradient silently flattens to one colour, so
 * a cylinder pipe looks like a flat grey stick in Preview even though it is
 * correct everywhere else.
 *
 * A solid fill has no such problem: PDFKit draws plain filled rectangles in an
 * embedded form without complaint. So this pass approximates each gradient with
 * a run of thin solid strips sampled along the gradient axis. At a couple of
 * dozen strips the stepping is invisible at reading size, and the result is
 * still pure vector — it scales without blurring and adds no raster image.
 *
 * Only `<rect>` fills are banded: the pipes, gate faces, and box shadows are all
 * rectangles with known geometry, and they carry all the depth that reads at a
 * glance. The small radial sheen on qubit glyphs and the cloud shadow are left
 * as gradients — they sit on arbitrary paths where banding is unreliable, and
 * they are subtle enough that flattening them in Preview costs nothing.
 */

const DEFAULT_STEPS = 24

interface Stop {
  /** Position along the gradient, 0..1. */
  at: number
  color: string
  opacity: number
}

interface Grad {
  kind: 'linear' | 'radial'
  /** True when the gradient runs left-to-right rather than top-to-bottom. */
  horizontal: boolean
  stops: Stop[]
}

/** Blend two `#rrggbb` colours, `t` of the way from `a` to `b`. */
function mix(a: string, b: string, t: number): string {
  const part = (hex: string, at: number) => parseInt(hex.slice(at, at + 2), 16)
  const k = Math.max(0, Math.min(1, t))
  const to = (at: number) => Math.round(part(a, at) + (part(b, at) - part(a, at)) * k)
  return `#${[1, 3, 5].map((at) => to(at).toString(16).padStart(2, '0')).join('')}`
}

/** Read `offset="32%"` or `offset="0.32"` as a fraction. */
function offset(raw: string | undefined): number {
  if (!raw) return 0
  const v = parseFloat(raw)
  if (!Number.isFinite(v)) return 0
  return raw.trim().endsWith('%') ? v / 100 : v
}

function parseAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {}
  const re = /([\w:-]+)="([^"]*)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) out[m[1]] = m[2]
  return out
}

/** Colour and opacity of a gradient at position `t` (0..1). */
function sample(g: Grad, t: number): { color: string; opacity: number } {
  const stops = g.stops
  if (!stops.length) return { color: '#000000', opacity: 1 }
  if (t <= stops[0].at) return { color: stops[0].color, opacity: stops[0].opacity }
  const last = stops[stops.length - 1]
  if (t >= last.at) return { color: last.color, opacity: last.opacity }
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i]
    const b = stops[i + 1]
    if (t <= b.at) {
      const span = b.at - a.at
      const k = span > 0 ? (t - a.at) / span : 0
      return { color: mix(a.color, b.color, k), opacity: a.opacity + (b.opacity - a.opacity) * k }
    }
  }
  return { color: last.color, opacity: last.opacity }
}

/** Collect every gradient defined in the drawing, keyed by id. */
function collectGradients(svg: string): Map<string, Grad> {
  const grads = new Map<string, Grad>()
  const re = /<(linearGradient|radialGradient)\b([^>]*)>([\s\S]*?)<\/\1>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(svg))) {
    const kind = m[1] === 'radialGradient' ? 'radial' : 'linear'
    const attr = parseAttrs(m[2])
    const id = attr.id
    if (!id) continue
    const stops: Stop[] = []
    const sre = /<stop\b([^>]*)\/?>/g
    let s: RegExpExecArray | null
    while ((s = sre.exec(m[3]))) {
      const a = parseAttrs(s[1])
      stops.push({
        at: offset(a.offset),
        color: (a['stop-color'] || '#000000').trim(),
        opacity: a['stop-opacity'] !== undefined ? parseFloat(a['stop-opacity']) : 1,
      })
    }
    stops.sort((p, q) => p.at - q.at)
    // Direction from the endpoint attributes; our gradients are pure horizontal
    // (x1≠x2) or pure vertical (y1≠y2), so the larger delta wins.
    const dx = Math.abs(parseFloat(attr.x2 ?? '0') - parseFloat(attr.x1 ?? '0'))
    const dy = Math.abs(parseFloat(attr.y2 ?? '0') - parseFloat(attr.y1 ?? '0'))
    grads.set(id, { kind, horizontal: dx >= dy, stops })
  }
  return grads
}

/**
 * Replace each `<rect fill="url(#id)">` that names a linear gradient with a run
 * of solid-colour strips, leaving every other element untouched.
 *
 * `prefix` is the drawing's id namespace, which this runs after and so has to
 * be told rather than read.
 */
export function bandGradients(
  svg: string,
  steps: number = DEFAULT_STEPS,
  prefix = 'ms',
): string {
  const grads = collectGradients(svg)
  if (!grads.size) return svg

  let clipSeq = 0

  return svg.replace(/<rect\b([^>]*)\/>/g, (whole, body: string) => {
    const a = parseAttrs(body)
    const ref = /^url\(#([\w:-]+)\)$/.exec(a.fill ?? '')
    if (!ref) return whole
    const grad = grads.get(ref[1])
    if (!grad || grad.kind !== 'linear' || grad.stops.length < 2) return whole

    const x = parseFloat(a.x ?? '0')
    const y = parseFloat(a.y ?? '0')
    const w = parseFloat(a.width ?? '0')
    const h = parseFloat(a.height ?? '0')
    const rx = parseFloat(a.rx ?? '0')
    if (!(w > 0) || !(h > 0)) return whole

    // Rounded corners need the strips clipped back to the rectangle's outline,
    // or the squared-off strips would poke out past the rounding. A plain
    // rectangle needs no clip: the strips already tile it exactly.
    // Under the drawing's own prefix, like every other id in it: two banded
    // figures inlined on one page must not both call their first clip path the
    // same thing, or the second would be clipped by the first's.
    const clipId = rx > 0 ? `${prefix}-band-${clipSeq++}` : ''
    const round = (v: number) => Math.round(v * 1000) / 1000
    // Any stop below full opacity means the bands are translucent (a shadow).
    // Overlapping translucent strips would double up into visible seams, so
    // those tile edge-to-edge; opaque strips overlap slightly to hide the
    // hairline gaps a renderer can leave between abutting fills.
    const translucent = grad.stops.some((s) => s.opacity < 1)
    const overlap = translucent ? 0 : 0.6

    let bands = ''
    for (let k = 0; k < steps; k++) {
      const t0 = k / steps
      const t1 = (k + 1) / steps
      const { color, opacity } = sample(grad, (t0 + t1) / 2)
      const op = opacity < 1 ? ` fill-opacity="${round(opacity)}"` : ''
      if (grad.horizontal) {
        const sx = x + t0 * w
        const sw = (t1 - t0) * w + (k < steps - 1 ? overlap : 0)
        bands += `<rect x="${round(sx)}" y="${round(y)}" width="${round(sw)}" height="${round(h)}" fill="${color}"${op}/>`
      } else {
        const sy = y + t0 * h
        const sh = (t1 - t0) * h + (k < steps - 1 ? overlap : 0)
        bands += `<rect x="${round(x)}" y="${round(sy)}" width="${round(w)}" height="${round(sh)}" fill="${color}"${op}/>`
      }
    }

    // The original rectangle stays, with its fill dropped, so its stroke still
    // draws the outline on top of the bands. A rect that had no stroke (the box
    // shadow) is left as an invisible no-op, which is harmless.
    const stripped = `<rect${body.replace(/\s*fill="[^"]*"/, ' fill="none"')}/>`

    if (clipId) {
      const clip = `<clipPath id="${clipId}"><rect x="${round(x)}" y="${round(y)}" width="${round(w)}" height="${round(h)}" rx="${round(rx)}"/></clipPath>`
      return `${clip}<g clip-path="url(#${clipId})">${bands}</g>${stripped}`
    }
    return `<g>${bands}</g>${stripped}`
  })
}

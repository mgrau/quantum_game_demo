import { Path, el, esc, g, n } from '../svg'
import { inscribedMark, shapePath } from '../shapes'
import type { DialPrim, Metrics, Prim, QubitPrim, TextPrim } from './primitives'
import { chipWidth, textWidth } from './primitives'
import { cloudPath } from './cloud'

export type ThemeId = 'solid' | 'flat' | 'isometric'

export interface Palette {
  ink: string
  paper: string
  /** Fill for |0⟩ and |1⟩ glyphs. */
  zero: string
  one: string
  pipe: string
  pipeEdge: string
  gate: string
  gateEdge: string
  measure: string
  accent: string
  hadamard: string
  /**
   * The chip behind a lettered gate, by its letter.
   *
   * Hue carries meaning rather than decorating: Z, S and T are the same turn by
   * different amounts — a half, a quarter, an eighth — so they share a colour
   * that lightens as the turn gets smaller, and `T·T = S`, `S·S = Z` is legible
   * before the letters are read. H is the odd one out because it is the basis
   * change rather than a phase, and Y stands apart because it is both.
   */
  gateChip: Record<string, string>
  muted: string
  /** Outline for a qubit whose value is unknown. */
  uncertain: string
  /**
   * The two ends of a chart's bars.
   *
   * A signed amplitude reads twice over: how far the bar reaches, and how
   * strongly it is coloured. Neither is decoration — a plot of eight bars is
   * scanned for its shape long before any one height is read off, and colour
   * carries that at a glance where a row of similar heights does not.
   */
  chartUp: string
  chartDown: string
}

export const LIGHT_PALETTE: Palette = {
  ink: '#111111',
  paper: '#ffffff',
  zero: '#ffffff',
  one: '#111111',
  pipe: '#d9d9d9',
  pipeEdge: '#8a8a8a',
  gate: '#e9e9e9',
  gateEdge: '#4a4a4a',
  measure: '#9d9d9d',
  accent: '#1b3fae',
  hadamard: '#ef5f5b',
  // Kept dark enough for the white letter on top: the progression is carried
  // by hue and depth together, not by fading the chip out from under its label.
  gateChip: {
    H: '#ef5f5b',
    Z: '#5b32b0',
    RZ: '#5b32b0',
    P: '#7d57d4',
    RX: '#1b3fae',
    RY: '#0f9488',
    S: '#7d57d4',
    T: '#9b7ae6',
    Y: '#0f9488',
  },
  muted: '#6b6b6b',
  uncertain: '#b6b6b6',
  chartUp: '#4a7fd4',
  chartDown: '#d4574a',
}

export const DARK_PALETTE: Palette = {
  ink: '#f2f2f2',
  paper: '#101014',
  zero: '#101014',
  one: '#f2f2f2',
  pipe: '#3a3a42',
  pipeEdge: '#8c8c98',
  gate: '#2c2c34',
  gateEdge: '#b8b8c4',
  measure: '#4a4a54',
  accent: '#7aa2ff',
  hadamard: '#ef5f5b',
  gateChip: {
    H: '#ef5f5b',
    Z: '#7042d6',
    RZ: '#7042d6',
    P: '#8a63e4',
    RX: '#5b82ff',
    RY: '#12998c',
    S: '#8a63e4',
    T: '#a184ee',
    Y: '#12998c',
  },
  muted: '#9a9aa6',
  uncertain: '#565660',
  chartUp: '#6f9dff',
  chartDown: '#ff8878',
}

/**
 * How a gate body sits relative to the pipe it interrupts.
 *
 * In a flat projection a gate is centred on the pipe axis and pipes meet its
 * top and bottom edges exactly. An extruded gate is drawn in oblique
 * projection, so the *visible* top face is displaced by half the depth vector
 * from the front face — the pipe has to land there instead, or it appears to
 * enter the box off-centre.
 */
export interface Attach {
  /** Horizontal shift applied to gate bodies and their glyphs. */
  dx: number
  /** Where a pipe meets the gate, relative to the box's top edge. */
  topDy: number
  /** Where a pipe leaves the gate, relative to the box's bottom edge. */
  bottomDy: number
  /**
   * Extra length for the stub at the top of the circuit.
   *
   * Under an extruded projection the mouth is foreshortened and part of the
   * stub disappears behind the first gate's top face, so it has to run longer
   * to read as the same length as the tail.
   */
  topLeadExtra: number
  /**
   * Paint the stack from the bottom up, interleaving pipes with gate bodies.
   *
   * An extruded gate needs it: each pipe has to be behind the gate it leaves
   * and in front of the one it enters, which only a bottom-up walk gives. A
   * flat gate is a plate lying *on* the pipes — nothing passes in front of it —
   * so there the pipes are simply painted first, and gate shadows fall on them.
   */
  paintBottomUp: boolean
}

export const FLAT_ATTACH: Attach = {
  dx: 0,
  topDy: 0,
  bottomDy: 0,
  topLeadExtra: 0,
  paintBottomUp: false,
}

export interface Theme {
  id: ThemeId
  label: string
  description: string
  /** Extra room the theme's decoration needs outside the layout bounds. */
  bleed: { top: number; right: number; bottom: number; left: number }
  /** Where pipes meet gate bodies under this theme's projection. */
  attach: Attach
  defs(pal: Palette): string
  draw(p: Prim, pal: Palette, m: Metrics): string
}

export const FONT_STACK =
  "ui-sans-serif, system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif"

/**
 * The face the annotations are set in.
 *
 * An SVG names fonts; it does not carry them. So this asks for Computer Modern
 * by each of the names it ships under — Latin Modern is its Unicode
 * continuation, CMU Serif the free rebuild, and a machine with a TeX
 * distribution on it has at least one — and falls back to Times, which is on
 * everything and is the nearest ubiquitous thing to it.
 *
 * Deliberately short. Charter, Palatino and Georgia are all handsomer
 * fallbacks and all of them are wider than Times: measured, an annotation set
 * in Georgia ran forty pixels past the edge of its own drawing, because the
 * gutter reserved for it is measured here against one table and there is only
 * one table to measure against. A face that fits is worth more than a face
 * that flatters.
 *
 * Embedding the real thing was the alternative and was not worth it: a subset
 * of Computer Modern in every exported figure is tens of kilobytes on drawings
 * that are currently three, for text that is a caption in the margin.
 */
export const SERIF_STACK =
  "'Latin Modern Roman', 'CMU Serif', 'Computer Modern', 'Latin Modern Roman 10'," +
  " 'Times New Roman', Times, serif"

/* ------------------------------------------------------------------ *
 * Helpers shared by every theme. Only shading differs between them,
 * so glyph geometry lives here and is never duplicated.
 * ------------------------------------------------------------------ */

/**
 * Fraction of the font size between the alphabetic baseline and the visual
 * centre. `dominant-baseline` is avoided because support varies across SVG
 * consumers (Inkscape and several PDF converters ignore it), which would shift
 * text on export; an explicit offset renders identically everywhere.
 */
const CAP_CENTRE = 0.355
const MATH_CENTRE = 0.28

export function baselineOffset(size: number, baseline: 'cap' | 'math' = 'cap'): number {
  return size * (baseline === 'math' ? MATH_CENTRE : CAP_CENTRE)
}

export interface QubitStyle {
  /** Paint layered over the glyph to model it as a solid body. */
  overlay?: string
  /**
   * Paint for a copy of the glyph dropped behind it, and how far to drop it.
   *
   * A shadow rather than a filter. `feDropShadow` is a raster operation, and
   * everything that consumes an SVG as vector art — a PDF, an illustrator, the
   * app's own print export — either ignores it or rasterises the page to honour
   * it. An offset copy under a fading gradient is ordinary geometry, so it
   * survives wherever the drawing goes.
   */
  shadow?: { paint: string; dy: number }
}

export function drawQubit(
  p: QubitPrim,
  pal: Palette,
  m: Metrics,
  style: QubitStyle = {},
): string {
  const unknown = p.value === 'unknown'
  const fill = p.value === 1 ? pal.one : pal.zero
  const d = shapePath(p.shape, p.size)
  // Behind everything, and only where the glyph is opaque enough to cast one.
  const cast = style.shadow
    ? el('g', { transform: `translate(0 ${style.shadow.dy})` },
        el('path', { d, fill: style.shadow.paint, stroke: 'none' }))
    : ''
  const body = el('path', {
    d,
    fill,
    // A pale outline for an unknown value: the glyph is still a qubit, but it
    // should not assert itself the way a definite 0 or 1 does.
    stroke: unknown ? pal.uncertain : pal.ink,
    'stroke-width': m.stroke,
    'stroke-linejoin': 'round',
  })
  // Painted with the same path, so the shading is clipped to the glyph without
  // needing a clipPath per shape.
  const shading = style.overlay
    ? el('path', { d, fill: style.overlay, stroke: 'none' })
    : ''
  const inscribed = inscribedMark(p.shape, p.size)
  const markSize = inscribed.size
  const mark = unknown
      ? el(
          'text',
          {
            x: 0,
            y: inscribed.dy + baselineOffset(markSize),
            'text-anchor': 'middle',
            'font-family': FONT_STACK,
            'font-size': markSize,
            'font-weight': 700,
            fill: pal.muted,
          },
          '?',
        )
      : ''
  return g({ transform: `translate(${n(p.cx)} ${n(p.cy)})` }, cast + body + shading + mark)
}

/** Blend two hex colours, `t` of the way from `a` to `b`. */
export function mix(a: string, b: string, t: number): string {
  const part = (hex: string, at: number) => parseInt(hex.slice(at, at + 2), 16)
  const k = Math.max(0, Math.min(1, t))
  const to = (at: number) => Math.round(part(a, at) + (part(b, at) - part(a, at)) * k)
  return `#${[1, 3, 5].map((at) => to(at).toString(16).padStart(2, '0')).join('')}`
}

export function drawText(p: TextPrim, pal: Palette): string {
  // A name on a chip is the `⊕` written out: same blue, same white lettering.
  if (p.chip) return labelChip(p.x, p.cy, p.text, p.size, pal.accent, pal)
  const y = p.cy + baselineOffset(p.size, p.baseline)
  return el(
    'text',
    {
      x: p.x,
      y,
      ...(p.rotate ? { transform: `rotate(${p.rotate} ${p.x} ${y})` } : {}),
      'text-anchor': p.anchor,
      'font-family': p.mono
        ? 'ui-monospace, SFMono-Regular, Menlo, monospace'
        : p.serif
          ? SERIF_STACK
          : FONT_STACK,
      'font-size': p.size,
      'font-weight': p.weight ?? 400,
      fill: p.color ?? pal.ink,
    },
    esc(p.text),
  )
}

/** The `-` of a negative amplitude: a bar centred exactly on the centre line. */
export function drawSign(x: number, cy: number, w: number, h: number, pal: Palette): string {
  return el('rect', { x, y: cy - h / 2, width: w, height: h, fill: pal.ink })
}

export function drawCloud(
  content: { x: number; y: number; w: number; h: number },
  seed: string,
  pal: Palette,
  m: Metrics,
  /** Paint for a copy of the outline dropped behind it; see `QubitStyle`. */
  shadow?: string,
): string {
  const { d } = cloudPath(content, seed, m.cloudPadX, m.cloudPadY, m.cloudFluff)
  const cast = shadow
    ? el('g', { transform: 'translate(0 2)' }, el('path', { d, fill: shadow, stroke: 'none' }))
    : ''
  return cast + el('path', {
    d,
    fill: pal.paper,
    stroke: pal.ink,
    'stroke-width': m.cloudStroke,
    'stroke-linejoin': 'round',
  })
}

export function drawBar(x: number, cy: number, h: number, pal: Palette, m: Metrics): string {
  return el('rect', {
    x: x - m.barWidth / 2,
    y: cy - h / 2,
    width: m.barWidth,
    height: h,
    fill: pal.ink,
  })
}

/**
 * Analog meter dial: a graduated scale with tick marks, a needle, and a pivot.
 *
 * Centred on (cx, cy) — the pivot sits half a radius low so the arc above it
 * balances about the centre. The basis label is drawn by the caller, so the
 * dial itself can stay centred in its box.
 */
export function meterGlyph(cx: number, cy: number, r: number, pal: Palette, m: Metrics): string {
  const py = cy + r * 0.5
  const sw = m.stroke * 0.7

  const scale = el('path', {
    d: new Path().M(cx - r, py).A(r, r, 0, 0, 1, cx + r, py).toString(),
    fill: 'none',
    stroke: pal.ink,
    'stroke-width': sw,
    'stroke-linecap': 'round',
  })

  // Graduations at 0°, 45°, 90°, 135°, 180° around the scale.
  const ticks = [0, 1, 2, 3, 4]
    .map((i) => {
      const a = Math.PI - (i * Math.PI) / 4
      const inner = r * 0.76
      return el('line', {
        x1: cx + inner * Math.cos(a),
        y1: py - inner * Math.sin(a),
        x2: cx + r * Math.cos(a),
        y2: py - r * Math.sin(a),
        stroke: pal.ink,
        'stroke-width': sw * 0.8,
        'stroke-linecap': 'round',
      })
    })
    .join('')

  // Deliberately halfway between the 45° and 90° graduations: a needle resting
  // exactly on a tick reads as a fixed symbol rather than a dial in use.
  const angle = Math.PI * 0.375
  // Overshoots the scale, the way a real pointer passes in front of its face.
  const reach = r * 1.14
  const needle = el('line', {
    x1: cx,
    y1: py,
    x2: cx + reach * Math.cos(angle),
    y2: py - reach * Math.sin(angle),
    stroke: pal.ink,
    'stroke-width': sw * 1.5,
    'stroke-linecap': 'round',
  })

  const pivot = el('circle', { cx, cy: py, r: Math.max(2.2, r * 0.21), fill: pal.ink })

  return scale + ticks + needle + pivot
}

/** Basis letter for a measurement, tucked into a corner clear of the dial. */
export function basisLabel(
  x: number,
  y: number,
  text: string,
  size: number,
  pal: Palette,
): string {
  if (!text) return ''
  return el(
    'text',
    {
      x,
      y: y + baselineOffset(size),
      'text-anchor': 'end',
      'font-family': FONT_STACK,
      'font-size': size,
      'font-weight': 700,
      fill: pal.ink,
    },
    esc(text),
  )
}

/** ⊕ target glyph. */
export function notGlyph(cx: number, cy: number, r: number, pal: Palette, m: Metrics): string {
  const circle = el('circle', { cx, cy, r, fill: pal.accent })
  const bar = (x1: number, y1: number, x2: number, y2: number) =>
    el('line', {
      x1, y1, x2, y2,
      stroke: pal.paper,
      'stroke-width': m.stroke * 1.1,
      'stroke-linecap': 'round',
    })
  return circle + bar(cx - r * 0.55, cy, cx + r * 0.55, cy) + bar(cx, cy - r * 0.55, cx, cy + r * 0.55)
}

export function swapGlyph(cx: number, cy: number, r: number, pal: Palette, m: Metrics): string {
  const bar = (x1: number, y1: number, x2: number, y2: number) =>
    el('line', {
      x1, y1, x2, y2,
      stroke: pal.accent,
      'stroke-width': m.stroke * 1.4,
      'stroke-linecap': 'round',
    })
  return bar(cx - r, cy - r, cx + r, cy + r) + bar(cx - r, cy + r, cx + r, cy - r)
}

/** Label chip inside a gate box: accent-filled rounded rect with the letter. */
/**
 * A term's phase, as a hand on a small circle.
 *
 * In the ink colour and at the sign bar's weight, because this is notation
 * rather than decoration — it stands in the slot a minus sign would have taken
 * and should read with the same authority.
 */
export function drawDial(p: DialPrim, pal: Palette, m: Metrics): string {
  const t = (p.angle * Math.PI) / 180
  return (
    el('circle', {
      cx: p.x + p.r,
      cy: p.cy,
      r: p.r,
      fill: 'none',
      stroke: pal.ink,
      'stroke-width': m.stroke * 0.55,
    }) +
    el('line', {
      x1: p.x + p.r,
      y1: p.cy,
      // Screen y grows downwards, so anticlockwise on the page is a minus here.
      x2: p.x + p.r + p.r * 0.82 * Math.cos(t),
      y2: p.cy - p.r * 0.82 * Math.sin(t),
      stroke: pal.ink,
      'stroke-width': m.stroke * 1.5,
      'stroke-linecap': 'round',
    })
  )
}

export function labelChip(
  cx: number,
  cy: number,
  text: string,
  size: number,
  accent: string | undefined,
  pal: Palette,
  /**
   * A smaller letter set below the line after the label, as `R` takes an axis.
   *
   * Drawn rather than folded into the label because it is not part of the
   * name: `RX` reads as two letters of equal weight, where the thing meant is
   * one letter saying *rotation* and a small one saying *about which axis*.
   */
  subscript?: string,
): string {
  if (!text) return ''
  const subSize = size * 0.66
  const subW = subscript ? textWidth(subscript, subSize, true) : 0
  const mainW = textWidth(text, size, true)
  // The pair is centred as a whole, so the label sits left of centre by half
  // of whatever the subscript takes.
  const mainX = cx - subW / 2
  const runs = (color: string, weight: number) =>
    drawText({ t: 'text', x: mainX, cy, text, size, anchor: 'middle', weight, color }, pal) +
    (subscript
      ? drawText(
          {
            t: 'text',
            x: mainX + mainW / 2,
            cy: cy + size * 0.28,
            text: subscript,
            size: subSize,
            anchor: 'start',
            weight,
            color,
          },
          pal,
        )
      : '')

  if (!accent) return runs(pal.ink, 600)

  /*
   * Padding stated outright rather than as a fraction of the text's own width.
   *
   * As a multiplier it shrank exactly where it was needed most: a label with an
   * axis beside it is a wide run of two small glyphs, so a percentage of that
   * width came to less than a percentage of a single wide letter, and `R` with
   * its axis ended up with a third of the room `H` had — measured at 2.9px
   * against 5.6px, with the axis letter itself hanging half a pixel outside its
   * own chip at the bottom. The width is `chipWidth`, shared with the layout,
   * which has to leave room for a chip before the theme draws one.
   */
  const PAD_Y = size * 0.15

  // How far the drawn glyphs actually reach. A subscript hangs below the line,
  // and the chip has to come down with it — it used to end above the axis
  // letter, which then sat outside its own chip.
  const top = cy - size * 0.5
  const bottom = subscript ? cy + size * 0.28 + subSize * 0.5 : cy + size * 0.5

  // The stated padding applies where the old proportional rule fell short,
  // which is where there is a subscript: two small glyphs side by side make a
  // wide run, and a percentage of that came to less than a percentage of one
  // wide letter. A chip holding a single letter was never short of room and is
  // left at exactly the width it has always had.
  const w = chipWidth(text, size, subscript ?? '')
  const h = bottom - top + PAD_Y * 2
  return (
    el('rect', {
      x: cx - w / 2,
      // Centred on what is drawn, not on the line: with a subscript the two
      // differ, and centring on the line is what pushed the chip off its
      // contents in the first place.
      y: top - PAD_Y,
      width: w,
      height: h,
      rx: 2,
      fill: accent,
    }) + runs('#ffffff', 700)
  )
}

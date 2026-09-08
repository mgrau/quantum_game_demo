/**
 * The three render themes.
 *
 * `solid` is the default: flat 2D geometry with just enough shading — cylinder
 * gradients on the pipes, a soft drop shadow under boxes and clouds — to read
 * as concrete objects you could pick up. `flat` strips the shading; `isometric`
 * extrudes the boxes and pipes into the drawn-in-3D look used in the course
 * materials.
 */

import { Path, el, g, n } from '../svg'
import type { Metrics, Prim } from './primitives'
import {
  FLAT_ATTACH, basisLabel, drawBar, drawCloud, drawQubit, drawDial, drawSign, drawText, mix,
  labelChip, meterGlyph, notGlyph, swapGlyph,
  type Attach, type Palette, type QubitStyle, type Theme, type ThemeId,
} from './theme'
import type { QubitValue } from '../state/ast'

/** Blend a hex colour toward white (amount > 0) or black (amount < 0). */
function shade(hex: string, amount: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return hex
  const v = parseInt(m[1], 16)
  const to = amount >= 0 ? 255 : 0
  const k = Math.abs(amount)
  const ch = (sh: number) => {
    const c = (v >> sh) & 0xff
    return Math.round(c + (to - c) * k)
  }
  const out = (ch(16) << 16) | (ch(8) << 8) | ch(0)
  return '#' + out.toString(16).padStart(6, '0')
}

const SHADOW = 'url(#ms-shadow)'
const ISO_DX = 13
const ISO_DY = -8

interface Surface {
  /** Vertical pipe segment. */
  pipe(
    cx: number, y0: number, y1: number, w: number,
    pal: Palette, m: Metrics, openTop: boolean,
  ): string
  /** Gate/measurement body; label and glyphs are drawn on top by the caller. */
  body(
    box: { x: number; y: number; w: number; h: number },
    fill: string,
    pal: Palette,
    m: Metrics,
  ): string
  shadow?: string
  defs(pal: Palette): string
  bleed: Theme['bleed']
  attach: Attach
  /** Shading applied to qubit glyphs; omitted themes draw them flat. */
  qubitStyle?(value: QubitValue): QubitStyle
}

/* ---------------------------------------------------------------- flat --- */

const flatSurface: Surface = {
  defs: () => '',
  bleed: { top: 2, right: 2, bottom: 2, left: 2 },
  attach: FLAT_ATTACH,
  pipe: (cx, y0, y1, w, pal, m) =>
    el('rect', {
      x: cx - w / 2, y: y0, width: w, height: y1 - y0,
      fill: pal.pipe, stroke: pal.pipeEdge, 'stroke-width': m.stroke * 0.55,
    }),
  body: (box, fill, pal, m) =>
    el('rect', {
      x: box.x, y: box.y, width: box.w, height: box.h,
      fill, stroke: pal.gateEdge, 'stroke-width': m.stroke * 0.8,
    }),
}

/* --------------------------------------------------------------- solid --- */

const solidSurface: Surface = {
  shadow: SHADOW,
  bleed: { top: 3, right: 5, bottom: 6, left: 5 },
  attach: FLAT_ATTACH,
  defs: (pal) => {
    const cyl = el(
      'linearGradient',
      { id: 'ms-pipe', x1: '0', y1: '0', x2: '1', y2: '0' },
      [
        el('stop', { offset: '0%', 'stop-color': shade(pal.pipe, -0.22) }),
        el('stop', { offset: '32%', 'stop-color': shade(pal.pipe, 0.42) }),
        el('stop', { offset: '62%', 'stop-color': pal.pipe }),
        el('stop', { offset: '100%', 'stop-color': shade(pal.pipe, -0.3) }),
      ].join(''),
    )
    const gate = el(
      'linearGradient',
      { id: 'ms-gate', x1: '0', y1: '0', x2: '0', y2: '1' },
      [
        el('stop', { offset: '0%', 'stop-color': shade(pal.gate, 0.5) }),
        el('stop', { offset: '100%', 'stop-color': shade(pal.gate, -0.1) }),
      ].join(''),
    )
    /**
     * What a shadow is painted with, in place of a blur.
     *
     * `feDropShadow` is a raster operation: an illustrator, a PDF writer, or
     * anything else treating an SVG as vector art either drops it or rasterises
     * the whole drawing to honour it. A copy of the shape dropped behind the
     * real one and painted with a gradient that fades upwards is ordinary
     * geometry — it says the same thing about where the light is, and it
     * survives being exported.
     *
     * Clear at the top because that part is hidden behind the shape anyway;
     * what shows is the sliver below it and the sides near the bottom, which is
     * exactly where a shadow belongs with the light overhead.
     */
    const fall = (id: string, alpha: number) =>
      el(
        'linearGradient',
        { id, x1: '0', y1: '0', x2: '0', y2: '1' },
        [
          el('stop', { offset: '0%', 'stop-color': '#000000', 'stop-opacity': 0 }),
          el('stop', { offset: '55%', 'stop-color': '#000000', 'stop-opacity': alpha * 0.35 }),
          el('stop', { offset: '100%', 'stop-color': '#000000', 'stop-opacity': alpha }),
        ].join(''),
      )
    const shadow = fall('ms-shadow', 0.34)
    const qubitShadow = fall('ms-qubit-shadow', 0.3)
    // A light source up and to the left: pale glyphs darken toward the far
    // edge, dark glyphs pick up a specular highlight near the light.
    const lit = el(
      'radialGradient',
      { id: 'ms-qubit-lit', cx: '0.34', cy: '0.27', r: '0.78' },
      [
        el('stop', { offset: '0%', 'stop-color': '#ffffff', 'stop-opacity': 0.46 }),
        el('stop', { offset: '45%', 'stop-color': '#ffffff', 'stop-opacity': 0.11 }),
        el('stop', { offset: '100%', 'stop-color': '#ffffff', 'stop-opacity': 0 }),
      ].join(''),
    )
    const dim = el(
      'radialGradient',
      { id: 'ms-qubit-dim', cx: '0.35', cy: '0.28', r: '0.85' },
      [
        el('stop', { offset: '0%', 'stop-color': '#000000', 'stop-opacity': 0 }),
        el('stop', { offset: '58%', 'stop-color': '#000000', 'stop-opacity': 0.05 }),
        el('stop', { offset: '100%', 'stop-color': '#000000', 'stop-opacity': 0.21 }),
      ].join(''),
    )
    return cyl + gate + shadow + qubitShadow + lit + dim
  },
  qubitStyle: (value) => ({
    overlay: value === 1 ? 'url(#ms-qubit-lit)' : 'url(#ms-qubit-dim)',
    shadow: { paint: 'url(#ms-qubit-shadow)', dy: 1.6 },
  }),
  pipe: (cx, y0, y1, w, pal, m) =>
    el('rect', {
      x: cx - w / 2, y: y0, width: w, height: y1 - y0,
      fill: 'url(#ms-pipe)', stroke: pal.pipeEdge, 'stroke-width': m.stroke * 0.5,
    }),
  body: (box, fill, pal, m) =>
    // The same box dropped behind itself, spread a little so the shadow shows
    // at the sides as well as under the foot.
    el('rect', {
      x: box.x - 0.8, y: box.y + 2.2, width: box.w + 1.6, height: box.h, rx: 3.5,
      fill: SHADOW, stroke: 'none',
    }) +
    el('rect', {
      x: box.x, y: box.y, width: box.w, height: box.h, rx: 3,
      fill: fill === pal.gate ? 'url(#ms-gate)' : fill,
      stroke: pal.gateEdge, 'stroke-width': m.stroke * 0.8,
    }),
}

/* ----------------------------------------------------------- isometric --- */

function parallelogram(x: number, y: number, w: number, h: number, dx: number, dy: number): string {
  return new Path().M(x, y).L(x + dx, y + dy).L(x + w + dx, y + h + dy).L(x + w, y + h).Z().toString()
}

const isoSurface: Surface = {
  bleed: { top: ISO_DX + 4, right: ISO_DX + 4, bottom: 4, left: ISO_DX },
  // The visible top face is displaced half the depth vector from the front
  // face, so the body shifts back by that much and the pipe lands on the face.
  attach: {
    dx: -ISO_DX / 2,
    // About a third of the way back across the top face: clear of the front
    // edge, so the pipe drops into the gate rather than resting on its lip,
    // while staying close enough to read as connected to it.
    topDy: ISO_DY * 0.375,
    // A pipe leaves through the gate's *bottom* face, which sits above the
    // front-bottom edge, so it emerges a little higher and overlaps the body.
    bottomDy: ISO_DY / 2,
    // The mouth is foreshortened and the first gate's top face swallows part of
    // the stub, so it runs longer to look the same length as the tail.
    topLeadExtra: 9,
    paintBottomUp: true,
  },
  defs: () => '',
  pipe: (cx, y0, y1, w, pal, m, openTop) => {
    const rx = w / 2
    // A shallow ellipse: the pipe mouth is seen at a glancing angle, so it
    // foreshortens. Too flat and the bore disappears; too round and it reads
    // as a bowl.
    const ry = w * 0.17
    // The closing arc bulges `ry` below where it starts, so the sides stop that
    // much short — otherwise `y1` would not mean the pipe's lowest drawn pixel
    // the way it does in the flat themes, and the end would overshoot.
    const foot = y1 - ry
    const body = el('path', {
      d: new Path()
        .M(cx - rx, y0)
        .L(cx - rx, foot)
        .A(rx, ry, 0, 0, 0, cx + rx, foot)
        .L(cx + rx, y0)
        .toString(),
      fill: pal.pipe, stroke: pal.pipeEdge, 'stroke-width': m.stroke * 0.55,
    })
    const cap = openTop
      ? el('ellipse', {
          cx, cy: y0, rx, ry,
          fill: shade(pal.pipe, 0.34), stroke: pal.pipeEdge, 'stroke-width': m.stroke * 0.55,
        })
      : ''
    return body + cap
  },
  body: (box, fill, pal, m) => {
    const sw = m.stroke * 0.7
    const top = el('path', {
      d: parallelogram(box.x, box.y, box.w, 0, ISO_DX, ISO_DY),
      fill: shade(fill, 0.28), stroke: pal.gateEdge, 'stroke-width': sw, 'stroke-linejoin': 'round',
    })
    const right = el('path', {
      d: parallelogram(box.x + box.w, box.y, 0, box.h, ISO_DX, ISO_DY),
      fill: shade(fill, -0.2), stroke: pal.gateEdge, 'stroke-width': sw, 'stroke-linejoin': 'round',
    })
    const front = el('rect', {
      x: box.x, y: box.y, width: box.w, height: box.h,
      fill, stroke: pal.gateEdge, 'stroke-width': sw,
    })
    return top + right + front
  },
}

/* ---------------------------------------------------------------------- */

function makeTheme(
  id: ThemeId,
  label: string,
  description: string,
  s: Surface,
): Theme {
  return {
    id,
    label,
    description,
    bleed: s.bleed,
    attach: s.attach,
    defs: (pal) => s.defs(pal),
    draw(p: Prim, pal: Palette, m: Metrics): string {
      switch (p.t) {
        case 'qubit':
          return drawQubit(p, pal, m, s.qubitStyle?.(p.value))

        case 'cloud':
          // Nested clouds sit on top of their parent, so only the outermost
          // one casts a shadow — otherwise the stack muddies.
          return drawCloud(p.content, p.seed, pal, m, p.depth === 0 ? s.shadow : undefined)

        case 'bar':
          return drawBar(p.x, p.cy, p.h, pal, m)

        case 'text':
          return drawText(p, pal)

        case 'sign':
          return drawSign(p.x, p.cy, p.w, p.h, pal)

        case 'dial':
          return drawDial(p, pal, m)

        case 'pipe':
          return s.pipe(p.cx, p.y0, p.y1, p.w, pal, m, p.openTop)

        case 'gatebox': {
          // `||`, not `??`: an empty fill would reach the SVG as fill="" and
          // render black, which is worse than falling back to the default.
          const fill = p.blank ? pal.paper : p.fill || pal.gate
          const body = s.body(p.box, fill, pal, m)
          const cx = p.box.x + p.box.w / 2
          const cy = p.box.y + p.box.h / 2
          // An explicit `fill=` wins; otherwise the palette decides by letter,
          // and a gate it says nothing about gets no chip at all. The axis
          // counts as part of the letter for this: `R` alone is not a gate, and
          // the three of them are told apart by colour as much as by subscript.
          const accent =
            p.accent ?? pal.gateChip[p.label + (p.subscript ?? '')] ?? pal.gateChip[p.label]
          // Lifted to make room where there is a second line, so the pair sits
          // centred in the box rather than the letters alone.
          const lift = p.sub ? p.labelSize * 0.34 : 0
          const chip = labelChip(cx, cy - lift, p.label, p.labelSize, accent, pal, p.subscript)
          if (!p.sub) return body + chip
          return body + chip + drawText(
            {
              t: 'text',
              x: cx,
              cy: cy + p.labelSize * 0.72,
              text: p.sub,
              size: p.labelSize * 0.62,
              anchor: 'middle',
              weight: 600,
              color: pal.muted,
            },
            pal,
          )
        }

        case 'pane': {
          // Pale at nothing, strong at everything, and never quite white, so a
          // bar with almost nothing in it is still visibly a bar.
          const toned =
            p.tone === undefined
              ? undefined
              : mix(pal.paper, p.tone < 0 ? pal.chartDown : pal.chartUp,
                  0.16 + 0.64 * Math.min(1, Math.abs(p.tone)))
          // `||`, not `??`, for the same reason as the gate fill below: an
          // empty string would reach the SVG and paint the pane black.
          return el('rect', {
            x: p.box.x, y: p.box.y, width: p.box.w, height: p.box.h, rx: 2,
            fill: p.fill || toned || pal.paper,
            stroke: pal.gateEdge,
            'stroke-width': m.stroke * 0.55,
          })
        }

        case 'measurebox': {
          const body = s.body(p.box, pal.measure, pal, m)
          const cx = p.box.x + p.box.w / 2
          const cy = p.box.y + p.box.h / 2
          const r = Math.min(p.box.w, p.box.h) * 0.3
          // Dial centred in the box; the basis letter sits in the top-right
          // corner, clear of the arc rather than crowding it.
          const size = r * 0.8
          const label = basisLabel(
            p.box.x + p.box.w - size * 0.45,
            p.box.y + size * 0.6,
            p.basis,
            size,
            pal,
          )
          return body + meterGlyph(cx, cy, r, pal, m) + label
        }

        case 'control':
          return el('circle', { cx: p.cx, cy: p.cy, r: p.r, fill: pal.accent })

        case 'target':
          if (p.glyph === 'not') return notGlyph(p.cx, p.cy, p.r, pal, m)
          if (p.glyph === 'z') {
            return el('circle', { cx: p.cx, cy: p.cy, r: p.r, fill: pal.accent })
          }
          // A marked port: the ring a control has, with its mark inside it.
          return (
            el('circle', {
              cx: p.cx, cy: p.cy, r: p.r,
              fill: pal.paper, stroke: pal.accent, 'stroke-width': m.stroke * 1.2,
            }) +
            drawText(
              {
                t: 'text', x: p.cx, cy: p.cy, text: p.glyph,
                size: p.r * 1.3, anchor: 'middle', weight: 700, color: pal.accent,
              },
              pal,
            )
          )

        case 'swap':
          return swapGlyph(p.cx, p.cy, p.r, pal, m)

        case 'link':
          return el('line', {
            x1: p.x0, y1: p.cy, x2: p.x1, y2: p.cy,
            stroke: pal.accent, 'stroke-width': m.stroke * 1.5, 'stroke-linecap': 'round',
          })

        // Flat in every theme, like the pane: a table is a piece of paper
        // beside the drawing rather than another object in the scene.
        case 'rule':
          return el('line', {
            x1: p.x0, y1: p.y0, x2: p.x1, y2: p.y1,
            stroke: pal.gateEdge, 'stroke-width': m.stroke * 0.55,
          })
      }
    },
  }
}

export const THEMES: Record<ThemeId, Theme> = {
  solid: makeTheme(
    'solid',
    'Solid',
    'Flat shapes with soft shading and shadows — objects you could pick up.',
    solidSurface,
  ),
  flat: makeTheme('flat', 'Flat', 'Pure line art with no shading. Best for print.', flatSurface),
  isometric: makeTheme(
    'isometric',
    'Isometric',
    'Extruded boxes and cylindrical pipes, as drawn in the course materials.',
    isoSurface,
  ),
}

export const THEME_IDS = Object.keys(THEMES) as ThemeId[]

/**
 * Wrap a drawn primitive when it carries something the markup has to say.
 *
 * Opacity, and a `key` for anything that wants to follow this piece across a
 * redraw. Both are one wrapper, so a keyed translucent primitive gets one
 * group rather than two.
 */
const wrapped = (drawn: string, p: Prim): string => {
  const attrs: Record<string, string | number> = {}
  if (p.opacity !== undefined && p.opacity < 1) attrs.opacity = n(p.opacity)
  if (p.key) attrs['data-key'] = p.key
  if (p.highlight) attrs['data-highlight'] = 'true'
  return Object.keys(attrs).length ? g(attrs, drawn) : drawn
}

/** Wrap primitives into a complete, standalone SVG document. */
export function renderPrims(
  prims: Prim[],
  box: { x: number; y: number; w: number; h: number },
  theme: Theme,
  pal: Palette,
  m: Metrics,
  opts: { scale?: number; background?: boolean } = {},
): string {
  const b = theme.bleed
  const x = box.x - b.left
  const y = box.y - b.top
  const w = Math.max(1, box.w + b.left + b.right)
  const h = Math.max(1, box.h + b.top + b.bottom)
  const scale = opts.scale ?? 1

  const defs = theme.defs(pal)
  const bg = opts.background
    ? el('rect', { x, y, width: w, height: h, fill: pal.paper })
    : ''

  return el(
    'svg',
    {
      xmlns: 'http://www.w3.org/2000/svg',
      viewBox: `${n(x)} ${n(y)} ${n(w)} ${n(h)}`,
      width: n(w * scale),
      height: n(h * scale),
      'shape-rendering': 'geometricPrecision',
    },
    (defs ? el('defs', {}, defs) : '') + bg + g({}, prims.map((p) => wrapped(theme.draw(p, pal, m), p))),
  )
}

/**
 * Emitting the animation as one self-contained SVG.
 *
 * The timeline says where everything is at every instant; this turns it into
 * CSS keyframes so a browser can play it without any script. Rasterised frames
 * come from `frameAt` instead — both read the same timeline, so the moving
 * picture and any still taken from it cannot disagree.
 *
 * CSS rather than SMIL: it is deterministic to generate as a string, it is not
 * deprecated anywhere, and a `<style>` block travels inside the file, so the
 * result is still one document you can mail to someone.
 */

import type { Fade, TermTimeline, Timeline, Track } from './animate'
import { GATE_FADE, MARK_FADE, fadeAt, labelWidth, rowAt } from './animate'
import type { CircuitGeometry, CircuitLayout } from './layout'
import type { Metrics, Prim } from '../render/primitives'
import { textWidth } from '../render/primitives'
import type { Palette, Theme } from '../render/theme'
import { el, g, n } from '../svg'
import type { Box } from '../svg'

/** Which gate a primitive belongs to, and how far it fades when passed through. */
function belongsTo(p: Prim, layers: { y: number; h: number }[]): { layer: number; fade: number } | null {
  let y: number
  let fade: number
  switch (p.t) {
    case 'gatebox':
    case 'measurebox':
    case 'pane':
      y = p.box.y + p.box.h / 2
      fade = GATE_FADE
      break
    case 'control':
    case 'target':
    case 'swap':
    case 'link':
      y = p.cy
      fade = MARK_FADE
      break
    default:
      return null
  }
  const layer = layers.findIndex((b) => y > b.y && y < b.y + b.h)
  return layer < 0 ? null : { layer, fade }
}

/**
 * What a travelling qubit passes in front of.
 *
 * Open gates: the pipe and the casing, so a faded box is something the qubit is
 * seen through. Closed: the pipe alone, so it goes behind the box and comes out
 * the other side.
 */
/**
 * The curve applied between one keyframe and the next.
 *
 * Chosen to sit as close to the smooth step the sampled frames use as a cubic
 * bezier can: the played animation and a saved one have to move alike, not
 * merely start and stop in the same places.
 */
const EASE = 'cubic-bezier(0.35,0,0.65,1)'

const behind = (p: Prim, inside: boolean): boolean =>
  p.t === 'pipe' ||
  (inside && (p.t === 'gatebox' || p.t === 'measurebox' || p.t === 'pane'))

/** A percentage of the way through the run, clamped and rounded. */
const pc = (t: number, duration: number) =>
  `${n(Math.max(0, Math.min(100, (t / duration) * 100)))}%`

/**
 * Keyframes for one travelling qubit's position.
 *
 * Written as `translate`, so the glyph itself is drawn once at the origin and
 * moved — which is what lets a swap carry it sideways as well as down.
 */
function motion(track: Track, timeline: Timeline): string {
  const steps = track.stops.map(
    (s) => `${pc(s.t, timeline.duration)}{transform:translate(${n(s.x)}px,${n(s.y)}px)}`,
  )
  // Held in place through the pause at the end, rather than drifting back.
  const last = track.stops[track.stops.length - 1]
  steps.push(`100%{transform:translate(${n(last.x)}px,${n(last.y)}px)}`)
  return steps.join('')
}

/**
 * Keyframes toggling one value of a qubit on and off.
 *
 * A glyph cannot change from white to black by interpolation — they are
 * different drawings — so both are drawn and swapped. `step-end` makes the
 * swap instant, at the moment the gate acts.
 */
function switching(track: Track, look: string, timeline: Timeline): string {
  const spans: string[] = []
  const stops = track.stops
  const is = (s: (typeof stops)[number]) => lookOf(s) === look
  for (let i = 0; i < stops.length; i++) {
    const from = i === 0 ? 0 : (stops[i - 1].t + stops[i].t) / 2
    spans.push(`${pc(from, timeline.duration)}{opacity:${is(stops[i]) ? 1 : 0}}`)
  }
  spans.push(`100%{opacity:${is(stops[stops.length - 1]) ? 1 : 0}}`)
  return spans.join('')
}

/** How a qubit looks at a stop: its glyph and its colour, which vary together. */
const lookOf = (s: { shape: string; value: 0 | 1 }) => `${s.shape}_${s.value}`

/**
 * Keyframes fading a gate while it is being passed through.
 *
 * The fade in and out take a fixed *share* of the dwell rather than a fixed
 * number of seconds, so the stretch that is clear stays in the same place
 * whatever `dwell=` is set to — the stepper's stops are placed by share too,
 * and a short dwell would otherwise leave them either side of it.
 */
function fading(from: number, to: number, fade: number, duration: number): string {
  const edge = (to - from) * 0.15
  return [
    `0%{opacity:1}`,
    `${pc(from, duration)}{opacity:1}`,
    `${pc(from + edge, duration)}{opacity:${fade}}`,
    `${pc(to - edge, duration)}{opacity:${fade}}`,
    `${pc(to, duration)}{opacity:1}`,
    `100%{opacity:1}`,
  ].join('')
}

export interface AnimatedSvgOptions {
  scale?: number
  background?: boolean
}

/**
 * The whole animation as one SVG document.
 *
 * The box must be the union over the run, not the still layout's: the qubits
 * travel above and below the circuit, and a viewBox that cropped them would
 * make the drawing jump.
 */
export function animatedSvg(
  layout: CircuitLayout,
  timeline: Timeline,
  box: Box,
  theme: Theme,
  pal: Palette,
  m: Metrics,
  opts: AnimatedSvgOptions = {},
): string {
  const { geometry } = layout
  const duration = timeline.duration
  const rules: string[] = []

  const drawn = layout.prims.map((p) => {
    const owner = belongsTo(p, geometry.layers)
    const body = theme.draw(p, pal, m)
    if (!owner) return { p, svg: body }
    const pass = timeline.passes.find((q) => q.layer === owner.layer)
    if (!pass) return { p, svg: body }
    const name = `f${owner.layer}${owner.fade === GATE_FADE ? 'c' : 'm'}`
    if (!rules.some((r) => r.startsWith(`@keyframes ${name}`))) {
      rules.push(`@keyframes ${name}{${fading(pass.from, pass.to, owner.fade, duration)}}`)
    }
    return { p, svg: g({ style: `animation-name:${name}` }, body) }
  })

  // Each qubit is drawn once per value it ever takes, at the origin, and moved
  // by the group around it.
  const riders = timeline.tracks.map((track, i) => {
    rules.push(`@keyframes m${i}{${motion(track, timeline)}}`)
    // One drawing per look it ever has — a swap changes the glyph as well as
    // the colour, and neither can be reached by interpolating.
    const looks = [...new Map(track.stops.map((s) => [lookOf(s), s])).values()]
    const glyphs = looks.map((stop) => {
      const name = `v${i}_${lookOf(stop).replace(/[^a-z0-9_]/gi, '')}`
      rules.push(`@keyframes ${name}{${switching(track, lookOf(stop), timeline)}}`)
      const glyph = theme.draw(
        { t: 'qubit', shape: stop.shape, value: stop.value, cx: 0, cy: 0, size: m.qubit },
        pal,
        m,
      )
      return g({ style: `animation-name:${name};animation-timing-function:step-end` }, glyph)
    })
    return g({ style: `animation-name:m${i}` }, glyphs)
  })

  // Play state and position come from custom properties, so a page showing the
  // file can pause or seek it by setting two variables on any ancestor. The
  // defaults are what the file does on its own, so it still plays unattended —
  // no script inside it, and nothing to strip before sending it to someone.
  const style = [
    `g[style*="animation-name"]{animation-duration:${n(duration)}s;`,
    `animation-timing-function:${EASE};animation-fill-mode:both;`,
    `animation-play-state:var(--misty-play,running);`,
    `animation-delay:var(--misty-at,0s);`,
    `animation-iteration-count:${timeline.loop ? 'infinite' : 1}}`,
    rules.join(''),
  ].join('')

  const bleed = theme.bleed
  const x = box.x - bleed.left
  const y = box.y - bleed.top
  const w = Math.max(1, box.w + bleed.left + bleed.right)
  const h = Math.max(1, box.h + bleed.top + bleed.bottom)
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
    el('style', {}, style) +
      (defs ? el('defs', {}, defs) : '') +
      bg +
      g({}, [
        ...drawn.filter((d) => behind(d.p, timeline.inside)).map((d) => d.svg),
        ...riders,
        ...drawn.filter((d) => !behind(d.p, timeline.inside)).map((d) => d.svg),
      ]),
  )
}

/** The area the drawing needs over the whole run, qubits included. */
export function animationBox(layout: CircuitLayout, timeline: Timeline, m: Metrics): Box {
  const r = m.qubit
  let x0 = layout.box.x
  let y0 = layout.box.y
  let x1 = layout.box.x + layout.box.w
  let y1 = layout.box.y + layout.box.h
  for (const track of timeline.tracks) {
    for (const stop of track.stops) {
      x0 = Math.min(x0, stop.x - r / 2)
      x1 = Math.max(x1, stop.x + r / 2)
      y0 = Math.min(y0, stop.y - r / 2)
      y1 = Math.max(y1, stop.y + r / 2)
    }
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/* -- Rows of terms -------------------------------------------------------- */

/**
 * One term as a row of qubits on the wire columns, with its amplitude in front.
 *
 * The amplitude is the whole reason these rows are worth watching — two of them
 * landing together and adding is the arithmetic — so it is written beside every
 * row rather than only where it is surprising.
 */
export function rowPrims(
  bits: string,
  amp: number,
  y: number,
  geometry: CircuitGeometry,
  m: Metrics,
  dx = 0,
): Prim[] {
  const out: Prim[] = [...bits].map((bit, i) => ({
    t: 'qubit',
    shape: geometry.shapes[i],
    value: bit === '1' ? 1 : 0,
    cx: geometry.columns[i] + dx,
    cy: y,
    size: m.qubit,
  }))

  const edge = geometry.columns[0] + dx - m.qubit / 2 - m.signGap
  if (Math.abs(amp) !== 1) {
    const text = String(Math.abs(amp))
    out.push({
      t: 'text',
      x: edge,
      cy: y,
      text,
      size: m.fontSize,
      anchor: 'end',
      mono: true,
    })
  }
  if (amp < 0) {
    const back = Math.abs(amp) === 1 ? 0 : textWidth(String(Math.abs(amp)), m.fontSize, false) + m.signGap
    out.push({
      t: 'sign',
      x: edge - back - m.barWidth * 2,
      cy: y,
      w: m.barWidth * 2,
      h: m.barWidth,
    })
  }
  return out
}

/** Which layers are being passed through at `t`, for fading their casings. */
const busyAt = (timeline: TermTimeline, t: number): number[] =>
  timeline.passes.filter((p) => t >= p.from && t <= p.to).map((p) => p.layer)

/** Compose one instant of a term-by-term animation. */
export function termFrameAt(
  layout: CircuitLayout,
  timeline: TermTimeline,
  t: number,
  m: Metrics,
): Prim[] {
  const { geometry } = layout
  const busy = busyAt(timeline, t)
  const bands = busy.map((at) => geometry.layers[at])

  const faded = layout.prims.map((p): Prim => {
    const owner = belongsTo(p, geometry.layers)
    if (!owner || !timeline.inside) return p
    return busy.includes(owner.layer) ? { ...p, opacity: owner.fade } : p
  })
  void bands

  const riders: Prim[] = []
  for (const cloud of timeline.clouds) {
    const now = fadeAt(cloud, t)
    if (now.alpha <= 0.01) continue
    const puff: Prim = {
      t: 'cloud',
      content: { ...cloud.box, x: cloud.box.x + now.x, y: cloud.box.y + now.y },
      seed: 'terms',
      depth: 0,
    }
    riders.push(now.alpha >= 1 ? puff : { ...puff, opacity: now.alpha })
  }
  for (const bar of timeline.bars) {
    const now = fadeAt(bar, t)
    if (now.alpha <= 0.01) continue
    const rule: Prim = { t: 'bar', x: bar.x + now.x, cy: bar.cy + now.y, h: bar.h }
    riders.push(now.alpha >= 1 ? rule : { ...rule, opacity: now.alpha })
  }
  for (const row of timeline.rows) {
    const now = rowAt(row, t)
    if (now.alpha <= 0.01) continue
    for (const p of rowPrims(row.bits, row.amp, now.y, geometry, m, now.x)) {
      riders.push(now.alpha >= 1 ? p : { ...p, opacity: now.alpha })
    }
  }

  const back = (p: Prim) => behind(p, timeline.inside)
  return [...faded.filter(back), ...riders, ...faded.filter((p) => !back(p))]
}

/** Keyframes fading a gate over every spell it is being passed through. */
function fadingMany(spells: { from: number; to: number }[], fade: number, duration: number): string {
  const steps = ['0%{opacity:1}']
  for (const spell of spells) {
    const edge = (spell.to - spell.from) * 0.15
    steps.push(
      `${pc(spell.from, duration)}{opacity:1}`,
      `${pc(spell.from + edge, duration)}{opacity:${fade}}`,
      `${pc(spell.to - edge, duration)}{opacity:${fade}}`,
      `${pc(spell.to, duration)}{opacity:1}`,
    )
  }
  steps.push('100%{opacity:1}')
  return steps.join('')
}

/** The whole term-by-term animation as one self-contained SVG. */
export function animatedTermSvg(
  layout: CircuitLayout,
  timeline: TermTimeline,
  box: Box,
  theme: Theme,
  pal: Palette,
  m: Metrics,
  opts: AnimatedSvgOptions = {},
): string {
  const { geometry } = layout
  const duration = timeline.duration
  const rules: string[] = []

  const drawn = layout.prims.map((p) => {
    const owner = belongsTo(p, geometry.layers)
    const body = theme.draw(p, pal, m)
    // A closed gate stays closed: nothing fades, because there is nothing
    // being shown inside it.
    if (!owner || !timeline.inside) return { p, svg: body }
    const spells = timeline.passes.filter((q) => q.layer === owner.layer)
    if (!spells.length) return { p, svg: body }
    const name = `f${owner.layer}${owner.fade === GATE_FADE ? 'c' : 'm'}`
    if (!rules.some((r) => r.startsWith(`@keyframes ${name}{`))) {
      rules.push(`@keyframes ${name}{${fadingMany(spells, owner.fade, duration)}}`)
    }
    return { p, svg: g({ style: `animation-name:${name}` }, body) }
  })

  // One drawing per row, moved and faded. A row never changes what it shows, so
  // there is nothing else to animate.
  /** A cloud or a bar: it fades, and it may travel while it does. */
  const fades = (stops: Fade[], name: string, prim: Prim) => {
    const place = (s: Fade) =>
      `{transform:translate(${n(s.x)}px,${n(s.y)}px);opacity:${n(s.alpha)}}`
    const ends = stops[stops.length - 1]
    rules.push(`@keyframes ${name}{${[
      stops[0].t > 0 ? `0%${place(stops[0])}` : '',
      ...stops.map((s) => `${pc(s.t, duration)}${place(s)}`),
      ends.t < duration ? `100%${place(ends)}` : '',
    ].join('')}}`)
    return g({ style: `animation-name:${name}` }, theme.draw(prim, pal, m))
  }

  const puffs = [
    ...timeline.clouds.map((cloud, i) =>
      fades(cloud.stops, `c${i}`, { t: 'cloud', content: cloud.box, seed: 'terms', depth: 0 })),
    ...timeline.bars.map((bar, i) =>
      fades(bar.stops, `b${i}`, { t: 'bar', x: bar.x, cy: bar.cy, h: bar.h })),
  ]

  const riders = timeline.rows.map((row, i) => {
    const place = (s: { x: number; y: number; alpha: number }) =>
      `{transform:translate(${n(s.x)}px,${n(s.y)}px);opacity:${n(s.alpha)}}`
    // Every row needs a keyframe at nought, even one that does not exist yet.
    // Without it the browser fills the stretch before the first keyframe from
    // the element's own style — no transform and fully opaque — which draws a
    // row that has not been made yet, at the top of the page.
    const ends = row.stops[row.stops.length - 1]
    const frames = [
      row.stops[0].t > 0 ? `0%${place(row.stops[0])}` : '',
      ...row.stops.map((s) => `${pc(s.t, duration)}${place(s)}`),
      ends.t < duration ? `100%${place(ends)}` : '',
    ].join('')
    rules.push(`@keyframes r${i}{${frames}}`)
    const glyphs = rowPrims(row.bits, row.amp, 0, geometry, m).map((p) => theme.draw(p, pal, m))
    return g({ style: `animation-name:r${i}` }, glyphs)
  })

  const style = [
    `g[style*="animation-name"]{animation-duration:${n(duration)}s;`,
    `animation-timing-function:${EASE};animation-fill-mode:both;`,
    `animation-play-state:var(--misty-play,running);`,
    `animation-delay:var(--misty-at,0s);`,
    `animation-iteration-count:${timeline.loop ? 'infinite' : 1}}`,
    rules.join(''),
  ].join('')

  const bleed = theme.bleed
  const x = box.x - bleed.left
  const y = box.y - bleed.top
  const w = Math.max(1, box.w + bleed.left + bleed.right)
  const h = Math.max(1, box.h + bleed.top + bleed.bottom)
  const scale = opts.scale ?? 1
  const defs = theme.defs(pal)
  const bg = opts.background ? el('rect', { x, y, width: w, height: h, fill: pal.paper }) : ''

  return el(
    'svg',
    {
      xmlns: 'http://www.w3.org/2000/svg',
      viewBox: `${n(x)} ${n(y)} ${n(w)} ${n(h)}`,
      width: n(w * scale),
      height: n(h * scale),
      'shape-rendering': 'geometricPrecision',
    },
    el('style', {}, style) +
      (defs ? el('defs', {}, defs) : '') +
      bg +
      g({}, [
        ...drawn.filter((d) => behind(d.p, timeline.inside)).map((d) => d.svg),
        ...puffs,
        ...riders,
        ...drawn.filter((d) => !behind(d.p, timeline.inside)).map((d) => d.svg),
      ]),
  )
}

/** The area a term-by-term animation needs over the whole run. */
export function termAnimationBox(
  layout: CircuitLayout,
  timeline: TermTimeline,
  m: Metrics,
): Box {
  const r = m.qubit
  const { geometry } = layout
  let x0 = layout.box.x
  let y0 = layout.box.y
  let x1 = layout.box.x + layout.box.w
  let y1 = layout.box.y + layout.box.h
  const label = timeline.rows.reduce((w, row) => Math.max(w, labelWidth(row.amp, m)), 0)
  const span = geometry.columns[geometry.columns.length - 1] - geometry.columns[0]
  for (const row of timeline.rows) {
    for (const stop of row.stops) {
      x0 = Math.min(x0, geometry.columns[0] + stop.x - r / 2 - label)
      x1 = Math.max(x1, geometry.columns[0] + stop.x + span + r / 2)
      y0 = Math.min(y0, stop.y - r / 2)
      y1 = Math.max(y1, stop.y + r / 2)
    }
  }
  for (const cloud of timeline.clouds) {
    for (const s of cloud.stops) {
      x0 = Math.min(x0, cloud.box.x + s.x - m.cloudPadX)
      x1 = Math.max(x1, cloud.box.x + s.x + cloud.box.w + m.cloudPadX)
      y0 = Math.min(y0, cloud.box.y + s.y - m.cloudPadY)
      y1 = Math.max(y1, cloud.box.y + s.y + cloud.box.h + m.cloudPadY)
    }
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

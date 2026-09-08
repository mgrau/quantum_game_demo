/**
 * Geometry for misty states.
 *
 * Everything is laid out left to right on a shared vertical centre. Clouds are
 * a two-pass job: their contents are placed first, the enclosing outline is
 * fitted around the resulting box, and then the whole group is shifted so the
 * cloud's outer edge lands where the caller asked for it.
 */

import { boxUnion, type Box } from '../svg'
import { DEFAULT_SHAPE_ORDER, shapeAt, shapeHeight, shapeWidth, type ShapeName } from '../shapes'
import { cloudPath } from '../render/cloud'
import {
  DEFAULT_METRICS, textWidth, translatePrims,
  type Layout, type Metrics, type Prim,
} from '../render/primitives'
import type { CloudNode, Factor, Product, StateDoc, StateRow, Term } from './ast'
import { qubitWidth, turnOf } from './ast'

export interface StateLayoutOptions {
  metrics?: Metrics
  shapeOrder?: ShapeName[]
  dial?: DialMode
}

/**
 * Whether a term's phase is drawn as an angle or spelled as a sign.
 *
 * `auto` shows a dial only where the notation cannot say it another way. A sign
 * says a half turn and an `i` says a quarter, so a state built out of those is
 * drawn exactly as it always was — which is what keeps every figure already
 * written where it is. It is the angles in between, which only a rotation
 * produces and which nothing can be written as, that bring the dials out.
 *
 * And then *all* of that cloud's terms get one, the plain positives included:
 * terms are read against each other, and a row where some carry dials and some
 * do not cannot be read at all.
 */
export type DialMode = 'auto' | 'always' | 'never'

interface Ctx {
  m: Metrics
  order: ShapeName[]
  /** Position to index in `order`, honouring a `shape` line. */
  pick: (slot: number) => number
  dial: DialMode
}

/** Vertical gap between stacked rows. */
const ROW_GAP = 14
/** Gap between an `=` and the expressions either side of it. */
const RELATION_GAP = 14

function emptyLayout(): Layout {
  return { prims: [], box: { x: 0, y: 0, w: 0, h: 0 } }
}

/** Place a run of factors starting at x, centred on cy. */
function layoutFactors(
  factors: Factor[],
  x: number,
  cy: number,
  shapeStart: number,
  depth: number,
  ctx: Ctx,
): Layout {
  const prims: Prim[] = []
  const boxes: Box[] = []
  let cursor = x
  let index = shapeStart

  factors.forEach((f, i) => {
    if (i > 0) cursor += ctx.m.qubitGap

    if (f.kind === 'qubit') {
      // `@N` overrides the shape line rather than being read through it.
      const shape = shapeAt(f.shapeIndex ?? ctx.pick(index), ctx.order)
      const w = shapeWidth(shape, ctx.m.qubit)
      const h = shapeHeight(shape, ctx.m.qubit)
      // Every glyph is centred on its bounding box, so all shapes in a row
      // share the centre line regardless of their outline.
      prims.push({ t: 'qubit', shape, value: f.value, cx: cursor + w / 2, cy, size: ctx.m.qubit, at: f.at })
      boxes.push({ x: cursor, y: cy - h / 2, w, h })
      cursor += w
      index += 1
      return
    }

    if (f.kind === 'op') {
      // Air either side, so `(0|1)×(0|1)` does not read as one run of shapes.
      const pad = ctx.m.fontSize * 0.18
      const w = textWidth(f.symbol, ctx.m.fontSize)
      cursor += pad
      prims.push({
        t: 'text', x: cursor, cy, text: f.symbol,
        // Centred on the math axis, like the relation glyphs it sits among.
        size: ctx.m.fontSize, anchor: 'start', baseline: 'math',
      })
      boxes.push({ x: cursor, y: cy - ctx.m.fontSize / 2, w, h: ctx.m.fontSize })
      cursor += w + pad
      return
    }

    if (f.kind === 'label') {
      const w = textWidth(f.text, ctx.m.fontSize)
      prims.push({
        t: 'text', x: cursor, cy, text: f.text,
        size: ctx.m.fontSize, anchor: 'start',
      })
      boxes.push({ x: cursor, y: cy - ctx.m.fontSize / 2, w, h: ctx.m.fontSize })
      cursor += w
      return
    }

    const sub = layoutCloud(f, cursor, cy, index, depth, ctx)
    prims.push(...sub.prims)
    boxes.push(sub.box)
    cursor = sub.box.x + sub.box.w
    index += qubitWidth(f)
  })

  if (!boxes.length) return emptyLayout()
  return { prims, box: boxUnion(boxes) }
}

/** One term of a cloud: optional sign/coefficient prefix, then its factors. */
function layoutTerm(
  term: Term,
  x: number,
  cy: number,
  shapeStart: number,
  depth: number,
  ctx: Ctx,
  dialled = false,
): Layout {
  const prims: Prim[] = []
  const boxes: Box[] = []
  let cursor = x

  if (dialled) {
    // The dial takes the sign's slot, not the coefficient's: the magnitude is a
    // number and the phase is an angle, and one glyph saying both would be a
    // glyph saying neither.
    const r = ctx.m.qubit * 0.36
    prims.push({ t: 'dial', x: cursor, cy, r, angle: turnOf(term) })
    boxes.push({ x: cursor, y: cy - r, w: r * 2, h: r * 2 })
    cursor += r * 2 + ctx.m.signGap
  } else if (term.sign === -1) {
    // Drawn as geometry, not a glyph, so it sits exactly on the centre line.
    const w = ctx.m.qubit * 0.3
    const h = ctx.m.stroke * 1.5
    prims.push({ t: 'sign', x: cursor, cy, w, h })
    boxes.push({ x: cursor, y: cy - h / 2, w, h })
    cursor += w + ctx.m.signGap
  }

  if (term.coeff !== undefined || (term.imaginary && !dialled)) {
    const size = ctx.m.fontSize
    // `i` on its own where the size is one: `1i` reads as a slip. With a dial
    // beside it the `i` is the dial's to say, so the number stands alone.
    const text = `${term.coeff ?? ''}${term.imaginary && !dialled ? 'i' : ''}`
    const w = textWidth(text, size, true)
    prims.push({ t: 'text', x: cursor, cy, text, size, anchor: 'start', weight: 700 })
    boxes.push({ x: cursor, y: cy - size / 2, w, h: size })
    cursor += w + ctx.m.signGap
  }

  const body = layoutFactors(term.factors, cursor, cy, shapeStart, depth, ctx)
  prims.push(...body.prims)
  boxes.push(body.box)

  return { prims, box: boxUnion(boxes) }
}

/**
 * A cloud: terms separated by `|` bars, wrapped in a fitted outline. Every term
 * restarts shape numbering at the cloud's own start index, so the qubit in the
 * second slot is a square in every term.
 */
function layoutCloud(
  cloud: CloudNode,
  x: number,
  cy: number,
  shapeStart: number,
  depth: number,
  ctx: Ctx,
): Layout {
  const m = ctx.m

  const inner: Prim[] = []
  const boxes: Box[] = []
  const barXs: number[] = []
  let cursor = 0

  // A comma is a glyph on the baseline; a bar is geometry spanning the terms.
  const comma = m.separator === 'comma'
  const sepWidth = comma ? textWidth(',', m.fontSize) : m.barWidth

  // Decided once for the whole cloud, and passed down: a term cannot see its
  // neighbours, and this is a question about all of them together.
  const dialled =
    ctx.dial === 'always' ||
    (ctx.dial === 'auto' && cloud.terms.some((t) => turnOf(t) % 90 !== 0))

  cloud.terms.forEach((term, i) => {
    if (i > 0) {
      cursor += m.termGap
      barXs.push(cursor + sepWidth / 2)
      cursor += sepWidth + m.termGap
    }
    const laid = layoutTerm(term, cursor, cy, shapeStart, depth + 1, ctx, dialled)
    inner.push(...laid.prims)
    boxes.push(laid.box)
    cursor = laid.box.x + laid.box.w
  })

  const contentBox = boxes.length ? boxUnion(boxes) : { x: 0, y: cy, w: 0, h: 0 }

  // Bars span the tallest term so they read as separators, not tick marks.
  const barH = comma ? 0 : Math.max(contentBox.h * 0.94, m.qubit * 0.9)
  for (const bx of barXs) {
    if (comma) {
      inner.push({
        t: 'text', x: bx, cy, text: ',',
        size: m.fontSize, anchor: 'middle', weight: 700,
      })
    } else {
      inner.push({ t: 'bar', x: bx, cy, h: barH })
    }
  }

  const withBars = boxUnion([contentBox, { x: contentBox.x, y: cy - barH / 2, w: contentBox.w, h: barH }])
  const seed = `c${cloud.terms.length}:${Math.round(withBars.w)}x${Math.round(withBars.h)}:${depth}`
  const outer = cloudPath(withBars, seed, m.cloudPadX, m.cloudPadY, m.cloudFluff).box

  const prims: Prim[] = [{ t: 'cloud', content: withBars, seed, depth }, ...inner]
  return shiftTo(prims, outer, x)
}

/** Move a laid-out group so its outer box starts at `x`. */
function shiftTo(prims: Prim[], outer: Box, x: number): Layout {
  const dx = x - outer.x
  return {
    prims: translatePrims(prims, dx, 0),
    box: { ...outer, x: outer.x + dx },
  }
}

function layoutProduct(p: Product, x: number, cy: number, ctx: Ctx): Layout {
  return layoutFactors(p.factors, x, cy, 0, 0, ctx)
}

function layoutRow(row: StateRow, cy: number, ctx: Ctx): Layout {
  const prims: Prim[] = []
  const boxes: Box[] = []
  let cursor = 0

  row.sides.forEach((side, i) => {
    if (i > 0) {
      const rel = row.relations[i - 1] ?? '='
      const size = ctx.m.fontSize * 1.2
      cursor += RELATION_GAP
      const w = textWidth(rel, size, true)
      // Relation symbols centre on the math axis rather than the cap height.
      prims.push({
        t: 'text', x: cursor, cy, text: rel,
        size, anchor: 'start', weight: 700, baseline: 'math',
      })
      boxes.push({ x: cursor, y: cy - size / 2, w, h: size })
      cursor += w + RELATION_GAP
    }
    const laid = layoutProduct(side, cursor, cy, ctx)
    prims.push(...laid.prims)
    boxes.push(laid.box)
    cursor = laid.box.x + laid.box.w
  })

  return { prims, box: boxes.length ? boxUnion(boxes) : { x: 0, y: cy, w: 0, h: 0 } }
}

export function layoutState(doc: StateDoc, opts: StateLayoutOptions = {}): Layout {
  const order = opts.shapeOrder ?? DEFAULT_SHAPE_ORDER
  const ctx: Ctx = {
    m: opts.metrics ?? DEFAULT_METRICS,
    order,
    // A `shape` line pins shapes by name; everything downstream numbers them,
    // so a name is turned back into its position in the current order here.
    dial: opts.dial ?? 'auto',
    pick: (slot) => {
      const p = doc.shapePicks?.[slot]
      if (p === undefined) return slot
      if (typeof p === 'number') return p
      const at = order.indexOf(p)
      return at < 0 ? slot : at
    },
  }

  const laidRows = doc.rows.map((row) => ({
    row,
    layout: layoutRow(row, 0, ctx),
  }))

  /*
   * Annotations sit in gutters either side, each aligned to a single edge so a
   * column of them reads as a column. The left one is reserved up front, since
   * it shifts every row across; the right one only widens the drawing.
   */
  const captionSize = ctx.m.fontSize * 0.85
  const annotationGap = ctx.m.qubit * 0.5
  const gutter = laidRows.reduce((max, { row }) => {
    const c = row.sides[0].caption
    return c ? Math.max(max, textWidth(c, captionSize, false, true) + annotationGap) : max
  }, 0)

  const prims: Prim[] = []
  const boxes: Box[] = []
  let y = 0

  // Rows share a centre line rather than a left edge, so a factored form sits
  // centred under the state it came from instead of hanging off to one side.
  const widest = laidRows.reduce((max, { layout }) => Math.max(max, layout.box.w), 0)

  for (const { row, layout } of laidRows) {
    const dy = y - layout.box.y
    const dx = gutter + (widest - layout.box.w) / 2 - layout.box.x
    const moved = translatePrims(layout.prims, dx, dy)
    const box: Box = { ...layout.box, x: layout.box.x + dx, y: layout.box.y + dy }

    const caption = row.sides[0].caption
    if (caption) {
      const cy = box.y + box.h / 2
      prims.push({
        t: 'text',
        x: gutter - ctx.m.qubit * 0.5,
        cy,
        text: caption,
        size: captionSize,
        anchor: 'end',
        // Regular, like a circuit's annotations and like the prose these sit
        // beside. Semibold here and plain there was two answers to one
        // question, and in a serif face the heavier one reads as emphasis
        // nobody asked for.
        serif: true,
      })
      boxes.push({
        x: gutter - ctx.m.qubit * 0.5 - textWidth(caption, captionSize, false, true),
        y: cy - captionSize / 2,
        w: textWidth(caption, captionSize, false, true),
        h: captionSize,
      })
    }

    const note = row.sides[0].note
    if (note) {
      const cy = box.y + box.h / 2
      // Left-aligned against the far edge of the widest row, so the notes line
      // up with each other rather than ragging along the states.
      const x = gutter + widest + annotationGap
      prims.push({
        t: 'text', x, cy, text: note,
        size: captionSize, anchor: 'start', serif: true,
      })
      boxes.push({
        x, y: cy - captionSize / 2,
        w: textWidth(note, captionSize, false, true), h: captionSize,
      })
    }

    prims.push(...moved)
    boxes.push(box)
    y = box.y + box.h + ROW_GAP
  }

  return { prims, box: boxUnion(boxes) }
}

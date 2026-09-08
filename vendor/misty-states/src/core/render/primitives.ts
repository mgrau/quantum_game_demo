/**
 * Positioned, theme-agnostic drawing instructions.
 *
 * Layout produces these; a theme turns them into SVG. Keeping the two apart is
 * what lets the flat, solid and isometric looks share identical geometry.
 */

import type { ShapeName } from '../shapes'
import type { Box } from '../svg'
import type { QubitValue } from '../state/ast'

export interface QubitPrim {
  t: 'qubit'
  shape: ShapeName
  value: QubitValue
  cx: number
  cy: number
  size: number
  /**
   * Where in the source the character that drew this was written.
   *
   * Carried all the way from the parser so that pointing at a qubit on screen
   * leads back to the one letter that says what it is. Absent where the parser
   * could not say honestly, and then this qubit is simply not one you can
   * point at.
   */
  at?: number
}

/**
 * A term's phase, drawn as an angle rather than spelled as a sign.
 *
 * Zero points right and the angle counts anticlockwise, the way an Argand
 * diagram does. SVG's y runs downwards, so the hand lands at `(cos θ, −sin θ)`.
 */
export interface DialPrim {
  t: 'dial'
  x: number
  cy: number
  r: number
  /** Degrees. */
  angle: number
}

/** The bumpy outline enclosing a superposition. */
export interface CloudPrim {
  t: 'cloud'
  content: Box
  seed: string
  /** Nesting depth, so inner clouds can be drawn slightly lighter. */
  depth: number
}

/** The `|` separating terms inside a cloud. */
export interface BarPrim {
  t: 'bar'
  x: number
  cy: number
  h: number
}

export interface TextPrim {
  t: 'text'
  x: number
  cy: number
  text: string
  size: number
  anchor: 'start' | 'middle' | 'end'
  weight?: number
  color?: string
  mono?: boolean
  /**
   * Drawn on a filled chip in the accent colour, lettered in white.
   *
   * What a name standing on a target is drawn as, so it reads the way the `⊕`
   * it replaces reads: the same blue, the same white mark inside it. The colour
   * is the palette's and not named here — a layout says what a thing *is*, and
   * a theme says what colour that comes out.
   */
  chip?: boolean
  /**
   * Set in the serif face rather than the interface's sans one.
   *
   * For the annotations, which are prose about the figure rather than part of
   * it — they read as a caption in a paper, and a paper is not set in Arial.
   */
  serif?: boolean
  /** Degrees clockwise about the run's own anchor. -90 reads bottom-to-top. */
  rotate?: number
  /**
   * How to centre the run on `cy`. 'cap' centres the cap height and suits
   * letters and digits; 'math' centres on the font's math axis and suits
   * symbols like `=`. Defaults to 'cap'.
   */
  baseline?: 'cap' | 'math'
}

/**
 * The `-` of a negative amplitude, drawn as geometry rather than a glyph so it
 * lands exactly on the centre line and keeps a consistent weight.
 */
export interface SignPrim {
  t: 'sign'
  x: number
  cy: number
  w: number
  h: number
}

/** Vertical pipe segment a qubit falls through. */
export interface PipePrim {
  t: 'pipe'
  cx: number
  y0: number
  y1: number
  w: number
  /**
   * The upper end is an open mouth rather than a join into a gate.
   *
   * A projection that shows a bore draws it only here: where a pipe leaves a
   * gate there is nothing to see, and drawing one would put a rim over the
   * gate's bottom edge.
   */
  openTop: boolean
}

export interface GateBoxPrim {
  t: 'gatebox'
  box: Box
  label: string
  accent?: string
  fill?: string
  blank?: boolean
  /** Font size chosen by layout so long labels still fit. */
  labelSize: number
  /**
   * A second, smaller line under the label: a rotation's angle.
   *
   * Kept apart from the label rather than folded into it — `RZ(90)` on one line
   * either overflows the box or shrinks the letters to nothing, and the letters
   * are what the gate is called.
   */
  sub?: string
  /** A smaller letter set below the line after the label: `R` and its axis. */
  subscript?: string
}

/**
 * The glazed panel inside a window's frame.
 *
 * Flat in every theme: the frame is the thing that is projected, and glass set
 * into its front face reads as glass whichever way the box is drawn.
 */
export interface PanePrim {
  t: 'pane'
  box: Box
  fill?: string
  /**
   * How much of the chart's colour this pane carries, from -1 to 1.
   *
   * Signed, so a bar below the axis is a different colour rather than the same
   * one upside down; scaled, so a small contribution is pale and a large one is
   * strong. Given as a number rather than a colour because layout runs before
   * the palette is chosen, and dark mode wants different ends to the ramp.
   */
  tone?: number
}

export interface MeasureBoxPrim {
  t: 'measurebox'
  box: Box
  basis: string
}

export interface ControlPrim {
  t: 'control'
  cx: number
  cy: number
  r: number
}

export interface TargetPrim {
  t: 'target'
  cx: number
  cy: number
  r: number
  /**
   * `not` is the ⊕, `z` the filled dot, and anything else is drawn as itself.
   *
   * A free string rather than a closed set, because the course marks a port
   * with whatever letter says what it does — `Ⓒ` for copy, `×` for control on
   * the cloning box. The cost is that the theme switch is no longer exhaustive,
   * which is why the fallback draws the text rather than nothing.
   */
  glyph: 'not' | 'z' | (string & {})
}

export interface SwapPrim {
  t: 'swap'
  cx: number
  cy: number
  r: number
}

/**
 * A straight line, for the grid of a table.
 *
 * Kept separate from a bordered box so adjacent cells share one stroke rather
 * than doubling it, and so the grid can be drawn open — a rule under the
 * headers and nothing else — as well as closed.
 */
export interface RulePrim {
  t: 'rule'
  x0: number
  y0: number
  x1: number
  y1: number
}

/** Horizontal wire joining controls to their target. */
export interface LinkPrim {
  t: 'link'
  x0: number
  x1: number
  cy: number
}

/**
 * Anything drawable, optionally faded.
 *
 * `opacity` is carried on the union rather than on each member because it means
 * the same thing for all of them and is applied in one place — the emitter
 * wraps a faded primitive rather than every theme handling it. Narrowing on `t`
 * still works through the intersection.
 */
export type Prim = (
  | QubitPrim | CloudPrim | BarPrim | TextPrim | SignPrim | DialPrim | PipePrim
  | GateBoxPrim | PanePrim | MeasureBoxPrim | ControlPrim | TargetPrim | SwapPrim | LinkPrim
  | RulePrim
) & {
  opacity?: number
  /**
   * A name that survives redrawing, for anything that wants to animate.
   *
   * Every render produces a fresh SVG string, so nothing in the document has an
   * identity of its own — a gate that shifted is indistinguishable from one that
   * was deleted and another added. This gives the pieces that stand for
   * something a stable handle, emitted as `data-key`, so a viewer can match a
   * gate to where it used to be. Nothing in the drawing depends on it.
   */
  key?: string
  /**
   * This piece is being placed rather than merely drawn.
   *
   * Emitted as `data-highlight` and left unstyled: how a viewer marks it is the
   * viewer's business, and a figure exported mid-drag should not carry a
   * highlight into the file.
   */
  highlight?: boolean
}

/** Layout result: what to draw, and the bounds it occupies. */
export interface Layout {
  prims: Prim[]
  box: Box
}

/**
 * Shift primitives by (dx, dy).
 *
 * Layout places a cloud's contents before it knows where the cloud's outline
 * will land, then moves the whole group into position — so this is used on
 * every nesting level, and for stacking rows.
 */
export function translatePrims(prims: Prim[], dx: number, dy: number): Prim[] {
  if (dx === 0 && dy === 0) return prims
  return prims.map((p): Prim => {
    switch (p.t) {
      case 'qubit':
      case 'control':
      case 'target':
      case 'swap':
        return { ...p, cx: p.cx + dx, cy: p.cy + dy }
      case 'cloud':
        return { ...p, content: { ...p.content, x: p.content.x + dx, y: p.content.y + dy } }
      case 'dial':
      case 'bar':
      case 'text':
      case 'sign':
        return { ...p, x: p.x + dx, cy: p.cy + dy }
      case 'pipe':
        return { ...p, cx: p.cx + dx, y0: p.y0 + dy, y1: p.y1 + dy }
      case 'link':
        return { ...p, x0: p.x0 + dx, x1: p.x1 + dx, cy: p.cy + dy }
      case 'rule':
        return { ...p, x0: p.x0 + dx, x1: p.x1 + dx, y0: p.y0 + dy, y1: p.y1 + dy }
      case 'gatebox':
      case 'pane':
      case 'measurebox':
        return { ...p, box: { ...p.box, x: p.box.x + dx, y: p.box.y + dy } }
    }
  })
}

/**
 * Advance widths for the Helvetica/Arial metrics the sans stack resolves to,
 * in units per 1000 em.
 *
 * A flat per-character average is not good enough: `%` is 0.889 em against a
 * digit's 0.556, so a right-anchored caption like `50%` would be measured ~13%
 * short and clip off the left edge of its own box.
 */
const ADVANCE: Record<string, number> = {
  ' ': 278, '!': 278, '"': 355, '#': 556, $: 556, '%': 889, '&': 667, "'": 191,
  '(': 333, ')': 333, '*': 389, '+': 584, ',': 278, '-': 333, '.': 278, '/': 278,
  '0': 556, '1': 556, '2': 556, '3': 556, '4': 556, '5': 556, '6': 556, '7': 556,
  '8': 556, '9': 556,
  ':': 278, ';': 278, '<': 584, '=': 584, '>': 584, '?': 556, '@': 1015,
  A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 500,
  K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611,
  U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  '[': 278, '\\': 278, ']': 278, '^': 469, _: 556, '`': 333,
  a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222,
  k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278,
  u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
  '{': 334, '|': 260, '}': 334, '~': 584,
  '≠': 549, '→': 987, '−': 584, '×': 584,
}

/**
 * The same, for the serif face the annotations are set in.
 *
 * Adobe's Times-Roman widths, which is what a machine without a Computer
 * Modern installed will fall back to and is close enough to one that has. A
 * serif runs a good deal narrower than Helvetica — `e` is 444 against 556 —
 * so measuring annotations against the sans table would reserve a gutter half
 * a letter too wide on every line.
 */
const SERIF_ADVANCE: Record<string, number> = {
  ' ': 250, '!': 333, '"': 408, '#': 500, $: 500, '%': 833, '&': 778, "'": 180,
  '(': 333, ')': 333, '*': 500, '+': 564, ',': 250, '-': 333, '.': 250, '/': 278,
  '0': 500, '1': 500, '2': 500, '3': 500, '4': 500, '5': 500, '6': 500, '7': 500,
  '8': 500, '9': 500,
  ':': 278, ';': 278, '<': 564, '=': 564, '>': 564, '?': 444, '@': 921,
  A: 722, B: 667, C: 667, D: 722, E: 611, F: 556, G: 722, H: 722, I: 333, J: 389,
  K: 722, L: 611, M: 889, N: 722, O: 722, P: 556, Q: 722, R: 667, S: 556, T: 611,
  U: 722, V: 722, W: 944, X: 722, Y: 722, Z: 611,
  '[': 333, '\\': 278, ']': 333, '^': 469, _: 500, '`': 333,
  a: 444, b: 500, c: 444, d: 500, e: 444, f: 333, g: 500, h: 500, i: 278, j: 278,
  k: 500, l: 278, m: 778, n: 500, o: 500, p: 500, q: 500, r: 333, s: 389, t: 278,
  u: 500, v: 500, w: 722, x: 500, y: 500, z: 444,
  '{': 480, '|': 200, '}': 480, '~': 541,
  '≠': 549, '→': 987, '−': 564, '×': 564,
}

/** Fallback for anything outside the table — a touch generous, never short. */
const DEFAULT_ADVANCE = 600

/**
 * Advance width of a text run, used for centring, gutters and label fitting.
 *
 * `serif` measures against the face the annotations are set in. Which one a
 * reader actually has is not knowable from here — the stack asks for Computer
 * Modern and takes what it can get — so the table is Times, the near-universal
 * fallback, and the margin below covers the spread between the faces that
 * stack can land on.
 */
export function textWidth(text: string, size: number, bold = false, serif = false): number {
  const table = serif ? SERIF_ADVANCE : ADVANCE
  let units = 0
  for (const ch of text) units += table[ch] ?? DEFAULT_ADVANCE
  // Bold faces run a few percent wider at the same nominal size. The serif
  // stack gets a little more again, since a gutter measured short would let an
  // annotation run past the edge of the drawing and off an exported figure,
  // and one measured long only costs a few pixels of white.
  return (units / 1000) * size * (bold ? 1.06 : 1) * (serif ? 1.06 : 1)
}

/**
 * How wide the chip behind a label is drawn.
 *
 * Shared, because two places need to agree on it and they are not near each
 * other: the theme draws the chip, and the layout has to leave room for one
 * and know where its edge falls so a link can stop there.
 */
export function chipWidth(text: string, size: number, subscript = ''): number {
  const subW = subscript ? textWidth(subscript, size * 0.66, true) : 0
  const mainW = textWidth(text, size, true)
  return Math.max(
    size * 1.25,
    (mainW + subW) * 1.18,
    subscript ? mainW + subW + size * 0.5 : 0,
  )
}

export interface Metrics {
  qubit: number
  qubitGap: number
  termGap: number
  barWidth: number
  cloudPadX: number
  cloudPadY: number
  signGap: number
  /** Glyph drawn between the terms of a superposition. */
  separator: 'bar' | 'comma'
  /**
   * How round the cloud's lobes are. 1 is the reference; lower flattens the
   * outline toward a rounded rectangle, higher makes it bubblier.
   */
  cloudFluff: number
  /** Outline weight for qubit glyphs. */
  stroke: number
  /** Outline weight for cloud outlines — lighter, so clouds read as vapour. */
  cloudStroke: number
  fontSize: number
  /**
   * Circuit metrics.
   *
   * There is a single pipe diameter: the stubs a gate carries, the runs between
   * gates, and an identity are all the same pipe, so they join without a seam.
   */
  pipeWidth: number
  colGap: number
  gateHeight: number
  gateGap: number
}

export const DEFAULT_METRICS: Metrics = {
  qubit: 26,
  qubitGap: 4,
  termGap: 6,
  barWidth: 3.2,
  cloudPadX: 14,
  cloudPadY: 11,
  signGap: 3,
  separator: 'bar',
  cloudFluff: 1,
  stroke: 2.2,
  cloudStroke: 1.3,
  fontSize: 22,
  pipeWidth: 30,
  colGap: 30,
  gateHeight: 54,
  gateGap: 10,
}

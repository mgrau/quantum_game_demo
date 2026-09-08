/**
 * AST for misty states.
 *
 * A *factor* is one drawable atom: a qubit, a cloud, or an unknown. A *term* is
 * a juxtaposed run of factors with an optional sign and coefficient. A *cloud*
 * is a `|`-separated list of terms. Clouds nest inside terms, which is what
 * makes rules 4 and 6 (flattening and distribution) expressible.
 */

import type { ShapePick } from '../shapes'

export type QubitValue = 0 | 1 | 'unknown'

export interface QubitNode {
  kind: 'qubit'
  value: QubitValue
  /** Explicit shape override from `0@3` syntax; otherwise position decides. */
  shapeIndex?: number
  /**
   * Where in the source the `0`, `1` or `?` was written.
   *
   * An index into the whole document, so that a qubit pointed at in the drawing
   * can be changed by rewriting the one character it came from. Counting them
   * afterwards would not do: plenty of `0`s and `1`s in a source are not
   * qubits — a coefficient of 10, a wire number, an angle of 180 — and only
   * the parser knows which is which, because only the parser read them as one.
   */
  at?: number
}

export interface CloudNode {
  kind: 'cloud'
  terms: Term[]
}

export interface LabelNode {
  kind: 'label'
  text: string
}

/**
 * An operator drawn between factors. Written `x` or `*` and drawn `×`, for the
 * multiplication of two misty states.
 */
export interface OpNode {
  kind: 'op'
  symbol: '×'
}

export type Factor = QubitNode | CloudNode | LabelNode | OpNode

export interface Term {
  sign: 1 | -1
  /** Integer amplitude weight; undefined means 1 and draws no prefix. */
  coeff?: number
  /**
   * The weight is a quarter turn rather than a plain number: `2i`, not `2`.
   *
   * A term carries one or the other, never a mixture — `2+3i` on one basis
   * state is written as two terms that add, which is what the notation already
   * does for every other sum. So the flag is enough, and an amplitude keeps
   * the shape a reader expects: a sign, a size, and possibly an `i`.
   */
  imaginary?: boolean
  /**
   * The phase this term carries, in degrees, where it is drawn as an angle.
   *
   * Set only by a calculated state being written for the dial, which merges the
   * two terms an amplitude with both parts would otherwise need into one. Left
   * unset everywhere else, where `turnOf` reads the angle off the sign and the
   * `i` — those being the only phases the notation can write.
   */
  turn?: number
  factors: Factor[]
}

/**
 * The angle a term stands at, in degrees.
 *
 * Zero is the positive real axis and it counts anticlockwise, so a minus sign
 * is a half turn and an `i` is a quarter. Nothing the notation can write lands
 * anywhere else; a calculated state can, and says so with `turn`.
 */
export function turnOf(term: Term): number {
  if (term.turn !== undefined) return ((term.turn % 360) + 360) % 360
  const quarter = term.imaginary ? 90 : 0
  return term.sign === -1 ? (quarter + 180) % 360 : quarter
}

/** One side of an `=` chain: a juxtaposed product of factors. */
export interface Product {
  factors: Factor[]
  /** Annotation drawn to the left, written `50%: 0(0|1)`. */
  caption?: string
  /** Annotation drawn to the right, written `0(0|1) : after measuring`. */
  note?: string
}

/** One line of input: products joined by relation glyphs. */
export interface StateRow {
  /** Written `answer`: hidden behind unknowns until the answer is asked for. */
  answer?: boolean
  /** Sides separated by `=`. A single side is the common case. */
  sides: Product[]
  /** Relation glyphs between sides, one fewer than `sides`. */
  relations: string[]
}

/** A whole state document. Each input line becomes a row, stacked vertically. */
export interface StateDoc {
  kind: 'state'
  rows: StateRow[]
  /** Per-position shape override from a `shape` line; defaults to order. */
  shapePicks?: ShapePick[]
}

/** Number of qubit slots a factor occupies, used to advance shape numbering. */
export function qubitWidth(f: Factor): number {
  switch (f.kind) {
    case 'qubit':
      return 1
    case 'label':
    case 'op':
      return 0
    case 'cloud':
      return f.terms.reduce(
        (max, t) => Math.max(max, t.factors.reduce((s, x) => s + qubitWidth(x), 0)),
        0,
      )
  }
}

export function productWidth(p: Product): number {
  return p.factors.reduce((s, f) => s + qubitWidth(f), 0)
}

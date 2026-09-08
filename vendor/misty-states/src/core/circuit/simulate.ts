/**
 * Working out what a circuit does to a state.
 *
 * The arithmetic is **exact integers**, which is not a shortcut but the whole
 * reason this is worth doing. Take the PETE box unnormalised — `0 → 0|1` and
 * `1 → 0|-1` — and the course's gates all map integer amplitudes to integer
 * amplitudes. `H·H = 2I`, and the factor of two divides straight back out. So
 * there is no floating point anywhere, nothing to round, and the answer lands
 * in the notation already drawn: reduce the terms by their common factor and
 * `3*0|2*1` falls out on its own.
 *
 * A state is a map from bit string to amplitude, the bit string reading left to
 * right as qubit 1 upward. Amplitudes of zero are dropped rather than stored.
 * A circuit that writes no input starts from every wire white.
 *
 * What it will not do, it says so about rather than guessing: `S`, `T` and `Y`
 * need complex amplitudes that the notation cannot draw, `BOX` and `BLANK` are
 * pictures rather than operations, and `?` has no value to propagate.
 */

import type { ChartBar, CircuitDoc, Gate, Layer, TableLine } from './ast'
import { gateQubits } from './ast'
import type { CloudNode, Factor, Product, QubitNode, StateRow, Term } from '../state/ast'
import {
  I, ONE, ZERO, abs2, add as cxAdd, commonFactor, cx, eq, isReal, isZero, mul, neg, over,
  isWhole, show, times as cxTimes, unitToClear, type Cx,
} from './complex'

/**
 * Bit string → amplitude. Zero amplitudes are absent, not stored.
 *
 * Gaussian integers, so `S` and `Y` are expressible without giving up the
 * exactness the rest of this file depends on — see `complex.ts` for why whole
 * numbers survive the addition of a phase.
 */
export type Amplitudes = Map<string, Cx>

/** Something the notation can express but the arithmetic cannot follow. */
export class SimulationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SimulationError'
  }
}

/* -- Reading a state in -------------------------------------------------- */

function scale(amps: Amplitudes, by: Cx): Amplitudes {
  const out: Amplitudes = new Map()
  if (isZero(by)) return out
  for (const [bits, amp] of amps) out.set(bits, mul(amp, by))
  return out
}

function add(into: Amplitudes, from: Amplitudes) {
  for (const [bits, amp] of from) {
    const sum = cxAdd(into.get(bits) ?? ZERO, amp)
    if (isZero(sum)) into.delete(bits)
    else into.set(bits, sum)
  }
}

/** Tensor product: every combination, bit strings concatenated. */
function tensor(a: Amplitudes, b: Amplitudes): Amplitudes {
  const out: Amplitudes = new Map()
  for (const [aBits, aAmp] of a) {
    for (const [bBits, bAmp] of b) {
      const bits = aBits + bBits
      const sum = cxAdd(out.get(bits) ?? ZERO, mul(aAmp, bAmp))
      if (isZero(sum)) out.delete(bits)
      else out.set(bits, sum)
    }
  }
  return out
}

function factorAmplitudes(factor: Factor): Amplitudes {
  switch (factor.kind) {
    case 'qubit':
      if (factor.value === 'unknown') {
        throw new SimulationError('“?” has no value, so there is nothing to calculate from')
      }
      return new Map([[String(factor.value), ONE]])
    case 'cloud': {
      const out: Amplitudes = new Map()
      for (const term of factor.terms) add(out, termAmplitudes(term))
      return out
    }
    case 'label':
      throw new SimulationError(`“${factor.text}” is a label, not a state`)
    case 'op':
      throw new SimulationError('“×” cannot be calculated through')
  }
}

/**
 * One side of an equation, as amplitudes over exactly the wires it names.
 *
 * Unlike `amplitudesOf` this neither rejects a row with relations nor pads to a
 * register — an equation's two sides are compared with each other, and how wide
 * they are is part of what is being checked.
 */
export function sideAmplitudes(side: Product): Amplitudes {
  return productAmplitudes(side.factors)
}

function productAmplitudes(factors: Factor[]): Amplitudes {
  let out: Amplitudes = new Map([['', ONE]])
  for (const factor of factors) out = tensor(out, factorAmplitudes(factor))
  return out
}

function termAmplitudes(term: Term): Amplitudes {
  const size = term.sign * (term.coeff ?? 1)
  return scale(productAmplitudes(term.factors), term.imaginary ? cx(0, size) : cx(size))
}

/**
 * Read a written state as amplitudes over `qubits` wires.
 *
 * A state narrower than the register describes the wires it names and leaves
 * the rest in |0⟩, which is the usual convention and the only reading available.
 */
export function amplitudesOf(row: StateRow, qubits: number): Amplitudes {
  if (row.sides.length !== 1 || row.relations.length) {
    throw new SimulationError('an equation is not a state to calculate from')
  }
  const amps = productAmplitudes(row.sides[0].factors)
  const width = amps.size ? [...amps.keys()][0].length : 0
  if (width > qubits) {
    throw new SimulationError(`this state describes ${width} qubits but the circuit has ${qubits}`)
  }
  if (width === qubits) return amps
  const pad = '0'.repeat(qubits - width)
  return new Map([...amps].map(([bits, amp]) => [bits + pad, amp]))
}

/* -- Applying gates ------------------------------------------------------ */

const flip = (bits: string, q: number) =>
  bits.slice(0, q - 1) + (bits[q - 1] === '0' ? '1' : '0') + bits.slice(q)

/** Rebuild the map one bit string at a time, dropping anything that cancels. */
function mapStates(
  amps: Amplitudes,
  each: (bits: string, amp: Cx, emit: (bits: string, amp: Cx) => void) => void,
): Amplitudes {
  const out: Amplitudes = new Map()
  const emit = (bits: string, amp: Cx) => {
    if (isZero(amp)) return
    const sum = cxAdd(out.get(bits) ?? ZERO, amp)
    if (isZero(sum)) out.delete(bits)
    else out.set(bits, sum)
  }
  for (const [bits, amp] of amps) each(bits, amp, emit)
  return out
}

/**
 * Anything smaller than this is nothing.
 *
 * With whole numbers a term either cancels or it does not, and this never
 * fires. With cosines in the arithmetic it is the difference between a term
 * cancelling and the state growing a phantom worth `1e-17`.
 */
const TINY = 1e-12

/** A number that is a whole one, once floating point has been forgiven. */
const tidy = (n: number): number =>
  Math.abs(n - Math.round(n)) < TINY ? Math.round(n) + 0 : n

/**
 * A one-wire gate as its matrix, applied to one term.
 *
 * `new[0] = m00·old[0] + m01·old[1]`, and likewise for `new[1]` — so a term
 * whose bit is white contributes `m00` to white and `m10` to black.
 */
const oneWire = (q: number, m: [Cx, Cx, Cx, Cx]): Spread => {
  const [m00, m01, m10, m11] = m
  return (bits, amp, emit) => {
    const zero = bits.slice(0, q - 1) + '0' + bits.slice(q)
    const one = bits.slice(0, q - 1) + '1' + bits.slice(q)
    const from1 = bits[q - 1] === '1'
    emit(zero, mul(amp, from1 ? m01 : m00))
    emit(one, mul(amp, from1 ? m11 : m10))
  }
}

/**
 * A rotation, by however many degrees.
 *
 * Defined up to global phase, which is unobservable and normalised away
 * everywhere else in here — that is what makes `RZ` and `P` the same gate, and
 * what puts every right angle exactly within reach of whole numbers.
 *
 * The common `1/√2` that appears when the two halves are the same size divides
 * straight out, exactly as it does for `H`: unnormalised, `RX(90)` is
 * `[[1, -i], [-i, 1]]` and every entry is whole.
 */
function turnOf(label: string, qubit: number, angle: number): Spread {
  const half = (angle * Math.PI) / 360
  let c = Math.cos(half)
  let s = Math.sin(half)
  if (Math.abs(Math.abs(c) - Math.abs(s)) < TINY && Math.abs(c) > TINY) {
    const k = 1 / Math.abs(c)
    c *= k
    s *= k
  }
  c = tidy(c)
  s = tidy(s)

  if (label === 'RZ' || label === 'P') {
    // Up to global phase both are `diag(1, e^{iθ})`, so a whole turn of the
    // black half and nothing at all to the white one.
    const t = (angle * Math.PI) / 180
    const on = cx(tidy(Math.cos(t)), tidy(Math.sin(t)))
    return (bits, amp, emit) => emit(bits, bits[qubit - 1] === '1' ? mul(amp, on) : amp)
  }
  if (label === 'RY') {
    return oneWire(qubit, [cx(c), cx(-s), cx(s), cx(c)])
  }
  return oneWire(qubit, [cx(c), cx(0, -s), cx(0, -s), cx(c)])
}

/** What one gate does to one term, as the emissions it produces. */
type Spread = (bits: string, amp: Cx, emit: (bits: string, amp: Cx) => void) => void

/**
 * How a gate acts on a single term.
 *
 * Lifted out of `applyGate` so the arithmetic has exactly one home. Applying a
 * gate runs this through `mapStates`, which merges and cancels as it goes;
 * tracing it runs the same function and keeps every emission apart. Two copies
 * of this logic would be two chances to disagree about what a gate does.
 */
function spreadOf(gate: Gate): Spread | null {
  switch (gate.kind) {
    // None of these does anything to the state; the first two are drawings and
    // a measurement is where the branch loop turns one state into several.
    case 'identity':
    case 'view':
    case 'measure':
      return null

    case 'single':
      if (gate.label === 'H') {
        // Unnormalised, which is what keeps every amplitude an integer:
        // white in gives white plus black, black in gives white minus black.
        return (bits, amp, emit) => {
          const zero = bits.slice(0, gate.qubit - 1) + '0' + bits.slice(gate.qubit)
          const one = bits.slice(0, gate.qubit - 1) + '1' + bits.slice(gate.qubit)
          emit(zero, amp)
          emit(one, bits[gate.qubit - 1] === '0' ? amp : neg(amp))
        }
      }
      if (gate.label === 'Z') {
        return (bits, amp, emit) => emit(bits, bits[gate.qubit - 1] === '1' ? neg(amp) : amp)
      }
      // A quarter turn on the black half, where Z is a half turn.
      if (gate.label === 'S') {
        return (bits, amp, emit) => emit(bits, bits[gate.qubit - 1] === '1' ? mul(amp, I) : amp)
      }
      if (gate.angle !== undefined) return turnOf(gate.label, gate.qubit, gate.angle)
      // A flip and a quarter turn each way: white goes to black turned one way,
      // black to white turned the other.
      if (gate.label === 'Y') {
        return (bits, amp, emit) =>
          emit(flip(bits, gate.qubit), mul(amp, bits[gate.qubit - 1] === '0' ? I : neg(I)))
      }
      throw new SimulationError(
        `${gate.label} turns by an eighth, which these amplitudes cannot hold`,
      )

    case 'controlled': {
      const on = (bits: string) => gate.controls.every((c) => bits[c - 1] === '1')
      if (gate.targetGlyph === 'z') {
        return (bits, amp, emit) =>
          emit(bits, on(bits) && bits[gate.target - 1] === '1' ? neg(amp) : amp)
      }
      return (bits, amp, emit) => emit(on(bits) ? flip(bits, gate.target) : bits, amp)
    }

    case 'swap': {
      const [a, b] = gate.qubits
      const controls = gate.controls ?? []
      const on = (bits: string) => controls.every((c) => bits[c - 1] === '1')
      return (bits, amp, emit) => {
        if (!on(bits)) return emit(bits, amp)
        const chars = [...bits]
        ;[chars[a - 1], chars[b - 1]] = [chars[b - 1], chars[a - 1]]
        emit(chars.join(''), amp)
      }
    }

    case 'box':
      throw new SimulationError(
        gate.label
          ? `“${gate.label}” is a drawing, so there is no operation to apply`
          : 'a blank box has no operation to apply',
      )
  }
}

function applyGate(amps: Amplitudes, gate: Gate): Amplitudes {
  const spread = spreadOf(gate)
  return spread ? mapStates(amps, spread) : amps
}

/** One term's share of what a gate produces: where it came from and what it gave. */
export interface Contribution {
  /** The input term this came out of, for showing which one is being worked. */
  from: string
  to: string
  amp: Cx
}

/**
 * The same arithmetic as `applyGate`, with nothing merged and nothing dropped.
 *
 * Applying a gate destroys exactly what an animation of it wants to show: two
 * terms meeting and adding, or meeting and cancelling. Summing these by `to`
 * gives `applyGate`'s answer back, which is the property worth testing.
 *
 * Terms are taken in bit-string order, so the sequence is the one a person
 * reading the state left to right would work through.
 */
export function traceGate(amps: Amplitudes, gate: Gate): Contribution[] {
  const spread = spreadOf(gate)
  const out: Contribution[] = []
  for (const [bits, amp] of sorted(amps)) {
    if (!spread) {
      out.push({ from: bits, to: bits, amp })
      continue
    }
    spread(bits, amp, (to, gave) => {
      if (!isZero(gave)) out.push({ from: bits, to, amp: gave })
    })
  }
  return out
}

/* -- Writing a state back out -------------------------------------------- */

export function gcd(a: number, b: number): number {
  a = Math.abs(a)
  b = Math.abs(b)
  while (b) [a, b] = [b, a % b]
  return a
}

/**
 * Divide out the common factor and settle the overall sign.
 *
 * Both are unobservable — the notation is unnormalised, so `6*0|4*1` and
 * `3*0|2*1` are the same state, as are `-00|01` and `00|-01`. Fixing them
 * makes the answer deterministic: smallest whole numbers, leading term
 * positive.
 *
 * `keepSign` does only the first of the two. Every comparison in the codebase
 * wants the default — two states differing by an overall sign really are the
 * same state, and both the checker and the library cross-check depend on that —
 * so this is a presentation choice, never a comparison one.
 */
/** Terms in bit-string order, so nothing downstream depends on insertion order. */
const sorted = (amps: Amplitudes): [string, Cx][] =>
  [...amps].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))

export function canonical(
  amps: Amplitudes,
  opts: { keepSign?: boolean } = {},
): [string, Cx][] {
  const terms = sorted(amps)
  if (!terms.length) return terms
  const divisor = commonFactor(terms.map(([, amp]) => amp))
  // The overall phase is not observable, so one is chosen and stuck to: the
  // first term is turned onto the positive real axis where a quarter turn will
  // get it there. For real amplitudes that is the old rule exactly.
  const turn = opts.keepSign ? ONE : unitToClear(terms[0][1])
  return terms.map(([bits, amp]) => [bits, mul(over(amp, divisor), turn)])
}

/**
 * Qubits for one bit string.
 *
 * No shape is pinned. Layout numbers them from their position, and that is what
 * lets a circuit's `shapes` override reach a calculated state as well as a
 * written one — pinning here would silently win over it.
 */
const qubitsOf = (bits: string): QubitNode[] =>
  [...bits].map((bit) => ({ kind: 'qubit', value: bit === '0' ? 0 : 1 }))

/** One block of wires as a drawable factor: a bare run, or a cloud of terms. */
function blockFactor(amps: Amplitudes, keepSign = false, dial: 'auto' | 'always' | 'never' = 'auto'): Factor[] {
  const terms = canonical(amps, { keepSign })
  /*
   * One term on its own is a run of bare qubits, whatever its weight.
   *
   * A lone term in a product has no weight of its own to show: the size belongs
   * to the whole product, which this notation leaves unnormalised anyway, and
   * splitting a state hands each factor the pivot's amplitude rather than one.
   * For whole numbers that came out as 1 regardless, since `canonical` divides
   * the common factor away — but a cosine has no common factor to divide, so
   * an untouched qubit beside a rotated one was being drawn in a cloud of its
   * own with a coefficient on it, which is neither true nor useful.
   *
   * A sign or a quarter turn is not scale and is kept: those belong to the
   * state and would be lost.
   */
  if (terms.length === 1 && terms[0][1].im === 0 && terms[0][1].re > 0) {
    return qubitsOf(terms[0][0])
  }
  // A part each way where an amplitude has both: `2+3i` on one basis state is
  // two terms that add, which is what the notation already does for every
  // other sum, and keeps every term to one sign and one size.
  /*
   * A coefficient is ordinarily a whole number, and for everything the notation
   * was built on it is one. A rotation by an odd angle leaves cosines, and this
   * used to refuse to draw the state at all — which is correct about the
   * notation and unhelpful about the circuit, since the figure the refusal
   * replaces is the one thing that would show what the rotation did.
   *
   * So it is drawn approximately: every coefficient to two decimal places. Two
   * places is what a figure can show and what a reader can hold, and a decimal
   * where the notation only ever writes whole numbers says plainly enough that
   * it has been rounded. The arithmetic underneath is untouched, so the odds,
   * the chart and the check all still work from the exact amplitudes.
   */
  const approximate = terms.some(([, amp]) => !isWhole(amp))
  const round2 = (x: number) => Math.round(x * 100) / 100
  const size = (x: number) => (approximate ? round2(x) : x)

  /*
   * One basis state, one term.
   *
   * A term carries either a real coefficient or an imaginary one and never
   * both, so an amplitude with two parts has to be written as two terms that
   * add. That was harmless while nothing produced one. A rotation does: `H`,
   * `RZ(45)` and a `CNOT` put `0.71` and `0.71i` on the same basis state, and
   * the drawing showed `11` twice and left the reader to add them as vectors.
   *
   * With a dial there is somewhere to put the angle, so the pair collapses back
   * into the one amplitude it always was: a magnitude, and a direction.
   */
  // Both parts at once is the case with no spelling: one part alone is a sign
  // or an `i`, and the notation writes those perfectly well.
  const phased = terms.some(([, amp]) => amp.re !== 0 && amp.im !== 0)
  const asAngles = dial === 'always' || (dial === 'auto' && phased)

  if (asAngles) {
    const turned: Term[] = []
    for (const [bits, amp] of terms) {
      const mag = Math.hypot(amp.re, amp.im)
      const weight = isWhole(amp) && Number.isInteger(mag) ? mag : round2(mag)
      if (weight === 0 && !isZero(amp)) continue
      turned.push({
        sign: 1,
        coeff: weight === 1 ? undefined : weight,
        // Degrees, and to the nearest one: a figure cannot show more and a
        // reader cannot hold more.
        turn: Math.round((Math.atan2(amp.im, amp.re) * 180) / Math.PI + 360) % 360,
        factors: qubitsOf(bits),
      })
    }
    if (!turned.length) {
      throw new SimulationError('every amplitude here rounds away to nothing, so there is no state to draw')
    }
    return [{ kind: 'cloud', terms: turned }]
  }

  const written = (bits: string, weight: number, imaginary: boolean): Term => ({
    sign: weight < 0 ? -1 : 1,
    coeff: Math.abs(weight) === 1 ? undefined : Math.abs(weight),
    imaginary: imaginary || undefined,
    factors: qubitsOf(bits),
  })
  const cloud: CloudNode = {
    kind: 'cloud',
    terms: terms.flatMap(([bits, amp]): Term[] => {
      const re = size(amp.re)
      const im = size(amp.im)
      return [
        // A part that rounds away is left out rather than drawn as `0`: it is
        // worth less than half of one part in a hundred, and a term written
        // with no weight at all would read as a term that is not there.
        ...(re !== 0 || isZero(amp) ? [written(bits, re, false)] : []),
        ...(im !== 0 ? [written(bits, im, true)] : []),
      ]
    }),
  }
  // Nothing survived the rounding, which can only happen if everything in the
  // state was vanishingly small. Better to say so than to draw an empty cloud.
  if (!cloud.terms.length) {
    throw new SimulationError('every amplitude here rounds away to nothing, so there is no state to draw')
  }
  return [cloud]
}

/** The sub-state on `width` leading wires, and on the rest, if it splits. */
function split(amps: Amplitudes, width: number): [Amplitudes, Amplitudes] | null {
  const head = new Set<string>()
  const tail = new Set<string>()
  for (const bits of amps.keys()) {
    head.add(bits.slice(0, width))
    tail.add(bits.slice(width))
  }
  const at = (h: string, t: string) => amps.get(h + t) ?? ZERO

  // The state splits exactly when this matrix has rank one, which is every
  // 2×2 minor vanishing — checked against one non-zero entry rather than all
  // pairs, since a rank-one matrix is determined by any row and column
  // through a non-zero pivot.
  const [pivot] = canonical(amps)
  if (!pivot) return null
  const [ph, pt] = [pivot[0].slice(0, width), pivot[0].slice(width)]
  const scaleBy = at(ph, pt)
  for (const h of head) {
    for (const t of tail) {
      if (!eq(mul(at(h, t), scaleBy), mul(at(h, pt), at(ph, t)))) return null
    }
  }

  const first: Amplitudes = new Map()
  for (const h of head) if (!isZero(at(h, pt))) first.set(h, at(h, pt))
  const rest: Amplitudes = new Map()
  for (const t of tail) if (!isZero(at(ph, t))) rest.set(t, at(ph, t))
  return [first, rest]
}

/**
 * Break a state into the widest product the notation can draw.
 *
 * Only *contiguous* runs of wires are tried, which is not a simplification but
 * the constraint the drawing imposes: factors sit side by side over the wires
 * they describe, so a state separable into wires 1,3 against 2 has no product
 * form to draw. Splitting off the shortest leading run that separates gives the
 * finest such product.
 */
function factorise(amps: Amplitudes, width: number): Amplitudes[] {
  for (let head = 1; head < width; head++) {
    const parts = split(amps, head)
    if (parts) return [parts[0], ...factorise(parts[1], width - head)]
  }
  return [amps]
}

export interface PresentOptions {
  /** Draw the answer as a product where it separates, rather than one cloud. */
  factor?: boolean
  /**
   * Write each amplitude as one term with an angle, rather than as a real term
   * and an imaginary one that add.
   *
   * `auto` does it only where some amplitude has both a real and an imaginary
   * part, that being the case the notation has no spelling for. One part alone
   * is a sign or an `i`, and those are left as they are.
   */
  dial?: 'auto' | 'always' | 'never'
  /**
   * Write a branch's likelihood exactly where a percentage would have to round
   * — `9/13` rather than `69%`. An even split still reads `50%`.
   */
  exactOdds?: boolean
  /**
   * Draw an overall minus sign rather than normalising it away.
   *
   * It is unobservable, so the default is right for a state standing alone. It
   * is worth seeing when the figure exists to show a phase flip happening —
   * `1 / H / X / H` lands on `-1`, and the minus *is* the answer.
   */
  keepSign?: boolean
}

/* -- Measurement --------------------------------------------------------- */

/** An exact probability. Amplitudes are integers, so odds are always rational. */
interface Frac {
  n: number
  d: number
}

const CERTAIN: Frac = { n: 1, d: 1 }

function frac(n: number, d: number): Frac {
  // Only reduced where there is something to reduce: a ratio of cosines has no
  // common factor, and `gcd` on floats would return noise.
  if (!Number.isInteger(n) || !Number.isInteger(d)) return { n, d }
  const g = gcd(n, d) || 1
  return { n: n / g, d: d / g }
}

const times = (a: Frac, b: Frac): Frac => frac(a.n * b.n, a.d * b.d)

/** Sum of squared amplitudes — the weight the Born rule divides through. */
function weight(amps: Amplitudes): number {
  let total = 0
  // `|a + bi|²`, which stays a whole number — so the odds stay exact ratios
  // however much phase the state has picked up.
  for (const amp of amps.values()) total += abs2(amp)
  return total
}

/**
 * One possible history: a state, and how likely the measurements were to have
 * left it that way.
 */
export interface Branch {
  amps: Amplitudes
  odds: Frac
}

/** How a branch's likelihood is written above it. */
export function oddsLabel(odds: Frac, exact = false): string {
  const percent = (odds.n * 100) / odds.d
  if (Number.isInteger(percent)) return `${percent}%`
  return exact ? `${odds.n}/${odds.d}` : `${Math.round(percent)}%`
}

/**
 * Split a branch on measuring one wire.
 *
 * The Born rule in its plainest form: gather the terms in which the wire is
 * white and those in which it is black, and weigh each by the squared
 * amplitudes it holds. Each outcome keeps its own terms, which is what leaves
 * the measured qubit fixed and the rest still in superposition.
 */
function measureWire(branch: Branch, qubit: number): Branch[] {
  const total = weight(branch.amps)
  if (!total) return []

  const out: Branch[] = []
  for (const value of ['0', '1']) {
    const kept: Amplitudes = new Map()
    for (const [bits, amp] of branch.amps) if (bits[qubit - 1] === value) kept.set(bits, amp)
    if (!kept.size) continue
    out.push({ amps: kept, odds: times(branch.odds, frac(weight(kept), total)) })
  }
  return out
}

/** Turn computed amplitudes into a state row ready to be drawn. */
export function stateFrom(amps: Amplitudes, qubits: number, opts: PresentOptions = {}): StateRow {
  if (!amps.size) {
    throw new SimulationError('the terms all cancel, leaving no state to draw')
  }
  // A product has no overall sign of its own — it belongs to the whole state,
  // and each block is canonicalised separately, so left alone it would be
  // normalised away inside one of them and vanish. It is carried on the first
  // block by convention: any single one would do, and doubling it would cancel.
  const negative = !!opts.keepSign && canonical(amps, { keepSign: true })[0][1].re < 0

  let blocks = opts.factor ? factorise(amps, qubits) : [amps]

  // Factoring earns its keep by removing brackets. Where every block is a bare
  // run, carrying a sign would instead *add* one — `(-1)1` where the course
  // writes `(-11)` — so the product is given up and the state drawn whole.
  if (negative && blocks.every((block) => block.size === 1)) blocks = [amps]

  if (negative) {
    blocks = blocks.map((block, i) =>
      i === 0 ? new Map(canonical(block).map(([bits, amp]) => [bits, neg(amp)])) : block,
    )
  }

  const factors = blocks.flatMap((block, i) =>
    blockFactor(block, negative && i === 0, opts.dial ?? 'auto'),
  )
  return { sides: [{ factors }], relations: [] }
}

/**
 * The state after `layers` layers of the circuit.
 *
 * Views are skipped, so a snapshot never disturbs what it is looking at.
 */
/** The single state a circuit with no measurement produces. */
export function simulate(doc: CircuitDoc, layers: number): Amplitudes {
  const { branches } = simulateFrom(doc, layers)
  if (branches.length !== 1) {
    throw new SimulationError('this circuit measures, so it has more than one outcome')
  }
  return branches[0].amps
}

/**
 * Every history the circuit can produce, and how likely each is.
 *
 * `measured` says whether any measurement happened at all, which is what
 * decides if the results want labelling: one outcome at 100% is worth saying
 * after a measurement and worth nothing before one.
 */
export function simulateBranches(
  doc: CircuitDoc,
  layers: number,
): { branches: Branch[]; measured: boolean } {
  return simulateFrom(doc, layers)
}

/**
 * Where the run is known from, and how far along the circuit that is.
 *
 * Normally the input: written, or all wires white, which is the only reading an
 * unwritten input has. But a circuit whose input is asked for has to be known
 * from somewhere else — the state written at the end, or part-way down — and
 * every gate this notation can follow is its own inverse, so the run can be
 * read backwards from any of them just as well as forwards.
 */
function anchorOf(doc: CircuitDoc): { at: number; amps: Amplitudes } {
  if (!doc.calculateInput) {
    return {
      at: 0,
      amps: doc.input
        ? amplitudesOf(doc.input, doc.qubits)
        : new Map([['0'.repeat(doc.qubits), ONE]]),
    }
  }

  // Asked for the input: the earliest state written anywhere else will do.
  for (let at = 0; at < doc.layers.length; at++) {
    for (const gate of doc.layers[at].gates) {
      if (gate.kind !== 'view' || gate.calculate || !gate.rows?.length) continue
      if (gate.qubits.length !== doc.qubits) continue
      return { at, amps: amplitudesOf(gate.rows[0], doc.qubits) }
    }
  }
  if (doc.output?.length && !doc.calculateOutput) {
    return { at: doc.layers.length, amps: amplitudesOf(doc.output[0], doc.qubits) }
  }
  throw new SimulationError(
    'the input can only be worked out from a state written somewhere else in the circuit',
  )
}

/** Every gate this notation can follow is its own inverse, so undoing is doing. */
function undoLayers(amps: Amplitudes, layers: Layer[]): Amplitudes {
  let running = amps
  for (const layer of [...layers].reverse()) {
    for (const gate of layer.gates) {
      if (gate.kind === 'measure') {
        throw new SimulationError(
          'a measurement cannot be undone, so nothing before it can be worked out',
        )
      }
      running = applyGate(running, gate)
    }
    if (!running.size) {
      throw new SimulationError('the terms all cancel, leaving no state to draw')
    }
  }
  return running
}

function simulateFrom(doc: CircuitDoc, layers: number) {
  const anchor = anchorOf(doc)

  // Behind the anchor, the circuit is run in reverse; from there, forwards.
  const start = anchor.at > 0 ? undoLayers(anchor.amps, doc.layers.slice(0, anchor.at)) : anchor.amps

  let branches: Branch[] = [{ amps: start, odds: CERTAIN }]
  let measured = false

  for (const layer of doc.layers.slice(0, layers)) {
    // Sorted so the answer cannot depend on the order gates were written in
    // within a layer; they act on disjoint wires, so they commute.
    const gates = [...layer.gates].sort(
      (a, b) => Math.min(...gateQubits(a)) - Math.min(...gateQubits(b)),
    )
    for (const gate of gates) {
      if (gate.kind === 'measure') {
        if (gate.basis !== 'Z') {
          throw new SimulationError(
            `a ${gate.basis} measurement has no white-or-black outcome to draw`,
          )
        }
        measured = true
        branches = branches.flatMap((b) => measureWire(b, gate.qubit))
        continue
      }
      branches = branches.map((b) => ({ ...b, amps: applyGate(b.amps, gate) }))
    }
    // A term that cancelled to nothing takes its branch with it.
    branches = branches.filter((b) => b.amps.size)
  }

  return { branches, measured }
}

/**
 * Fill in every `calculate` in a circuit.
 *
 * A snapshot shows the state as it enters its own layer, which is what a view
 * means: the moment between the gates above it and the gates below.
 */
/** Hang annotations on a state that had none until it was worked out. */
function captioned(row: StateRow, caption?: string, note?: string): StateRow {
  if (!caption && !note) return row
  return { ...row, sides: row.sides.map((s, i) => (i ? s : { ...s, caption, note })) }
}

/**
 * The rows a `calculate` draws: one per outcome.
 *
 * Only labelled once a measurement has happened. A written caption keeps its
 * place and the odds join it, since both want the same gutter.
 */
function calculated(
  doc: CircuitDoc,
  layers: number,
  caption: string | undefined,
  note: string | undefined,
  opts: PresentOptions,
): StateRow[] {
  const { branches, measured } = simulateFrom(doc, layers)
  if (!branches.length) {
    throw new SimulationError('the terms all cancel, leaving no state to draw')
  }
  return branches.map((branch) => {
    const odds = measured ? oddsLabel(branch.odds, opts.exactOdds) : undefined
    const label = [caption, odds].filter(Boolean).join(' — ') || undefined
    return captioned(stateFrom(branch.amps, doc.qubits, opts), label, note)
  })
}

/* -- Tabulating ---------------------------------------------------------- */

/** One line of a table: a state, and the numbers that go with it. */
export interface TableEntry {
  /** The state itself, ready to be drawn in the possibility column. */
  state: StateRow
  /** How likely this line is, once there is a measurement to make it a chance. */
  odds?: Frac
  /** The amplitude this line carries, in front of the state as drawn. */
  amplitude: Cx
}

/**
 * The amplitude in front of a state as it is drawn.
 *
 * A branch left in superposition by a partial measurement has an amplitude per
 * term, so there is no one term to read it off. It still has a single amplitude
 * as *written*, though: the drawing reduces each block by its common factor, so
 * `01|-11` is drawn `(0|-1)1` and what stands in front of it is that factor.
 * Reading the whole state as a sum over its outcomes,
 *
 *     00|01|00|-11  =  2*(00) | 1*((0|-1)1)
 *
 * those factors are the amplitudes, and every line has one.
 *
 * Note it is the notation's amplitude, not a normalised one: the drawn states
 * have different lengths, so squaring this does not by itself give the
 * probability beside it.
 */
function coefficient(amps: Amplitudes): Cx {
  const size = commonFactor([...amps.values()])
  // Whatever turn the drawn state was canonicalised by, undone: the factor in
  // front has to be the one that puts the state back.
  return cxTimes(unitToClear(sorted(amps)[0][1]), size)
}

/**
 * What a table has one line per.
 *
 * The unit follows the circuit rather than being chosen: a measurement makes
 * the outcomes the interesting thing, and without one there is a single outcome
 * and the terms of it are what there is to say. That is also what makes an
 * amplitude column meaningful — the terms of a state each have one, whereas a
 * measured branch only has one if it came out of the measurement alone.
 */
export function tabulate(
  doc: CircuitDoc,
  layers: number,
  opts: PresentOptions = {},
): { entries: TableEntry[]; measured: boolean } {
  const { branches, measured } = simulateFrom(doc, layers)
  if (!branches.length) {
    throw new SimulationError('the terms all cancel, leaving no state to draw')
  }

  // Amplitudes are scaled by the arithmetic — H·H is 2I, not I — so the whole
  // set is reduced together. Per-line reduction would flatten exactly the
  // difference the column exists to show, turning 2 and 3 into 1 and 1.
  const all = branches.flatMap((b) => [...b.amps.values()])
  const divisor = commonFactor(all)
  const turn = !opts.keepSign && all.length ? unitToClear(sorted(branches[0].amps)[0][1]) : ONE
  const scale = (amp: Cx) => mul(over(amp, divisor), turn)

  if (measured) {
    return {
      measured,
      entries: branches.map((branch) => ({
        state: stateFrom(branch.amps, doc.qubits, opts),
        odds: branch.odds,
        amplitude: scale(coefficient(branch.amps)),
      })),
    }
  }

  // One branch, so the lines are its terms. Each is a single basis state, which
  // is what gives it both an amplitude and a probability of its own.
  const amps = branches[0].amps
  const total = weight(amps)
  return {
    measured,
    entries: sorted(amps).map(([bits, amp]) => ({
      state: stateFrom(new Map([[bits, ONE]]), doc.qubits, opts),
      odds: frac(abs2(amp), total),
      amplitude: scale(amp),
    })),
  }
}

/**
 * A state written in Dirac notation.
 *
 * The escape hatch. Everything else here draws the notation the course uses,
 * which is the point of the app — but a drawn state is a picture, and there are
 * times a reader wants the thing itself: to check it against a textbook, to
 * paste it into a problem set, or simply because they already read `|01⟩` more
 * fluently than they read a square.
 *
 * Unlike everywhere else, this *is* normalised. The arithmetic runs on integers
 * because `H·H = 2I` and dividing by roots would lose exactness, but a state
 * written down is expected to have length one, so the common factor is taken
 * out and the root written as a denominator — exactly, `/2` rather than `/√4`,
 * whenever the sum of squares happens to be a square.
 */
export function diracOf(amps: Amplitudes, opts: PresentOptions = {}): string {
  const entries = sorted(amps)
  if (!entries.length) {
    throw new SimulationError('the terms all cancel, leaving no state to write')
  }

  const size = commonFactor(entries.map(([, amp]) => amp))
  // The overall phase is not observable, so it is turned away the same way a
  // drawn state's is — unless the figure asked to keep it.
  const turn = opts.keepSign ? ONE : unitToClear(entries[0][1])
  const terms = entries.map(([bits, amp]) => [bits, mul(over(amp, size), turn)] as const)

  const square = terms.reduce((sum, [, amp]) => sum + abs2(amp), 0)
  const root = Math.sqrt(square)

  // Written the way it is said: a bare ket where the amplitude is one, `i` and
  // not `1i`, and a sign joining the terms rather than sitting inside them.
  const body = terms
    .map(([bits, amp], i) => {
      const down = isReal(amp) ? amp.re < 0 : amp.im < 0
      const size = show(down ? neg(amp) : amp)
      // Bracketed where it has two parts, or `2+3i|00⟩` reads as a sum of two
      // different things rather than one amplitude.
      const front = size === '1' ? '' : /[+-]/.test(size.slice(1)) ? `(${size})` : size
      const ket = `${front}|${bits}⟩`
      if (i === 0) return down ? `−${ket}` : ket
      return `${down ? ' − ' : ' + '}${ket}`
    })
    .join('')

  if (root === 1) return body
  const wrapped = terms.length > 1 ? `(${body})` : body
  return Number.isInteger(root) ? `${wrapped}/${root}` : `${wrapped}/√${square}`
}

/**
 * The circuit's state after `layers`, written out.
 *
 * A measurement leaves no single state, so each outcome is written with the
 * chance of getting it — which is the honest reading, and the same one the
 * table gives.
 */
export function diracLines(
  doc: CircuitDoc,
  layers: number,
  opts: PresentOptions = {},
): string[] {
  const { branches, measured } = simulateFrom(doc, layers)
  return branches.map((branch) =>
    measured
      ? `${oddsLabel(branch.odds, opts.exactOdds)}  ${diracOf(branch.amps, opts)}`
      : diracOf(branch.amps, opts),
  )
}

/** Every basis state of `qubits` wires, in counting order. */
const basisStates = (qubits: number): string[] =>
  Array.from({ length: 2 ** qubits }, (_, i) => i.toString(2).padStart(qubits, '0'))

/**
 * Past this many bars a chart is a smear rather than a reading, so the empty
 * ones are dropped. Five wires still fits; six would not.
 */
const MAX_BARS = 32

/**
 * The bars of a statevector plot.
 *
 * Unmeasured, the bars are the basis states — *all* of them, because a state
 * missing from a superposition is a fact about it, and a plot that silently
 * omitted the zeros would read as a different state. Past `MAX_BARS` that stops
 * being legible and only the occupied ones are drawn.
 *
 * After a measurement there is no one statevector left to plot, so the bars
 * become the outcomes and their chances — the same thing `tabulate` lists.
 */
export function chartBars(
  doc: CircuitDoc,
  layers: number,
  opts: PresentOptions = {},
): { bars: ChartBar[]; measured: boolean; complete: boolean } {
  const { branches, measured } = simulateFrom(doc, layers)
  if (!branches.length) {
    throw new SimulationError('the terms all cancel, leaving nothing to chart')
  }

  if (measured) {
    return {
      measured,
      complete: true,
      bars: branches.map((branch) => ({
        state: stateFrom(branch.amps, doc.qubits, opts),
        probability: branch.odds.n / branch.odds.d,
        label: oddsLabel(branch.odds, opts.exactOdds),
      })),
    }
  }

  const amps = branches[0].amps
  const total = weight(amps)
  const length = Math.sqrt(total)
  // The overall sign is not observable, so it is normalised away the same way
  // a drawn state's is — otherwise the identical state plots upside down
  // depending on which term happened to come out first.
  const turn = opts.keepSign ? ONE : unitToClear(sorted(amps)[0][1])

  const complete = 2 ** doc.qubits <= MAX_BARS
  const bits = complete ? basisStates(doc.qubits) : sorted(amps).map(([b]) => b)

  return {
    measured,
    complete,
    bars: bits.map((b) => {
      const amp = mul(amps.get(b) ?? ZERO, turn)
      return {
        state: stateFrom(new Map([[b, ONE]]), doc.qubits, opts),
        // A bar has one height, so only an amplitude that lies on the axis has
        // one to give. A phase off it is left out rather than flattened, and
        // the plot says so.
        amplitude: isReal(amp) ? amp.re / length : undefined,
        probability: abs2(amp) / total,
        label: oddsLabel(frac(abs2(amp), total), opts.exactOdds),
      }
    }),
  }
}

/** The table's lines with their numbers written out, ready to be drawn. */
function tableLines(doc: CircuitDoc, opts: PresentOptions): TableLine[] {
  const { entries } = tabulate(doc, doc.layers.length, opts)
  return entries.map((entry) => ({
    state: entry.state,
    // Unlike a stack of calculated states, this is written whether or not a
    // measurement happened: before one, it is what the terms of a superposition
    // mean, which is the other half of what a table is for.
    probability: entry.odds ? oddsLabel(entry.odds, opts.exactOdds) : undefined,
    amplitude: show(entry.amplitude),
  }))
}

export function resolveCalculations(doc: CircuitDoc, opts: PresentOptions = {}): CircuitDoc {
  const wanted = doc.layers.some((l) =>
    l.gates.some((g) => g.kind === 'view' && g.calculate),
  )
  if (!wanted && !doc.calculateOutput && !doc.calculateInput && !doc.table && !doc.chart) {
    return doc
  }

  const layers = doc.layers.map((layer, at) => ({
    ...layer,
    gates: layer.gates.map((gate) =>
      gate.kind === 'view' && gate.calculate
        ? { ...gate, rows: calculated(doc, at, gate.caption, gate.note, opts) }
        : gate,
    ),
  }))

  const output = doc.calculateOutput
    ? calculated(doc, doc.layers.length, doc.calculateCaption, doc.calculateNote, opts)
    : doc.output

  // The input is a single state, whatever the rest of the circuit does: a
  // measurement further down cannot reach back past itself.
  const input = doc.calculateInput
    ? calculated(doc, 0, doc.calculateInputCaption, doc.calculateInputNote, opts)[0]
    : doc.input

  // Refuses the same way `calculate` does when the arithmetic cannot be
  // followed — a table of nothing would be worse than being told why.
  const table = doc.table ? { ...doc.table, lines: tableLines(doc, opts) } : undefined
  const chart = doc.chart
    ? { ...doc.chart, ...chartBars(doc, doc.layers.length, opts) }
    : undefined
  // A bar has one height, so an amplitude off the real axis has none to give.
  // Said rather than drawn as nothing — an empty bar reads as a term that
  // cancelled, which is the opposite of a term with a phase on it.
  if (chart?.mode === 'amplitude' && !chart.measured &&
      chart.bars?.some((b) => b.amplitude === undefined)) {
    throw new SimulationError(
      'these amplitudes have a phase, which a bar cannot show — chart the probabilities instead',
    )
  }

  return { ...doc, layers, input, output, table, chart }
}

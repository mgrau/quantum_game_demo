/**
 * A second, deliberately different way to work out what a circuit does.
 *
 * This exists only to disagree with `simulate.ts`. That one maps bit strings to
 * bit strings and keeps everything in integers; this one builds a dense
 * 2ⁿ × 2ⁿ matrix per gate out of Kronecker products of one-qubit operators and
 * multiplies floating-point vectors through them. Controlled gates are assembled
 * from projectors — `CNOT = P₀⊗I + P₁⊗X` — rather than by flipping a bit, so a
 * mistake in one is unlikely to be mirrored in the other.
 *
 * It is not used by the app. Being quadratically slower and inexact is the
 * price of the independence, and only the tests pay it.
 */

import type { CircuitDoc, Gate } from './ast'
import type { Amplitudes } from './simulate'
import { ZERO, abs2, add, cx, mul, type Cx } from './complex'

/** Row-major dense matrix. */
/**
 * Complex, because the gates it now has to cover are.
 *
 * `S`, `Y` and every rotation move amplitudes off the real axis, and those are
 * precisely the ones nobody can check by hand — so a second opinion on them is
 * worth more than on anything else here.
 */
type Matrix = Cx[][]

const r = (re: number, im = 0): Cx => cx(re, im)

const I2: Matrix = [[r(1), r(0)], [r(0), r(1)]]
const X2: Matrix = [[r(0), r(1)], [r(1), r(0)]]
const Y2: Matrix = [[r(0), r(0, -1)], [r(0, 1), r(0)]]
const Z2: Matrix = [[r(1), r(0)], [r(0), r(-1)]]
const S2: Matrix = [[r(1), r(0)], [r(0), r(0, 1)]]
/** Unnormalised, matching the course's PETE box. */
const H2: Matrix = [[r(1), r(1)], [r(1), r(-1)]]
/** |0⟩⟨0| and |1⟩⟨1|, the projectors a control selects with. */
const P0: Matrix = [[r(1), r(0)], [r(0), r(0)]]
const P1: Matrix = [[r(0), r(0)], [r(0), r(1)]]
/** |0⟩⟨1| and |1⟩⟨0|, the off-diagonal blocks a swap is built from. */
const S01: Matrix = [[r(0), r(1)], [r(0), r(0)]]
const S10: Matrix = [[r(0), r(0)], [r(1), r(0)]]

/**
 * A rotation, from its definition rather than from the simulator's.
 *
 * Written straight out of the textbook matrices, with no `1/√2` dropped and no
 * tidying of near-whole numbers — the simulator does both, and a check that
 * copied them would be checking nothing. The two are compared as states, which
 * is what makes the difference in convention harmless.
 */
function turn2(label: string, angle: number): Matrix {
  const t = (angle * Math.PI) / 180
  const c = Math.cos(t / 2)
  const s = Math.sin(t / 2)
  if (label === 'RZ' || label === 'P') return [[r(1), r(0)], [r(0), r(Math.cos(t), Math.sin(t))]]
  if (label === 'RY') return [[r(c), r(-s)], [r(s), r(c)]]
  return [[r(c), r(0, -s)], [r(0, -s), r(c)]]
}

function kron(a: Matrix, b: Matrix): Matrix {
  const out: Matrix = []
  for (let i = 0; i < a.length; i++) {
    for (let k = 0; k < b.length; k++) {
      const row: Cx[] = []
      for (let j = 0; j < a[i].length; j++) {
        for (let l = 0; l < b[k].length; l++) row.push(mul(a[i][j], b[k][l]))
      }
      out.push(row)
    }
  }
  return out
}

function sum(a: Matrix, b: Matrix): Matrix {
  return a.map((row, i) => row.map((v, j) => add(v, b[i][j])))
}

/** Spread one-qubit operators across `n` wires, the identity where unnamed. */
function embed(n: number, ops: Record<number, Matrix>): Matrix {
  let out: Matrix = [[r(1)]]
  for (let q = 1; q <= n; q++) out = kron(out, ops[q] ?? I2)
  return out
}

function matrixOf(gate: Gate, n: number): Matrix | null {
  switch (gate.kind) {
    case 'identity':
    case 'view':
      return null

    case 'single':
      if (gate.angle !== undefined) {
        return embed(n, { [gate.qubit]: turn2(gate.label, gate.angle) })
      }
      if (gate.label === 'H') return embed(n, { [gate.qubit]: H2 })
      if (gate.label === 'Z') return embed(n, { [gate.qubit]: Z2 })
      if (gate.label === 'Y') return embed(n, { [gate.qubit]: Y2 })
      if (gate.label === 'S') return embed(n, { [gate.qubit]: S2 })
      throw new Error(`reference: ${gate.label} has no matrix here`)

    case 'controlled': {
      const act = gate.targetGlyph === 'z' ? Z2 : X2
      // Every assignment of the controls, the acting one carrying the operator.
      // The projectors sum to the identity, so the pieces cover every case
      // exactly once.
      let out: Matrix | null = null
      const total = 1 << gate.controls.length
      for (let mask = 0; mask < total; mask++) {
        const ops: Record<number, Matrix> = {}
        gate.controls.forEach((c, i) => {
          ops[c] = mask & (1 << i) ? P1 : P0
        })
        if (mask === total - 1) ops[gate.target] = act
        out = out ? sum(out, embed(n, ops)) : embed(n, ops)
      }
      return out ?? embed(n, { [gate.target]: act })
    }

    case 'swap': {
      const [a, b] = gate.qubits
      const controls = gate.controls ?? []
      // Fold P1 on every control straight into the swap's blocks, so the swap
      // only acts where the controls are all ones. Empty for a plain SWAP, in
      // which case this is exactly the swap.
      const gated: Record<number, Matrix> = {}
      for (const c of controls) gated[c] = P1
      let out = [
        embed(n, { ...gated, [a]: P0, [b]: P0 }),
        embed(n, { ...gated, [a]: P1, [b]: P1 }),
        embed(n, { ...gated, [a]: S01, [b]: S10 }),
        embed(n, { ...gated, [a]: S10, [b]: S01 }),
      ].reduce(sum)
      // Every control assignment that is not all-ones holds the wires still.
      // With the acting block above, the projectors sum to the identity, so
      // each case is covered exactly once — the same construction the
      // controlled gates use above.
      const total = 1 << controls.length
      for (let mask = 0; mask < total - 1; mask++) {
        const ops: Record<number, Matrix> = {}
        controls.forEach((c, i) => {
          ops[c] = mask & (1 << i) ? P1 : P0
        })
        out = sum(out, embed(n, ops))
      }
      return out
    }

    case 'measure':
    case 'box':
      throw new Error('reference: not a unitary')
  }
}

const bitsOf = (index: number, n: number) => index.toString(2).padStart(n, '0')

/** Run the circuit from `input`, returning amplitudes keyed the same way. */
export function referenceSimulate(doc: CircuitDoc, input: Amplitudes): Cx[] {
  const n = doc.qubits
  let vector = new Array<Cx>(1 << n).fill(ZERO)
  for (const [bits, amp] of input) vector[parseInt(bits, 2)] = amp

  for (const layer of doc.layers) {
    for (const gate of layer.gates) {
      const m = matrixOf(gate, n)
      if (!m) continue
      const next = new Array<Cx>(1 << n).fill(ZERO)
      for (let i = 0; i < next.length; i++) {
        let acc = ZERO
        for (let j = 0; j < vector.length; j++) acc = add(acc, mul(m[i][j], vector[j]))
        next[i] = acc
      }
      vector = next
    }
  }
  return vector
}

/** The same result as a map, for comparing against the integer simulator. */
export function referenceAmplitudes(doc: CircuitDoc, input: Amplitudes): Amplitudes {
  const vector = referenceSimulate(doc, input)
  const out: Amplitudes = new Map()
  vector.forEach((amp, i) => {
    if (abs2(amp) > 1e-18) out.set(bitsOf(i, doc.qubits), amp)
  })
  return out
}

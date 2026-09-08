/**
 * Checking a diagram against itself.
 *
 * A figure often makes a claim: that two expressions are the same state, or
 * that a circuit turns this input into that output. Both are claims the
 * simulator can settle, so a drawing can be marked as checking out or not.
 *
 * Three rules govern what happens here, and they are the whole design:
 *
 * 1. **A claim that cannot be evaluated is not a failure.** `?` stands for an
 *    unknown, a text label is prose, and a `box` is a picture — a figure full of
 *    them is a question, not a wrong answer. Those are skipped in silence.
 * 2. **Nothing throws.** A wrong figure still draws; being wrong is sometimes
 *    the point of it.
 * 3. **Anything derived is not a claim.** A `calculate` came from the simulator,
 *    so checking it would only ever confirm that the simulator agrees with
 *    itself.
 *
 * Comparison goes through `canonical`, so overall scale and overall sign are
 * ignored: `00|11` and `2*00|2*11` are the same state, and so are `-00|01` and
 * `00|-01`. That is the right notion of equal for the notation — both are
 * unobservable — and it is the same one the library cross-check uses.
 */

import type { StateDoc } from './state/ast'
import type { CircuitDoc, ViewGate } from './circuit/ast'
import {
  canonical, sideAmplitudes, simulateBranches, SimulationError,
  type Amplitudes, type Branch,
} from './circuit/simulate'

export interface Check {
  /** False when at least one claim was evaluated and did not hold. */
  ok: boolean
  /** How many claims were actually settled — zero means nothing was checkable. */
  checked: number
  /** One line per claim that failed, phrased for the person who wrote it. */
  problems: string[]
}

/** A state's amplitudes as a comparable string, scale and sign normalised. */
const shape = (amps: Amplitudes): string => JSON.stringify(canonical(amps))

/** Widen a state to `width` wires by leaving the extra ones white. */
function pad(amps: Amplitudes, width: number): Amplitudes {
  const own = amps.size ? [...amps.keys()][0].length : 0
  if (own >= width) return amps
  const tail = '0'.repeat(width - own)
  return new Map([...amps].map(([bits, amp]) => [bits + tail, amp]))
}

const widthOf = (amps: Amplitudes) => (amps.size ? [...amps.keys()][0].length : 0)

/* -- Equations ----------------------------------------------------------- */

/**
 * Check every `=` and `≠` in a state document.
 *
 * `→` is not a claim of equality — it reads as "becomes" — so it is left alone.
 */
export function checkState(doc: StateDoc): Check {
  const problems: string[] = []
  let checked = 0
  const many = doc.rows.length > 1

  doc.rows.forEach((row, at) => {
    if (!row.relations.length) return

    let sides: Amplitudes[]
    try {
      sides = row.sides.map(sideAmplitudes)
    } catch (err) {
      // An unknown or a label somewhere in the row: nothing to settle.
      if (err instanceof SimulationError) return
      throw err
    }

    const shapes = sides.map(shape)
    const where = many ? `Row ${at + 1}: ` : ''

    row.relations.forEach((rel, i) => {
      if (rel !== '=' && rel !== '≠') return
      checked++

      // Sides are *not* padded to a common width here, unlike a state entering
      // a circuit. Two sides of an equation describing different registers is a
      // mistake worth naming, not something to quietly widen into agreement.
      if (widthOf(sides[i]) !== widthOf(sides[i + 1])) {
        if (rel === '=') {
          problems.push(`${where}the two sides of "=" describe different numbers of qubits`)
        }
        return
      }

      const same = shapes[i] === shapes[i + 1]
      if (rel === '=' && !same) {
        problems.push(`${where}the two sides of "=" are not the same state`)
      }
      if (rel === '≠' && same) {
        problems.push(`${where}the two sides of "≠" are the same state`)
      }
    })
  })

  return { ok: !problems.length, checked, problems }
}

/* -- Circuits ------------------------------------------------------------ */

/**
 * Compare what the circuit produces against what was written.
 *
 * Returns null when the claim cannot be settled — which is different from it
 * being wrong, and is why this is not a boolean.
 */
function disagrees(branches: Branch[], written: Amplitudes[], qubits: number): boolean | null {
  if (!branches.length || !written.length) return null

  // A measured circuit has several outcomes and a written state has no order to
  // match them against, so this is a comparison of sets. With different counts
  // there is nothing to line up and the figure is saying something this cannot
  // read.
  if (branches.length !== written.length) return null

  const got = branches.map((b) => shape(pad(b.amps, qubits))).sort()
  const want = written.map((a) => shape(pad(a, qubits))).sort()
  return !got.every((g, i) => g === want[i])
}

/** Amplitudes for each written row, or null if any of them is unreadable. */
function readRows(rows: { sides: { factors: unknown[] }[] }[]): Amplitudes[] | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return rows.map((row) => sideAmplitudes((row as any).sides[0]))
  } catch (err) {
    if (err instanceof SimulationError) return null
    throw err
  }
}

/**
 * Check a circuit's written output, and any written state shown part-way
 * through, against what it actually computes.
 *
 * A view is only checked when it covers the whole register: a partial view
 * describes a marginal state, which is a different claim and only meaningful
 * when the register separates there.
 */
export function checkCircuit(doc: CircuitDoc): Check {
  const problems: string[] = []
  let checked = 0

  const claim = (at: number, rows: Parameters<typeof readRows>[0], noun: string) => {
    const written = readRows(rows)
    if (!written) return

    let branches: Branch[]
    try {
      branches = simulateBranches(doc, at).branches
    } catch (err) {
      // An unknown input, a box, or a gate the arithmetic cannot follow.
      if (err instanceof SimulationError) return
      throw err
    }

    const wrong = disagrees(branches, written, doc.qubits)
    if (wrong === null) return
    checked++
    if (wrong) {
      problems.push(
        branches.length === 1
          ? `the ${noun} drawn is not what the circuit produces`
          : `the ${noun} outcomes drawn are not the ones the circuit produces`,
      )
    }
  }

  doc.layers.forEach((layer, at) => {
    for (const gate of layer.gates) {
      if (gate.kind !== 'view') continue
      const view = gate as ViewGate
      // Derived from the simulator, so there is nothing to confirm.
      if (view.calculate || !view.rows?.length) continue
      if (view.qubits.length !== doc.qubits) continue
      claim(at, view.rows, `state after layer ${at}`)
    }
  })

  if (doc.output?.length && !doc.calculateOutput) {
    claim(doc.layers.length, doc.output, 'output')
  }

  return { ok: !problems.length, checked, problems }
}

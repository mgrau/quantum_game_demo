/**
 * Deciding whether a circuit answers the question.
 *
 * Three rules, and they are the whole design:
 *
 * 1. **A rule broken is not the same as an answer wrong.** Using a forbidden
 *    gate and producing the wrong state are different failures and are reported
 *    separately, because they need different things from the player.
 * 2. **A circuit that cannot be run is not a wrong answer either.** A half-built
 *    circuit spends most of its life unparseable or unsimulatable — a box with
 *    no operation, terms that all cancel — and saying "wrong" at every keystroke
 *    would be both untrue and discouraging. Those are reported as "not yet".
 * 3. **Nothing throws.** The board keeps drawing whatever the player has, and a
 *    verdict is something drawn beside it, never something that stops it.
 */

import { diracOf, ParseError, parseCircuit, SimulationError } from 'misty-states/kernel'
import {
  finalState, inputOf, operationOf, probabilities, stateOf, statesEqual, statsOf,
  substituteOracle, type Stats,
} from './circuit'
import type { Level } from './level'

/** How the circuit fared against one possible contents of the sealed box. */
export interface TrialResult {
  name: string
  ok: boolean
  /** A compact input/output trace, used to make multi-case checks concrete. */
  input?: string
  expected?: string
  actual?: string
}

export interface Verdict {
  /** Every trial passed and no rule was broken. */
  solved: boolean
  /** One line, for the status strip. */
  message: string
  /** Rules broken: a forbidden gate, too many gates. Solvable but not accepted. */
  violations: string[]
  /** What the circuit currently is, when it could be read at all. */
  stats?: Stats
  /** What it produces, in Dirac notation, for the goal pane to show. */
  got?: string
  /** One line per possible box, where the level seals one. */
  trials?: TrialResult[]
  /** Under par on every metric the level scores. */
  optimal: boolean
}

const unreadable = (message: string): Verdict => ({
  solved: false,
  message,
  violations: [],
  optimal: false,
})

/** Rules the level sets, checked against what was built. */
function violationsOf(level: Level, stats: Stats): string[] {
  const out: string[] = []
  if (level.palette) {
    const allowed = new Set(level.palette.map((id) => id.toUpperCase()))
    // A level that seals a box always allows the box; listing it in the palette
    // as well would be saying the same thing twice and forgetting it once.
    if (level.goal.kind === 'oracle') allowed.add('BOX')
    for (const id of stats.used) {
      if (!allowed.has(id)) out.push(`${id} is not available on this level`)
    }
  }
  const { gates, layers, measurements, queries } = level.limits ?? {}
  if (queries !== undefined && stats.boxes > queries) {
    out.push(
      queries === 1
        ? `the box may only be used once — this uses it ${stats.boxes} times`
        : `at most ${queries} uses of the box — this has ${stats.boxes}`,
    )
  }
  if (gates !== undefined && stats.gates > gates) {
    out.push(`at most ${gates} gate${gates === 1 ? '' : 's'} — this uses ${stats.gates}`)
  }
  if (layers !== undefined && stats.layers > layers) {
    out.push(`at most ${layers} layer${layers === 1 ? '' : 's'} deep — this is ${stats.layers}`)
  }
  if (measurements !== undefined && stats.measurements > measurements) {
    out.push(
      measurements === 0
        ? 'no measurement on this level'
        : `at most ${measurements} measurements — this has ${stats.measurements}`,
    )
  }
  return out
}

interface Outcome {
  ok: boolean
  message: string
  got?: string
  trials?: TrialResult[]
}

/** Whether the goal is met, or the reason it could not be settled. */
function meets(level: Level, source: string): Outcome {
  const { goal, qubits, input } = level

  if (goal.kind === 'oracle') {
    const trials = goal.trials.map((trial) => {
      const filled = substituteOracle(source, goal.slot, trial.circuit)
      if (!filled) return { name: trial.name, ok: false }
      try {
        return {
          name: trial.name,
          ok: statesEqual(finalState(filled, input, qubits), stateOf(trial.expect, qubits)),
        }
      } catch {
        // This box makes the circuit unrunnable. That is a failure of this
        // trial, not a reason to stop trying the others.
        return { name: trial.name, ok: false }
      }
    })

    const passed = trials.filter((t) => t.ok).length
    if (passed === trials.length) {
      return { ok: true, message: 'It works, whatever is in the box.', trials }
    }
    return {
      ok: false,
      message: passed
        ? `Right for ${passed} of the ${trials.length} boxes, wrong for the rest.`
        : 'Not right for any of the boxes yet.',
      trials,
    }
  }

  if (goal.kind === 'operator') {
    const built = operationOf(source, qubits)
    const wanted = operationOf(goal.equals, qubits)
    const trials: TrialResult[] = []
    for (let i = 0; i < 1 << qubits; i++) {
      const basis = i.toString(2).padStart(qubits, '0')
      const actual = finalState(source, basis, qubits)
      const expected = finalState(goal.equals, basis, qubits)
      trials.push({
        name: `Input |${basis}⟩`,
        input: `|${basis}⟩`,
        expected: diracOf(expected),
        actual: diracOf(actual),
        ok: statesEqual(actual, expected),
      })
    }
    // What it does to the input on screen, which the player can change. The
    // verdict does not depend on it — every input has just been checked — but
    // seeing one worked out is how the experiment pays off.
    let got: string | undefined
    try {
      got = diracOf(finalState(source, inputOf(source) ?? input, qubits))
    } catch {
      got = undefined
    }
    const exact = statesEqual(built, wanted)
    const passed = trials.filter((trial) => trial.ok).length
    if (exact) {
      return {
        ok: true,
        message: `All ${trials.length} input states pass.`,
        got,
        trials,
      }
    }
    return {
      ok: false,
      message:
        passed === trials.length
          ? 'The outputs look right, but their relative phases do not match.'
          : `${passed} of ${trials.length} input states pass. One circuit must pass them all.`,
      got,
      trials,
    }
  }

  const state = finalState(source, input, qubits)
  const got = diracOf(state)

  if (goal.kind === 'state') {
    return statesEqual(state, stateOf(goal.state, qubits))
      ? { ok: true, message: 'That is the state.', got }
      : { ok: false, message: 'Not there yet.', got }
  }

  const odds = probabilities(state)
  const tolerance = goal.tolerance ?? 1e-9
  const keys = new Set([...Object.keys(goal.expect), ...odds.keys()])
  for (const bits of keys) {
    const want = goal.expect[bits] ?? 0
    if (Math.abs((odds.get(bits) ?? 0) - want) > tolerance) {
      return { ok: false, message: 'The odds are not right yet.', got }
    }
  }
  return { ok: true, message: 'Those are the odds.', got }
}

/** Under par on every metric the level bothers to score. */
function atPar(level: Level, stats: Stats): boolean {
  const par = level.par
  if (!par) return false
  if (par.gates !== undefined && stats.gates > par.gates) return false
  if (par.layers !== undefined && stats.layers > par.layers) return false
  return true
}

export function verify(level: Level, source: string): Verdict {
  if (!source.trim()) return unreadable('Drag a gate onto the wires to begin.')

  let stats: Stats
  try {
    stats = statsOf(parseCircuit(source))
  } catch (err) {
    return unreadable(
      err instanceof ParseError ? `That circuit does not read — ${err.message}` : 'That circuit does not read.',
    )
  }

  if (!stats.gates) return { ...unreadable('Nothing has been done to the qubits yet.'), stats }

  const violations = violationsOf(level, stats)

  // A sealed box has to be in the circuit before there is anything to try.
  if (level.goal.kind === 'oracle' && !stats.boxes) {
    return {
      ...unreadable(`Drop the ${level.goal.slot} box into the circuit — you cannot look inside it.`),
      stats,
      violations,
    }
  }

  let result: Outcome
  try {
    result = meets(level, source)
  } catch (err) {
    // A box with no operation, a T where the amplitudes cannot follow, terms
    // that all cancel. The simulator's own words are better than any of ours.
    if (err instanceof SimulationError) return { ...unreadable(err.message), stats, violations }
    if (err instanceof ParseError) return { ...unreadable('That circuit does not read.'), stats, violations }
    throw err
  }

  const solved = result.ok && !violations.length
  return {
    solved,
    message: violations.length && result.ok ? 'The right answer, against the rules.' : result.message,
    violations,
    stats,
    got: result.got,
    trials: result.trials,
    optimal: solved && atPar(level, stats),
  }
}

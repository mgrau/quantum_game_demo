/**
 * Every level is solvable, and its own answer proves it.
 *
 * A puzzle game's worst failure is a level that cannot be beaten, and it is a
 * failure nobody notices until a player has spent twenty minutes on it. Each
 * level carries the answer it was designed around; this runs every one of them
 * through the very verifier the game uses and insists on a pass.
 *
 * It is also the tripwire for the library moving underneath us. The simulator
 * is somebody else's code, and if it ever stops agreeing about what a CNOT does
 * this is where that shows up.
 */

import { describe, expect, it } from 'vitest'
import { LEVELS, PACKS, parsePack, PackFormatError } from './levels'
import { verify } from './verify'
import { openingFor, statsOf, withRoom } from './circuit'
import { parseCircuit } from 'misty-states/kernel'

describe('the level packs', () => {
  it('load', () => {
    expect(PACKS).toHaveLength(1)
    expect(LEVELS).toHaveLength(5)
  })

  it('have unique ids across every pack', () => {
    const ids = LEVELS.map((l) => l.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe.each(LEVELS)('$id — $title', (level) => {
  it('is solved by its own solution', () => {
    const verdict = verify(level, level.solution)
    // The message is in the failure output, which is what makes a broken level
    // readable rather than just red.
    expect({ id: level.id, ...verdict }).toMatchObject({ solved: true, violations: [] })
  })

  it('is solved by that solution built on the board it opens with', () => {
    // What a player actually ends up holding: their gates, and the template of
    // empty slots re-formed underneath them.
    const played = withRoom(`${openingFor(level)}\n${level.solution}`)
    expect({ id: level.id, ...verify(level, played) }).toMatchObject({
      solved: true,
      violations: [],
    })
  })

  it('has a solution that meets par', () => {
    if (!level.par) return
    const stats = statsOf(parseCircuit(level.solution))
    if (level.par.gates !== undefined) expect(stats.gates).toBeLessThanOrEqual(level.par.gates)
    if (level.par.layers !== undefined) expect(stats.layers).toBeLessThanOrEqual(level.par.layers)
  })

  it('states an input the notation accepts', () => {
    expect(() => verify(level, level.solution)).not.toThrow()
    expect(level.input.length).toBeGreaterThan(0)
  })
})

describe('an empty circuit', () => {
  it('is never solved, and never throws', () => {
    for (const level of LEVELS) {
      const verdict = verify(level, `qubits ${level.qubits}\nin ${level.input}`)
      expect(verdict.solved).toBe(false)
      expect(verdict.message).toBeTruthy()
    }
  })
})

describe('an operation checked on every input', () => {
  const operator = LEVELS.find((level) => level.id === 'd.4')!

  it('reports a separate result for every basis state', () => {
    const attempt = verify(operator, 'H 1')
    expect(attempt.trials).toHaveLength(2)
    expect(attempt.trials?.map((trial) => trial.input)).toEqual(['|0⟩', '|1⟩'])
    expect(attempt.solved).toBe(false)
  })
})

describe('a sealed box', () => {
  const deutsch = LEVELS.find((l) => l.id === 'd.5')!
  const open = (body: string) => withRoom(`${openingFor(deutsch)}\n${body}`)

  it('has to be in the circuit before there is anything to try', () => {
    const verdict = verify(deutsch, open('H 1\nH 2\nH 1'))
    expect(verdict.solved).toBe(false)
    expect(verdict.message).toMatch(/box/i)
    expect(verdict.trials).toBeUndefined()
  })

  it('refuses a circuit that is right for some boxes and wrong for others', () => {
    // The naive attempt: the top wire is never made misty, so the box is only
    // ever asked about one input. That answers "constant" every time — right
    // for the two constant boxes, and wrong for both balanced ones. Exactly the
    // circuit that a single worked example would have accepted.
    const verdict = verify(deutsch, open('H 2\nbox "f" 1-2'))
    expect(verdict.solved).toBe(false)
    expect(verdict.trials?.filter((t) => t.ok).length).toBeGreaterThan(0)
    expect(verdict.trials?.filter((t) => !t.ok).length).toBeGreaterThan(0)
  })

  it('reports every box by name, so it is clear which one is failing', () => {
    const verdict = verify(deutsch, open(deutsch.solution))
    expect(verdict.trials?.map((t) => t.name)).toEqual(
      (deutsch.goal as { trials: { name: string }[] }).trials.map((t) => t.name),
    )
    expect(verdict.trials?.every((t) => t.ok)).toBe(true)
  })

  it('will not be asked twice', () => {
    const twice = open(`${deutsch.solution}\nbox "f" 1-2`)
    const verdict = verify(deutsch, twice)
    expect(verdict.solved).toBe(false)
    expect(verdict.violations.join(' ')).toMatch(/once/)
  })
})

describe('a level file that is wrong', () => {
  it('says so, naming the level', () => {
    const bad = `
pack: broken
title: Broken
levels:
  - id: b.1
    title: No goal
    brief: nothing
    qubits: 1
    solution: H 1
`
    expect(() => parsePack(bad, 'broken.yaml')).toThrow(PackFormatError)
    expect(() => parsePack(bad, 'broken.yaml')).toThrow(/b\.1/)
  })

  it('refuses odds that do not add up', () => {
    const bad = `
pack: broken
title: Broken
levels:
  - id: b.2
    title: Bad odds
    objective: Break the odds.
    brief: nothing
    qubits: 1
    goal: { kind: outcomes, expect: { "0": 0.5, "1": 0.9 } }
    solution: H 1
`
    expect(() => parsePack(bad, 'broken.yaml')).toThrow(/add up/)
  })
})

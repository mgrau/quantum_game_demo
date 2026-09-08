/**
 * Reading a circuit: what counts as a move, and what the input can be turned into.
 */

import { describe, expect, it } from 'vitest'
import { dropTarget, insertGate, parseCircuit } from 'misty-states/kernel'
import { render } from 'misty-states/render'
import {
  inputOf, openingFor, statsOf, toggleInputQubit, withinWidth, withRoom,
} from './circuit'

describe('the template of empty slots', () => {
  const empty = openingFor({ qubits: 2, input: '00' })

  it('opens with room and nothing in it', () => {
    expect(statsOf(parseCircuit(empty)).layers).toBe(0)
    expect(parseCircuit(empty).layers.length).toBe(3)
  })

  /** Drop a gate onto a slot the way the board does, and normalise after. */
  function drop(source: string, head: string, wires: number, slot: number): string {
    const geometry = render(`${source}\nout calculate`).geometry!
    const layer = geometry.layers[slot]
    const target = dropTarget(geometry, {
      x: geometry.columns[0],
      y: layer.y + layer.h / 2,
    })
    return withRoom(insertGate(source, parseCircuit(source), target, { head, wires }).source)
  }

  it('is filled by a dropped gate rather than pushed aside', () => {
    const after = drop(empty, 'H', 1, 0)
    expect(after).toContain('H 1')
    expect(statsOf(parseCircuit(after)).layers).toBe(1)
    // One real layer, and the template shortens so the board stays a steady
    // size instead of growing a layer every time something is placed.
    expect(parseCircuit(after).layers.length).toBe(3)
  })

  it('never accumulates dead pipe', () => {
    let source = empty
    for (const [head, wires] of [
      ['H', 1],
      ['CNOT', 2],
      ['X', 1],
      ['Z', 1],
    ] as const) {
      source = drop(source, head, wires, 0)
    }
    const doc = parseCircuit(source)
    expect(statsOf(doc).gates).toBe(4)
    // However the gates packed, exactly one empty slot is left over.
    expect(doc.layers.length).toBe(statsOf(doc).layers + 1)
  })

  it('lets gates on different wires share a layer', () => {
    // The lesson one whole level exists for. An identity occupies its wire, so
    // leaving the slots in would make this impossible.
    const both = withRoom(`${withRoom(`${empty}\nH 1`)}\nH 2`)
    expect(statsOf(parseCircuit(both)).layers).toBe(1)
    expect(statsOf(parseCircuit(both)).gates).toBe(2)
  })

  it('settles, rather than growing each time it is applied', () => {
    const once = withRoom(`${empty}\nH 1`)
    expect(withRoom(once)).toBe(once)
    expect(withRoom(withRoom(once))).toBe(once)
  })

  it('hands unparseable text back untouched', () => {
    expect(withRoom('this is not a circuit at all !!')).toBe('this is not a circuit at all !!')
  })
})

describe('what counts as a move', () => {
  it('does not charge for the pipe a level opens with', () => {
    const stats = statsOf(parseCircuit(openingFor({ qubits: 2, input: '00' })))
    expect(stats.gates).toBe(0)
    expect(stats.layers).toBe(0)
    expect(stats.used).toEqual([])
  })

  it('counts the gates dropped into it, and no more', () => {
    const stats = statsOf(parseCircuit(`${openingFor({ qubits: 2, input: '00' })}\nH 1\nCNOT 1 -> 2`))
    expect(stats.gates).toBe(2)
    expect(stats.layers).toBe(2)
    expect(stats.used).toEqual(['CNOT', 'H'])
  })

  it('does not charge for a window either', () => {
    const stats = statsOf(parseCircuit('qubits 1\nin 0\nH 1\nwindow calculate'))
    expect(stats.gates).toBe(1)
  })
})

describe('keeping the register the size the puzzle says', () => {
  const empty = openingFor({ qubits: 2, input: '00' })

  /** Aim at a wire — or past the last one — the way a drag does. */
  function aim(source: string, head: string, wires: number, x: number): string {
    const geometry = render(`${source}\nout calculate`).geometry!
    const layer = geometry.layers[0]
    const target = dropTarget(geometry, { x, y: layer.y + layer.h / 2 })
    const edit = insertGate(source, parseCircuit(source), target, { head, wires })
    return withRoom(withinWidth(edit.source, 2))
  }

  const columns = () => render(`${empty}\nout calculate`).geometry!.columns

  it('pulls a two-wire gate dropped on the last wire back inside', () => {
    // The common accident: a CNOT on wire 2 of a two-wire register reaches
    // wire 3, and the register quietly grows.
    const after = aim(empty, 'CNOT', 2, columns()[1])
    expect(parseCircuit(after).qubits).toBe(2)
    expect(after).toContain('CNOT 1 2')
  })

  it('pulls a gate dropped past the right edge back inside', () => {
    const after = aim(empty, 'H', 1, columns()[1] + 120)
    expect(parseCircuit(after).qubits).toBe(2)
    expect(after).toContain('H 2')
  })

  it('drops a gate that could never fit, rather than growing for it', () => {
    const after = aim(empty, 'TOFFOLI', 3, columns()[0])
    expect(parseCircuit(after).qubits).toBe(2)
    expect(after).not.toContain('TOFFOLI')
  })

  it('leaves a circuit that already fits exactly as it was', () => {
    const fine = withRoom(`${empty}\nCNOT 1 -> 2`)
    expect(withinWidth(fine, 2)).toBe(fine)
  })

  it('hands unparseable text back untouched', () => {
    expect(withinWidth('not a circuit !!', 2)).toBe('not a circuit !!')
  })

  it('keeps the gates that were already there', () => {
    const built = withRoom(`${empty}\nH 1`)
    const after = withinWidth(`${built}\nCNOT 2 3`, 2)
    expect(parseCircuit(after).qubits).toBe(2)
    expect(statsOf(parseCircuit(after)).gates).toBe(2)
  })
})

describe('turning an input qubit over', () => {
  const source = openingFor({ qubits: 2, input: '00' })

  it('flips the one that was clicked', () => {
    expect(inputOf(toggleInputQubit(source, 0)!)).toBe('10')
    expect(inputOf(toggleInputQubit(source, 1)!)).toBe('01')
  })

  it('flips back', () => {
    const once = toggleInputQubit(source, 1)!
    expect(inputOf(toggleInputQubit(once, 1)!)).toBe('00')
  })

  it('leaves the rest of the circuit alone', () => {
    const built = `${source}\nH 1`
    expect(toggleInputQubit(built, 0)).toContain('H 1')
  })

  it('refuses a misty input, which has no single qubit to turn over', () => {
    expect(toggleInputQubit('qubits 1\nin 0|1\nH 1', 0)).toBeNull()
  })

  it('refuses a wire that is not there', () => {
    expect(toggleInputQubit(source, 5)).toBeNull()
  })

  it('says nothing when there is no input written', () => {
    expect(toggleInputQubit('qubits 1\nH 1', 0)).toBeNull()
    expect(inputOf('qubits 1\nH 1')).toBeNull()
  })
})

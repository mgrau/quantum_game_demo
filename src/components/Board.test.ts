// @vitest-environment jsdom

/**
 * A gate dragged off the palette lands on the wires.
 *
 * This is the game's one indispensable interaction and it is the one that
 * cannot be checked by type-checking or by any pure test: everything before the
 * drop is somebody else's tested code, everything after it is ours and tested,
 * and what sits between them is the wiring — four callbacks and a lifecycle,
 * exactly the sort of thing that compiles perfectly and does nothing.
 *
 * So this drives the real component: press, move, release, and then ask what
 * the source became.
 */

import { describe, expect, it } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'
import Board from './Board.svelte'

const pointer = (type: string, x: number, y: number) =>
  new (class extends Event {
    clientX = x
    clientY = y
    button = 0
  })(type, { bubbles: true }) as unknown as PointerEvent

function open(source: string, editableInput = false, qubits = 2) {
  const target = document.createElement('div')
  document.body.appendChild(target)
  let written: string | null = null
  const component = mount(Board, {
    target,
    props: {
      source,
      showState: true,
      editableInput,
      qubits,
      onchange: (next: string) => (written = next),
    },
  })
  flushSync()
  return {
    component,
    target,
    written: () => written,
    close: () => {
      unmount(component)
      target.remove()
    },
  }
}

describe('dragging a gate onto the wires', () => {
  it('draws the circuit it was given', () => {
    const board = open('qubits 2\nin 00')
    expect(board.target.querySelector('svg')).not.toBeNull()
    board.close()
  })

  it('writes the gate into the source when the drag is released', () => {
    const board = open('qubits 2\nin 00')

    board.component.carryNew({ head: 'H', wires: 1 }, pointer('pointerdown', 0, 0))
    window.dispatchEvent(pointer('pointermove', 0, 30))
    flushSync()
    window.dispatchEvent(pointer('pointerup', 0, 30))
    flushSync()

    expect(board.written()).toContain('H 1')
    board.close()
  })

  it('aims at the wire the pointer is over', () => {
    const board = open('qubits 2\nin 00')

    // The second wire's column, taken from the layout rather than assumed.
    board.component.carryNew({ head: 'X', wires: 1 }, pointer('pointerdown', 60, 0))
    window.dispatchEvent(pointer('pointermove', 60, 30))
    flushSync()
    window.dispatchEvent(pointer('pointerup', 60, 30))
    flushSync()

    expect(board.written()).toContain('X 2')
    board.close()
  })

  it('never grows the register, whatever is dropped where', () => {
    const board = open('qubits 2\nin 00\nI 1; I 2', false, 2)

    // A two-wire gate on the last wire reaches past the end, which is the
    // accident that used to add a third qubit line.
    board.component.carryNew({ head: 'CNOT', wires: 2 }, pointer('pointerdown', 60, 0))
    window.dispatchEvent(pointer('pointermove', 60, 30))
    flushSync()
    window.dispatchEvent(pointer('pointerup', 60, 30))
    flushSync()

    expect(board.written()).toContain('CNOT 1 2')
    expect(board.written()).not.toMatch(/\b3\b/)
    board.close()
  })

  it('turns an input qubit over when it is clicked', () => {
    const board = open('qubits 2\nin 00\nI 1; I 2', true)

    const drawn = board.target.querySelectorAll('[data-key="state:in"]')
    expect(drawn.length, 'one drawn qubit per wire').toBe(2)

    drawn[1].dispatchEvent(new MouseEvent('click', { bubbles: true }))
    flushSync()

    expect(board.written()).toContain('in 01')
    board.close()
  })

  it('leaves the input alone on a level that does not offer it', () => {
    const board = open('qubits 2\nin 00\nI 1; I 2', false)

    const drawn = board.target.querySelectorAll('[data-key="state:in"]')
    drawn[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    flushSync()

    expect(board.written()).toBeNull()
    board.close()
  })

  it('leaves the source alone when the drag is abandoned', () => {
    const board = open('qubits 2\nin 00')

    board.component.carryNew({ head: 'H', wires: 1 }, pointer('pointerdown', 0, 0))
    window.dispatchEvent(pointer('pointermove', 0, 30))
    flushSync()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    flushSync()
    window.dispatchEvent(pointer('pointerup', 0, 30))
    flushSync()

    expect(board.written()).toBeNull()
    board.close()
  })
})

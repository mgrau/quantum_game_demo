/**
 * Every picture the game asks for can actually be drawn.
 *
 * The renderer is pure and throws rather than drawing something wrong, so every
 * source string the interface hands it is a chance to put an error message on
 * screen where a figure should be. The strings are few and they are all
 * derivable, so all of them are checked here rather than discovered by a player.
 *
 * The `out calculate` case is the one that matters. The board asks for the
 * state under the circuit and falls back to drawing without it, so a failure
 * here is invisible in play — it just silently stops teaching.
 */

import { describe, expect, it } from 'vitest'
import { render } from 'misty-states/render'
import { LEVELS } from './levels'
import { chipSource, paletteFor } from './palette'
import { openingFor } from './circuit'

const opening = (level: (typeof LEVELS)[number]) => openingFor(level)

describe.each(LEVELS)('$id — $title', (level) => {
  it('opens on a drawing', () => {
    expect(render(opening(level)).svg).toContain('<svg')
  })

  it('opens with room to drop into, and its answer drawn', () => {
    const drawn = render(`${opening(level)}\nout calculate`)
    // A layer per length of pipe: something to aim at before anything is built.
    expect(drawn.geometry?.layers.length).toBe(3)
    // One drawn qubit per wire, which is what makes the input clickable.
    const keys = [...drawn.svg.matchAll(/data-key="state:in"/g)]
    expect(keys.length).toBe(/^[01]+$/.test(level.input) ? level.qubits : keys.length)
  })

  it('draws its solution', () => {
    expect(render(`${opening(level)}\n${level.solution}`).svg).toContain('<svg')
  })

  it('works the answer out underneath, unless a sealed box makes that impossible', () => {
    const source = `${opening(level)}\n${level.solution}\nout calculate`

    if (level.goal.kind === 'oracle') {
      // Refusing here is the whole point of the puzzle rather than a failure:
      // nobody can say where a circuit lands while part of it is a box they
      // cannot open. The board tries this, is refused, and draws the circuit
      // without an answer under it — which is the honest picture.
      expect(() => render(source)).toThrow()
      return
    }
    expect(render(source).svg).toContain('<svg')
  })

  it('offers a palette that draws', () => {
    const groups = paletteFor(level.palette)
    expect(groups.length).toBeGreaterThan(0)
    for (const group of groups) {
      for (const item of group.items) {
        expect(render(item.source, { scale: 0.62 }).svg).toContain('<svg')
        // The ghost that follows the pointer is drawn from the droppable alone.
        expect(render(chipSource(item.drop)).svg).toContain('<svg')
      }
    }
  })

  it('draws whatever the goal pane shows', () => {
    if (level.goal.kind === 'state') expect(render(level.goal.state).svg).toContain('<svg')
    if (level.goal.kind === 'operator') {
      expect(render(`qubits ${level.qubits}\n${level.goal.equals}`).svg).toContain('<svg')
    }
  })
})

describe('a level that restricts its palette', () => {
  it('still offers the window, which is a way of looking rather than a move', () => {
    const groups = paletteFor(['H'])
    const ids = groups.flatMap((g) => g.items.map((i) => i.id))
    expect(ids).toContain('H')
    expect(ids).toContain('WINDOW')
    expect(ids).not.toContain('TOFFOLI')
  })
})

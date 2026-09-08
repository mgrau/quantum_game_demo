// @vitest-environment jsdom

/**
 * A whole puzzle, solved by dragging.
 *
 * The Board test proves the component works when it is handed the right props.
 * This proves the game hands them over — which is a separate thing, and was
 * once separately broken: an effect that saved progress also *read* the entry
 * it was replacing, so it invalidated itself, Svelte gave up part-way through
 * the first flush, and `onMount` never ran. Every drawing was on screen and
 * nothing could be dragged.
 *
 * That failure is invisible to type-checking, invisible to every pure test, and
 * obvious within one second of playing. This is the test that stands in for
 * playing it.
 */

import { describe, expect, it, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'
import App from './App.svelte'

const pointer = (type: string, x: number, y: number) =>
  new (class extends Event {
    clientX = x
    clientY = y
    button = 0
  })(type, { bubbles: true }) as unknown as PointerEvent

describe('the level list', () => {
  it('shows the complete five-level demo path', () => {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(App, { target })
    flushSync()

    const levels = target.querySelectorAll('aside ol button')
    expect(levels).toHaveLength(5)
    expect(target.textContent).toContain('Flip the bit')
    expect(target.textContent).toContain('Build a NOT from phase')
    expect(target.textContent).toContain('Ask the sealed box once')

    unmount(app)
    target.remove()
  })
})

describe('the first level', () => {
  it('is solved by dragging a NOT onto the wire', () => {
    // No web storage here, which is fine: saving is guarded, and a test that
    // began from yesterday's progress would not be a test of anything.
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(App, { target })
    flushSync()

    // The level opens unsolved, on a drawing.
    expect(target.textContent).toContain('Flip the bit')
    expect(target.querySelector('svg')).not.toBeNull()

    const swatch = [...target.querySelectorAll('button')].find((b) =>
      b.getAttribute('title')?.startsWith('NOT'),
    )
    expect(swatch, 'the palette offers a NOT').toBeTruthy()

    swatch!.dispatchEvent(pointer('pointerdown', 0, 0))
    window.dispatchEvent(pointer('pointermove', 0, 40))
    flushSync()
    window.dispatchEvent(pointer('pointerup', 0, 40))
    flushSync()

    expect(target.textContent).toContain('That is the state.')

    unmount(app)
    target.remove()
  })
})

describe('multi-input verification', () => {
  it('checks every input before showing the next-level transition', () => {
    vi.useFakeTimers()
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(App, { target })
    flushSync()

    const operatorLevel = [...target.querySelectorAll('aside ol button')].find((button) =>
      button.textContent?.includes('Build a NOT from phase'),
    )
    operatorLevel?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    flushSync()

    const textButton = [...target.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Show text'),
    )
    textButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    flushSync()

    const editor = target.querySelector('textarea')!
    editor.value = 'qubits 1\nin 0\nH 1\nZ 1\nH 1'
    editor.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()

    expect(target.textContent).toContain('Checking every case')
    expect(target.textContent).toContain('Input |0⟩')
    expect(target.textContent).toContain('Input |1⟩')
    expect(target.textContent).not.toContain('Level 4 complete')

    vi.advanceTimersByTime(1_600)
    flushSync()
    expect(target.textContent).toContain('Level 4 complete')
    expect(target.textContent).toContain('Decide whether every hidden function')

    unmount(app)
    target.remove()
    vi.useRealTimers()
  })
})

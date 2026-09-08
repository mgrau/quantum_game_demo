/**
 * Dragging gates onto a drawing, without knowing what drew it.
 *
 * The editing rules in `circuit/edit` are pure and always have been: given a
 * source, a document and a place, they say what the text becomes. What was not
 * portable was everything between a finger and one of those calls — deciding a
 * press has become a drag, freezing what the aim is measured against, sliding
 * the gates that moved instead of letting them jump, holding the figure still
 * while it grows underneath. Four hundred lines of it, and an application that
 * wanted a circuit board of its own had no choice but to write them again.
 *
 * So this is that layer with the framework taken out. It talks to the host in
 * four sentences — *this is what is on screen*, *here is what dropping would
 * produce*, *now write it*, *the carry changed* — and holds everything else
 * itself. A Svelte host feeds `view()` from its reactive state and turns
 * `onchange` back into it; a host built on anything else does the same thing by
 * its own means, and neither is visible from in here.
 *
 * This is the one part of the library that needs a browser: pointers, a DOM to
 * measure, and elements to translate. It is behind its own entry point for that
 * reason — nothing in `kernel` or `render` imports it, and a consumer rendering
 * on a server never loads it.
 *
 * Two things about it are load-bearing and were both paid for in bugs.
 *
 * Everything the aim is read against is frozen at pick-up: the document, its
 * geometry, and the mapping from screen to diagram. The drawing shifts as the
 * preview grows, and measuring it while it moves would feed the animation back
 * into the aim that drives it.
 *
 * And a gate is identified by *being* one of the frozen document's gates, not
 * by looking like one. Anything that copies it — a reactive proxy, a
 * round-trip through JSON — hands the patch something it cannot find, and the
 * edit silently does nothing. Hosts must pass gates through untouched.
 */

import type { CircuitDoc, Gate } from '../circuit/ast'
import type { CircuitGeometry } from '../circuit/layout'
import {
  cycleTarget, dropTarget, gateAt, insertGate, moveGate, nextQubit, qubitAt, removeGate, setQubit,
} from '../circuit/edit'
import type { DropTarget, Droppable, Edit, QubitSpot } from '../circuit/edit'
import { parseCircuit } from '../circuit/parse'

/**
 * What is in the air: a new gate off the palette, or one already in the
 * drawing that is being moved. The difference is only which patch is used —
 * both preview the same way and commit the same way.
 */
export type Carried = { from: 'palette'; gate: Droppable } | { from: 'diagram'; gate: Gate }

/** Everything a host needs in order to draw the carry. */
export interface CarryState {
  /** What is being held, or nothing. */
  carrying: Carried | null
  /** Where the pointer is, so the gate can follow it. */
  at: { x: number; y: number } | null
  /** True while letting go would throw the carried gate away. */
  removing: boolean
}

const NOTHING: CarryState = { carrying: null, at: null, removing: false }

/** What is on screen, as the host currently understands it. */
export interface BoardView {
  /** The text the drawing was made from. */
  source: string
  /** How that text was laid out, when it is a circuit. */
  geometry?: CircuitGeometry
  /** How many wires, for a state that has not been laid out as a circuit. */
  qubits?: number
  /**
   * The qubits that can be pointed at, in the drawing's own coordinates.
   *
   * Every one of them leads back to a single character of the source, so
   * clicking one is an edit rather than a selection.
   */
  spots?: QubitSpot[]
}

export interface BoardHost {
  /** The element the drawing sits inside. Re-read, since hosts remount. */
  preview: () => HTMLElement | null | undefined
  /**
   * The element to translate in order to hold the figure still. Optional: a
   * host that does not centre its drawing has nothing to correct for.
   */
  anchor?: () => HTMLElement | null | undefined
  /** What is on screen, or null while it cannot be drawn. */
  view: () => BoardView | null
  /**
   * What dropping here would produce, or null where it would produce nothing.
   *
   * The drag never writes. It works out what the source *would* be, hands it
   * over to be drawn, and writes only on release — so the preview is produced
   * by the very function that will commit, and the two cannot disagree.
   */
  onpreview: (edit: Edit | null) => void
  /** Let go, or clicked: this is the edit, as one change rather than a hundred. */
  oncommit: (edit: Edit) => void
  /** The carry changed. Hosts redraw the floating gate from this. */
  onchange?: (state: CarryState) => void
  /**
   * A gate was tapped and the board had nothing to do about it.
   *
   * A press that goes nowhere is a click, and the one click the board answers
   * itself is on a controlled gate, whose target it walks to the next wire it
   * covers. Everything else is the host's: a rotation might want a dial, a box
   * might want to be renamed. The document and the source it came from travel
   * with the gate, because a gate is only identifiable against the parse it
   * belongs to and the host must not go looking for it in a fresher one.
   */
  ontap?: (tap: { gate: Gate; doc: CircuitDoc; source: string; at: { x: number; y: number } }) => void
  /** How long a slide takes. Zero turns the animation off. */
  flipMs?: number
}

export interface Board {
  /** Pick a gate up off a palette. */
  carryNew(gate: Droppable, event: PointerEvent): void
  /**
   * A press inside the drawing, which may become a move or may be a click.
   *
   * Returns whether it claimed the press — true when a gate or qubit is under
   * the pointer, false when the press landed on empty drawing. A host can use
   * that to leave an empty grab for something else, such as dragging the whole
   * figure out to another program.
   */
  press(event: PointerEvent): boolean
  /** Call immediately before the drawing is replaced, and again after. */
  beforeRender(): void
  afterRender(): void
  /** Put everything down and let go of every listener. */
  destroy(): void
}

/** Press on a gate to move it — but not until the pointer has actually travelled. */
const PICK_UP_AFTER = 4

export function createBoard(host: BoardHost): Board {
  const flipMs = host.flipMs ?? 150

  let carrying: Carried | null = null
  let at: { x: number; y: number } | null = null
  let removing = false

  /**
   * What the drag is measured against, taken once and not looked at again.
   */
  let held: {
    source: string
    doc: CircuitDoc
    /** Where a pointer lands, worked out the way this document needs. */
    aim: (event: PointerEvent) => DropTarget
    /** Screen to diagram, for reading the pointer. */
    screen: DOMMatrix
    /** Where the diagram's origin sat on screen, for keeping it there. */
    anchor: { x: number; y: number }
  } | null = null

  /**
   * What is under a press that has not yet become anything.
   *
   * A gate can be picked up and carried; a qubit cannot — there is nowhere to
   * carry it to — so it waits here only to find out whether the press was a
   * click.
   */
  let pending: { gate?: Gate; spot?: QubitSpot; x: number; y: number } | null = null
  let flipFrom: Map<string, DOMRect> | null = null

  /**
   * The edit the drag is currently showing.
   *
   * Kept here as well as handed over, because release has to commit exactly
   * what was last drawn; asking the host for it back would mean trusting that
   * it stored what it was given.
   */
  let showing: Edit | null = null

  function show(edit: Edit | null) {
    showing = edit
    host.onpreview(edit)
  }

  const announce = () => host.onchange?.(carrying ? { carrying, at, removing } : NOTHING)

  const svgIn = (el: HTMLElement | null | undefined) =>
    (el?.querySelector('svg') as SVGSVGElement | null) ?? null

  /**
   * Take hold of what the drag will be measured against.
   *
   * Called on the first move over the drawing, while what is on screen is still
   * the committed diagram: its geometry and its screen mapping are what every
   * subsequent move is read against.
   */
  function hold(): boolean {
    if (held) return true
    const view = host.view()
    const el = svgIn(host.preview())
    const screen = el?.getScreenCTM()
    if (!el || !screen || !view) return false

    let doc: CircuitDoc
    try {
      // A state parses as a circuit too — one with an input and nothing done to
      // it yet — which is what lets a gate be dropped onto one.
      doc = parseCircuit(view.source)
    } catch {
      return false
    }

    /**
     * How a point on the drawing becomes a place to put a gate.
     *
     * Decided once, here, because the two cases read the drawing differently.
     * A circuit has wires and layers laid out, and the pointer is matched
     * against them. A state has neither — it is a register nothing has been
     * done to — so the wire is taken from how far across the drawing the
     * pointer is, and there is only ever one place for the gate to go: after
     * the state, which is what turns it into a circuit.
     */
    const geometry = view.geometry
    const wires = view.qubits ?? 1
    const rect = el.getBoundingClientRect()
    const inverse = screen.inverse()
    const aim: (event: PointerEvent) => DropTarget = geometry
      ? (event) =>
          dropTarget(
            geometry,
            new DOMPoint(event.clientX, event.clientY).matrixTransform(inverse),
          )
      : (event) => ({
          wire: Math.min(
            wires,
            Math.max(1, Math.floor(((event.clientX - rect.left) / rect.width) * wires) + 1),
          ),
          layer: 0,
          where: 'after',
        })

    held = { source: view.source, doc, aim, screen: inverse, anchor: { x: screen.e, y: screen.f } }
    return true
  }

  /** Where a pointer is in the diagram's own coordinates, through the frozen map. */
  const toDiagram = (event: PointerEvent) =>
    new DOMPoint(event.clientX, event.clientY).matrixTransform(held!.screen)

  // ---------------------------------------------------------------- the carry

  function begin(what: Carried, event: PointerEvent) {
    carrying = what
    at = { x: event.clientX, y: event.clientY }
    announce()
    window.addEventListener('pointermove', onCarryMove)
    window.addEventListener('pointerup', onCarryUp)
    window.addEventListener('keydown', onCarryKey)
  }

  function press(event: PointerEvent): boolean {
    if (event.button !== 0 || carrying || !hold() || !held) return false
    const view = host.view()
    const at = toDiagram(event)
    const gate = view?.geometry ? gateAt(held.doc, view.geometry, at) : undefined
    // Both, where both are there. Inside a window the two overlap by
    // construction — its qubits are drawn within it — and which one was meant
    // is decided by what the press turns into rather than by where it landed:
    // moved, it carries the window; released where it began, it flips the qubit
    // under it, that being the smaller and more particular of the two.
    const spot = qubitAt(view?.spots ?? [], at)
    if (!gate && !spot) {
      held = null
      // Nothing here to edit — the press is the host's to do with as it likes,
      // which is how a drag-to-export can tell an empty grab from a gate.
      return false
    }
    pending = { gate, spot, x: event.clientX, y: event.clientY }
    window.addEventListener('pointermove', onPendingMove)
    window.addEventListener('pointerup', clickGate, { once: true })
    return true
  }

  function onPendingMove(event: PointerEvent) {
    if (!pending) return
    // A qubit has nowhere to be carried to, so moving off one is simply not a
    // click rather than the start of a drag.
    if (!pending.gate) {
      const strayed =
        Math.abs(event.clientX - pending.x) > PICK_UP_AFTER ||
        Math.abs(event.clientY - pending.y) > PICK_UP_AFTER
      if (strayed) dropPending()
      return
    }
    const far =
      Math.abs(event.clientX - pending.x) > PICK_UP_AFTER ||
      Math.abs(event.clientY - pending.y) > PICK_UP_AFTER
    if (!far) return
    const gate = pending.gate!
    // The carry starts before the pending state is cleared, because clearing it
    // lets go of the frozen document — and `gate` is a value *from* that
    // document. Handed a gate from a different parse, the patch would find
    // nothing to remove.
    begin({ from: 'diagram', gate }, event)
    forgetPending()
    onCarryMove(event)
  }

  /** Stop watching for a press to become a drag. */
  function forgetPending() {
    pending = null
    window.removeEventListener('pointermove', onPendingMove)
  }

  /**
   * A press that went nowhere is a click, and a click on a controlled gate
   * moves its target to the next wire it covers.
   *
   * The wires are obvious from where the gate was dropped; which of them takes
   * the ⊕ is not, and rewriting the line by hand to find out is the one edit
   * that dragging left undone.
   */
  function clickGate() {
    const tapped = pending
    forgetPending()
    if (tapped && held && !carrying) {
      if (tapped.spot) {
        // The one edit that needs nothing but the character it is written as.
        const written = setQubit(held.source, tapped.spot.at, nextQubit(tapped.spot.value))
        if (written) host.oncommit(written)
      } else if (tapped.gate) {
        const spun = cycleTarget(held.source, held.doc, tapped.gate)
        if (spun) host.oncommit(spun)
        else {
          host.ontap?.({
            gate: tapped.gate,
            doc: held.doc,
            source: held.source,
            at: { x: tapped.x, y: tapped.y },
          })
        }
      }
    }
    if (!carrying) held = null
  }

  /** Give up on a press without acting on it. */
  function dropPending() {
    forgetPending()
    if (!carrying) held = null
  }

  /** Work out what dropping here would produce, and hand that over to be drawn. */
  function onCarryMove(event: PointerEvent) {
    if (!carrying) return
    at = { x: event.clientX, y: event.clientY }

    const over = host.preview()?.getBoundingClientRect()
    const inside =
      !!over &&
      event.clientX >= over.left && event.clientX <= over.right &&
      event.clientY >= over.top && event.clientY <= over.bottom

    // Off to the left with a gate out of the drawing: that is a deletion. To
    // the left specifically, because that is away from the figure and towards
    // the text — a pointer straying above or below is a slip, not an intent.
    removing =
      !inside && carrying.from === 'diagram' && !!over && event.clientX < over.left && !!held
    announce()
    if (removing && held && carrying.from === 'diagram') {
      const cut = removeGate(held.source, held.doc, carrying.gate)
      // Line 0 highlights nothing: what is being pointed at is no longer there.
      show(cut ? { source: cut.source, line: 0 } : null)
      return
    }

    if (!inside || !hold() || !held) {
      show(null)
      return
    }

    // Through the mapping taken at pick-up, so the aim does not chase the
    // drawing as the drawing moves under it.
    const target = held.aim(event)
    show(
      carrying.from === 'palette'
        ? insertGate(held.source, held.doc, target, carrying.gate)
        : moveGate(held.source, held.doc, carrying.gate, target),
    )
  }

  /** Commit, as a single edit rather than the hundred the drag drew. */
  function onCarryUp() {
    if (showing) host.oncommit(showing)
    end()
  }

  function onCarryKey(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      show(null)
      end()
    }
  }

  function end() {
    dropPending()
    // Released, so the drawing settles back to the middle of its pane.
    queueMicrotask(keepStill)
    carrying = null
    at = null
    removing = false
    held = null
    announce()
    show(null)
    window.removeEventListener('pointermove', onCarryMove)
    window.removeEventListener('pointerup', onCarryUp)
    window.removeEventListener('keydown', onCarryKey)
  }

  // ------------------------------------------------------------- the movement

  /**
   * Every keyed element's box, indexed by key *and* by its place among its
   * namesakes.
   *
   * One name covers several pieces — a drawn state is a dozen primitives, all
   * moving together — and the emitter wraps each on its own. Counting within a
   * name pairs each piece with the one it was, which a bare key could not: the
   * map would keep only the last and every piece would be told it used to be
   * somewhere it never was.
   */
  function boxesByKey(root: HTMLElement): Map<string, DOMRect> {
    const seen = new Map<string, number>()
    const out = new Map<string, DOMRect>()
    for (const el of root.querySelectorAll<SVGGraphicsElement>('[data-key]')) {
      const key = el.dataset.key!
      const nth = seen.get(key) ?? 0
      seen.set(key, nth + 1)
      out.set(`${key}|${nth}`, el.getBoundingClientRect())
    }
    return out
  }

  /**
   * Hold the drawing still while a gate is being placed.
   *
   * The preview is centred in its pane, so a circuit that grows by a layer
   * shifts bodily — measured at 32px for one inserted gate. Every part of the
   * figure moves, including the parts the edit did not touch, which reads as
   * the whole diagram flinching rather than as one gate arriving. Undoing that
   * translation leaves only the motion the edit actually caused.
   *
   * Set on the element rather than through any template, because a framework
   * that rewrites the wrapper's `style` on render would wipe it.
   */
  function keepStill() {
    const anchorEl = host.anchor?.()
    if (!anchorEl) return
    if (!carrying || !held) {
      if (anchorEl.style.transform) {
        anchorEl.style.transition = `transform ${flipMs}ms ease-out`
        anchorEl.style.transform = ''
      }
      return
    }
    const now = svgIn(host.preview())?.getScreenCTM()
    if (!now) return
    // Inside the preview's own `scale`, so the correction is in pre-scale units.
    const per = now.a || 1
    const current = new DOMMatrix(getComputedStyle(anchorEl).transform)
    anchorEl.style.transition = 'none'
    anchorEl.style.transform =
      `translate(${current.e + (held.anchor.x - now.e) / per}px, ` +
      `${current.f + (held.anchor.y - now.f) / per}px)`
  }

  /**
   * Slide the gates that moved, rather than letting them jump.
   *
   * The drawing arrives as one string of markup, so every element is replaced
   * on every render and a framework's own keyed-move animation has nothing to
   * hold on to. The `data-key` each gate carries is that handle: measure where
   * the keys were before the swap, work out where they landed after, and put
   * each one back where it started for an instant before letting it travel.
   *
   * Only while a gate is being carried. Everything else that redraws — a
   * keystroke, a theme, a zoom — is a different drawing rather than the same
   * one rearranged, and sliding between two of those would be nonsense.
   */
  function beforeRender() {
    const preview = host.preview()
    flipFrom = carrying && preview ? boxesByKey(preview) : null
  }

  function afterRender() {
    const from = flipFrom
    flipFrom = null
    // Before anything is measured: this moves things, and the slide should be
    // of where they ended up, not of where they briefly were.
    keepStill()
    const preview = host.preview()
    if (!from || !preview || flipMs <= 0) return
    if (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches)
      return

    // A CSS transform on an SVG element is in user units, and the drawing is
    // scaled twice over — by its own `scale` and by the preview's zoom — so the
    // screen-space delta has to be divided back down.
    const per = svgIn(preview)?.getScreenCTM()?.a || 1
    const moved: SVGGraphicsElement[] = []
    const seen = new Map<string, number>()

    for (const el of preview.querySelectorAll<SVGGraphicsElement>('[data-key]')) {
      const key = el.dataset.key!
      const nth = seen.get(key) ?? 0
      seen.set(key, nth + 1)
      const was = from.get(`${key}|${nth}`)
      if (!was) continue
      const now = el.getBoundingClientRect()
      // Measured from the top and the centre rather than from a corner,
      // because that is the point a stretch is taken about.
      const dx = (was.left + was.width / 2 - (now.left + now.width / 2)) / per
      const dy = (was.top - now.top) / per
      // A pipe between two gates does not move so much as change length: a
      // layer dropped in below lengthens it, and a translate cannot say that.
      // Scaled from its top, a pipe grows the way it actually grew — and its
      // fill is a gradient across the pipe, not along it, so stretching it
      // downwards distorts nothing.
      const grow = now.height > 0.5 ? was.height / now.height : 1
      const stretched = Math.abs(grow - 1) > 0.01
      if (Math.abs(dx) < 0.4 && Math.abs(dy) < 0.4 && !stretched) continue
      el.style.transition = 'none'
      el.style.transformBox = 'fill-box'
      el.style.transformOrigin = 'top center'
      el.style.transform = `translate(${dx}px, ${dy}px)` + (stretched ? ` scaleY(${grow})` : '')
      moved.push(el)
    }
    if (!moved.length) return

    // One reflow for the lot, so every gate starts travelling together.
    void preview.getBoundingClientRect()
    for (const el of moved) {
      el.style.transition = `transform ${flipMs}ms ease-out`
      el.style.transform = ''
    }
  }

  return {
    carryNew: (gate, event) => begin({ from: 'palette', gate }, event),
    press,
    beforeRender,
    afterRender,
    destroy: end,
  }
}

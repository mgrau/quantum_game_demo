<script lang="ts">
  /**
   * The circuit, and everything you can do to it with a finger.
   *
   * Almost none of this is ours. The drawing is `render`, the editing rules are
   * `circuit/edit`, and the drag between them is `createBoard` — lifted out of
   * the misty_states editor precisely so a second interface could have one. What
   * is left here is the four sentences that layer asks a host for: what is on
   * screen, what dropping would produce, write it, the carry changed.
   *
   * The one decision of our own is drawing the answer. Appending `out calculate`
   * asks the renderer to work out where the circuit leaves the register and draw
   * it underneath — so a player sees the state change as they build, which is
   * the whole pedagogical point and costs one line. It is attempted rather than
   * assumed: a half-built circuit often has no state to draw, and a picture is
   * better than an error.
   */
  import { onMount } from 'svelte'
  import { render } from 'misty-states/render'
  import { createBoard, type Board, type CarryState } from 'misty-states/ui'
  import { asDroppable, type Droppable, type Gate } from 'misty-states/kernel'
  import { chipSource } from '../lib/palette'
  import { toggleInputQubit, withinWidth, withRoom } from '../lib/circuit'

  interface Props {
    source: string
    onchange: (source: string) => void
    /** Draw the state the circuit produces, below it. */
    showState?: boolean
    /**
     * Let the input be turned over by clicking its qubits.
     *
     * For a puzzle that asks for an *operation*, which has to be right whatever
     * goes in: the player needs to try it on more than the one input they were
     * handed, and the drawn input is the obvious thing to reach for.
     */
    editableInput?: boolean
    /** How wide the register is allowed to be. The puzzle says, not the drag. */
    qubits: number
    /**
     * Play the circuit rather than draw it.
     *
     * The library animates a run for free — the qubits travel down the wires
     * and the gates work on them as they pass. It is the best thing it does,
     * and a solved puzzle is exactly the moment to spend it.
     */
    animate?: boolean
    /** Solved, for the ring that travels out of the board when it happens. */
    solved?: boolean
  }
  let {
    source,
    onchange,
    showState = true,
    editableInput = false,
    qubits,
    animate = false,
    solved = false,
  }: Props = $props()

  /** Every edit passes through here: inside the register, and re-slotted. */
  const settle = (text: string) => withRoom(withinWidth(text, qubits))

  let previewSource = $state<string | null>(null)
  let carry = $state<CarryState>({ carrying: null, at: null, removing: false })

  let previewEl = $state<HTMLElement | null>(null)
  let anchorEl = $state<HTMLElement | null>(null)
  let board: Board | null = null

  /** What is drawn: the drag's proposal while there is one, else the truth. */
  const shown = $derived(previewSource ?? source)

  type Drawing =
    | { ok: true; svg: string; geometry?: ReturnType<typeof render>['geometry']; qubits?: number }
    | { ok: false; message: string }

  function draw(text: string): Drawing {
    if (animate) {
      try {
        return { ok: true, ...render(`${text}\nanimate`) }
      } catch {
        // Not every circuit can be played — a phased state stops the travelling
        // picture. Fall through and draw it standing still.
      }
    }
    if (showState) {
      try {
        return { ok: true, ...render(`${text}\nout calculate`) }
      } catch {
        // No state to draw yet — a box, a measurement, terms that cancelled.
      }
    }
    try {
      return { ok: true, ...render(text) }
    } catch (err) {
      return { ok: false, message: (err as Error).message }
    }
  }

  const drawing = $derived(draw(shown))

  /**
   * The ring, restarted each time a puzzle goes from unsolved to solved.
   *
   * A CSS animation only plays when the class arrives, so it has to leave
   * again — otherwise a player who solves a level, breaks it and solves it once
   * more gets the celebration only the first time.
   */
  let ringing = $state(false)
  let wasSolved = false
  $effect(() => {
    const now = solved
    if (now && !wasSolved) {
      ringing = false
      requestAnimationFrame(() => (ringing = true))
      setTimeout(() => (ringing = false), 800)
    }
    wasSolved = now
  })

  /** The gate in hand, drawn as itself. */
  const ghost = $derived.by(() => {
    const held = carry.carrying
    if (!held) return null
    const drop: Droppable =
      held.from === 'palette' ? held.gate : asDroppable(held.gate as Gate)
    try {
      return render(chipSource(drop), { scale: 0.75 }).svg
    } catch {
      return null
    }
  })

  onMount(() => {
    board = createBoard({
      preview: () => previewEl,
      anchor: () => anchorEl,
      view: () =>
        drawing.ok
          ? { source: shown, geometry: drawing.geometry, qubits: drawing.qubits }
          : null,
      // Normalised on the way past, both times. The preview has to be the
      // drawing the commit will produce, or the figure would rearrange itself
      // the instant the gate was let go.
      onpreview: (edit) => (previewSource = edit ? settle(edit.source) : null),
      oncommit: (edit) => {
        previewSource = null
        onchange(settle(edit.source))
      },
      onchange: (state) => (carry = state),
    })
    return () => board?.destroy()
  })

  // The slide has to be measured either side of the swap, and `{@html}` puts the
  // new markup in between these two.
  $effect.pre(() => {
    shown
    board?.beforeRender()
  })
  $effect(() => {
    shown
    board?.afterRender()
  })

  /* -- Turning the input over --------------------------------------------- */

  /**
   * The drawn input qubits, in the order they were drawn.
   *
   * The renderer keys them — `state:in`, one element per qubit — which is a far
   * better handle than working out where they are: a key survives a change of
   * theme, of metrics, of zoom, and hitting an element is exact where hitting a
   * coordinate is a guess. Offered only when there is one element per wire,
   * which is the renderer's own way of saying the input is a plain row of
   * qubits rather than a misty state with no single qubit to turn over.
   */
  function inputQubits(): Element[] {
    if (!editableInput || !previewEl) return []
    const drawn = [...previewEl.querySelectorAll('[data-key="state:in"]')]
    return drawn.length === (drawing.ok ? drawing.qubits : 0) ? drawn : []
  }

  /**
   * Make each drawn input qubit a control in its own right.
   *
   * Listeners go on the qubits rather than on the pane, so a keyboard reaches
   * them: they are the things being operated, and something that can be clicked
   * but not tabbed to is a control only some people have. The markup is
   * replaced wholesale on every render, so this is redone each time rather than
   * set up once — and the effect's teardown lets the old elements go.
   */
  $effect(() => {
    shown
    editableInput

    const off = inputQubits().map((el, index) => {
      const node = el as HTMLElement
      node.style.cursor = 'pointer'
      node.tabIndex = 0
      node.setAttribute('role', 'button')
      node.setAttribute('aria-label', `Turn input qubit ${index + 1} over`)

      const toggle = () => {
        const next = toggleInputQubit(source, index)
        if (next) onchange(next)
      }
      const onkey = (event: KeyboardEvent) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        toggle()
      }
      node.addEventListener('click', toggle)
      node.addEventListener('keydown', onkey)
      return () => {
        node.removeEventListener('click', toggle)
        node.removeEventListener('keydown', onkey)
      }
    })
    return () => off.forEach((go) => go())
  })

  /** Pick a gate up off a palette. Called by the parent, which owns the palette. */
  export function carryNew(drop: Droppable, event: PointerEvent) {
    board?.carryNew(drop, event)
  }
</script>

<div class="relative flex h-full min-h-0 flex-col">
  <div
    bind:this={previewEl}
    onpointerdown={(event) => board?.press(event)}
    class="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-xl
           bg-[#fcfbf7] p-6 shadow-inner ring-1 ring-black/10 select-none
           [&_svg]:max-h-full [&_svg]:w-auto [&_svg]:max-w-full"
    class:ms-solved={ringing}
    class:ring-emerald-400={solved}
    role="application"
    aria-label="Circuit board"
  >
    <div bind:this={anchorEl} class="flex max-h-full items-center justify-center">
      {#if drawing.ok}
        {@html drawing.svg}
      {:else}
        <p class="max-w-sm text-center text-sm text-rose-700">{drawing.message}</p>
      {/if}
    </div>
  </div>

  {#if carry.carrying && carry.at && ghost}
    <div
      class="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-1/2 opacity-90
             drop-shadow-lg transition-opacity"
      class:opacity-40={carry.removing}
      style="left: {carry.at.x}px; top: {carry.at.y}px"
    >
      {@html ghost}
    </div>
  {/if}

  {#if carry.removing}
    <p class="absolute bottom-2 left-2 rounded bg-rose-600 px-2 py-1 text-xs text-white">
      Let go to remove
    </p>
  {/if}
</div>

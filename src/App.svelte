<script lang="ts">
  /**
   * The game: a level on the left, a circuit in the middle, the question on the
   * right.
   *
   * One string is the state of play. The board writes it when a gate is dropped,
   * the text pane writes it when it is typed into, and everything else — the
   * drawing, the verdict, the score — is derived from it. That is misty_states'
   * own arrangement rather than an idea of ours, and it is why "drag the gates
   * in" and "write the circuit out" are the same feature here instead of two
   * that have to be kept in step.
   */
  import { onDestroy, untrack } from 'svelte'
  import Board from './components/Board.svelte'
  import Palette from './components/Palette.svelte'
  import Goal from './components/Goal.svelte'
  import VerificationSweep from './components/VerificationSweep.svelte'
  import { LEVELS } from './lib/levels'
  import { paletteFor } from './lib/palette'
  import { verify, type TrialResult } from './lib/verify'
  import { inputOf, openingFor } from './lib/circuit'
  import { progress, record, solvedCount } from './lib/progress.svelte'
  import { audio, fanfare, pick, place, toggleSound } from './lib/sound.svelte'
  import type { Level } from './lib/level'
  import type { Droppable } from 'misty-states/kernel'

  const opening = (level: Level): string => openingFor(level)

  const initialLevel = LEVELS[0]
  const initialSource = progress[initialLevel.id]?.draft ?? opening(initialLevel)
  let level = $state<Level>(initialLevel)
  let source = $state(initialSource)
  let hintsShown = $state(0)
  let showText = $state(false)
  let showState = $state(true)
  let board = $state<Board | null>(null)

  const verdict = $derived(verify(level, source))
  const groups = $derived(
    paletteFor(
      level.palette,
      level.goal.kind === 'oracle'
        ? { slot: level.goal.slot, wires: level.goal.wires }
        : undefined,
    ),
  )

  /**
   * Playing the solved circuit back.
   *
   * Switched on the moment a puzzle is solved and off again by any edit —
   * a moving picture of a circuit that no longer produces the answer would be
   * celebrating the wrong thing.
   */
  let playing = $state(false)
  let verificationTrials = $state<TrialResult[]>([])
  let verificationChecked = $state(0)
  let verificationRunning = $state(false)
  let showCompletion = $state(false)
  let sequenceTimers: ReturnType<typeof setTimeout>[] = []

  function cancelSequence() {
    sequenceTimers.forEach(clearTimeout)
    sequenceTimers = []
    verificationRunning = false
    verificationTrials = []
    verificationChecked = 0
    showCompletion = false
  }

  function finishSequence() {
    verificationRunning = false
    fanfare()
    showCompletion = true
  }

  /**
   * A correct multi-case answer is not accepted behind the scenes. Each input
   * (or each possible sealed box) visibly passes in turn before the celebration.
   */
  function beginSequence(cases: TrialResult[]) {
    cancelSequence()
    playing = true
    verificationTrials = cases.length
      ? cases
      : [{ name: 'Target state', ok: true }]

    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const cadence = reduced ? 80 : 520

    if (verificationTrials.length === 1) {
      sequenceTimers.push(setTimeout(finishSequence, cadence))
      return
    }

    verificationRunning = true
    verificationTrials.forEach((_, index) => {
      sequenceTimers.push(
        setTimeout(() => {
          verificationChecked = index + 1
        }, cadence * (index + 1)),
      )
    })
    sequenceTimers.push(setTimeout(finishSequence, cadence * (verificationTrials.length + 1)))
  }

  let solvedBefore = verify(initialLevel, initialSource).solved
  $effect(() => {
    const now = verdict.solved
    if (now && !solvedBefore) {
      beginSequence(verdict.trials ?? [])
    }
    if (!now) {
      playing = false
      if (solvedBefore) cancelSequence()
    }
    solvedBefore = now
  })

  onDestroy(() => cancelSequence())

  function edited(next: string) {
    playing = false
    if (next !== source) place()
    source = next
  }

  // Saved on every change rather than on a button: a puzzle game that loses work
  // is not a puzzle game anybody plays twice.
  //
  // The write is untracked, and that is not a nicety. `record` reads the entry
  // it is about to replace — to keep the best score — so a tracked write would
  // make this effect depend on the very state it changes, and Svelte would run
  // it until it gave up. The dependencies are read deliberately above instead.
  $effect(() => {
    const id = level.id
    const text = source
    const result = verdict
    untrack(() => record(id, text, result))
  })

  function open(next: Level) {
    cancelSequence()
    playing = false
    const nextSource = progress[next.id]?.draft ?? opening(next)
    solvedBefore = verify(next, nextSource).solved
    level = next
    source = nextSource
    hintsShown = 0
  }

  function reset() {
    source = opening(level)
  }

  function carry(drop: Droppable, event: PointerEvent) {
    pick()
    board?.carryNew(drop, event)
  }

  const par = $derived(level.par)
  const stats = $derived(verdict.stats)
  const levelIndex = $derived(LEVELS.findIndex((item) => item.id === level.id))
  const nextLevel = $derived(LEVELS[levelIndex + 1])

  /**
   * An operator puzzle's input is a thing to experiment with, not part of the
   * question: the goal is checked over every input regardless of which one is
   * on screen, so turning one over costs the player nothing and shows them
   * what their circuit does. Every other kind of level is asked *from* its
   * input, and letting that be edited would be letting the question be edited.
   */
  const editableInput = $derived(level.goal.kind === 'operator')
  const shownInput = $derived(inputOf(source) ?? level.input)

  function continueDemo() {
    if (nextLevel) open(nextLevel)
    else open(LEVELS[0])
  }
</script>

<div class="flex h-screen flex-col bg-slate-900 text-slate-100">
  <header class="flex h-12 items-center gap-4 border-b border-slate-800 px-4">
    <div class="flex items-center gap-2">
      <span class="grid h-7 w-7 place-items-center rounded-lg bg-sky-400 font-mono text-sm font-bold text-slate-950">M</span>
      <h1 class="text-sm font-semibold tracking-wide text-slate-200">Misty</h1>
    </div>
    <span class="rounded-full border border-slate-700 px-2 py-0.5 text-[10px] font-semibold tracking-widest text-slate-400 uppercase">
      5-level demo
    </span>
    <div class="ml-auto flex items-center gap-3">
      <div class="h-1.5 w-24 overflow-hidden rounded-full bg-slate-800">
        <div
          class="h-full rounded-full bg-emerald-400 transition-all duration-500"
          style:width={`${(solvedCount() / LEVELS.length) * 100}%`}
        ></div>
      </div>
      <span class="text-xs text-slate-400">{solvedCount()} / {LEVELS.length} solved</span>
    </div>
  </header>

  <main class="flex min-h-0 flex-1">
    <!-- Levels and gates -->
    <aside class="flex w-64 shrink-0 flex-col gap-5 overflow-y-auto border-r border-slate-800 p-4">
      <section>
        <h2 class="mb-2 text-[11px] font-semibold tracking-widest text-slate-400 uppercase">
          Demo path
        </h2>
        <ol class="space-y-1">
          {#each LEVELS as item, index (item.id)}
            <li>
              <button
                type="button"
                onclick={() => open(item)}
                class="group flex w-full items-center gap-2 rounded-lg border border-transparent px-2 py-2 text-left transition hover:bg-slate-800 {item.id === level.id ? 'border-sky-400/20 bg-sky-400/10' : ''}"
              >
                <span
                  class="grid h-6 w-6 shrink-0 place-items-center rounded-full border text-[10px] font-semibold {progress[item.id]?.solved ? 'border-emerald-400/40 bg-emerald-400/15' : ''}"
                  class:text-emerald-300={progress[item.id]?.solved}
                  class:border-slate-700={!progress[item.id]?.solved}
                  class:text-slate-500={!progress[item.id]?.solved}
                >
                  {progress[item.id]?.solved ? '✓' : index + 1}
                </span>
                <span class="min-w-0">
                  <span class="block truncate text-xs" class:text-sky-200={item.id === level.id}>
                    {item.title}
                  </span>
                  <span class="block truncate text-[10px] text-slate-600">{item.concepts.join(' · ')}</span>
                </span>
              </button>
            </li>
          {/each}
        </ol>
      </section>

      <section>
        <h2 class="mb-2 text-[11px] font-semibold tracking-widest text-slate-400 uppercase">Gate tray</h2>
        <Palette {groups} oncarry={carry} />
        <p class="mt-2 text-[11px] leading-relaxed text-slate-500">
          Drag a gate onto the wires. Drag one off to the left to remove it, or
          click a controlled gate to move its target.
        </p>
      </section>
    </aside>

    <!-- The circuit -->
    <section class="flex min-w-0 flex-1 flex-col gap-3 p-4">
      <div class="flex items-baseline gap-3">
        <span class="font-mono text-xs text-sky-400">{String(levelIndex + 1).padStart(2, '0')}</span>
        <h2 class="text-lg font-semibold">{level.title}</h2>
        <div class="ml-auto flex items-center gap-3 text-xs text-slate-400">
          <label class="flex cursor-pointer items-center gap-1.5">
            <input type="checkbox" bind:checked={showState} class="accent-sky-500" />
            Show the state
          </label>
          <button
            type="button"
            onclick={() => (playing = !playing)}
            class="hover:text-slate-200"
            class:text-emerald-300={playing}
          >
            {playing ? '■ Stop' : '▶ Run'}
          </button>
          <button type="button" onclick={() => (showText = !showText)} class="hover:text-slate-200">
            {showText ? 'Hide' : 'Show'} text
          </button>
          <button type="button" onclick={reset} class="hover:text-slate-200">Reset</button>
          <button
            type="button"
            onclick={toggleSound}
            class="hover:text-slate-200"
            title={audio.on ? 'Sound on' : 'Sound off'}
            aria-label={audio.on ? 'Turn sound off' : 'Turn sound on'}
          >
            {audio.on ? '♪' : '♪̶'}
          </button>
        </div>
      </div>

      <div class="min-h-0 flex-1">
        <Board
          bind:this={board}
          {source}
          {showState}
          {editableInput}
          qubits={level.qubits}
          animate={playing}
          solved={verdict.solved}
          onchange={edited}
        />
      </div>

      {#if showText}
        <textarea
          bind:value={source}
          spellcheck="false"
          class="h-32 w-full resize-none rounded-lg border border-slate-700 bg-slate-950 p-3
                 font-mono text-xs text-slate-200 outline-none focus:border-sky-600"
        ></textarea>
      {/if}

      {#if verificationRunning}
        <VerificationSweep trials={verificationTrials} checked={verificationChecked} />
      {/if}

      <!-- The verdict -->
      <div
        class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm"
        class:bg-emerald-900={verdict.solved}
        class:text-emerald-100={verdict.solved}
        class:bg-slate-800={!verdict.solved}
      >
        {#key verdict.solved}
          <span class="text-lg leading-none" class:ms-pop={verdict.solved}>
            {verdict.solved ? '★' : '·'}
          </span>
        {/key}
        <div class="min-w-0">
          <p>{verdict.message}</p>
          {#each verdict.violations as problem (problem)}
            <p class="text-xs text-rose-300">{problem}</p>
          {/each}
        </div>
        {#if stats}
          <p class="ml-auto shrink-0 font-mono text-xs text-slate-400">
            {stats.gates} gate{stats.gates === 1 ? '' : 's'}, {stats.layers} deep
            {#if par}
              <span class="text-slate-500">
                (par {par.gates ?? '—'}{par.layers !== undefined ? `, ${par.layers}` : ''})
              </span>
            {/if}
          </p>
        {/if}
      </div>
    </section>

    <!-- The question -->
    <aside class="w-80 shrink-0 overflow-y-auto border-l border-slate-800 p-4">
      <Goal
        {level}
        {verdict}
        {hintsShown}
        step={levelIndex + 1}
        total={LEVELS.length}
        input={shownInput}
        {editableInput}
        onhint={() => hintsShown++}
      />
    </aside>
  </main>

  {#if showCompletion}
    <div class="fixed inset-0 z-50 grid place-items-center bg-slate-950/75 p-6 backdrop-blur-sm">
      <div
        class="ms-complete relative w-full max-w-md overflow-hidden rounded-2xl border border-emerald-300/30 bg-slate-900 p-6 text-center shadow-2xl shadow-emerald-950/60"
        role="dialog"
        aria-modal="true"
        aria-labelledby="complete-title"
      >
        <button
          type="button"
          onclick={() => {
            showCompletion = false
            playing = false
          }}
          class="absolute top-3 right-3 grid h-8 w-8 place-items-center rounded-full text-slate-500 hover:bg-slate-800 hover:text-white"
          aria-label="Close completion message"
        >×</button>
        <div class="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full bg-emerald-400/15 text-3xl text-emerald-300 ring-1 ring-emerald-300/30">
          ✓
        </div>
        <p class="mb-2 text-[11px] font-semibold tracking-[0.22em] text-emerald-300 uppercase">
          {nextLevel ? `Level ${levelIndex + 1} complete` : 'Demo complete'}
        </p>
        <h2 id="complete-title" class="text-2xl font-semibold text-white">
          {nextLevel ? level.title : 'You made a quantum algorithm.'}
        </h2>
        <p class="mt-2 text-sm leading-relaxed text-slate-400">
          {#if nextLevel}
            Every required test passed. Your circuit is saved.
          {:else}
            Five levels, from a single flip to one circuit that works across four hidden functions.
          {/if}
        </p>

        {#if nextLevel}
          <div class="my-5 rounded-xl bg-slate-800/70 p-3 text-left">
            <p class="text-[10px] font-semibold tracking-widest text-slate-500 uppercase">Next objective</p>
            <p class="mt-1 text-sm font-medium text-slate-200">{nextLevel.objective}</p>
          </div>
        {:else}
          <div class="my-5 flex justify-center gap-2" aria-label="Five levels completed">
            {#each LEVELS as _}
              <span class="h-2 w-8 rounded-full bg-emerald-400"></span>
            {/each}
          </div>
        {/if}

        <button
          type="button"
          onclick={continueDemo}
          class="w-full rounded-xl bg-sky-400 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-sky-300 focus:outline-none focus:ring-2 focus:ring-sky-200"
        >
          {nextLevel ? `Continue to level ${levelIndex + 2} →` : 'Review from level 1 →'}
        </button>
      </div>
    </div>
  {/if}
</div>

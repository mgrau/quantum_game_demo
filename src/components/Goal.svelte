<script lang="ts">
  /**
   * What the level asks for, and how close the circuit is.
   *
   * The target is drawn, not described. A state goal shows the state; an
   * operator goal shows the circuit the player has to reproduce, which is not a
   * spoiler — it is the specification, written in gates they were not given.
   */
  import { render } from 'misty-states/render'
  import { diracOf } from 'misty-states/kernel'
  import { finalState } from '../lib/circuit'
  import type { Level } from '../lib/level'
  import type { Verdict } from '../lib/verify'

  interface Props {
    level: Level
    verdict: Verdict
    hintsShown: number
    step: number
    total: number
    /** The input the board is currently showing, which may not be the level's. */
    input: string
    editableInput: boolean
    onhint: () => void
  }
  let { level, verdict, hintsShown, step, total, input, editableInput, onhint }: Props = $props()

  /**
   * What the target operation does to the input now on screen.
   *
   * The point of a changeable input is comparison: the player turns a qubit
   * over and wants to know what *should* come out, not just what does. Without
   * this the experiment tells them nothing they can act on.
   */
  const wanted = $derived.by(() => {
    if (level.goal.kind !== 'operator') return null
    try {
      return diracOf(finalState(level.goal.equals, input, level.qubits))
    } catch {
      return null
    }
  })

  const paragraphs = $derived(level.brief.trim().split(/\n\s*\n/))

  function drawn(source: string, options = {}): string {
    try {
      return render(source, options).svg
    } catch {
      return ''
    }
  }

  const target = $derived.by(() => {
    if (level.goal.kind === 'state') return drawn(level.goal.state)
    if (level.goal.kind === 'operator') return drawn(`qubits ${level.qubits}\n${level.goal.equals}`)
    return ''
  })

  const heading = $derived(
    level.goal.kind === 'operator'
      ? 'Target operation'
      : level.goal.kind === 'oracle'
        ? 'One circuit, four hidden boxes'
        : 'Target state',
  )

  const cases = $derived.by(() => {
    if (level.goal.kind === 'oracle') {
      return level.goal.trials.map((trial) => ({
        name: trial.name,
        result: verdict.trials?.find((result) => result.name === trial.name),
      }))
    }
    if (level.goal.kind === 'operator') {
      return Array.from({ length: 1 << level.qubits }, (_, index) => {
        const bits = index.toString(2).padStart(level.qubits, '0')
        const name = `Input |${bits}⟩`
        return { name, result: verdict.trials?.find((result) => result.name === name) }
      })
    }
    return []
  })

  const percent = (p: number) => `${(p * 100).toFixed(p * 100 % 1 ? 1 : 0)}%`
</script>

<div class="flex flex-col gap-4 text-sm">
  <div>
    <p class="mb-2 text-[10px] font-semibold tracking-[0.2em] text-slate-500 uppercase">
      Level {step} of {total}
    </p>
    <section class="rounded-xl border border-sky-400/20 bg-gradient-to-br from-sky-950 to-slate-800 p-4">
      <p class="mb-2 text-[10px] font-semibold tracking-[0.18em] text-sky-300 uppercase">
        Your objective
      </p>
      <h2 class="text-base font-semibold leading-snug text-white">{level.objective}</h2>
    </section>
  </div>

  <div class="rounded-lg bg-slate-800/60 p-3">
    <h3 class="mb-2 text-[11px] font-semibold tracking-widest text-slate-400 uppercase">
      {heading}
    </h3>

    {#if target}
      <div class="flex justify-center rounded bg-[#fcfbf7] p-3 [&_svg]:max-h-24 [&_svg]:w-auto">
        {@html target}
      </div>
    {:else if level.goal.kind === 'outcomes'}
      <ul class="space-y-1 font-mono text-xs text-slate-300">
        {#each Object.entries(level.goal.expect) as [bits, p] (bits)}
          <li class="flex justify-between gap-3">
            <span>{bits}</span><span class="text-sky-300">{percent(p)}</span>
          </li>
        {/each}
      </ul>
    {/if}

    {#if wanted || verdict.got}
      <dl class="mt-3 space-y-1 border-t border-slate-700 pt-2 text-xs">
        {#if wanted}
          <div class="flex gap-2">
            <dt class="shrink-0 text-slate-400">Should give</dt>
            <dd class="font-mono text-sky-300">{wanted}</dd>
          </div>
        {/if}
        {#if verdict.got}
          <div class="flex gap-2">
            <dt class="shrink-0 text-slate-400">Yours</dt>
            <dd class="font-mono text-slate-200">{verdict.got}</dd>
          </div>
        {/if}
      </dl>
    {/if}
  </div>

  {#if cases.length}
    <section class="rounded-xl border border-violet-400/20 bg-violet-950/25 p-3">
      <div class="mb-2 flex items-center gap-2">
        <span class="text-base" aria-hidden="true">∞</span>
        <h3 class="text-[11px] font-semibold tracking-widest text-violet-200 uppercase">
          Every case must pass
        </h3>
      </div>
      <p class="mb-3 text-[11px] leading-relaxed text-slate-400">
        {#if level.goal.kind === 'operator'}
          The grader reruns this same circuit from every possible input. Changing the
          input on the board is only a preview; it never changes the objective.
        {:else}
          The grader swaps each possible function into the sealed box and reruns your
          same circuit. You do not get to rebuild between tests.
        {/if}
      </p>
      <ul class="space-y-1.5 text-xs">
        {#each cases as item (item.name)}
          <li class="flex items-center gap-2 rounded-md bg-slate-900/35 px-2 py-1.5">
            <span
              class="w-4 text-center"
              class:text-emerald-400={item.result?.ok}
              class:text-slate-600={!item.result}
              class:text-rose-400={item.result && !item.result.ok}
            >
              {item.result ? (item.result.ok ? '✓' : '×') : '·'}
            </span>
            <span class="truncate text-slate-300">{item.name}</span>
            {#if item.result?.actual && item.result.expected}
              <span class="ml-auto truncate font-mono text-[10px] text-slate-500">
                {item.result.actual} / {item.result.expected}
              </span>
            {/if}
          </li>
        {/each}
      </ul>
      {#if editableInput}
        <p class="mt-3 rounded-md bg-sky-400/10 px-2 py-1.5 text-[11px] text-sky-200">
          Try it yourself: click the input qubit on the board to switch 0 ↔ 1.
        </p>
      {/if}
    </section>
  {/if}

  <div class="space-y-2 leading-relaxed text-slate-300">
    {#each paragraphs as para (para)}
      <p>{@html para.replace(/\*\*([^*]+)\*\*/g, '<strong class="font-semibold text-white">$1</strong>').replace(/`([^`]+)`/g, '<code class="rounded bg-slate-700/70 px-1 py-0.5 font-mono text-[0.85em] text-sky-200">$1</code>')}</p>
    {/each}
  </div>

  {#if level.hints.length}
    <div class="rounded-lg bg-slate-800/40 p-3">
      {#each level.hints.slice(0, hintsShown) as hint, i (i)}
        <p class="mb-2 text-xs leading-relaxed text-amber-200/80">{hint}</p>
      {/each}
      {#if hintsShown < level.hints.length}
        <button
          type="button"
          onclick={onhint}
          class="text-xs text-slate-400 underline underline-offset-2 hover:text-slate-200"
        >
          {hintsShown ? 'Another hint' : 'Stuck? Take a hint'}
        </button>
      {/if}
    </div>
  {/if}
</div>

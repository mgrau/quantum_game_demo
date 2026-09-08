<script lang="ts">
  import type { TrialResult } from '../lib/verify'

  interface Props {
    trials: TrialResult[]
    checked: number
  }

  let { trials, checked }: Props = $props()

  function caseClass(index: number): string {
    if (index < checked) return 'border-emerald-400/40 bg-emerald-400/10'
    if (index === checked) {
      return 'border-sky-300/70 bg-sky-400/10 shadow-lg shadow-sky-500/10'
    }
    return 'border-slate-700 bg-slate-900/30'
  }
</script>

<section
  class="ms-check-sweep rounded-xl border border-sky-400/25 bg-sky-950/70 px-4 py-3 shadow-lg shadow-sky-950/30"
  aria-live="polite"
  aria-label="Verifying circuit"
>
  <div class="mb-3 flex items-center gap-2">
    <span class="ms-scan-dot h-2 w-2 rounded-full bg-sky-300"></span>
    <p class="text-xs font-semibold tracking-[0.16em] text-sky-200 uppercase">
      Checking every case
    </p>
    <span class="ml-auto font-mono text-xs text-sky-300/70">
      {Math.min(checked + 1, trials.length)} / {trials.length}
    </span>
  </div>

  <div class="grid gap-2" style:grid-template-columns={`repeat(${Math.min(trials.length, 4)}, minmax(0, 1fr))`}>
    {#each trials as trial, index (trial.name)}
      <div
        class="rounded-lg border px-3 py-2 transition-all duration-300 {caseClass(index)}"
      >
        <div class="flex items-center gap-2">
          <span class="w-4 text-center text-sm" class:ms-spin={index === checked}>
            {index < checked ? '✓' : index === checked ? '◌' : '·'}
          </span>
          <span class="truncate text-xs" class:text-emerald-200={index < checked}>
            {trial.name}
          </span>
        </div>
        {#if index <= checked && trial.actual && trial.expected}
          <p class="mt-1 truncate pl-6 font-mono text-[10px] text-slate-400">
            {trial.input} → {trial.actual}
          </p>
        {/if}
      </div>
    {/each}
  </div>
</section>

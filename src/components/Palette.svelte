<script lang="ts">
  /**
   * The gates this level lets you use, each drawn as the gate it actually is.
   *
   * Pressing one starts a carry — there is no click-to-place. That is the
   * library's decision rather than ours and it is the right one: a controlled
   * gate needs to be aimed at two wires, and clicking cannot say where.
   */
  import { render } from 'misty-states/render'
  import type { Droppable } from 'misty-states/kernel'
  import type { PaletteGroup } from '../lib/palette'

  interface Props {
    groups: PaletteGroup[]
    oncarry: (drop: Droppable, event: PointerEvent) => void
  }
  let { groups, oncarry }: Props = $props()

  const swatch = (source: string): string => {
    try {
      return render(source, { scale: 0.62 }).svg
    } catch {
      return ''
    }
  }
</script>

<div class="flex flex-col gap-5">
  {#each groups as group (group.heading)}
    <section>
      <h3 class="mb-2 text-[11px] font-semibold tracking-widest text-slate-400 uppercase">
        {group.heading}
      </h3>
      <div class="grid grid-cols-3 gap-2">
        {#each group.items as item (item.id + item.name)}
          <button
            type="button"
            title={item.text ? `${item.name} — ${item.text}` : item.name}
            onpointerdown={(event) => {
              event.preventDefault()
              oncarry(item.drop, event)
            }}
            class="flex h-16 cursor-grab touch-none flex-col items-center justify-center gap-1
                   rounded-lg bg-[#fcfbf7] p-1 ring-1 ring-black/10 transition
                   hover:ring-sky-400 active:cursor-grabbing
                   [&_svg]:max-h-9 [&_svg]:w-auto"
          >
            {@html swatch(item.source)}
            <span class="text-[10px] leading-none text-slate-500">{item.id}</span>
          </button>
        {/each}
      </div>
    </section>
  {/each}
</div>

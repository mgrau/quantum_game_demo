/**
 * The gates a level offers.
 *
 * Taken from the library's own gallery rather than a list of our own, so a gate
 * added there arrives here, and the id a level writes is the id the drop uses.
 * Only the draggable entries: the gallery also holds examples that exist to be
 * read — a named link, a named target — and those are documentation, not moves.
 *
 * A window is always offered, whatever the level allows. It is a way of looking
 * at the computation rather than a thing done to it, it costs nothing in the
 * scoring, and a player who cannot see the state half way down a circuit is
 * being asked to do the arithmetic in their head.
 */

import { GATE_GALLERY, gateLine, type Droppable, type Swatch } from 'misty-states/kernel'

/** A gate's id: its keyword, with any angle taken off. */
export const idOf = (drop: Droppable): string => drop.head.replace(/\(.*\)$/, '').toUpperCase()

export interface PaletteItem {
  id: string
  name: string
  text?: string
  drop: Droppable
  /** A circuit that draws this gate on its own, for the swatch and the ghost. */
  source: string
}

export interface PaletteGroup {
  heading: string
  items: PaletteItem[]
}

/**
 * A gate drawn by itself.
 *
 * The swatch in the palette and the ghost that follows the pointer are the same
 * picture, and both are the real gate rather than a glyph standing in for it —
 * which is the whole reason a palette drawn by the renderer is worth having.
 */
export function chipSource(drop: Droppable): string {
  return `qubits ${Math.max(drop.wires, 1)}\n${gateLine(drop, 1, drop.wires)}`
}

const itemsOf = (swatches: Swatch[]): PaletteItem[] =>
  swatches
    .filter((s): s is Swatch & { drop: Droppable } => !!s.drop)
    .map((s) => ({
      id: idOf(s.drop),
      name: s.name,
      text: s.text,
      drop: s.drop,
      source: s.source ?? chipSource(s.drop),
    }))

/**
 * The gallery, cut down to what this level allows.
 *
 * The identity is never offered, whatever a level says. The board lays down its
 * own — a template of empty slots that a dropped gate fills — and normalises
 * them away on every edit, so one dragged in from here would vanish on landing.
 * A gate that visibly does nothing is worse than no gate at all.
 */
export function paletteFor(
  allow?: string[],
  /** The sealed box this level hands out, where it has one. */
  oracle?: { slot: string; wires: number },
): PaletteGroup[] {
  const wanted = allow && new Set(allow.map((id) => id.toUpperCase()))
  const groups = GATE_GALLERY.map((group) => ({
    heading: group.heading,
    items: itemsOf(group.items).filter(
      (item) =>
        // A box is never offered from the gallery. Where a level has one it is
        // *the* box, with a name and a width the level chose, and a second
        // anonymous one would only be a way of getting the answer wrong.
        item.id !== 'I' &&
        item.id !== 'BOX' &&
        item.id !== 'BLANK' &&
        (!wanted || wanted.has(item.id) || item.id === 'WINDOW'),
    ),
  })).filter((group) => group.items.length)

  if (!oracle) return groups

  const drop: Droppable = {
    head: 'box',
    wires: oracle.wires,
    label: `"${oracle.slot}"`,
    range: true,
  }
  return [
    {
      heading: 'The sealed box',
      items: [
        {
          id: 'BOX',
          name: oracle.slot,
          text: 'Nobody can see inside. Use it as few times as you can',
          drop,
          source: chipSource(drop),
        },
      ],
    },
    ...groups,
  ]
}

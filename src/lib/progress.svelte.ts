/**
 * What the player has done, kept between visits.
 *
 * Two things are worth remembering and they are remembered for different
 * reasons. A solved level is an achievement and keeps its best score. An
 * unsolved one keeps its half-built circuit, which is not an achievement at all
 * — it is the thing a player is most annoyed to lose when they click away to
 * look at another puzzle and come back.
 */

import type { Verdict } from './verify'

const STORE = 'quantum-game/progress'

export interface Record_ {
  solved: boolean
  /** Fewest gates, and the depth that came with them. */
  best?: { gates: number; layers: number }
  /** Whatever is on the board, solved or not. */
  draft?: string
}

type Progress = Record<string, Record_>

function load(): Progress {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STORE)
    return raw ? (JSON.parse(raw) as Progress) : {}
  } catch {
    // A corrupt or unreadable store is not worth a broken game.
    return {}
  }
}

export const progress = $state<Progress>(load())

function save() {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORE, JSON.stringify(progress))
  } catch {
    // Private browsing, a full quota. Play continues; only the memory is lost.
  }
}

/** Keep the circuit, and the score if this is the best one yet. */
export function record(id: string, source: string, verdict: Verdict): void {
  const was = progress[id] ?? { solved: false }
  const stats = verdict.stats
  const better =
    verdict.solved &&
    stats &&
    (!was.best ||
      stats.gates < was.best.gates ||
      (stats.gates === was.best.gates && stats.layers < was.best.layers))

  progress[id] = {
    solved: was.solved || verdict.solved,
    best: better ? { gates: stats!.gates, layers: stats!.layers } : was.best,
    draft: source,
  }
  save()
}

export const solvedCount = (): number => Object.values(progress).filter((r) => r.solved).length

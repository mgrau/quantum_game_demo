/**
 * Levels, as files.
 *
 * YAML for the same reason misty_states keeps its library in it: the field that
 * matters is a multi-line circuit, and a block scalar keeps it readable and
 * diffable. Validation is hand-written and its messages are addressed to whoever
 * wrote the file, because that is who will read them.
 *
 * Packs are gathered at build time. A level is content, not configuration —
 * there is no case for loading one over the network.
 */

import { load } from 'js-yaml'
import type { Goal, Level, Pack } from './level'

export class PackFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PackFormatError'
  }
}

type Raw = Record<string, unknown>

const bad = (where: string, what: string): never => {
  throw new PackFormatError(`${where}: ${what}`)
}

function text(raw: Raw, field: string, where: string): string {
  const v = raw[field]
  if (typeof v !== 'string' || !v.trim()) bad(where, `"${field}" is required and must be text`)
  return v as string
}

function optionalText(raw: Raw, field: string): string | undefined {
  const v = raw[field]
  return typeof v === 'string' ? v : undefined
}

function count(raw: Raw, field: string, where: string): number {
  const v = raw[field]
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) {
    bad(where, `"${field}" must be a whole number of at least 1`)
  }
  return v as number
}

function strings(raw: Raw, field: string, where: string): string[] | undefined {
  const v = raw[field]
  if (v === undefined || v === null) return undefined
  if (!Array.isArray(v) || v.some((s) => typeof s !== 'string')) {
    bad(where, `"${field}" must be a list of text`)
  }
  return v as string[]
}

/** A block of whole numbers — limits, par — where every key is optional. */
function numbers(raw: Raw, field: string, where: string): Record<string, number> | undefined {
  const v = raw[field]
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'object') bad(where, `"${field}" must be a mapping`)
  const out: Record<string, number> = {}
  for (const [key, value] of Object.entries(v as Raw)) {
    if (typeof value !== 'number' || value < 0) bad(where, `"${field}.${key}" must be a number`)
    out[key] = value as number
  }
  return out
}

function parseGoal(raw: unknown, where: string): Goal {
  if (!raw || typeof raw !== 'object') bad(where, '"goal" must be a mapping')
  const g = raw as Raw
  const kind = text(g, 'kind', `${where} goal`)

  if (kind === 'oracle') {
    const at = `${where} goal`
    if (!Array.isArray(g.trials) || !g.trials.length) {
      bad(at, 'an oracle goal needs a "trials" list')
    }
    return {
      kind,
      slot: text(g, 'slot', at),
      wires: count(g, 'wires', at),
      trials: (g.trials as unknown[]).map((raw, i) => {
        const trial = (raw ?? {}) as Raw
        const name = text(trial, 'name', `${at}, trial ${i + 1}`)
        return {
          name,
          // An empty circuit is a box that does nothing, which is a perfectly
          // good thing for a box to be — so it is allowed to be blank.
          circuit: optionalText(trial, 'circuit') ?? '',
          expect: text(trial, 'expect', `${at}, trial "${name}"`),
        }
      }),
    }
  }

  if (kind === 'state') return { kind, state: text(g, 'state', `${where} goal`) }
  if (kind === 'operator') return { kind, equals: text(g, 'equals', `${where} goal`) }
  if (kind === 'outcomes') {
    const expect = numbers(g, 'expect', `${where} goal`)
    if (!expect) bad(`${where} goal`, '"expect" is required for an outcomes goal')
    const total = Object.values(expect!).reduce((a, b) => a + b, 0)
    if (Math.abs(total - 1) > 1e-6) {
      bad(`${where} goal`, `the odds in "expect" add up to ${total}, not 1`)
    }
    const tolerance = g.tolerance
    return {
      kind,
      expect: expect!,
      tolerance: typeof tolerance === 'number' ? tolerance : undefined,
    }
  }
  return bad(
    `${where} goal`,
    `"${kind}" is not a kind of goal — use state, operator, outcomes or oracle`,
  )
}

function parseLevel(raw: unknown, where: string): Level {
  if (!raw || typeof raw !== 'object') bad(where, 'each level must be a mapping')
  const l = raw as Raw
  const id = text(l, 'id', where)
  const at = `${where} ("${id}")`
  const qubits = count(l, 'qubits', at)

  return {
    id,
    title: text(l, 'title', at),
    objective: text(l, 'objective', at),
    brief: text(l, 'brief', at),
    qubits,
    // The only honest reading of an unwritten input is every wire white.
    input: optionalText(l, 'input') ?? '0'.repeat(qubits),
    goal: parseGoal(l.goal, at),
    palette: strings(l, 'palette', at)?.map((g) => g.toUpperCase()),
    limits: numbers(l, 'limits', at),
    par: numbers(l, 'par', at),
    start: optionalText(l, 'start'),
    solution: text(l, 'solution', at),
    hints: strings(l, 'hints', at) ?? [],
    concepts: strings(l, 'concepts', at) ?? [],
  }
}

export function parsePack(source: string, where: string): Pack {
  let parsed: unknown
  try {
    parsed = load(source)
  } catch (err) {
    throw new PackFormatError(`${where}: not valid YAML — ${(err as Error).message}`)
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new PackFormatError(`${where}: the file is empty, or is not a YAML mapping`)
  }
  const doc = parsed as Raw
  if (!Array.isArray(doc.levels)) throw new PackFormatError(`${where}: expected a "levels" list`)

  const seen = new Set<string>()
  const levels = doc.levels.map((raw, i) => {
    const level = parseLevel(raw, `${where}, level ${i + 1}`)
    // Ids key saved progress, so a duplicate would quietly share a star.
    if (seen.has(level.id)) throw new PackFormatError(`${where}: duplicate level id "${level.id}"`)
    seen.add(level.id)
    return level
  })

  return {
    pack: text(doc, 'pack', where),
    title: text(doc, 'title', where),
    description: optionalText(doc, 'description'),
    story: optionalText(doc, 'story'),
    levels,
  }
}

// The demo is deliberately a five-level vertical slice. The longer curriculum
// remains beside it as source material, but it is not loaded or shipped.
const FILES = import.meta.glob('../levels/00-demo.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

/** Every pack, in filename order — which is why the files are numbered. */
export const PACKS: Pack[] = Object.entries(FILES)
  .sort(([a], [b]) => (a < b ? -1 : 1))
  .map(([path, source]) => parsePack(source, path.split('/').pop()!))

export const LEVELS: Level[] = PACKS.flatMap((pack) => pack.levels)

export const levelById = (id: string): Level | undefined => LEVELS.find((l) => l.id === id)

/**
 * Reading a player's circuit as something other than a drawing.
 *
 * The board hands us one string, because that is what misty_states edits: a
 * drop rewrites the text and the picture is made from the text, so there is one
 * representation and nothing to keep in step. Everything here is that string
 * read a different way — run from an input of our choosing, counted, or asked
 * which gates it uses.
 *
 * The one trick worth naming is `withInput`. The simulator takes its starting
 * state from the document's own `in` line, and a puzzle needs to run the same
 * circuit from inputs the player never wrote — every basis state, when the goal
 * is an operation rather than a destination. So the input is *written into the
 * source* before parsing, rather than passed alongside it. It costs a string
 * splice and a parse, both of which are microseconds, and it means the game
 * never holds a document in a state the notation could not express.
 */

import {
  afterRemoval,
  amplitudesOf,
  asDroppable,
  canonical,
  gateSpan,
  insertGate,
  parseCircuit,
  parseState,
  removeGate,
  simulate,
  type Amplitudes,
  type CircuitDoc,
  type Gate,
} from 'misty-states/kernel'

/**
 * Lines that say what a circuit *is about* rather than what it does.
 *
 * Stripped before an input of ours is written in, because they would either
 * fight with it — a second `in`, a stale `qubits` — or make a claim the
 * simulator would then be asked to settle. What the player wrote as an answer
 * is not evidence about whether the answer is right.
 */
const PREAMBLE = /^\s*(qubits|in|out|answer|tabulate|table|chart|plot|animate)\b/i

/** The player's circuit, run from a state they did not write. */
export function withInput(source: string, input: string, qubits: number): string {
  const body = source.split('\n').filter((line) => !PREAMBLE.test(line))
  return [`qubits ${qubits}`, `in ${input}`, ...body].join('\n')
}

/** A written state — `00|11` — as amplitudes. */
export function stateOf(text: string, qubits: number): Amplitudes {
  return amplitudesOf(parseState(text).rows[0], qubits)
}

/**
 * Whether two states are the same one.
 *
 * `canonical` divides out the common factor and fixes the overall phase, both
 * of which are unobservable — so `0|1`, `2*0|2*1` and `-0|-1` all compare
 * equal, which is exactly the equality a puzzle should be graded on.
 */
const shape = (amps: Amplitudes): string => JSON.stringify(canonical(amps))
export const statesEqual = (a: Amplitudes, b: Amplitudes): boolean => shape(a) === shape(b)

/** Where the circuit leaves the register, started from `input`. */
export function finalState(source: string, input: string, qubits: number): Amplitudes {
  const doc = parseCircuit(withInput(source, input, qubits))
  return simulate(doc, doc.layers.length)
}

/**
 * The whole operation, not just its answer to one question.
 *
 * A circuit is pinned down by what it does to each basis state, so running it
 * from every one of them and keeping the results side by side gives something
 * that can be compared as a whole. The columns are held in a single map keyed
 * by input-then-output, which matters: canonicalising *that* fixes one phase
 * across the entire operation, where canonicalising each column separately
 * would let every column choose its own and would call Z the same gate as the
 * identity.
 */
export function operationOf(source: string, qubits: number): Amplitudes {
  const out: Amplitudes = new Map()
  for (let i = 0; i < 1 << qubits; i++) {
    const basis = i.toString(2).padStart(qubits, '0')
    for (const [bits, amp] of finalState(source, basis, qubits)) {
      out.set(basis + bits, amp)
    }
  }
  return out
}

/** The Born rule, over a state the notation keeps unnormalised. */
export function probabilities(amps: Amplitudes): Map<string, number> {
  let total = 0
  const weight = new Map<string, number>()
  for (const [bits, amp] of amps) {
    const w = amp.re * amp.re + amp.im * amp.im
    weight.set(bits, w)
    total += w
  }
  const out = new Map<string, number>()
  for (const [bits, w] of weight) out.set(bits, total ? w / total : 0)
  return out
}

/* -- Where a level starts -------------------------------------------------- */

/**
 * How much bare pipe a level opens with.
 *
 * A circuit with no layers draws as a stub: the input and the output pressed
 * together, with nowhere to aim a gate and nothing much to see. A few
 * identities are the notation's own way of writing a length of pipe, so the
 * board opens looking like a circuit — input at the top, room in the middle,
 * the answer worked out underneath — and there is somewhere to drop. They cost
 * nothing: an identity does nothing to the state, and `statsOf` does not count
 * one as a move.
 */
export const ROOM = 3

/** An identity, however it was written: `I 1`, `id 1`, `identity 1`. */
const IDENTITY = /^(i|id|identity)\s+\d+$/i

/** The source with every identity taken out of it, and any line left empty gone. */
function stripped(source: string): string {
  return source
    .split('\n')
    .flatMap((line) => {
      const parts = line.split(';').map((part) => part.trim()).filter(Boolean)
      const real = parts.filter((part) => !IDENTITY.test(part))
      // Untouched unless this line actually held one, so an annotated line or
      // anything else the notation allows passes through exactly as written.
      if (real.length === parts.length) return [line]
      return real.length ? [real.join('; ')] : []
    })
    .join('\n')
}

/**
 * The circuit with its scaffolding re-formed underneath it.
 *
 * The pipe a level opens with is a *template*, not part of the circuit: empty
 * slots to aim at, which a dropped gate fills. So every edit is normalised —
 * the old identities come out, and a fresh run of them is laid below whatever
 * the player has actually built.
 *
 * Taking them out first is what makes gates pack side by side. An identity
 * occupies its wire, so a scheduler will not let anything share a layer with
 * one: leave them in and `H 1` and `H 2` can never be simultaneous, which is
 * precisely the lesson one of these levels exists to teach. Strip them and the
 * packer does what it always did.
 *
 * The template shortens as the circuit grows — three slots on an empty board,
 * never fewer than one — so there is always somewhere to drop without the
 * drawing growing a tail of dead pipe.
 */
export function withRoom(source: string, minLayers = ROOM): string {
  let qubits: number
  try {
    qubits = parseCircuit(source).qubits
  } catch {
    // Unparseable text belongs to whoever is typing it.
    return source
  }

  const body = stripped(source)
  let depth = 0
  try {
    depth = statsOf(parseCircuit(body)).layers
  } catch {
    depth = 0
  }

  const slot = Array.from({ length: qubits }, (_, i) => `I ${i + 1}`).join('; ')
  const room = Math.max(minLayers - depth, 1)
  return [body, ...Array.from({ length: room }, () => slot)].join('\n')
}

/** The circuit a level opens with: the register, its input, and room to work. */
export function openingFor(level: { qubits: number; input: string; start?: string }): string {
  return withRoom(
    [`qubits ${level.qubits}`, `in ${level.input}`, level.start?.trim()]
      .filter(Boolean)
      .join('\n'),
  )
}

/* -- Keeping the register the size the puzzle says ------------------------- */

/**
 * The source with any gate that overhangs the register pulled back inside it.
 *
 * A `qubits` line is a minimum, not a limit: name wire 3 and the register
 * becomes three wide. That is right for a drawing tool and wrong for a puzzle,
 * where the register is part of the question — and it happens by accident
 * constantly, because a two-wire gate dropped on the last wire reaches past the
 * end, and so does anything aimed beyond the right-hand edge.
 *
 * The gate is moved rather than refused. Dropping a controlled NOT on the last
 * wire obviously means "here, against the end", and a drop that silently does
 * nothing is the worst answer available. Only a gate too wide for the register
 * at all is dropped, because there is nowhere for it to go.
 *
 * Done with the library's own editing rules rather than by rewriting the text:
 * `asDroppable` says how the gate would be written, `removeGate` takes it out,
 * `afterRemoval` renumbers the place it was going, and `insertGate` puts it
 * back against the edge. Regular expressions over gate syntax would be a second
 * implementation of all four.
 */
export function withinWidth(source: string, width: number): string {
  let text = source

  // One gate is moved per pass. A handful of passes is far more than a single
  // edit can ever need, and it means a surprise cannot become a hang.
  for (let pass = 0; pass < 8; pass++) {
    let doc: CircuitDoc
    try {
      doc = parseCircuit(text)
    } catch {
      return text
    }
    if (doc.qubits <= width) return text

    const found = doc.layers.flatMap((layer, at) =>
      layer.gates.filter((gate) => gateSpan(gate)[1] > width).map((gate) => ({ gate, at })),
    )[0]
    if (!found) return text

    const cut = removeGate(text, doc, found.gate)
    if (!cut) return text

    const drop = asDroppable(found.gate)
    // Wider than the whole register: there is no position that would fit it.
    if (drop.wires > width) {
      text = cut.source
      continue
    }

    let reduced: CircuitDoc
    try {
      reduced = parseCircuit(cut.source)
    } catch {
      return text
    }
    const target = afterRemoval(
      { wire: width - drop.wires + 1, layer: found.at, where: 'in' },
      cut.layerRemoved,
    )
    text = insertGate(cut.source, reduced, target, drop).source
  }
  return text
}

/* -- The input, as something to poke -------------------------------------- */

/** The state written on the `in` line, if there is one. */
export function inputOf(source: string): string | null {
  const found = source.match(/^\s*in\s+(\S+)/m)
  return found ? found[1] : null
}

/**
 * The source with one input qubit turned over.
 *
 * Only where the input is a plain row of qubits. A misty input is a claim about
 * the puzzle — the state the circuit is asked to start from — and there is no
 * single qubit in it to turn over. Null says "not something to click", which is
 * how the board decides whether to offer it.
 */
export function toggleInputQubit(source: string, index: number): string | null {
  const lines = source.split('\n')
  const at = lines.findIndex((line) => /^\s*in\s+\S/.test(line))
  if (at < 0) return null

  const parts = lines[at].match(/^(\s*in\s+)([^\s#]+)(.*)$/)
  if (!parts || !/^[01]+$/.test(parts[2]) || index < 0 || index >= parts[2].length) return null

  const bits = [...parts[2]]
  bits[index] = bits[index] === '0' ? '1' : '0'
  return [
    ...lines.slice(0, at),
    `${parts[1]}${bits.join('')}${parts[3]}`,
    ...lines.slice(at + 1),
  ].join('\n')
}

/* -- The sealed box -------------------------------------------------------- */

/** Every box in the circuit bearing this name. */
export function oracleBoxes(doc: CircuitDoc, slot: string): Gate[] {
  return doc.layers
    .flatMap((layer) => layer.gates)
    .filter((gate) => gate.kind === 'box' && gate.label === slot)
}

/**
 * The circuit with real gates put in place of the sealed box.
 *
 * The box is a drawing — the simulator refuses one outright, which is exactly
 * right: nobody, including the player, can work out what a circuit does until
 * they know what is inside. So a trial answers that question by rewriting the
 * line, and the ordinary machinery runs on what comes out.
 *
 * Null where there is no single box to replace, or where it is sharing its line
 * with something else. The box spans the whole register in every puzzle that
 * uses one, so nothing can share its layer and the second case does not arise
 * in play — but a hand-typed circuit could reach it, and a wrong answer would
 * be worse than no answer.
 */
export function substituteOracle(source: string, slot: string, circuit: string): string | null {
  let doc: CircuitDoc
  try {
    doc = parseCircuit(source)
  } catch {
    return null
  }

  const boxes = oracleBoxes(doc, slot)
  if (boxes.length !== 1 || boxes[0].line === undefined) return null

  const lines = source.split('\n')
  const at = boxes[0].line - 1
  if (lines[at] === undefined) return null
  if (lines[at].split(';').filter((part) => part.trim()).length !== 1) return null

  const body = circuit.trim()
  return [
    ...lines.slice(0, at),
    ...(body ? body.split('\n') : []),
    ...lines.slice(at + 1),
  ].join('\n')
}

/* -- What the player built ------------------------------------------------ */

/**
 * The name a gate goes by, for matching against a level's allowed set.
 *
 * Taken from `asDroppable`, which is the library's own answer to "how would
 * this gate be written back out" — so the ids a level lists are the ones the
 * palette drops, and there is no second table of gate names to fall behind.
 * A rotation carries its angle in the head, which is not part of its identity.
 */
export function gateId(gate: Gate): string {
  return asDroppable(gate).head.replace(/\(.*\)$/, '').toUpperCase()
}

export interface Stats {
  /** Gates placed. A window is a way of looking, not a move, so it is free. */
  gates: number
  /** Depth: layers holding at least one real gate. */
  layers: number
  measurements: number
  /** Boxes placed — a query to the sealed box, where a level has one. */
  boxes: number
  /** Every distinct gate id used, for checking against the allowed set. */
  used: string[]
}

/**
 * A gate that counts.
 *
 * Two kinds do not. A window is a way of looking at the computation rather than
 * a thing done to it. An identity is a length of pipe — the board opens with a
 * few, so that a circuit has somewhere to be dropped and its answer has
 * somewhere to be drawn, and charging a player for scaffolding they were handed
 * would be absurd. Both draw; neither is a move.
 */
const REAL = (gate: Gate) => gate.kind !== 'view' && gate.kind !== 'identity'

export function statsOf(doc: CircuitDoc): Stats {
  const gates = doc.layers.flatMap((layer) => layer.gates).filter(REAL)
  return {
    gates: gates.length,
    layers: doc.layers.filter((layer) => layer.gates.some(REAL)).length,
    measurements: gates.filter((gate) => gate.kind === 'measure').length,
    boxes: gates.filter((gate) => gate.kind === 'box').length,
    used: [...new Set(gates.map(gateId))].sort(),
  }
}

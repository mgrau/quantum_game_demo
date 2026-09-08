/**
 * What a puzzle is.
 *
 * A level is a question about a circuit, and there are three kinds of question
 * worth asking. Two of them are the same shape as each other — run this and
 * compare — and the third is the one that teaches: not *reach this state* but
 * *perform this operation*, which cannot be satisfied by arranging gates until
 * one particular input comes out right.
 */

/**
 * One world the circuit has to work in.
 *
 * The player places a box they cannot see inside. A trial says what is really
 * in it, and what the circuit should therefore produce — so the same circuit is
 * run against every possibility and has to answer correctly in all of them.
 * That is what stops an oracle puzzle being solved by building the answer
 * directly: there is no single answer to build.
 */
export interface Trial {
  name: string
  /** What the box actually does. Empty is a box that does nothing. */
  circuit: string
  /** The state the whole register should be left in, if it really is this one. */
  expect: string
}

export type Goal =
  /** Reach this state from the level's input. Compared up to scale and phase. */
  | { kind: 'state'; state: string }
  /**
   * Perform this operation, whatever goes in.
   *
   * The reference is written as a circuit rather than a matrix, because a
   * matrix is not something a level author should have to type and not
   * something a player could be shown. Compared on every basis state at once.
   */
  | { kind: 'operator'; equals: string }
  /** Produce these odds. Keys are bit strings, values sum to one. */
  | { kind: 'outcomes'; expect: Record<string, number>; tolerance?: number }
  /**
   * Work for every possible contents of a sealed box.
   *
   * The player drops the box in like any other gate and builds around it. Each
   * trial substitutes real gates for it and checks what comes out, and the
   * puzzle is only solved when every trial passes at once.
   */
  | { kind: 'oracle'; slot: string; wires: number; trials: Trial[] }

export interface Limits {
  gates?: number
  layers?: number
  measurements?: number
  /** How many times the sealed box may be used. The whole game, usually once. */
  queries?: number
}

export interface Level {
  id: string
  title: string
  /** One direct sentence shown before any explanation: the thing to do now. */
  objective: string
  /** Markdown-ish prose shown in the goal pane. Blank lines separate paragraphs. */
  brief: string
  qubits: number
  /** The starting state, written in misty syntax. Defaults to all white. */
  input: string
  goal: Goal
  /** Allowed gate ids. Absent means everything the palette offers. */
  palette?: string[]
  limits?: Limits
  par?: { gates?: number; layers?: number }
  /** Circuit the board opens with. Usually empty. */
  start?: string
  /** Reference answer. Never shown; the level tests run it. */
  solution: string
  hints: string[]
  concepts: string[]
}

export interface Pack {
  pack: string
  title: string
  description?: string
  /** A few lines of framing, shown under the pack's heading in the list. */
  story?: string
  levels: Level[]
}

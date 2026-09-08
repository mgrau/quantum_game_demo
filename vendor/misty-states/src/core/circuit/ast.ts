/**
 * AST for vertical circuits. Time runs downward: qubits enter at the top and
 * fall through gates connected by pipes.
 */

import type { StateRow } from '../state/ast'
import type { ShapePick } from '../shapes'
import type { AnimationOptions } from './animate'

/** Single-qubit gate drawn as a labelled box on one pipe. */
export interface SingleGate {
  kind: 'single'
  label: string
  qubit: number
  /** Optional CSS colour for the label chip, e.g. Hadamard's red. */
  accent?: string
  /**
   * Degrees, for a rotation. `RZ(45)` is `label: 'RZ'`, `angle: 45`.
   *
   * Kept on the gate rather than folded into the label so the arithmetic can
   * read it and the drawing can set it apart from the letters.
   */
  angle?: number
}

/**
 * Identity: occupies a layer but does nothing to the qubit.
 *
 * Drawn as plain pipe rather than a body, so it reads as a length of pipe
 * connecting the layers above and below — which is exactly what it is. Its only
 * effect on the drawing is to hold a slot in the vertical rhythm.
 */
export interface IdentityGate {
  kind: 'identity'
  qubit: number
}

/** Controlled gate: filled dots on controls, a target glyph on the target. */
export interface ControlledGate {
  kind: 'controlled'
  controls: number[]
  target: number
  /** 'not' draws ⊕, otherwise the label sits in a chip on the target. */
  /**
   * `not` is the ⊕, `z` the filled dot, `label` puts the gate's name there —
   * and anything else is a mark of its own, drawn in a ring.
   */
  targetGlyph: 'not' | 'z' | 'label' | (string & {})
  /**
   * A name for what the gate does.
   *
   * Two placements, because the course uses two. On the target it replaces the
   * glyph, which is what a "Parity" gate wants; beside the link it names the
   * whole thing, which is what "Tiger?" wants. Which one is chosen by where the
   * quoted name is written, not by a second field.
   */
  label?: string
  /** True when the label names the link rather than standing on the target. */
  labelOnLink?: boolean
}

/** SWAP: an × on each of the two qubits, joined by a bar. */
export interface SwapGate {
  kind: 'swap'
  qubits: [number, number]
  /**
   * Control wires, where the swap only happens when they are all `1`.
   *
   * Empty for a plain SWAP; a single control is the Fredkin gate. Drawn as
   * filled dots on the same bar the × glyphs sit on, exactly as a controlled
   * gate draws its controls.
   */
  controls?: number[]
}

/** Measurement: a darker box with a meter dial and a basis label. */
export interface MeasureGate {
  kind: 'measure'
  qubit: number
  basis: string
}

/** Custom box spanning a contiguous range, e.g. an oracle. */
export interface BoxGate {
  kind: 'box'
  label: string
  qubits: number[]
  fill?: string
  /** Draw as an empty frame for students to fill in. */
  blank?: boolean
}

/**
 * A window onto the computation: the state of some qubits at this point.
 *
 * Not an operation — nothing happens here — but it occupies a layer of its own,
 * because a snapshot is a moment *between* gates rather than one of them. The
 * pipes it covers stop at it and resume below; qubits outside its span flow
 * straight past, which is what makes "identity here, look there" fall out with
 * no extra syntax.
 */
export interface ViewGate {
  kind: 'view'
  /** The contiguous run of qubits the state describes. */
  qubits: number[]
  /**
   * The states to show — usually one, but a measurement leaves several
   * possible outcomes, each drawn on its own row.
   */
  rows?: StateRow[]
  /** Written `calculate`: work the state out from the input and the gates above. */
  calculate?: boolean
  /**
   * Written `answer`: this is what the question asks for.
   *
   * The source holds the worked answer, so it can be checked; the drawing
   * hides it behind unknowns until the answer is asked for.
   */
  answer?: boolean
  /** Annotations for a state not yet worked out; a written one carries its own. */
  caption?: string
  note?: string
  /**
   * Draw the state inside a framed box plumbed into the circuit, rather than as
   * a break in it. The bare form reads as the computation laid open; the framed
   * form as an instrument fitted into the line.
   */
  boxed?: boolean
  /** Fill for the frame, when it should not be the default paper. */
  fill?: string
}

export type Gate = (
  | SingleGate | IdentityGate | ControlledGate | SwapGate | MeasureGate | BoxGate | ViewGate
) & {
  /**
   * The source line this was written on.
   *
   * Carried on the union rather than on each member because it means the same
   * thing for all of them. Nothing about drawing a circuit needs it; pointing
   * at one does — it is how a gate on the page is traced back to the text that
   * put it there.
   */
  line?: number
}

/** Every qubit a gate touches, used for layer packing and span width. */
export function gateQubits(gate: Gate): number[] {
  switch (gate.kind) {
    case 'single': return [gate.qubit]
    case 'identity': return [gate.qubit]
    case 'controlled': return [...gate.controls, gate.target]
    case 'swap': return [...(gate.controls ?? []), ...gate.qubits]
    case 'measure': return [gate.qubit]
    case 'box': return [...gate.qubits]
    case 'view': return [...gate.qubits]
  }
}

/** A gate occupies its full span, so nothing else may sit between its endpoints. */
export function gateSpan(gate: Gate): [number, number] {
  const qs = gateQubits(gate)
  return [Math.min(...qs), Math.max(...qs)]
}

export interface Layer {
  gates: Gate[]
  /** Annotations for the layer as a whole, drawn either side of it. */
  caption?: string
  note?: string
  /**
   * The source lines whose gates ended up here, in the order they arrived.
   *
   * A list, not a number, because a layer is not a line: `;` puts several gates
   * on one line and the packer puts several lines in one layer. Editing the
   * source from a position on the drawing needs the way back, and this is it.
   */
  lines: number[]
}

/**
 * A column of a table.
 *
 * `possibility` is the state itself, drawn; the other two are text worked out
 * from it. The header is English, which nothing else the renderer emits is, so
 * it can be overridden per column.
 */
export interface TableColumn {
  kind: 'possibility' | 'probability' | 'amplitude'
  header?: string
}

/**
 * One line of a table, worked out and ready to draw.
 *
 * The numbers arrive as text: how a likelihood is written is a presentation
 * choice made where the arithmetic is, alongside the one `calculate` already
 * makes, rather than something the layout has to know about.
 */
export interface TableLine {
  state: StateRow
  probability?: string
  amplitude: string
}

/** Written `tabulate`: the outcomes as a table rather than a stack of states. */
export interface TableSpec {
  columns: TableColumn[]
  caption?: string
  note?: string
  /** Filled in by `resolveCalculations`; absent until the circuit is run. */
  lines?: TableLine[]
}

/**
 * One bar of a chart.
 *
 * The numbers are normalised — a bar's height is a share of the whole state, so
 * it has to be on the scale where that means something, unlike the table's
 * amplitude column which shows the notation's own integers. The chance arrives
 * as text for the same reason a table's does: how a likelihood is written is
 * settled where the arithmetic is.
 */
export interface ChartBar {
  /** The basis state this bar stands over, drawn. */
  state: StateRow
  /** Signed, between -1 and 1. Absent after a measurement, which leaves none. */
  amplitude?: number
  /** Between 0 and 1. */
  probability: number
  /** That chance written out, for the bar's label. */
  label: string
}

/** Written `chart`: the state as a bar per basis state. */
export interface ChartSpec {
  /** Which quantity the bars stand for. */
  mode: 'amplitude' | 'probability'
  caption?: string
  note?: string
  /** Filled in by `resolveCalculations`; absent until the circuit is run. */
  bars?: ChartBar[]
  /** True once a measurement has left outcomes rather than a statevector. */
  measured?: boolean
  /** False when empty bars were dropped to keep the plot readable. */
  complete?: boolean
}

export interface CircuitDoc {
  kind: 'circuit'
  qubits: number
  layers: Layer[]
  /** Optional misty state drawn above the circuit. */
  input?: StateRow
  /**
   * The source line the input was written on.
   *
   * A gate dropped onto a circuit that has none yet has to go *after* the
   * state, not before it — and a bare state line looks like nothing in
   * particular until the parser has decided it is the input.
   */
  inputLine?: number
  /** Optional misty state drawn below the circuit; several after a measurement. */
  output?: StateRow[]
  /** Written `out calculate`: the output is worked out rather than given. */
  calculateOutput?: boolean
  /** Written `in calculate`: the input is worked out from a state written later. */
  calculateInput?: boolean
  calculateInputCaption?: string
  calculateInputNote?: string
  /** Annotations for that output, held until there is a state to hang them on. */
  calculateCaption?: string
  calculateNote?: string
  /** Written `tabulate`: drawn in place of an output state, below the circuit. */
  table?: TableSpec
  /**
   * True where an angle was written that the arithmetic cannot do exactly.
   *
   * Amplitudes are whole numbers, which is what keeps the odds exact ratios and
   * lets a state be written with an integer coefficient. A rotation by anything
   * other than a right angle leaves cosines in them, and everything downstream
   * that assumes wholeness — reducing by a common factor, exact odds, drawing a
   * coefficient — has to stand down.
   */
  inexact?: boolean
  /** Written `chart`: a bar chart of the state, drawn below the circuit. */
  chart?: ChartSpec
  /** Written `animate`: the state travels through the circuit rather than being drawn at each end. */
  animate?: AnimationOptions
  /** Written `answer` on the input or the output line. */
  answerInput?: boolean
  answerOutput?: boolean
  /** Per-wire shape override; defaults to position order. */
  shapePicks?: ShapePick[]
  /**
   * Draw the bare qubit shapes above the circuit. Off unless asked for, so a
   * circuit shows only what was specified; gates keep short input and output
   * pipe stubs either way, and a lone gate reads as a piece of plumbing.
   */
  header?: boolean
}

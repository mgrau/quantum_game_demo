/**
 * Every gate the notation has, as something to look at and something to drag.
 *
 * Shared, because it is read in two places that must not drift: the reference
 * draws each one beside the line that writes it, and the palette beside the
 * source box is the same set with the words taken away. One list, so a gate
 * cannot be offered in one and missing from the other.
 */

import type { Droppable } from './circuit/edit'

export interface GateGroup {
  heading: string
  items: Swatch[]
}

/** One gate drawn beside the line that draws it. */
export interface Swatch {
  code: string
  name: string
  /** Only where the picture does not already say it. */
  text?: string
  /** What to render, when the entry alone would not stand up as a circuit. */
  source?: string
  /**
   * How to write this gate onto an arbitrary wire.
   *
   * The `code` above is an example on particular wires, which is right for
   * reading and no use for dropping. This says what to write instead.
   */
  drop?: Droppable
}

export const GATE_GALLERY: GateGroup[] = [
  {
    heading: 'One wire',
    items: [
      { code: 'H 1', name: 'Hadamard', text: 'Splits a qubit into a superposition', drop: { head: 'H', wires: 1 } },
      { code: 'X 1', name: 'NOT', text: 'Drawn as a bare ⊕, as the course draws it', drop: { head: 'X', wires: 1 } },
      { code: 'Z 1', name: 'Z', text: 'Flips the sign of the black term', drop: { head: 'Z', wires: 1 } },
      { code: 'Y 1', name: 'Y', drop: { head: 'Y', wires: 1 } },
      { code: 'S 1', name: 'S', drop: { head: 'S', wires: 1 } },
      { code: 'T 1', name: 'T', drop: { head: 'T', wires: 1 } },
      { code: 'I 1', name: 'Identity', text: 'Plain pipe — holds a slot and does nothing', drop: { head: 'I', wires: 1 } },
    ],
  },
  {
    heading: 'Two or more wires',
    items: [
      { code: 'CNOT 1 2', name: 'Controlled NOT', source: 'qubits 2\nCNOT 1 2', drop: { head: 'CNOT', wires: 2 } },
      { code: 'CZ 1 2', name: 'Controlled Z', source: 'qubits 2\nCZ 1 2', drop: { head: 'CZ', wires: 2 } },
      { code: 'SWAP 1 2', name: 'Swap', source: 'qubits 2\nSWAP 1 2', drop: { head: 'SWAP', wires: 2 } },
      { code: 'TOFFOLI 1 2 3', name: 'Toffoli', source: 'qubits 3\nTOFFOLI 1 2 3', drop: { head: 'TOFFOLI', wires: 3 } },
      { code: 'CSWAP 1 2 3', name: 'Controlled swap', text: 'The Fredkin gate: swap two wires when the control is black', source: 'qubits 3\nCSWAP 1 2 3', drop: { head: 'CSWAP', wires: 3 } },
      {
        code: 'CNOT 1 2 "Tiger?"',
        name: 'Named link',
        source: 'qubits 2\nCNOT 1 2 "Tiger?"',
      },
      {
        // Across three wires rather than two: at swatch size a six-letter
        // name on the wire next door sits almost against the control dot.
        code: 'CNOT "Oracle" 1 3',
        name: 'Named target',
        source: 'qubits 3\nCNOT "Oracle" 1 3',
      },
    ],
  },
  {
    heading: 'Rotations',
    items: [
      {
        code: 'RX(90) 1',
        name: 'Rotation about X',
        text: 'Degrees. A right angle keeps every amplitude whole',
        drop: { head: 'RX(90)', wires: 1 },
      },
      { code: 'RY(90) 1', name: 'Rotation about Y', drop: { head: 'RY(90)', wires: 1 } },
      { code: 'RZ(90) 1', name: 'Rotation about Z', drop: { head: 'RZ(90)', wires: 1 } },
      {
        code: 'P(90) 1',
        name: 'Phase',
        text: 'A turn of the black half alone',
        drop: { head: 'P(90)', wires: 1 },
      },
    ],
  },
  {
    heading: 'Views',
    items: [
      {
        code: 'calculate',
        name: 'Calculated state',
        text: 'The state at this point, worked out from the input and the gates above it',
        source: 'qubits 2\nview ??',
        // Not on a wire: a view is a break across all of them, and what it
        // shows is worked out from the gates above it. Dropped rather than
        // typed, this is the question anyone reading a circuit asks — what is
        // the state *here* — answered in place.
        drop: { head: 'view', wires: 1, shows: 'calculate' },
      },
      {
        code: 'window calculate',
        name: 'Window',
        text: 'The same state, framed and plumbed into the circuit rather than breaking it',
        source: 'qubits 2\nwindow ??',
        drop: { head: 'window', wires: 1, shows: 'calculate' },
      },
    ],
  },
  {
    heading: 'Boxes',
    items: [
      { code: 'box "U" 1-2', name: 'Custom box', source: 'qubits 2\nbox "U" 1-2', drop: { head: 'box', wires: 2, label: '"U"', range: true } },
      { code: 'blank 1-2', name: 'Blank', text: 'For students to fill in', source: 'qubits 2\nblank 1-2', drop: { head: 'blank', wires: 2, range: true } },
      { code: 'measure 1 Z', name: 'Measurement', source: 'qubits 1\nmeasure 1 Z', drop: { head: 'measure', wires: 1, tail: 'Z' } },
    ],
  },
]

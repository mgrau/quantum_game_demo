export interface Example {
  id: string
  title: string
  note: string
  source: string
}

export const EXAMPLES: Example[] = [
  {
    id: 'basics',
    title: 'Basic superposition',
    note: 'A bare "|" makes a cloud — no parentheses needed.',
    source: '0|1',
  },
  {
    id: 'two-qubit',
    title: 'Two-qubit entangled state',
    note: 'Position sets the shape: first qubit circle, second square.',
    source: '00|11',
  },
  {
    id: 'coefficients',
    title: 'Weighted amplitudes',
    note: '(3|0⟩+2|1⟩)/√13, written either by repetition or with coefficients.',
    source: '0|0|0|1|1\n3*0|2*1',
  },
  {
    id: 'rule1',
    title: 'Rule 1 — term order does not matter',
    note: '',
    source: '00|01 = 01|00',
  },
  {
    id: 'rule2',
    title: 'Rule 2 — opposite amplitudes cancel',
    note: '',
    source: '0|1|-1 = 0',
  },
  {
    id: 'rule3',
    title: 'Rule 3 — repeated terms reduce',
    note: '',
    source: '0|1|0|1 = 0|1',
  },
  {
    id: 'rule4',
    title: 'Rule 4 — nested clouds flatten',
    note: 'Clouds can sit inside clouds to any depth.',
    source: '(0|1)|(0|1) = 0|1|0|1',
  },
  {
    id: 'rule5',
    title: 'Rule 5 — a common qubit factors out',
    note: 'A bare qubit can sit beside a cloud.',
    source: '00|01 = 0(0|1)',
  },
  {
    id: 'rule6',
    title: 'Rule 6 — adjacent clouds distribute',
    note: '',
    source: '(0|1)(0|-1) = 00|-01|10|-11',
  },
  {
    id: 'ps5-1',
    title: 'PS5 §1 — separable vs entangled',
    note: 'The three-qubit state, then its factored form.',
    source: '000|-111|110|-001\n(00|11)(0|-1)',
  },
  {
    id: 'ps5-collapse',
    title: 'PS5 §1.3 — measuring the circle qubit',
    note: 'A colon before the state annotates the left, a colon after it the right.',
    source: '50%: 00(0|-1) : measured white\n50%: 11(0|-1) : measured black',
  },
  {
    id: 'ps5-collapse-2',
    title: 'PS5 §1.4 — measuring the triangle qubit',
    note: '',
    source: '50%: (00|11)0\n50%: (00|11)1',
  },
  {
    id: 'shape-line',
    title: 'Naming the register',
    note: 'One character per shape: o s ^ d v * p h. Works in states and circuits alike.',
    source: 'shape s^o\n010\n(01|10)0',
  },
  {
    id: 'mystery',
    title: 'Unknown values',
    note: 'Each "?" is one unknown qubit. Quoted text inside a cloud says the rest is unknown.',
    source: '0?1\n("???")',
  },
  /* -- Circuits: reading one ---------------------------------------------- */

  {
    id: 'lone-gate',
    title: 'Circuit — a gate on its own',
    note: 'Time runs downward. With nothing else written, a gate draws with short stubs of pipe at either end.',
    source: 'CNOT 1 2',
  },
  {
    id: 'ghz',
    title: 'Circuit — entanglement generator (PS5 §2)',
    note: '"header on" labels the columns with their shapes. The arrow in a controlled gate is optional — the last wire is the target either way.',
    source: [
      'qubits 3',
      'header on',
      'H 3',
      'CNOT 3 -> 2',
      'CNOT 2 -> 1',
      'out 000|111',
    ].join('\n'),
  },
  {
    id: 'layers',
    title: 'Circuit — layers and shorthand',
    note: 'Gates pack sideways into the earliest layer that is free. "HZX" is one letter per wire; ";" pins gates into the same layer; "---" forces a new one.',
    source: [
      'qubits 3',
      'HZX',
      'H 1; X 3',
      '---',
      'CNOT 1 -> 2',
    ].join('\n'),
  },
  {
    id: 'zoo',
    title: 'Circuit — gate zoo',
    note: 'Swap, Toffoli, controlled-Z and a measurement. Z, S and T share a colour that lightens as the turn gets smaller, so T·T = S is legible before the letters are read.',
    source: [
      'qubits 4',
      'header on',
      'H 1; S 2; T 3',
      'SWAP 1 2',
      'TOFFOLI 1 2 -> 4',
      'CZ 2 3',
      'measure 4 X',
    ].join('\n'),
  },
  {
    id: 'named-gates',
    title: 'Circuit — naming a controlled gate',
    note: 'Position decides what a quoted name means: before the wires it stands on the target in place of the ⊕, after them it labels the link.',
    source: [
      'qubits 3',
      'header on',
      'CNOT "Parity" 1 3',
      '---',
      'CNOT 2 3 "Tiger?"',
    ].join('\n'),
  },

  /* -- Circuits: states along the way ------------------------------------- */

  {
    id: 'views',
    title: 'Circuit — following the state through',
    note: 'A state line is the input above the gates, the output below, and a view in between.',
    source: [
      '001',
      'SWAP 2 3',
      'after the swap: 010',
      'CNOT 2 -> 1; X 3',
      '111',
    ].join('\n'),
  },
  {
    id: 'partial-view',
    title: 'Circuit — a view of some of the qubits',
    note: '"view 2-3" covers two wires; "I 1 0" holds the third and shows what it has.',
    source: [
      'qubits 3',
      'H 2',
      'CNOT 2 -> 3',
      'view 2-3 00|11; I 1 0',
      'measure 1 Z',
    ].join('\n'),
  },
  {
    id: 'window',
    title: 'Circuit — a framed window',
    note: '"window" frames the state in a box plumbed into the circuit, rather than breaking it.',
    source: [
      '001',
      'SWAP 2 3',
      'window 010',
      'CNOT 2 -> 1; X 3',
      '111',
    ].join('\n'),
  },

  /* -- Circuits: working it out -------------------------------------------- */

  {
    id: 'calculate',
    title: 'Circuit — work the state out',
    note: '"calculate" computes the state from the input and the gates above it. Settings chooses factored or flat.',
    source: [
      'in 000',
      'H 1',
      'after the Hadamard: calculate',
      'CNOT 1 -> 2',
      'CNOT 2 -> 3',
      'out calculate',
    ].join('\n'),
  },
  {
    id: 'backwards',
    title: 'Circuit — work the input back',
    note: 'Every gate here is its own inverse, so a circuit reads backwards as well as forwards. "in calculate" finds the input from a state written further down — which is the question half of most exercises.',
    source: [
      'in calculate',
      'SWAP 2 3',
      'CNOT 2 -> 1',
      '110',
    ].join('\n'),
  },
  {
    id: 'measure-calculate',
    title: 'Circuit — calculated measurement outcomes',
    note: 'A measurement leaves several possible states; "calculate" draws them all with their odds. Settings switches those between a percentage and an exact fraction.',
    source: [
      'in 00',
      'H 1',
      'CNOT 1 -> 2',
      'measure 1 Z; measure 2 Z',
      'out calculate',
    ].join('\n'),
  },
  {
    id: 'answer',
    title: 'Circuit — a question and its answer',
    note: '"answer" hides what the question asks for behind ???. The button above the drawing shows it, and the checker settles it either way — so the question and its solution are one document that cannot drift apart.',
    source: [
      'in 01',
      'H 1',
      'CNOT 1 -> 2',
      'answer',
    ].join('\n'),
  },

  /* -- Circuits: other ways to read a state -------------------------------- */

  {
    id: 'tabulate',
    title: 'Circuit — outcomes as a table',
    note: 'The repeated terms make the amplitudes 2 and 3, so the outcomes are not equally likely. Columns are drawn in the order they are written.',
    source: [
      'in 0|0|1|1|1',
      'measure 1 Z',
      'tabulate(possibility, amplitude, probability)',
    ].join('\n'),
  },
  {
    id: 'chart',
    title: 'Circuit — amplitudes as a plot',
    note: 'Every basis state gets a bar, empty ones included — a term that has cancelled is a bar that is not there, which is what makes interference visible. Blue above the axis, red below, deepening with the size of the term.',
    source: [
      'in 00',
      'H 1',
      'H 2',
      'CZ 1 2',
      'amplitude',
    ].join('\n'),
  },
  {
    id: 'probability',
    title: 'Circuit — chances as a plot',
    note: 'The same plot without the signs, and deliberately uncoloured: colour is the sign said twice, and a chance has no sign.',
    source: [
      'in 000',
      'H 1',
      'H 2',
      'CNOT 1 -> 3',
      'probability',
    ].join('\n'),
  },
  {
    id: 'rotate',
    title: 'Circuit — turning by a chosen angle',
    note: 'Angles are in degrees; also RX, RY and P. A right angle keeps every amplitude whole — RZ(90) is S — so the state still draws. An odd one leaves cosines, which no misty state has a mark for, so chart it or write it out instead.',
    source: [
      'in 0',
      'RY(30) 1',
      'probability',
    ].join('\n'),
  },
  {
    id: 'phase',
    title: 'Circuit — a quarter turn of phase',
    note: 'S turns the black half a quarter, which the notation writes as an "i" in front of the term. Two of them make a Z, and the phase disappears again.',
    source: [
      'in 0',
      'H 1',
      'S 1',
      'out calculate',
    ].join('\n'),
  },

  /* -- Watching it happen --------------------------------------------------- */

  {
    id: 'animate',
    title: 'Animation — watch it happen',
    note: 'The qubits travel down the wires and the gate goes clear as it acts on them. Settings can close the gates instead, so qubits go in and qubits come out.',
    source: ['in 11', 'CNOT 1 -> 2', 'animate'].join('\n'),
  },
  {
    id: 'animate-terms',
    title: 'Animation — linearity, one term at a time',
    note: 'A superposition goes through a gate one term at a time and the results are added up: two land on white and make 2, two land on black and cancel.',
    source: ['in 0|1', 'H 1', 'animate'].join('\n'),
  },

  /* -- Setting an exercise -------------------------------------------------- */

  {
    id: 'oracle',
    title: 'Exercise — an oracle box',
    note: 'A custom box spans a range of wires and takes a fill colour. What it does is not said, which is the point of an oracle.',
    source: [
      'qubits 2',
      'header on',
      'H 1; H 2',
      'box "Oracle" 1-2 fill=#e3efe3',
      '---',
      'measure 1; measure 2',
    ].join('\n'),
  },
  {
    id: 'blank',
    title: 'Exercise — fill in the blank',
    note: '"blank" draws an empty frame for a student to complete, and "???" stands in for a state they are asked to find.',
    source: ['qubits 2', 'in ("???")', 'blank 1-2', 'out 00|11'].join('\n'),
  },
]

export const DEFAULT_EXAMPLE = EXAMPLES.find((e) => e.id === 'ps5-1')!

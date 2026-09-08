/**
 * What the notation *means*, for something that is not this editor.
 *
 * There are three ways in. `index.ts` draws — give it text, get an SVG, and
 * that is the whole of it. `api.ts` is the same thing made convenient, for a
 * script tag. This one is neither: it hands over the parser, the simulator and
 * the editing rules, for an application that wants to know what a circuit does
 * rather than what it looks like — a game that has to decide whether the player
 * reached the right state, and to place a gate when they drag one.
 *
 * Nothing here is new. It is exactly the modules underneath, gathered, and it
 * exists so that a consumer has one import to write and this repo has one list
 * to think about before renaming anything. Reaching past it into
 * `circuit/simulate` will work and will break without warning; what is named
 * here will not.
 */

export { parseCircuit } from './circuit/parse'
// `ParseError` is thrown by both parsers and defined beside the state one.
export { parseState, ParseError } from './state/parse'
export type { CircuitDoc, Gate, Layer, ViewGate } from './circuit/ast'
export type { StateDoc, StateRow } from './state/ast'
export { gateQubits, gateSpan } from './circuit/ast'

export {
  simulate,
  simulateBranches,
  amplitudesOf,
  canonical,
  stateFrom,
  diracOf,
  tabulate,
  chartBars,
  traceGate,
  oddsLabel,
  SimulationError,
} from './circuit/simulate'
export type { Amplitudes, Branch, Contribution } from './circuit/simulate'

export { checkCircuit, checkState } from './check'
export type { Check } from './check'

// The editing rules whole: what a drop lands on, what it writes, what a move
// or a removal does to the source. All of it is pure, and all of it is what a
// second application would otherwise write again.
export * from './circuit/edit'

export { GATE_GALLERY } from './gates'
export type { GateGroup, Swatch } from './gates'

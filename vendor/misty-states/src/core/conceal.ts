/**
 * Hiding the answer.
 *
 * A figure that poses a question and a figure that answers it are the same
 * drawing with some states blanked out, so the source keeps the answer and the
 * drawing hides it. That way round is the useful one: the checker can settle a
 * stored answer, and it cannot drift from the question, because there is only
 * one document.
 *
 * What replaces a hidden state is what the course writes — `???`, one unknown
 * per wire — so the question looks exactly as it did when the two were separate
 * figures.
 *
 * Annotations are treated by where they came from. One the author wrote is a
 * label — "after the swap" is context, not answer — and stays. One `calculate`
 * produced is the odds, which are half of what a measurement question is
 * asking, so it goes with the state.
 */

import type { CircuitDoc, ViewGate } from './circuit/ast'
import type { StateDoc, StateRow } from './state/ast'
import { productWidth } from './state/ast'

/** `???` as wide as the state it stands in for. */
function unknown(width: number, from: StateRow, keepLabel: boolean): StateRow {
  const side = from.sides[0]
  return {
    sides: [{
      factors: Array.from({ length: Math.max(1, width) }, () => ({
        kind: 'qubit' as const,
        value: 'unknown' as const,
      })),
      caption: keepLabel ? side?.caption : undefined,
      note: keepLabel ? side?.note : undefined,
    }],
    relations: [],
  }
}

const hide = (rows: StateRow[], width: number, keepLabel: boolean): StateRow[] =>
  rows.map((row) => unknown(width || productWidth(row.sides[0]), row, keepLabel))

/** True when anything in the document is marked as the answer. */
export function hasAnswer(doc: CircuitDoc | StateDoc): boolean {
  if (doc.kind === 'state') return doc.rows.some((r) => r.answer)
  return (
    !!doc.answerInput ||
    !!doc.answerOutput ||
    doc.layers.some((l) => l.gates.some((g) => g.kind === 'view' && (g as ViewGate).answer))
  )
}

/**
 * The same document with every answer replaced by unknowns.
 *
 * Run *after* `calculate` has been worked out, so `answer out calculate` knows
 * how wide it is — and so the checker, which reads the unconcealed document,
 * still has something to settle.
 */
export function conceal(doc: CircuitDoc): CircuitDoc {
  if (!hasAnswer(doc)) return doc
  return {
    ...doc,
    input: doc.answerInput && doc.input
      ? unknown(doc.qubits, doc.input, true)
      : doc.input,
    output: doc.answerOutput && doc.output
      ? hide(doc.output, doc.qubits, !doc.calculateOutput)
      : doc.output,
    layers: doc.layers.map((layer) => ({
      ...layer,
      gates: layer.gates.map((gate) => {
        if (gate.kind !== 'view' || !gate.answer || !gate.rows?.length) return gate
        // A view of some of the wires is only as wide as the wires it covers.
        return { ...gate, rows: hide(gate.rows, gate.qubits.length, !gate.calculate) }
      }),
    })),
  }
}

/** The same, for a document that is nothing but states. */
export function concealState(doc: StateDoc): StateDoc {
  if (!hasAnswer(doc)) return doc
  return {
    ...doc,
    rows: doc.rows.map((row) =>
      row.answer ? unknown(productWidth(row.sides[0]), row, true) : row,
    ),
  }
}

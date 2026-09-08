/**
 * Laying out a table of outcomes.
 *
 * Every measurement figure in the course pairs its circuit with a
 * *Possibility / Probability* table, and this is that table. It is a block of
 * cells rather than part of the drawing: a state in a cell is centred on its
 * cell, **not** over the circuit's pipe columns, which is the one thing that
 * makes this different from laying out an ordinary row of states.
 *
 * The grid is drawn as rules rather than as bordered cells so that neighbours
 * share a stroke instead of doubling it.
 */

import type { TableColumn, TableLine } from './ast'
import type { StateRow } from '../state/ast'
import { layoutState } from '../state/layout'
import type { Layout, Metrics, Prim } from '../render/primitives'
import { textWidth, translatePrims } from '../render/primitives'
import type { ShapeName } from '../shapes'

export interface TableLayoutOptions {
  metrics: Metrics
  shapeOrder?: ShapeName[]
}

/** Space between a cell's contents and its rules. */
const PAD_X = 14
const PAD_Y = 8

const DEFAULT_HEADERS: Record<TableColumn['kind'], string> = {
  possibility: 'Possibility',
  probability: 'Probability',
  amplitude: 'Amplitude',
}

const headerOf = (col: TableColumn) => col.header ?? DEFAULT_HEADERS[col.kind]

/** What goes in one cell: a drawn state, or a piece of text. */
type Cell =
  | { kind: 'state'; layout: Layout }
  | { kind: 'text'; text: string; bold?: boolean }

function cellFor(col: TableColumn, line: TableLine, opts: TableLayoutOptions): Cell {
  switch (col.kind) {
    case 'possibility':
      return { kind: 'state', layout: stateCell(line.state, opts) }
    case 'probability':
      return { kind: 'text', text: line.probability ?? '' }
    case 'amplitude':
      return { kind: 'text', text: line.amplitude }
  }
}

function stateCell(row: StateRow, opts: TableLayoutOptions): Layout {
  return layoutState(
    { kind: 'state', rows: [row] },
    { metrics: opts.metrics, shapeOrder: opts.shapeOrder },
  )
}

const cellWidth = (cell: Cell, m: Metrics) =>
  cell.kind === 'state' ? cell.layout.box.w : textWidth(cell.text, m.fontSize, cell.bold)

const cellHeight = (cell: Cell, m: Metrics) =>
  cell.kind === 'state' ? cell.layout.box.h : m.fontSize

/**
 * Lay the table out with its top-left corner at the origin.
 *
 * The caller translates it into place, the same way a state is placed.
 */
export function layoutTable(
  lines: TableLine[],
  columns: TableColumn[],
  opts: TableLayoutOptions,
): Layout {
  const m = opts.metrics

  const head: Cell[] = columns.map((col) => ({
    kind: 'text',
    text: headerOf(col),
    bold: true,
  }))
  const body: Cell[][] = lines.map((line) => columns.map((col) => cellFor(col, line, opts)))
  const grid = [head, ...body]

  const widths = columns.map((_, c) =>
    Math.max(...grid.map((row) => cellWidth(row[c], m))) + 2 * PAD_X,
  )
  const heights = grid.map((row) => Math.max(...row.map((cell) => cellHeight(cell, m))) + 2 * PAD_Y)

  const edges = widths.reduce<number[]>((xs, w) => [...xs, xs[xs.length - 1] + w], [0])
  const rules = heights.reduce<number[]>((ys, h) => [...ys, ys[ys.length - 1] + h], [0])
  const w = edges[edges.length - 1]
  const h = rules[rules.length - 1]

  const prims: Prim[] = []

  grid.forEach((row, r) => {
    const cy = rules[r] + heights[r] / 2
    row.forEach((cell, c) => {
      const cx = edges[c] + widths[c] / 2
      if (cell.kind === 'state') {
        const { box } = cell.layout
        prims.push(
          ...translatePrims(cell.layout.prims, cx - (box.x + box.w / 2), cy - (box.y + box.h / 2)),
        )
      } else if (cell.text) {
        prims.push({
          t: 'text',
          x: cx,
          cy,
          text: cell.text,
          size: m.fontSize,
          anchor: 'middle',
          weight: cell.bold ? 600 : undefined,
        })
      }
    })
  })

  // Rules last, so they sit over the cell contents rather than under them —
  // a cloud that overhangs its cell then reads as tucked behind the grid.
  for (const y of rules) prims.push({ t: 'rule', x0: 0, y0: y, x1: w, y1: y })
  for (const x of edges) prims.push({ t: 'rule', x0: x, y0: 0, x1: x, y1: h })

  return { prims, box: { x: 0, y: 0, w, h } }
}

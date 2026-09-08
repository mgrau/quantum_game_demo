/**
 * Laying out a statevector plot: one bar per basis state.
 *
 * This is the view the drawn state cannot give. A cloud says which states are
 * in a superposition and, through the length of a term, roughly how much — but
 * it is a picture of the notation, so relative sizes are read off integers that
 * mean nothing on their own. A bar chart puts every basis state on one scale,
 * including the ones with nothing in them, which is what makes interference
 * visible: two states meeting and cancelling is a bar that is *not there*.
 *
 * The axis is labelled with drawn states rather than binary strings, because the
 * whole course reads states as shapes and a plot labelled `|01⟩` would be the
 * only place in a figure that does not. Written *downwards*, though: a register
 * laid across under every bar makes the plot as many times wider as there are
 * wires, and four qubits of that is a smear. The glyphs stay upright — a
 * triangle turned on its side is a different glyph, not the same one rotated.
 *
 * Amplitudes are signed and hang either side of a baseline; probabilities are
 * not and all stand on it. Both are wanted — the sign is the interesting half
 * of an amplitude, and the probability is what a measurement would actually do.
 * Only the amplitude plot is coloured, for the same reason: the colour is the
 * sign said twice, and a plain grey plot is the tell that there is no sign left
 * to say.
 */

import type { ChartBar, ChartSpec } from '../circuit/ast'
import { layoutState } from '../state/layout'
import type { Layout, Metrics, Prim } from '../render/primitives'
import { textWidth, translatePrims } from '../render/primitives'
import type { ShapeName } from '../shapes'

export interface ChartLayoutOptions {
  metrics: Metrics
  shapeOrder?: ShapeName[]
}

/** Height of the plotting area, per unit of the quantity charted. */
const UNIT = 78
/** Space between neighbouring bars. */
const GAP = 8
/** Between the qubits of a basis state, stacked under their bar. */
const STACK_GAP = 3
/** Space between the axis and the first bar, and after the last. */
const MARGIN = 12
/** Between the foot of the plot and the labels beneath it. */
const LABEL_GAP = 16
/** Between the tick text and the axis it names. */
const TICK_GAP = 7
/** Between the axis title and the tick text it stands outside. */
const TITLE_GAP = 4
/** A bar with nothing in it still needs to be visible as an empty place. */
const MIN_BAR = 1.5

/** Ticks down the axis, top to bottom. */
const ticksFor = (mode: ChartSpec['mode']): { at: number; text: string }[] =>
  mode === 'amplitude'
    ? [{ at: 1, text: '1' }, { at: 0, text: '0' }, { at: -1, text: '−1' }]
    : [{ at: 1, text: '1' }, { at: 0.5, text: '½' }, { at: 0, text: '0' }]

/** Ticks the plot has room for, once it is known whether it hangs below zero. */
const shownTicks = (mode: ChartSpec['mode'], signed: boolean) =>
  ticksFor(mode).filter((tick) => signed || tick.at >= 0)

const valueOf = (bar: ChartBar, mode: ChartSpec['mode']): number =>
  mode === 'amplitude' ? (bar.amplitude ?? 0) : bar.probability

/**
 * How big a bar's chance can be written, or nothing if it cannot be written.
 *
 * Shrunk to fit the bar and the gap beside it, down to a floor: past that it
 * is too small to read and the axis is the better place to look.
 */
function valueSize(label: string, barW: number, m: Metrics): number | null {
  const room = barW + GAP - 2
  const natural = textWidth(label, m.fontSize)
  const size = natural <= room ? m.fontSize : (m.fontSize * room) / natural
  return size >= m.fontSize * 0.6 ? size : null
}

/**
 * A bar's label: its basis state written down the page.
 *
 * Laid out horizontally first and then re-stacked, rather than positioned from
 * scratch, so which shape each wire draws with stays the one thing that decides
 * it. A branch left in superposition by a partial measurement is not a basis
 * state and has nothing to stack, so it keeps the row it was given.
 */
function stacked(bar: ChartBar, m: Metrics, opts: ChartLayoutOptions): Layout {
  const laid = layoutState({ kind: 'state', rows: [bar.state] }, {
    metrics: m,
    shapeOrder: opts.shapeOrder,
  })
  const qubits = laid.prims.filter((p) => p.t === 'qubit')
  if (qubits.length !== laid.prims.length || qubits.length < 2) return laid

  const step = m.qubit + STACK_GAP
  const prims: Prim[] = qubits.map((p, i) => ({ ...p, cx: 0, cy: i * step }))
  return {
    prims,
    box: {
      x: -m.qubit / 2,
      y: -m.qubit / 2,
      w: m.qubit,
      h: (qubits.length - 1) * step + m.qubit,
    },
  }
}

/**
 * Lay the chart out with its top-left corner at the origin.
 *
 * The caller translates it into place, the same way a state or a table is.
 */
export function layoutChart(
  bars: ChartBar[],
  spec: ChartSpec,
  opts: ChartLayoutOptions,
): Layout {
  const m = opts.metrics

  // A measurement leaves outcomes rather than a statevector, so there are no
  // amplitudes left to plot even if the source asked for them.
  const mode = spec.measured ? 'probability' : spec.mode
  // The half below the axis is drawn only when something is down there. It is
  // the taller part of the plot and, on a state with no negative term, says
  // nothing the axis does not already say.
  const signed = mode === 'amplitude' && bars.some((bar) => (bar.amplitude ?? 0) < 0)

  const labels = bars.map((bar) => stacked(bar, m, opts))

  // Every bar is the same width — the widest label — so the axis is even and
  // a taller bar cannot be mistaken for a fatter one.
  const barW = Math.max(m.qubit, ...labels.map((l) => l.box.w))
  const ticks = shownTicks(mode, signed)

  // The value text sits over the tallest bar, so the plot needs room for it
  // whether or not that bar reaches the top of the axis.
  const values = mode === 'probability'
  const headroom = values ? m.fontSize + 6 : 0

  const top = headroom
  const zero = top + UNIT
  const bottom = signed ? zero + UNIT : zero
  const labelH = Math.max(...labels.map((l) => l.box.h))

  const title = mode === 'amplitude' ? 'Amplitude' : 'Probability'
  const tickW = Math.max(...ticks.map((t) => textWidth(t.text, m.fontSize)))
  // The title runs up the outside of the ticks, so it names the scale without
  // taking width from the plot.
  const titleW = m.fontSize + TITLE_GAP
  const axisX = titleW + tickW + TICK_GAP
  const left = axisX + MARGIN

  const prims: Prim[] = []

  bars.forEach((bar, i) => {
    const x = left + i * (barW + GAP)
    const v = valueOf(bar, mode)
    const h = Math.abs(v) * UNIT

    prims.push({
      t: 'pane',
      // Colour only where there is a sign to carry. An amplitude reads twice
      // over — how far the bar reaches, and which way it leans — and the plot's
      // shape is taken in long before any one bar is measured. A probability
      // has no sign, so colouring it would say nothing the height does not, and
      // would leave the two kinds of plot looking alike when the whole point of
      // choosing one is that they are not.
      ...(mode === 'amplitude' ? { tone: v } : {}),
      box: {
        x,
        y: v < 0 ? zero : zero - Math.max(h, MIN_BAR),
        w: barW,
        h: Math.max(h, MIN_BAR),
      },
    })

    // Written over the bar only while it fits over the bar. Stacked labels make
    // for narrow bars, and a row of chances running into each other says less
    // than the axis beside them already does.
    const size = valueSize(bar.label, barW, m)
    if (values && bar.probability > 0 && size) {
      prims.push({
        t: 'text',
        x: x + barW / 2,
        cy: zero - h - size * 0.6,
        text: bar.label,
        size,
        anchor: 'middle',
      })
    }

    const { box } = labels[i]
    prims.push(
      ...translatePrims(
        labels[i].prims,
        x + barW / 2 - (box.x + box.w / 2),
        bottom + LABEL_GAP - box.y,
      ),
    )
  })

  const width = left + bars.length * (barW + GAP) - GAP + MARGIN
  const height = bottom + LABEL_GAP + labelH

  // The axis last, so it rules over a bar that starts hard against it rather
  // than being half-covered by one.
  for (const tick of ticks) {
    const y = zero - tick.at * UNIT
    if (tick.at === 0) prims.push({ t: 'rule', x0: axisX, y0: y, x1: width, y1: y })
    prims.push({
      t: 'text',
      x: axisX - TICK_GAP,
      cy: y,
      text: tick.text,
      size: m.fontSize,
      anchor: 'end',
    })
  }
  prims.push({ t: 'rule', x0: axisX, y0: top, x1: axisX, y1: bottom })
  prims.push({
    t: 'text',
    x: m.fontSize * 0.5,
    cy: (top + bottom) / 2,
    text: title,
    size: m.fontSize,
    anchor: 'middle',
    rotate: -90,
  })

  return { prims, box: { x: 0, y: 0, w: width, h: height } }
}

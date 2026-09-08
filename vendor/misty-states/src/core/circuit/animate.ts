/**
 * Moving a classical state through a circuit.
 *
 * A basis state has one qubit on each wire, so it can be drawn as objects that
 * travel: they fall down the pipes, pause inside a gate while it acts on them,
 * and carry on changed. That is the picture the course draws by hand, and it is
 * only available for states with a single term — the moment a state becomes a
 * superposition there is no longer *the* qubit on a wire to move.
 *
 * Which circuits qualify is therefore not a list of gates but a property of the
 * run: **the state must still be a single basis state after every layer.** That
 * is checked with the simulator rather than by classifying gates, so it stays
 * true as gates are added, and it refuses `H` for the right reason rather than
 * by name.
 *
 * Everything here is pure. The timeline is the single description of the
 * motion; both the animated SVG and any individual frame are read off it, so
 * the two cannot disagree about where anything is.
 */

import type { CircuitDoc, Gate } from './ast'
import { gateQubits } from './ast'
import { ONE, ZERO, add as cxAdd, cx, isReal, isZero, show, type Cx } from './complex'
import type { CircuitGeometry, CircuitLayout } from './layout'
import type { Metrics, Prim } from '../render/primitives'
import { textWidth } from '../render/primitives'
import type { ShapeName } from '../shapes'
import type { Box } from '../svg'
import {
  amplitudesOf, gcd, SimulationError, simulateBranches, traceGate,
  type Amplitudes, type Contribution,
} from './simulate'

export interface AnimationOptions {
  /**
   * Show what a gate does to the state while it is inside it.
   *
   * On, the casing goes clear and the working is visible: a term splits in two
   * and the pair leaves together. Off, the gate is a closed box — qubits go in
   * and qubits come out — which is the picture to draw when the gate is
   * something to be taken on trust rather than looked into.
   */
  inside?: boolean
  /** Multiplier on the whole timeline; 2 runs it twice as fast. */
  speed?: number
  /** Seconds a gate is dwelt in while it acts. */
  dwell?: number
  /** Seconds of stillness on the finished state before it repeats. */
  hold?: number
  /** Repeat rather than stopping on the last frame. */
  loop?: boolean
}

export const DEFAULT_ANIMATION: Required<AnimationOptions> = {
  inside: true,
  speed: 1,
  dwell: 0.7,
  hold: 0.9,
  // Off by default: a figure is usually being read once, and a drawing that
  // keeps restarting is hard to talk over. `loop=on` asks for it.
  loop: false,
}

/**
 * Pixels a qubit travels per second, before `speed`.
 *
 * Slow enough that moving takes a comparable share of the run to standing
 * still. Faster and the qubits dart between gates and wait about, which reads
 * as a stutter however many frames a second it is drawn at.
 */
const TRAVEL_RATE = 105

/**
 * Ease a segment, so nothing starts or stops dead.
 *
 * A constant-speed run that halts in a single frame is the other half of what
 * makes an animation look jerky; this is the usual smooth step, and it leaves
 * the endpoints and the midpoint exactly where they were, so every stop the
 * stepper knows about still lands on the same picture.
 */
export const ease = (u: number): number => u * u * (3 - 2 * u)

/** How far the gate's casing fades while it is being passed through. */
export const GATE_FADE = 0.22
/** Its markings fade less: they are the mechanism, seen acting on the qubit. */
export const MARK_FADE = 0.5

/** What one travelling qubit does over the whole run. */
export interface Track {
  /** The wire it starts on. A swap moves it to another; it keeps this name. */
  qubit: number
  /**
   * Positions in time. Between two stops the qubit moves steadily; a stop with
   * the same position as the one before it is a pause inside a gate.
   */
  stops: Stop[]
}

export interface Stop {
  t: number
  x: number
  y: number
  /** White or black on arriving here. */
  value: 0 | 1
  /**
   * The glyph to draw it with.
   *
   * Shapes belong to positions, not to qubits — `010` is drawn circle, square,
   * triangle wherever it came from — so a qubit carried across by a swap takes
   * on the shape of the wire it lands on. It changes at the same instant its
   * colour would, so the exchange reads as one event and the finished picture
   * is the one a written `out` would draw.
   */
  shape: ShapeName
}

/** A gate being passed through, and when. */
export interface Pass {
  layer: number
  from: number
  to: number
  /** When what came out of this pass has reached its place below the gate. */
  landed?: number
  /** Wires the gate covers, for the pulse that runs between them. */
  qubits: number[]
  kind: Gate['kind']
}

export interface Timeline {
  duration: number
  /** Whether the gates were opened up; the drawing fades them only if so. */
  inside: boolean
  tracks: Track[]
  passes: Pass[]
  /** When an overall minus sign is present, as [from, to] spans. */
  signs: { from: number; to: number }[]
  loop: boolean
}

/** Raised when the circuit is not one that can be drawn as things moving. */
export class NotClassicalError extends Error {}

/* -- Working a superposition through, a term at a time -------------------- */

/** One term of a state: a row of qubits and what stands in front of it. */
export interface Term {
  bits: string
  amp: number
}

/** What happens at one layer: each term worked in turn, then the tidying up. */
export interface Working {
  /** The terms going in, in the order they are worked. */
  going: Term[]
  /**
   * What each one gave, in order, nothing merged. A term that splits appears
   * twice; two that cancel both appear, because watching them meet is the
   * point.
   */
  gave: Contribution[]
  /**
   * What is left once identical terms are added and opposites vanish, with the
   * amplitudes as the addition left them: `2*0`, not `0`.
   */
  summed: Term[]
  /** The same state written the way the notation writes it, scale divided out. */
  left: Term[]
}

/**
 * How many terms a drawing will hold before it stops being a drawing.
 *
 * Every term is a row of qubits, and they stack: eight is already a tall
 * figure, and a Hadamard on each of four wires would ask for sixteen.
 */
export const MAX_TERMS = 8

/**
 * The terms of a state, in reading order and with their amplitudes literal.
 *
 * Deliberately *not* canonicalised. Everywhere else a state is reduced by its
 * common factor, overall scale being unobservable — but here the arithmetic is
 * the subject: two terms landing on the same row and adding to 2 is the thing
 * being shown, and quietly dividing it back to 1 would erase it.
 */
const termsOf = (amps: Amplitudes): Term[] =>
  [...amps]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([bits, amp]) => ({ bits, amp: plainAmp(amp) }))

/**
 * An amplitude as a single number, or a refusal.
 *
 * A travelling term is drawn, and the notation has no mark for a phase — so a
 * state carrying one has nothing to animate, and saying that is better than
 * showing a state that is not the one in hand.
 */
function plainAmp(amp: Cx): number {
  if (!isReal(amp)) {
    throw new NotClassicalError(
      `an amplitude of ${show(amp)} has a phase, which there is no way to draw moving`,
    )
  }
  return amp.re
}

/**
 * Work the whole circuit, keeping every intermediate step.
 *
 * This is the same arithmetic the simulator does, unrolled: at each layer every
 * term goes through on its own, the results pile up, and only then are they
 * added together. Unrolling it is the entire point — a state going through a
 * gate one term at a time *is* linearity, and the tidying up afterwards is
 * rules 2 and 3.
 */
export function termRun(doc: CircuitDoc): Working[] {
  const start = doc.input
    ? amplitudesOf(doc.input, doc.qubits)
    : new Map([['0'.repeat(doc.qubits), ONE]])

  let terms = termsOf(start)
  if (!terms.length) {
    throw new NotClassicalError('the terms all cancel, leaving no state to draw')
  }

  const out: Working[] = []
  doc.layers.forEach((layer, at) => {
    const acting = layer.gates.filter((g) => g.kind !== 'view' && g.kind !== 'identity')
    if (acting.some((g) => g.kind === 'measure')) {
      throw new NotClassicalError(
        `layer ${at + 1} measures, which splits the drawing into outcomes rather than moving it`,
      )
    }

    const amps: Amplitudes = new Map(terms.map((t) => [t.bits, cx(t.amp)]))
    // Gates in a layer act on disjoint wires, so they commute and can be
    // applied one after another. Only the layer as a whole is shown, so the
    // contributions are of the layer, not of each gate within it.
    let gave: Contribution[] = terms.map((t) => ({ from: t.bits, to: t.bits, amp: cx(t.amp) }))
    let running = amps
    for (const gate of acting) {
      const step = traceGate(running, gate)
      // Carry the original term each contribution came from, so a layer of two
      // gates still says which row of the *input* is being worked.
      const origin = new Map<string, string>()
      for (const c of gave) origin.set(c.to, c.from)
      gave = step.map((c) => ({ from: origin.get(c.from) ?? c.from, to: c.to, amp: c.amp }))
      running = new Map()
      for (const c of gave) {
        const sum = cxAdd(running.get(c.to) ?? ZERO, c.amp)
        if (isZero(sum)) running.delete(c.to)
        else running.set(c.to, sum)
      }
    }

    // The results come out of the arithmetic in bit order, but the terms are
    // worked in the order they stand in the band — which stops being bit order
    // as soon as a layer leaves them in another. Following the band keeps
    // everything downstream in step: where each result lands, and where adding
    // up then sends it. Sorting is stable, so one term's results keep their own
    // order within it.
    const rank = new Map(terms.map((t, i) => [t.bits, i]))
    gave.sort((a, b) => (rank.get(a.from) ?? 0) - (rank.get(b.from) ?? 0))

    // In the order the results landed, not in bit order.
    //
    // Adding up is supposed to move only what actually combines. Re-sorting
    // here made terms that had nothing to do with each other trade places on
    // the way — a swap's two results would cross over again for no reason —
    // which reads as part of the arithmetic when it is nothing of the kind.
    // Term order carries no meaning anyway; that is rule 1.
    const seen: string[] = []
    for (const c of gave) if (!seen.includes(c.to)) seen.push(c.to)
    const summed = seen
      .filter((bits) => running.has(bits))
      .map((bits) => ({ bits, amp: plainAmp(running.get(bits)!) }))
    // Dividing out the common factor is a step of its own: `2*0` and `0` are
    // the same state, and watching the 2 go is watching that being said.
    const divisor = summed.reduce((g, t) => gcd(g, t.amp), 0) || 1
    const left = summed.map((t) => ({ bits: t.bits, amp: t.amp / divisor }))
    if (!left.length) {
      throw new NotClassicalError(
        `every term cancels at layer ${at + 1}, leaving no state to draw`,
      )
    }
    if (gave.length > MAX_TERMS) {
      throw new NotClassicalError(
        `layer ${at + 1} produces ${gave.length} terms, more than the ${MAX_TERMS} an animation can stack up`,
      )
    }

    out.push({ going: terms, gave, summed, left })
    terms = left
  })

  return out
}

const bitsOf = (amps: Amplitudes): string | null => {
  if (amps.size !== 1) return null
  return [...amps.keys()][0]
}

/**
 * The state after each layer, as bit strings, or a refusal.
 *
 * A single term is what makes the state drawable as objects; anything else —
 * a superposition, an unknown, a gate the arithmetic cannot follow — is named
 * where it happened rather than reported as a general failure.
 */
export function classicalRun(doc: CircuitDoc): { bits: string[]; negative: boolean[] } {
  const bits: string[] = []
  const negative: boolean[] = []

  const start = doc.input
    ? amplitudesOf(doc.input, doc.qubits)
    : new Map([['0'.repeat(doc.qubits), ONE]])
  const first = bitsOf(start)
  if (first === null) {
    throw new NotClassicalError(
      'an animation moves one qubit down each wire, so the input must be a single state, not a superposition',
    )
  }
  bits.push(first)
  negative.push(plainAmp(start.get(first) ?? ONE) < 0)

  for (let at = 1; at <= doc.layers.length; at++) {
    let amps: Amplitudes
    try {
      const { branches } = simulateBranches(doc, at)
      if (branches.length !== 1) {
        throw new NotClassicalError(
          `layer ${at} measures into more than one outcome, which an animation cannot follow down a single wire`,
        )
      }
      amps = branches[0].amps
    } catch (err) {
      if (err instanceof SimulationError) throw new NotClassicalError(err.message)
      throw err
    }
    const now = bitsOf(amps)
    if (now === null) {
      throw new NotClassicalError(
        `layer ${at} puts the register into a superposition, which has no single qubit on a wire to move`,
      )
    }
    bits.push(now)
    negative.push(plainAmp(amps.get(now) ?? ONE) < 0)
  }

  return { bits, negative }
}

/** Where a wire's qubit sits while a swap carries it across. */
const swapPartner = (gate: Gate, qubit: number): number | null => {
  if (gate.kind !== 'swap') return null
  const [a, b] = gate.qubits
  return qubit === a ? b : qubit === b ? a : null
}

/**
 * Build the motion for a circuit that has already been laid out.
 *
 * Wires move in lockstep: a layer acts on the whole register at once, so the
 * state travelling as one wavefront is the honest picture, and a wire the gate
 * does not touch simply passes it at the same rate.
 */
export function buildTimeline(
  doc: CircuitDoc,
  geometry: CircuitGeometry,
  opts: AnimationOptions = {},
): Timeline {
  const { inside, speed, dwell, hold, loop } = { ...DEFAULT_ANIMATION, ...opts }
  const { bits, negative } = classicalRun(doc)

  const wires = Array.from({ length: doc.qubits }, (_, i) => i + 1)
  const xOf = (q: number) => geometry.columns[q - 1]
  const shapeOf = (q: number) => geometry.shapes[q - 1]
  const value = (step: number, q: number): 0 | 1 => (bits[step][q - 1] === '1' ? 1 : 0)

  const tracks: Track[] = wires.map((qubit) => ({
    qubit,
    stops: [
      { t: 0, x: xOf(qubit), y: geometry.startY, value: value(0, qubit), shape: shapeOf(qubit) },
    ],
  }))
  const passes: Pass[] = []

  // Which wire each travelling qubit is on *now*. A swap moves the objects
  // rather than exchanging their contents — that is the whole picture of a
  // swap — so after one, a track reads its colour off a different wire.
  const wireOf = wires.slice()

  const travel = (from: number, to: number) => Math.abs(to - from) / (TRAVEL_RATE * speed)

  let now = 0
  let y = geometry.startY

  doc.layers.forEach((layer, at) => {
    const band = geometry.layers[at]
    const middle = band.y + band.h / 2

    // Down to the gate.
    now += travel(y, middle)
    y = middle
    for (const track of tracks) {
      const last = track.stops[track.stops.length - 1]
      track.stops.push({ t: now, x: last.x, y, value: last.value, shape: last.shape })
    }

    // Through it. A gate that touches no wire still takes its dwell, so the
    // rhythm of the circuit is the rhythm of the animation.
    const acted = layer.gates.filter((gate) => gate.kind !== 'view')
    const enter = now
    now += dwell / speed
    for (const gate of acted) {
      passes.push({ layer: at, from: enter, to: now, qubits: gateQubits(gate), kind: gate.kind })
    }

    // A gate acts in the middle of its dwell rather than across the whole of
    // it. A colour flip is instant either way, but a swap's crossing is motion:
    // spread over the whole dwell it would begin the moment the qubits entered,
    // leaving no instant at which they have arrived and not yet swapped — which
    // is one of the four the stepper wants to stop on.
    const acts = enter + (now - enter) * 0.3
    const acted_ = enter + (now - enter) * 0.7

    tracks.forEach((track, i) => {
      // A swap carries its two qubits across each other; everything else stays
      // in its column and only changes colour.
      const last = track.stops[track.stops.length - 1]
      const crossing = acted.map((gate) => swapPartner(gate, wireOf[i])).find((p) => p != null)
      if (crossing != null) wireOf[i] = crossing
      const done = {
        x: xOf(wireOf[i]),
        value: value(at + 1, wireOf[i]),
        shape: shapeOf(wireOf[i]),
      }
      track.stops.push({ t: acts, x: last.x, y, value: last.value, shape: last.shape })
      track.stops.push({ t: acted_, y, ...done })
      track.stops.push({ t: now, y, ...done })
    })
  })

  // Out of the bottom.
  now += travel(y, geometry.endY)
  for (const track of tracks) {
    const last = track.stops[track.stops.length - 1]
    track.stops.push({ t: now, x: last.x, y: geometry.endY, value: last.value, shape: last.shape })
  }

  const finish = now + hold / speed

  // A minus sign has no effect on the qubits themselves, so it is shown as a
  // sign that appears beside the register the moment the gate produces it.
  const signs: { from: number; to: number }[] = []
  negative.forEach((on, step) => {
    if (!on) return
    const from = step === 0 ? 0 : (passes.find((p) => p.layer === step - 1)?.to ?? 0)
    const last = signs[signs.length - 1]
    if (last && Math.abs(last.to - from) < 1e-9) last.to = finish
    else signs.push({ from, to: finish })
  })

  return { duration: finish, inside, tracks, passes, signs, loop }
}

/** Linear interpolation between the two stops that bracket `t`. */
export function positionAt(
  track: Track,
  t: number,
): { x: number; y: number; value: 0 | 1; shape: ShapeName } {
  const { stops } = track
  if (t <= stops[0].t) return stops[0]
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1]
    const b = stops[i]
    if (t > b.t) continue
    const span = b.t - a.t
    // A dwell is two stops at one place: the value changes across it rather
    // than the position, and it changes at the end, once the gate has acted.
    const u = span <= 0 ? 1 : (t - a.t) / span
    // Colour and shape change halfway through the segment rather than at its
    // end, so a gate is seen acting while it is at its most transparent.
    const shown = u >= 0.5 ? b : a
    const e = ease(u)
    return {
      x: a.x + (b.x - a.x) * e,
      y: a.y + (b.y - a.y) * e,
      value: shown.value,
      shape: shown.shape,
    }
  }
  return stops[stops.length - 1]
}

/** Which gates are being passed through at `t`, by layer. */
export const activeAt = (timeline: Timeline, t: number): number[] =>
  timeline.passes.filter((p) => t >= p.from && t <= p.to).map((p) => p.layer)

export const signAt = (timeline: Timeline, t: number): boolean =>
  timeline.signs.some((s) => t >= s.from && t <= s.to)

/** A moment worth stopping on, and what is happening there. */
export interface Step {
  t: number
  layer: number
  phase: Phase
}

/**
 * What is being shown at a stop.
 *
 * The gate ones read in order — above it, at it, acting, out of it — and the
 * tidying ones are only offered when they change something, so a figure with
 * nothing to add up does not stop twice on the same picture.
 */
export type Phase =
  | 'before' | 'at' | 'acting' | 'landed' | 'after'
  | 'flatten' | 'merge' | 'reduce'

/**
 * The moments worth stopping on, for stepping through by hand.
 *
 * A gate is four things happening in order: the qubits still above it, arrived
 * inside with the casing clear, the instant it acts, and away below with the
 * casing shut. Landing only on the settled state skips the part worth watching.
 *
 * Between two gates there is no stop at all: the qubits leaving one are on
 * their way into the next, and pausing them in the gap says nothing that the
 * stops either side do not. Only the last gate has an `after` — the finished
 * register, at rest below the circuit — and only the first has a `before`,
 * which is the start of the run.
 *
 * The *acting* stop sits just after the change rather than at the end of the
 * dwell, because by the end the casing has closed and the gate's own glyph is
 * back on top of the qubit it just changed.
 */
export function steps(timeline: Timeline): Step[] {
  const layers = [...new Set(timeline.passes.map((p) => p.layer))].sort((a, b) => a - b)
  if (!layers.length) return []

  const settle =
    timeline.tracks[0]?.stops[timeline.tracks[0].stops.length - 1]?.t ?? timeline.duration

  const out: Step[] = [{ t: 0, layer: layers[0], phase: 'before' }]

  layers.forEach((layer, i) => {
    const pass = timeline.passes.find((p) => p.layer === layer)!
    const dwell = pass.to - pass.from
    // Inside the still moments either side of the act, and inside the stretch
    // where the casing has faded, so both stops show what they claim to.
    out.push({ t: pass.from + dwell * 0.2, layer, phase: 'at' })
    out.push({ t: pass.from + dwell * 0.75, layer, phase: 'acting' })
    if (i === layers.length - 1) out.push({ t: settle, layer, phase: 'after' })
  })

  return out
}

/* -- Drawing it ---------------------------------------------------------- */

/**
 * What part of a gate a primitive is, and where it sits vertically.
 *
 * The two fade by different amounts. The casing goes nearly clear, so the
 * qubits inside can be seen at all; the markings — the control, the target, the
 * link between them — only half, because they are the mechanism doing the work
 * and watching it act on the qubit is the point of looking inside.
 */
function gatePart(p: Prim): { y: number; fade: number } | null {
  switch (p.t) {
    case 'gatebox':
    case 'measurebox':
    case 'pane':
      return { y: p.box.y + p.box.h / 2, fade: GATE_FADE }
    case 'control':
    case 'target':
    case 'swap':
    case 'link':
      return { y: p.cy, fade: MARK_FADE }
    default:
      return null
  }
}

/**
 * What a travelling qubit passes in front of.
 *
 * With the gates open it is the pipe and the casing, so a qubit inside a gate
 * that has faded is seen through it. With them closed it is the pipe alone: the
 * qubit goes behind the box and out the other side, which is the whole of what
 * a closed gate shows.
 */
const isBehind = (p: Prim, inside: boolean): boolean =>
  p.t === 'pipe' ||
  (inside && (p.t === 'gatebox' || p.t === 'measurebox' || p.t === 'pane'))

/**
 * Compose one instant of the animation.
 *
 * The travelling qubits are slid in between the casing and the markings. Behind
 * them the box has gone nearly clear, so they read as being inside it; in front
 * of them the target and its link are still faintly drawn, so the gate is seen
 * acting *on* the qubit rather than hiding it. Putting them under everything
 * loses the subject behind the very glyph that is operating on it.
 */
export function frameAt(
  layout: CircuitLayout,
  timeline: Timeline,
  t: number,
  m: Metrics,
): Prim[] {
  const { geometry } = layout
  const active = activeAt(timeline, t)
  const bands = active.map((at) => geometry.layers[at])

  const faded = layout.prims.map((p): Prim => {
    const part = gatePart(p)
    if (!part) return p
    const inside = bands.some((b) => part.y > b.y && part.y < b.y + b.h)
    return inside ? { ...p, opacity: part.fade } : p
  })

  const riders: Prim[] = timeline.tracks.map((track): Prim => {
    const now = positionAt(track, t)
    return { t: 'qubit', shape: now.shape, value: now.value, cx: now.x, cy: now.y, size: m.qubit }
  })

  if (signAt(timeline, t)) {
    const lead = timeline.tracks.reduce(
      (x, track) => Math.min(x, positionAt(track, t).x),
      Infinity,
    )
    const cy = positionAt(timeline.tracks[0], t).y
    riders.unshift({
      t: 'sign',
      x: lead - m.qubit / 2 - m.signGap - m.barWidth * 2,
      cy,
      w: m.barWidth * 2,
      h: m.barWidth,
    })
  }

  const back = (p: Prim) => isBehind(p, timeline.inside)
  return [...faded.filter(back), ...riders, ...faded.filter((p) => !back(p))]
}

/**
 * How much room a term's amplitude takes in front of it.
 *
 * A coefficient is written to the left of the qubits and a minus to the left of
 * that, so the two together are what has to fit — `-12` needs a good deal more
 * than a bare sign.
 */
export function labelWidth(amp: number, m: Metrics): number {
  const size = Math.abs(amp)
  const digits = size === 1 ? 0 : textWidth(String(size), m.fontSize, false)
  if (amp >= 0) return digits
  return digits + (digits ? m.signGap : 0) + m.barWidth * 2
}

/** Height of one term's row, including the air around it. */
export const rowHeight = (m: { qubit: number }) => m.qubit + 14

/**
 * Clear space a band of terms needs.
 *
 * One row tall whatever it holds: the terms of a state stand side by side, the
 * way the notation writes them, rather than stacking up.
 */
export const bandHeight = (m: Metrics) => rowHeight(m) + m.cloudPadY * 2

/* -- Moving a superposition, a term at a time ----------------------------- */

/**
 * A row of qubits travelling as one, with a fixed look.
 *
 * Fixed is the point: a row never changes what it shows, only where it is and
 * whether it is there at all. A term that becomes two is not a row that splits
 * but two new rows fading in; two that merge are two rows fading out as their
 * sum fades in. That keeps every track a single drawing moved about, which is
 * what a stylesheet can express.
 *
 * `x` is an offset from sitting square on the wires. A term waiting in the
 * misty state stands off to one side and shifts across before it goes down,
 * which is what makes it clear that a state is being taken apart a term at a
 * time rather than flowing through as a whole.
 */
export interface RowTrack {
  bits: string
  amp: number
  stops: { t: number; x: number; y: number; alpha: number }[]
}

/** The outline drawn round a state while it is whole. */
export interface CloudTrack {
  /** Where it rests. `x` and `y` on the stops move it from there. */
  box: Box
  stops: Fade[]
}

/** A stop for something that fades, and may travel while it does. */
export interface Fade {
  t: number
  x: number
  y: number
  alpha: number
}

/**
 * The `|` between two terms of a state.
 *
 * Bars belong to the state, not to the terms: they appear when it is whole and
 * go when it is taken apart. One per gap, and the gaps of the brackets inside a
 * state fall in the same places as the gaps of the state itself — `((0|1)|(0|-1))`
 * and `(0|1|0|-1)` have their bars in the same three places — so the outer
 * state's set covers the lot.
 */
export interface BarTrack {
  x: number
  cy: number
  h: number
  stops: Fade[]
}

export interface TermTimeline {
  duration: number
  /** Whether the gates were opened up; the drawing fades them only if so. */
  inside: boolean
  rows: RowTrack[]
  clouds: CloudTrack[]
  bars: BarTrack[]
  passes: Pass[]
  /** When each layer's adding up finishes — the moment worth stopping on. */
  collects: number[]
  /** The stages of a layer's tidying up that actually change the picture. */
  tidies: { t: number; phase: Phase }[][]
  loop: boolean
}

/**
 * Seconds a bracket takes to fade away.
 *
 * The tidying reads as a sequence rather than a dissolve: the brackets round
 * each term's results go first, and only once they are gone does the one round
 * the whole state arrive. Two clouds cross-fading through each other says
 * nothing about which became which.
 */
const BRACKET_FADE = 0.25

/** Seconds spent dropping the brackets round each term's own results. */
const FLATTEN = 0.6
/** Seconds spent adding up what a layer produced. */
const COLLECT = 0.55
/** Seconds spent dividing out the common factor. */
const REDUCE = 0.45
/** A beat between one term finishing and the next setting off. */
const BETWEEN = 0.15

/**
 * Build the motion for a circuit worked a term at a time.
 *
 * A state stands in a band as the notation writes it: its terms side by side,
 * inside a cloud if there is more than one. One at a time a term shifts across
 * onto the wires, goes down through the gate, and what it gives stands in the
 * band below. Once they have all been through, that band is added up and
 * becomes the state going into the next gate.
 */
export function buildTermTimeline(
  working: Working[],
  geometry: CircuitGeometry,
  m: Metrics,
  opts: AnimationOptions = {},
): TermTimeline {
  const { inside, speed, dwell, hold, loop } = { ...DEFAULT_ANIMATION, ...opts }
  const rows: RowTrack[] = []
  const clouds: CloudTrack[] = []
  const bars: BarTrack[] = []
  const passes: Pass[] = []
  const collects: number[] = []
  const tidies: { t: number; phase: Phase }[][] = []

  const columns = geometry.columns
  const middle = (columns[0] + columns[columns.length - 1]) / 2
  const termW = columns[columns.length - 1] - columns[0] + m.qubit
  // Wide enough for the bar between two terms *and* whatever amplitude is
  // written in front of the right-hand one, which sits in the same gap. Sized
  // from the amplitudes this run actually produces rather than from a guess:
  // a bare minus needs little, `-12` needs a lot, and a bar drawn through a
  // coefficient is the sort of thing only a wide state shows up.
  const widest = working.reduce(
    (w, layer) =>
      [...layer.going, ...layer.summed, ...layer.left, ...layer.gave].reduce(
        (n, t) => Math.max(n, labelWidth(typeof t.amp === 'number' ? t.amp : t.amp.re, m)),
        w,
      ),
    0,
  )
  const between = m.termGap * 2 + m.barWidth + (m.signGap + widest) * 2

  /** Where each term of an `n`-term state stands, as an offset from the wires. */
  const spread = (n: number): number[] => {
    const total = n * termW + (n - 1) * between
    return Array.from({ length: n }, (_, i) => -total / 2 + termW / 2 + i * (termW + between) )
  }

  const bandY = (band: number) => geometry.bands[band].y + geometry.bands[band].h / 2
  const travel = (from: number, to: number) => Math.abs(to - from) / (TRAVEL_RATE * speed)

  const open = (bits: string, amp: number, t: number, x: number, y: number, alpha: number) => {
    const track: RowTrack = { bits, amp, stops: [{ t, x, y, alpha }] }
    rows.push(track)
    return track
  }
  const move = (track: RowTrack, t: number, x: number, y: number, alpha = 1) => {
    track.stops.push({ t, x, y, alpha })
  }
  const at = (track: RowTrack) => track.stops[track.stops.length - 1]

  /**
   * A cloud round a band's terms, from when the state is whole until the last
   * of it has been taken out.
   *
   * Only a state of more than one term gets one, a single term not being misty.
   * The times are forced into order: a state that is taken apart the instant it
   * appears would otherwise ask for a cloud that fades out before it fades in,
   * and out-of-order keyframes draw nothing sensible at all.
   */
  const cloud = (band: number, n: number, from: number, to: number) => {
    if (n < 2) return
    const offsets = spread(n)
    const y = bandY(band)
    // The rise happens *into* `from`, not out of it: a bracket is round its
    // terms the moment they are all there, so a step that stops on that moment
    // finds it drawn rather than half-formed.
    const born = from <= 0.001
    const rise = born ? 0 : Math.min(0.25, from)
    const full = Math.max(from, to)
    const stops: Fade[] = [
      { t: 0, x: 0, y: 0, alpha: born ? 1 : 0 },
      { t: from - rise, x: 0, y: 0, alpha: born ? 1 : 0 },
      { t: from, x: 0, y: 0, alpha: 1 },
      { t: full, x: 0, y: 0, alpha: 1 },
      { t: full + 0.25, x: 0, y: 0, alpha: 0 },
    ]
    clouds.push({
      box: {
        x: middle + offsets[0] - termW / 2,
        y: y - m.qubit / 2,
        w: offsets[n - 1] - offsets[0] + termW,
        h: m.qubit,
      },
      stops,
    })
    for (let i = 0; i + 1 < n; i++) {
      bars.push({
        x: middle + (offsets[i] + offsets[i + 1]) / 2,
        cy: y,
        h: m.qubit * 0.9,
        stops: stops.map((s) => ({ ...s })),
      })
    }
  }

  /**
   * A bracket round the results of one term, made where they are made.
   *
   * `outBand` is the set of positions the band as a whole uses; `from`..`from+n`
   * are the ones these results end up in. `offset` is where the bracket starts
   * relative to that, and `path` the times at which it is to have got back to
   * nought — so a bracket formed inside a gate travels out of it with what it
   * holds rather than appearing once they have arrived.
   */
  const travelling = (
    band: number,
    from: number,
    n: number,
    at_: number,
    offset: { x: number; y: number },
    path: number[],
  ) => {
    const outBand = bandOffsets
    const y = bandY(band)
    const rise = Math.min(0.2, at_)
    const held = { x: offset.x, y: offset.y }
    const steps: Fade[] = [
      { t: 0, x: held.x, y: held.y, alpha: 0 },
      { t: at_ - rise, x: held.x, y: held.y, alpha: 0 },
      { t: at_, x: held.x, y: held.y, alpha: 1 },
    ]
    // Held where it was made until the terms set off, then down, then across.
    if (path.length === 3) {
      steps.push({ t: path[0], x: held.x, y: held.y, alpha: 1 })
      steps.push({ t: path[1], x: held.x, y: 0, alpha: 1 })
      steps.push({ t: path[2], x: 0, y: 0, alpha: 1 })
    }
    const settled = path.length ? path[path.length - 1] : at_

    const box = {
      x: middle + outBand[from] - termW / 2,
      y: y - m.qubit / 2,
      w: outBand[from + n - 1] - outBand[from] + termW,
      h: m.qubit,
    }
    const tail = (to: number): Fade[] => [
      { t: Math.max(settled, to), x: 0, y: 0, alpha: 1 },
      { t: Math.max(settled, to) + 0.25, x: 0, y: 0, alpha: 0 },
    ]
    brackets.push({ box, steps, tail, from, n })
  }

  /** Where the band being filled puts each of its terms. */
  let bandOffsets: number[] = []
  /** Brackets made during a layer, finished off once it is known when they go. */
  const brackets: {
    box: Box
    steps: Fade[]
    tail: (to: number) => Fade[]
    from: number
    n: number
  }[] = []

  let now = 0
  let waiting = working.length
    ? working[0].going.map((term, i) =>
        open(term.bits, term.amp, 0, spread(working[0].going.length)[i], bandY(0), 1))
    : []

  working.forEach((layer, k) => {
    const gate = geometry.layers[k]
    const gateY = gate.y + gate.h / 2
    const landed: { track: RowTrack; to: string; amp: number }[] = []
    /** When each landed row got to its place, for bracketing it as it arrives. */
    const landedAt: number[] = []
    const outOffsets = spread(layer.gave.length)
    bandOffsets = outOffsets
    brackets.length = 0
    const arrived = k === 0 ? 0 : collects[k - 1]
    let lastOut = now

    layer.going.forEach((term, i) => {
      const row = waiting[i]
      const start = now
      lastOut = start
      // Every waiting row holds where it is — the one about to move included.
      // Without a stop of its own it would have nothing to interpolate from but
      // the beginning of the run, and would drift across for the whole of it
      // instead of setting off when its turn comes.
      for (const other of waiting) {
        move(other, start, at(other).x, at(other).y, at(other).alpha)
      }

      // Across onto the wires first, then down: two moves, so that stepping
      // over each says one thing. A closed gate is passed through in exactly
      // the same way — the qubits simply go behind it, and what happens in
      // there is not on show.
      const meetY = gateY
      const leaveY = gateY
      const across = Math.abs(at(row).x) / (TRAVEL_RATE * speed)
      move(row, now + across, 0, at(row).y)
      now += across
      const down = travel(at(row).y, meetY)
      move(row, now + down, 0, meetY)
      now += down

      const enter = now
      now += dwell / speed
      const span = (now - enter) * 0.12
      const acts = (enter + now) / 2
      move(row, acts - span, 0, meetY, 1)
      move(row, acts + span, 0, meetY, 0)

      const gave = layer.gave.filter((c) => c.from === term.bits)
      const first = landed.length
      // What one term gives stands as a state in its own right: spread apart
      // where it is made, and carried out of the gate together.
      const within = spread(gave.length)
      const shift = outOffsets[first] - within[0]

      const made = gave.map((c, j) => {
        const track = open(c.to, plainAmp(c.amp), enter, within[j], leaveY, 0)
        move(track, acts - span, within[j], leaveY, 0)
        move(track, acts + span, within[j], leaveY, 1)
        move(track, now, within[j], leaveY, 1)
        return { track, slot: first + j, c }
      })

      // Down out of the gate, then across to where the results are gathering:
      // one move as a state, not each term finding its own way.
      const away = travel(leaveY, bandY(k + 1))
      const sideways = Math.abs(shift) / (TRAVEL_RATE * speed)
      for (const m of made) {
        move(m.track, now + away, within[m.slot - first], bandY(k + 1))
        move(m.track, now + away + sideways, outOffsets[m.slot], bandY(k + 1))
        landed.push({ track: m.track, to: m.c.to, amp: plainAmp(m.c.amp) })
        landedAt.push(now + away + sideways)
      }

      // The bracket round them, made where they are made and travelling with
      // them. It is dropped later, when the results are all in.
      //
      // Where it starts is the same either way, because the results themselves
      // are: they are spread by `within` inside the gate and only shuffle to
      // `outOffsets` on the way down. What differs is *when* — an open gate
      // shows the results being made, so the bracket is round them from the
      // moment they exist; a closed one shows nothing until they leave, so it
      // forms as they emerge. Either way it is round them, never beside them.
      if (gave.length > 1) {
        travelling(
          k + 1,
          first,
          gave.length,
          inside ? acts : now,
          { x: within[0] - outOffsets[first], y: leaveY - bandY(k + 1) },
          [now, now + away, now + away + sideways],
        )
      }

      passes.push({
        layer: k,
        from: enter,
        to: now,
        landed: now + away + sideways,
        qubits: [1],
        kind: 'single',
      })
      now += away + sideways + BETWEEN / speed
    })

    // The state was whole from arriving until the last of it was taken out.
    cloud(k, layer.going.length, arrived, lastOut)

    /*
     * Tidying up, in the order the algebra does it:
     *
     *   ((0|1)|(0|-1))   what each term gave, still in its own bracket
     *   (0|1|0|-1)       the brackets dropped
     *   2*0              like terms added, opposites gone
     *   0                the common factor divided out
     *
     * Each is a step, because each is a different thing being said. Doing them
     * at once would leave the answer looking like it arrived by magic.
     */
    const allLanded = now
    const flatEnd = allLanded + FLATTEN / speed
    const mergeEnd = flatEnd + COLLECT / speed

    // The brackets made during the layer go as soon as the flattening starts.
    for (const bracket of brackets) {
      const stops = [...bracket.steps, ...bracket.tail(allLanded)]
      clouds.push({ box: bracket.box, stops })
      for (let i = bracket.from; i + 1 < bracket.from + bracket.n; i++) {
        bars.push({
          x: middle + (outOffsets[i] + outOffsets[i + 1]) / 2,
          cy: bandY(k + 1),
          h: m.qubit * 0.9,
          stops: stops.map((st) => ({ ...st })),
        })
      }
    }

    // The bracket round the lot, arriving only once the inner ones have gone —
    // that hand-over *is* the flattening step. It in turn hands over to the
    // bracket round the sum when there is one; when the whole thing collapses
    // to a single term there is nothing to hand over to, so it stays up until
    // the adding is done.
    // Twice the fade: once for the inner brackets to go, and again for the
    // outer one to arrive. `cloud` rises *into* the time it is given, so
    // anything less would start it while the others were still there.
    const flattened = brackets.length ? allLanded + BRACKET_FADE * 2 : allLanded
    cloud(
      k + 1,
      layer.gave.length,
      flattened,
      layer.summed.length > 1 ? flatEnd : mergeEnd,
    )

    const homes = spread(layer.summed.length)
    const targets = new Map(layer.summed.map((term, i) => [term.bits, i] as const))
    const groups = new Map<string, typeof landed>()
    for (const item of landed) {
      groups.set(item.to, [...(groups.get(item.to) ?? []), item])
    }

    const survivors: RowTrack[] = []
    for (const [to, list] of groups) {
      const slot = targets.get(to)
      const sum = list.reduce((n, item) => n + item.amp, 0)
      const home = slot === undefined ? at(list[0].track).x : homes[slot]
      const alone = list.length === 1 && sum !== 0
      for (const item of list) {
        move(item.track, flatEnd, at(item.track).x, at(item.track).y)
        move(item.track, mergeEnd, home, bandY(k + 1), alone ? 1 : 0)
      }
      if (sum === 0 || slot === undefined) continue
      if (alone) {
        survivors[slot] = list[0].track
        continue
      }
      const merged = open(to, sum, flatEnd, home, bandY(k + 1), 0)
      move(merged, mergeEnd, home, bandY(k + 1), 1)
      survivors[slot] = merged
    }
    // Dividing out the common factor, when there is one to divide out.
    now = mergeEnd
    const shrinks = layer.summed.some((t, i) => t.amp !== layer.left[i].amp)
    if (shrinks) {
      const reduceEnd = now + REDUCE / speed
      const finals = spread(layer.left.length)
      layer.left.forEach((term, i) => {
        const was = survivors[i]
        if (was) {
          move(was, now, at(was).x, at(was).y)
          move(was, reduceEnd, finals[i], bandY(k + 1), 0)
        }
        const track = open(term.bits, term.amp, now, finals[i], bandY(k + 1), 0)
        move(track, reduceEnd, finals[i], bandY(k + 1), 1)
        survivors[i] = track
      })
      now = reduceEnd
    }

    // The bracket round the added-up state, taking over from the one round the
    // results as they merge. It starts where that one leaves off rather than
    // where the merging finishes: between the two the terms are still there,
    // and a state does not stop being misty while it is being tidied.
    cloud(k + 1, layer.summed.length, flatEnd, now + 0.3)

    // A beat on the tidied state before the next gate starts taking it apart,
    // so there is a moment at which it is simply the answer.
    // Only the stages that do something. A single term giving two results has
    // no brackets to drop and nothing to add up: stopping on those would be
    // stopping twice on the same picture.
    const nested = brackets.length > 1
      || (brackets.length === 1 && brackets[0].n < layer.gave.length)
    const combined = layer.summed.length !== layer.gave.length
    tidies.push([
      ...(nested ? [{ t: flatEnd, phase: 'flatten' as const }] : []),
      ...(combined ? [{ t: mergeEnd, phase: 'merge' as const }] : []),
      ...(now > mergeEnd ? [{ t: now, phase: 'reduce' as const }] : []),
    ])
    collects.push(now)
    now += BETWEEN / speed
    waiting = layer.left.map((_, i) => survivors[i]).filter(Boolean)
  })

  // The finished state, and a beat on it before it runs round again.
  const duration = now + hold / speed
  if (working.length) {
    const last = working[working.length - 1]
    cloud(working.length, last.left.length, now, duration)
  }
  // Both ends matter: a keyframe list that stops short of the run leaves the
  // browser to fill the rest from the element's own style — fully opaque and
  // unmoved — so every track is carried explicitly to the end.
  for (const row of rows) {
    const end = at(row)
    if (end.t < duration) move(row, duration, end.x, end.y, end.alpha)
  }
  for (const puff of [...clouds, ...bars]) {
    const end = puff.stops[puff.stops.length - 1]
    if (end.t < duration) puff.stops.push({ ...end, t: duration })
  }

  return { duration, inside, rows, clouds, bars, passes, collects, tidies, loop }
}

/**
 * The moments worth stopping on when a superposition is worked through.
 *
 * One per term arriving at a gate and one per term having landed, then one for
 * the adding up — which is the step the whole animation exists for, and where
 * the course's rules 2 and 3 live.
 */
export function termSteps(timeline: TermTimeline): Step[] {
  const out: Step[] = [{ t: 0, layer: 0, phase: 'before' }]
  const layers = [...new Set(timeline.passes.map((p) => p.layer))].sort((a, b) => a - b)

  for (const layer of layers) {
    for (const spell of timeline.passes.filter((p) => p.layer === layer)) {
      const dwell = spell.to - spell.from
      // Arrived and nothing done yet; the gate acting, where it acts; then out
      // of it and standing below. Three things, three stops.
      out.push({ t: spell.from + dwell * 0.2, layer, phase: 'at' })
      out.push({ t: spell.from + dwell * 0.78, layer, phase: 'acting' })
      out.push({ t: spell.landed ?? spell.to, layer, phase: 'landed' })
    }
    for (const stage of timeline.tidies[layer] ?? []) out.push({ ...stage, layer })
  }

  return out
}

/** Where a row is, and how visible, at `t`. */
export function rowAt(track: RowTrack, t: number): { x: number; y: number; alpha: number } {
  const { stops } = track
  if (t <= stops[0].t) return stops[0]
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1]
    const b = stops[i]
    if (t > b.t) continue
    const span = b.t - a.t
    const u = span <= 0 ? 1 : (t - a.t) / span
    return {
      x: a.x + (b.x - a.x) * u,
      y: a.y + (b.y - a.y) * u,
      alpha: a.alpha + (b.alpha - a.alpha) * u,
    }
  }
  return stops[stops.length - 1]
}

/** Where a cloud or bar is, and how visible, at `t`. */
export function fadeAt(track: { stops: Fade[] }, t: number): Fade {
  const { stops } = track
  if (t <= stops[0].t) return stops[0]
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1]
    const b = stops[i]
    if (t > b.t) continue
    const span = b.t - a.t
    const u = span <= 0 ? 1 : (t - a.t) / span
    return {
      t,
      x: a.x + (b.x - a.x) * u,
      y: a.y + (b.y - a.y) * u,
      alpha: a.alpha + (b.alpha - a.alpha) * u,
    }
  }
  return stops[stops.length - 1]
}

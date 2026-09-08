/**
 * Public entry point: source text in, SVG out. Everything runs in the browser.
 */

import { parseState, ParseError } from './state/parse'
import type { StateDoc } from './state/ast'
import { productWidth } from './state/ast'
import { isGateRun, parseCircuit } from './circuit/parse'
import { diracLines, diracOf, resolveCalculations, sideAmplitudes } from './circuit/simulate'
import { checkCircuit, checkState, type Check } from './check'
import type { QubitSpot } from './circuit/edit'
export type { QubitSpot } from './circuit/edit'
import { conceal, concealState, hasAnswer } from './conceal'
import {
  bandHeight, buildTermTimeline, buildTimeline,
  steps as animationSteps, termRun, termSteps, type Step as AnimationStep,
} from './circuit/animate'
import {
  animatedSvg, animatedTermSvg, animationBox, termAnimationBox,
} from './circuit/animate-svg'
import { layoutState, type DialMode } from './state/layout'
export type { DialMode } from './state/layout'
export { VERSION } from './version'
import { layoutCircuit, type CircuitGeometry, type CircuitLayout } from './circuit/layout'
import { DEFAULT_METRICS, type Metrics } from './render/primitives'
import { THEMES, renderPrims } from './render/themes'
import { bandGradients } from './render/band'
import { LIGHT_PALETTE, DARK_PALETTE, type Palette, type Theme, type ThemeId } from './render/theme'
import type { Box } from './svg'
import type { CircuitDoc, ViewGate } from './circuit/ast'
import type { TermTimeline, Timeline } from './circuit/animate'
import { frameAt } from './circuit/animate'
import { termFrameAt } from './circuit/animate-svg'
import { DEFAULT_SHAPE_ORDER, type ShapeName } from './shapes'

export interface RenderOptions {
  theme?: ThemeId
  palette?: Palette
  dark?: boolean
  scale?: number
  background?: boolean
  metrics?: Partial<Metrics>
  shapeOrder?: ShapeName[]
  /**
   * Draw a calculated state as a product where it separates, rather than as
   * one cloud of terms. On by default: it is how the course writes answers.
   */
  factorCalculated?: boolean
  /**
   * Write a measurement outcome's likelihood exactly where a percentage would
   * have to round — `9/13` rather than `69%`. An even split still reads `50%`.
   */
  exactOdds?: boolean
  /**
   * Draw an overall minus sign on a calculated state rather than normalising it
   * away. Off by default — it is unobservable, so it is noise unless the figure
   * exists to show a phase flip.
   */
  keepSign?: boolean
  /**
   * Show what a gate does to the state while it is inside it. On by default;
   * off draws the gate as a closed box that qubits go into and come out of.
   * A source's own `inside=` says otherwise.
   */
  animateInside?: boolean
  /**
   * Show the state after this many layers, worked out.
   *
   * The same `calculate` a source can ask for, put in by the viewer instead:
   * a circuit can be walked a gate at a time without editing it.
   */
  step?: number | null
  /**
   * Draw an animation's first instant instead of the animation.
   *
   * A moving drawing is CSS inside a self-contained SVG, and a rasteriser goes
   * through an `<img>` — which catches whatever frame the browser happens to be
   * on, so a PNG of an animation was whatever moment it was asked at. A still
   * has to be a decided moment, and the beginning is the one that means
   * something: it is the figure before anything has happened to it.
   */
  still?: boolean
  /**
   * Rename the ids this drawing defines.
   *
   * A drawing is a standalone SVG document and names its gradients and filters
   * accordingly. Put two on one page and the names collide — `url(#ms-pipe)`
   * finds whichever came first, and if that one happens to sit in a hidden
   * subtree the shapes referring to it are painted with nothing at all. Give
   * each surface that inlines a drawing its own prefix and they stop reaching
   * into each other.
   */
  idPrefix?: string
  /**
   * Mark the gate written on this source line as being placed.
   *
   * For a drag: the drawing shows what dropping here would give, and this says
   * which part of it is the thing in hand.
   */
  highlight?: number
  /**
   * Draw what `answer` marks, rather than hiding it behind unknowns. Off by
   * default: a figure with an answer in it is a question until it is asked.
   */
  answers?: boolean
  /**
   * Settle the claims the diagram makes — that an equation holds, that a
   * circuit's written output is the one it produces. On by default; it costs a
   * simulation of a diagram already being drawn.
   */
  check?: boolean
  /**
   * Draw a term's phase as an angle rather than spelling it as a sign.
   *
   * `auto` — the default — shows a dial only where a sign cannot say it, so a
   * state whose terms are all real is drawn exactly as it always was. `always`
   * puts one on every term; `never` restores the sign and the `i` everywhere.
   */
  dial?: DialMode
  /**
   * Redraw gradient-filled rectangles as stacks of solid-colour bands.
   *
   * For embedding in a PDF read in Apple's Preview, which does not render a
   * gradient shading once the drawing is placed inside another document. The
   * bands look the same but are plain solid fills, so the depth on the pipes and
   * gate boxes survives while the figure stays vector. Off by default; the
   * smooth gradients are better wherever the reader supports them.
   */
  bandedGradients?: boolean
}

export interface RenderResult {
  svg: string
  kind: 'state' | 'circuit'
  width: number
  height: number
  /** Absent when the diagram claims nothing this could settle. */
  check?: Check
  /** True when the source marks something with `answer`, so it can be shown. */
  hasAnswer?: boolean
  /** How many layers a circuit has, so it can be stepped through. */
  layers?: number
  /**
   * How many wires the register has.
   *
   * Reported for a state as well as a circuit, because a state *is* a register
   * — it is just one that has had nothing done to it yet, and a gate dropped
   * onto it has to land on one of its wires.
   */
  qubits?: number
  /**
   * Where the wires and layers ended up, for pointing at the drawing.
   *
   * The grid a drop is hit-tested against. Circuits only — a state has no
   * layers to aim at.
   */
  geometry?: CircuitGeometry
  /**
   * Every qubit in the drawing that leads back to a character in the source.
   *
   * What makes a qubit something to click rather than only to look at: each one
   * says where it is on the page and which letter of the source drew it.
   */
  qubitSpots?: QubitSpot[]
  /**
   * The state the drawing ends on, written in Dirac notation.
   *
   * Beside the diagram rather than in it: it is text, and text belongs where it
   * can be selected and copied. One line per outcome once there is a
   * measurement, since there is then no single state to write.
   */
  dirac?: string[]
  /** Present when the SVG plays rather than standing still. */
  animation?: {
    /** Seconds for one pass through, including the pause at the end. */
    duration: number
    /** Moments worth stopping on: four per gate, plus the state going in. */
    steps: AnimationStep[]
    /** Whether the file repeats of its own accord. */
    loop: boolean
  }
}

const CIRCUIT_KEYWORDS = new Set([
  'qubits', 'in', 'out', 'view', 'show', 'header', 'labels',
  'h', 'x', 'y', 'z', 's', 't', 'i', 'id', 'identity', 'pete', 'not',
  'cnot', 'cx', 'cz', 'toffoli', 'ccnot', 'ccx', 'swap',
  'measure', 'm', 'box', 'gate', 'blank', 'tabulate', 'table', 'chart', 'plot', 'amplitude', 'amplitudes',
  'probability', 'probabilities', 'animate', 'answer',
])

/**
 * Guess whether the source describes a circuit or a bare state.
 *
 * A cheap first pass: a captioned state like `measure : 00|11` will be guessed
 * wrong, which `render` then corrects by falling back to the other parser.
 */
export function detectMode(source: string): 'state' | 'circuit' {
  for (const raw of source.split('\n')) {
    const line = raw.replace(/(^|\s)#.*$/, '').trim()
    if (!line) continue
    if (/^-{3,}$/.test(line)) return 'circuit'
    const first = line.split(/[\s;]+/)[0].toLowerCase()
    if (CIRCUIT_KEYWORDS.has(first)) return 'circuit'
    // `RZ(45)` is one word, and a bracket is the last thing a state can start with.
    if (/^(rx|ry|rz|p)\(\s*-?[\d.]+\s*\)$/.test(first)) return 'circuit'
    // `HH` is a row of gates, not a keyword and not anything a state could be.
    if (/^[a-z]+$/.test(first) && isGateRun(first)) return 'circuit'
  }
  return 'state'
}

/**
 * Everything an animation needs, whichever kind it turns out to be.
 *
 * Shared by the moving picture and by any still taken from it: laying the
 * circuit out twice, once here and once for frames, is how the two would come
 * to disagree about where anything is.
 */
type Prepared =
  | { terms: false; timeline: Timeline; layout: CircuitLayout; box: Box }
  | { terms: true; timeline: TermTimeline; layout: CircuitLayout; box: Box }

/**
 * Put a worked-out state after `step` layers, if one was asked for.
 *
 * Injected as the view the parser would have built for a bare `calculate` on
 * that line, so everything downstream — the arithmetic, the layout, the check —
 * treats it as though it had been written. Stepping is then a way of reading a
 * circuit rather than a mode the rest of the code has to know about.
 */
function stepped(doc: CircuitDoc, step: number | null | undefined): CircuitDoc {
  if (step === null || step === undefined || !doc.layers.length) return doc
  const at = Math.max(0, Math.min(doc.layers.length, Math.round(step)))
  const view: ViewGate = {
    kind: 'view',
    qubits: Array.from({ length: doc.qubits }, (_, i) => i + 1),
    calculate: true,
  }
  return {
    ...doc,
    // No source line: the injected view is the viewer's, not the author's.
    layers: [...doc.layers.slice(0, at), { gates: [view], lines: [] }, ...doc.layers.slice(at)],
  }
}

/**
 * How many of a stepped document's layers to run.
 *
 * The injected view is a layer of the document but not a layer of the circuit,
 * and it does nothing, so counting up to the step lands on exactly the state
 * drawn beside it.
 */
const stepAt = (doc: CircuitDoc, step: number | null | undefined): number =>
  step === null || step === undefined
    ? doc.layers.length
    : Math.max(0, Math.min(doc.layers.length - 1, Math.round(step)))

function prepareAnimation(
  doc: CircuitDoc,
  layout: CircuitLayout,
  theme: Theme,
  metrics: Metrics,
  shapeOrder: ShapeName[],
  opts: RenderOptions,
): Prepared {
  const working = termRun(doc)
  const inside = opts.animateInside ?? true

  // A single term is one row of qubits on the wires, which is what the
  // travelling animation already draws — so the simpler picture is kept for it,
  // individual qubits and crossing swaps and all. Only a state with more than
  // one term needs the queue.
  if (!working.some((w) => w.going.length > 1 || w.gave.length > 1)) {
    const timeline = buildTimeline(doc, layout.geometry, { inside, ...doc.animate })
    return { terms: false, timeline, layout, box: animationBox(layout, timeline, metrics) }
  }

  // Laid out twice: the bands have to be measured before the circuit can make
  // room for them, and the rows placed once it has. Every band is one row tall
  // — a state's terms stand side by side, not stacked.
  const bands = Array.from({ length: doc.layers.length + 1 }, () => bandHeight(metrics))
  const banded = layoutCircuit(doc, {
    metrics,
    shapeOrder,
    attach: theme.attach,
    bareEnds: true,
    bands,
  })
  const timeline = buildTermTimeline(working, banded.geometry, metrics, { inside, ...doc.animate })
  return {
    terms: true,
    timeline,
    layout: banded,
    box: termAnimationBox(banded, timeline, metrics),
  }
}

/**
 * Run something that may refuse, and shrug if it does.
 *
 * Dirac notation is offered alongside the drawing, never instead of it: a state
 * whose arithmetic cannot be followed still draws perfectly well, and losing
 * the figure over a line of text nobody asked for would be the wrong trade.
 */
function attempt<T>(f: () => T): T | undefined {
  try {
    return f()
  } catch {
    return undefined
  }
}

/** The written states of a document that is nothing but states. */
function diracForState(doc: StateDoc): string[] | undefined {
  // Only the last row: a stack of states is usually one worked through, and
  // writing out every step would be a wall of text beside the picture of it.
  const row = doc.rows[doc.rows.length - 1]
  const side = row?.sides[0]
  if (!side) return undefined
  return attempt(() => [diracOf(sideAmplitudes(side))])
}

/** Every id the emitters define, so a rename can be exact rather than fuzzy. */
const DEFINED_IDS = [
  'ms-pipe', 'ms-gate', 'ms-shadow', 'ms-qubit-shadow', 'ms-qubit-lit', 'ms-qubit-dim',
]

/** The same drawing with its ids under a different name. */
function renamed(svg: string, prefix: string): string {
  if (prefix === 'ms') return svg
  let out = svg
  for (const id of DEFINED_IDS) {
    const to = id.replace(/^ms/, prefix)
    out = out.split(`id="${id}"`).join(`id="${to}"`).split(`url(#${id})`).join(`url(#${to})`)
  }
  return out
}

export function render(source: string, opts: RenderOptions = {}): RenderResult {
  const metrics: Metrics = { ...DEFAULT_METRICS, ...opts.metrics }
  const shapeOrder = opts.shapeOrder ?? DEFAULT_SHAPE_ORDER
  const theme = THEMES[opts.theme ?? 'solid']
  const palette = opts.palette ?? (opts.dark ? DARK_PALETTE : LIGHT_PALETTE)

  const wantCheck = opts.check ?? true

  // Rename this drawing's ids, then optionally band its gradients for Preview.
  // Banding is for still figures only: a moving drawing keeps its gradients so
  // the CSS animation is unaffected, and it is never a PDF anyway.
  const finish = (svg: string): string => {
    const prefix = opts.idPrefix ?? 'ms'
    const named = renamed(svg, prefix)
    // The prefix is handed on: banding invents clip paths of its own, and it
    // runs after the renaming that would otherwise have namespaced them.
    return opts.bandedGradients ? bandGradients(named, undefined, prefix) : named
  }

  const build = (kind: 'state' | 'circuit') => {
    if (kind === 'state') {
      // A state document is the whole source, so every qubit in it is at the
      // offset it says it is.
      const doc = parseState(source, 0)
      return {
        doc: undefined,
        layers: undefined,
        // The widest row: a state narrower than another describes the wires it
        // names and leaves the rest alone, which is the usual reading.
        qubits: Math.max(0, ...doc.rows.map((r) => productWidth(r.sides[0]))),
        dirac: diracForState(doc),
        answered: hasAnswer(doc),
        // Checked before concealing: the claim is the answer the source holds,
        // whether or not the drawing is showing it.
        check: wantCheck ? checkState(doc) : undefined,
        layout: layoutState(opts.answers ? doc : concealState(doc), {
        metrics,
        shapeOrder,
        dial: opts.dial,
      }),
      }
    }
    // `calculate` is resolved between parsing and layout: it needs the whole
    // circuit to work anything out, and layout should only ever see states.
    // Checking happens after, where a calculated view can still be told apart
    // from a written one by its `calculate` flag.
    const doc = resolveCalculations(stepped(parseCircuit(source), opts.step), {
      factor: opts.factorCalculated ?? true,
      exactOdds: opts.exactOdds,
      keepSign: opts.keepSign,
      dial: opts.dial,
    })
    // An animation draws its own ends: the qubits travelling *are* the input
    // and output, so leaving the written ones in would stand a copy at each.
    const shown = opts.answers ? doc : conceal(doc)
    return {
      doc,
      // The injected step is not one of the circuit's own layers.
      layers: doc.layers.length - (opts.step === null || opts.step === undefined ? 0 : 1),
      qubits: doc.qubits,
      // Read at the step being shown, not at the end: the written state and the
      // drawn one have to be the same state, or the text quietly contradicts
      // the picture above it.
      dirac: attempt(() =>
        diracLines(doc, stepAt(doc, opts.step), { keepSign: opts.keepSign }),
      ),
      answered: hasAnswer(doc),
      check: wantCheck ? checkCircuit(doc) : undefined,
      layout: layoutCircuit(shown, {
        dial: opts.dial,
        metrics,
        shapeOrder,
        attach: theme.attach,
        bareEnds: !!doc.animate,
        highlight: opts.highlight,
      }),
    }
  }

  // A source with no circuit keyword in it parses as both — as a bare state, or
  // as a circuit that is nothing but an input state — so the guess is trusted
  // whenever it parses, and the fallback is only for when it does not. On a
  // genuine syntax error both fail; report the guessed kind's message, since
  // that is the one the author was more likely writing.
  const guess = detectMode(source)
  let kind = guess
  let built
  try {
    built = build(guess)
  } catch (err) {
    const other = guess === 'state' ? 'circuit' : 'state'
    try {
      built = build(other)
      kind = other
    } catch {
      throw err
    }
  }
  const { doc, layout, check, answered, layers, qubits, dirac } = built
  const geometry = 'geometry' in layout ? layout.geometry : undefined

  /**
   * The qubits that can be pointed at, where they ended up.
   *
   * Taken off the finished drawing rather than off the document, so they are in
   * the coordinates the drawing is in and have been through every translation
   * the layout applied. A qubit whose position the parser could not state
   * honestly is not here at all — better to be unclickable than to be clickable
   * and wrong.
   */
  const spots: QubitSpot[] = layout.prims.flatMap((p) =>
    p.t === 'qubit' && p.at !== undefined
      ? [{ at: p.at, value: p.value, cx: p.cx, cy: p.cy, size: p.size }]
      : [],
  )

  // An animation is a different document, not a different drawing: the still
  // path cannot produce it, and the moving one has no use for the still box.
  if (doc?.animate && 'geometry' in layout) {
    const run = prepareAnimation(doc, layout, theme, metrics, shapeOrder, opts)

    // Asked for a still: the first instant, drawn as an ordinary figure. It
    // reports no `animation`, so nothing downstream offers to play it.
    if (opts.still) {
      const prims = run.terms
        ? termFrameAt(run.layout, run.timeline, 0, metrics)
        : frameAt(run.layout, run.timeline, 0, metrics)
      return {
        svg: finish(
          renderPrims(prims, run.box, theme, palette, metrics, {
            scale: opts.scale,
            background: opts.background,
          }),
        ),
        kind,
        width: run.box.w + theme.bleed.left + theme.bleed.right,
        height: run.box.h + theme.bleed.top + theme.bleed.bottom,
        check: check?.checked ? check : undefined,
        hasAnswer: answered || undefined,
        dirac,
      }
    }
    const svg = run.terms
      ? animatedTermSvg(run.layout, run.timeline, run.box, theme, palette, metrics, {
          scale: opts.scale,
          background: opts.background,
        })
      : animatedSvg(run.layout, run.timeline, run.box, theme, palette, metrics, {
          scale: opts.scale,
          background: opts.background,
        })
    return {
      svg: renamed(svg, opts.idPrefix ?? 'ms'),
      kind,
      width: run.box.w + theme.bleed.left + theme.bleed.right,
      height: run.box.h + theme.bleed.top + theme.bleed.bottom,
      check: check?.checked ? check : undefined,
      hasAnswer: answered || undefined,
      dirac,
      animation: {
        duration: run.timeline.duration,
        steps: run.terms ? termSteps(run.timeline) : animationSteps(run.timeline),
        loop: run.timeline.loop,
      },
    }
  }

  const svg = renderPrims(layout.prims, layout.box, theme, palette, metrics, {
    scale: opts.scale,
    background: opts.background,
  })

  return {
    svg: finish(svg),
    kind,
    width: layout.box.w + theme.bleed.left + theme.bleed.right,
    height: layout.box.h + theme.bleed.top + theme.bleed.bottom,
    // Nothing checkable is the common case; saying nothing beats saying "0 of 0".
    check: check?.checked ? check : undefined,
    hasAnswer: answered || undefined,
    layers,
    qubits,
    dirac,
    geometry,
    // Only where there are any: an empty list would read as "this drawing has
    // no qubits", which is a different claim.
    qubitSpots: spots.length ? spots : undefined,
  }
}

/** One still of an animation, and when in the run it is. */
export interface Frame {
  t: number
  svg: string
}

export interface FramesResult {
  frames: Frame[]
  width: number
  height: number
  duration: number
  fps: number
  /** Whether the run is meant to repeat, which a saved file has to be told. */
  loop: boolean
}

/**
 * An animation as a run of stills.
 *
 * The moving picture is CSS, which cannot be seeked from outside a browser and
 * cannot be handed to an encoder. These come from the same timeline instead —
 * sampled rather than played — so a GIF and the SVG agree about where things
 * are, and each frame is an ordinary drawing that any rasteriser can take.
 *
 * Frames cover the whole run including the pause at the end, so a loop closes.
 */
export function renderFrames(
  source: string,
  opts: RenderOptions & { fps?: number } = {},
): FramesResult {
  // Not rounded to a whole number: a GIF's frame delay is in hundredths of a
  // second, so the rates it can express exactly are mostly fractional, and
  // sampling at one of those is how a saved file keeps the run's true length.
  const fps = Math.max(1, Math.min(60, opts.fps ?? 30))
  const theme = THEMES[opts.theme ?? 'solid']
  const palette = opts.dark ? DARK_PALETTE : LIGHT_PALETTE
  const metrics = { ...DEFAULT_METRICS, ...opts.metrics }
  const shapeOrder = opts.shapeOrder ?? DEFAULT_SHAPE_ORDER

  const doc = resolveCalculations(parseCircuit(source), {
    factor: opts.factorCalculated ?? true,
    exactOdds: opts.exactOdds,
    keepSign: opts.keepSign,
  })
  if (!doc.animate) throw new Error('this diagram does not animate — add an "animate" line')

  const layout = layoutCircuit(doc, {
    metrics,
    shapeOrder,
    attach: theme.attach,
    bareEnds: true,
  })
  const run = prepareAnimation(doc, layout, theme, metrics, shapeOrder, opts)

  const count = Math.max(1, Math.round(run.timeline.duration * fps))
  const frames: Frame[] = []
  for (let i = 0; i < count; i++) {
    const t = (i / count) * run.timeline.duration
    const prims = run.terms
      ? termFrameAt(run.layout, run.timeline, t, metrics)
      : frameAt(run.layout, run.timeline, t, metrics)
    frames.push({
      t,
      svg: renderPrims(prims, run.box, theme, palette, metrics, {
        scale: opts.scale,
        background: opts.background,
      }),
    })
  }

  const scale = opts.scale ?? 1
  return {
    frames,
    width: (run.box.w + theme.bleed.left + theme.bleed.right) * scale,
    height: (run.box.h + theme.bleed.top + theme.bleed.bottom) * scale,
    duration: run.timeline.duration,
    fps,
    loop: run.timeline.loop,
  }
}

export { ParseError }
export type { Check } from './check'
export type { Step as AnimationStep } from './circuit/animate'
export { THEMES, THEME_IDS } from './render/themes'
export { LIGHT_PALETTE, DARK_PALETTE } from './render/theme'
export type { Palette, ThemeId } from './render/theme'
export { DEFAULT_SHAPE_ORDER, SHAPE_NAMES } from './shapes'
export type { ShapeName } from './shapes'
export { DEFAULT_METRICS } from './render/primitives'
export type { Metrics } from './render/primitives'

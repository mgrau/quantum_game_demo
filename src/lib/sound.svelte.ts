/**
 * Sound, synthesised rather than sampled.
 *
 * A handful of oscillators and envelopes, so the game ships no audio files and
 * a mute is genuinely silent rather than a muted download. Nothing here is
 * music; it is the difference between a gate that lands and a gate that does
 * not, told to the ear so the eye does not have to check.
 *
 * The context is built on first use, never at load. Browsers refuse to start
 * audio without a gesture, and every one of these is called from a click or a
 * drop — so by the time one runs, permission has already been earned.
 */

const STORE = 'quantum-game/sound'

function remembered(): boolean {
  try {
    return localStorage.getItem(STORE) !== 'off'
  } catch {
    return true
  }
}

export const audio = $state({ on: remembered() })

export function toggleSound(): void {
  audio.on = !audio.on
  try {
    localStorage.setItem(STORE, audio.on ? 'on' : 'off')
  } catch {
    // Nothing to be done, and nothing worth interrupting play for.
  }
}

let ctx: AudioContext | null = null

function context(): AudioContext | null {
  if (!audio.on || typeof AudioContext === 'undefined') return null
  ctx ??= new AudioContext()
  // Suspended is the normal state before the first gesture, and after a tab
  // has been in the background.
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

interface Note {
  freq: number
  /** Seconds from now. */
  at?: number
  length?: number
  gain?: number
  type?: OscillatorType
}

function play(notes: Note[]): void {
  const c = context()
  if (!c) return
  const now = c.currentTime

  for (const note of notes) {
    const osc = c.createOscillator()
    const amp = c.createGain()
    osc.type = note.type ?? 'sine'
    osc.frequency.value = note.freq

    const at = now + (note.at ?? 0)
    const length = note.length ?? 0.08
    const peak = note.gain ?? 0.1

    // A hard start is a click, so every note gets a few milliseconds of attack
    // and an exponential tail. Exponential cannot reach zero, hence the floor.
    amp.gain.setValueAtTime(0.0001, at)
    amp.gain.linearRampToValueAtTime(peak, at + 0.008)
    amp.gain.exponentialRampToValueAtTime(0.0001, at + length)

    osc.connect(amp).connect(c.destination)
    osc.start(at)
    osc.stop(at + length + 0.02)
  }
}

/** Lifting a gate off the palette. */
export const pick = () => play([{ freq: 680, length: 0.05, gain: 0.05 }])

/** A gate landing on the wires. */
export const place = () =>
  play([{ freq: 320, length: 0.1, gain: 0.08, type: 'triangle' }])

/** A gate carried off the drawing. */
export const scrap = () =>
  play([
    { freq: 240, length: 0.12, gain: 0.06, type: 'sawtooth' },
    { freq: 160, at: 0.05, length: 0.12, gain: 0.05, type: 'sawtooth' },
  ])

/** Turning an input qubit over. */
export const flip = () => play([{ freq: 520, length: 0.06, gain: 0.05, type: 'triangle' }])

/** Solved. A rising major chord, which is the oldest trick there is. */
export const fanfare = () =>
  play([
    { freq: 523.25, at: 0, length: 0.22 },
    { freq: 659.25, at: 0.08, length: 0.22 },
    { freq: 783.99, at: 0.16, length: 0.26 },
    { freq: 1046.5, at: 0.24, length: 0.5, gain: 0.13 },
  ])

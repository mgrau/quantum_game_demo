/**
 * The numbers an amplitude can be.
 *
 * Gaussian integers — `a + bi` with both parts whole. Not floating point, and
 * that is the whole point: the arithmetic here has always been exact, because
 * the notation is exact. `H` is applied unnormalised so `H·H = 2I` and the
 * factor divides straight back out; adding `i` to the picture costs nothing,
 * because the Gaussian integers are closed under everything the notation can
 * currently express — `X`, `Y`, `Z`, `S`, `H` and every controlled form of them.
 *
 * What is *not* in here is `T`, whose `e^{iπ/4}` needs a square root of two.
 * That wants the eighth roots of unity, `Z[ζ₈]`, which is a bigger type and a
 * bigger change to the probabilities — `|z|²` stops being an integer. Left for
 * when `T` is wanted; nothing here forecloses it.
 *
 * The other reason for whole numbers: `|a + bi|² = a² + b²` is an integer, so
 * the Born rule, the odds fractions and the exact-fraction display all keep
 * working on integers exactly as they did.
 */

export interface Cx {
  re: number
  im: number
}

export const ZERO: Cx = { re: 0, im: 0 }
export const ONE: Cx = { re: 1, im: 0 }
/** `i`, a quarter turn. */
export const I: Cx = { re: 0, im: 1 }

/**
 * IEEE hands back `-0` wherever a term cancels or a sign is flipped, and `-0`
 * is not the zero anything downstream expects: it prints as `-0`, and it fails
 * an equality written the obvious way. Adding zero settles it, since `-0 + 0`
 * is `+0`.
 */
const plain = (n: number): number => n + 0

export const cx = (re: number, im = 0): Cx => ({ re: plain(re), im: plain(im) })

export const add = (a: Cx, b: Cx): Cx => cx(a.re + b.re, a.im + b.im)

export const mul = (a: Cx, b: Cx): Cx =>
  cx(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re)

export const neg = (a: Cx): Cx => cx(-a.re, -a.im)

/** Multiply by a whole number, which is most of what the gates do. */
export const times = (a: Cx, k: number): Cx => cx(a.re * k, a.im * k)

/**
 * Anything smaller than this is nothing.
 *
 * With whole numbers a term either cancels or it does not, and the tolerance
 * never fires. With cosines in the arithmetic it is the difference between a
 * term cancelling and the state keeping a phantom worth `1e-17`.
 */
const TINY = 1e-12

export const isZero = (a: Cx): boolean => Math.abs(a.re) < TINY && Math.abs(a.im) < TINY

/** True where both parts are whole — which is what lets a state be drawn. */
export const isWhole = (a: Cx): boolean => Number.isInteger(a.re) && Number.isInteger(a.im)

export const eq = (a: Cx, b: Cx): boolean => a.re === b.re && a.im === b.im

/**
 * The squared magnitude, and an integer.
 *
 * This is what the Born rule needs, which is why the whole scheme holds
 * together: a probability stays a ratio of two integers however complex the
 * amplitudes get.
 */
export const abs2 = (a: Cx): number => a.re * a.re + a.im * a.im

/** True when there is no phase to speak of — the case the notation can draw. */
export const isReal = (a: Cx): boolean => a.im === 0

/** Greatest common divisor, over both parts at once. */
export function gcd(a: number, b: number): number {
  let x = Math.abs(a)
  let y = Math.abs(b)
  while (y) [x, y] = [y, x % y]
  return x
}

/**
 * The largest whole number dividing every part of every one of these.
 *
 * One, where any part is not whole: a common factor of a set of cosines is not
 * a thing, and dividing by whatever `gcd` made of them would be worse than
 * leaving the numbers alone.
 */
export const commonFactor = (all: Cx[]): number =>
  all.every(isWhole) ? all.reduce((g, a) => gcd(gcd(g, a.re), a.im), 0) || 1 : 1

/** Divide through by a whole number, which is only ever done by a factor of it. */
export const over = (a: Cx, k: number): Cx => cx(a.re / k, a.im / k)

/**
 * How to write one, in the ordinary way.
 *
 * `1` and `-1` come out bare because that is how an amplitude of one is
 * written; `i` and `-i` likewise, since `1i` reads as a mistake.
 */
export function show(a: Cx): string {
  // Rounded where it is not whole: `0.9659258262890683` is not something to
  // read off a figure. Two places, which is what a drawn state shows — the
  // written state and the drawn one are the same state, and saying `0.966`
  // beside a picture that says `0.97` invites the reader to wonder which.
  const n = (x: number) =>
    Number.isInteger(x) ? String(x) : x.toFixed(2).replace(/\.?0+$/, '')
  const im = a.im === 1 ? 'i' : a.im === -1 ? '-i' : `${n(a.im)}i`
  if (a.im === 0) return n(a.re)
  if (a.re === 0) return im
  return `${n(a.re)}${a.im > 0 ? '+' : ''}${im}`
}

/**
 * Which of two amplitudes comes first when a state has to pick a sign.
 *
 * A state's overall phase is not observable, so one is chosen and stuck to. For
 * real amplitudes that has always meant "make the first term positive"; the
 * same rule generalises to turning the first term onto the positive real axis
 * where a quarter turn can get it there, and leaving it alone where it cannot.
 */
export function unitToClear(a: Cx): Cx {
  if (a.re > 0 && a.im === 0) return ONE
  if (a.re < 0 && a.im === 0) return { re: -1, im: 0 }
  if (a.im > 0 && a.re === 0) return { re: 0, im: -1 }
  if (a.im < 0 && a.re === 0) return I
  return ONE
}

/**
 * Cloud outline generation.
 *
 * The outline is a ring of outward-bulging arcs placed around the content at a
 * constant offset. The ring follows a **rounded rectangle**, not an ellipse: an
 * ellipse large enough to contain a wide, short row of qubits has to inflate in
 * both axes, which left tall empty margins above and below long superpositions.
 * A rounded rect hugs the content equally at any aspect ratio.
 *
 * Bump radii and positions are jittered from a seeded PRNG so the result looks
 * drawn by hand but is identical on every re-render — important when the same
 * figure is regenerated for a problem set.
 */

import { Path, seededRandom, type Box } from '../svg'

export interface Cloud {
  d: string
  /** Outer bounds including the bumps. */
  box: Box
}

interface Pt {
  x: number
  y: number
}

/** A point on the ring, with the outward normal used to jitter it. */
interface RingPt extends Pt {
  nx: number
  ny: number
}

/** Target arc length between bumps. Smaller means more, tighter lobes. */
const BUMP_SPACING = 34

function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    const straddles = a.y > p.y !== b.y > p.y
    if (straddles && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

/** Rounded rectangle: straight runs joined by quarter-circle corners. */
class RoundedRect {
  readonly r: number
  readonly sx: number
  readonly sy: number
  readonly arc: number
  readonly perimeter: number

  constructor(readonly x: number, readonly y: number, readonly w: number, readonly h: number) {
    this.r = Math.min(w, h) / 2
    this.sx = Math.max(0, w - 2 * this.r)
    this.sy = Math.max(0, h - 2 * this.r)
    this.arc = (Math.PI * this.r) / 2
    this.perimeter = 2 * this.sx + 2 * this.sy + 4 * this.arc
  }

  /** Point at arc-length `t`, walking clockwise from the top-left corner. */
  at(t: number): RingPt {
    const { x, y, w, h, r, sx, sy, arc } = this
    let d = ((t % this.perimeter) + this.perimeter) % this.perimeter

    if (d < sx) return { x: x + r + d, y, nx: 0, ny: -1 }
    d -= sx
    if (d < arc) return this.corner(x + w - r, y + r, -Math.PI / 2 + d / r)
    d -= arc
    if (d < sy) return { x: x + w, y: y + r + d, nx: 1, ny: 0 }
    d -= sy
    if (d < arc) return this.corner(x + w - r, y + h - r, d / r)
    d -= arc
    if (d < sx) return { x: x + w - r - d, y: y + h, nx: 0, ny: 1 }
    d -= sx
    if (d < arc) return this.corner(x + r, y + h - r, Math.PI / 2 + d / r)
    d -= arc
    if (d < sy) return { x, y: y + h - r - d, nx: -1, ny: 0 }
    d -= sy
    return this.corner(x + r, y + r, Math.PI + d / r)
  }

  private corner(cx: number, cy: number, angle: number): RingPt {
    const nx = Math.cos(angle)
    const ny = Math.sin(angle)
    return { x: cx + this.r * nx, y: cy + this.r * ny, nx, ny }
  }
}

function ring(content: Box, padX: number, padY: number, jitter: number[]): Pt[] {
  const rect = new RoundedRect(
    content.x - padX,
    content.y - padY,
    content.w + 2 * padX,
    content.h + 2 * padY,
  )
  const count = jitter.length
  const step = rect.perimeter / count
  const wobble = Math.min(padX, padY) * 0.18

  return Array.from({ length: count }, (_, i) => {
    const p = rect.at(i * step)
    return { x: p.x + p.nx * jitter[i] * wobble, y: p.y + p.ny * jitter[i] * wobble }
  })
}

/**
 * Build a cloud enclosing `content`. `padX`/`padY` are the clearance between
 * the content box and the inner boundary of the outline.
 */
export function cloudPath(
  content: Box,
  seed: string,
  padX = 14,
  padY = 11,
  fluff = 1,
): Cloud {
  const rand = seededRandom(seed)
  // Fluffier means more lobes as well as rounder ones.
  const spacing = BUMP_SPACING / Math.max(0.2, fluff)

  const provisional = new RoundedRect(
    content.x - padX,
    content.y - padY,
    content.w + 2 * padX,
    content.h + 2 * padY,
  )
  const count = Math.max(8, Math.min(48, Math.round(provisional.perimeter / spacing)))
  const jitter = Array.from({ length: count }, () => rand() * 2 - 1)

  const corners: Pt[] = [
    { x: content.x, y: content.y },
    { x: content.x + content.w, y: content.y },
    { x: content.x + content.w, y: content.y + content.h },
    { x: content.x, y: content.y + content.h },
  ]

  // Chords cut inside the ring, so nudge the padding out until the polygon
  // through the sample points genuinely clears the content.
  let px = padX
  let py = padY
  let pts = ring(content, px, py, jitter)
  for (let guard = 0; guard < 40 && !corners.every((c) => pointInPolygon(c, pts)); guard++) {
    px += 1.5
    py += 1.5
    pts = ring(content, px, py, jitter)
  }

  const p = new Path().M(pts[0].x, pts[0].y)
  let maxBulge = 0
  for (let i = 0; i < count; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % count]
    const chord = Math.hypot(b.x - a.x, b.y - a.y)
    // Radius just above half the chord gives a rounded lobe; a larger radius
    // flattens it toward a straight edge. Never below half the chord, which
    // would be undrawable.
    const slack = Math.max(0, 1 / Math.max(0.2, fluff) - 1) * 2.2
    const r = (chord / 2) * Math.max(1.001, 1.06 + Math.abs(jitter[i]) * 0.34 + slack)
    maxBulge = Math.max(maxBulge, r - Math.sqrt(Math.max(0, r * r - (chord / 2) ** 2)))
    p.A(r, r, 0, 0, 1, b.x, b.y)
  }
  p.Z()

  const x0 = content.x - px - maxBulge
  const y0 = content.y - py - maxBulge
  return {
    d: p.toString(),
    box: {
      x: x0,
      y: y0,
      w: content.w + 2 * (px + maxBulge),
      h: content.h + 2 * (py + maxBulge),
    },
  }
}

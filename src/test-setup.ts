/**
 * The three geometry primitives jsdom does not have.
 *
 * The drag layer measures the drawing to work out where a pointer is aiming:
 * `getScreenCTM` for the mapping from screen to diagram, and `DOMPoint`
 * /`DOMMatrix` to apply it. jsdom implements no SVG layout at all, so all three
 * are missing and every one of them is stubbed here as the identity.
 *
 * Be clear about what that does and does not prove. With an identity mapping,
 * a client coordinate *is* a diagram coordinate, so these tests say nothing
 * about zoom, scroll or scaling — a real browser is the only place those are
 * settled. What they do prove is the part that was actually wrong: that the
 * host is wired up, that a carry reaches the editing rules, and that letting go
 * writes the source. That is the wiring, and the wiring is what breaks.
 */

// Most of the suite is pure and runs in Node, where there is no DOM to patch
// and nothing here to do.
const HAS_DOM = typeof Element !== 'undefined'

class StubMatrix {
  a = 1
  d = 1
  e = 0
  f = 0
  inverse() {
    return this
  }
}

class StubPoint {
  constructor(
    public x = 0,
    public y = 0,
  ) {}
  matrixTransform(m: StubMatrix) {
    return new StubPoint(this.x * m.a + m.e, this.y * m.d + m.f)
  }
}

if (HAS_DOM) {
  Object.assign(globalThis, { DOMMatrix: StubMatrix, DOMPoint: StubPoint })

  // The whole viewport, so a pointer anywhere counts as over the drawing.
  Element.prototype.getBoundingClientRect = (): DOMRect =>
    ({
      x: 0, y: 0, left: 0, top: 0, right: 400, bottom: 400, width: 400, height: 400,
      toJSON: () => ({}),
    }) as DOMRect

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(SVGElement.prototype as any).getScreenCTM = () => new StubMatrix()
}

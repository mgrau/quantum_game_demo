/**
 * Recursive-descent parser for the misty-state DSL.
 *
 * Grammar (whitespace insignificant, `#` starts a comment):
 *
 *   doc      := line*
 *   line     := [caption ':'] side ( relation side )* [':' note]
 *   relation := '=' | '!=' | '->'
 *   side     := termlist                     -- >1 term is implicitly one cloud
 *   termlist := term ( ('|' | ',') term )*
 *   term     := ['-' | '+'] [coeff] factor ( ['x'] factor )*
 *   coeff    := [digits] ['i'] ( '*' | &'(' ) -- '3*0', '3(0|1)', 'i*0', '2i*0'
 *   factor   := qubit | cloud | label
 *   qubit    := ('0' | '1' | '?') ['@' digits]
 *   cloud    := '(' termlist ')'
 *   label    := '"' text '"'
 *
 * `0|1` needs no outer parentheses: a bare top-level `|` wraps the line in a
 * cloud. `0(0|1)` is a bare qubit beside a cloud, and `(0|1)(0|1)` is a product
 * of two clouds.
 *
 * Factors juxtapose silently; `x` between them draws an explicit `×`, as in
 * `(0|1) x (0|1)`. `*` is not an alternative — it always introduces a
 * coefficient, so `3*0` stays 3·|0⟩.
 */

import type { CloudNode, Factor, Product, StateDoc, StateRow, Term } from './ast'
import { parseShapeSpec, SHAPE_LINE, SHAPE_SYMBOL_HELP, type ShapePick } from '../shapes'

export class ParseError extends Error {
  constructor(message: string, readonly index: number, readonly line: number) {
    super(message)
    this.name = 'ParseError'
  }
}

const RELATIONS: [string, string][] = [
  ['!=', '≠'],
  ['->', '→'],
  ['=', '='],
]

class Cursor {
  i = 0
  /**
   * `base` is where `src[0]` sits in the whole document, so `base + i` is an
   * offset anything holding the source can act on. Every string this parser is
   * handed is a slice of that document and keeps its positions, which is why
   * the one place that used to rewrite a line — dropping an `answer` keyword —
   * now blanks it instead.
   */
  constructor(readonly src: string, readonly line: number, readonly base?: number) {}

  get done(): boolean {
    this.ws()
    return this.i >= this.src.length
  }

  /**
   * Skip whitespace and `.`.
   *
   * `.` is an optional factor separator, purely for legibility in a long run:
   * `0.0.1.1` reads the same as `0011`.
   */
  ws(): void {
    while (this.i < this.src.length && /[\s.]/.test(this.src[this.i])) this.i++
  }

  peek(): string {
    this.ws()
    return this.src[this.i] ?? ''
  }

  /** Look ahead without skipping whitespace first. */
  raw(offset = 0): string {
    return this.src[this.i + offset] ?? ''
  }

  eat(s: string): boolean {
    this.ws()
    if (this.src.startsWith(s, this.i)) {
      this.i += s.length
      return true
    }
    return false
  }

  fail(msg: string): never {
    throw new ParseError(msg, this.i, this.line)
  }
}

function parseDigits(c: Cursor): string {
  let out = ''
  while (/[0-9]/.test(c.raw())) {
    out += c.raw()
    c.i++
  }
  return out
}

function parseFactor(c: Cursor): Factor | null {
  const ch = c.peek()
  if (ch === '') return null

  if (ch === '(') {
    c.eat('(')
    const terms = parseTermList(c)
    if (!c.eat(')')) c.fail('unclosed "(" — every cloud needs a matching ")"')
    return { kind: 'cloud', terms }
  }

  if (ch === '"') {
    c.eat('"')
    let text = ''
    while (c.i < c.src.length && c.raw() !== '"') {
      text += c.raw()
      c.i++
    }
    if (!c.eat('"')) c.fail('unclosed string literal')
    return { kind: 'label', text }
  }

  // One `?` is one unknown qubit, so `0?1` and `??0` read as you would expect.
  // A cloud of unknown contents is written `("???")` — quoted text in a cloud,
  // which also allows any other caption inside one.
  if (ch === '?') {
    c.ws()
    const at = c.base === undefined ? undefined : c.base + c.i
    c.i++
    return withShape(c, { kind: 'qubit', value: 'unknown', at })
  }

  if (ch === '0' || ch === '1') {
    c.ws()
    const at = c.base === undefined ? undefined : c.base + c.i
    c.i++
    return withShape(c, { kind: 'qubit', value: ch === '0' ? 0 : 1, at })
  }

  return null
}

/** Optional `@N` suffix pinning a qubit to the Nth shape (1-based). */
function withShape(c: Cursor, node: Factor): Factor {
  if (node.kind !== 'qubit') return node
  if (c.raw() === '@') {
    c.i++
    const d = parseDigits(c)
    if (!d) c.fail('"@" must be followed by a shape number, e.g. 0@3')
    const idx = parseInt(d, 10)
    if (idx < 1) c.fail('shape numbers start at 1')
    node.shapeIndex = idx - 1
  }
  return node
}

function parseTerm(c: Cursor): Term {
  let sign: 1 | -1 = 1
  if (c.eat('-')) sign = -1
  else c.eat('+')

  let coeff: number | undefined
  let imaginary = false
  c.ws()

  // A bare `i` is a quarter turn on its own: `i*01`, and `-i*01` with the sign
  // already taken above.
  if ((c.raw() === 'i' || c.raw() === 'I') && (c.raw(1) === '*' || c.raw(1) === '(')) {
    imaginary = true
    if (c.raw(1) === '*') c.i += 2
    else c.i += 1
  } else if (/[0-9]/.test(c.raw())) {
    // A digit run is a coefficient only when followed by `*` or `(`; otherwise
    // it is a sequence of qubits, so `00` stays two qubits and `3*0` is 3·|0⟩.
    const save = c.i
    const digits = parseDigits(c)
    // `2i*01` — the turn comes after the size, as it is said.
    const turned = c.raw() === 'i' || c.raw() === 'I'
    if (turned && (c.raw(1) === '*' || c.raw(1) === '(')) {
      imaginary = true
      coeff = parseInt(digits, 10)
      c.i += c.raw(1) === '*' ? 2 : 1
    } else if (c.raw() === '*') {
      c.i++
      coeff = parseInt(digits, 10)
    } else if (c.peek() === '(' && /[2-9]/.test(digits)) {
      // `3(0|1)` is 3·(|0⟩+|1⟩), but `0(0|1)` is a qubit beside a cloud — so a
      // digit run that could be qubits stays qubits. Use `1*(...)` to force it.
      coeff = parseInt(digits, 10)
    } else {
      c.i = save
    }
  }

  const factors: Factor[] = []
  for (;;) {
    const f = parseFactor(c)
    if (f) {
      factors.push(f)
      continue
    }
    // `x` between two factors is multiplication, drawn as `×`. Only *between*
    // them, so a trailing or doubled operator is caught below.
    const last = factors[factors.length - 1]
    if (last && last.kind !== 'op' && /[xX]/.test(c.peek())) {
      c.ws()
      c.i++
      factors.push({ kind: 'op', symbol: '×' })
      continue
    }
    // `*` belongs to a coefficient, and one was not found above.
    if (c.peek() === '*') {
      c.fail('"*" follows a number, as in 3*0 — write "x" to multiply two states')
    }
    break
  }

  if (!factors.length) {
    const ch = c.peek()
    if (ch) c.fail(`unexpected "${ch}" — expected a qubit (0, 1, ?) or a cloud "(...)"`)
    c.fail('expected a qubit or cloud here')
  }

  if (factors[factors.length - 1].kind === 'op') {
    c.fail('"×" needs something on both sides — e.g. (0|1) x (0|1)')
  }

  return { sign, coeff, imaginary: imaginary || undefined, factors }
}

/** `|` and `,` both separate terms; which one is *drawn* is a render setting. */
function parseTermList(c: Cursor): Term[] {
  const terms: Term[] = [parseTerm(c)]
  while (c.eat('|') || c.eat(',')) terms.push(parseTerm(c))
  return terms
}

/** A side is a term list; more than one term means the line is itself a cloud. */
function parseSide(c: Cursor): Product {
  const terms = parseTermList(c)
  // A lone plain term needs no cloud round it — but a turn is not plain, and
  // unwrapping one would drop the `i` on the floor.
  if (
    terms.length === 1 && terms[0].sign === 1 &&
    terms[0].coeff === undefined && !terms[0].imaginary
  ) {
    return { factors: terms[0].factors }
  }
  const cloud: CloudNode = { kind: 'cloud', terms }
  return { factors: [cloud] }
}

/**
 * Split a caption prefix like `50%:` from the state expression. Only treated as
 * a caption when the text before `:` contains something that cannot be state
 * syntax, so a stray colon never silently eats a real expression.
 */
function splitCaption(src: string): { caption?: string; rest: string } {
  const at = src.indexOf(':')
  if (at < 0) return { rest: src }
  const head = src.slice(0, at)
  if (/[(|,=]/.test(head)) return { rest: src }
  if (!/[^01?\s]/.test(head)) return { rest: src }
  return { caption: head.trim(), rest: src.slice(at + 1) }
}

function parseRow(src: string, lineNo: number, base?: number): StateRow {
  const { caption, rest } = splitCaption(src)
  // `splitCaption` takes the caption off the front, so what is left starts that
  // much further into the document.
  const c = new Cursor(rest, lineNo, base === undefined ? undefined : base + (src.length - rest.length))

  const sides: Product[] = []
  const relations: string[] = []

  for (;;) {
    sides.push(parseSide(c))
    c.ws()
    const rel = RELATIONS.find(([tok]) => c.src.startsWith(tok, c.i))
    if (!rel) break
    c.i += rel[0].length
    relations.push(rel[1])
  }

  // A colon *after* the state is an annotation on the right, mirroring the one
  // before it. Unambiguous because nothing else in the grammar reaches here
  // with a colon pending — this used to be a parse error.
  let note: string | undefined
  if (c.peek() === ':') {
    c.i++
    note = c.src.slice(c.i).trim() || undefined
    c.i = c.src.length
  }

  if (!c.done) c.fail(`unexpected "${c.peek()}"`)
  if (caption) sides[0].caption = caption
  if (note) sides[0].note = note
  return { sides, relations }
}

/**
 * `base` is where `text` starts in the document the caller is holding.
 *
 * Left `undefined` where a caller cannot say — a statement rebuilt from tokens
 * has no honest position — and then no qubit in it records one, so nothing
 * downstream will offer to edit a character it cannot actually find. Absent is
 * the safe answer; approximately right is not.
 *
 * Deliberately without a default. A default would turn "I do not know" into
 * "offset zero" for any caller that passed the uncertainty along, which is how
 * a qubit came to report the `q` of `qubits` as its own character.
 */
export function parseState(text: string, base?: number): StateDoc {
  const rows: StateRow[] = []
  let shapePicks: ShapePick[] | undefined
  const lines = text.split('\n')
  // Where each line begins in `text`, so a qubit can say where it was written.
  // `base` carries the same fact one level up: a circuit hands over a slice of
  // itself, and the offsets it gets back have to mean something in the whole.
  let lineStart = base ?? 0
  for (let i = 0; i < lines.length; i++) {
    const start = lineStart
    lineStart += lines[i].length + 1
    const bare = lines[i].replace(/(^|\s)#.*$/, '')
    const line = bare.trim()
    if (!line) continue
    // A comment is only ever cut from the end, so the trim is what moves the
    // start, and only by the whitespace it took off the front.
    const lineBase = base === undefined ? undefined : start + (bare.length - bare.trimStart().length)

    // The one thing in a state document that is not a state: which shape each
    // position draws with. It reads the same here as it does in a circuit.
    const shapeLine = SHAPE_LINE.exec(line)
    if (shapeLine) {
      const spec = parseShapeSpec(shapeLine[1])
      if (!spec) throw new ParseError('shape needs at least one symbol, e.g. shape os^', 0, i + 1)
      if (spec.bad !== undefined) {
        throw new ParseError(`"${spec.bad}" is not a shape — use ${SHAPE_SYMBOL_HELP}`, 0, i + 1)
      }
      shapePicks = spec.picks
      continue
    }

    // `answer` marks a row as what the question asks for; what follows reads
    // exactly as it would without it, caption and all.
    //
    // The keyword is blanked rather than cut out, so that what is parsed lines
    // up character for character with what is on the page. Every qubit then
    // reports where it really was, and `answer 0|1` can be clicked exactly like
    // `0|1`.
    const ANSWER = /^(answers?\s+)(.*\S)\s*$/i
    const blank = (m: string) => ' '.repeat(m.length)
    const direct = ANSWER.exec(line)
    let asked = !!direct
    let text = direct ? blank(direct[1]) + direct[2] + line.slice(direct[1].length + direct[2].length) : line

    if (!direct) {
      const colon = line.indexOf(':')
      const after = colon > 0 ? line.slice(colon + 1) : ''
      const inner = colon > 0 ? ANSWER.exec(after.trim()) : null
      if (inner) {
        asked = true
        text = line.slice(0, colon + 1) + after.replace(/^(\s*)(answers?\s+)/i, blank)
      }
    }

    const row = parseRow(text, i + 1, lineBase)
    if (asked) row.answer = true
    rows.push(row)
  }
  if (!rows.length) throw new ParseError('nothing to draw', 0, 1)
  return { kind: 'state', rows, shapePicks }
}

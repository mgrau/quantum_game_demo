/**
 * Query-string encoding for diagram links.
 *
 * Everything needed to reproduce a drawing travels in the URL, so links can be
 * shared without any server storing state. The same page answers all of them,
 * switching on `format`:
 *
 *   ?src=00|11                 the editor
 *   ?format=svg&src=00|11      the bare SVG, no chrome
 *   ?format=png&src=00|11      the bare PNG
 *   ?format=pdf&src=00|11      the PDF, in the browser's PDF viewer
 */

import type { RenderOptions } from './index'
import type { ThemeId } from './render/theme'
import { THEME_IDS } from './render/themes'

export type Format = 'svg' | 'png' | 'pdf'

export interface DiagramParams {
  source: string
  format?: Format
  theme?: ThemeId
  dark?: boolean
  background?: boolean
  scale?: number
  qubit?: number
  /** Save the image immediately instead of just displaying it. */
  download?: boolean
}

const FORMATS: Format[] = ['svg', 'png', 'pdf']

function num(raw: string | null, min: number, max: number): number | undefined {
  if (raw === null) return undefined
  const v = Number(raw)
  if (!Number.isFinite(v)) return undefined
  return Math.min(max, Math.max(min, v))
}

function flag(raw: string | null): boolean | undefined {
  if (raw === null) return undefined
  return raw !== '0' && raw !== 'false'
}

export function toSearchParams(p: DiagramParams): URLSearchParams {
  const sp = new URLSearchParams()
  if (p.format) sp.set('format', p.format)
  sp.set('src', p.source)
  if (p.theme && p.theme !== 'solid') sp.set('theme', p.theme)
  if (p.dark) sp.set('dark', '1')
  if (p.background) sp.set('bg', '1')
  if (p.scale !== undefined && p.scale !== 1) sp.set('scale', String(p.scale))
  if (p.qubit !== undefined) sp.set('qubit', String(p.qubit))
  if (p.download) sp.set('download', '1')
  return sp
}

/** Read parameters from a query string. Returns null when no source is given. */
export function fromSearchParams(sp: URLSearchParams): DiagramParams | null {
  const source = sp.get('src')
  if (source === null) return null

  const theme = sp.get('theme')
  const format = sp.get('format')

  return {
    source,
    format: FORMATS.includes(format as Format) ? (format as Format) : undefined,
    theme: THEME_IDS.includes(theme as ThemeId) ? (theme as ThemeId) : undefined,
    dark: flag(sp.get('dark')),
    background: flag(sp.get('bg')),
    scale: num(sp.get('scale'), 0.1, 20),
    qubit: num(sp.get('qubit'), 8, 120),
    download: flag(sp.get('download')),
  }
}

export function renderOptionsFrom(p: DiagramParams): RenderOptions {
  return {
    theme: p.theme,
    dark: p.dark,
    background: p.background,
    metrics: p.qubit !== undefined ? { qubit: p.qubit } : undefined,
  }
}

/**
 * Characters that `URLSearchParams` escapes but which are safe to leave literal
 * in a query string, so links stay readable: `src=(00|11)(0|-1)` rather than
 * `src=%2800%7C11%29%280%7C-1%29`.
 *
 * All of these are RFC 3986 query characters except `|`, which the grammar
 * excludes but every browser accepts. `&`, `=`, `+`, `#` and `%` are absent
 * because they are structural — decoding them would corrupt the query.
 *
 * `>` is absent for a different reason, and it used to be here. A circuit's
 * arrow, `CNOT 1 -> 2`, put a literal `>` in the link, and while a browser
 * takes it, the things that turn a pasted URL *into* a link do not: an HTML
 * attribute, a Markdown auto-link and most plain-text linkifiers all end the
 * URL at `>`, so the link broke off right after the `-` before it. It is
 * percent-encoded now — `1+-%3E+2` — which every one of those carries whole.
 */
const READABLE: Record<string, string> = {
  '21': '!', '24': '$', '27': "'", '28': '(', '29': ')', '2C': ',',
  '2F': '/', '3A': ':', '3B': ';', '3F': '?', '40': '@', '7C': '|',
}

/**
 * Serialise parameters, then put the readable characters back.
 *
 * Safe against a literal `%` in the source: that encodes to `%25`, which is not
 * in the table, so `%257C` stays `%257C` rather than collapsing to `|`.
 */
export function prettyQuery(sp: URLSearchParams): string {
  return sp
    .toString()
    .replace(/%([0-9A-Fa-f]{2})/g, (match, hex: string) => READABLE[hex.toUpperCase()] ?? match)
}

/**
 * Build a link to `base` carrying these parameters.
 *
 * `base` should be the app's document URL; its query and fragment are replaced.
 * The query is appended by hand rather than through `url.search`, because the
 * URL setter would re-escape the characters `prettyQuery` just made readable.
 */
export function diagramUrl(base: string, p: DiagramParams): string {
  const url = new URL(base)
  url.hash = ''
  url.search = ''
  const query = prettyQuery(toSearchParams(p))
  return query ? `${url.href}?${query}` : url.href
}

/** Link that reopens the diagram in the editor. */
export function editorUrl(base: string, p: DiagramParams): string {
  return diagramUrl(base, { ...p, format: undefined, download: undefined })
}

/** Link that shows only the rendered image, with no editor chrome. */
export function imageUrl(base: string, format: Format, p: DiagramParams): string {
  return diagramUrl(base, { ...p, format })
}

/**
 * Round-tripping the source through an exported image.
 *
 * A saved figure is normally a dead end: the drawing survives, the text that
 * produced it does not, and a year later the only way to change a diagram is to
 * retype it. So every export carries its own source, and the app can read it
 * back out of a file that was saved months ago.
 *
 * Each format gets the mechanism it actually has:
 *
 * - **SVG** — a `<metadata>` element holding the source as readable text, so it
 *   is also visible to anyone who opens the file in an editor.
 * - **PNG** — a `tEXt` chunk. tEXt values are Latin-1, so the payload is
 *   base64 of UTF-8 rather than the raw text.
 * - **PDF** — the document Info dictionary, written by jsPDF in `export.ts`.
 *   `Subject` gets the readable source for the reader's Properties panel;
 *   `Keywords` gets the authoritative base64, since Info strings are encoded
 *   with a legacy charset that can mangle anything outside ASCII.
 *
 * Nothing here needs the DOM, so it is all testable in Node.
 */

import { VERSION } from './version'

/** Marks our payload in every format, and is what the readers search for. */
export const SOURCE_KEY = 'misty-source'

/**
 * What a saved figure carries.
 *
 * The name rides in each format's own title field — SVG `<title>`, PNG's
 * standard `Title` text chunk, the PDF's document title — so it is not just
 * ours to read: file browsers, image tools and PDF viewers all show it.
 */
export interface DiagramMeta {
  source: string
  name?: string
}

/** How the source is written into a PDF's Keywords entry. */
export const PDF_PREFIX = `${SOURCE_KEY}:`

const UNESCAPE: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&#39;': "'",
}

function escapeXml(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'))
}

function unescapeXml(s: string): string {
  return s.replace(/&(?:amp|lt|gt|quot|apos|#39);/g, (m) => UNESCAPE[m] ?? m)
}

export function encodeSource(source: string): string {
  const bytes = new TextEncoder().encode(source)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

export function decodeSource(base64: string): string {
  const binary = atob(base64)
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/* -- SVG ------------------------------------------------------------------ */

const SVG_METADATA = new RegExp(
  `<metadata[^>]*id="${SOURCE_KEY}"[^>]*>([\\s\\S]*?)</metadata>`,
)

const SVG_TITLE = /<title[^>]*>([\s\S]*?)<\/title>/

/**
 * Attach the source to an SVG, replacing any copy already there.
 *
 * Both elements go immediately inside `<svg>`, which is where SVG expects them
 * and where renderers reliably ignore the metadata. `<title>` first, since that
 * is the position at which it names the document.
 */
export function embedSvgMeta(svg: string, meta: DiagramMeta): string {
  const clean = svg.replace(SVG_METADATA, '').replace(SVG_TITLE, '')
  const open = /^\s*<svg[^>]*>/.exec(clean)
  if (!open) return clean
  const title = meta.name ? `<title>${escapeXml(meta.name)}</title>` : ''
  // The version is stamped alongside the source, so a figure found in three
  // years says what drew it. A drawing is not reproducible from its text alone
  // — the text is stable, but what the renderer makes of it moves.
  const source =
    `<metadata id="${SOURCE_KEY}" data-app="misty-states" data-version="${VERSION}">` +
    escapeXml(meta.source) +
    `</metadata>`
  return clean.slice(0, open[0].length) + title + source + clean.slice(open[0].length)
}

export function readSvgMeta(svg: string): DiagramMeta | null {
  const hit = SVG_METADATA.exec(svg)
  if (!hit) return null
  // Only trusted once our own metadata has been found, so a `<title>` that some
  // other tool wrote is never mistaken for a diagram name.
  const title = SVG_TITLE.exec(svg)
  return { source: unescapeXml(hit[1]), name: title ? unescapeXml(title[1]) : undefined }
}

/** Drop the metadata again — svg2pdf walks every node, so it never sees it. */
export function stripSvgMeta(svg: string): string {
  return svg.replace(SVG_METADATA, '').replace(SVG_TITLE, '')
}

/* -- PNG ------------------------------------------------------------------ */

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function isPng(bytes: Uint8Array): boolean {
  return PNG_MAGIC.every((b, i) => bytes[i] === b)
}

/** Walk the chunk list, yielding each chunk's type, payload and byte offset. */
function* pngChunks(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let at = PNG_MAGIC.length
  while (at + 8 <= bytes.length) {
    const length = view.getUint32(at)
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8))
    const data = bytes.subarray(at + 8, at + 8 + length)
    yield { type, data, start: at }
    if (type === 'IEND') return
    at += 12 + length
  }
}

function textChunk(keyword: string, text: string): Uint8Array {
  const key = new TextEncoder().encode(keyword)
  // Already base64, so every byte is ASCII and therefore valid Latin-1.
  const value = Uint8Array.from(text, (c) => c.charCodeAt(0) & 0xff)
  const payload = new Uint8Array(key.length + 1 + value.length)
  payload.set(key, 0)
  payload[key.length] = 0
  payload.set(value, key.length + 1)

  const chunk = new Uint8Array(12 + payload.length)
  const view = new DataView(chunk.buffer)
  view.setUint32(0, payload.length)
  chunk.set(new TextEncoder().encode('tEXt'), 4)
  chunk.set(payload, 8)
  view.setUint32(8 + payload.length, crc32(chunk.subarray(4, 8 + payload.length)))
  return chunk
}

/**
 * Insert a `tEXt` chunk carrying the source, just before `IEND`.
 *
 * Returns the input untouched if it is not a PNG, or has no IEND — a figure
 * that cannot carry its source is still a perfectly good figure.
 */
export function embedPngMeta(png: Uint8Array, meta: DiagramMeta): Uint8Array {
  if (!isPng(png)) return png
  let end = -1
  for (const chunk of pngChunks(png)) if (chunk.type === 'IEND') end = chunk.start
  if (end < 0) return png

  const chunks = [textChunk(SOURCE_KEY, encodeSource(meta.source))]
  // `Title` is one of the PNG spec's own keywords, so the name shows up in any
  // tool that reads image metadata rather than only in this app.
  if (meta.name) chunks.push(textChunk('Title', encodeSource(meta.name)))

  const added = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Uint8Array(png.length + added)
  out.set(png.subarray(0, end), 0)
  let at = end
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.length
  }
  out.set(png.subarray(end), at)
  return out
}

/**
 * Declare the image's physical resolution, so it lands at its true size.
 *
 * A canvas PNG carries no `pHYs` chunk, which leaves its resolution unstated —
 * and a program that places it, PowerPoint above all, then assumes 96 dpi. A
 * figure rasterised at 300 dpi is four pixels across for every one it is meant
 * to occupy, so at that assumption it arrives four times too big and has to be
 * shrunk by hand every time. Stating the resolution it was actually drawn at
 * makes it land at the size it was drawn to be, and stay crisp when the slide
 * is projected — the pixels are there, they are just correctly sized.
 *
 * The chunk is 9 bytes: pixels-per-metre across, the same down, and a unit
 * byte of 1 meaning metres. Placed straight after `IHDR`, since the spec
 * requires it before the first `IDAT`.
 */
export function embedPngDpi(png: Uint8Array, dpi: number): Uint8Array {
  if (!isPng(png) || !(dpi > 0)) return png
  let afterHeader = -1
  for (const chunk of pngChunks(png)) {
    if (chunk.type === 'IHDR') afterHeader = chunk.start + 12 + chunk.data.length
  }
  if (afterHeader < 0) return png

  // 1 inch is 0.0254 m, so pixels-per-metre is the dpi over that.
  const perMetre = Math.round(dpi / 0.0254)
  const payload = new Uint8Array(9)
  const pv = new DataView(payload.buffer)
  pv.setUint32(0, perMetre)
  pv.setUint32(4, perMetre)
  payload[8] = 1

  const chunk = new Uint8Array(12 + payload.length)
  const view = new DataView(chunk.buffer)
  view.setUint32(0, payload.length)
  chunk.set(new TextEncoder().encode('pHYs'), 4)
  chunk.set(payload, 8)
  view.setUint32(8 + payload.length, crc32(chunk.subarray(4, 8 + payload.length)))

  const out = new Uint8Array(png.length + chunk.length)
  out.set(png.subarray(0, afterHeader), 0)
  out.set(chunk, afterHeader)
  out.set(png.subarray(afterHeader), afterHeader + chunk.length)
  return out
}

/** The value of a `tEXt` chunk with this keyword, or null. */
function pngText(png: Uint8Array, keyword: string): string | null {
  for (const chunk of pngChunks(png)) {
    if (chunk.type !== 'tEXt') continue
    const split = chunk.data.indexOf(0)
    if (split < 0) continue
    if (String.fromCharCode(...chunk.data.subarray(0, split)) !== keyword) continue
    try {
      return decodeSource(String.fromCharCode(...chunk.data.subarray(split + 1)))
    } catch {
      return null
    }
  }
  return null
}

export function readPngMeta(png: Uint8Array): DiagramMeta | null {
  if (!isPng(png)) return null
  const source = pngText(png, SOURCE_KEY)
  if (source === null) return null
  return { source, name: pngText(png, 'Title') ?? undefined }
}

/* -- PDF ------------------------------------------------------------------ */

/**
 * Pull the source out of a PDF's Info dictionary.
 *
 * jsPDF writes Info as an uncompressed literal string, so the payload can be
 * found by scanning the bytes — which avoids pulling in a PDF parser just to
 * read one field. Base64 contains nothing a PDF string would escape.
 */
export function readPdfMeta(pdf: Uint8Array): DiagramMeta | null {
  let text = ''
  for (let i = 0; i < pdf.length; i += 0x8000) {
    text += String.fromCharCode(...pdf.subarray(i, i + 0x8000))
  }
  const hit = new RegExp(`${PDF_PREFIX}([A-Za-z0-9+/=]+)`).exec(text)
  if (!hit) return null
  let source: string
  try {
    source = decodeSource(hit[1])
  } catch {
    return null
  }
  // The document title, which `export.ts` writes as the diagram's name. Info
  // strings escape `)` and `\`, so those are undone on the way back.
  const title = /\/Title\s*\(((?:\\.|[^\\)])*)\)/.exec(text)
  const name = title ? title[1].replace(/\\([\\()])/g, '$1') : undefined
  return { source, name: name || undefined }
}

/* -- Reading whatever was dropped in ------------------------------------- */

/** Why a file could not be reopened, phrased for the person who dropped it. */
export class NoSourceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NoSourceError'
  }
}

function looksLikePdf(bytes: Uint8Array): boolean {
  return String.fromCharCode(...bytes.subarray(0, 5)) === '%PDF-'
}

/**
 * Recover the source from an exported file.
 *
 * Accepts anything this app can save — SVG, PNG or PDF — plus a plain text
 * file, which is treated as source directly so a `.txt` of the syntax opens
 * too.
 */
export function readFileMeta(bytes: Uint8Array, filename = ''): DiagramMeta {
  if (isPng(bytes)) {
    const meta = readPngMeta(bytes)
    if (meta) return meta
    throw new NoSourceError(
      'That PNG carries no diagram source. Only PNGs saved from this app do — ' +
        'and some tools strip the metadata when re-encoding.',
    )
  }

  if (looksLikePdf(bytes)) {
    const meta = readPdfMeta(bytes)
    if (meta) return meta
    throw new NoSourceError('That PDF carries no diagram source. Only PDFs saved from this app do.')
  }

  const text = new TextDecoder().decode(bytes)
  if (/<svg[\s>]/i.test(text)) {
    const meta = readSvgMeta(text)
    if (meta) return meta
    throw new NoSourceError(
      'That SVG carries no diagram source. Only SVGs saved from this app do.',
    )
  }

  // A bare text file is its own source, and its filename its name.
  if (text.trim() && !/[\0�]/.test(text.slice(0, 512))) {
    return {
      source: text.replace(/\s+$/, ''),
      name: filename.replace(/\.[^.]*$/, '') || undefined,
    }
  }

  throw new NoSourceError(
    `Could not read ${filename || 'that file'} — expected an SVG, PNG or PDF saved from this app.`,
  )
}

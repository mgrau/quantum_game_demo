/**
 * A rendered SVG, turned into other bytes.
 *
 * These sit apart from the rest of the export helpers because of what they do
 * *not* need. Saving a file needs an anchor and a click; copying needs the
 * clipboard; a PDF needs jsPDF, several hundred kilobytes of it. These need a
 * canvas at most, and `svgDataUrl` needs nothing at all — which is what lets
 * the published surface offer "give me the picture as a URL" without the
 * editor's whole export apparatus coming with it.
 *
 * The metadata handling is the same as everywhere else: the rendered SVG
 * already carries its own source in a `<metadata>` element, and canvas throws
 * that away, so the PNG path puts it back as text chunks. A saved figure can
 * always be reopened for editing.
 */

import { embedPngDpi, embedPngMeta, readSvgMeta } from '../metadata'

export function svgBlob(svg: string): Blob {
  return new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
}

/** Rasterise an SVG string to a PNG blob at `scale`× its intrinsic size. */
export async function svgToPngBlob(svg: string, scale = 3): Promise<Blob> {
  const url = URL.createObjectURL(svgBlob(svg))
  try {
    const img = new Image()
    img.decoding = 'sync'
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('could not rasterise the SVG'))
      img.src = url
    })

    // Round each side to an even whole pixel before scaling, the same as a
    // video does. A video cannot state a resolution, so it lands at its pixel
    // count over 96 on a slide, and H.264 forces those pixels even; a PNG that
    // wants to land at the exact same size has to start from the same even
    // base. With an integer scale (a dpi that is a multiple of 96) this is
    // exact — the PNG is the video's frame, dpi-tagged and drawn sharper.
    //
    // The base is the drawing's own fractional size, read off the `<svg>`, not
    // `naturalWidth`: the browser rounds that to a whole pixel first, and a
    // width of 278.94 rounded to 279 then evens *up* to 280 where the true 278.94
    // evens *down* to 278 — a whole pixel adrift from the video, which rounds
    // the same fraction the same way.
    const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)
    const attr = (name: string) => {
      const hit = new RegExp(`<svg[^>]*\\b${name}="([\\d.]+)"`).exec(svg)
      return hit ? parseFloat(hit[1]) : NaN
    }
    const baseW = attr('width') || img.naturalWidth
    const baseH = attr('height') || img.naturalHeight
    const w = Math.max(1, Math.round(even(baseW) * scale))
    const h = Math.max(1, Math.round(even(baseH) * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas is unavailable')
    ctx.drawImage(img, 0, 0, w, h)

    const raw = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png')
    })

    // Canvas writes no resolution, so a placing program assumes 96 dpi and the
    // figure lands `scale`× too large. State the dpi it was actually drawn at
    // — 96 CSS pixels to the inch, times the scale — so it lands true size.
    let bytes = embedPngDpi(new Uint8Array(await raw.arrayBuffer()), scale * 96)

    // Canvas throws the source metadata away too; put it back as text chunks.
    const meta = readSvgMeta(svg)
    if (meta) bytes = embedPngMeta(bytes, meta)
    return new Blob([bytes as unknown as BlobPart], { type: 'image/png' })
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Base64 of raw bytes, chunked so a large diagram cannot blow the arg limit. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

/** UTF-8 safe base64, since btoa alone rejects non-Latin-1 characters. */
function toBase64(text: string): string {
  return bytesToBase64(new TextEncoder().encode(text))
}

export async function blobToDataUrl(blob: Blob, mime: string): Promise<string> {
  return `data:${mime};base64,${bytesToBase64(new Uint8Array(await blob.arrayBuffer()))}`
}

/**
 * Restate an SVG's size in inches, at the footprint every other export lands at.
 *
 * The `<svg>` names its size in bare user units, and a program placing it reads
 * those by its own lights — 96 to the inch in a browser, but PowerPoint sizes a
 * dropped one by a different rule, so it comes in a different size from a video
 * or a PNG of the same figure and has to be scaled by hand to match.
 *
 * Stated in inches it lands where it is put, the same everywhere. And the size
 * chosen is the one the others use: each side rounded to an even whole pixel —
 * as a video must and a PNG does — over 96. The `viewBox` is left alone, so the
 * drawing simply fills the box at its true proportions.
 */
export function svgAtPrintSize(svg: string): string {
  const read = (name: string) => {
    const hit = new RegExp(`<svg[^>]*\\b${name}="([\\d.]+)"`).exec(svg)
    return hit ? parseFloat(hit[1]) : NaN
  }
  const w = read('width')
  const h = read('height')
  if (!(w > 0) || !(h > 0)) return svg
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)
  const inches = (n: number) => `${(even(n) / 96).toFixed(4)}in`
  return svg
    .replace(/(<svg[^>]*\bwidth=")[\d.]+(")/, `$1${inches(w)}$2`)
    .replace(/(<svg[^>]*\bheight=")[\d.]+(")/, `$1${inches(h)}$2`)
}

/**
 * A self-contained `data:` URL for the SVG.
 *
 * This is the browser-only answer to "a URL that returns the image": it needs
 * no server, and works anywhere a document can reference an image by URL —
 * `<img src>`, HTML, CSS. Note that GitHub markdown strips data URLs and some
 * LaTeX/PDF pipelines will not fetch them.
 */
export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;base64,${toBase64(svg)}`
}

/** The same, rasterised to PNG via canvas. */
export async function pngDataUrl(svg: string, scale = 3): Promise<string> {
  return blobToDataUrl(await svgToPngBlob(svg, scale), 'image/png')
}

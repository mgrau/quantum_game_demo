/**
 * Public programmatic API.
 *
 * Importable as a module, and exposed as `window.MistyStates` when the bundle
 * is loaded with a plain <script> tag:
 *
 *   import { MistyStates } from 'misty-states'
 *   const markup = MistyStates.svg('000|-111')
 *   const url    = await MistyStates.pngDataUrl('qubits 2\nH 1', { scale: 4 })
 *   const link   = MistyStates.editorUrl('00|11')
 *
 * `svg` and the URL builders are pure and run anywhere, including Node. The PNG
 * helpers rasterise through a canvas and so need a browser (or any DOM with
 * canvas support); they reject with a clear message otherwise.
 */

import { render, detectMode, type RenderOptions, type RenderResult } from './index'
import { pngDataUrl as encodePngDataUrl, svgDataUrl as encodeSvgDataUrl, svgToPngBlob } from './render/encode'
import {
  editorUrl as buildEditorUrl,
  imageUrl as buildImageUrl,
  type DiagramParams,
  type Format,
} from './url'
import { THEME_IDS } from './render/themes'
import { SHAPE_NAMES } from './shapes'
import type { ThemeId } from './render/theme'
import type { ShapeName } from './shapes'

export interface ApiOptions extends RenderOptions {
  /** Multiplier for PNG rasterisation. Defaults to 3. */
  scale?: number
}

export interface LinkOptions {
  theme?: ThemeId
  dark?: boolean
  background?: boolean
  scale?: number
  qubit?: number
  download?: boolean
  /**
   * Document the link should point at. Defaults to the current page, so links
   * keep working from a sub-path or off the filesystem.
   */
  base?: string
}

function currentBase(): string {
  if (typeof location === 'undefined') {
    throw new Error('no document URL available — pass options.base explicitly')
  }
  return location.href
}

function paramsFor(source: string, opts: LinkOptions): DiagramParams {
  return {
    source,
    theme: opts.theme,
    dark: opts.dark,
    background: opts.background,
    scale: opts.scale,
    qubit: opts.qubit,
    download: opts.download,
  }
}

function requireCanvas(): void {
  if (typeof document === 'undefined' || !document.createElement('canvas').getContext) {
    throw new Error('PNG output needs a browser environment; use svg() instead')
  }
}

export const MistyStates = {
  /** Full render result: SVG markup plus the intrinsic size and detected kind. */
  render(source: string, options: ApiOptions = {}): RenderResult {
    return render(source, options)
  },

  /** SVG markup as a string. */
  svg(source: string, options: ApiOptions = {}): string {
    return render(source, options).svg
  },

  /** SVG as a self-contained `data:` URL. */
  svgDataUrl(source: string, options: ApiOptions = {}): string {
    return encodeSvgDataUrl(render(source, options).svg)
  },

  /** PNG bytes. Browser only. */
  async pngBlob(source: string, options: ApiOptions = {}): Promise<Blob> {
    requireCanvas()
    return svgToPngBlob(render(source, options).svg, options.scale ?? 3)
  },

  /** PNG as a self-contained `data:` URL. Browser only. */
  async pngDataUrl(source: string, options: ApiOptions = {}): Promise<string> {
    requireCanvas()
    return encodePngDataUrl(render(source, options).svg, options.scale ?? 3)
  },

  /** Link that reopens this diagram in the editor. */
  editorUrl(source: string, options: LinkOptions = {}): string {
    return buildEditorUrl(options.base ?? currentBase(), paramsFor(source, options))
  },

  /** Link that shows only the rendered image, with no editor chrome. */
  imageUrl(source: string, format: Format = 'svg', options: LinkOptions = {}): string {
    return buildImageUrl(options.base ?? currentBase(), format, paramsFor(source, options))
  },

  /** Whether a source reads as a bare state or a circuit. */
  detectMode(source: string): 'state' | 'circuit' {
    return detectMode(source)
  },

  get themes(): ThemeId[] {
    return [...THEME_IDS]
  },

  get shapes(): ShapeName[] {
    return [...SHAPE_NAMES]
  },
}

export type MistyStatesApi = typeof MistyStates

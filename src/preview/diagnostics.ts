/**
 * Diagnostics reachable from the preview's developer tools
 * (`Developer: Open Webview Developer Tools` → `window.markdownVista`). This is the
 * fastest way to tell "the extension did not load" apart from "a subsystem
 * failed" apart from "something else is fighting us", which are
 * indistinguishable from the outside.
 */
export interface Diagnostics {
  version: string
  started: boolean
  refreshes: number
  /** Heading jumps requested from the table of contents. */
  tocJumps: number
  /** Jumps that something scrolled away from and we had to re-assert. */
  tocCorrections: number
  errors: string[]
}

declare global {
  interface Window {
    markdownVista?: Diagnostics
  }
}

export const diagnostics: Diagnostics = {
  version: __MARKDOWN_VISTA_VERSION__,
  started: false,
  refreshes: 0,
  tocJumps: 0,
  tocCorrections: 0,
  errors: []
}

window.markdownVista = diagnostics

/** One failing subsystem must not take the others down with it. */
export function guard(name: string, run: () => void): void {
  try {
    run()
  } catch (error) {
    const message = `${name}: ${error instanceof Error ? error.message : String(error)}`
    if (!diagnostics.errors.includes(message)) diagnostics.errors.push(message)
    console.error(`[markdown-vista] ${message}`, error)
  }
}

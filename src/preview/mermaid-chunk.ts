/**
 * Entry point for `media/mermaid.js`, the lazily loaded half of the preview
 * bundle. Mermaid is ~3MB; keeping it out of the main script means a document
 * without diagrams never pays for it.
 *
 * Built as an IIFE with `globalName: 'markdownVistaMermaid'`, so loading this
 * file publishes the library on `window`.
 */
import mermaid from 'mermaid'

export default mermaid

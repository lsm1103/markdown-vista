# Changelog

## 0.4.0

Heading navigation is now idempotent: the same entry lands in exactly the same
place, however many times it is clicked, and whatever else is moving the
document.

- The jump is instant and absolute. It was animated, and an animation is
  something another party can interrupt — which is what produced the alternating
  "correct, top, correct, top" behaviour: the interference happened on every
  click, but was only visible when our own scroll had nothing to move.
- For a short window after a jump, the position is defended: anything that
  scrolls the document away from the target — most likely the editor echoing its
  scroll position back to the preview — is undone. Any real input from you
  (wheel, touch, key, click outside the panel) releases the guard at once, and
  a correction extends the window, so a slow echo is still caught.
- The guard polls on a timer *and* on scroll events, and resolves its target by
  heading rather than by element reference, so it survives a hidden preview, a
  throttled timer, and a re-render mid-jump.
- `window.markdownVista.tocJumps` / `.tocCorrections` report how often the position had
  to be defended.

## 0.3.1

- **Clicking a heading in the table of contents jumped to the top of the
  document on the first click, and only worked on the second.** The entries were
  `<a href="#">` elements; the built-in preview does its own document-level link
  handling, which scrolled the document — and, through scroll sync, the editor —
  before our jump landed. On the second click the editor was already at the top,
  so nothing interfered and the jump worked. Entries are now buttons, and no
  click inside the panel propagates to the host any more.
- The jump is re-asserted shortly after it happens, so anything that scrolls the
  preview away in the meantime (the editor/preview scroll-sync round trip, for
  example) can no longer strand it in the wrong place.

## 0.3.0

Fixes for two problems reported against 0.2.0.

- **Nothing rendered in a preview that opened while not visible.** The refresh
  loop was debounced with `requestAnimationFrame`, and browsers run no animation
  frames for a hidden document — a preview created in a background editor group
  never got its diagrams or its table of contents. It now uses a timer, and also
  refreshes when the document becomes visible.
- **The extension's own buttons behaved like zoomable graphics.** The outline
  carets and toolbar icons are inline SVG, and the graphic collector only
  excluded the viewer, not the table of contents or its toggle. Hovering them
  showed a magnifier cursor and clicking them opened the zoom viewer instead of
  doing their job. Our own chrome is now excluded, in the script and in CSS.
- Clicking a heading now falls back to an instant jump when the browser skips
  the smooth scroll (hidden document, reduced motion).
- One failing subsystem no longer aborts the others, and
  `window.markdownVista` in the preview's developer tools reports the running version,
  refresh count and any errors.

## 0.2.0

- Table of contents inside the preview: a button in the top-right corner opens a
  nested heading outline with click-to-jump, collapsible branches, a
  collapse/expand-all toggle and scroll-linked highlighting of the current
  section. Configurable via `markdownVista.toc.*`.
- The zoom viewer now re-attaches itself if the preview rebuilds the document
  body, and `fit` enlarges a small graphic (up to 4×) instead of capping at 100%.

## 0.1.0

First release.

- Mermaid rendering in the built-in Markdown preview, theme-aware, with an
  SVG cache and graceful degradation for invalid diagrams.
- Zoom/pan viewer for Mermaid diagrams, images and display formulas: 10%–1000%
  zoom, drag-to-pan, navigation minimap, resizable window, keyboard control.
- PNG export via `blob:` download with a clipboard fallback.
- Extended Markdown syntax: mark, ins, sub, sup, footnotes, definition lists,
  abbreviations, emoji shortcodes.

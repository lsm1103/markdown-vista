const STROKE = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'

function svg(body: string): string {
  return `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false" ${STROKE}>${body}</svg>`
}

export const ICONS = {
  image: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 16l-5-5-6 6-3-3-4 4"/>'),
  minus: svg('<path d="M5 12h14"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  fit: svg('<path d="M4 9V5a1 1 0 0 1 1-1h4M20 9V5a1 1 0 0 0-1-1h-4M4 15v4a1 1 0 0 0 1 1h4M20 15v4a1 1 0 0 1-1 1h-4"/>'),
  download: svg('<path d="M12 3v12M7 11l5 5 5-5M4 20h16"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  chevronLeft: svg('<path d="M15 5l-7 7 7 7"/>'),
  chevronRight: svg('<path d="M9 5l7 7-7 7"/>'),
  copy: svg('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>'),
  list: svg('<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>'),
  collapseAll: svg('<path d="M8 9l4-4 4 4M8 15l4 4 4-4"/>'),
  expandAll: svg('<path d="M8 5l4 4 4-4M8 19l4-4 4 4"/>'),
  caret: svg('<path d="M9 6l6 6-6 6"/>')
} as const

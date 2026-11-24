/**
 * Height of anything pinned to the top of the preview — currently the
 * breadcrumb bar.
 *
 * Every jump has to account for it: scrolling a heading to the very top of the
 * viewport would otherwise park it underneath the bar.
 */
let inset = 0

export function setTopInset(pixels: number): void {
  inset = pixels
  document.documentElement.style.setProperty('--markdown-vista-top-inset', `${pixels}px`)
}

export function topInset(): number {
  return inset
}

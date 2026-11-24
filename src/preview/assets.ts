/**
 * Locates files that ship next to this script, so a lazily loaded chunk can be
 * fetched from the extension's own `media/` folder.
 *
 * Both values must be read while the script is still executing synchronously —
 * `document.currentScript` is null afterwards.
 */
const script = document.currentScript as HTMLScriptElement | null
const scriptUrl = script?.src ?? ''
/**
 * The built-in preview may serve a nonce-based content security policy, in
 * which case an injected script needs the same nonce to run. The `nonce` IDL
 * property is readable from script even though the attribute is hidden.
 */
const scriptNonce = script?.nonce ?? ''

/** Absolute URL of a sibling file of this script. */
export function assetUrl(name: string): string {
  if (!scriptUrl) return name
  return scriptUrl.replace(/[^/]*(?:\?.*)?$/, name)
}

const loading = new Map<string, Promise<void>>()

/** Loads a classic script once; repeated calls share the first attempt. */
export function loadScript(url: string): Promise<void> {
  const existing = loading.get(url)
  if (existing) return existing

  const pending = new Promise<void>((resolve, reject) => {
    const element = document.createElement('script')
    element.src = url
    element.async = false
    if (scriptNonce) element.nonce = scriptNonce
    element.addEventListener('load', () => resolve())
    element.addEventListener('error', () => reject(new Error(`Could not load ${url}`)))
    document.head.append(element)
  })

  loading.set(url, pending)
  return pending
}

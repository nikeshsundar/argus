import { app } from 'electron'

/**
 * Baseline Electron hardening, applied to every window Argus creates.
 *
 * Argus's windows load local files (or, in development, the Vite dev server)
 * and are single pages that never navigate anywhere. Anything that tries to
 * change that - a new window, a navigation to a remote origin, an embedded
 * <webview> - is either a bug or a page trying to escape, so all three are
 * refused here rather than relied on not to happen.
 *
 * Registered once, before any window is created, so it covers the request bar
 * and the agent overlay without each having to remember to opt in.
 */
export function hardenWindows(): void {
  app.on('web-contents-created', (_event, contents) => {
    // Nothing in Argus opens a second window; window.open and target=_blank
    // are denied outright rather than opened in Electron or the browser.
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))

    // The app never navigates. A will-navigate to anywhere but our own page is
    // a redirect we did not initiate - block it so a loaded page cannot be
    // steered to a remote origin that would then run with our preload.
    const blockForeign = (event: Electron.Event, url: string): void => {
      if (!isInternalUrl(url)) event.preventDefault()
    }
    contents.on('will-navigate', blockForeign)
    contents.on('will-redirect', blockForeign)

    // No window embeds a <webview>; refuse to attach one.
    contents.on('will-attach-webview', (event) => event.preventDefault())
  })
}

/**
 * True for the only origins Argus loads from: a local file, or - in
 * development only - the Vite dev server named in ELECTRON_RENDERER_URL.
 */
function isInternalUrl(url: string): boolean {
  if (url.startsWith('file:')) return true
  if (app.isPackaged) return false
  const dev = process.env['ELECTRON_RENDERER_URL']
  return Boolean(dev && url.startsWith(dev))
}

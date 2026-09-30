/**
 * Whether the pointer is over one of the overlay's own controls - the to-do
 * pill or list, or an approval card - so the overlay is taking clicks.
 *
 * Its own module so the input watcher can ask without importing the overlay
 * window, which already depends on it.
 */
let interactive = false

export function setOverlayInteractiveState(value: boolean): void {
  interactive = value
}

/** A click right now lands on Argus's own UI, not the user's apps. */
export function isOverlayInteractive(): boolean {
  return interactive
}

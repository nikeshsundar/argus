const action = document.querySelector<HTMLSpanElement>('#action')!
const step = document.querySelector<HTMLSpanElement>('#step')!
const pointer = document.querySelector<HTMLDivElement>('#pointer')!
const followers = Array.from(pointer.querySelectorAll<HTMLDivElement>('.halo, .trail'))

/** How long the pointer may sit still before the marker dims out of the way. */
const IDLE_AFTER_MS = 900

let idleTimer: number | undefined

window.argus.onAgentStep(({ description, index, max }) => {
  action.textContent = description
  step.textContent = `(step ${index}/${max})`
})

window.argus.onAgentCursor(({ x, y, phase }) => {
  pointer.hidden = false
  pointer.classList.remove('idle')

  // Every follower is sent to the same point; their differing transition
  // durations are what spreads them into a tail.
  const transform = `translate3d(${x}px, ${y}px, 0)`
  for (const follower of followers) follower.style.transform = transform

  if (phase === 'click') ripple(x, y)

  window.clearTimeout(idleTimer)
  idleTimer = window.setTimeout(() => pointer.classList.add('idle'), IDLE_AFTER_MS)
})

/** One expanding ring at the click point, removed once it has played. */
function ripple(x: number, y: number): void {
  const ring = document.createElement('div')
  ring.className = 'ripple'
  ring.style.transform = `translate3d(${x}px, ${y}px, 0)`
  ring.addEventListener('animationend', () => ring.remove(), { once: true })
  document.body.append(ring)
}

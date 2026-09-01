const action = document.querySelector<HTMLSpanElement>('#action')!
const step = document.querySelector<HTMLSpanElement>('#step')!

window.argus.onAgentStep(({ description, index, max }) => {
  action.textContent = description
  step.textContent = `(step ${index}/${max})`
})

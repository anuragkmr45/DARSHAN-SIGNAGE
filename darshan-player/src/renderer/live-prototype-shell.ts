import type { LivePrototypeBridge } from '../common/live-prototype'

declare global { interface Window { livePrototype: LivePrototypeBridge } }
const reason = document.getElementById('fallback-reason') as HTMLElement
const image = document.getElementById('fallback-image') as HTMLImageElement
const update = (state: { reason: string; fallback_url?: string }): void => {
  reason.textContent = state.reason
  if (state.fallback_url && image.src !== state.fallback_url) { image.src = state.fallback_url; image.hidden = false }
}
image.addEventListener('error', () => { image.hidden = true; reason.textContent = 'Content unavailable — local fallback could not be displayed' })
window.livePrototype.onState(update)
void window.livePrototype.state().then(update)

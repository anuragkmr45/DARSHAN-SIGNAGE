/** Development-only protocol. Never include these grants in ordinary snapshots. */
export interface LivePrototypeGrant {
  ticket?: string
  signal_url: string
  admission_id: string
  run_id: string
  generation: number
  presenter_identity: string
  lease_ms: number
  window_remaining_ms: number
}

export interface LivePrototypeObservation {
  kind: 'connected' | 'first-frame' | 'audio-playing' | 'audio-unavailable' | 'disconnected' | 'failed'
  run_id: string
  generation: number
}

export interface LivePrototypeBridge {
  grant(): Promise<LivePrototypeGrant | null>
  report(observation: LivePrototypeObservation): void
  state(): Promise<{ reason: string; fallback_url?: string }>
  onState(listener: (value: { reason: string; fallback_url?: string }) => void): () => void
}

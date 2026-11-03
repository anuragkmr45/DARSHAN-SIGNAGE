-- Additive prerequisite only: opaque reconciliation version, not live admission.
-- Existing state/history remains NULL until a live authority writer supplies it.
-- Ordinary writers must preserve an unspecified current value. No backfill,
-- capability enablement, command kind or public live runtime API is introduced.
ALTER TABLE device_desired_state ADD COLUMN live_version text;
ALTER TABLE device_desired_state_history ADD COLUMN live_version text;

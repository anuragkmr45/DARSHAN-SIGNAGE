/** Control pointers are selectors, never an authority override. Validate the
 * complete immutable run binding before exposing or acting on that pointer. */
export function validLiveControlRunBinding(
  occurrence: { id: string; presenter_user_id: string },
  control: { current_run_id: string | null; generation: number } | null | undefined,
  run: { id: string; occurrence_id: string; generation: number; presenter_user_id: string } | null | undefined
): boolean {
  if (!control) return !run;
  if (!control.current_run_id) return control.generation === 0 && !run;
  return Boolean(run && run.id === control.current_run_id && run.occurrence_id === occurrence.id &&
    run.generation === control.generation && run.presenter_user_id === occurrence.presenter_user_id);
}

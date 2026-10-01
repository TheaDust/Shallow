/**
 * Helpers for submits that must not depend on a render that is still pending.
 *
 * The forms keep controlled inputs for accessibility, but the submitted payload
 * is read from the live form element: a programmatic `fill` (as used by browser
 * automation) can set a field and immediately submit before React has committed
 * the matching state update. Reading the DOM makes the payload authoritative and
 * mirrors it back into component state so the inputs stay in sync.
 */
export function readFormValues(
  form: HTMLFormElement,
  names: readonly string[],
): Record<string, string> {
  const data = new FormData(form);
  const values: Record<string, string> = {};
  for (const name of names) {
    const entry = data.get(name);
    values[name] = typeof entry === "string" ? entry : "";
  }
  return values;
}

export function readFormChecked(form: HTMLFormElement, name: string): boolean {
  const field = form.elements.namedItem(name);
  return field instanceof HTMLInputElement ? field.checked : false;
}

/** Clears the named fields in the DOM, so submitted passwords are never redisplayed. */
export function clearFormFields(form: HTMLFormElement, names: readonly string[]): void {
  for (const name of names) {
    const field = form.elements.namedItem(name);
    if (field instanceof HTMLInputElement) field.value = "";
  }
}

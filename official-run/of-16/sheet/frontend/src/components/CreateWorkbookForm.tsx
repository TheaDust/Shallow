import { useState, type FormEvent } from "react";

import { Button } from "../ui/Button";
import { FormField } from "../ui/FormField";

export interface CreateWorkbookFormProps {
  /** Name shown when the form first renders (empty means "use the default name"). */
  initialName?: string;
  /** Error from a failed creation attempt, shown beside the named control. */
  error?: string | null;
  /** Blocks repeated submissions while a creation is in flight. */
  busy?: boolean;
  onCreate(name: string): void;
}

/**
 * The creation form shared by the creation page (`#/new`) and the editor page
 * that is resolving a pending creation, so the visible names and the retry
 * behaviour stay identical in both places.
 */
export function CreateWorkbookForm({ initialName = "", error = null, busy = false, onCreate }: CreateWorkbookFormProps) {
  const [name, setName] = useState(initialName);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    onCreate(name);
  }

  return (
    <main className="creation">
      <p className="creation__homelink"><a href="#/">Workbooks</a></p>
      <h1>Create workbook</h1>
      <form className="creation__form" aria-label="Create workbook" onSubmit={submit}>
        <FormField
          id="new-workbook-name"
          label="Workbook name"
          description="Leave blank to use the default name."
          error={error ?? undefined}
        >
          <input
            id="new-workbook-name"
            type="text"
            value={name}
            placeholder="Untitled workbook"
            onChange={(event) => setName(event.target.value)}
          />
        </FormField>
        <div className="creation__actions">
          <Button type="submit" variant="primary" disabled={busy}>Create</Button>
        </div>
      </form>
    </main>
  );
}

import { CreateWorkbookForm } from "../components/CreateWorkbookForm";
import { newWorkbookId, workbookRoute } from "../domain/workbook";
import { navigate } from "../lib/hash-route";

/**
 * The creation page. Submitting only opens the workbook's own editor URL — the
 * hash changes synchronously, before any request settles, so refreshing right
 * after submitting still lands on the same workbook instead of a blank page.
 * The editor page performs the idempotent creation for the pending id.
 */
export function NewWorkbookPage() {
  return (
    <CreateWorkbookForm
      onCreate={(name) => {
        const id = newWorkbookId(name);
        navigate(workbookRoute(id), new URLSearchParams({ new: "1", name }));
      }}
    />
  );
}

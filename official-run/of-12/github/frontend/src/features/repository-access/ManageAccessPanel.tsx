import { useState } from "react";

import { Button } from "../../ui";
import { AccessGrantTable } from "./AccessGrantTable";
import { AccessSubjectPicker } from "./AccessSubjectPicker";
import { saveRepositoryAccess, type RepositoryAccessDetail } from "./access-api";

export interface ManageAccessPanelProps {
  owner: string;
  name: string;
  detail: RepositoryAccessDetail;
  onDetailChange(detail: RepositoryAccessDetail): void;
}

/**
 * Manage-access body (REQ-2-3): the "Add people or teams" picker plus the
 * authorization list. The opening button and the picker are never rendered at
 * the same time, so the submit action of the active view is unambiguous.
 */
export function ManageAccessPanel({ owner, name, detail, onDetailChange }: ManageAccessPanelProps) {
  const [adding, setAdding] = useState(false);

  const save = async (input: { subjectType: string; subject: string; role: string }) => {
    const result = await saveRepositoryAccess(owner, name, {
      subjectType: input.subjectType === "team" ? "team" : "account",
      subject: input.subject,
      role: input.role,
    });
    if (result.ok) onDetailChange(result.data);
    return result;
  };

  return (
    <section className="access-panel" aria-label="Repository access">
      {detail.canManage ? (
        adding ? (
          <AccessSubjectPicker
            candidates={detail.candidates}
            roles={detail.roles}
            onSave={save}
            onClose={() => setAdding(false)}
          />
        ) : (
          <p className="access-panel__actions">
            <Button variant="primary" onClick={() => setAdding(true)}>Add people or teams</Button>
          </p>
        )
      ) : null}

      <AccessGrantTable
        owner={owner}
        name={name}
        grants={detail.grants}
        roles={detail.roles}
        canManage={detail.canManage}
        onDetailChange={onDetailChange}
      />
    </section>
  );
}

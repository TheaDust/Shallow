import { useState, type ChangeEvent, type FormEvent } from "react";

import { addOrganizationMember } from "../../org/org-api";
import type { OrganizationMemberErrors, OrganizationRole } from "../../org/types";
import { Button } from "../../ui/Button";
import { FormField } from "../../ui/FormField";

export interface AddMemberFormProps {
  organizationName: string;
  onChanged(): void;
}

/**
 * REQ-2-2-3: the “Add member” action of the People page. The opener opens the
 * labeled “Username or email” field, the “Role” combobox (Member by default,
 * Owner as the other option) and the submitting “Add member” button. While the
 * form is open the opener is hidden, so the submission button is the only
 * actionable “Add member” match. A rejected submit keeps the form open with the
 * entered username so it can be corrected and resubmitted.
 */
export function AddMemberForm({ organizationName, onChanged }: AddMemberFormProps) {
  const [formOpen, setFormOpen] = useState(false);
  const [identifier, setIdentifier] = useState("");
  const [role, setRole] = useState<OrganizationRole>("member");
  const [errors, setErrors] = useState<OrganizationMemberErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setErrors({});
    setFormError(null);
    try {
      const result = await addOrganizationMember(organizationName, { identifier, role });
      if (result.ok) {
        setIdentifier("");
        setRole("member");
        setFormOpen(false);
        onChanged();
        return;
      }
      setErrors(result.errors);
    } catch {
      setFormError("Unable to add the member. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  if (!formOpen) {
    return (
      <p className="org-people__actions">
        <Button variant="primary" onClick={() => setFormOpen(true)}>
          Add member
        </Button>
      </p>
    );
  }

  return (
    <form className="auth-form" onSubmit={submit} noValidate>
      <FormField id="organization-member-identifier" label="Username or email" error={errors.identifier}>
        <input
          id="organization-member-identifier"
          name="identifier"
          type="text"
          value={identifier}
          onChange={(event: ChangeEvent<HTMLInputElement>) => setIdentifier(event.target.value)}
        />
      </FormField>
      <FormField id="organization-member-role" label="Role" error={errors.role}>
        <select
          id="organization-member-role"
          name="role"
          value={role}
          onChange={(event: ChangeEvent<HTMLSelectElement>) =>
            setRole(event.target.value as OrganizationRole)
          }
        >
          <option value="member">Member</option>
          <option value="owner">Owner</option>
        </select>
      </FormField>
      {formError ? (
        <p className="auth-form__error" role="alert">
          {formError}
        </p>
      ) : null}
      <div className="form-actions">
        <Button type="submit" variant="primary" disabled={busy}>
          Add member
        </Button>
        <Button
          disabled={busy}
          onClick={() => {
            setIdentifier("");
            setRole("member");
            setErrors({});
            setFormError(null);
            setFormOpen(false);
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

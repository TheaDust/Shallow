import { useState, type FormEvent } from "react";

import { createTeam, type TeamFieldErrors } from "../lib/org-api";
import { navigate } from "../lib/hash-route";
import { Button } from "../ui/Button";
import { FormField } from "../ui/FormField";

/** Team creation form reached from the organization's Teams page. */
export function NewTeamPage({ organizationId }: { organizationId: string }) {
  const [name, setName] = useState("");
  const [fieldErrors, setFieldErrors] = useState<TeamFieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFieldErrors({});
    setMessage(null);
    try {
      const result = await createTeam(organizationId, name);
      if (result.ok) {
        navigate(`/orgs/${encodeURIComponent(organizationId)}/teams/${encodeURIComponent(result.value.name)}`);
        setBusy(false);
        return;
      }
      setFieldErrors(result.fieldErrors);
      if (Object.keys(result.fieldErrors).length === 0) setMessage(result.message);
    } catch {
      setMessage("Unable to create the team. Please try again.");
    }
    setBusy(false);
  };

  return (
    <main className="page">
      <section className="page__body team">
        <h1 className="team__new-title">New team</h1>
        <form className="team__form" aria-label="New team" onSubmit={submit} noValidate>
          {message ? (
            <p className="team__error" role="alert">
              {message}
            </p>
          ) : null}
          <FormField id="team-name" label="Team name" error={fieldErrors.name}>
            <input
              id="team-name"
              name="name"
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </FormField>
          <Button type="submit" variant="primary" disabled={busy}>
            Create team
          </Button>
        </form>
      </section>
    </main>
  );
}

import { useEffect, useState, type FormEvent } from "react";

import { navigate } from "../../lib/hash-route";
import {
  createTeam,
  fetchOrganization,
  fetchOrganizationTeams,
  type OrganizationTeam,
} from "../../lib/organizations-api";
import { fieldErrorsOf, messageOf, type FieldErrors } from "../../lib/session-api";
import { Button, FormField, fieldDescriptionIds } from "../../ui";
import { ProtectedPage } from "../account/ProtectedPage";

function NewTeamForm({ organizationName }: { organizationName: string }) {
  const [teams, setTeams] = useState<OrganizationTeam[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [parent, setParent] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchOrganizationTeams(organizationName)
      .then((list) => {
        if (!cancelled) setTeams(list);
      })
      .catch(() => {
        if (!cancelled) setTeams([]);
      });
    return () => {
      cancelled = true;
    };
  }, [organizationName]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFailure(null);
    try {
      // A compliant name is enough: description and parent team are optional.
      const team = await createTeam(organizationName, { name, description, parent });
      setFieldErrors({});
      navigate(`/organizations/${organizationName}/teams/${team.name}`);
    } catch (error) {
      const errors = fieldErrorsOf(error);
      setFieldErrors(errors);
      if (Object.keys(errors).length === 0) {
        setFailure(messageOf(error, "Unable to create the team right now."));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="team-form" noValidate onSubmit={handleSubmit}>
      {failure ? (
        <p className="form-error" role="alert">
          {failure}
        </p>
      ) : null}
      <FormField id="team-name" label="Team name" error={fieldErrors.name}>
        <input
          id="team-name"
          name="name"
          type="text"
          autoComplete="off"
          aria-describedby={fieldDescriptionIds("team-name", { error: Boolean(fieldErrors.name) })}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </FormField>
      <FormField id="team-description" label="Description">
        <input
          id="team-description"
          name="description"
          type="text"
          autoComplete="off"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </FormField>
      <FormField id="team-parent" label="Parent team" error={fieldErrors.parent}>
        <select
          id="team-parent"
          name="parent"
          value={parent}
          onChange={(event) => setParent(event.target.value)}
        >
          <option value="">No parent</option>
          {teams.map((team) => (
            <option key={team.name} value={team.name}>
              {team.name}
            </option>
          ))}
        </select>
      </FormField>
      <Button type="submit" variant="primary" disabled={busy}>
        Create team
      </Button>
    </form>
  );
}

/**
 * Team creation, reachable from the organization Teams tab. Only an
 * organization Owner may open it; the server re-checks the same rule.
 */
export function NewTeamPage({ organizationName }: { organizationName: string }) {
  const [loadState, setLoadState] = useState<"loading" | "ready" | "denied" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    setLoadState("loading");
    fetchOrganization(organizationName)
      .then((detail) => {
        if (cancelled) return;
        setLoadState(detail.viewerRole === "owner" ? "ready" : "denied");
      })
      .catch(() => {
        if (!cancelled) setLoadState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [organizationName]);

  return (
    <ProtectedPage title="New team">
      {loadState === "loading" ? <p role="status">Loading…</p> : null}
      {loadState === "denied" ? (
        <p role="status">Only an organization Owner can create teams.</p>
      ) : null}
      {loadState === "error" ? (
        <p className="form-error" role="alert">
          Unable to load this organization right now.
        </p>
      ) : null}
      {loadState === "ready" ? <NewTeamForm organizationName={organizationName} /> : null}
      <p className="team-form__aside">
        <a href={`#/organizations/${organizationName}?tab=teams`}>Teams</a>
      </p>
    </ProtectedPage>
  );
}

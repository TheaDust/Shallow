import { useEffect, useState } from "react";

import { NotFoundPage } from "./NotFoundPage";
import { readErrorFields } from "../lib/api";
import { navigate } from "../lib/hash-route";
import {
  createOrganizationTeam,
  fetchOrganizationTeams,
  type OrganizationTeam,
} from "../lib/organizations-api";
import { teamPath } from "../lib/organization-routes";
import { useOrganization } from "../organization/useOrganization";
import { Button } from "../ui/Button";
import { FormField } from "../ui/FormField";

export interface NewTeamPageProps {
  login: string;
}

/**
 * "New team" form (REQ-2-2-1). Only an organization Owner reaches it from the
 * Teams tab; the server refuses the creation for anybody else. A compliant name
 * is enough — the description and the parent team are optional, and a rejected
 * submission creates no team.
 */
export function NewTeamPage({ login }: NewTeamPageProps) {
  const { state } = useOrganization(login);
  const [teams, setTeams] = useState<OrganizationTeam[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [parentTeam, setParentTeam] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const isOwner = state.status === "ready" && state.viewer.isOwner;

  useEffect(() => {
    if (!isOwner) return;
    let active = true;
    fetchOrganizationTeams(login).then(
      (payload) => {
        if (active) setTeams(payload.teams);
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [login, isOwner]);

  if (state.status === "loading") {
    return (
      <main aria-busy="true">
        <p role="status">Loading organization…</p>
      </main>
    );
  }

  if (state.status === "missing") return <NotFoundPage />;
  if (state.status === "error") {
    return (
      <main>
        <h1>Organization unavailable</h1>
        <p role="alert">The organization could not be loaded. Reload the page to try again.</p>
      </main>
    );
  }

  if (!isOwner) {
    return (
      <main>
        <h1>New team</h1>
        <p role="alert">You must be an organization Owner to create a team.</p>
      </main>
    );
  }

  return (
    <main>
      <h1>New team</h1>
      <form
        className="organization-form"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setErrors({});
          try {
            const team = await createOrganizationTeam(login, { name, description, parentTeam });
            // The new team detail page is the destination of REQ-2-2-1.
            navigate(teamPath(login, team.name));
          } catch (error) {
            setErrors(readErrorFields(error));
          } finally {
            setBusy(false);
          }
        }}
      >
        <FormField id="team-name" label="Team name" error={errors.name}>
          <input
            id="team-name"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </FormField>
        <FormField id="team-description" label="Description">
          <textarea
            id="team-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </FormField>
        <FormField id="team-parent" label="Parent team" error={errors.parentTeam}>
          <select
            id="team-parent"
            value={parentTeam}
            onChange={(event) => setParentTeam(event.target.value)}
          >
            <option value="">None</option>
            {teams.map((team) => (
              <option key={team.id} value={team.name}>
                {team.name}
              </option>
            ))}
          </select>
        </FormField>
        <Button type="submit" variant="primary" disabled={busy}>
          Create team
        </Button>
      </form>
    </main>
  );
}

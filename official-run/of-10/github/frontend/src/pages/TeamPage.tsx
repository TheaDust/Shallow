import { useCallback, useEffect, useState } from "react";

import { NotFoundPage } from "./NotFoundPage";
import { readErrorFields } from "../lib/api";
import {
  fetchOrganizationTeam,
  saveTeamParent,
  type OrganizationTeamDetail,
} from "../lib/organizations-api";
import { teamHref, teamSettingsHref } from "../lib/organization-routes";
import { organizationHref } from "../lib/organization-routes";
import { TeamMembersSection } from "../organization/TeamMembersSection";
import { Button } from "../ui/Button";

export interface TeamPageProps {
  login: string;
  team: string;
  tab: "members" | "settings";
}

type LoadState =
  | { status: "loading" }
  | { status: "ready"; detail: OrganizationTeamDetail }
  | { status: "missing" }
  | { status: "forbidden" }
  | { status: "error" };

/**
 * Team detail page (REQ-2-2-1, REQ-2-2-2): the heading is
 * "organization name/team name", "Members" lists the direct team members and
 * "Settings" changes the parent team. Only an organization Owner maintains the
 * members and the hierarchy. The hierarchy is display and management metadata
 * only: it never adds a member or a permission to another team.
 */
export function TeamPage({ login, team, tab }: TeamPageProps) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [version, setVersion] = useState(0);
  const [parentTeam, setParentTeam] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    fetchOrganizationTeam(login, team).then(
      (detail) => {
        if (!active) return;
        setState({ status: "ready", detail });
        setParentTeam(detail.team.parent ? detail.team.parent.name : "");
      },
      (failure: unknown) => {
        if (!active) return;
        const code = (failure as { status?: number }).status;
        setState({
          status: code === 404 ? "missing" : code === 403 ? "forbidden" : "error",
        });
      },
    );
    return () => {
      active = false;
    };
  }, [login, team, version]);

  const reload = useCallback(() => setVersion((current) => current + 1), []);

  if (state.status === "loading") {
    return (
      <main aria-busy="true">
        <p role="status">Loading team…</p>
      </main>
    );
  }

  if (state.status === "missing") return <NotFoundPage />;
  if (state.status === "forbidden") {
    return (
      <main>
        <h1>Team unavailable</h1>
        <p role="alert">You must be an organization member to view this team.</p>
      </main>
    );
  }
  if (state.status === "error") {
    return (
      <main>
        <h1>Team unavailable</h1>
        <p role="alert">The team could not be loaded. Reload the page to try again.</p>
      </main>
    );
  }

  const { detail } = state;
  const { organization, viewer, team: currentTeam, members, parentOptions } = detail;

  return (
    <main>
      {/* The heading reads "organization name/team name": an organization is
          identified by its display name. */}
      <h1 className="team-header__name">
        {organization.name}/{currentTeam.name}
      </h1>
      <p className="team-header__organization">
        Organization:{" "}
        <a href={organizationHref(organization.login, "teams")}>{organization.login}</a>
      </p>
      <p className="team-header__parent">
        Parent team:{" "}
        {currentTeam.parent ? (
          <a href={teamHref(organization.login, currentTeam.parent.name)}>{currentTeam.parent.name}</a>
        ) : (
          "None"
        )}
      </p>
      {currentTeam.description ? (
        <p className="team-header__description">{currentTeam.description}</p>
      ) : null}
      <nav className="team-tabs" aria-label="Team">
        <a href={teamHref(organization.login, currentTeam.name)} aria-current={tab === "members" ? "page" : undefined}>
          Members
        </a>
        <a
          href={teamSettingsHref(organization.login, currentTeam.name)}
          aria-current={tab === "settings" ? "page" : undefined}
        >
          Settings
        </a>
      </nav>
      {tab === "members" ? (
        <section className="team-members" aria-labelledby="team-members-heading">
          <h2 id="team-members-heading">Members</h2>
          <TeamMembersSection
            login={organization.login}
            team={currentTeam.name}
            members={members}
            canManage={viewer.isOwner}
            onChanged={reload}
          />
        </section>
      ) : (
        <section className="team-settings" aria-labelledby="team-settings-heading">
          <h2 id="team-settings-heading">Settings</h2>
          {status ? <p role="status">{status}</p> : null}
          <form
            className="team-settings__form"
            onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              setError(null);
              setStatus(null);
              try {
                await saveTeamParent(organization.login, currentTeam.name, parentTeam);
                setStatus("Parent team saved.");
                reload();
              } catch (failure) {
                // A rejected change keeps the stored parent selected.
                const fields = readErrorFields(failure);
                setError(
                  fields.parentTeam ??
                    (failure instanceof Error && failure.message
                      ? failure.message
                      : "The parent team could not be saved."),
                );
                setParentTeam(currentTeam.parent ? currentTeam.parent.name : "");
              } finally {
                setBusy(false);
              }
            }}
          >
            <label htmlFor="team-parent-select">Parent team</label>
            <select
              id="team-parent-select"
              value={parentTeam}
              disabled={!viewer.isOwner}
              onChange={(event) => setParentTeam(event.target.value)}
            >
              <option value="">None</option>
              {parentOptions.map((option) => (
                <option key={option.id} value={option.name}>
                  {option.name}
                </option>
              ))}
            </select>
            {error ? (
              <p role="alert" className="team-settings__error">
                {error}
              </p>
            ) : null}
            <Button type="submit" variant="primary" disabled={busy || !viewer.isOwner}>
              Save
            </Button>
          </form>
        </section>
      )}
    </main>
  );
}

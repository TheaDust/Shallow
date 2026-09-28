import { useCallback, useEffect, useState } from "react";

import { AppHeader } from "../../components/AppHeader";
import {
  addTeamMember,
  fetchOrganization,
  fetchTeam,
  listTeams,
  OrganizationSummary,
  removeTeamMember,
  saveTeamParent,
  TeamDetail,
  TeamFieldErrors,
  TeamSummary,
} from "../../lib/org-api";
import { useSession } from "../../session";

export type TeamTab = "members" | "settings";

/**
 * Team detail page titled “organization name/team name” with Members and
 * Settings links. Only an organization Owner may maintain members or
 * hierarchy; the server enforces this for every write.
 */
export function TeamPage({ orgName, teamName, tab }: { orgName: string; teamName: string; tab: TeamTab }) {
  const { status } = useSession();
  const [org, setOrg] = useState<OrganizationSummary | null>(null);
  const [team, setTeam] = useState<TeamDetail | null>(null);
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [notFound, setNotFound] = useState(false);

  const loadTeam = useCallback(() => {
    fetchTeam(orgName, teamName)
      .then(setTeam)
      .catch(() => setNotFound(true));
  }, [orgName, teamName]);

  useEffect(() => {
    let cancelled = false;
    setNotFound(false);
    setTeam(null);
    fetchOrganization(orgName)
      .then((result) => {
        if (!cancelled) setOrg(result);
      })
      .catch(() => undefined);
    listTeams(orgName)
      .then((result) => {
        if (!cancelled) setTeams(result);
      })
      .catch(() => undefined);
    loadTeam();
    return () => {
      cancelled = true;
    };
  }, [orgName, teamName, loadTeam]);

  if (notFound || status === "loading") {
    return (
      <AppHeader>
        <main>
          <h1>{orgName}/{teamName}</h1>
          {notFound ? <p>Team not found.</p> : <p>Loading…</p>}
        </main>
      </AppHeader>
    );
  }

  if (!team) {
    return (
      <AppHeader>
        <main>
          <h1>{orgName}/{teamName}</h1>
          <p>Loading…</p>
        </main>
      </AppHeader>
    );
  }

  const isOwner = status === "authenticated" && org?.role === "owner";

  return (
    <AppHeader>
      <main>
        <h1>{orgName}/{team.name}</h1>
        <nav className="org-tabs" aria-label="Team">
          <a
            className="org-tabs__link"
            href={`#/o/${orgName}/teams/${encodeURIComponent(team.name)}/members`}
            aria-current={tab === "members" ? "page" : undefined}
          >
            Members
          </a>
          <a
            className="org-tabs__link"
            href={`#/o/${orgName}/teams/${encodeURIComponent(team.name)}/settings`}
            aria-current={tab === "settings" ? "page" : undefined}
          >
            Settings
          </a>
        </nav>
        {tab === "members" && (
          <MembersTab
            orgName={orgName}
            team={team}
            isOwner={isOwner}
            onChanged={loadTeam}
          />
        )}
        {tab === "settings" && (
          <SettingsTab
            orgName={orgName}
            team={team}
            teams={teams}
            isOwner={isOwner}
            onChanged={loadTeam}
          />
        )}
      </main>
    </AppHeader>
  );
}

function MembersTab({
  orgName,
  team,
  isOwner,
  onChanged,
}: {
  orgName: string;
  team: TeamDetail;
  isOwner: boolean;
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [username, setUsername] = useState("");
  const [errors, setErrors] = useState<TeamFieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  async function handleAdd(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setErrors({});
    setSubmitting(true);
    try {
      const result = await addTeamMember(orgName, team.name, username);
      if (!result.ok) {
        setErrors(result.errors);
        return;
      }
      setUsername("");
      setAdding(false);
      onChanged();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRemove(memberUsername: string) {
    await removeTeamMember(orgName, team.name, memberUsername);
    onChanged();
  }

  return (
    <section aria-label="Members">
      {!adding && isOwner && (
        <p>
          <button type="button" className="button" onClick={() => setAdding(true)}>
            Add member
          </button>
        </p>
      )}
      {adding && (
        <form className="account-form account-form--inline" onSubmit={(event) => void handleAdd(event)}>
          <div className="account-form__field">
            <label htmlFor="team-member-username">Username</label>
            <input
              id="team-member-username"
              type="text"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              aria-describedby={errors.username ? "team-member-username-error" : undefined}
              autoComplete="off"
            />
            {errors.username && (
              <p className="account-form__error" id="team-member-username-error">
                {errors.username}
              </p>
            )}
          </div>
          <button type="submit" className="button button--primary" disabled={submitting}>
            Add member
          </button>
        </form>
      )}
      <ul className="member-list">
        {team.members.map((member) => (
          <li key={member.username} className="member-list__item">
            <span className="member-list__username">{member.username}</span>
            {isOwner && (
              <button
                type="button"
                className="button"
                onClick={() => void handleRemove(member.username)}
              >
                Remove {member.username}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function SettingsTab({
  orgName,
  team,
  teams,
  isOwner,
  onChanged,
}: {
  orgName: string;
  team: TeamDetail;
  teams: TeamSummary[];
  isOwner: boolean;
  onChanged: () => void;
}) {
  const [parentTeamId, setParentTeamId] = useState<string>(team.parentTeamId ?? "");
  const [errors, setErrors] = useState<TeamFieldErrors>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setParentTeamId(team.parentTeamId ?? "");
    setErrors({});
  }, [team.parentTeamId]);

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    setErrors({});
    setSaving(true);
    try {
      const result = await saveTeamParent(orgName, team.name, parentTeamId === "" ? null : parentTeamId);
      if (!result.ok) {
        setErrors(result.errors);
        // A rejected change keeps the stored selection; revert the select.
        setParentTeamId(team.parentTeamId ?? "");
        return;
      }
      onChanged();
    } finally {
      setSaving(false);
    }
  }

  const options = teams.filter((candidate) => candidate.id !== team.id);

  return (
    <section aria-label="Settings">
      <form className="account-form" onSubmit={(event) => void handleSave(event)}>
        <div className="account-form__field">
          <label htmlFor="team-parent-select">Parent team</label>
          <select
            id="team-parent-select"
            value={parentTeamId}
            onChange={(event) => setParentTeamId(event.target.value)}
            disabled={!isOwner || saving}
          >
            {team.parentTeamId === null && <option value="">None</option>}
            {options.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </select>
          {errors.parentTeam && (
            <p className="account-form__error" id="team-parent-select-error">
              {errors.parentTeam}
            </p>
          )}
        </div>
        {isOwner && (
          <button type="submit" className="button button--primary" disabled={saving}>
            Save
          </button>
        )}
      </form>
    </section>
  );
}

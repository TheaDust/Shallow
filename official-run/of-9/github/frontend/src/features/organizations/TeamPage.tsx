import { useEffect, useState, type FormEvent } from "react";

import { Button, FormField } from "../../ui";
import {
  addTeamMember,
  getTeam,
  listTeamMembers,
  listTeams,
  removeTeamMember,
  setTeamParent,
  type TeamInfo,
  type TeamOverview,
} from "./api";

export type TeamTab = "members" | "settings";

interface TeamPageProps {
  orgId: string;
  teamName: string;
  tab: TeamTab;
}

export function TeamPage({ orgId, teamName, tab }: TeamPageProps) {
  const [overview, setOverview] = useState<TeamOverview | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setOverview(null);
    getTeam(orgId, teamName)
      .then((team) => {
        if (!cancelled) setOverview(team);
      })
      .catch(() => {
        if (!cancelled) setNotFound(true);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId, teamName]);

  if (notFound) {
    return (
      <section className="team-page">
        <h1>Team not found</h1>
      </section>
    );
  }
  if (!overview) {
    return (
      <p role="status" className="page-status">
        Loading…
      </p>
    );
  }

  const isOwner = overview.myRole === "owner";

  return (
    <section className="team-page">
      <header className="team-page__header">
        <h1>
          {orgId}/{teamName}
        </h1>
        <p className="team-page__org">Organization: {orgId}</p>
        <p className="team-page__parent">
          {overview.team.parentName ? `Parent team: ${overview.team.parentName}` : "No parent team"}
        </p>
      </header>
      <nav className="team-tabs" aria-label="Team">
        <a
          href={`#/orgs/${orgId}/teams/${teamName}/members`}
          className={tab === "members" ? "team-tabs__tab team-tabs__tab--active" : "team-tabs__tab"}
          aria-current={tab === "members" ? "page" : undefined}
        >
          Members
        </a>
        <a
          href={`#/orgs/${orgId}/teams/${teamName}/settings`}
          className={tab === "settings" ? "team-tabs__tab team-tabs__tab--active" : "team-tabs__tab"}
          aria-current={tab === "settings" ? "page" : undefined}
        >
          Settings
        </a>
      </nav>
      {tab === "members" ? (
        <MembersTab orgId={orgId} teamName={teamName} isOwner={isOwner} />
      ) : (
        <SettingsTab orgId={orgId} teamName={teamName} overview={overview} isOwner={isOwner} />
      )}
    </section>
  );
}

function MembersTab({
  orgId,
  teamName,
  isOwner,
}: {
  orgId: string;
  teamName: string;
  isOwner: boolean;
}) {
  const [members, setMembers] = useState<string[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setMembers(await listTeamMembers(orgId, teamName));
  };

  useEffect(() => {
    let cancelled = false;
    listTeamMembers(orgId, teamName)
      .then((list) => {
        if (!cancelled) setMembers(list);
      })
      .catch(() => {
        if (!cancelled) setMembers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId, teamName]);

  const submitAdd = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await addTeamMember(orgId, teamName, username);
      if (result.ok) {
        setUsername("");
        setAdding(false);
        await refresh();
      } else {
        setError(result.errors.username ?? null);
      }
    } finally {
      setBusy(false);
    }
  };

  const remove = async (member: string) => {
    await removeTeamMember(orgId, teamName, member);
    await refresh();
  };

  return (
    <div className="team-members">
      {isOwner && !adding ? (
        <Button variant="primary" onClick={() => setAdding(true)}>
          Add member
        </Button>
      ) : null}
      {isOwner && adding ? (
        <form className="team-member-add" onSubmit={submitAdd} noValidate>
          <FormField id="team-add-username" label="Username" error={error ?? undefined}>
            <input
              id="team-add-username"
              type="text"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </FormField>
          <Button type="submit" variant="primary" disabled={busy}>
            Add member
          </Button>
        </form>
      ) : null}
      {!members ? (
        <p role="status" className="page-status">
          Loading…
        </p>
      ) : members.length === 0 ? (
        <p className="team-members__empty">This team has no members.</p>
      ) : (
        <ul className="team-members__list">
          {members.map((member) => (
            <li key={member} className="team-members__item">
              <span className="team-members__username">{member}</span>
              {isOwner ? (
                <Button variant="ghost" onClick={() => void remove(member)}>
                  Remove {member}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SettingsTab({
  orgId,
  teamName,
  overview,
  isOwner,
}: {
  orgId: string;
  teamName: string;
  overview: TeamOverview;
  isOwner: boolean;
}) {
  const [teams, setTeams] = useState<TeamInfo[] | null>(null);
  const [parentId, setParentId] = useState(overview.team.parentId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setParentId(overview.team.parentId ?? "");
  }, [overview.team.parentId]);

  useEffect(() => {
    let cancelled = false;
    listTeams(orgId)
      .then((list) => {
        if (!cancelled) setTeams(list);
      })
      .catch(() => {
        if (!cancelled) setTeams([]);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await setTeamParent(orgId, teamName, parentId === "" ? null : parentId);
      if (result.ok) {
        setParentId(result.team.parentId ?? "");
      } else {
        setError(result.errors.parentId ?? null);
        setParentId(overview.team.parentId ?? "");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="team-settings">
      {!isOwner ? (
        <p className="team-settings__notice">Only an organization Owner can manage this team.</p>
      ) : (
        <>
          <FormField id="team-parent-team" label="Parent team" error={error ?? undefined}>
            <select
              id="team-parent-team"
              value={parentId}
              disabled={!teams}
              onChange={(event) => {
                setError(null);
                setParentId(event.target.value);
              }}
            >
              <option value="">No parent</option>
              {(teams ?? [])
                .filter((team) => team.id !== overview.team.id)
                .map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
            </select>
          </FormField>
          <Button variant="primary" disabled={busy || !teams} onClick={() => void save()}>
            Save
          </Button>
        </>
      )}
    </div>
  );
}

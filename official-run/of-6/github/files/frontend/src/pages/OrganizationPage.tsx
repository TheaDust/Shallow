import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import {
  apiAddOrganizationMember,
  apiOrganization,
  apiOrganizationPeople,
  apiOrganizationRepositories,
  apiOrganizationTeams,
  apiRemoveOrganizationMember,
} from '../api';
import { useSession } from '../session';
import MemberActionMenu from '../components/MemberActionMenu';
import type {
  AddOrganizationMemberErrors,
  AddOrganizationMemberResult,
  OrganizationMember,
  OrganizationSummary,
  RepoSummary,
  TeamSummary,
} from '../types';

export type OrganizationTab = 'repositories' | 'people' | 'teams';

interface OrganizationPageProps {
  name: string;
  tab: OrganizationTab;
}

function formatUpdatedAt(updatedAt: string): string {
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) {
    return 'Updated recently';
  }
  return `Updated ${date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })}`;
}

function visibilityLabel(visibility: 'public' | 'private'): string {
  return visibility === 'public' ? 'Public' : 'Private';
}

function RepositoryList({
  repositories,
  owner,
}: {
  repositories: RepoSummary[];
  owner: string;
}) {
  const [query, setQuery] = useState('');
  const [type, setType] = useState('All');

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return repositories
      .filter((repo) => {
        if (q !== '' && !repo.name.toLowerCase().includes(q)) {
          return false;
        }
        if (type === 'Public' && repo.visibility !== 'public') {
          return false;
        }
        if (type === 'Private' && repo.visibility !== 'private') {
          return false;
        }
        return true;
      })
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  }, [repositories, query, type]);

  return (
    <div className="repositories-view">
      <div className="repository-filters">
        <div className="field repository-search-field">
          <label htmlFor="find-a-repository">Find a repository</label>
          <input
            id="find-a-repository"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="field repository-type-field">
          <label htmlFor="repository-type">Type</label>
          <select
            id="repository-type"
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            <option value="All">All</option>
            <option value="Public">Public</option>
            <option value="Private">Private</option>
          </select>
        </div>
      </div>
      {visible.length === 0 ? (
        <p className="muted-text">No repositories found.</p>
      ) : (
        <ul className="repository-list">
          {visible.map((repo) => (
            <li key={repo.name} className="repository-list-item">
              <a
                className="repository-name-link"
                href={`#/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(
                  repo.name
                )}`}
              >
                {repo.name}
              </a>
              {repo.description ? (
                <p className="repository-description">{repo.description}</p>
              ) : null}
              <div className="repository-meta">
                <span className="repository-visibility">{visibilityLabel(repo.visibility)}</span>
                <span className="repository-updated">{formatUpdatedAt(repo.updatedAt)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * REQ-2-2-3 People tab: lists organization members with their role. An
 * organization Owner sees the "Add member" button, which opens a form with
 * the labeled field "Username or email", a combobox "Role" (defaulting to
 * Member, options Member/Owner) and a submission button "Add member". The
 * opening button stays visible while the form is open, and the form (with its
 * submit button) follows it in page order. On failure the form stays open
 * with the identifier preserved so it can be corrected and resubmitted; on
 * success the form closes and the fresh member list is displayed.
 *
 * REQ-2-2-4: every removable member row (a member the signed-in Owner may
 * remove, i.e. anyone but the Owner themselves when they are the only Owner)
 * carries a "Member menu <username>" button that opens the menuitem "Remove
 * from organization" and then a "Remove" confirmation dialog. A non-Owner
 * sees no member-menu controls at all, not merely disabled ones.
 */
function PeopleView({
  members,
  canManage,
  currentUser,
  onAdd,
  onRemove,
}: {
  members: OrganizationMember[];
  canManage: boolean;
  currentUser: string | null;
  onAdd: (identifier: string, role: 'member' | 'owner') => Promise<AddOrganizationMemberResult>;
  onRemove: (username: string) => Promise<{ ok: boolean; message?: string }>;
}) {
  const [adding, setAdding] = useState(false);
  const [identifier, setIdentifier] = useState('');
  const [role, setRole] = useState<'member' | 'owner'>('member');
  const [errors, setErrors] = useState<AddOrganizationMemberErrors>({});
  const [submitting, setSubmitting] = useState(false);
  // Synchronous guard: a single click can fire the submit handler more than
  // once in some environments; only the first invocation sends the request.
  const submittingRef = useRef(false);

  const ownerCount = members.filter((m) => m.role === 'owner').length;

  function isRemovable(member: OrganizationMember): boolean {
    // The last Owner cannot be removed; everyone else is removable by the
    // signed-in Owner (including the Owner themselves while another Owner
    // remains).
    if (currentUser === null) {
      return false;
    }
    return member.username !== currentUser || ownerCount > 1;
  }

  function openForm() {
    setErrors({});
    setIdentifier('');
    setRole('member');
    setAdding(true);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current) {
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    setErrors({});
    try {
      const result = await onAdd(identifier.trim(), role);
      if (result.ok) {
        // The fresh member list is already reloaded; close the form so the
        // opening Add member button is again the only actionable entry.
        setAdding(false);
        setIdentifier('');
        setRole('member');
      } else {
        // Keep the form open so the username can be corrected and resubmitted.
        setErrors(result.errors);
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <div className="people-view">
      {canManage ? (
        <>
          <button
            type="button"
            className="primary-button add-member-button"
            onClick={openForm}
          >
            Add member
          </button>
          {adding ? (
            <form className="add-member-form" onSubmit={handleSubmit} noValidate>
              <div className="field">
                <label htmlFor="add-member-identifier">Username or email</label>
                <input
                  id="add-member-identifier"
                  type="text"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  aria-describedby={errors.identifier ? 'add-member-identifier-error' : undefined}
                  aria-invalid={errors.identifier ? true : undefined}
                />
                {errors.identifier ? (
                  <p id="add-member-identifier-error" className="field-error">
                    {errors.identifier}
                  </p>
                ) : null}
              </div>
              <div className="field">
                <label htmlFor="add-member-role">Role</label>
                <select
                  id="add-member-role"
                  value={role}
                  onChange={(e) => setRole(e.target.value as 'member' | 'owner')}
                  aria-describedby={errors.role ? 'add-member-role-error' : undefined}
                  aria-invalid={errors.role ? true : undefined}
                >
                  <option value="member">Member</option>
                  <option value="owner">Owner</option>
                </select>
                {errors.role ? (
                  <p id="add-member-role-error" className="field-error">
                    {errors.role}
                  </p>
                ) : null}
              </div>
              <div className="add-member-actions">
                <button type="submit" className="primary-button" disabled={submitting}>
                  Add member
                </button>
              </div>
            </form>
          ) : null}
        </>
      ) : null}
      {members.length === 0 ? (
        <p className="muted-text">No members yet.</p>
      ) : (
        <ul className="people-list">
          {members.map((member) => (
            <li key={member.username} className="people-list-item">
              <span className="people-username">{member.username}</span>
              <span className="people-role">{member.role === 'owner' ? 'Owner' : 'Member'}</span>
              {canManage && isRemovable(member) ? (
                <MemberActionMenu
                  username={member.username}
                  onRemove={() => onRemove(member.username)}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TeamsList({ teams, owner }: { teams: TeamSummary[]; owner: string }) {
  if (teams.length === 0) {
    return <p className="muted-text">No teams yet.</p>;
  }
  const byParent = new Map<string, TeamSummary[]>();
  for (const team of teams) {
    const key = team.parentTeamName ?? '';
    if (!byParent.has(key)) {
      byParent.set(key, []);
    }
    byParent.get(key)!.push(team);
  }
  const renderLevel = (parentKey: string) => {
    const children = (byParent.get(parentKey) ?? []).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
    if (children.length === 0) {
      return null;
    }
    return (
      <ul className="team-tree-list">
        {children.map((team) => (
          <li key={team.name} className="team-tree-list-item">
            <a
              className="team-name-link"
              href={`#/organizations/${encodeURIComponent(owner)}/teams/${encodeURIComponent(team.name)}`}
            >
              {team.name}
            </a>
            {team.description ? (
              <span className="team-description">{team.description}</span>
            ) : null}
            {renderLevel(team.name)}
          </li>
        ))}
      </ul>
    );
  };
  return (
    <div className="team-tree-root">
      <p className="team-tree-root-org">{owner}</p>
      {renderLevel('')}
    </div>
  );
}

/**
 * Public organization overview (REQ-2-1). The organization name (identifier)
 * is the heading; the display name is shown alongside. Repositories / People /
 * Teams are navigation links styled as tabs. The Repositories view lists only
 * repositories visible to the current user with live name filtering and a
 * public/private filter.
 */
export default function OrganizationPage({ name, tab }: OrganizationPageProps) {
  const { auth } = useSession();
  const currentUser =
    auth.status === 'ready' && auth.user ? auth.user.username : null;
  const [organization, setOrganization] = useState<OrganizationSummary | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [repositories, setRepositories] = useState<RepoSummary[] | null>(null);
  const [members, setMembers] = useState<OrganizationMember[] | null>(null);
  const [teams, setTeams] = useState<TeamSummary[] | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setOrganization(null);
    setRole(null);
    setRepositories(null);
    setMembers(null);
    setTeams(null);
    setNotFound(false);
    setLoadError(false);

    apiOrganization(name).then((result) => {
      if (cancelled) {
        return;
      }
      if (!result.ok) {
        setNotFound(true);
        return;
      }
      setOrganization(result.organization);
      setRole(result.role ?? null);
    });

    if (tab === 'repositories') {
      apiOrganizationRepositories(name).then((result) => {
        if (cancelled) {
          return;
        }
        if (result.ok) {
          setRepositories(result.repositories);
        } else if (!result.ok) {
          setLoadError(true);
        }
      });
    } else if (tab === 'people') {
      apiOrganizationPeople(name).then((result) => {
        if (cancelled) {
          return;
        }
        if (result.ok) {
          setMembers(result.members);
        } else {
          setLoadError(true);
        }
      });
    } else {
      apiOrganizationTeams(name).then((result) => {
        if (cancelled) {
          return;
        }
        if (result.ok) {
          setTeams(result.teams);
        } else {
          setLoadError(true);
        }
      });
    }

    return () => {
      cancelled = true;
    };
  }, [name, tab]);

  if (notFound) {
    return (
      <div className="organization-page">
        <h1>Organization not found</h1>
        <p className="muted-text">
          No organization named “{name}” exists on this platform.
        </p>
      </div>
    );
  }

  async function handleAddMember(
    identifier: string,
    role: 'member' | 'owner'
  ): Promise<AddOrganizationMemberResult> {
    const result = await apiAddOrganizationMember(name, { identifier, role });
    if (result.ok) {
      // Reload the people list so the new member appears immediately.
      const peopleResult = await apiOrganizationPeople(name);
      if (peopleResult.ok) {
        setMembers(peopleResult.members);
      } else {
        setLoadError(true);
      }
    }
    return result;
  }

  async function handleRemoveMember(
    username: string
  ): Promise<{ ok: boolean; message?: string }> {
    const result = await apiRemoveOrganizationMember(name, username);
    if (result.ok) {
      // Reload the people list so the removed username disappears immediately.
      const peopleResult = await apiOrganizationPeople(name);
      if (peopleResult.ok) {
        setMembers(peopleResult.members);
      } else {
        setLoadError(true);
      }
      return { ok: true };
    }
    return { ok: false, message: result.message };
  }

  const ownerHref = `#/organizations/${encodeURIComponent(name)}`;

  return (
    <div className="organization-page">
      <h1>{organization ? organization.name : name}</h1>
      {organization && organization.displayName !== organization.name ? (
        <p className="organization-display-name">{organization.displayName}</p>
      ) : null}
      <nav className="organization-tabs" aria-label="Organization">
        <a
          className={tab === 'repositories' ? 'organization-tab active' : 'organization-tab'}
          href={ownerHref}
          aria-current={tab === 'repositories' ? 'page' : undefined}
        >
          Repositories
        </a>
        <a
          className={tab === 'people' ? 'organization-tab active' : 'organization-tab'}
          href={`${ownerHref}/people`}
          aria-current={tab === 'people' ? 'page' : undefined}
        >
          People
        </a>
        <a
          className={tab === 'teams' ? 'organization-tab active' : 'organization-tab'}
          href={`${ownerHref}/teams`}
          aria-current={tab === 'teams' ? 'page' : undefined}
        >
          Teams
        </a>
      </nav>
      {loadError ? (
        <p role="alert" className="form-error">
          The organization data could not be loaded.
        </p>
      ) : tab === 'repositories' ? (
        repositories === null ? (
          <p className="loading">Loading…</p>
        ) : (
          <RepositoryList repositories={repositories} owner={name} />
        )
      ) : tab === 'people' ? (
        members === null ? (
          <p className="loading">Loading…</p>
        ) : (
          <PeopleView
            members={members}
            canManage={role === 'owner'}
            currentUser={currentUser}
            onAdd={handleAddMember}
            onRemove={handleRemoveMember}
          />
        )
      ) : teams === null ? (
        <p className="loading">Loading…</p>
      ) : (
        <>
          {role === 'owner' ? (
            <a className="new-team-link" href={`#/organizations/${encodeURIComponent(name)}/teams/new`}>
              New team
            </a>
          ) : null}
          <TeamsList teams={teams} owner={name} />
        </>
      )}
    </div>
  );
}

import { Fragment, useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import {
  apiAddTeamMember,
  apiOrganization,
  apiOrganizationTeams,
  apiRemoveTeamMember,
  apiTeam,
  apiTeamMembers,
  apiUpdateTeamParent,
} from '../api';
import type {
  AddTeamMemberResult,
  CreateTeamErrors,
  TeamDetail,
  TeamSummary,
} from '../types';

export type TeamTab = 'members' | 'settings';

interface TeamPageProps {
  name: string;
  team: string;
  tab: TeamTab;
}

/**
 * REQ-2-2-1/2-2-2 team detail page, titled "organization name/team name". The
 * team tree renders the owning organization and the selected parent team (plus
 * any ancestors). "Members" lists the team's direct members; an organization
 * Owner can add current organization members with "Add member" and remove them
 * immediately with "Remove <username>" (no confirmation). "Settings" lets an
 * organization Owner change the parent team (a cyclic hierarchy is rejected
 * and the original parent stays selected).
 */
export default function TeamPage({ name, team, tab }: TeamPageProps) {
  const [detail, setDetail] = useState<TeamDetail | null>(null);
  const [members, setMembers] = useState<{ username: string }[] | null>(null);
  const [orgTeams, setOrgTeams] = useState<TeamSummary[] | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [roleLoaded, setRoleLoaded] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const [parentSelection, setParentSelection] = useState('');
  const [settingsError, setSettingsError] = useState<CreateTeamErrors>({});
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadDetail = useCallback(() => {
    apiTeam(name, team).then((result) => {
      if (!result.ok) {
        setNotFound(true);
        return;
      }
      setDetail(result.team);
      setParentSelection(result.team.parentTeamName ?? '');
    });
  }, [name, team]);

  const loadMembers = useCallback(() => {
    apiTeamMembers(name, team).then((result) => {
      if (result.ok) {
        setMembers(result.members);
      } else {
        setLoadError(true);
      }
    });
  }, [name, team]);

  useEffect(() => {
    let cancelled = false;
    setNotFound(false);
    setLoadError(false);
    setDetail(null);
    setMembers(null);
    setOrgTeams(null);
    setRole(null);
    setRoleLoaded(false);
    setSettingsError({});
    setSettingsSaved(false);

    apiTeam(name, team).then((result) => {
      if (cancelled) {
        return;
      }
      if (!result.ok) {
        setNotFound(true);
        return;
      }
      setDetail(result.team);
      setParentSelection(result.team.parentTeamName ?? '');
    });
    apiOrganization(name).then((result) => {
      if (cancelled) {
        return;
      }
      if (result.ok) {
        setRole(result.role ?? null);
      }
      setRoleLoaded(true);
    });
    if (tab === 'members') {
      apiTeamMembers(name, team).then((result) => {
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
          setOrgTeams(result.teams);
        } else {
          setLoadError(true);
        }
      });
    }

    return () => {
      cancelled = true;
    };
  }, [name, team, tab]);

  async function handleAddMember(username: string): Promise<AddTeamMemberResult> {
    const result = await apiAddTeamMember(name, team, username);
    if (result.ok) {
      loadMembers();
    }
    return result;
  }

  async function handleRemoveMember(username: string) {
    const result = await apiRemoveTeamMember(name, team, username);
    if (result.ok) {
      loadMembers();
    } else {
      setLoadError(true);
    }
  }

  async function handleSaveParent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) {
      return;
    }
    setSaving(true);
    setSettingsError({});
    setSettingsSaved(false);
    try {
      const result = await apiUpdateTeamParent(name, team, {
        parentTeamName: parentSelection,
      });
      if (result.ok) {
        setSettingsSaved(true);
        loadDetail();
      } else {
        // A rejected change keeps the original parent selected.
        setSettingsError(result.errors);
        setParentSelection(detail?.parentTeamName ?? '');
      }
    } finally {
      setSaving(false);
    }
  }

  if (notFound) {
    return (
      <div className="team-page">
        <h1>Team not found</h1>
        <p className="muted-text">
          No team named “{team}” exists in organization “{name}”.
        </p>
      </div>
    );
  }

  const title = detail ? `${detail.organization.name}/${detail.name}` : `${name}/${team}`;
  const baseHref = `#/organizations/${encodeURIComponent(name)}/teams/${encodeURIComponent(team)}`;

  return (
    <div className="team-page">
      <h1>{title}</h1>
      {detail ? (
        <nav className="team-tree" aria-label="Team hierarchy">
          <span className="team-tree-node team-tree-org">{detail.organization.name}</span>
          {detail.ancestorNames.map((ancestor) => (
            <Fragment key={ancestor}>
              <span className="team-tree-separator" aria-hidden="true">
                {' '}/{' '}
              </span>
              <a
                className="team-tree-node team-tree-parent"
                href={`#/organizations/${encodeURIComponent(detail.organization.name)}/teams/${encodeURIComponent(ancestor)}`}
              >
                {ancestor}
              </a>
            </Fragment>
          ))}
          <span className="team-tree-separator" aria-hidden="true">
            {' '}/{' '}
          </span>
          <span className="team-tree-node team-tree-current">{detail.name}</span>
        </nav>
      ) : null}
      <nav className="organization-tabs" aria-label="Team">
        <a
          className={tab === 'members' ? 'organization-tab active' : 'organization-tab'}
          href={baseHref}
          aria-current={tab === 'members' ? 'page' : undefined}
        >
          Members
        </a>
        <a
          className={tab === 'settings' ? 'organization-tab active' : 'organization-tab'}
          href={`${baseHref}/settings`}
          aria-current={tab === 'settings' ? 'page' : undefined}
        >
          Settings
        </a>
      </nav>

      {loadError ? (
        <p role="alert" className="form-error">
          The team data could not be loaded.
        </p>
      ) : detail === null ? (
        <p className="loading">Loading…</p>
      ) : tab === 'members' ? (
        <MembersView
          members={members}
          canManage={roleLoaded && role === 'owner'}
          onAdd={handleAddMember}
          onRemove={handleRemoveMember}
        />
      ) : (
        <SettingsView
          detail={detail}
          orgTeams={orgTeams}
          role={role}
          roleLoaded={roleLoaded}
          parentSelection={parentSelection}
          onParentChange={setParentSelection}
          onSubmit={handleSaveParent}
          saving={saving}
          errors={settingsError}
          saved={settingsSaved}
        />
      )}
    </div>
  );
}

interface MembersViewProps {
  members: { username: string }[] | null;
  canManage: boolean;
  onAdd: (username: string) => Promise<AddTeamMemberResult>;
  onRemove: (username: string) => Promise<void>;
}

function MembersView({ members, canManage, onAdd, onRemove }: MembersViewProps) {
  const [adding, setAdding] = useState(false);
  const [username, setUsername] = useState('');
  const [addError, setAddError] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);

  if (members === null) {
    return <p className="loading">Loading…</p>;
  }

  async function handleAddSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) {
      return;
    }
    setSubmitting(true);
    setAddError(undefined);
    try {
      const result = await onAdd(username.trim());
      if (result.ok) {
        // The fresh member list is already reloaded; close the form so the
        // next step's "Add member" button is again the only actionable match.
        setAdding(false);
        setUsername('');
      } else {
        setAddError(result.errors.username);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="team-members-view">
      {canManage && !adding ? (
        <button
          type="button"
          className="primary-button add-member-button"
          onClick={() => {
            setAddError(undefined);
            setUsername('');
            setAdding(true);
          }}
        >
          Add member
        </button>
      ) : null}
      {canManage && adding ? (
        <form className="add-member-form" onSubmit={handleAddSubmit} noValidate>
          <div className="field">
            <label htmlFor="add-member-username">Username</label>
            <input
              id="add-member-username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              aria-describedby={addError ? 'add-member-username-error' : undefined}
              aria-invalid={addError ? true : undefined}
            />
            {addError ? (
              <p id="add-member-username-error" className="field-error">
                {addError}
              </p>
            ) : null}
          </div>
          <div className="add-member-actions">
            <button type="submit" className="primary-button" disabled={submitting}>
              Add member
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setAdding(false);
                setUsername('');
                setAddError(undefined);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}
      {members.length === 0 ? (
        <p className="muted-text">No members yet.</p>
      ) : (
        <ul className="team-members-list">
          {members.map((member) => (
            <li key={member.username} className="team-member-item">
              <span className="team-member-username">{member.username}</span>
              {canManage ? (
                <button
                  type="button"
                  className="remove-member-button"
                  onClick={() => void onRemove(member.username)}
                >
                  Remove {member.username}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface SettingsViewProps {
  detail: TeamDetail;
  orgTeams: TeamSummary[] | null;
  role: string | null;
  roleLoaded: boolean;
  parentSelection: string;
  onParentChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  saving: boolean;
  errors: CreateTeamErrors;
  saved: boolean;
}

function SettingsView({
  detail,
  orgTeams,
  role,
  roleLoaded,
  parentSelection,
  onParentChange,
  onSubmit,
  saving,
  errors,
  saved,
}: SettingsViewProps) {
  if (!roleLoaded) {
    return <p className="loading">Loading…</p>;
  }
  if (role !== 'owner') {
    return (
      <p className="muted-text">
        Parent team: {detail.parentTeamName ?? 'None'}
      </p>
    );
  }
  return (
    <form className="team-settings-form" onSubmit={onSubmit} noValidate>
      <div className="field">
        <label htmlFor="team-parent-select">Parent team</label>
        <select
          id="team-parent-select"
          value={parentSelection}
          onChange={(e) => onParentChange(e.target.value)}
          aria-describedby={errors.parentTeam ? 'team-parent-select-error' : undefined}
          aria-invalid={errors.parentTeam ? true : undefined}
        >
          <option value="">No parent</option>
          {(orgTeams ?? [])
            .filter((t) => t.name !== detail.name)
            .map((t) => (
              <option key={t.name} value={t.name}>
                {t.name}
              </option>
            ))}
        </select>
        {errors.parentTeam ? (
          <p id="team-parent-select-error" className="field-error">
            {errors.parentTeam}
          </p>
        ) : null}
      </div>
      <button type="submit" className="primary-button" disabled={saving}>
        Save
      </button>
      {saved ? (
        <p role="status" className="success-message">
          Parent team updated
        </p>
      ) : null}
    </form>
  );
}

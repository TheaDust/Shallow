import { useCallback, useEffect, useState } from "react";

import { ApiError } from "../../lib/api";
import { useDocumentTitle } from "../../lib/document-title";
import {
  fetchOrganizationMembers,
  fetchOrganizationTeams,
} from "../../lib/organizations-api";
import {
  fetchRepositoryAccess,
  saveRepositoryGrant,
  type AccessGrant,
  type RepositoryAccess,
  type SaveRepositoryGrantInput,
} from "../../lib/repository-access-api";
import { fieldErrorsOf, messageOf } from "../../lib/session-api";
import { Button } from "../../ui";
import { useAccountSession } from "../account/AccountSession";
import { AccessGrantTable } from "./AccessGrantTable";
import { AccessSubjectPicker, type AccessCandidate } from "./AccessSubjectPicker";

export interface RepositoryAccessPageProps {
  owner: string;
  name: string;
}

type LoadState = "loading" | "ready" | "denied" | "missing" | "error";

async function loadCandidates(organizationName: string): Promise<AccessCandidate[]> {
  const [members, teams] = await Promise.all([
    fetchOrganizationMembers(organizationName),
    fetchOrganizationTeams(organizationName),
  ]);
  return [
    ...members.map((member) => ({
      id: `account:${member.username}`,
      name: member.username,
      type: "account" as const,
    })),
    ...teams.map((team) => ({
      id: `team:${team.name}`,
      name: team.name,
      type: "team" as const,
    })),
  ];
}

/**
 * Repository "Manage access": the stored direct grants for organization
 * members and teams plus the subject picker. Every decision is validated again
 * on the server, so a viewer without a repository Admin role only sees a
 * refusal.
 */
export function RepositoryAccessPage({ owner, name }: RepositoryAccessPageProps) {
  const { status: sessionStatus } = useAccountSession();
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [access, setAccess] = useState<RepositoryAccess | null>(null);
  const [candidates, setCandidates] = useState<AccessCandidate[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  useDocumentTitle(`${owner}/${name}`);

  useEffect(() => {
    if (sessionStatus === "loading") return;
    let cancelled = false;
    setLoadState("loading");
    setPickerOpen(false);
    fetchRepositoryAccess(owner, name)
      .then(async (payload) => {
        const nextCandidates = payload.organization
          ? await loadCandidates(payload.organization.name)
          : [];
        if (cancelled) return;
        setAccess(payload);
        setCandidates(nextCandidates);
        setLoadState("ready");
      })
      .catch((error) => {
        if (cancelled) return;
        setAccess(null);
        if (error instanceof ApiError && error.status === 403) {
          setMessage(messageOf(error, "Access denied"));
          setLoadState("denied");
          return;
        }
        setLoadState(
          error instanceof ApiError && error.status === 404 ? "missing" : "error",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [owner, name, sessionStatus]);

  const applyGrants = useCallback((grants: AccessGrant[]) => {
    setAccess((current) => (current ? { ...current, grants } : current));
  }, []);

  async function handleGrant(input: SaveRepositoryGrantInput) {
    if (busy) return;
    setBusy(true);
    setPickerError(null);
    try {
      const grants = await saveRepositoryGrant(owner, name, input);
      applyGrants(grants);
      setPickerOpen(false);
    } catch (error) {
      const errors = fieldErrorsOf(error);
      setPickerError(
        Object.values(errors)[0] ?? messageOf(error, "Unable to save that grant right now."),
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleSave(grant: AccessGrant, role: string) {
    if (savingId !== null) return;
    setSavingId(grant.id);
    setSaveError(null);
    try {
      const grants = await saveRepositoryGrant(owner, name, {
        subjectType: grant.subjectType,
        subjectName: grant.subjectName,
        role,
      });
      applyGrants(grants);
    } catch (error) {
      setSaveError(messageOf(error, "Unable to save that role right now."));
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="repository-access">
      <h1>{`${owner}/${name}`}</h1>
      <h2>Manage access</h2>
      {loadState === "loading" ? <p role="status">Loading…</p> : null}
      {loadState === "missing" ? (
        <>
          <p role="status">Repository not found.</p>
          <p>
            <a href="#/">Go to the home page</a>
          </p>
        </>
      ) : null}
      {loadState === "denied" ? (
        <p className="form-error" role="alert">
          {message}
        </p>
      ) : null}
      {loadState === "error" ? (
        <p className="form-error" role="alert">
          Unable to load repository access right now.
        </p>
      ) : null}
      {saveError ? (
        <p className="form-error" role="alert">
          {saveError}
        </p>
      ) : null}
      {access?.organization && pickerOpen ? (
        // While the picker is active only its own Role control and Add button
        // are reachable, so the submit action is unambiguous.
        <AccessSubjectPicker
          candidates={candidates}
          busy={busy}
          error={pickerError}
          onSubmit={(input) => void handleGrant(input)}
          onCancel={() => {
            setPickerOpen(false);
            setPickerError(null);
          }}
        />
      ) : null}
      {access && !pickerOpen ? (
        <>
          {access.organization ? (
            <p className="repository-access__actions">
              <Button
                onClick={() => {
                  setPickerError(null);
                  setPickerOpen(true);
                }}
              >
                Add people or teams
              </Button>
            </p>
          ) : null}
          <AccessGrantTable
            grants={access.grants}
            savingId={savingId}
            onSave={(grant, role) => void handleSave(grant, role)}
          />
        </>
      ) : null}
    </div>
  );
}

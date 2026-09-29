import { useState } from "react";

import { fetchRepositoryAccess, repositoryHash } from "../../org/org-api";
import { useAsyncData } from "../../org/use-async-data";
import { AccessDeniedMain, BusyMain, NotFoundPage, PanelMessage } from "../common";
import { AccessSubjectPicker } from "./AccessSubjectPicker";
import { RepositoryGrants } from "./RepositoryGrants";

export interface RepositoryAccessPageProps {
  ownerName: string;
  repositoryName: string;
}

/**
 * REQ-2-3: the “Manage access” page of a repository. An organization Owner or
 * repository Admin picks a member or team and stores one role grant per subject;
 * every other viewer only reads the stored grants.
 */
export function RepositoryAccessPage({ ownerName, repositoryName }: RepositoryAccessPageProps) {
  const access = useAsyncData(
    () => fetchRepositoryAccess(ownerName, repositoryName),
    [ownerName, repositoryName],
  );
  const [status, setStatus] = useState<string | null>(null);

  if (access.status === "loading") return <BusyMain />;
  if (access.status === "error" || !access.data) {
    if (access.error && (access.error.status === 401 || access.error.status === 403)) {
      return <AccessDeniedMain />;
    }
    return <NotFoundPage />;
  }

  const data = access.data;
  const canManage = data.viewerRole === "admin";

  return (
    <main>
      <h1>Manage access</h1>
      <p>
        <a href={repositoryHash(ownerName, repositoryName)}>{`${ownerName}/${repositoryName}`}</a>
      </p>
      {canManage ? (
        <AccessSubjectPicker
          ownerName={ownerName}
          repositoryName={repositoryName}
          members={data.members}
          teams={data.teams}
          onSaved={() => {
            setStatus("Access saved");
            access.reload();
          }}
        />
      ) : (
        <PanelMessage>Only an organization Owner or a repository Admin can manage access.</PanelMessage>
      )}
      {status ? <p role="status">{status}</p> : null}
      <RepositoryGrants
        ownerName={ownerName}
        repositoryName={repositoryName}
        grants={data.grants}
        canManage={canManage}
        onSaved={() => {
          setStatus("Access saved");
          access.reload();
        }}
      />
    </main>
  );
}

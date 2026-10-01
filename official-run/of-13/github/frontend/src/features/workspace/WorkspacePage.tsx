import { ProtectedPage } from "../account/ProtectedPage";
import { useAccountSession } from "../account/AccountSession";
import { MyRepositoriesList } from "../repositories/MyRepositoriesList";

/**
 * Signed-in workspace: the personal repository list and the `New repository`
 * entry that opens the creation form. Later modules hang their organizations
 * and work-item entries off this page.
 */
export function WorkspacePage() {
  const { account } = useAccountSession();

  return (
    <ProtectedPage title="Workspace">
      {account ? <p className="muted">{`Signed in as ${account.username}.`}</p> : null}
      <p>
        <a href="#/repositories/new">New repository</a>
      </p>
      <MyRepositoriesList enabled={Boolean(account)} />
    </ProtectedPage>
  );
}

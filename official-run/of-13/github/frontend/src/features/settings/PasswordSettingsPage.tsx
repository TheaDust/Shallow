import { ProtectedPage } from "../account/ProtectedPage";
import { PasswordChangeForm } from "./PasswordChangeForm";

/**
 * The security page in account Settings that changes the current account
 * credentials.
 */
export function PasswordSettingsPage() {
  return (
    <ProtectedPage title="Password and authentication">
      <PasswordChangeForm />
    </ProtectedPage>
  );
}

import { PasswordChangeForm } from "../features/auth/PasswordChangeForm";

export function PasswordAndAuthenticationPage() {
  return (
    <section className="settings">
      <h1>Password and authentication</h1>
      <PasswordChangeForm />
    </section>
  );
}

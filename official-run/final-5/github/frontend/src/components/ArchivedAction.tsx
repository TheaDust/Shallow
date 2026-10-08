import type { ReactNode } from "react";

/**
 * The write entry of a repository whose Archived status made it read-only
 * (REQ-3-5). Archived repositories stay readable, but file editing, issue
 * creation and pull-request creation are unavailable to every user. The entry
 * keeps the role and the accessible name of the actionable control, marks
 * itself `aria-disabled` and refuses the navigation, so the control stays
 * identifiable while nothing can be written from the browser; the server
 * re-checks the same rule.
 */
export function ArchivedActionLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <a
      className={["is-disabled", className].filter(Boolean).join(" ")}
      href={href}
      aria-disabled="true"
      data-disabled="true"
      onClick={(event) => event.preventDefault()}
    >
      {children}
    </a>
  );
}

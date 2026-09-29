import { fetchOrganization, fetchOrganizationPeople } from "../../org/org-api";
import { useAsyncData } from "../../org/use-async-data";
import { ApiError } from "../../lib/api";
import { BusyMain, NotFoundPage, PanelMessage } from "../common";
import { AddMemberForm } from "./AddMemberForm";
import { MemberRowActions } from "./MemberRowActions";
import { OrganizationShell } from "./OrganizationShell";

export interface OrganizationPeoplePageProps {
  organizationName: string;
}

function accessMessage(error: ApiError): string {
  return error.status === 401
    ? "Sign in as an organization member to see the people of this organization."
    : "You need to be an organization member to see the people of this organization.";
}

/**
 * REQ-2-1 / REQ-2-2-3 / REQ-2-2-4: the People tab lists the organization members
 * with their Member/Owner role. An organization Owner additionally gets “Add
 * member” and the per-member removal menu; a plain member gets neither control.
 */
export function OrganizationPeoplePage({ organizationName }: OrganizationPeoplePageProps) {
  const organization = useAsyncData(() => fetchOrganization(organizationName), [organizationName]);
  const people = useAsyncData(() => fetchOrganizationPeople(organizationName), [organizationName]);

  if (organization.status === "loading") return <BusyMain />;
  if (organization.status === "error" || !organization.data) return <NotFoundPage />;

  const canManage = organization.data.role === "owner";

  return (
    <OrganizationShell organization={organization.data} activeTab="people">
      <section className="org-people" aria-label="People">
        <h2>People</h2>
        {people.status === "loading" ? <p role="status">Loading members…</p> : null}
        {people.status === "error" && people.error ? (
          <PanelMessage>{accessMessage(people.error)}</PanelMessage>
        ) : null}
        {people.status === "ready" ? (
          <>
            {canManage ? (
              <AddMemberForm organizationName={organizationName} onChanged={() => people.reload()} />
            ) : null}
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Username</th>
                  <th scope="col">Role</th>
                  {canManage ? <th scope="col">Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {(people.data ?? []).map((member) => (
                  <tr key={member.username}>
                    <td>{member.username}</td>
                    <td>{member.role === "owner" ? "Owner" : "Member"}</td>
                    {canManage ? (
                      <td>
                        <MemberRowActions
                          organizationName={organizationName}
                          username={member.username}
                          onChanged={() => people.reload()}
                        />
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : null}
      </section>
    </OrganizationShell>
  );
}

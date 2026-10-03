import { fetchTeam } from "../../api/organizations";
import { useAuth } from "../../auth/AuthProvider";
import { SiteHeader } from "../../components/SiteHeader";
import { makeHash } from "../../lib/hash-route";
import { useAsyncData } from "../../lib/useAsyncData";
import { TeamMembersPanel } from "./TeamMembersPanel";
import { TeamSettingsPanel } from "./TeamSettingsPanel";

export type TeamSection = "overview" | "members" | "settings";

/** Team overview with its “Members” and “Settings” navigation entries. */
export function TeamPage({ slug, teamSlug, section }: { slug: string; teamSlug: string; section: TeamSection }) {
  const { account } = useAuth();
  const { data, error, loading, reload } = useAsyncData(() => fetchTeam(slug, teamSlug), [slug, teamSlug]);

  return (
    <main>
      <SiteHeader account={account} />
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <a className="breadcrumb__link" href={makeHash(`/organizations/${slug}/teams`)}>
          Teams
        </a>
      </nav>
      <h1>{teamSlug}</h1>
      <nav className="team-nav" aria-label="Team">
        <a
          className="team-nav__link"
          href={makeHash(`/organizations/${slug}/teams/${teamSlug}/members`)}
          aria-current={section === "members" ? "page" : undefined}
        >
          Members
        </a>
        <a
          className="team-nav__link"
          href={makeHash(`/organizations/${slug}/teams/${teamSlug}/settings`)}
          aria-current={section === "settings" ? "page" : undefined}
        >
          Settings
        </a>
      </nav>
      {loading ? <p role="status">Loading…</p> : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {section === "settings" ? (
        <TeamSettingsPanel slug={slug} teamSlug={teamSlug} detail={error ? null : data} reload={reload} />
      ) : section === "members" ? (
        <TeamMembersPanel slug={slug} teamSlug={teamSlug} detail={error ? null : data} reload={reload} />
      ) : data && !error ? (
        <dl className="team-summary">
          <dt>Parent team</dt>
          <dd>{data.team.parent ?? "No parent"}</dd>
          <dt>Members</dt>
          <dd>{data.members.length}</dd>
        </dl>
      ) : null}
    </main>
  );
}

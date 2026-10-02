/**
 * Age of a stored timestamp as shown next to a commit or a change. Recent
 * values read as a relative age ("3 hours ago"), older ones as a plain date,
 * which is exactly how a commit history distinguishes its newest record from
 * the historical ones.
 */
export function formatRelativeTime(value: string, now: number = Date.now()): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return value;
  const minutes = Math.round((now - timestamp) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  const weeks = Math.round(days / 7);
  if (weeks < 5) return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
  return `on ${new Date(timestamp).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  })}`;
}

/** Pluralized count used by the commit and change summaries. */
export function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

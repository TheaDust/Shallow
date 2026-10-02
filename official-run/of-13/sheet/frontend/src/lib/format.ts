/** Shared timestamp rendering so the home page and the editor show the same value. */
export function formatUpdatedAt(timestamp: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(timestamp);
  if (!match) return timestamp;
  const [, year, month, day, hours, minutes] = match;
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

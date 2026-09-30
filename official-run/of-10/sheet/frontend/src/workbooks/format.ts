function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * Renders the workbook last-updated timestamp. The home page and the editor page share this
 * formatter so both show the exact same value for one stored timestamp.
 */
export function formatLastUpdated(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

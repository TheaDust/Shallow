// Human-readable device label of one browser session, derived from the request
// User-Agent at sign-in time. The label is stored with the session record, so a
// session keeps identifying the same device without persisting any secret.

const BROWSERS = [
  ["Edg/", "Edge"],
  ["OPR/", "Opera"],
  ["Firefox/", "Firefox"],
  ["Chrome/", "Chrome"],
  ["Safari/", "Safari"],
];

const SYSTEMS = [
  ["Windows", "Windows"],
  ["Android", "Android"],
  ["iPhone", "iOS"],
  ["iPad", "iOS"],
  ["Mac OS X", "macOS"],
  ["Macintosh", "macOS"],
  ["Linux", "Linux"],
  ["X11", "Linux"],
];

export const UNKNOWN_DEVICE = "Unknown device";

/** "Chrome on Linux", "Safari on macOS", or the neutral fallback label. */
export function deviceLabel(userAgent) {
  const value = typeof userAgent === "string" ? userAgent : "";
  if (!value.trim()) return UNKNOWN_DEVICE;
  const browser = BROWSERS.find(([marker]) => value.includes(marker))?.[1];
  const system = SYSTEMS.find(([marker]) => value.includes(marker))?.[1];
  if (browser && system) return `${browser} on ${system}`;
  return browser ?? UNKNOWN_DEVICE;
}

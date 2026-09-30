/**
 * The reaction types of the issue discussion (REQ-5-2-3). The stored value is
 * the reaction type; the page adds the emoji and the readable name, so a stored
 * type keeps its meaning without a second lookup.
 */

export interface ReactionOption {
  type: string;
  label: string;
  emoji: string;
}

export const REACTION_OPTIONS: readonly ReactionOption[] = [
  { type: "+1", label: "Thumbs up", emoji: "👍" },
  { type: "-1", label: "Thumbs down", emoji: "👎" },
  { type: "laugh", label: "Laugh", emoji: "😄" },
  { type: "hooray", label: "Hooray", emoji: "🎉" },
  { type: "confused", label: "Confused", emoji: "😕" },
  { type: "heart", label: "Heart", emoji: "❤️" },
  { type: "rocket", label: "Rocket", emoji: "🚀" },
  { type: "eyes", label: "Eyes", emoji: "👀" },
];

/** The display data of one stored reaction type. */
export function reactionOption(type: string): ReactionOption | null {
  return REACTION_OPTIONS.find((option) => option.type === type) ?? null;
}

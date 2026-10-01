import type { IssueReactionType } from "../../lib/issues-api";

/** One selectable reaction: the stored type with its visible emoji and name. */
export interface IssueReactionOption {
  type: IssueReactionType;
  emoji: string;
  name: string;
}

/**
 * The reaction menu of the discussion, in a stable order. The stored type is
 * the identity of a reaction; the emoji is only its visible sign.
 */
export const ISSUE_REACTION_OPTIONS: readonly IssueReactionOption[] = [
  { type: "thumbs_up", emoji: "👍", name: "Thumbs up" },
  { type: "heart", emoji: "❤️", name: "Heart" },
  { type: "hooray", emoji: "🎉", name: "Hooray" },
  { type: "laugh", emoji: "😄", name: "Laugh" },
  { type: "confused", emoji: "😕", name: "Confused" },
  { type: "rocket", emoji: "🚀", name: "Rocket" },
  { type: "eyes", emoji: "👀", name: "Eyes" },
];

const BY_TYPE = new Map(ISSUE_REACTION_OPTIONS.map((option) => [option.type, option]));

export function reactionEmoji(type: string): string {
  return BY_TYPE.get(type as IssueReactionType)?.emoji ?? type;
}

export function reactionName(type: string): string {
  return BY_TYPE.get(type as IssueReactionType)?.name ?? type;
}

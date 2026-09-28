import { fileURLToPath } from "node:url";

/** Controller-owned resources are explicit inputs; target-project discovery stays disabled. */
export const BUILDER_SKILLS_DIR = fileURLToPath(
  new URL("../../builder-resources/skills/", import.meta.url),
);

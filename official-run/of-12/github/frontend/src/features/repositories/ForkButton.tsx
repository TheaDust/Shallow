import { Button } from "../../ui/Button";
import { navigate } from "../../lib/hash-route";

export interface ForkButtonProps {
  owner: string;
  name: string;
}

/**
 * The "Fork" action of a source repository overview (REQ-3-2-2): a button that
 * opens the fork form of this repository. The read permission on the source and
 * the creation permission in the target namespace are checked by the server.
 */
export function ForkButton({ owner, name }: ForkButtonProps) {
  return (
    <Button
      variant="secondary"
      onClick={() => navigate(`/${owner}/${name}/fork`)}
    >
      Fork
    </Button>
  );
}

import { useEffect, useState } from "react";

import { navigate } from "../lib/hash-route";
import { codeSearchPath } from "../lib/repository-paths";

export interface RepositorySearchBoxProps {
  ownerLogin: string;
  repositoryName: string;
  /** The query the results page must keep in the box. */
  query?: string;
}

/**
 * The Search box of one repository (REQ-4-2-3). Pressing Enter searches the
 * readable file content of that repository only and opens its code results;
 * the value is controlled so the results page can retain the exact query.
 */
export function RepositorySearchBox({ ownerLogin, repositoryName, query = "" }: RepositorySearchBoxProps) {
  const [value, setValue] = useState(query);

  useEffect(() => {
    setValue(query);
  }, [query]);

  const submit = () => {
    navigate(codeSearchPath(ownerLogin, repositoryName), new URLSearchParams({ q: value.trim() }));
  };

  return (
    <form
      className="repository-search"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <input
        className="repository-search__input"
        type="search"
        name="q"
        aria-label="Search"
        placeholder="Search"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          submit();
        }}
      />
    </form>
  );
}

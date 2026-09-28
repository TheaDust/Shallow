import { useEffect, useState } from "react";
import type { FormEvent } from "react";

import { navigate, useHashLocation } from "../lib/hash-route";

/**
 * The top search control: a searchbox named “Search” that opens the
 * repository-scoped code-search results page when the visitor is on a
 * repository page, and the global repository-search page everywhere else.
 * The value stays in sync with the `q` parameter of the current location so
 * the exact query is retained on the results page.
 */
export function GlobalSearch() {
  const { path, search } = useHashLocation();
  const query = search.get("q") ?? "";
  const [value, setValue] = useState(query);

  useEffect(() => {
    setValue(query);
  }, [query]);

  const repoMatch = path.match(/^\/(u|o)\/([^/]+)\/repos\/([^/]+)(?:\/.*)?$/);

  function submit(event: FormEvent) {
    event.preventDefault();
    const params = new URLSearchParams();
    const trimmed = value.trim();
    if (trimmed) params.set("q", trimmed);
    if (repoMatch) {
      navigate(`/${repoMatch[1]}/${repoMatch[2]}/repos/${repoMatch[3]}/search`, params);
    } else {
      navigate("/search", params);
    }
  }

  return (
    <form
      role="search"
      className="global-search"
      onSubmit={submit}
    >
      <label className="visually-hidden" htmlFor="global-search">
        Search
      </label>
      <input
        id="global-search"
        type="search"
        role="searchbox"
        className="global-search__input"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Search or jump to…"
        autoComplete="off"
        spellCheck={false}
      />
    </form>
  );
}

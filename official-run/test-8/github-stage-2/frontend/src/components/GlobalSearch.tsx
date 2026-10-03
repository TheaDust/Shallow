import { useId, useState } from "react";

import { navigate, useHashLocation } from "../lib/hash-route";

/**
 * The top global search control. Pressing Enter submits the query straight away
 * — there is no separate type filter to click — and lands on the repository
 * results for that name. The results page reads the query from the URL, so
 * coming back home and searching the same word again performs a fresh request
 * instead of replaying an earlier answer.
 */
export function GlobalSearch() {
  const location = useHashLocation();
  const inputId = useId();
  const [value, setValue] = useState(() => (location.path === "/search" ? location.search.get("q") ?? "" : ""));

  const submit = () => {
    navigate("/search", new URLSearchParams({ q: value.trim() }));
  };

  return (
    <form
      className="global-search"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <input
        id={inputId}
        className="global-search__input"
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

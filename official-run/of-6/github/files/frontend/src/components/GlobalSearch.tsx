import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { navigate } from '../router';

/**
 * REQ-3-1: the top global search control. It is a searchbox whose accessible
 * name is exactly "Search" and appears in the header of every page. Pressing
 * Enter navigates to the search results page (#/search?q=...) which shows
 * repository results directly, without any additional type-filter click. The
 * value mirrors the active route so the query can be edited or cleared on the
 * results page without retaining stale results.
 */
export default function GlobalSearch({ query }: { query: string }) {
  const [value, setValue] = useState(query);

  useEffect(() => {
    setValue(query);
  }, [query]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    navigate(`#/search?q=${encodeURIComponent(value.trim())}`);
  }

  return (
    <form className="global-search-form" onSubmit={handleSubmit}>
      <input
        type="search"
        className="global-search-input"
        aria-label="Search"
        placeholder="Search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
    </form>
  );
}

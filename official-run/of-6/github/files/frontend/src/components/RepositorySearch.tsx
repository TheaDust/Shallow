import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { navigate } from '../router';

/**
 * REQ-4-2-3: the repository-scoped search control shown in the header of every
 * repository page. It is a searchbox whose accessible name is exactly "Search"
 * and it is the single searchbox of the repository page. Pressing Enter
 * navigates to the repository code-search page
 * (#/repositories/:owner/:name/search?q=...) which displays the "Code" results
 * of this repository. On that page the value mirrors the active query so the
 * exact term is retained while searching again.
 */
export default function RepositorySearch({
  owner,
  name,
  query,
}: {
  owner: string;
  name: string;
  query: string;
}) {
  const [value, setValue] = useState(query);

  useEffect(() => {
    setValue(query);
  }, [query]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    navigate(
      `#/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/search?q=${encodeURIComponent(value.trim())}`
    );
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

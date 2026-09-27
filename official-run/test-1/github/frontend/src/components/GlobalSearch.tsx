import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { navigate } from '../router';

export default function GlobalSearch({ query }: { query: string }) {
  const [value, setValue] = useState(query);

  useEffect(() => {
    setValue(query);
  }, [query]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const q = value.trim();
    navigate(`/search?q=${encodeURIComponent(q)}`);
  }

  return (
    <form role="search" className="global-search" onSubmit={handleSubmit}>
      <input
        type="search"
        aria-label="Search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
    </form>
  );
}

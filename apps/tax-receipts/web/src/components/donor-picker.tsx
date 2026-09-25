import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Select } from '@mantine/core';
import { api, type ContactHit } from '../api.js';

/** A donor search: type two letters, pick a contact. Merged-away contacts are
 *  never offered by the server. */
export function DonorPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: ContactHit | null;
  onChange: (hit: ContactHit | null) => void;
}) {
  const [search, setSearch] = useState('');
  const hits = useQuery({
    queryKey: ['contact-search', search],
    queryFn: () => api.searchContacts(search),
    enabled: search.trim().length >= 2,
  });
  const found = hits.data?.data ?? [];
  const options = [...(value && !found.some((h) => h.id === value.id) ? [value] : []), ...found].map((h) => ({
    value: h.id,
    label: `${h.name}${h.email ? ` (${h.email})` : ''}`,
  }));
  return (
    <Select
      label={label}
      placeholder="Search by name or email"
      searchable
      clearable
      data={options}
      filter={({ options: all }) => all}
      nothingFoundMessage={search.trim().length < 2 ? 'Type at least two letters' : 'No matching contact'}
      value={value?.id ?? null}
      searchValue={search}
      onSearchChange={setSearch}
      onChange={(id) => onChange(id ? (found.find((h) => h.id === id) ?? value) : null)}
    />
  );
}

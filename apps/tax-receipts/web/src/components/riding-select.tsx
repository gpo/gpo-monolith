import { useQuery } from '@tanstack/react-query';
import { Select, type ComboboxItem, type OptionsFilter } from '@mantine/core';
import type { ReactNode } from 'react';
import { api } from '../api.js';

/**
 * Picks an Ontario riding by number or name. Every number from 1 to 124 is
 * offered, named from the ridings on file, so a riding that has not been set
 * up under Admin can still be chosen (it reads "not on file"). Typing digits
 * matches riding numbers, with an exact match first; typing anything else
 * matches names.
 */

export const RIDING_COUNT = 124;

const filterRidings: OptionsFilter = ({ options, search }) => {
  const q = search.trim().toLowerCase();
  const items = options as ComboboxItem[];
  if (q === '') return items;
  if (/^\d+$/.test(q)) {
    const hits = items.filter((o) => o.value.startsWith(q));
    return [...hits.filter((o) => o.value === q), ...hits.filter((o) => o.value !== q)];
  }
  return items.filter((o) => o.label.toLowerCase().includes(q));
};

export function RidingSelect({
  value,
  onChange,
  label = 'Riding',
  disabled = false,
  placeholder,
  error,
}: {
  value: number | null;
  onChange: (riding: number | null) => void;
  label?: ReactNode;
  disabled?: boolean;
  placeholder?: string;
  error?: ReactNode;
}) {
  const ridings = useQuery({ queryKey: ['admin-ridings'], queryFn: api.listRidings });
  const names = new Map(ridings.data?.data.map((r) => [r.ridingNumber, r.name]));
  const data = Array.from({ length: RIDING_COUNT }, (_, i) => {
    const n = i + 1;
    return { value: String(n), label: `${n} · ${names.get(n) ?? 'not on file'}` };
  });
  return (
    <Select
      label={label}
      data={data}
      value={value === null ? null : String(value)}
      onChange={(v) => onChange(v === null ? null : Number(v))}
      searchable
      clearable
      filter={filterRidings}
      disabled={disabled}
      placeholder={placeholder ?? 'Type a riding number or name'}
      nothingFoundMessage="No matching riding"
      error={error}
    />
  );
}

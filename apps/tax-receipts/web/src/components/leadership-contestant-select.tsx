import { useQuery } from '@tanstack/react-query';
import { Select } from '@mantine/core';
import type { ReactNode } from 'react';
import { api } from '../api.js';

/**
 * Picks the leadership contestant a LEADERSHIP contribution is directed to
 * (EO evaluation row 25). Inactive contestants are listed only when already
 * chosen, so an existing attribution still reads correctly but a new one
 * cannot pick a withdrawn contestant (the server enforces the same).
 */
export function LeadershipContestantSelect({
  value,
  onChange,
  label = 'Leadership contestant',
  error,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  label?: ReactNode;
  error?: ReactNode;
}) {
  const contestants = useQuery({ queryKey: ['leadership-contestants'], queryFn: api.listLeadershipContestants });
  const data =
    contestants.data?.data
      .filter((c) => c.active || c.id === value)
      .map((c) => ({ value: c.id, label: `${c.name} (${c.contestName})${c.active ? '' : ' (inactive)'}` })) ?? [];
  return (
    <Select
      label={label}
      data={data}
      value={value}
      onChange={onChange}
      searchable
      required
      withAsterisk={false}
      disabled={contestants.isLoading}
      placeholder={contestants.isLoading ? 'Loading contestants…' : data.length === 0 ? 'None on file: add one under Admin' : 'Choose a contestant'}
      nothingFoundMessage="No matching contestant"
      error={error}
    />
  );
}

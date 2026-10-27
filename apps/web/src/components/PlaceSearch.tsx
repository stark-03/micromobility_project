import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Autocomplete, Box, TextField, Typography } from '@mui/material';
import type { PlaceDto, PlaceKind } from '@mm/shared-types';
import { api } from '../lib/api.ts';

const KIND_LABEL: Record<PlaceKind, string> = {
  saved: 'Saved place',
  rental_station: 'Rental station',
  zone: 'Locality',
  charging_station: 'Charging point',
  street: 'Street',
};

/** Waits for typing to pause, so every keystroke is not a request. */
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * Choose a location by name instead of by clicking the map.
 *
 * Results come from /geo/search: localities, streets, stations and the
 * rider's saved places — all inside the routable city, so whatever is picked
 * can be planned to.
 */
export function PlaceSearch({
  label,
  onSelect,
  size = 'small',
}: {
  label: string;
  onSelect: (place: PlaceDto) => void;
  size?: 'small' | 'medium';
}) {
  const [input, setInput] = useState('');
  const term = useDebounced(input.trim(), 250);

  const results = useQuery({
    queryKey: ['geo', 'search', term],
    queryFn: () => api.get<PlaceDto[]>(`/geo/search?q=${encodeURIComponent(term)}`),
    enabled: term.length >= 2,
    staleTime: 60_000,
  });

  const options = term.length >= 2 ? (results.data?.data ?? []) : [];

  return (
    <Autocomplete<PlaceDto, false, false, false>
      size={size}
      options={options}
      filterOptions={(x) => x}
      getOptionLabel={(p) => p.name}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      loading={results.isFetching}
      noOptionsText={term.length < 2 ? 'Type at least two letters' : 'No place by that name'}
      onInputChange={(_e, v) => setInput(v)}
      onChange={(_e, place) => {
        if (place) onSelect(place);
      }}
      renderOption={(props, p) => {
        // MUI keys options by their label; "Camp Market" is both a rental
        // station and a charging point, so key by the place's id instead.
        const rest: Partial<typeof props> = { ...props };
        delete (rest as { key?: unknown }).key;
        return (
          <Box component="li" key={p.id} {...rest}>
            <Box className="flex min-w-0 flex-col">
              <Typography variant="body2" className="truncate">
                {p.name}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {KIND_LABEL[p.kind]}
                {p.context ? ` · ${p.context}` : ''}
              </Typography>
            </Box>
          </Box>
        );
      }}
      renderInput={(params) => <TextField {...params} label={label} placeholder="Search a place" />}
    />
  );
}

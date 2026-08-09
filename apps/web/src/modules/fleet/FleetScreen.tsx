import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Box, MenuItem, Paper, TextField, Typography } from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import type { GridColDef } from '@mui/x-data-grid';
import { VEHICLE_STATUSES, VEHICLE_TYPES } from '@mm/shared-types';
import type { VehicleDto, VehicleStatus, VehicleType } from '@mm/shared-types';
import { api, qs } from '../../lib/api.ts';
import type { ApiClientError, Envelope } from '../../lib/api.ts';
import { queryKeys } from '../../lib/query-keys.ts';
import { EmptyState, ErrorState, LoadingState } from '../../components/StateViews.tsx';
import { BatteryCell, ModeDot, RelativeTime, StatusChip } from './cells.tsx';

const columns: GridColDef<VehicleDto>[] = [
  {
    field: 'externalRef',
    headerName: 'Ref',
    width: 150,
    renderCell: (p) => <span className="mono">{p.row.externalRef}</span>,
  },
  {
    field: 'type',
    headerName: 'Mode',
    width: 150,
    renderCell: (p) => <ModeDot type={p.row.type} />,
  },
  { field: 'operatorName', headerName: 'Operator', width: 190 },
  {
    field: 'homeZoneName',
    headerName: 'Home zone',
    width: 150,
    valueGetter: (_v, row) => row.homeZoneName ?? '—',
  },
  {
    field: 'status',
    headerName: 'Status',
    width: 140,
    renderCell: (p) => <StatusChip status={p.row.status} />,
  },
  {
    field: 'batteryPct',
    headerName: 'Battery',
    width: 140,
    renderCell: (p) => <BatteryCell pct={p.row.batteryPct} />,
  },
  {
    field: 'lastSeenAt',
    headerName: 'Last seen',
    width: 130,
    renderCell: (p) => <RelativeTime iso={p.row.lastSeenAt} />,
  },
];

export function FleetScreen() {
  const [page, setPage] = useState(0);
  const [limit, setLimit] = useState(20);
  const [status, setStatus] = useState<VehicleStatus | ''>('');
  const [type, setType] = useState<VehicleType | ''>('');

  const params = { page: page + 1, limit, status, type };

  const query = useQuery({
    queryKey: queryKeys.vehicles.list(params),
    queryFn: () =>
      api.get<VehicleDto[]>(
        `/vehicles${qs({ page: page + 1, limit, status: status || undefined, type: type || undefined })}`,
      ),
    // Keeps the previous page on screen while the next one loads, so the grid
    // does not collapse to a spinner on every page change.
    placeholderData: (prev: Envelope<VehicleDto[]> | undefined) => prev,
  });

  const filtersActive = status !== '' || type !== '';

  function clearFilters() {
    setStatus('');
    setType('');
    setPage(0);
  }

  return (
    <Box className="flex flex-col gap-4 p-6">
      <Box className="flex flex-wrap items-end justify-between gap-4">
        <Box>
          <Typography variant="overline" color="text.secondary">
            Fleet
          </Typography>
          <Typography variant="h2" sx={{ fontSize: 30 }}>
            Vehicles
          </Typography>
        </Box>

        <Box className="flex flex-wrap gap-3">
          <TextField
            select
            label="Status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as VehicleStatus | '');
              setPage(0);
            }}
            sx={{ minWidth: 170 }}
          >
            <MenuItem value="">All statuses</MenuItem>
            {VEHICLE_STATUSES.map((s) => (
              <MenuItem key={s} value={s}>
                {s.replace('_', ' ')}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            select
            label="Mode"
            value={type}
            onChange={(e) => {
              setType(e.target.value as VehicleType | '');
              setPage(0);
            }}
            sx={{ minWidth: 170 }}
          >
            <MenuItem value="">All modes</MenuItem>
            {VEHICLE_TYPES.map((t) => (
              <MenuItem key={t} value={t}>
                {t}
              </MenuItem>
            ))}
          </TextField>
        </Box>
      </Box>

      <Paper elevation={0} className="overflow-hidden">
        {query.isLoading ? (
          <LoadingState />
        ) : query.isError ? (
          <ErrorState
            error={query.error as ApiClientError}
            onRetry={() => void query.refetch()}
          />
        ) : (query.data?.data.length ?? 0) === 0 ? (
          <EmptyState
            title="No vehicles here"
            action={
              filtersActive
                ? 'No vehicles match these filters. Clear them to see the whole fleet.'
                : 'The fleet is empty. Run `npm run db:seed` to load the Belagavi demo city, or register a vehicle via POST /api/v1/vehicles.'
            }
            actionLabel={filtersActive ? 'Clear filters' : undefined}
            onAction={filtersActive ? clearFilters : undefined}
          />
        ) : (
          <DataGrid
            rows={query.data?.data ?? []}
            columns={columns}
            getRowId={(r) => r.id}
            rowCount={query.data?.meta?.total ?? 0}
            paginationMode="server"
            paginationModel={{ page, pageSize: limit }}
            onPaginationModelChange={(m) => {
              setPage(m.page);
              setLimit(m.pageSize);
            }}
            pageSizeOptions={[10, 20, 50]}
            disableRowSelectionOnClick
            autoHeight
            loading={query.isFetching}
          />
        )}
      </Paper>
    </Box>
  );
}

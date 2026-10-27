import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Paper,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import type { GridColDef } from '@mui/x-data-grid';
import { VEHICLE_STATUSES, VEHICLE_TYPES } from '@mm/shared-types';
import type { VehicleDto, VehicleStatus, VehicleType } from '@mm/shared-types';
import { api, qs } from '../../lib/api.ts';
import type { ApiClientError, Envelope } from '../../lib/api.ts';
import { queryKeys } from '../../lib/query-keys.ts';
import { EmptyState, ErrorState, LoadingState } from '../../components/StateViews.tsx';
import { VehicleQr } from '../../components/VehicleQr.tsx';
import { BatteryCell, ModeDot, RelativeTime, StatusChip } from './cells.tsx';
import { RebalancePanel } from './RebalancePanel.tsx';

function buildColumns(onQr: (v: VehicleDto) => void): GridColDef<VehicleDto>[] {
  return [
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
      field: 'stationName',
      headerName: 'Station',
      width: 170,
      valueGetter: (_v, row) => row.stationName ?? '—',
    },
    {
      field: 'lastSeenAt',
      headerName: 'Last seen',
      width: 130,
      renderCell: (p) => <RelativeTime iso={p.row.lastSeenAt} />,
    },
    {
      field: 'unlockCode',
      headerName: 'QR',
      width: 130,
      sortable: false,
      renderCell: (p) =>
        p.row.unlockCode ? (
          <Button size="small" variant="text" className="mono" onClick={() => onQr(p.row)}>
            {p.row.unlockCode}
          </Button>
        ) : (
          '—'
        ),
    },
  ];
}

/**
 * The QR sticker for one vehicle, ready to print and stick on.
 *
 * Prints in its own window for the same reason the receipt does: the app's
 * dark shell has no business on a sticker sheet.
 */
function QrDialog({ vehicle, onClose }: { vehicle: VehicleDto | null; onClose: () => void }) {
  function print() {
    const img = document.querySelector<HTMLImageElement>('[data-qr-sticker] img');
    if (!img || !vehicle) return;
    const w = window.open('', '_blank', 'width=360,height=460');
    if (!w) return;
    w.document
      .write(`<!doctype html><html><head><meta charset="utf-8"><title>${vehicle.externalRef}</title>
      <style>body{font:14px system-ui,sans-serif;text-align:center;margin:24px}
      .code{font:700 22px ui-monospace,monospace;letter-spacing:.2em;margin-top:8px}</style></head>
      <body><img src="${img.src}" width="240" height="240" alt=""/><div class="code">${vehicle.unlockCode}</div>
      <div>${vehicle.externalRef} · scan to ride</div></body></html>`);
    w.document.close();
    w.focus();
    w.print();
  }

  return (
    <Dialog open={vehicle !== null} onClose={onClose}>
      <DialogTitle>Unlock QR · {vehicle?.externalRef}</DialogTitle>
      <DialogContent className="flex flex-col items-center gap-2" data-qr-sticker>
        {vehicle?.unlockCode && (
          <VehicleQr
            code={vehicle.unlockCode}
            label={`${vehicle.type}${vehicle.stationName ? ` · ${vehicle.stationName}` : ''}`}
          />
        )}
        <Typography variant="caption" color="text.secondary" className="max-w-[260px] text-center">
          Riders scan this with the Ride screen, or with their phone's camera, to start a rental.
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={print}>Print sticker</Button>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

type TabKey = 'vehicles' | 'rebalance';

export function FleetScreen() {
  const [tab, setTab] = useState<TabKey>('vehicles');
  const [qrFor, setQrFor] = useState<VehicleDto | null>(null);
  const columns = useMemo(() => buildColumns(setQrFor), []);
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
            {tab === 'vehicles' ? 'Vehicles' : 'Rebalancing'}
          </Typography>
        </Box>

        <Tabs value={tab} onChange={(_e, v: TabKey) => setTab(v)}>
          <Tab value="vehicles" label="Vehicles" />
          <Tab value="rebalance" label="Rebalancing" />
        </Tabs>
      </Box>

      {tab === 'rebalance' ? (
        <RebalancePanel />
      ) : (
        <>
          <Box className="flex flex-wrap items-end justify-end gap-4">
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
        </>
      )}
      <QrDialog vehicle={qrFor} onClose={() => setQrFor(null)} />
    </Box>
  );
}

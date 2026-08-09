import { Box, Chip, Typography } from '@mui/material';
import type { VehicleStatus, VehicleType } from '@mm/shared-types';

/**
 * Mode colours are constant everywhere — map polyline, legend chip, chart
 * series, table dot (design.md §6.2). Tailwind classes, so the value still
 * resolves from tokens.css and no hex appears here.
 */
const MODE_DOT: Record<VehicleType, string> = {
  scooter: 'bg-line-scooter',
  bike: 'bg-line-bike',
  ebike: 'bg-line-ebike',
  ev: 'bg-line-ev',
};

const MODE_LABEL: Record<VehicleType, string> = {
  scooter: 'Scooter',
  bike: 'Bicycle',
  ebike: 'E-bike',
  ev: 'Shared EV',
};

/**
 * The dot is ALWAYS beside the label. design.md §6.7: mode colours are used as
 * fills next to a text label, never as the only carrier of meaning — otherwise
 * the column is unreadable to anyone with a colour vision deficiency.
 */
export function ModeDot({ type }: { type: VehicleType }) {
  return (
    <Box className="flex items-center gap-2">
      <Box className={`h-2 w-2 shrink-0 rounded-full ${MODE_DOT[type]}`} aria-hidden />
      <Typography variant="body2">{MODE_LABEL[type]}</Typography>
    </Box>
  );
}

/** Status colours deliberately avoid the --flow-* ramp: that is congestion-only. */
const STATUS_COLOR: Record<VehicleStatus, string> = {
  available: 'var(--ok)',
  in_use: 'var(--info)',
  reserved: 'var(--info)',
  returning: 'var(--warn)',
  charging: 'var(--warn)',
  maintenance: 'var(--mist-400)',
  retired: 'var(--mist-400)',
};

const STATUS_LABEL: Record<VehicleStatus, string> = {
  available: 'Available',
  reserved: 'Reserved',
  in_use: 'In use',
  returning: 'Returning',
  charging: 'Charging',
  maintenance: 'Maintenance',
  retired: 'Retired',
};

export function StatusChip({ status }: { status: VehicleStatus }) {
  const color = STATUS_COLOR[status];
  return (
    <Chip
      size="small"
      label={STATUS_LABEL[status]}
      variant="outlined"
      sx={{ color, borderColor: color, backgroundColor: 'transparent' }}
    />
  );
}

/**
 * Battery is mono with tabular figures — design.md §6.3: any number that
 * changes in place is mono, so it does not jitter as the value updates.
 */
export function BatteryCell({ pct }: { pct: number | null }) {
  if (pct === null) {
    return (
      <Typography variant="body2" color="text.secondary">
        —
      </Typography>
    );
  }

  const color = pct > 60 ? 'var(--ok)' : pct >= 20 ? 'var(--warn)' : 'var(--danger)';

  return (
    <Box className="flex w-full items-center gap-2">
      <Typography variant="body2" className="mono w-9 shrink-0 text-right">
        {pct}%
      </Typography>
      <Box
        className="h-1 flex-1 overflow-hidden rounded-sm bg-ink-700"
        role="img"
        aria-label={`Battery ${pct} percent`}
      >
        <Box sx={{ width: `${pct}%`, backgroundColor: color }} className="h-full" />
      </Box>
    </Box>
  );
}

export function RelativeTime({ iso }: { iso: string | null }) {
  if (!iso) {
    return (
      <Typography variant="body2" color="text.secondary">
        Never
      </Typography>
    );
  }

  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  const label =
    minutes < 1
      ? 'Just now'
      : minutes < 60
        ? `${minutes}m ago`
        : minutes < 1440
          ? `${Math.round(minutes / 60)}h ago`
          : `${Math.round(minutes / 1440)}d ago`;

  return (
    <Typography variant="body2" className="mono" color="text.secondary">
      {label}
    </Typography>
  );
}

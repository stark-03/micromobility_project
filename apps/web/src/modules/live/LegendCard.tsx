import { Box, Paper, Typography } from '@mui/material';
import { FLOW_LABELS, flowRamp } from '../../lib/tokens.ts';

const MODES = [
  { key: 'scooter', label: 'Scooter', cls: 'bg-line-scooter' },
  { key: 'bike', label: 'Bicycle', cls: 'bg-line-bike' },
  { key: 'ebike', label: 'E-bike', cls: 'bg-line-ebike' },
  { key: 'ev', label: 'Shared EV', cls: 'bg-line-ev' },
] as const;

/**
 * The permanent key card.
 *
 * design.md §6.4 is emphatic: the legend is permanent, not a tooltip. A map
 * with five encodings and a hidden key is unreadable, and this is the
 * signature element of the interface — fixed bottom-left, same position on
 * every screen that draws data.
 */
export function LegendCard() {
  const ramp = flowRamp();

  return (
    <Paper
      elevation={0}
      className="pointer-events-none absolute bottom-4 left-4 z-10 w-56 p-3 shadow-card"
      aria-label="Map legend"
    >
      <Typography variant="overline" color="text.secondary" className="block">
        Congestion
      </Typography>
      <Box className="mb-1 mt-1 flex h-2 overflow-hidden rounded-sm">
        {ramp.map((c, i) => (
          <Box key={i} sx={{ backgroundColor: c }} className="h-full flex-1" />
        ))}
      </Box>
      <Box className="mb-3 flex justify-between">
        <Typography variant="caption" color="text.secondary">
          {FLOW_LABELS[0]}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {FLOW_LABELS[4]}
        </Typography>
      </Box>

      <Typography variant="overline" color="text.secondary" className="block">
        Modes
      </Typography>
      <Box className="mt-1 grid grid-cols-2 gap-x-2 gap-y-1">
        {MODES.map((m) => (
          <Box key={m.key} className="flex items-center gap-1.5">
            <Box className={`h-2 w-2 shrink-0 rounded-full ${m.cls}`} aria-hidden />
            <Typography variant="caption">{m.label}</Typography>
          </Box>
        ))}
      </Box>
    </Paper>
  );
}

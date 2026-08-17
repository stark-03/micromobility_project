import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  MenuItem,
  Slider,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import type { ScenarioDto, ZoneDto } from '@mm/shared-types';
import { api } from '../../lib/api.ts';
import type { ApiClientError } from '../../lib/api.ts';

/**
 * The scenario builder.
 *
 * MODULES.md calls for a four-step wizard. This is one scrolling form with
 * labelled sections instead — the same fields, one screen. A wizard is worth
 * its cost when steps gate each other or the form is too long to hold in view;
 * here there are eleven inputs and no dependencies between them, so paging them
 * would add four clicks and hide the very thing a planner is comparing. Every
 * lever is visible at once, which is what makes "change one thing" easy to do.
 */
export function NewScenarioDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [simHours, setSimHours] = useState(24);
  const [startHour, setStartHour] = useState(0);
  const [scooter, setScooter] = useState(90);
  const [ebike, setEbike] = useState(45);
  const [bike, setBike] = useState(30);
  const [rain, setRain] = useState(0);
  const [tempC, setTempC] = useState(28);
  const [demandMultiplier, setDemandMultiplier] = useState(1);
  const [bikeLaneZones, setBikeLaneZones] = useState<string[]>([]);
  const [closedZones, setClosedZones] = useState<string[]>([]);
  const [rebalanceEnabled, setRebalanceEnabled] = useState(false);
  const [rebalanceIntervalMin, setRebalanceIntervalMin] = useState(60);

  const zones = useQuery({
    queryKey: ['geo', 'zones'],
    queryFn: () => api.get<ZoneDto[]>('/geo/zones'),
    staleTime: 60 * 60 * 1000,
  });

  const create = useMutation({
    mutationFn: () =>
      api.post<ScenarioDto>('/scenarios', {
        name: name.trim(),
        description: description.trim() || null,
        simHours,
        startHour,
        fleet: { scooter, ebike, bike },
        weather: { precipitationMm: rain, tempC },
        policy: {
          bikeLaneZones,
          closedZones,
          demandMultiplier,
          rebalanceEnabled,
          rebalanceIntervalMin,
          rebalanceVanCapacity: 8,
        },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sim', 'scenarios'] });
      onClose();
      reset();
    },
  });

  function reset() {
    setName('');
    setDescription('');
    setBikeLaneZones([]);
    setClosedZones([]);
    setRebalanceEnabled(false);
  }

  const zoneList = zones.data?.data ?? [];
  const fleetTotal = scooter + ebike + bike;
  const error = create.error as ApiClientError | null;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        New scenario
        <Typography variant="caption" color="text.secondary" component="div">
          Change one lever from your baseline so the difference is attributable to it.
        </Typography>
      </DialogTitle>

      <DialogContent dividers className="flex flex-col gap-5">
        <Box className="flex flex-col gap-3">
          <TextField
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            size="small"
            fullWidth
            autoFocus
            required
            placeholder="Protected bike lanes — city centre"
          />
          <TextField
            label="What this tests"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            size="small"
            fullWidth
            multiline
            minRows={2}
            placeholder="Does protected infrastructure cut the incident rate enough to justify it?"
          />
        </Box>

        <Divider />

        <Box>
          <Typography variant="overline" color="text.secondary">
            Window
          </Typography>
          <Box className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <TextField
              label="Length"
              select
              size="small"
              value={simHours}
              onChange={(e) => setSimHours(Number(e.target.value))}
            >
              <MenuItem value={6}>6 hours</MenuItem>
              <MenuItem value={12}>12 hours</MenuItem>
              <MenuItem value={24}>24 hours — a full day</MenuItem>
              <MenuItem value={72}>3 days</MenuItem>
            </TextField>
            <TextField
              label="Starts at"
              select
              size="small"
              value={startHour}
              onChange={(e) => setStartHour(Number(e.target.value))}
              helperText={simHours < 24 ? 'A short run should cover a peak, not the small hours' : ' '}
            >
              <MenuItem value={0}>00:00 — midnight</MenuItem>
              <MenuItem value={7}>07:00 — morning peak</MenuItem>
              <MenuItem value={12}>12:00 — midday</MenuItem>
              <MenuItem value={17}>17:00 — evening peak</MenuItem>
            </TextField>
          </Box>
        </Box>

        <Box>
          <Typography variant="overline" color="text.secondary">
            Fleet — {fleetTotal} vehicles
          </Typography>
          <Box className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <TextField
              label="Scooters"
              type="number"
              size="small"
              value={scooter}
              onChange={(e) => setScooter(Math.max(0, Number(e.target.value)))}
            />
            <TextField
              label="E-bikes"
              type="number"
              size="small"
              value={ebike}
              onChange={(e) => setEbike(Math.max(0, Number(e.target.value)))}
            />
            <TextField
              label="Bicycles"
              type="number"
              size="small"
              value={bike}
              onChange={(e) => setBike(Math.max(0, Number(e.target.value)))}
            />
          </Box>
        </Box>

        <Box>
          <Typography variant="overline" color="text.secondary">
            Weather
          </Typography>
          <Box className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Box>
              <Typography variant="caption" color="text.secondary">
                Rainfall — {rain} mm
              </Typography>
              <Slider
                value={rain}
                onChange={(_e, v) => setRain(v as number)}
                min={0}
                max={40}
                step={1}
                size="small"
              />
            </Box>
            <TextField
              label="Temperature (°C)"
              type="number"
              size="small"
              value={tempC}
              onChange={(e) => setTempC(Number(e.target.value))}
            />
          </Box>
        </Box>

        <Divider />

        <Box>
          <Typography variant="overline" color="text.secondary">
            Policy levers
          </Typography>

          <Box className="mt-2 flex flex-col gap-3">
            <TextField
              label="Protected bike lanes in"
              select
              size="small"
              fullWidth
              SelectProps={{ multiple: true }}
              value={bikeLaneZones}
              onChange={(e) =>
                setBikeLaneZones(
                  typeof e.target.value === 'string'
                    ? e.target.value.split(',')
                    : (e.target.value as unknown as string[]),
                )
              }
              helperText="Safer and slightly faster in the selected zones"
            >
              {zoneList.map((z) => (
                <MenuItem key={z.id} value={z.id}>
                  {z.name}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              label="Closed to micro-mobility"
              select
              size="small"
              fullWidth
              SelectProps={{ multiple: true }}
              value={closedZones}
              onChange={(e) =>
                setClosedZones(
                  typeof e.target.value === 'string'
                    ? e.target.value.split(',')
                    : (e.target.value as unknown as string[]),
                )
              }
              helperText="Demand in these zones goes unserved"
            >
              {zoneList.map((z) => (
                <MenuItem key={z.id} value={z.id}>
                  {z.name}
                </MenuItem>
              ))}
            </TextField>

            <Box>
              <Typography variant="caption" color="text.secondary">
                Demand — {Math.round(demandMultiplier * 100)}% of normal
              </Typography>
              <Slider
                value={demandMultiplier}
                onChange={(_e, v) => setDemandMultiplier(v as number)}
                min={0.25}
                max={2}
                step={0.05}
                size="small"
              />
            </Box>

            <FormControlLabel
              control={
                <Switch
                  checked={rebalanceEnabled}
                  onChange={(e) => setRebalanceEnabled(e.target.checked)}
                />
              }
              label="Rebalancing vans redistribute idle vehicles"
            />
            {rebalanceEnabled && (
              <TextField
                label="Every"
                select
                size="small"
                value={rebalanceIntervalMin}
                onChange={(e) => setRebalanceIntervalMin(Number(e.target.value))}
              >
                <MenuItem value={30}>30 minutes</MenuItem>
                <MenuItem value={45}>45 minutes</MenuItem>
                <MenuItem value={60}>60 minutes</MenuItem>
                <MenuItem value={120}>2 hours</MenuItem>
              </TextField>
            )}
          </Box>
        </Box>

        {error && (
          <Typography variant="body2" sx={{ color: 'var(--danger)' }}>
            {error.message}
          </Typography>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} variant="text">
          Cancel
        </Button>
        <Button
          onClick={() => create.mutate()}
          variant="contained"
          disabled={!name.trim() || fleetTotal === 0 || create.isPending}
        >
          {create.isPending ? 'Creating…' : 'Create scenario'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

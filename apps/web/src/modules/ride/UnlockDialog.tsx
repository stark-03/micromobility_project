import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from '@mui/material';
import type { FareEstimateDto, RentalDto, UnlockPreviewDto } from '@mm/shared-types';
import { api } from '../../lib/api.ts';
import type { ApiClientError } from '../../lib/api.ts';
import { formatDistance, formatDuration, formatMoney } from '../../lib/money.ts';
import { parseUnlockCode } from '../../components/VehicleQr.tsx';
import { ACTIVE_RENTAL_KEY } from './gps.ts';

/** The browser's built-in QR reader. Not in TypeScript's DOM lib yet. */
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>>;
}
type BarcodeDetectorCtor = new (opts: { formats: string[] }) => BarcodeDetectorLike;

function barcodeDetector(): BarcodeDetectorCtor | null {
  return (
    (globalThis as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector ?? null
  );
}

/**
 * Camera scanning, where the browser can do it.
 *
 * Chrome on Android and on most desktops ships BarcodeDetector; Firefox and
 * Safari do not. Rather than pull in a decoding library for them, the dialog
 * always offers the code printed under the QR — eight characters, typed in a
 * few seconds — and the camera is a convenience on top.
 */
function CameraScanner({ onCode }: { onCode: (code: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<'starting' | 'scanning' | 'unsupported' | 'denied'>(
    'starting',
  );
  // The parent passes a fresh callback each render; reading it through a ref
  // keeps the camera from being torn down and restarted on every render.
  const latest = useRef(onCode);
  latest.current = onCode;

  useEffect(() => {
    const Detector = barcodeDetector();
    if (!Detector || !navigator.mediaDevices?.getUserMedia) {
      setStatus('unsupported');
      return;
    }
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let live = true;
    const detector = new Detector({ formats: ['qr_code'] });

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then(async (s) => {
        if (!live) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        if (video.current) {
          video.current.srcObject = s;
          await video.current.play().catch(() => undefined);
        }
        setStatus('scanning');
        timer = setInterval(async () => {
          if (!video.current || video.current.readyState < 2) return;
          const found = await detector.detect(video.current).catch(() => []);
          const code = found.map((f) => parseUnlockCode(f.rawValue)).find(Boolean);
          if (code) latest.current(code);
        }, 350);
      })
      .catch(() => setStatus('denied'));

    return () => {
      live = false;
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  if (status === 'unsupported') {
    return (
      <Typography variant="body2" color="text.secondary">
        This browser cannot read QR codes from the camera. Type the 8-character code printed under
        the QR instead.
      </Typography>
    );
  }
  if (status === 'denied') {
    return (
      <Typography variant="body2" color="text.secondary">
        Camera access was refused or is unavailable (it needs HTTPS). Type the code printed under
        the QR instead.
      </Typography>
    );
  }
  return (
    <Box className="overflow-hidden rounded-md border border-ink-700" sx={{ aspectRatio: '4 / 3' }}>
      <video ref={video} muted playsInline className="h-full w-full object-cover" />
    </Box>
  );
}

export function UnlockDialog({
  open,
  initialCode,
  tripDistanceM,
  onClose,
  onStarted,
}: {
  open: boolean;
  initialCode: string | null;
  /** When the rider has chosen a destination, the fare is quoted for that trip. */
  tripDistanceM: number | null;
  onClose: () => void;
  onStarted: (rental: RentalDto) => void;
}) {
  const qc = useQueryClient();
  const [typed, setTyped] = useState('');
  const [code, setCode] = useState<string | null>(initialCode);
  const [scan, setScan] = useState(false);

  useEffect(() => {
    if (open) {
      setCode(initialCode);
      setTyped(initialCode ?? '');
      setScan(!initialCode && barcodeDetector() !== null);
    }
  }, [open, initialCode]);

  const preview = useQuery({
    queryKey: ['rentals', 'preview', code],
    queryFn: () => api.get<UnlockPreviewDto>(`/rentals/preview?code=${code}`),
    enabled: open && code !== null,
    retry: false,
  });
  const p = preview.data?.data ?? null;

  const estimate = useQuery({
    queryKey: ['rentals', 'estimate', p?.vehicle.type, tripDistanceM],
    queryFn: () =>
      api.get<FareEstimateDto>(
        `/rentals/estimate?vehicleType=${p!.vehicle.type}&distanceM=${Math.round(tripDistanceM!)}`,
      ),
    enabled: p !== null && tripDistanceM !== null,
  });

  const unlock = useMutation({
    mutationFn: () => api.post<RentalDto>('/rentals', { unlockCode: code }),
    onSuccess: (res) => {
      qc.setQueryData(ACTIVE_RENTAL_KEY, { data: res.data });
      void qc.invalidateQueries({ queryKey: ['stations'] });
      onStarted(res.data);
    },
  });

  const typedCode = parseUnlockCode(typed);
  const unlockError = unlock.error as ApiClientError | null;
  const previewError = preview.error as ApiClientError | null;
  const tooShort =
    p && p.vehicle.battery.rangeM !== null && tripDistanceM !== null
      ? p.vehicle.battery.rangeM < tripDistanceM * 1.2
      : false;

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Scan to unlock</DialogTitle>
      <DialogContent className="flex flex-col gap-3">
        {!code && (
          <>
            {scan && (
              <CameraScanner
                onCode={(c) => {
                  setScan(false);
                  setCode(c);
                  setTyped(c);
                }}
              />
            )}
            <TextField
              autoFocus={!scan}
              label="Unlock code"
              placeholder="e.g. K7MX2QPA"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              helperText="The 8 characters under the QR code on the vehicle"
              inputProps={{ className: 'mono', style: { letterSpacing: '0.2em' }, maxLength: 64 }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && typedCode) setCode(typedCode);
              }}
            />
            {!scan && barcodeDetector() && (
              <Button variant="text" size="small" onClick={() => setScan(true)}>
                Use the camera
              </Button>
            )}
          </>
        )}

        {code && preview.isLoading && <Typography variant="body2">Looking up {code}…</Typography>}

        {previewError && (
          <Alert severity="error">
            {previewError.code === 'VEHICLE_NOT_FOUND'
              ? `No vehicle has the code ${code}.`
              : previewError.message}
          </Alert>
        )}

        {p && (
          <Box className="flex flex-col gap-2 rounded-md border border-ink-700 p-3">
            <Box className="flex items-center justify-between gap-2">
              <Typography variant="h3" sx={{ fontSize: 18, textTransform: 'capitalize' }}>
                {p.vehicle.type} · {p.vehicle.externalRef}
              </Typography>
              <Chip
                size="small"
                color={p.vehicle.rentable ? 'success' : 'default'}
                label={p.vehicle.rentable ? 'Ready' : 'Unavailable'}
              />
            </Box>
            {p.stationName && (
              <Typography variant="caption" color="text.secondary">
                Docked at {p.stationName}
              </Typography>
            )}
            {p.vehicle.battery.pct !== null ? (
              <Typography variant="body2" className="mono">
                Battery {p.vehicle.battery.pct}% of {p.vehicle.battery.capacityWh} Wh · about{' '}
                {formatDistance(p.vehicle.battery.rangeM ?? 0)} of range
              </Typography>
            ) : (
              <Typography variant="body2">Pedal powered — no battery.</Typography>
            )}
            <Typography variant="body2">
              {p.plan.name}: {formatMoney(p.plan.unlockFeeMinor)} to unlock +{' '}
              {formatMoney(p.plan.perMinuteMinor)}/min (minimum{' '}
              {formatMoney(p.plan.minimumFareMinor)})
            </Typography>
            {estimate.data && (
              <Typography variant="body2" sx={{ color: 'var(--ok)' }}>
                Estimated for your {formatDistance(estimate.data.data.distanceM)} trip:{' '}
                <b>{formatMoney(estimate.data.data.fare.totalMinor)}</b> · about{' '}
                {formatDuration(estimate.data.data.durationS)}
              </Typography>
            )}
            {tooShort && (
              <Alert severity="warning">
                This vehicle may not have enough charge for your whole trip. Pick one with more
                battery.
              </Alert>
            )}
            {p.notRentableReason && <Alert severity="info">{p.notRentableReason}</Alert>}
          </Box>
        )}

        {unlockError && <Alert severity="error">{unlockError.message}</Alert>}
      </DialogContent>
      <DialogActions>
        {code && !unlock.isPending && (
          <Button
            color="inherit"
            onClick={() => {
              setCode(null);
              setTyped('');
              unlock.reset();
            }}
          >
            Different vehicle
          </Button>
        )}
        <Button onClick={onClose}>Cancel</Button>
        {!code ? (
          <Button variant="contained" disabled={!typedCode} onClick={() => setCode(typedCode)}>
            Look up
          </Button>
        ) : (
          <Button
            variant="contained"
            disabled={!p?.vehicle.rentable || unlock.isPending}
            onClick={() => unlock.mutate()}
          >
            {unlock.isPending ? 'Unlocking…' : 'Unlock and ride'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

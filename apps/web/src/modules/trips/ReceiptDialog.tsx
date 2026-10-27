import { useQuery } from '@tanstack/react-query';
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Typography,
} from '@mui/material';
import type { ReceiptDto } from '@mm/shared-types';
import { api } from '../../lib/api.ts';
import type { ApiClientError } from '../../lib/api.ts';
import { formatDistance, formatDuration, formatMoney } from '../../lib/money.ts';
import { ErrorState, LoadingState } from '../../components/StateViews.tsx';

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <Box className="flex items-baseline justify-between gap-4">
      <Typography variant="body2" color={strong ? 'text.primary' : 'text.secondary'}>
        {label}
      </Typography>
      <Typography variant="body2" className="mono" sx={{ fontWeight: strong ? 700 : 400 }}>
        {value}
      </Typography>
    </Box>
  );
}

const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

/**
 * Prints the receipt on its own page.
 *
 * A dedicated print window rather than `window.print()` on the app: the app
 * is a dark map UI, and printing it would put the shell, the rail and a map
 * on paper around a receipt nobody could read.
 */
function printReceipt(r: ReceiptDto) {
  const f = r.rental.fare;
  const rows: Array<[string, string]> = [
    ['Receipt no.', r.receiptNo],
    ['Date', new Date(r.issuedAt).toLocaleString('en-IN')],
    ['Rider', `${r.rider.name} (${r.rider.email})`],
    ['Operator', r.operatorName],
    ['Vehicle', `${r.rental.vehicle.type} ${r.rental.vehicle.externalRef}`],
    ['From', r.rental.startStation?.name ?? '—'],
    ['To', r.rental.endStation?.name ?? '—'],
    ['Distance', formatDistance(r.rental.distanceM)],
    ['Duration', formatDuration(r.rental.durationS)],
  ];
  if (f) {
    rows.push(['Unlock fee', formatMoney(f.unlockFeeMinor, f.currency)]);
    rows.push([`Time (${f.minutes} min)`, formatMoney(f.timeFeeMinor, f.currency)]);
    if (f.minimumTopUpMinor > 0)
      rows.push(['Minimum fare top-up', formatMoney(f.minimumTopUpMinor, f.currency)]);
    rows.push(['Total', formatMoney(f.totalMinor, f.currency)]);
  }
  if (r.rental.payment) {
    rows.push(['Payment', `${r.rental.payment.status} · ${r.rental.payment.providerRef ?? '—'}`]);
  }

  const w = window.open('', '_blank', 'width=480,height=720');
  if (!w) return;
  w.document
    .write(`<!doctype html><html><head><meta charset="utf-8"><title>${escape(r.receiptNo)}</title>
    <style>body{font:14px/1.5 system-ui,sans-serif;color:#111;max-width:420px;margin:24px auto;padding:0 16px}
    h1{font-size:18px;margin:0 0 4px}p{color:#555;margin:0 0 16px}table{width:100%;border-collapse:collapse}
    td{padding:6px 0;border-bottom:1px solid #eee}td:last-child{text-align:right;font-variant-numeric:tabular-nums}
    tr:nth-last-child(2) td{font-weight:700}</style></head><body>
    <h1>Ride receipt</h1><p>AI Urban Micro Mobility · Belagavi</p><table>
    ${rows.map(([k, v]) => `<tr><td>${escape(k)}</td><td>${escape(v)}</td></tr>`).join('')}
    </table></body></html>`);
  w.document.close();
  w.focus();
  w.print();
}

export function ReceiptDialog({
  rentalId,
  onClose,
}: {
  rentalId: string | null;
  onClose: () => void;
}) {
  const receipt = useQuery({
    queryKey: ['rentals', 'receipt', rentalId],
    queryFn: () => api.get<ReceiptDto>(`/rentals/${rentalId}/receipt`),
    enabled: rentalId !== null,
    retry: false,
  });
  const r = receipt.data?.data;
  const f = r?.rental.fare;

  return (
    <Dialog open={rentalId !== null} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Receipt</DialogTitle>
      <DialogContent>
        {receipt.isLoading && <LoadingState rows={4} />}
        {receipt.error && (
          <ErrorState
            error={receipt.error as ApiClientError}
            onRetry={() => void receipt.refetch()}
          />
        )}
        {r && (
          <Box className="flex flex-col gap-1.5">
            <Typography variant="caption" color="text.secondary" className="mono">
              {r.receiptNo} · {new Date(r.issuedAt).toLocaleString()}
            </Typography>
            <Typography variant="body2">
              {r.rental.startStation?.name ?? 'Start'} → {r.rental.endStation?.name ?? 'End'}
            </Typography>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ textTransform: 'capitalize' }}
            >
              {r.rental.vehicle.type} {r.rental.vehicle.externalRef} · {r.operatorName}
            </Typography>
            <Divider className="my-2" />
            <Line label="Distance" value={formatDistance(r.rental.distanceM)} />
            <Line label="Duration" value={formatDuration(r.rental.durationS)} />
            {f && (
              <>
                <Line label="Unlock fee" value={formatMoney(f.unlockFeeMinor, f.currency)} />
                <Line
                  label={`Time · ${f.minutes} min`}
                  value={formatMoney(f.timeFeeMinor, f.currency)}
                />
                {f.minimumTopUpMinor > 0 && (
                  <Line
                    label="Minimum fare top-up"
                    value={formatMoney(f.minimumTopUpMinor, f.currency)}
                  />
                )}
                <Divider className="my-1" />
                <Line label="Total" value={formatMoney(f.totalMinor, f.currency)} strong />
              </>
            )}
            {!f && (
              <Typography variant="body2" color="text.secondary">
                This trip was recorded before fares were charged, so it has no fare.
              </Typography>
            )}
            {r.rental.payment && (
              <Box className="mt-2 flex items-center gap-2">
                <Chip
                  size="small"
                  color={r.rental.payment.status === 'succeeded' ? 'success' : 'warning'}
                  label={r.rental.payment.status}
                />
                <Typography variant="caption" className="mono" color="text.secondary">
                  {r.rental.payment.provider} · {r.rental.payment.providerRef ?? 'no reference'}
                </Typography>
              </Box>
            )}
            {r.rental.co2SavedG !== null && (
              <Typography variant="caption" sx={{ color: 'var(--ok)' }} className="mt-2">
                {Math.round(r.rental.co2SavedG)} g CO₂ saved vs. the same trip by car
              </Typography>
            )}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        {r && <Button onClick={() => printReceipt(r)}>Print</Button>}
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

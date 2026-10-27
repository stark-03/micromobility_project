import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Box, Typography } from '@mui/material';

/**
 * The QR sticker for a vehicle.
 *
 * Encodes a link to the Ride screen with the unlock code, not the bare code:
 * a phone's ordinary camera app then opens straight into the unlock flow, and
 * the in-app scanner reads the code out of the same link.
 */
export function unlockUrl(code: string): string {
  return `${window.location.origin}/ride?unlock=${encodeURIComponent(code)}`;
}

/** Accepts what a scan produces — the sticker's link or a bare code — and returns the code. */
export function parseUnlockCode(scanned: string): string | null {
  const text = scanned.trim();
  try {
    const url = new URL(text);
    const code = url.searchParams.get('unlock');
    if (code) return normaliseCode(code);
  } catch {
    // Not a URL; fall through to treating it as a typed code.
  }
  return normaliseCode(text);
}

function normaliseCode(raw: string): string | null {
  const code = raw.replace(/[\s-]/g, '').toUpperCase();
  return /^[A-Z0-9]{8}$/.test(code) ? code : null;
}

export function VehicleQr({
  code,
  label,
  size = 180,
}: {
  code: string;
  label?: string;
  size?: number;
}) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    // Black on white regardless of theme: scanners need the contrast.
    QRCode.toDataURL(unlockUrl(code), { margin: 1, width: size, errorCorrectionLevel: 'M' })
      .then((url) => live && setSrc(url))
      .catch(() => live && setSrc(null));
    return () => {
      live = false;
    };
  }, [code, size]);

  return (
    <Box className="flex flex-col items-center gap-1">
      <Box
        className="flex items-center justify-center rounded-md"
        sx={{ width: size + 16, height: size + 16, background: '#fff' }}
      >
        {src ? (
          <img src={src} width={size} height={size} alt={`QR code to unlock vehicle ${code}`} />
        ) : (
          <Typography variant="caption" sx={{ color: '#000' }}>
            QR unavailable
          </Typography>
        )}
      </Box>
      <Typography variant="body2" className="mono tracking-widest">
        {code}
      </Typography>
      {label && (
        <Typography variant="caption" color="text.secondary">
          {label}
        </Typography>
      )}
    </Box>
  );
}

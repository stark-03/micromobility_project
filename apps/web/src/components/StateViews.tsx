import { Box, Button, Skeleton, Typography } from '@mui/material';
import type { ApiClientError } from '../lib/api.ts';

/**
 * The three non-ready states. Every screen handles all four explicitly —
 * loading, empty, error, ready (CLAUDE.md, frontend conventions).
 */

export function LoadingState({ rows = 6 }: { rows?: number }) {
  return (
    <Box className="flex flex-col gap-2 p-4" aria-busy="true" aria-live="polite">
      <Skeleton variant="rectangular" height={40} />
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} variant="rectangular" height={52} />
      ))}
    </Box>
  );
}

/**
 * An empty state must say what to DO next. "No data" tells the user nothing
 * and leaves them stuck.
 */
export function EmptyState({
  title,
  action,
  onAction,
  actionLabel,
}: {
  title: string;
  action: string;
  onAction?: () => void;
  actionLabel?: string;
}) {
  return (
    <Box className="flex flex-col items-center justify-center gap-3 p-12 text-center">
      <Typography variant="h3">{title}</Typography>
      <Typography variant="body2" color="text.secondary" className="max-w-md">
        {action}
      </Typography>
      {onAction && actionLabel && (
        <Button variant="outlined" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </Box>
  );
}

export function ErrorState({
  error,
  onRetry,
}: {
  error: ApiClientError | Error | null;
  onRetry?: () => void;
}) {
  const code = (error as ApiClientError | null)?.code;
  return (
    <Box className="flex flex-col items-center justify-center gap-3 p-12 text-center" role="alert">
      <Typography variant="overline" sx={{ color: 'var(--danger)' }}>
        {code ?? 'ERROR'}
      </Typography>
      <Typography variant="h3">Something went wrong</Typography>
      <Typography variant="body2" color="text.secondary" className="max-w-md">
        {error?.message ?? 'An unexpected error occurred.'}
      </Typography>
      {onRetry && (
        <Button variant="outlined" onClick={onRetry}>
          Try again
        </Button>
      )}
    </Box>
  );
}

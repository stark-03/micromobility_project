import { Box, Chip, Typography } from '@mui/material';
import type { RiskLevel, RouteRiskDto } from '@mm/shared-types';

/**
 * M09 route risk, as a rider reads it: a band in words, and the five factors
 * behind it.
 */

const RISK_COLOUR: Record<RiskLevel, string> = {
  low: 'var(--ok)',
  medium: 'var(--warn)',
  high: 'var(--danger)',
};

const RISK_FACTORS: Array<[keyof RouteRiskDto['factors'], string]> = [
  ['accidents', 'Accident history'],
  ['traffic', 'Traffic'],
  ['infrastructure', 'Cycling infrastructure'],
  ['lighting', 'Street lighting'],
  ['roadQuality', 'Road quality'],
];

/** The band in words AND colour, so it survives a colourblind reader. */
export function RiskChip({ risk }: { risk: RouteRiskDto }) {
  return (
    <Chip
      size="small"
      variant="outlined"
      label={`${risk.level[0]!.toUpperCase()}${risk.level.slice(1)} risk`}
      sx={{ borderColor: RISK_COLOUR[risk.level], color: RISK_COLOUR[risk.level] }}
    />
  );
}

/** What the risk score is made of. Each bar is 0–100, longer is riskier. */
export function RiskBreakdown({ risk }: { risk: RouteRiskDto }) {
  return (
    <Box className="mt-3 flex flex-col gap-1.5">
      <Typography variant="overline" color="text.secondary" className="leading-none">
        Why this route is {risk.level} risk
      </Typography>
      {RISK_FACTORS.map(([key, label]) => (
        <Box key={key} className="grid grid-cols-[140px_1fr_32px] items-center gap-2">
          <Typography variant="caption" color="text.secondary">
            {label}
          </Typography>
          <Box className="h-1.5 rounded-full bg-ink-700">
            <Box
              className="h-1.5 rounded-full"
              sx={{
                width: `${Math.max(2, risk.factors[key])}%`,
                background:
                  risk.factors[key] >= 60
                    ? 'var(--danger)'
                    : risk.factors[key] >= 35
                      ? 'var(--warn)'
                      : 'var(--ok)',
              }}
            />
          </Box>
          <Typography variant="caption" className="mono text-right">
            {Math.round(risk.factors[key])}
          </Typography>
        </Box>
      ))}
      <Typography variant="caption" color="text.secondary">
        {risk.incidentCount === 0
          ? 'No recorded incidents on this route in the last three years.'
          : `${risk.incidentCount} recorded incident${risk.incidentCount === 1 ? '' : 's'} on this route in the last three years.`}
        {risk.unsurveyedPct > 0 &&
          ` ${Math.round(risk.unsurveyedPct)}% of it has no road-surface survey.`}
      </Typography>
    </Box>
  );
}

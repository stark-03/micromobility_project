import { QueryTypes } from 'sequelize';
import type { WeatherDto } from '@mm/shared-types';
import { sequelize } from '../../db/index.ts';
import { cache } from '../../cache/index.ts';
import { CACHE_KEYS } from '../../cache/keys.ts';
import { AppError } from '../../lib/errors.ts';
import { bus } from '../../realtime/bus.ts';

/**
 * M12 weather.
 *
 * No live weather provider is wired up — `.env` carries no API key and a viva
 * should not depend on a third-party service being reachable. This generates
 * plausible Belagavi weather instead, and writes it through exactly the same
 * table and contract a real provider would use, so swapping one in later is a
 * change to this one function.
 *
 * Belagavi sits at ~750 m and gets a heavy south-west monsoon June–September,
 * so August readings are wet and mild rather than hot and dry.
 */
interface Generated {
  tempC: number;
  precipitationMm: number;
  windKph: number;
  visibilityM: number;
  conditionCode: string;
}

function generate(zoneIndex: number, at: Date): Generated {
  const hour = at.getHours() + at.getMinutes() / 60;
  const month = at.getMonth(); // 0-11
  const monsoon = month >= 5 && month <= 8;

  // Diurnal temperature swing around a seasonal mean.
  const seasonalMean = monsoon ? 23 : 27;
  const tempC = Number(
    (seasonalMean + 4 * Math.sin(((hour - 9) / 24) * 2 * Math.PI) + zoneIndex * 0.15).toFixed(1),
  );

  // Deterministic per (zone, hour) so repeated polls in the same hour agree.
  const wetness = monsoon ? 0.7 : 0.15;
  const phase = (zoneIndex * 37 + Math.floor(hour * 2)) % 20;
  const raining = phase / 20 < wetness;

  const precipitationMm = raining ? Number((0.4 + (phase % 7) * 0.9).toFixed(1)) : 0;
  const windKph = Number((6 + (phase % 5) * 2.4 + (raining ? 5 : 0)).toFixed(1));
  const visibilityM = raining ? 3000 + (phase % 4) * 900 : 9000 + (phase % 3) * 500;

  const conditionCode = !raining
    ? monsoon
      ? 'cloudy'
      : 'clear'
    : precipitationMm > 4
      ? 'heavy_rain'
      : 'light_rain';

  return { tempC, precipitationMm, windKph, visibilityM, conditionCode };
}

export interface PollResult {
  zonesUpdated: number;
}

/** Writes one reading per zone. Called by the 15-minute cron and on demand. */
export async function pollWeather(at = new Date()): Promise<PollResult> {
  const zones = await sequelize.query<{ id: string }>('SELECT id FROM zones ORDER BY id', {
    type: QueryTypes.SELECT,
  });
  if (zones.length === 0) return { zonesUpdated: 0 };

  // Bucket to the quarter hour so a re-poll updates its own row rather than
  // stacking near-duplicates — the (zone_id, observed_at) unique key does the
  // rest.
  const bucketed = new Date(at);
  bucketed.setMinutes(Math.floor(bucketed.getMinutes() / 15) * 15, 0, 0);

  const rows: string[] = [];
  const reps: unknown[] = [];
  zones.forEach((z, i) => {
    const g = generate(i, bucketed);
    rows.push('(?, ?, ?, ?, ?, ?, ?, ?)');
    reps.push(
      z.id,
      bucketed,
      g.tempC,
      g.precipitationMm,
      g.windKph,
      g.visibilityM,
      g.conditionCode,
      'synthetic',
    );
  });

  await sequelize.query(
    `INSERT INTO weather_readings
       (zone_id, observed_at, temp_c, precipitation_mm, wind_kph, visibility_m,
        condition_code, source)
     VALUES ${rows.join(',')}
     ON DUPLICATE KEY UPDATE
       temp_c = VALUES(temp_c), precipitation_mm = VALUES(precipitation_mm),
       wind_kph = VALUES(wind_kph), visibility_m = VALUES(visibility_m),
       condition_code = VALUES(condition_code)`,
    { replacements: reps },
  );

  for (const z of zones) {
    await cache.del(CACHE_KEYS.weatherCurrent(String(z.id)).key);
  }
  await cache.del(CACHE_KEYS.weatherCurrent('city').key);

  bus.emit('weather:update', { zoneId: String(zones[0]!.id), at: bucketed.toISOString() });

  return { zonesUpdated: zones.length };
}

interface WeatherRow {
  zone_id: string;
  zone_name: string;
  observed_at: Date;
  temp_c: string | null;
  precipitation_mm: string | null;
  wind_kph: string | null;
  visibility_m: number | null;
  condition_code: string | null;
}

function toDto(r: WeatherRow): WeatherDto {
  return {
    zoneId: String(r.zone_id),
    zoneName: r.zone_name,
    observedAt: new Date(r.observed_at).toISOString(),
    tempC: r.temp_c === null ? null : Number(r.temp_c),
    precipitationMm: r.precipitation_mm === null ? null : Number(r.precipitation_mm),
    windKph: r.wind_kph === null ? null : Number(r.wind_kph),
    visibilityM: r.visibility_m === null ? null : Number(r.visibility_m),
    conditionCode: r.condition_code,
  };
}

async function loadCurrent(zoneId?: string): Promise<WeatherDto[]> {
  // Latest reading per zone.
  const rows = await sequelize.query<WeatherRow>(
    `SELECT wr.zone_id, z.name AS zone_name, wr.observed_at, wr.temp_c,
            wr.precipitation_mm, wr.wind_kph, wr.visibility_m, wr.condition_code
     FROM weather_readings wr
     JOIN zones z ON z.id = wr.zone_id
     JOIN (
       SELECT zone_id, MAX(observed_at) AS newest
       FROM weather_readings
       GROUP BY zone_id
     ) latest ON latest.zone_id = wr.zone_id AND latest.newest = wr.observed_at
     ${zoneId ? 'WHERE wr.zone_id = ?' : ''}
     ORDER BY z.code`,
    { type: QueryTypes.SELECT, replacements: zoneId ? [zoneId] : [] },
  );
  return rows.map(toDto);
}

export function getCurrentWeather(zoneId?: string): Promise<WeatherDto[]> {
  const spec = CACHE_KEYS.weatherCurrent(zoneId ?? 'city');
  return cache.wrap(spec.key, spec.ttl, () => loadCurrent(zoneId));
}

export async function getZoneWeather(zoneId: string): Promise<WeatherDto> {
  const [w] = await getCurrentWeather(zoneId);
  if (!w) throw AppError.notFound('USER_NOT_FOUND', 'No weather recorded for that zone yet');
  return w;
}

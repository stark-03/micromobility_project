import { Router } from 'express';
import { QueryTypes } from 'sequelize';
import { sequelize } from '../../db/index.ts';
import { selectGeom, parsePoint } from '../../db/spatial.ts';
import { cache } from '../../cache/index.ts';
import { asyncHandler } from '../../middleware/error.ts';

/**
 * M15 — outbound GBFS 2.3 feed.
 *
 * GBFS is the open standard for shared-mobility data. Publishing it is what
 * makes this project's fleet consumable by third parties — journey planners,
 * the city's open-data portal, Google Maps — without any of them integrating
 * against our private API.
 *
 * **Public and unauthenticated**, per CLAUDE.md and the standard itself. It is
 * mounted at /gbfs/*, outside /api/v1, so no auth middleware is in its path.
 *
 * **Privacy is the design constraint here.** The feed publishes only vehicles
 * with status `available`. A vehicle that is `in_use` is under a rider, and its
 * position is that rider's live location — publishing it, unauthenticated,
 * would expose trip trajectories to anyone who polls the feed every minute.
 * GBFS itself is explicit that free_bike_status covers vehicles available for
 * rent; this implementation treats that as a hard privacy boundary, not a
 * formatting detail.
 */
export const gbfsRoutes = Router();

const GBFS_VERSION = '2.3';
const SYSTEM_ID = 'belagavi_micromobility';
const TTL_SECONDS = 60;

/** GBFS wraps every payload in this envelope — not the project's own. */
function feed(data: unknown, ttl = TTL_SECONDS) {
  return {
    last_updated: Math.floor(Date.now() / 1000),
    ttl,
    version: GBFS_VERSION,
    data,
  };
}

function base(req: { protocol: string; get(name: string): string | undefined }): string {
  return `${req.protocol}://${req.get('host') ?? 'localhost:4000'}/gbfs/${GBFS_VERSION}`;
}

/** Auto-discovery. A consumer is given this URL and finds everything else. */
gbfsRoutes.get('/gbfs.json', (req, res) => {
  const root = base(req);
  res.json(
    feed({
      en: {
        feeds: [
          { name: 'system_information', url: `${root}/system_information.json` },
          { name: 'vehicle_types', url: `${root}/vehicle_types.json` },
          { name: 'free_bike_status', url: `${root}/free_bike_status.json` },
        ],
      },
    }),
  );
});

gbfsRoutes.get('/system_information.json', (_req, res) => {
  res.json(
    feed({
      system_id: SYSTEM_ID,
      language: 'en',
      name: 'Belagavi Micro Mobility',
      short_name: 'Belagavi MM',
      operator: 'AI Urban Micro Mobility Simulator',
      timezone: 'Asia/Kolkata',
      license_id: 'CC0-1.0',
      // Honest labelling: this is a simulator, and a consumer indexing it
      // should know the data is synthetic before they act on it.
      purchase_url: 'https://example.invalid/belagavi-micromobility',
      feed_contact_email: 'ops@example.invalid',
    }),
  );
});

/** GBFS vehicle types, mapped from this project's four modes. */
gbfsRoutes.get('/vehicle_types.json', (_req, res) => {
  res.json(
    feed({
      vehicle_types: [
        { vehicle_type_id: 'scooter', form_factor: 'scooter', propulsion_type: 'electric', max_range_meters: 25000 },
        { vehicle_type_id: 'bike', form_factor: 'bicycle', propulsion_type: 'human' },
        { vehicle_type_id: 'ebike', form_factor: 'bicycle', propulsion_type: 'electric_assist', max_range_meters: 45000 },
        { vehicle_type_id: 'ev', form_factor: 'car', propulsion_type: 'electric', max_range_meters: 120000 },
      ],
    }),
  );
});

interface VehicleRow {
  id: string;
  type: string;
  battery_pct: string | null;
  position_wkt: string | null;
}

/**
 * Vehicles available for rent, right now.
 *
 * Cached for the feed's own TTL: GBFS consumers are told to poll every 60s, and
 * without a cache a handful of them would each trigger a spatial read of the
 * whole fleet. The cache adapter is the memory one; nothing here is a source of
 * truth, so losing it on restart is correct.
 */
gbfsRoutes.get(
  '/free_bike_status.json',
  asyncHandler(async (_req, res) => {
    const bikes = await cache.wrap('gbfs:free_bike_status', TTL_SECONDS, async () => {
      const rows = await sequelize.query<VehicleRow>(
        `SELECT v.id, v.type, v.battery_pct,
                ${selectGeom('v.last_position', 'position_wkt')}
           FROM vehicles v
          WHERE v.deleted_at IS NULL
            AND v.status = 'available'
            AND v.last_position IS NOT NULL`,
        { type: QueryTypes.SELECT },
      );

      return rows
        .map((r) => {
          const point = r.position_wkt ? parsePoint(r.position_wkt) : null;
          if (!point) return null;
          const [lon, lat] = point.coordinates;

          return {
            // GBFS 2.x requires bike_id to be rotated so a vehicle cannot be
            // followed across rentals. The database id is stable, so it is
            // hashed with the current hour: stable within a polling window,
            // unlinkable across days.
            bike_id: rotatingId(String(r.id)),
            lat,
            lon,
            is_reserved: 0,
            is_disabled: 0,
            vehicle_type_id: r.type,
            current_range_meters: rangeMeters(r.type, r.battery_pct),
          };
        })
        .filter((b): b is NonNullable<typeof b> => b !== null);
    });

    res.json(feed({ bikes }));
  }),
);

const MAX_RANGE_M: Record<string, number> = {
  scooter: 25000,
  ebike: 45000,
  ev: 120000,
  bike: 0,
};

function rangeMeters(type: string, batteryPct: string | null): number {
  const max = MAX_RANGE_M[type] ?? 0;
  // A pedal bike has no battery and no range limit to report; GBFS wants 0.
  if (max === 0) return 0;
  const pct = Number(batteryPct ?? 0);
  return Math.round((Number.isFinite(pct) ? pct : 0) * 0.01 * max);
}

/**
 * A per-hour rotating pseudonym for a vehicle id.
 *
 * GBFS 2.x asks that bike_id not be a persistent identifier, so a third party
 * cannot reconstruct one vehicle's history — and by extension the movements of
 * whoever rode it. Hashing the id with the current hour keeps the feed
 * self-consistent for a polling consumer while breaking linkage over time.
 */
function rotatingId(vehicleId: string): string {
  const hour = Math.floor(Date.now() / 3_600_000);
  let h = 2166136261;
  for (const ch of `${vehicleId}:${hour}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

import { QueryTypes } from 'sequelize';
import type { Sequelize, Transaction } from 'sequelize';

/**
 * Synthetic M09 inputs: accident history and road surface surveys.
 *
 * Deterministic — a hash of the segment's id, never Math.random() — so a
 * re-seed produces the same incidents (belagavi-geo.ts explains why). The
 * shape follows what road-safety data generally shows for two-wheelers rather
 * than any real Belagavi record: arterials and unlit roads carry most of the
 * incidents, and a bike lane takes a large share of the risk away.
 *
 * Every incident is labelled `source = 'synthetic'`. When real police or
 * operator data arrives it goes in alongside with its own source, and these
 * can be deleted by that one column.
 */

/** Same integer hash as belagavi-geo.ts: (a, b) → [0, 1). */
function hash2(a: number, b: number): number {
  let h = Math.imul(a, 374761393) + Math.imul(b, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Expected incidents per km over three years, by road class. */
const INCIDENTS_PER_KM: Record<string, number> = {
  arterial: 2.4,
  collector: 1.3,
  local: 0.5,
  path: 0.2,
  cycleway: 0.1,
};

/** Typical surface by road class, 1 (broken) to 5 (good). */
const SURFACE_BASE: Record<string, number> = {
  arterial: 4,
  collector: 3.5,
  local: 3,
  path: 2.5,
  cycleway: 4,
};

interface SegRow {
  id: string;
  road_class: string;
  length_m: string;
  lit: number;
  has_bike_lane: number;
  lng: number;
  lat: number;
}

export async function seedSafety(
  s: Sequelize,
  t: Transaction,
): Promise<{ incidents: number; surveyed: number }> {
  const segments = await s.query<SegRow>(
    `SELECT id, road_class, length_m, lit, has_bike_lane,
            ST_Longitude(ST_StartPoint(geometry)) AS lng,
            ST_Latitude(ST_StartPoint(geometry))  AS lat
       FROM road_segments ORDER BY id`,
    { type: QueryTypes.SELECT, transaction: t },
  );

  // ---- surface quality: only roads not yet surveyed -------------------------
  let surveyed = 0;
  for (const seg of segments) {
    const id = Number(seg.id);
    // About one road in seven has never been surveyed; it stays NULL.
    if (hash2(id, 31) < 0.14) continue;
    const base = SURFACE_BASE[seg.road_class] ?? 3;
    const q = Math.max(1, Math.min(5, Math.round(base + (hash2(id, 37) - 0.5) * 3)));
    const [, meta] = await s.query(
      'UPDATE road_segments SET surface_quality = :q WHERE id = :id AND surface_quality IS NULL',
      { replacements: { q, id }, transaction: t },
    );
    surveyed += Number((meta as { affectedRows?: number })?.affectedRows ?? 0);
  }

  // ---- incidents: only for segments that have none yet ----------------------
  const seeded = await s.query<{ segment_id: string }>(
    `SELECT DISTINCT segment_id FROM incidents WHERE source = 'synthetic' AND segment_id IS NOT NULL`,
    { type: QueryTypes.SELECT, transaction: t },
  );
  const done = new Set(seeded.map((r) => String(r.segment_id)));

  const rows: string[] = [];
  const reps: unknown[] = [];
  for (const seg of segments) {
    if (done.has(String(seg.id))) continue;
    const id = Number(seg.id);
    const km = Number(seg.length_m) / 1000;

    let rate = (INCIDENTS_PER_KM[seg.road_class] ?? 0.5) * km;
    if (!seg.lit) rate *= 1.7;
    if (seg.has_bike_lane) rate *= 0.45;

    // Whole incidents from the expected rate: the integer part always, the
    // fractional part with that probability.
    const count = Math.floor(rate) + (hash2(id, 41) < rate - Math.floor(rate) ? 1 : 0);

    for (let k = 0; k < count; k++) {
      const roll = hash2(id * 7 + k, 43);
      const severity = roll < 0.03 ? 'fatal' : roll < 0.22 ? 'serious' : 'minor';
      const kindRoll = hash2(id * 7 + k, 47);
      const kind =
        kindRoll < 0.45
          ? 'collision'
          : kindRoll < 0.8
            ? 'fall'
            : kindRoll < 0.95
              ? 'near_miss'
              : 'other';
      const daysAgo = 1 + Math.floor(hash2(id * 7 + k, 53) * 1090);

      rows.push(
        `(?, DATE_SUB(NOW(3), INTERVAL ? DAY), ST_GeomFromText(?, 4326, 'axis-order=long-lat'), ?, ?, 'synthetic')`,
      );
      // Same axis convention as db/spatial.ts: [lng lat], stated explicitly.
      reps.push(id, daysAgo, `POINT(${Number(seg.lng)} ${Number(seg.lat)})`, severity, kind);
    }
  }

  // Batched: a few thousand single-row inserts would dominate the seed's runtime.
  for (let i = 0; i < rows.length; i += 500) {
    await s.query(
      `INSERT INTO incidents (segment_id, occurred_at, location, severity, kind, source)
       VALUES ${rows.slice(i, i + 500).join(',')}`,
      { replacements: reps.slice(i * 5, (i + 500) * 5), transaction: t },
    );
  }

  return { incidents: rows.length, surveyed };
}

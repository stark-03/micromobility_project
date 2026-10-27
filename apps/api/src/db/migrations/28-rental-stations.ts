import type { MigrationContext } from '../umzug.ts';

// Inlined rather than imported: a migration must keep meaning what it meant
// the day it ran, even if the app's alphabet later changes.
const UNLOCK_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/**
 * M08 rental stations, and the two vehicle columns renting needs.
 *
 * A station's inventory is NOT stored. It is derived from `vehicles.station_id`
 * and `vehicles.status` on every read, so a rental, a return, a vehicle going
 * to charge or to the workshop all change the count without a second write
 * that could drift from the first.
 *
 * `unlock_code` is the identifier printed on the vehicle as a QR code. It is
 * separate from `external_ref` for two reasons: `external_ref` is only unique
 * per operator, and it is sequential — anyone could walk the series. Eight
 * random characters from an unambiguous alphabet are neither.
 */
export async function up({ sequelize }: MigrationContext): Promise<void> {
  await sequelize.query(`
    CREATE TABLE rental_stations (
      id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      code        VARCHAR(16)   NOT NULL,
      name        VARCHAR(120)  NOT NULL,
      zone_id     BIGINT UNSIGNED NULL,
      location    POINT         NOT NULL SRID 4326,
      /** Docks. A return is refused when every dock is taken. */
      capacity    SMALLINT UNSIGNED NOT NULL DEFAULT 12,
      /** Metres from the station a vehicle may be and still count as returned there. */
      return_radius_m SMALLINT UNSIGNED NOT NULL DEFAULT 150,
      status      ENUM('active','closed') NOT NULL DEFAULT 'active',
      created_at  DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at  DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      deleted_at  DATETIME(3)   NULL,
      UNIQUE KEY uq_rental_station_code (code),
      SPATIAL INDEX idx_rental_station_location (location),
      KEY idx_rental_station_live (deleted_at, status),
      CONSTRAINT fk_rental_station_zone FOREIGN KEY (zone_id) REFERENCES zones(id) ON DELETE SET NULL
    ) ENGINE=InnoDB
  `);

  await sequelize.query(`
    ALTER TABLE vehicles
      ADD COLUMN station_id  BIGINT UNSIGNED NULL AFTER home_zone_id,
      ADD COLUMN unlock_code CHAR(8) NULL AFTER external_ref,
      ADD UNIQUE KEY uq_vehicle_unlock_code (unlock_code),
      ADD KEY idx_vehicles_station_status (station_id, status),
      ADD CONSTRAINT fk_vehicles_station FOREIGN KEY (station_id)
        REFERENCES rental_stations(id) ON DELETE SET NULL
  `);

  // Backfill every existing vehicle. The alphabet drops 0/O and 1/I/L so a
  // code read off a scratched sticker cannot be mistyped into another one.
  // Collisions across a fleet of thousands are vanishingly unlikely, and the
  // UNIQUE key turns one into a loud failure rather than a shared code.
  //
  // Eight separate RAND() calls inline, not a subquery: an uncorrelated
  // subquery may be evaluated once and its result reused for every row, which
  // would give the whole fleet the same code.
  const ch = `SUBSTRING('${UNLOCK_ALPHABET}', 1 + FLOOR(RAND() * ${UNLOCK_ALPHABET.length}), 1)`;
  await sequelize.query(`
    UPDATE vehicles
       SET unlock_code = CONCAT(${Array.from({ length: 8 }, () => ch).join(', ')})
     WHERE unlock_code IS NULL
  `);
}

export async function down({ sequelize }: MigrationContext): Promise<void> {
  await sequelize.query(`
    ALTER TABLE vehicles
      DROP FOREIGN KEY fk_vehicles_station,
      DROP KEY idx_vehicles_station_status,
      DROP KEY uq_vehicle_unlock_code,
      DROP COLUMN unlock_code,
      DROP COLUMN station_id
  `);
  await sequelize.query('DROP TABLE IF EXISTS rental_stations');
}

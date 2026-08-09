import { afterAll, describe, expect, it } from 'vitest';
import type { Model, ModelStatic } from 'sequelize';
import { env } from '../../src/config/env.ts';
import { buildSequelize } from '../../src/db/index.ts';
import { initModels } from '../../src/db/models/index.ts';

const s = buildSequelize(env.db.nameTest);
const models = initModels(s);

afterAll(async () => {
  await s.close();
});

describe('models', () => {
  it('defines all 16 tables', () => {
    expect(Object.keys(models)).toHaveLength(20);
  });

  // Every attribute a model declares must exist as a column, or the SELECT
  // fails with ER_BAD_FIELD_ERROR. This is the most common way a model drifts
  // from its migration, and it costs one query per model to catch.
  it.each(Object.entries(models))('%s selects cleanly against the real schema', async (_n, M) => {
    // Widened to ModelStatic<Model>: the union of 16 concrete model classes does
    // not satisfy findAll's `this`, and the query is identical for all of them.
    const model = M as unknown as ModelStatic<Model>;
    await expect(model.findAll({ limit: 1 })).resolves.toBeInstanceOf(Array);
  });

  it('maps each model to its snake_case plural table', () => {
    expect(models.User.tableName).toBe('users');
    expect(models.VehicleStatusHistory.tableName).toBe('vehicle_status_history');
    expect(models.MaintenanceTicket.tableName).toBe('maintenance_tickets');
    expect(models.RoadSegment.tableName).toBe('road_segments');
  });

  it('soft-deletes only where history matters', () => {
    expect(models.User.options.paranoid).toBe(true);
    expect(models.Vehicle.options.paranoid).toBe(true);
    expect(models.Trip.options.paranoid).toBeFalsy();
    expect(models.AuditLog.options.paranoid).toBeFalsy();
  });

  it('omits every geometry column so Sequelize can never read one', () => {
    // Geometry lives behind db/spatial.ts. If a POINT/POLYGON/LINESTRING column
    // is ever added to a model, Sequelize will SELECT it without axis-order
    // handling and silently transpose the coordinates.
    expect(Object.keys(models.Zone.getAttributes())).not.toContain('boundary');
    expect(Object.keys(models.Zone.getAttributes())).not.toContain('centroid');
    expect(Object.keys(models.Vehicle.getAttributes())).not.toContain('last_position');
    expect(Object.keys(models.SavedPlace.getAttributes())).not.toContain('position');
    expect(Object.keys(models.RoadSegment.getAttributes())).not.toContain('geometry');
    expect(Object.keys(models.Trip.getAttributes())).not.toContain('start_position');
    expect(Object.keys(models.Trip.getAttributes())).not.toContain('end_position');
  });

  it('gives VehicleTelemetry no association to Vehicle', () => {
    // Partitioned tables carry no FK, so there is nothing for an association to
    // lean on, and a join would invite un-bounded scans.
    expect(Object.keys(models.VehicleTelemetry.associations)).toHaveLength(0);
  });
});

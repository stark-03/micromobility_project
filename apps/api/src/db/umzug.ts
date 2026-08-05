import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SequelizeStorage, Umzug } from 'umzug';
import type { QueryInterface, Sequelize } from 'sequelize';

const here = path.dirname(fileURLToPath(import.meta.url));

export interface MigrationContext {
  queryInterface: QueryInterface;
  sequelize: Sequelize;
}

/**
 * Migrations are .ts and Node strips their types on load — verified working on
 * Node 22.18+. They issue raw DDL rather than using queryInterface.createTable,
 * because Sequelize cannot express SRID 4326, SPATIAL INDEX, DATETIME(3)
 * defaults or RANGE partitioning.
 */
export function createUmzug(sequelize: Sequelize) {
  return new Umzug<MigrationContext>({
    migrations: { glob: ['migrations/*.ts', { cwd: here }] },
    context: { queryInterface: sequelize.getQueryInterface(), sequelize },
    storage: new SequelizeStorage({ sequelize, modelName: 'schema_migrations' }),
    logger: console,
  });
}

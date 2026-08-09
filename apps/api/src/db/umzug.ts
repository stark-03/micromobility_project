import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SequelizeStorage, Umzug } from 'umzug';
import type { QueryInterface, Sequelize } from 'sequelize';

const here = path.dirname(fileURLToPath(import.meta.url));

interface MigrationModule {
  up: (ctx: MigrationContext) => Promise<void>;
  down: (ctx: MigrationContext) => Promise<void>;
}

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
    migrations: {
      glob: ['migrations/*.ts', { cwd: here }],
      // Umzug hands a migration `{ name, path, context }`. Unwrapping it here
      // lets every migration file take the context directly — `({ sequelize })`
      // reads better than `({ context })` then `context.sequelize` sixteen times.
      resolve: ({ name, path: filepath, context }) => {
        if (!filepath) throw new Error(`Migration ${name} has no path`);
        const load = async (): Promise<MigrationModule> =>
          (await import(pathToFileURL(filepath).href)) as MigrationModule;
        return {
          name,
          up: async () => (await load()).up(context),
          down: async () => (await load()).down(context),
        };
      },
    },
    context: { queryInterface: sequelize.getQueryInterface(), sequelize },
    storage: new SequelizeStorage({ sequelize, modelName: 'schema_migrations' }),
    logger: console,
  });
}

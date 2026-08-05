import { Sequelize } from 'sequelize';
import { activeDbName, env } from '../config/env.ts';

export function buildSequelize(dbName: string): Sequelize {
  return new Sequelize(dbName, env.db.user, env.db.password, {
    host: env.db.host,
    port: env.db.port,
    dialect: 'mysql',
    logging: false,
    dialectOptions: {
      // MySQL 8.4 removed mysql_native_password. mysql2 speaks
      // caching_sha2_password, but over a plain localhost connection it needs
      // the server's public key for the initial exchange.
      // LOCALHOST ONLY — never set this against a remote server; use TLS there.
      allowPublicKeyRetrieval: true,
      // BIGINT UNSIGNED exceeds Number.MAX_SAFE_INTEGER, so ids come back as
      // strings. Every DTO types `id` as string because of this.
      supportBigNumbers: true,
      bigNumberStrings: true,
      dateStrings: false,
      timezone: 'Z',
    },
    timezone: '+00:00',
    define: {
      underscored: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    pool: { max: 10, min: 0, idle: 10_000 },
  });
}

export const sequelize = buildSequelize(activeDbName);

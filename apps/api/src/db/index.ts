import { Sequelize } from 'sequelize';
import { activeDbName, env } from '../config/env.ts';

export function buildSequelize(dbName: string): Sequelize {
  return new Sequelize(dbName, env.db.user, env.db.password, {
    host: env.db.host,
    port: env.db.port,
    dialect: 'mysql',
    logging: false,
    dialectOptions: {
      // NOTE: CLAUDE.md and design.md both ask for `allowPublicKeyRetrieval: true`
      // here. That is a JDBC option name — the Node mysql2 driver has no such
      // setting and logs "Ignoring invalid configuration option" when given it,
      // which a future mysql2 promises to upgrade to a thrown error.
      //
      // It isn't needed: mysql2 implements caching_sha2_password natively and
      // requests the server's RSA public key itself when the auth cache is cold
      // over a non-TLS connection. MySQL 8.4 removed mysql_native_password, so
      // the driver choice still matters — the legacy `mysql` package cannot
      // complete this handshake at all. See docs/adr/0002-mysql2-auth.md.
      //
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

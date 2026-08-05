import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { env } from '../src/config/env.ts';
import { buildSequelize } from '../src/db/index.ts';
import { createUmzug } from '../src/db/umzug.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, '../src/db/migrations');
const verb = process.argv[2];

/** Only ever creates the two schemas this project owns. Never drops anything. */
async function createDatabases(): Promise<void> {
  const conn = await mysql.createConnection({
    host: env.db.host,
    port: env.db.port,
    user: env.db.user,
    password: env.db.password,
  });
  try {
    for (const name of [env.db.name, env.db.nameTest]) {
      await conn.query(
        `CREATE DATABASE IF NOT EXISTS \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
      );
      console.log(`database ready: ${name}`);
    }
  } finally {
    await conn.end();
  }
}

async function withUmzug(fn: (u: ReturnType<typeof createUmzug>) => Promise<unknown>): Promise<void> {
  const target = env.isTest ? env.db.nameTest : env.db.name;
  const s = buildSequelize(target);
  console.log(`schema: ${target}`);
  try {
    await fn(createUmzug(s));
  } finally {
    await s.close();
  }
}

async function make(name: string): Promise<void> {
  if (!name) throw new Error('usage: npm run db:make -- <name>');
  const existing = await fs.readdir(migrationsDir);
  const next = String(existing.filter((f) => f.endsWith('.ts')).length + 1).padStart(2, '0');
  const file = path.join(migrationsDir, `${next}-${name}.ts`);
  await fs.writeFile(
    file,
    `import type { MigrationContext } from '../umzug.ts';

export async function up({ sequelize }: MigrationContext): Promise<void> {
  await sequelize.query(\`\`);
}

export async function down({ sequelize }: MigrationContext): Promise<void> {
  await sequelize.query(\`\`);
}
`,
  );
  console.log(`created ${file}`);
}

switch (verb) {
  case 'create':
    await createDatabases();
    break;
  case 'migrate':
    await withUmzug((u) => u.up());
    break;
  case 'undo':
    await withUmzug((u) => u.down());
    break;
  case 'make':
    await make(process.argv[3] ?? '');
    break;
  case 'seed': {
    const { runSeed } = await import('../src/db/seeders/index.ts');
    const summary = await runSeed();
    console.table(summary);
    break;
  }
  default:
    console.error('usage: db.ts create|migrate|undo|make <name>|seed');
    process.exit(1);
}

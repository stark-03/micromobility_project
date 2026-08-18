/**
 * Pre-demo preflight.
 *
 * Run this BEFORE standing in front of a panel. It checks the things that
 * actually go wrong on a cold laptop — MySQL down, migrations behind, an empty
 * database, a stale process squatting on a port — and prints a fix for each.
 *
 *   npm run demo:check
 */
import mysql from 'mysql2/promise';
import net from 'node:net';

const env = (k, d) => process.env[k] ?? d;
let failures = 0;

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m, fix) => {
  failures += 1;
  console.log(`  \x1b[31m✗\x1b[0m ${m}`);
  if (fix) console.log(`    \x1b[33m→ ${fix}\x1b[0m`);
};

function portBusy(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(true));
    s.once('listening', () => s.close(() => resolve(false)));
    s.listen(port, '127.0.0.1');
  });
}

console.log('\nPreflight\n');

// 1. MySQL reachable
let conn;
try {
  conn = await mysql.createConnection({
    host: env('DB_HOST', 'localhost'),
    port: Number(env('DB_PORT', '3306')),
    user: env('DB_USER', 'root'),
    password: env('DB_PASSWORD', ''),
    database: env('DB_NAME', 'micromobility'),
  });
  ok(`MySQL reachable — ${env('DB_NAME', 'micromobility')} as ${env('DB_USER', 'root')}`);
} catch (e) {
  bad(`MySQL unreachable: ${e.message}`, 'systemctl start mysqld  (then re-run)');
}

if (conn) {
  // 2. Migrations applied
  const [[mig]] = await conn.query('SELECT COUNT(*) AS n FROM schema_migrations').catch(() => [[null]]);
  if (!mig) bad('schema_migrations missing', 'npm run db:migrate');
  else if (Number(mig.n) < 20) bad(`only ${mig.n}/20 migrations applied`, 'npm run db:migrate');
  else ok(`${mig.n} migrations applied`);

  // 3. Seed present
  const counts = {};
  for (const t of ['zones', 'road_segments', 'vehicles', 'users']) {
    const [[r]] = await conn.query(`SELECT COUNT(*) AS n FROM \`${t}\``).catch(() => [[{ n: 0 }]]);
    counts[t] = Number(r.n);
  }
  if (counts.zones === 0 || counts.vehicles === 0) {
    bad('database is empty', 'npm run db:seed   (prints the demo passwords — copy them)');
  } else {
    ok(`seeded — ${counts.zones} zones, ${counts.road_segments} segments, ${counts.vehicles} vehicles, ${counts.users} users`);
  }

  // 3b. M06 scenarios — the Sim screen is empty without them
  const [[sc]] = await conn
    .query('SELECT COUNT(*) AS n FROM scenarios WHERE deleted_at IS NULL')
    .catch(() => [[{ n: 0 }]]);
  if (Number(sc.n) === 0) {
    bad('no scenarios — the Sim screen will be empty', 'npm run db:seed');
  } else {
    const [[done]] = await conn
      .query("SELECT COUNT(*) AS n FROM simulation_runs WHERE status = 'completed'")
      .catch(() => [[{ n: 0 }]]);
    if (Number(done.n) === 0) {
      // Not fatal: pressing Run is the demo. But knowing beforehand beats
      // discovering it in front of an examiner.
      ok(`${sc.n} scenarios, none run yet — press Run simulation on the Sim screen`);
    } else {
      ok(`${sc.n} scenarios, ${done.n} completed runs`);
    }
  }

  // 3c. M11 rollups — the Admin dashboard reads these and nothing else.
  const [[roll]] = await conn
    .query('SELECT COUNT(*) AS n FROM kpi_daily')
    .catch(() => [[{ n: 0 }]]);
  if (Number(roll.n) === 0) {
    bad('no analytics rollups — the Admin dashboard will be empty', 'npm run rollup');
  } else {
    ok(`${roll.n} days of analytics rollups`);
  }

  // 4. Traffic data present — this is what makes the map colourful
  const [[tr]] = await conn.query('SELECT COUNT(*) AS n FROM traffic_snapshots').catch(() => [[{ n: 0 }]]);
  const [[ci]] = await conn.query('SELECT AVG(congestion_index) AS a FROM traffic_snapshots').catch(() => [[{ a: 0 }]]);
  if (Number(tr.n) === 0) {
    bad('no traffic snapshots — the map will render grey', 'npm run demo:traffic   (or npm run demo)');
  } else {
    const avg = Number(ci.a ?? 0);
    ok(`${tr.n} segments have traffic, mean congestion ${avg.toFixed(2)}`);
    if (avg < 0.15) {
      bad('congestion is very low — the map will look uniformly green',
          'npm run demo:traffic   (pins the clock to evening rush)');
    }
  }

  // 5. Weather present
  const [[w]] = await conn.query('SELECT COUNT(*) AS n FROM weather_readings').catch(() => [[{ n: 0 }]]);
  if (Number(w.n) === 0) bad('no weather readings — the header strip will be blank',
                             'start the API and wait a tick, or POST /api/v1/weather/poll');
  else ok(`${w.n} weather readings`);

  await conn.end();
}

// 6. Ports free
for (const [port, what] of [[4000, 'API'], [5173, 'Vite']]) {
  if (await portBusy(port)) {
    bad(`port ${port} is already in use (${what})`, `fuser -k ${port}/tcp`);
  } else {
    ok(`port ${port} free for ${what}`);
  }
}

console.log(
  failures === 0
    ? '\n\x1b[32mReady to demo.\x1b[0m  Run: npm run demo\n'
    : `\n\x1b[31m${failures} problem(s) above — fix them before the demo.\x1b[0m\n`,
);
process.exit(failures === 0 ? 0 : 1);

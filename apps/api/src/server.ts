import { createServer } from 'node:http';
import { createApp } from './app.ts';
import { env } from './config/env.ts';
import { sequelize } from './db/index.ts';
import { shutdownJobs } from './jobs/runner.ts';
import { startSchedule, stopSchedule } from './jobs/schedule.ts';
import { ensurePartitions } from './jobs/partitions.ts';
import { logger } from './lib/logger.ts';
import { attachGateway, closeGateway } from './realtime/gateway.ts';

const app = createApp();

// An explicit http server, so Socket.IO can share the port with Express.
const server = createServer(app);
attachGateway(server);

server.listen(env.apiPort, () => {
  logger.info('API listening', { port: env.apiPort, env: env.nodeEnv });
});

// Provision partitions on boot as well as monthly: a laptop that was switched
// off across a month boundary would otherwise write into pmax until the 1st.
void ensurePartitions().catch((e: unknown) => {
  logger.error('boot partition check failed', {
    error: e instanceof Error ? e.message : String(e),
  });
});

startSchedule();

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('Shutting down', { signal });

  await stopSchedule();
  await closeGateway();
  server.close();
  await shutdownJobs();
  await sequelize.close();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

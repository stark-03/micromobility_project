import { createApp } from './app.ts';
import { env } from './config/env.ts';
import { sequelize } from './db/index.ts';
import { shutdownJobs } from './jobs/runner.ts';
import { logger } from './lib/logger.ts';

const app = createApp();

const server = app.listen(env.apiPort, () => {
  logger.info('API listening', { port: env.apiPort, env: env.nodeEnv });
});

async function shutdown(signal: string): Promise<void> {
  logger.info('Shutting down', { signal });
  server.close();
  await shutdownJobs();
  await sequelize.close();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

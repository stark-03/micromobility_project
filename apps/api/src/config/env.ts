function required(name: string): string {
  const v = process.env[name];
  if (v === undefined || v === '') throw new Error(`Missing required env var: ${name}`);
  return v;
}

function optional(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

const nodeEnv = optional('NODE_ENV', 'development');

export const env = Object.freeze({
  nodeEnv,
  isTest: nodeEnv === 'test',
  isProduction: nodeEnv === 'production',
  apiPort: Number(optional('API_PORT', '4000')),
  db: Object.freeze({
    host: optional('DB_HOST', 'localhost'),
    port: Number(optional('DB_PORT', '3306')),
    name: optional('DB_NAME', 'micromobility'),
    nameTest: optional('DB_NAME_TEST', 'micromobility_test'),
    user: optional('DB_USER', 'root'),
    password: optional('DB_PASSWORD', ''),
  }),
  jwt: Object.freeze({
    accessSecret: required('JWT_ACCESS_SECRET'),
    refreshSecret: required('JWT_REFRESH_SECRET'),
    accessTtl: optional('ACCESS_TOKEN_TTL', '15m'),
    refreshTtl: optional('REFRESH_TOKEN_TTL', '7d'),
  }),
  cacheDriver: optional('CACHE_DRIVER', 'memory'),
  queueDriver: optional('QUEUE_DRIVER', 'inline'),
  corsOrigin: optional('CORS_ORIGIN', 'http://localhost:5173'),
  mlServiceUrl: optional('ML_SERVICE_URL', ''),
  mlInternalSecret: optional('ML_INTERNAL_SECRET', 'dev_only_secret'),
  /** M14 payment adapter. Only 'mock' exists until a real gateway is contracted. */
  paymentGateway: optional('PAYMENT_GATEWAY', 'mock'),
});

/** The schema this process talks to. Tests get `micromobility_test`. */
export const activeDbName = env.isTest ? env.db.nameTest : env.db.name;

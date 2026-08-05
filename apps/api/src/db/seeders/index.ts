export interface SeedSummary {
  zones: number;
  segments: number;
  operators: number;
  vehicles: number;
  users: number;
  trips: number;
  telemetry: number;
}

export async function runSeed(): Promise<SeedSummary> {
  throw new Error('Seeder not implemented yet — arrives in Task 9.');
}

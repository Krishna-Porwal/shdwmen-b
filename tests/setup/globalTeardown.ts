import { closeDatabase } from '../../src/db/connection';

export async function globalTeardown() {
  await closeDatabase();
}

export default globalTeardown;

import { getDb } from '../src/db/client';
await getDb();
console.log('✓ migrations applied');
process.exit(0);

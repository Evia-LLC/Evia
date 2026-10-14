import '../server/lib/env.ts';
import { seedDemoUser } from '../server/demo/seed.ts';
const id=process.env.EVIA_DEMO_ACCOUNT_ID;
if (!id) throw new Error('Set EVIA_DEMO_ACCOUNT_ID to an existing confirmed synthetic Auth account.');
await seedDemoUser(id);
console.log('Synthetic account fixture data seeded.');

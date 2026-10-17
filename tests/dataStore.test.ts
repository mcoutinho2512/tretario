/** Rodada 8 — contrato do DataStore no MemoryDataStore (o PrismaDataStore roda a mesma bateria em `npm run test:db`). */
import { MemoryDataStore } from '../server/src/data/memory';
import { dataStoreContract } from './dataStoreContract';

dataStoreContract('memória', async () => new MemoryDataStore());

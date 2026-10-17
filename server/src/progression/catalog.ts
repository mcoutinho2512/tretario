/** Catálogo de missões/conquistas/níveis/recompensas do servidor: os MESMOS JSON do cliente (public/gameplay), lidos uma vez. */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseCatalog, type ProgressionCatalog } from '../../../src/progression/engine';

const DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../public/gameplay');
let cache: ProgressionCatalog | null = null;

export function loadCatalog(dir = DIR): ProgressionCatalog {
  if (cache && dir === DIR) return cache;
  const rd = (f: string) => (existsSync(`${dir}/${f}`) ? JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')) : undefined);
  const c = parseCatalog({ missions: rd('missions.json'), achievements: rd('achievements.json'), levels: rd('levels.json'), rewards: rd('rewards.json') });
  if (dir === DIR) cache = c;
  return c;
}

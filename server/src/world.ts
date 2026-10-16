/**
 * Mundo do servidor: carrega do mesmo pipeline do cliente (public/world) só o necessário para autoridade:
 * colisão 2D (segmentos), veículos utilizáveis e definições de eventos. (Sem trânsito NPC: a avenida está fechada.)
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { WallGrid, decodeSegments } from '../../src/physics/walls.ts';
import type { WorldManifest } from '../../src/world/types.ts';
import type { EventDef } from '../../src/events/types.ts';
import { registerCampaigns } from '../../src/social/designs.ts';

const here = dirname(fileURLToPath(import.meta.url));
const PUBLIC = resolve(here, '../../public');

export interface ServerWorld {
  manifest: WorldManifest;
  walls: WallGrid;
  events: Map<string, EventDef>;
  defaultEvent: string;
}

export function loadWorld(): ServerWorld {
  const t0 = Date.now();
  const manifest = JSON.parse(readFileSync(`${PUBLIC}/world/manifest.json`, 'utf8')) as WorldManifest;
  if (!manifest.collision) throw new Error('manifest sem arquivo de colisão — rode `npm run map:build`');
  const buf = readFileSync(`${PUBLIC}/world/${manifest.collision}`);
  const walls = new WallGrid();
  walls.addAll(decodeSegments(new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)));
  const idx = JSON.parse(readFileSync(`${PUBLIC}/events/index.json`, 'utf8')) as { default: string; events: string[] };
  const events = new Map<string, EventDef>();
  for (const id of idx.events) {
    const f = `${PUBLIC}/events/${id}.json`;
    if (existsSync(f)) events.set(id, JSON.parse(readFileSync(f, 'utf8')) as EventDef);
  }
  // designs de campanha são DADOS (mesmo arquivo do cliente): o servidor valida ids de design contra eles
  const camp = `${PUBLIC}/designs/campaigns.json`;
  const nCamp = existsSync(camp) ? registerCampaigns(JSON.parse(readFileSync(camp, 'utf8'))) : 0;
  console.log(`[world] ${nCamp} designs de campanha`);
  console.log(`[world] ${walls.segmentCount} paredes, ${manifest.vehicleSpawns?.length ?? 0} veículos, ${events.size} eventos (${Date.now() - t0} ms)`);
  return { manifest, walls, events, defaultEvent: idx.default };
}

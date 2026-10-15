/**
 * Etapa 1–3 do pipeline: define bbox, baixa dados OSM brutos e armazena em data/raw/.
 * Uso: npm run map:fetch
 * Fonte: OpenStreetMap (ODbL) via Overpass API. Executar apenas quando quiser atualizar os dados.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { REGION_BBOX } from '../src/geo/region';

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

const { south, west, north, east } = REGION_BBOX;
const bbox = `${south},${west},${north},${east}`;
const query = `[out:json][timeout:180];
(
  node(${bbox});
  way(${bbox});
  relation["type"="multipolygon"](${bbox});
  relation["type"="building"](${bbox});
);
(._;>;);
out body;`;

async function tryFetch(url: string): Promise<string> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'User-Agent': 'PresidenteVargas3D-MVP/0.1 (map pipeline; contact: project maintainer)',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'data=' + encodeURIComponent(query),
  });
  const text = await res.text();
  if (!res.ok || !text.trimStart().startsWith('{')) throw new Error(`${res.status} ${text.slice(0, 120)}`);
  return text;
}

async function main() {
  mkdirSync('data/raw', { recursive: true });
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const url of ENDPOINTS) {
      try {
        console.log(`[fetch] ${url} (tentativa ${attempt + 1})`);
        const text = await tryFetch(url);
        const json = JSON.parse(text);
        writeFileSync('data/raw/osm_corridor.json.gz', gzipSync(text, { level: 9 }));
        const meta = {
          source: 'OpenStreetMap contributors',
          license: 'ODbL 1.0 (https://opendatacommons.org/licenses/odbl/1-0/)',
          endpoint: url,
          query,
          bbox: REGION_BBOX,
          fetchedAt: new Date().toISOString(),
          osmBaseTimestamp: json.osm3s?.timestamp_osm_base ?? null,
          elementCount: json.elements?.length ?? 0,
        };
        writeFileSync('data/raw/osm_corridor.meta.json', JSON.stringify(meta, null, 2));
        console.log(`[fetch] OK: ${meta.elementCount} elementos, base ${meta.osmBaseTimestamp}`);
        return;
      } catch (e) {
        lastErr = e;
        console.warn(`[fetch] falhou: ${(e as Error).message}`);
      }
    }
    await new Promise((r) => setTimeout(r, 4000 * (attempt + 1)));
  }
  throw lastErr;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

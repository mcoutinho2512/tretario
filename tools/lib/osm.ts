/** Utilitários de leitura do JSON Overpass e montagem de geometrias OSM. */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { GeoProjection } from '../../src/geo/projection';
import type { XZ } from '../../src/world/types';

export interface OsmNode { type: 'node'; id: number; lat: number; lon: number; tags?: Record<string, string> }
export interface OsmWay { type: 'way'; id: number; nodes: number[]; tags?: Record<string, string> }
export interface OsmRel {
  type: 'relation';
  id: number;
  members: { type: 'node' | 'way' | 'relation'; ref: number; role: string }[];
  tags?: Record<string, string>;
}

export class OsmDataset {
  nodes = new Map<number, OsmNode>();
  ways = new Map<number, OsmWay>();
  rels = new Map<number, OsmRel>();
  /** nó → ids das ways que o contêm */
  nodeWays = new Map<number, number[]>();
  private xzCache = new Map<number, XZ>();
  timestamp: string | null = null;

  constructor(path: string, readonly proj: GeoProjection) {
    const raw = path.endsWith('.gz') ? gunzipSync(readFileSync(path)).toString('utf8') : readFileSync(path, 'utf8');
    const json = JSON.parse(raw);
    this.timestamp = json.osm3s?.timestamp_osm_base ?? null;
    for (const e of json.elements) {
      if (e.type === 'node') this.nodes.set(e.id, e);
      else if (e.type === 'way') this.ways.set(e.id, e);
      else if (e.type === 'relation') this.rels.set(e.id, e);
    }
    for (const w of this.ways.values()) {
      for (const n of w.nodes) {
        const arr = this.nodeWays.get(n);
        if (arr) arr.push(w.id);
        else this.nodeWays.set(n, [w.id]);
      }
    }
  }

  xz(nodeId: number): XZ | null {
    const c = this.xzCache.get(nodeId);
    if (c) return c;
    const n = this.nodes.get(nodeId);
    if (!n) return null;
    const p = this.proj.toWorld(n.lat, n.lon);
    const r: XZ = [round2(p.x), round2(p.z)];
    this.xzCache.set(nodeId, r);
    return r;
  }

  wayPts(w: OsmWay): XZ[] {
    const out: XZ[] = [];
    for (const id of w.nodes) {
      const p = this.xz(id);
      if (p) out.push(p);
    }
    return out;
  }

  /** Monta anéis (outer/inner) de uma relação multipolígono unindo ways abertas. */
  multipolygonRings(rel: OsmRel): { outers: XZ[][]; inners: XZ[][] } {
    const collect = (role: string) => {
      const segs: number[][] = [];
      for (const m of rel.members) {
        if (m.type !== 'way') continue;
        if ((m.role || 'outer') !== role) continue;
        const w = this.ways.get(m.ref);
        if (w && w.nodes.length >= 2) segs.push([...w.nodes]);
      }
      return assembleRings(segs).map((ring) => ring.map((id) => this.xz(id)).filter(Boolean) as XZ[]);
    };
    return { outers: collect('outer'), inners: collect('inner') };
  }
}

export function round2(v: number) {
  return Math.round(v * 100) / 100;
}

/** Junta segmentos de ways (listas de ids de nós) em anéis fechados. */
export function assembleRings(segs: number[][]): number[][] {
  const rings: number[][] = [];
  const pool = segs.map((s) => [...s]);
  while (pool.length) {
    let cur = pool.shift()!;
    let guard = 0;
    while (cur[0] !== cur[cur.length - 1] && guard++ < 1000) {
      const end = cur[cur.length - 1];
      const idx = pool.findIndex((s) => s[0] === end || s[s.length - 1] === end);
      if (idx < 0) break;
      const s = pool.splice(idx, 1)[0];
      if (s[0] === end) cur = cur.concat(s.slice(1));
      else cur = cur.concat(s.reverse().slice(1));
    }
    if (cur.length >= 4 && cur[0] === cur[cur.length - 1]) rings.push(cur);
  }
  return rings;
}

export function parseNum(v: string | undefined): number | null {
  if (v == null) return null;
  const m = /-?\d+(\.\d+)?/.exec(v.replace(',', '.'));
  if (!m) return null;
  const n = parseFloat(m[0]);
  return Number.isFinite(n) ? n : null;
}

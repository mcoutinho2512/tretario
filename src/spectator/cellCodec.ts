/**
 * Codificação BINÁRIA de `spec_cells` (rodada 8.1) — servidor → espectador em FAR/AGGREGATE. Puro, compartilhado.
 * JSON do mesmo conteúdo custa ~4× mais (chaves repetidas, números em texto): ver docs/SPECTATOR.md (medição).
 *
 *   cabeçalho  u8 versão · u8 camada (índice em SPEC_TIERS) · u8 flags (bit0 = full) · u32 época · f64 t (ms)
 *              u8 nGrupos + [u8 len + ASCII] (tabela de chaves de grupo DESTA mensagem, ordem lexicográfica)
 *              u16 nCélulas · u16 nRemovidas
 *   célula     i8 cx · i8 cz · u16 jogadores · u16 ambiente · 4×u16 atividade · u8 nG + nG×(u8 índice, u16 contagem)
 *   removida   i8 cx · i8 cz
 * `density` e `seed` NÃO viajam: o cliente recalcula (mesma fórmula, mesma época) — idênticos aos do servidor.
 */
import { CROWD_CELL, SPEC_TIERS, cellSeed, type CrowdCellSnapshot, type SpecCellsMessage, type SpecTier } from './tiers';

export const CELL_WIRE_VERSION = 1;
/** índices de célula cabem em i8 (±128 × 40 m = ±5 km — o mapa tem ±1,25 km) */
export const CELL_INDEX_MAX = 127;

/** chave inteira de 16 bits da célula (ordem: cz, depois cx) */
export const cellKey = (cx: number, cz: number) => ((cz + 128) << 8) | (cx + 128);
export const cellOfKey = (k: number): [number, number] => [(k & 255) - 128, (k >> 8) - 128];
/** célula que contém (x, z) */
export const cellIndex = (v: number, size: number = CROWD_CELL.sizeM) => Math.floor(v / size);
/** pessoas/m² da célula (mesma conta nos dois lados) */
export const cellDensity = (players: number, env: number, size: number = CROWD_CELL.sizeM) => (players + env) / (size * size);

/** bytes de uma célula no fio */
export const cellWireBytes = (c: Pick<CrowdCellSnapshot, 'groups'>) => 15 + Object.keys(c.groups).length * 3;
/** bytes do cabeçalho para uma tabela de grupos */
export const headerWireBytes = (groupKeys: Iterable<string>) => { let n = 20; for (const k of groupKeys) n += 1 + Math.min(32, k.length); return n; };

const u16 = (v: number) => Math.max(0, Math.min(65535, Math.round(v)));

export function encodeCells(m: SpecCellsMessage, epoch: number, t: number): Uint8Array {
  const keys = new Set<string>();
  for (const c of m.cells) for (const g of Object.keys(c.groups)) keys.add(g.slice(0, 32));
  const table = [...keys].sort();
  const gi = new Map(table.map((k, i) => [k, i]));
  let size = headerWireBytes(table);
  for (const c of m.cells) size += cellWireBytes(c);
  size += (m.removed?.length ?? 0) * 2;
  const buf = new Uint8Array(size), dv = new DataView(buf.buffer);
  let o = 0;
  dv.setUint8(o++, CELL_WIRE_VERSION);
  dv.setUint8(o++, Math.max(0, SPEC_TIERS.indexOf(m.tier)));
  dv.setUint8(o++, m.full ? 1 : 0);
  dv.setUint32(o, epoch >>> 0, true); o += 4;
  dv.setFloat64(o, t, true); o += 8;
  dv.setUint8(o++, table.length);
  for (const k of table) { dv.setUint8(o++, k.length); for (let i = 0; i < k.length; i++) dv.setUint8(o++, k.charCodeAt(i) & 127); }
  dv.setUint16(o, m.cells.length, true); o += 2;
  dv.setUint16(o, m.removed?.length ?? 0, true); o += 2;
  for (const c of m.cells) {
    dv.setInt8(o++, c.cx); dv.setInt8(o++, c.cz);
    dv.setUint16(o, u16(c.players), true); o += 2;
    dv.setUint16(o, u16(c.env), true); o += 2;
    for (let a = 0; a < 4; a++) { dv.setUint16(o, u16(c.activity[a]), true); o += 2; }
    const gs = Object.keys(c.groups);
    dv.setUint8(o++, gs.length);
    for (const g of gs) { dv.setUint8(o++, gi.get(g.slice(0, 32))!); dv.setUint16(o, u16(c.groups[g]), true); o += 2; }
  }
  for (const [cx, cz] of m.removed ?? []) { dv.setInt8(o++, cx); dv.setInt8(o++, cz); }
  return buf;
}

/** decodifica (mensagem inválida/curta → null, nunca lança) */
export function decodeCells(buf: Uint8Array, size: number = CROWD_CELL.sizeM): (SpecCellsMessage & { epoch: number; t: number }) | null {
  try {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let o = 0;
    if (dv.getUint8(o++) !== CELL_WIRE_VERSION) return null;
    const tier: SpecTier = SPEC_TIERS[dv.getUint8(o++)] ?? 'NEAR';
    const full = (dv.getUint8(o++) & 1) === 1;
    const epoch = dv.getUint32(o, true); o += 4;
    const t = dv.getFloat64(o, true); o += 8;
    const ng = dv.getUint8(o++);
    const table: string[] = [];
    for (let i = 0; i < ng; i++) { const n = dv.getUint8(o++); let s = ''; for (let j = 0; j < n; j++) s += String.fromCharCode(dv.getUint8(o++)); table.push(s); }
    const nc = dv.getUint16(o, true); o += 2;
    const nr = dv.getUint16(o, true); o += 2;
    const cells: CrowdCellSnapshot[] = [];
    for (let i = 0; i < nc; i++) {
      const cx = dv.getInt8(o++), cz = dv.getInt8(o++);
      const players = dv.getUint16(o, true); o += 2;
      const env = dv.getUint16(o, true); o += 2;
      const activity: [number, number, number, number] = [0, 0, 0, 0];
      for (let a = 0; a < 4; a++) { activity[a] = dv.getUint16(o, true); o += 2; }
      const k = dv.getUint8(o++);
      const groups: Record<string, number> = {};
      for (let j = 0; j < k; j++) { const g = table[dv.getUint8(o++)] ?? ''; groups[g] = dv.getUint16(o, true); o += 2; }
      cells.push({ cx, cz, players, env, groups, activity, density: cellDensity(players, env, size), seed: cellSeed(cx, cz, epoch), t });
    }
    const removed: [number, number][] = [];
    for (let i = 0; i < nr; i++) removed.push([dv.getInt8(o++), dv.getInt8(o++)]);
    return { tier, cells, removed, full, epoch, t };
  } catch { return null; }
}

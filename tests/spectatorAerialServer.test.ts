/**
 * Espectador AÉREO no servidor REAL (rodada 8.1): 500 bots ao longo da avenida (Central → Candelária), clientes do
 * SDK mandando mensagens cruas. No alto (alt 250 → AGGREGATE) o espectador recebe `spec_cells` (células agregadas),
 * NÃO as 500 entidades; dois espectadores recebem as mesmas células; descer (alt baixa) volta a NEAR com entidades;
 * o jogador normal nunca recebe spec_cells e continua com o mesmo AOI (limite AOI_MAX). PV_SKIP_NET_TESTS=1 pula.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { Client, type Room } from '@colyseus/sdk';
import { decodeCells } from '../src/spectator/cellCodec';
import { CROWD_CELL, type CrowdCellSnapshot, type SpecTier } from '../src/spectator/tiers';
import { pointOnAxis } from '../src/world/zones';
import { freePortBlock } from './fixtures/freePort';

const PORT = await freePortBlock(2);
const EP = `ws://127.0.0.1:${PORT}`;
const w = (ms: number) => new Promise((r) => setTimeout(r, ms));
const APP = { body: 'homem', skin: 1, hair: 1, top: 1, bottom: 1, shoes: 1 };
const QUIET = ['crowd', 'gf', 'gf_add', 'gf_del', 'gf_state', 'gf_res', 'pong', 'spawn', 'correct', 'chat_hello', 'chat', 'presence'];
const skip = process.env.PV_SKIP_NET_TESTS === '1';
const N = 500;
const axis: [number, number][] = JSON.parse(readFileSync('public/world/manifest.json', 'utf8')).pvAxis;
const GROUPS = ['grupo-13', 'grupo-22', 'neutro'];

let srv: ChildProcess | null = null;
const rooms: Room[] = [];
async function join(o: Record<string, unknown>): Promise<Room> {
  const r = await new Client(EP).joinOrCreate('presidente_vargas', { ...APP, ...o });
  for (const t of QUIET) r.onMessage(t, () => {});
  rooms.push(r);
  return r;
}
/** espectador que guarda as células como o cliente (full apaga; delta aplica; removidas saem) */
function watch(r: Room) {
  const st = { cells: new Map<string, CrowdCellSnapshot>(), tier: 'NEAR' as SpecTier, msgs: 0, bytes: 0, fulls: 0, log: [] as { t: number; b: number }[] };
  r.onMessage('spec_cells', (b: Uint8Array) => {
    const buf = b instanceof Uint8Array ? b : new Uint8Array(b as ArrayBuffer);
    const m = decodeCells(buf)!;
    st.msgs++; st.bytes += buf.byteLength; st.log.push({ t: Date.now(), b: buf.byteLength });
    if (m.full) { st.cells.clear(); st.fulls++; }
    st.tier = m.tier;
    for (const [cx, cz] of m.removed ?? []) st.cells.delete(`${cx},${cz}`);
    for (const c of m.cells) st.cells.set(`${c.cx},${c.cz}`, c);
  });
  return st;
}
const sum = (m: Map<string, CrowdCellSnapshot>, k: 'players' | 'env') => [...m.values()].reduce((a, c) => a + c[k], 0);
const canon = (m: Map<string, CrowdCellSnapshot>) => JSON.stringify([...m.entries()].sort().map(([k, c]) => [k, c.players, c.env, c.groups, c.activity, c.seed]));

describe.skipIf(skip)('espectador aéreo — servidor real com 500 bots', () => {
  beforeAll(async () => {
    srv = spawn('npx', ['tsx', 'src/index.ts'], { cwd: 'server', env: { ...process.env, PORT: String(PORT), PV_TEST: '1', PV_STORE: 'memory', PV_GRAFFITI_STORE: 'memory', DATABASE_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let ready = false;
    srv.stdout!.on('data', (d) => { if (String(d).includes('[pv3d-server]')) ready = true; });
    srv.stderr!.on('data', () => {});
    for (let i = 0; i < 150 && !ready; i++) await w(100);
    if (!ready) throw new Error('servidor de teste não subiu');
    // 500 bots parados ao longo do eixo, do trecho da Central (t 0,18) à Candelária (t 1), em lotes paralelos
    for (let b = 0; b < N; b += 50) {
      await Promise.all(Array.from({ length: Math.min(50, N - b) }, (_, j) => {
        const i = b + j, p = pointOnAxis(axis, 0.18 + (i / N) * 0.82, ((i * 7) % 24) - 12);
        return join({ name: `bot${i}`, bot: true, testGroup: GROUPS[i % 3], testSpawn: { x: p.x, z: p.z } });
      }));
    }
  }, 120_000);
  afterAll(async () => {
    await Promise.race([Promise.allSettled(rooms.map((r) => r.leave())), w(3000)]);
    if (srv?.pid) { try { process.kill(-srv.pid, 'SIGTERM'); } catch { /* */ } }
  });

  it('no alto: spec_cells (não 500 entidades), iguais para dois espectadores, dentro do teto; jogador não recebe nada novo', async () => {
    const cen = pointOnAxis(axis, 0.28), cand = pointOnAxis(axis, 0.954), mid = pointOnAxis(axis, 0.6);
    const P = await join({ name: 'P', testSpawn: { x: cen.x, z: cen.z } });
    let pCells = 0;
    P.onMessage('spec_cells', () => { pCells++; });
    await w(1500);
    const pSt = P.state as { players: Map<string, unknown> };
    const pBefore = pSt.players.size;
    expect(pBefore).toBeGreaterThan(10);
    expect(pBefore).toBeLessThanOrEqual(48 + 1); // AOI_MAX dos mais próximos + ele mesmo
    const S1 = await join({ role: 'spectator', specCam: { x: mid.x, z: mid.z, alt: 250 } });
    const S2 = await join({ role: 'spectator', specCam: { x: mid.x, z: mid.z, alt: 250 } });
    const a = watch(S1), b = watch(S2);
    // batimento como o cliente (spec_cam com alt) — mantém AGGREGATE
    const beat = setInterval(() => { for (const S of [S1, S2]) S.send('spec_cam', { x: mid.x, z: mid.z, alt: 250 }); }, 1000);
    await w(3600);
    const s1St = S1.state as { players: Map<string, unknown>; vehicles: Map<string, { kind: string }> };
    expect(a.tier).toBe('AGGREGATE');
    expect(a.fulls).toBeGreaterThanOrEqual(1);
    expect(s1St.players.size).toBe(0); // nenhuma entidade completa
    expect(sum(a.cells, 'players')).toBe(N + 1); // 500 bots + P, contados nas células
    expect(sum(a.cells, 'env')).toBeGreaterThan(0); // multidão de ambiente separada
    expect([...s1St.vehicles.values()].some((v) => v.kind === 'trio')).toBe(true); // o trio marca a passeata
    // grupos: os três presentes, nenhum com vantagem (mesma contagem ±1)
    const g: Record<string, number> = {};
    for (const c of a.cells.values()) for (const [k, v] of Object.entries(c.groups)) g[k] = (g[k] ?? 0) + v;
    expect(Math.max(g['grupo-13'], g['grupo-22'], g.neutro) - Math.min(g['grupo-13'], g['grupo-22'], g.neutro)).toBeLessThanOrEqual(1);
    expect(canon(a.cells)).toBe(canon(b.cells)); // dois espectadores: mesmas células, mesmas seeds
    // teto: bytes por janela de 1 s
    const t0 = a.log[0].t;
    const perSec = new Map<number, number>();
    for (const e of a.log) perSec.set(Math.floor((e.t - t0) / 1000), (perSec.get(Math.floor((e.t - t0) / 1000)) ?? 0) + e.b);
    expect(Math.max(...perSec.values())).toBeLessThanOrEqual(CROWD_CELL.maxBytesPerSec);
    // jogador: nenhuma spec_cells, mesmo AOI
    expect(pCells).toBe(0);
    expect(Math.abs(pSt.players.size - pBefore)).toBeLessThanOrEqual(1);

    // S1 desce na Candelária (alt 20 → NEAR): células apagadas, entidades aparecem
    clearInterval(beat);
    S1.send('spec_cam', { x: cand.x, z: cand.z, alt: 20 });
    await w(1500);
    expect(a.tier).toBe('NEAR');
    expect(a.cells.size).toBe(0);
    expect(s1St.players.size).toBeGreaterThan(5);
    expect(s1St.players.size).toBeLessThanOrEqual(48);
    // FAR (alt 130) na Candelária: só células perto do foco + AOI mínimo
    await w(250);
    S1.send('spec_cam', { x: cand.x, z: cand.z, alt: 130 });
    await w(1800);
    expect(a.tier).toBe('FAR');
    for (const c of a.cells.values()) expect(Math.hypot((c.cx + 0.5) * 40 - cand.x, (c.cz + 0.5) * 40 - cand.z)).toBeLessThanOrEqual(CROWD_CELL.farRadiusM + 40);
    expect(a.cells.size).toBeGreaterThan(0);
    expect(a.cells.size).toBeLessThan(b.cells.size);
    expect(pCells).toBe(0);
  }, 60_000);
});

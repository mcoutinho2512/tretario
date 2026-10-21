/**
 * Pedido do dono (20/10/2026): o jogo começa EM FRENTE À CANDELÁRIA e 95 % dos personagens autônomos vivem perto dela.
 * Mapa real (loadWorld): ponto de entrada na praça da fachada, virado para a igreja, fora de parede; população inicial
 * com ≥ 93 % a ≤ 150 m da igreja e ninguém dentro do prédio; depois de 3 min com um humano na entrada, ≥ 93 % a ≤ 200 m
 * (os pontos de concentração do evento ali ficam a 150–180 m); um humano LONGE (Central) recebe só gente que não vive no foco.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { AutonomousSystem } from '../server/src/autonomous/AutonomousSystem';
import { SimHost, manifestHotspots } from '../server/src/autonomous/simHost';
import { candelariaArea, gameSpawn } from '../src/world/gameSpawn';

// o mundo do servidor usa imports com extensão .ts: carregado dinamicamente (como tests/dynamicCalibration.test.ts)
let W: any, m: any, axis: [number, number][], area: NonNullable<ReturnType<typeof candelariaArea>>, church: any;
beforeAll(async () => {
  const { loadWorld } = await import(/* @vite-ignore */ `../server/src/${'world.ts'}`);
  W = loadWorld(); m = W.manifest; axis = (m.pvAxis ?? []) as [number, number][]; area = candelariaArea(m)!;
  church = m.landmarks.find((l: any) => l.key === 'LANDMARK_CANDELARIA');
});
const R = 150;

function world(n = 180) {
  const host = new SimHost({ walls: W.walls, bounds: m.bounds, axis, hotspots: manifestHotspots({ ...m, spawn: gameSpawn(m) }) });
  const sys = new AutonomousSystem(host, { population: n, seed: 11, focus: { ...area.center, anchors: area.anchors, radiusM: R, share: 0.95 } });
  host.sys = sys;
  return { host, sys, run: (ticks: number) => { for (let k = 0; k < ticks; k++) { host.advance(100); sys.tick(100); } } };
}
const inFocus = (x: number, z: number) => Math.hypot(x - area.center.x, z - area.center.z) <= R;
/** "perto da Candelária" ao longo do tempo: até 200 m da igreja (os pontos de concentração do evento ali ficam a 150–180 m) */
const near = (x: number, z: number) => Math.hypot(x - area.center.x, z - area.center.z) <= 200;

describe('entrada em frente à Candelária e 95 % dos autônomos perto dela', () => {
  it('ponto de entrada: praça da fachada, olhando para a igreja, longe de parede', () => {
    const g = gameSpawn(m);
    const d = Math.hypot(g.p[0] - church.center[0], g.p[1] - church.center[1]);
    expect(d).toBeGreaterThan(church.length / 2);
    expect(d).toBeLessThan(120);
    expect(Math.cos(g.yaw) * (church.center[0] - g.p[0]) + Math.sin(g.yaw) * (church.center[1] - g.p[1])).toBeGreaterThan(0);
    // anda 3 m para a frente e para os lados sem bater em parede
    for (const a of [0, Math.PI / 2, -Math.PI / 2, Math.PI]) expect(W.walls.raycast(g.p[0], 0.6, g.p[1], g.p[0] + Math.cos(g.yaw + a) * 3, 0.6, g.p[1] + Math.sin(g.yaw + a) * 3)).toBeGreaterThanOrEqual(1);
  });

  it('população inicial: ≥ 93 % no foco, nenhum dentro da igreja', () => {
    const { sys } = world();
    const pts = sys.list().map((a) => ({ x: a.x, z: a.z }));
    const share = pts.filter((p) => inFocus(p.x, p.z)).length / pts.length;
    expect(share).toBeGreaterThanOrEqual(0.93);
    // dentro do prédio = sem linha livre para nenhum ponto aberto da região
    const inside = pts.filter((p) => inFocus(p.x, p.z) && !area.anchors.some((q) => W.walls.raycast(q.x, 0.6, q.z, p.x, 0.6, p.z) >= 1));
    expect(inside).toEqual([]);
  });

  it('com um humano na entrada, 3 min depois ≥ 93 % a ≤ 200 m da igreja; humano longe só recebe quem não vive no foco', () => {
    const { host, sys, run } = world();
    const g = gameSpawn(m);
    host.addHuman('h1', g.p[0], g.p[1]);
    run(1800);
    const all = sys.list();
    expect(all.filter((a) => near(a.x, a.z)).length / all.length).toBeGreaterThanOrEqual(0.93);
    const central = m.landmarks.find((l: any) => l.key === 'LANDMARK_CENTRAL');
    host.addHuman('h2', central.center[0] + 60, central.center[1] + 60);
    run(600);
    const nearFar = sys.list().filter((a) => a.materialized && Math.hypot(a.x - central.center[0] - 60, a.z - central.center[1] - 60) < 80);
    expect(nearFar.length).toBeLessThanOrEqual(Math.ceil(180 * 0.05) + 1);
    expect(sys.list().filter((a) => near(a.x, a.z)).length / 180).toBeGreaterThanOrEqual(0.9);
  }, 60_000);
});

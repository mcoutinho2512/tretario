/**
 * Mundo compartilhado: o servidor simula o trânsito; o cliente aplica snapshots compactos e extrapola
 * com o MESMO código — a divergência entre snapshots deve ser pequena.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { TrafficSim } from '../src/traffic/TrafficSim';
import { SignalController } from '../src/traffic/SignalController';
import type { WorldManifest, TrafficData } from '../src/world/types';

const manifest = JSON.parse(readFileSync('public/world/manifest.json', 'utf8')) as WorldManifest;
const data = JSON.parse(readFileSync(`public/world/${manifest.traffic}`, 'utf8')) as TrafficData;

function server(seed = 42) {
  const sig = new SignalController(data.junctions);
  sig.setTime(1_700_000_000);
  const sim = new TrafficSim(data.lanes, seed);
  sim.signals = (j, ph) => sig.state(j, ph);
  sim.populateGlobal(150);
  return { sim, sig };
}

describe('trânsito compartilhado (servidor → cliente)', () => {
  it('mesma semente → mesma população global (determinístico)', () => {
    const a = server(7).sim, b = server(7).sim;
    expect(a.vehicles.length).toBe(150);
    expect(a.vehicles.map((v) => `${v.id}:${v.lane.id}:${v.s.toFixed(2)}`)).toEqual(b.vehicles.map((v) => `${v.id}:${v.lane.id}:${v.s.toFixed(2)}`));
  });

  it('snapshot binário: 12 bytes/veículo e ida-e-volta fiel', () => {
    const { sim } = server();
    const p = sim.vehicles[0];
    const buf = sim.packAround(p.x, p.z, 400);
    expect(buf.byteLength % TrafficSim.BYTES).toBe(0);
    expect(buf.byteLength / TrafficSim.BYTES).toBeGreaterThan(5);
    const client = new TrafficSim(data.lanes, 1);
    client.applySnapshot(buf);
    for (const cv of client.vehicles) {
      const sv = sim.vehicles.find((v) => v.id === cv.id)!;
      expect(cv.lane.id).toBe(sv.lane.id);
      expect(Math.abs(cv.s - sv.s)).toBeLessThan(0.06);
      expect(Math.hypot(cv.x - sv.x, cv.z - sv.z)).toBeLessThan(0.1);
    }
  });

  it('cliente extrapola 0,5 s entre snapshots com erro pequeno (mesmo código, mesmos semáforos)', () => {
    const { sim, sig } = server();
    const p = sim.vehicles[0];
    const client = new TrafficSim(data.lanes, 1);
    client.signals = (j, ph) => sig.state(j, ph);
    const errs: number[] = [];
    for (let k = 0; k < 20; k++) {
      client.applySnapshot(sim.packAround(p.x, p.z, 400));
      for (let i = 0; i < 5; i++) { sim.step(0.1, [], true); client.step(0.1, [], false); sig.setTime(sig.time + 0.1); }
      for (const cv of client.vehicles) {
        const sv = sim.vehicles.find((v) => v.id === cv.id);
        if (sv) errs.push(Math.hypot(cv.x - sv.x, cv.z - sv.z));
      }
    }
    errs.sort((a, b) => a - b);
    const median = errs[Math.floor(errs.length / 2)], p95 = errs[Math.floor(errs.length * 0.95)];
    expect(median).toBeLessThan(0.5);
    expect(p95).toBeLessThan(5);
  });

  it('área de interesse: snapshot só inclui veículos no raio', () => {
    const { sim } = server();
    const p = sim.vehicles[0];
    const near = sim.packAround(p.x, p.z, 100).byteLength / TrafficSim.BYTES;
    const all = sim.packAround(p.x, p.z, 5000).byteLength / TrafficSim.BYTES;
    expect(near).toBeLessThan(all);
    expect(all).toBe(150);
  });
});

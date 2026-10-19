/**
 * Rodada 12 — PERSONAGENS AUTÔNOMOS (server/src/autonomous) sem rede: SimHost com as MESMAS regras puras da sala
 * (validateMove, validateAction, canEnter e o CombatSystem de verdade). Nomes sem padrão robótico e sem colisão;
 * decisões distribuídas; LOD e orçamentos; rodas de conversa; reação a humano perto; `propose` pela personalidade;
 * veículo pelo caminho de entrar/sair; confronto dentro das regras (nunca spam); heat(); métricas de humanização.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { AutonomousSystem } from '../server/src/autonomous/AutonomousSystem';
import { SimHost } from '../server/src/autonomous/simHost';
import { parseAutonomousConfig } from '../server/src/autonomous/config';
import { NameGenerator, ROBOTIC, autonomousNicknameTaken, nicknameKey } from '../server/src/autonomous/names';
import { Rng } from '../server/src/autonomous/rng';
import { textModeration } from '../src/moderation/text';
import { steer, makeKin } from '../server/src/autonomous/steering';
import { ENTITY_KIND, isHuman } from '../src/world/entityKind';
import type { Personality } from '../server/src/autonomous/types';

const RAW = JSON.parse(readFileSync('public/gameplay/autonomous.json', 'utf8'));
const cfgWith = (patch: (r: any) => void) => { const r = structuredClone(RAW); patch(r); return parseAutonomousConfig(r); };
const only = (p: Personality) => cfgWith((r) => { r.personalities = { [p]: 1 }; });

function world(n: number, opts: { config?: ReturnType<typeof parseAutonomousConfig>; seed?: number; vehicles?: { id: string; kind: string; x: number; z: number; heading: number }[] } = {}) {
  const host = new SimHost({ vehicles: opts.vehicles });
  const sys = new AutonomousSystem(host, { population: n, seed: opts.seed ?? 7, config: opts.config });
  host.sys = sys;
  const run = (ticks: number, each?: (k: number) => void) => { for (let k = 0; k < ticks; k++) { host.advance(100); sys.tick(100); each?.(k); } };
  return { host, sys, run };
}
/** espalha os autônomos num quadrado perto da origem */
const scatter = (sys: AutonomousSystem, side = 30) => { for (const a of sys.agents) sys.place(a.id, ((a.idx * 7.3) % side) - side / 2, ((a.idx * 3.7) % side) - side / 2); };

describe('rodada 12 — autônomos: tipo de entidade', () => {
  it('kind: 0 humano · 1 autônomo · 2 bot de carga; só humano conta como jogador', () => {
    expect(ENTITY_KIND).toEqual({ HUMAN: 0, AUTONOMOUS: 1, LOAD_BOT: 2 });
    expect(isHuman(0)).toBe(true); expect(isHuman(1)).toBe(false); expect(isHuman(2)).toBe(false); expect(isHuman(undefined)).toBe(true);
  });
});

describe('rodada 12 — autônomos: apelidos', () => {
  it('variados, moderados, sem série robótica, sem números vizinhos na mesma base e sem colidir com humanos', () => {
    const humans = new Set(['carioca021', 'lapa77', 'mengaoraiz']);
    const g = new NameGenerator(parseAutonomousConfig(RAW).names, new Rng(99), (k) => humans.has(k));
    const names = Array.from({ length: 300 }, () => g.next());
    const keys = names.map(nicknameKey);
    expect(new Set(keys).size).toBe(names.length); // nenhum repetido
    for (const n of names) {
      expect(textModeration.check(n, 'nickname')).toEqual({ ok: true, text: n });
      expect(ROBOTIC.test(n), n).toBe(false);
      expect(humans.has(nicknameKey(n))).toBe(false);
    }
    // série X01, X02… : nenhuma base com dois números consecutivos
    const byBase = new Map<string, number[]>();
    for (const n of names) { const m = /^([a-zA-Z]+)_?(\d+)$/.exec(n); if (m) { const b = m[1].toLowerCase(); byBase.set(b, [...(byBase.get(b) ?? []), Number(m[2])]); } }
    for (const [b, nums] of byBase) { const s = [...nums].sort((x, y) => x - y); for (let i = 1; i < s.length; i++) expect(s[i] - s[i - 1], `${b}: ${s}`).toBeGreaterThan(1); }
    // estilos variados (com e sem número, minúsculas, sublinhado)
    expect(names.some((n) => /\d/.test(n))).toBe(true);
    expect(names.some((n) => !/\d/.test(n))).toBe(true);
    expect(names.some((n) => n === n.toLowerCase())).toBe(true);
    // nenhum nome completo realista (duas palavras com espaço)
    expect(names.some((n) => /\s/.test(n))).toBe(false);
  });

  it('apelidos dos autônomos vivos ficam reservados (cadastro de conta recusa) e são liberados ao descartar', () => {
    const { sys } = world(5);
    const k = nicknameKey(sys.list()[0].name);
    expect(autonomousNicknameTaken(k)).toBe(true);
    sys.dispose();
    expect(autonomousNicknameTaken(k)).toBe(false);
  });
});

describe('rodada 12 — autônomos: decisões e LOD', () => {
  it('decisões distribuídas no tempo: nunca todos no mesmo tick; ritmo pelo LOD', () => {
    const { host, sys, run } = world(100);
    host.addHuman('h', 0, 0);
    scatter(sys, 50);
    const perTick: number[] = [];
    run(600, () => { perTick.push(sys.takeCost().decisions); });
    const steady = perTick.slice(100);
    expect(Math.max(...steady)).toBeLessThanOrEqual(25);
    const mean = steady.reduce((s, x) => s + x, 0) / steady.length;
    expect(mean).toBeGreaterThan(1); // todos pensam…
    expect(mean).toBeLessThan(12); // …cada um na sua hora
    expect(sys.stats.walkStartsMaxSteady).toBeLessThanOrEqual(6);
    expect(sys.stats.sameActSameTick / Math.max(1, sys.stats.actStarts)).toBeLessThan(0.15);
  });

  it('LOD pela distância ao humano mais próximo, com orçamentos (NEAR/MID máximos) e DORMANT sem entidade', () => {
    const cfg = cfgWith((r) => { r.population.near.max = 5; r.population.mid.max = 10; });
    const { host, sys, run } = world(40, { config: cfg });
    host.addHuman('h', 0, 0);
    sys.agents.forEach((a, i) => sys.place(a.id, i < 20 ? 3 + i : i < 30 ? 100 + i : 600 + i, 0));
    run(6);
    expect(sys.lodCount.NEAR).toBe(5);
    expect(sys.lodCount.MID).toBe(10);
    expect(sys.lodCount.FAR).toBe(15); // 5 dos perto passam para FAR pelo orçamento + os 10 a ~100 m
    expect(sys.lodCount.DORMANT).toBe(10); // a 600 m: fora do estado sincronizado
    const far = sys.list().filter((a) => !a.materialized);
    expect(far.every((a) => !host.ents.has(a.id))).toBe(true);
    // ninguém perto de humano nenhum → tudo dorme (custo zero)
    host.despawn('h');
    run(6);
    expect(sys.active).toBe(0);
  });

  it('população alvo diminui com muitos humanos (perHumanReduction), nunca abaixo de minActive', () => {
    const { sys } = world(220);
    expect(sys.targetActive(0)).toBe(220);
    expect(sys.targetActive(10)).toBe(220 - 30);
    expect(sys.targetActive(500)).toBe(60);
  });
});

describe('rodada 12 — autônomos: movimento e social', () => {
  it('steering: acelera, desvia de quem vem de frente sem zig-zag e espera quando bloqueado', () => {
    const k = makeKin(0, 0, 0);
    const p = { cruise: 1.4, accel: 1.4, decel: 2.6, turnRate: 3, space: 0.9, arriveR: 0.5, dt: 0.1, now: 0, selfId: 'a' };
    const xs: number[] = [];
    for (let i = 0; i < 80; i++) {
      const o = { id: 'b', x: 0.05, z: 6 - i * 0.12, r: 0.32, vx: 0, vz: -1.2 };
      const out = steer(k, 0, 20, { ...p, now: i * 100 }, [o]);
      k.x = out.x; k.z = out.z; xs.push(k.x);
    }
    expect(k.speed).toBeGreaterThan(1);
    expect(Math.max(...xs.map(Math.abs))).toBeGreaterThan(0.3); // desviou
    // sem zig-zag: o lado do desvio não troca
    const signs = xs.filter((x) => Math.abs(x) > 0.05).map(Math.sign);
    expect(new Set(signs).size).toBe(1);
  });

  it('rodas de conversa de 2–5, em círculo (de frente uns para os outros), com quem fala gesticulando', () => {
    const { host, sys, run } = world(30, { config: only('SOCIAL') });
    host.addHuman('h', 0, -25);
    scatter(sys, 24);
    run(900);
    const gs = sys.groupsInfo().filter((g) => !g.walking);
    expect(gs.length).toBeGreaterThan(0);
    for (const g of gs) { expect(g.n).toBeGreaterThanOrEqual(2); expect(g.n).toBeLessThanOrEqual(5); }
    // espalhamento dos rumos: todos virados igual seria ~0
    const spread = gs.map((g) => 1 - Math.hypot(g.headings.reduce((s, h) => s + Math.sin(h), 0) / g.n, g.headings.reduce((s, h) => s + Math.cos(h), 0) / g.n));
    expect(Math.max(...spread)).toBeGreaterThan(0.5);
    expect(sys.stats.timeMs.social).toBeGreaterThan(0);
    expect(host.log.acts).toBeGreaterThan(0);
  });

  it('reage a humano perto: olha (look) e às vezes acena — sem perseguir', () => {
    const { host, sys, run } = world(12, { config: only('CURIOSO') });
    const h = host.addHuman('h', 0, 0);
    sys.agents.forEach((a, i) => sys.place(a.id, Math.cos(i) * 4, Math.sin(i) * 4));
    run(150);
    const lookers = [...host.ents.values()].filter((e) => !e.human && e.look_ === h.nid);
    expect(lookers.length).toBeGreaterThan(0);
    // ninguém briga com quem não fez nada
    expect(host.cs.stats.requests).toBe(0);
  });
});

describe('rodada 12 — autônomos: diretor de eventos (propose) e confronto', () => {
  it('propose aceita/recusa pela personalidade; JOIN_FIGHT contra HUMANO sem motivo é sempre recusado', () => {
    const rate = (p: Personality) => {
      const { host, sys, run } = world(60, { config: only(p), seed: 3 });
      host.addHuman('h', 0, 0);
      scatter(sys, 10);
      run(10);
      let ok = 0;
      const ids = sys.list().filter((a) => a.materialized).map((a) => a.id);
      for (let i = 0; i < ids.length - 1; i += 2) if (sys.propose(ids[i], { kind: 'JOIN_FIGHT', target: ids[i + 1], until: host.t + 20_000 }, 1)) ok++;
      const human = sys.propose(ids[ids.length - 1], { kind: 'JOIN_FIGHT', target: 'h', until: host.t + 20_000 }, 1);
      return { r: ok / Math.floor(ids.length / 2), human };
    };
    const conf = rate('CONFRONTADOR'), caut = rate('CAUTELOSO');
    expect(conf.r).toBeGreaterThan(caut.r + 0.2);
    expect(conf.human).toBe(false); expect(caut.human).toBe(false);
  });

  it('autônomo usa veículo do mundo pelo caminho de entrar/sair (canEnter) e devolve ao sair', () => {
    const veh = [{ id: 'bk1', kind: 'bicycle', x: 2, z: 0, heading: 0 }];
    const { host, sys, run } = world(3, { vehicles: veh, config: only('EXPLORADOR') });
    host.addHuman('h', 0, 10);
    sys.agents.forEach((a, i) => sys.place(a.id, 0, -i * 2));
    run(5);
    sys.force(sys.agents[0].id, 'USE_VEHICLE');
    let rode = false;
    run(100, () => { if (host.vehicles.get('bk1')!.occupant === sys.agents[0].id) rode = true; });
    expect(rode).toBe(true);
    expect(host.log.enters).toBeGreaterThan(0);
    // outro objetivo: desce pelo MESMO caminho (exit) e o veículo volta a ficar livre
    sys.force(sys.agents[0].id, 'WANDER');
    run(5);
    expect(host.vehicles.get('bk1')!.occupant).toBe('');
    expect(host.log.exits).toBeGreaterThan(0);
  });

  it('briga pelas regras do CombatSystem: aceitos, nunca spam, com pausa humana; heat() mede golpes e combatentes', () => {
    const { host, sys, run } = world(2, { config: only('CONFRONTADOR') });
    host.addHuman('h', 0, 12);
    sys.place(sys.agents[0].id, 0, 0); sys.place(sys.agents[1].id, 0.9, 0);
    run(5);
    const times: Record<string, number[]> = {};
    const orig = host.combat.bind(host);
    host.combat = (id, a, h) => { const ok = orig(id, a, h); if (ok) (times[id] ??= []).push(host.t); return ok; };
    sys.force(sys.agents[0].id, 'JOIN_FIGHT', { target: sys.agents[1].id });
    sys.force(sys.agents[1].id, 'JOIN_FIGHT', { target: sys.agents[0].id });
    run(80);
    const heat = sys.heat(0.5, 0, 10);
    expect(heat.combatants).toBeGreaterThanOrEqual(2);
    expect(heat.hitsPerMin).toBeGreaterThan(0);
    run(120);
    expect(host.cs.stats.accepted).toBeGreaterThan(2);
    expect(host.cs.stats.denied.spam ?? 0).toBe(0);
    for (const ts of Object.values(times)) for (let i = 1; i < ts.length; i++) expect(ts[i] - ts[i - 1]).toBeGreaterThanOrEqual(250);
  });

  it('humano agride: o alvo reage (revida, foge ou reclama) e nunca persegue quem foi embora', () => {
    const { host, sys, run } = world(1, { config: only('CONFRONTADOR') });
    const h = host.addHuman('h', 0, 0);
    sys.place(sys.agents[0].id, 0.9, 0);
    run(30);
    const e = host.ents.get(sys.agents[0].id)!;
    h.x = e.x - 0.9; h.z = e.z; h.last = { x: h.x, y: 0, z: h.z, t: host.t };
    expect(host.humanAttack('h', 1, Math.PI / 2)).toBe(true);
    run(40);
    expect(['JOIN_FIGHT', 'AVOID_FIGHT', 'IDLE']).toContain(sys.debug(sys.agents[0].id)!.goal);
    // o humano vai embora: a briga acaba (sem perseguição)
    host.moveHuman('h', 40, 40);
    run(30);
    expect(sys.debug(sys.agents[0].id)!.fight).toBeNull();
  });
});

describe('rodada 12 — autônomos: humanização no mundo real (paredes/eixo do manifesto + diretor de eventos)', () => {
  it('sem padrões robóticos (fase, velocidade, zig-zag, rodas, paredes) em 2 min simulados', async () => {
    const { runHumanization } = await import(/* @vite-ignore */ `../server/src/autonomous/${'report.ts'}`) as { runHumanization(o: Record<string, unknown>): { robotic: { ok: boolean }[]; activityPct: Record<string, number> } };
    const r = runHumanization({ agents: 60, minutes: 2, humans: 4, seed: 21 });
    expect(r.robotic.filter((c) => !c.ok)).toEqual([]);
    expect(r.activityPct.walk).toBeGreaterThan(10);
    expect(r.activityPct.social + r.activityPct.event).toBeGreaterThan(15);
  }, 30_000);
});

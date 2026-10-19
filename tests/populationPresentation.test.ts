/**
 * Rodada 12 (agente D) — apresentação da população no cliente: LOD/seleção/oclusão dos nomes, variedade de animação
 * determinística por id, olhar com limites, painel da pessoa para autônomos, contagem pública só de humanos, marca do
 * minimapa e áudio dos eventos dinâmicos.
 */
import { describe, expect, it } from 'vitest';
import { NAME_LOD, OcclusionCache, autonomousTagged, midBandCount, nameTier, npcRanges, rayBlocks, selectNames, type NameCandidate } from '../src/net/nameLod';
import { animVariant, loopPhase, personSeed, seedUnit } from '../src/characters/crowd/animVariety';
import { createAgent, setAgentSeed } from '../src/characters/crowd/crowdBudget';
import { LOOK_LIMITS, lookAngles } from '../src/characters/human/HumanAnimator';
import { personActions, personProfileRows, personSubtitle } from '../src/ui/PersonPanel';
import { countHumans } from '../src/net/population';
import { metricsLine } from '../src/ui/metricsText';
import { CrowdTable, decodeCrowd, encodeCrowd } from '../src/net/crowdCodec';
import { dynamicEventAudio, dynamicEventMark, normalizeDynamicEvents } from '../src/events/dynamicPresentation';

const cand = (o: Partial<NameCandidate> = {}): NameCandidate => ({ key: 0, dist: 5, nx: 0, ny: 0, front: true, interacting: false, prev: 'hidden', ...o });

describe('nomes — LOD (puro)', () => {
  it('autônomo: completo até 18 m, médio até 35 m, nada além; sem nome = nunca', () => {
    expect(nameTier(cand({ kind: 1, dist: 17 }), 'PROXIMOS')).toBe('full');
    expect(nameTier(cand({ kind: 1, dist: 25 }), 'PROXIMOS')).toBe('short');
    expect(nameTier(cand({ kind: 1, dist: 40, interacting: true }), 'TODOS')).toBe('hidden');
    expect(nameTier(cand({ kind: 1, dist: 3, tagged: false }), 'TODOS')).toBe('hidden');
    expect(nameTier(cand({ kind: 1, dist: 3, tagged: false, focus: true }), 'TODOS')).toBe('hidden');
    // humano mantém as faixas da rodada 8
    expect(nameTier(cand({ dist: 17 }), 'PROXIMOS')).toBe('short');
    expect(nameTier(cand({ dist: 40, nx: 0.05 }), 'PROXIMOS')).toBe('short');
  });
  it('foco (hover/seleção) mostra completo na faixa média/longe; NENHUM e fora da tela continuam escondidos', () => {
    expect(nameTier(cand({ dist: 25, focus: true }), 'PROXIMOS')).toBe('full');
    expect(nameTier(cand({ dist: 45, nx: 0.8, focus: true }), 'PROXIMOS')).toBe('full');
    expect(nameTier(cand({ kind: 1, dist: 30, focus: true }), 'PROXIMOS')).toBe('full');
    expect(nameTier(cand({ dist: 5, focus: true }), 'NENHUM')).toBe('hidden');
    expect(nameTier(cand({ dist: 5, focus: true, front: false }), 'TODOS')).toBe('hidden');
  });
  it('densidade: faixa média lotada → só centro da tela / interagindo / foco (PRÓXIMOS)', () => {
    const ctx = { crowded: true };
    expect(nameTier(cand({ dist: 20, nx: 0.7 }), 'PROXIMOS', ctx)).toBe('hidden');
    expect(nameTier(cand({ dist: 20, nx: 0.05 }), 'PROXIMOS', ctx)).toBe('short');
    expect(nameTier(cand({ dist: 20, nx: 0.7, interacting: true }), 'PROXIMOS', ctx)).toBe('short');
    expect(nameTier(cand({ dist: 20, nx: 0.7 }), 'TODOS', ctx)).toBe('short');
    expect(nameTier(cand({ dist: 5, nx: 0.7 }), 'PROXIMOS', ctx)).toBe('full'); // perto sempre
  });
  it('midBandCount conta só a faixa média (autônomo sem nome não conta)', () => {
    const cs = [cand({ dist: 20 }), cand({ dist: 5 }), cand({ dist: 40 }), cand({ kind: 1, dist: 25 }), cand({ kind: 1, dist: 25, tagged: false })];
    expect(midBandCount(cs)).toBe(2);
  });
});

describe('nomes — seleção e oclusão', () => {
  it('ocluído não gasta vaga; teto respeitado; foco primeiro', () => {
    const cs = Array.from({ length: 30 }, (_, i) => cand({ key: i, dist: 2 + i * 0.3, nx: (i % 5) * 0.1 }));
    cs[29].focus = true;
    const occluded = (k: number) => k < 10;
    const pick = selectNames(cs, 'TODOS', 12, [], occluded);
    expect(pick.size).toBe(12);
    for (let k = 0; k < 10; k++) expect(pick.has(k)).toBe(false);
    expect(pick.has(29)).toBe(true);
  });
  it('lotado na faixa média: só os centrais aparecem lá', () => {
    const cs = Array.from({ length: NAME_LOD.midCrowd + 4 }, (_, i) => cand({ key: i, dist: 20, nx: i === 0 ? 0 : 0.8 }));
    const pick = selectNames(cs, 'PROXIMOS', 14);
    expect([...pick.keys()]).toEqual([0]);
  });
  it('OcclusionCache: orçamento de raios por decisão, validade, 2 bloqueios seguidos para ocluir', () => {
    const oc = new OcclusionCache(400, 2);
    let calls = 0;
    const blocked = () => { calls++; return true; };
    oc.begin();
    expect(oc.test(1, 0, blocked)).toBe(false); // 1º bloqueio: ainda visível (sem piscar na quina)
    expect(oc.test(2, 0, blocked)).toBe(false);
    expect(oc.test(3, 0, blocked)).toBe(false); // sem orçamento: desconhecido = visível, sem raio
    expect(calls).toBe(2);
    oc.begin();
    expect(oc.test(1, 100, blocked)).toBe(false); // ainda válido (ttl): não retesta
    expect(calls).toBe(2);
    oc.begin();
    expect(oc.test(1, 500, blocked)).toBe(true); // 2º bloqueio seguido
    oc.begin();
    expect(oc.test(1, 1000, () => false)).toBe(false); // desoclui na hora
  });
  it('rayBlocks: parede antes do alvo bloqueia; parede atrás da cabeça não', () => {
    expect(rayBlocks(0.5, 30)).toBe(true);
    expect(rayBlocks(1, 30)).toBe(false);
    expect(rayBlocks(0.99, 30)).toBe(false); // dentro da folga de 0,6 m
  });
  it('autônomo com nome: determinístico pelo nid, fração ≈ share, campo do servidor manda', () => {
    expect(autonomousTagged(77, 0.6)).toBe(autonomousTagged(77, 0.6));
    let n = 0;
    for (let i = 1; i <= 4000; i++) if (autonomousTagged(i, 0.6)) n++;
    expect(n / 4000).toBeGreaterThan(0.55);
    expect(n / 4000).toBeLessThan(0.65);
    expect(autonomousTagged(77, 0, 1)).toBe(true);
    expect(autonomousTagged(77, 1, 2)).toBe(false);
    expect(npcRanges(20, 40)).toEqual({ full: 20, short: 40, max: 40 });
  });
});

describe('variedade de animação (determinística por id)', () => {
  it('mesma semente → mesmos parâmetros; ids diferentes → parâmetros espalhados', () => {
    expect(animVariant(personSeed(42))).toEqual(animVariant(personSeed(42)));
    expect(personSeed('abc')).toBe(personSeed('abc'));
    expect(personSeed('abc')).not.toBe(personSeed('abd'));
    const v = Array.from({ length: 500 }, (_, i) => animVariant(personSeed(i + 1)));
    for (const x of v) {
      expect(x.stride).toBeGreaterThanOrEqual(0.94); expect(x.stride).toBeLessThanOrEqual(1.06);
      expect(x.idleRate).toBeGreaterThanOrEqual(0.9); expect(x.idleRate).toBeLessThanOrEqual(1.1);
    }
    // fase inicial: nenhum décimo do ciclo com mais de 15 % das pessoas
    const bins = new Array(10).fill(0);
    for (const x of v) bins[Math.floor(x.phase0 * 10)]++;
    expect(Math.max(...bins)).toBeLessThan(75);
  });
  it('100 palmas começando no MESMO tick não ficam em uníssono', () => {
    const dur = 0.8;
    const ph = Array.from({ length: 100 }, (_, i) => loopPhase(2.0, dur, animVariant(personSeed(1000 + i))));
    // "no mesmo quadro" ≈ mesma fase com tolerância de 1/30 do ciclo
    const bins = new Array(30).fill(0);
    for (const p of ph) bins[Math.min(29, Math.floor(p * 30))]++;
    expect(Math.max(...bins)).toBeLessThanOrEqual(10);
    // sem variedade todos cairiam no mesmo bin
    expect(loopPhase(2.0, dur, { actOffset: 0, actRate: 1 })).toBe(loopPhase(2.0, dur, { actOffset: 0, actRate: 1 }));
  });
  it('agente da multidão: semente aplicada pelo nid (todos os clientes iguais)', () => {
    const a = createAgent({ seed: personSeed(9) }), b = createAgent();
    setAgentSeed(b, personSeed(9));
    expect([a.phase, a.stride, a.idleRate, a.actOff, a.actRate]).toEqual([b.phase, b.stride, b.idleRate, b.actOff, b.actRate]);
    expect(seedUnit(personSeed(9), 0)).toBe(a.phase);
  });
});

describe('olhar (look-at) — limites', () => {
  it('à frente: giro e inclinação; limita lateral e solta o alvo atrás das costas', () => {
    const f = lookAngles(0, 0, 5)!;
    expect(f.yaw).toBeCloseTo(0); expect(f.w).toBe(1);
    const side = lookAngles(5, 0, 0.5)!; // ~84°: limitado a 70° com peso caindo
    expect(side.yaw).toBeCloseTo(LOOK_LIMITS.yaw);
    expect(side.w).toBeGreaterThan(0); expect(side.w).toBeLessThan(1);
    expect(lookAngles(0, 0, -5)!.w).toBe(0); // atrás
    const up = lookAngles(0, 10, 1)!; // muito alto: inclinação limitada (negativa = para cima)
    expect(up.pitch).toBeCloseTo(-LOOK_LIMITS.pitch);
    expect(lookAngles(0, 0, 0.1)).toBeNull(); // colado
  });
});

describe('painel da pessoa', () => {
  it('autônomo: sem SILENCIAR/DENUNCIAR, sem nível; nunca rotula como bot/humano', () => {
    expect(personActions(1)).toEqual(['profile', 'interact']);
    expect(personActions(0)).toEqual(['profile', 'interact', 'mute', 'report']);
    expect(personActions(undefined)).toEqual(['profile', 'interact', 'mute', 'report']);
    const sub = personSubtitle({ kind: 1, title: 'Ritmista', lvl: 9 }, 'Grupo A');
    expect(sub).toBe('Ritmista · Torcida: Grupo A');
    expect(personSubtitle({ kind: 0, title: 'Ritmista', lvl: 9 }, null)).toBe('Ritmista · Nível 9 · Sem torcida escolhida');
    const rows = personProfileRows({ kind: 1, name: 'Lapa021', title: '' }, null);
    expect(rows.map((r) => r[0])).toEqual(['Apelido', 'Título', 'Torcida']);
    const all = JSON.stringify([sub, rows]).toLowerCase();
    for (const w of ['bot', 'npc', 'humano', 'autônomo', 'ia ']) expect(all).not.toContain(w);
  });
});

describe('contagem pública só de humanos', () => {
  it('autônomos e bots de carga nunca somam; multidão distante marcada também não', () => {
    expect(countHumans([0, 1, 1, 2, undefined], [false, true, true, undefined], true)).toBe(1 + 2 + 2);
    expect(countHumans([1, 1, 1], [true, true], false)).toBe(0);
  });
  it('home: sem humanos não afirma jogadores (o número vem do servidor, que só conta clientes humanos)', () => {
    expect(metricsLine({ playersOnline: 0, spectatorsOnline: 0 })).not.toMatch(/jogador/);
  });
  it('mensagem "crowd": bit 6 = não humano (ida e volta; ausente = humano)', () => {
    const e = { nid: 5, x: 1, y: 0, z: 2, heading: 0, speed: 1, body: 1, status: 0, vehicle: false };
    const d = decodeCrowd(encodeCrowd([{ ...e, npc: true }, e]));
    expect(d[0].npc).toBe(true);
    expect(d[1].npc).toBeUndefined();
    const t = new CrowdTable();
    t.set(0, { ...e, npc: true, app: { skin: 1, hair: 2, top: 3, bottom: 4 } });
    t.set(1, { ...e, nid: 6, app: { skin: 1, hair: 2, top: 3, bottom: 4 } });
    const dt = decodeCrowd(t.build([0, 1], 2, () => true));
    expect(dt.map((x) => !!x.npc)).toEqual([true, false]);
    expect(dt[0].app).toEqual({ skin: 1, hair: 2, top: 3, bottom: 4 });
  });
});

describe('eventos dinâmicos — minimapa agregado e áudio', () => {
  it('normaliza tolerante (lixo ignorado, teto de 32, campos limitados)', () => {
    const l = normalizeDynamicEvents({ events: [{ id: 'a', kind: 'briga', x: 1, z: 2, escalation: 'confronto' }, { x: 'x' }, null, { x: 3, z: 4, r: 9999, cheering: 3 }] });
    expect(l).toHaveLength(2);
    expect(l[0].kind).toBe('BRIGA');
    expect(l[1].r).toBe(200);
    expect(l[1].cheering).toBe(1);
    expect(normalizeDynamicEvents(Array.from({ length: 50 }, (_, i) => ({ x: i, z: i })))).toHaveLength(32);
    expect(normalizeDynamicEvents('nada')).toEqual([]);
  });
  it('escalada aumenta o confronto; festa comemora; campos explícitos do servidor mandam', () => {
    const calm = dynamicEventAudio({ id: '1', kind: 'BRIGA', x: 0, z: 0, r: 10, escalation: 'CALMO' });
    const gen = dynamicEventAudio({ id: '1', kind: 'BRIGA', x: 0, z: 0, r: 10, escalation: 'GENERALIZADO' });
    expect(gen.combat).toBeGreaterThan(calm.combat);
    expect(dynamicEventAudio({ id: '2', kind: 'FESTA', x: 0, z: 0, r: 10 }).cheer).toBeGreaterThan(0.5);
    expect(dynamicEventAudio({ id: '3', kind: 'FESTA', x: 0, z: 0, r: 10, combatIntensity: 0.9 }).combat).toBe(0.9);
  });
  it('marca: rótulo genérico (sem escalada literal), cor quente na confusão', () => {
    const m = dynamicEventMark({ id: '1', kind: 'BRIGA_GENERALIZADA', x: 5, z: 6, r: 10, escalation: 'GENERALIZADO' });
    expect(m.label).toBe('Confusão');
    expect(m.color).toBe('#ff5a4a');
    expect(JSON.stringify(m)).not.toMatch(/GENERALIZADO|CONFRONTO|TENSAO/);
    expect(dynamicEventMark({ id: '2', kind: 'FESTA', x: 0, z: 0, r: 10 }).label).toBe('Festa');
  });
});

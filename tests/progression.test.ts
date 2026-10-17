/**
 * Rodada 9 — missões, conquistas, XP/nível, recompensas e telemetria (agente C). Regras puras + ProgressionService com o
 * MemoryDataStore (sem Colyseus): filtro/soma de objetivo, cadeia de missões, recompensa UMA vez (repetir eventos não
 * duplica), XP só de missão/conquista/evento (spam não rende), curva de nível, caminho pacífico ≥ nível 5 sem
 * confronto, persistência em lote, saída/entrada restaura, anônimo não grava, direitos cosméticos no validador.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import type { GameplayEvent } from '../src/gameplay/events';
import type { ProgressionMessage, ProgressionNotice } from '../src/progression/types';
import {
  COMBAT_EVENT_TYPES, levelBounds, levelForXp, matchesObjective, objectiveIncrement, parseCatalog, requirementOf, rewardXp, type ProgressionCatalog,
} from '../src/progression/engine';
import { ITEM_TIERS, isAvailable, type ItemKey } from '../src/characters/unlocks';
import { validateAppearance } from '../src/characters/validateAppearance';
import { DEFAULT_PLAYER_APPEARANCE } from '../src/characters/bodyTypes';
import { validateAction, validateProp, type ActionActor } from '../src/social/actionRules';
import { ACTION_BY_KEY } from '../src/social/actions';
import { DESIGN_BY_KEY } from '../src/social/designs';
import { PROP_BY_KIND } from '../src/social/props';
import { MemoryDataStore } from '../server/src/data/memory';
import { ProgressionService, EVENT_CAPS } from '../server/src/progression/ProgressionService';
import { DistanceMeter, RallyDwell, rallyRings } from '../server/src/progression/emitters';
import { GameplayTelemetry, aggregate } from '../server/src/telemetry/GameplayTelemetry';
import { GameplayBus } from '../server/src/gameplay/bus';

const J = (f: string) => JSON.parse(readFileSync(new URL(`../public/gameplay/${f}`, import.meta.url), 'utf8'));
const RAW = { missions: J('missions.json'), achievements: J('achievements.json'), levels: J('levels.json'), rewards: J('rewards.json') };
const CAT: ProgressionCatalog = parseCatalog(RAW);

function harness(store: MemoryDataStore | null = new MemoryDataStore(), flushMs = 1000) {
  const sent: { sid: string; type: string; msg: ProgressionMessage | ProgressionNotice }[] = [];
  const svc = new ProgressionService({ catalog: CAT, store, send: (sid, type, msg) => sent.push({ sid, type, msg }), flushMs });
  let t = Date.now();
  const ev = (sid: string, e: GameplayEvent, dt = 1000) => { t += dt; svc.onEvent({ sid, at: t, ev: e }); };
  const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };
  const notices = (sid: string) => sent.filter((s) => s.sid === sid && s.type === 'prog_ev').map((s) => s.msg as ProgressionNotice);
  const last = (sid: string) => [...sent].reverse().find((s) => s.sid === sid && s.type === 'prog')?.msg as ProgressionMessage | undefined;
  return { svc, sent, ev, settle, notices, last, store, now: () => t, adv: (ms: number) => { t += ms; } };
}

const zones = ['CENTRAL', 'CAMPO_DE_SANTANA', 'RIO_BRANCO', 'CANDELARIA'];
const walk = (h: ReturnType<typeof harness>, sid: string, meters: number, mode: 'foot' | 'bicycle' = 'foot') => { for (let m = 0; m < meters; m += 10) h.ev(sid, { type: 'distance', mode, meters: 10 }, 1600); };

/** sequência PACÍFICA (sem confronto, sem eventos da agenda): andar, zonas, bandeira/cartaz, gestos, concentração, trio, veículos */
function peacefulSession(h: ReturnType<typeof harness>, sid: string) {
  walk(h, sid, 40);
  for (const z of [...zones, 'CENTRO']) h.ev(sid, { type: 'zone_enter', zone: z }, 3000);
  h.ev(sid, { type: 'prop', kind: 'flag_small', slot: 'flag' }, 9000);
  h.ev(sid, { type: 'action', key: 'dance_simple', category: 'danca' }, 9000);
  h.ev(sid, { type: 'action', key: 'wave', category: 'gestos' }, 9000);
  h.ev(sid, { type: 'rally_visit', kind: 'trio' }, 20_000);
  h.ev(sid, { type: 'trio_board' }, 20_000);
  h.ev(sid, { type: 'vehicle_enter', kind: 'bicycle' }, 20_000);
  h.ev(sid, { type: 'vehicle_enter', kind: 'scooter' }, 20_000);
  walk(h, sid, 600); // MOBILIDADE conclui → GRANDE PASSEIO aparece (progresso antes de a missão existir não conta)
  walk(h, sid, 4400);
  walk(h, sid, 1200, 'bicycle');
  h.ev(sid, { type: 'prop', kind: 'sign_small', slot: 'sign' }, 20_000);
  for (let i = 0; i < 3; i++) h.ev(sid, { type: 'action', key: 'fist_up', category: 'manifestacao' }, 20_000);
  for (let i = 0; i < 3; i++) h.ev(sid, { type: 'rally_visit', kind: 'stage' }, 30_000);
}

describe('catálogo (public/gameplay)', () => {
  it('todos os JSON passam na validação; requisitos existem; nenhuma missão base depende de confronto', () => {
    expect(CAT.missions.length).toBe(RAW.missions.length);
    expect(CAT.achievements.length).toBe(RAW.achievements.length);
    expect(CAT.rewards.length).toBe(RAW.rewards.length);
    expect(CAT.levels.maxLevel).toBe(10);
    expect(CAT.missions.length).toBeGreaterThanOrEqual(8);
    const ids = new Set(CAT.missions.map((m) => m.id));
    for (const m of CAT.missions) {
      for (const r of m.requires ?? []) expect(ids.has(r), `${m.id} requer ${r}`).toBe(true);
      if (!m.optional) for (const o of m.objectives) expect(COMBAT_EVENT_TYPES.has(o.on), `${m.id}.${o.id}`).toBe(false);
      if (m.objectives.some((o) => COMBAT_EVENT_TYPES.has(o.on))) expect(m.optional).toBe(true);
    }
    for (const a of CAT.achievements) for (const o of a.objectives) expect(COMBAT_EVENT_TYPES.has(o.on)).toBe(false);
    // missões pedidas
    const conheca = CAT.missions.find((m) => m.title === 'CONHEÇA A PRESIDENTE VARGAS')!;
    expect(conheca.objectives.map((o) => o.where?.zone)).toEqual(zones);
    for (const t of ['ENTRE NO CLIMA', 'MOBILIDADE', 'TREINO DE CONFRONTO', 'BEM-VINDO À PRESIDENTE VARGAS']) expect(CAT.missions.some((m) => m.title === t)).toBe(true);
    for (const t of ['PRIMEIROS PASSOS', 'DO INÍCIO AO FIM', 'NO MEIO DA MULTIDÃO', 'NO PALCO', 'SOBRE DUAS RODAS', 'PRIMEIRO EVENTO']) expect(CAT.achievements.some((a) => a.title === t)).toBe(true);
  });

  it('neutralidade: sem nome de grupo/partido/torcida nos textos; recompensas só cosméticas', () => {
    const ev = JSON.parse(readFileSync(new URL('../public/events/manifestacao.json', import.meta.url), 'utf8')) as { groups?: { name: string; id: string }[] };
    const text = JSON.stringify(RAW).toLowerCase();
    for (const g of ev.groups ?? []) if (g.id !== 'neutro') expect(text.includes(g.name.toLowerCase()), g.name).toBe(false);
    for (const w of ['partido', 'torcida', 'candidat', 'esquerda', 'direita']) expect(text.includes(w), w).toBe(false);
    for (const r of [...CAT.missions, ...CAT.achievements].flatMap((x) => x.rewards)) expect(['xp', 'unlock', 'title']).toContain(r.kind);
  });

  it('rewards.json ↔ unlocks.ts: bloqueados são exatamente os itens do catálogo; PREMIUM_FUTURE não bloqueia nem é prêmio', () => {
    const lockedCat = CAT.rewards.filter((r) => r.source !== 'PREMIUM_FUTURE' && r.source !== 'FREE').map((r) => r.item).sort();
    expect(Object.keys(ITEM_TIERS).sort()).toEqual(lockedCat);
    const unlockRewards = [...CAT.missions, ...CAT.achievements].flatMap((x) => x.rewards).filter((r) => r.kind === 'unlock').map((r) => r.item!);
    for (const it of unlockRewards) expect(lockedCat, it).toContain(it);
    for (const r of CAT.rewards) {
      if (r.source === 'PREMIUM_FUTURE') { expect(unlockRewards).not.toContain(r.item); expect(requirementOf(CAT, r.item)).toBe('Em breve'); }
      else expect(r.level !== undefined || unlockRewards.includes(r.item), `${r.item} sem como liberar`).toBe(true);
    }
    // alvos existem de verdade (ação, design, camisa)
    for (const it of lockedCat) {
      const [k, v] = it.split(':');
      if (k === 'action') expect(ACTION_BY_KEY.has(v)).toBe(true);
      if (k === 'design') expect(DESIGN_BY_KEY.has(v)).toBe(true);
    }
    expect(requirementOf(CAT, 'shirt:208')).toBe('Nível 3');
    expect(requirementOf(CAT, 'shirt:209')).toBe('Missão: MOBILIDADE');
    expect(requirementOf(CAT, 'shirt:211')).toBe('Conquista: DO INÍCIO AO FIM');
  });
});

describe('regras puras', () => {
  it('objetivo: `on` + filtro por igualdade + soma de campo', () => {
    const o = { id: 'a', label: 'x', on: 'distance' as const, where: { mode: 'foot' }, sumField: 'meters', count: 30 };
    expect(matchesObjective(o, { type: 'distance', mode: 'foot', meters: 12 })).toBe(true);
    expect(matchesObjective(o, { type: 'distance', mode: 'bicycle', meters: 12 })).toBe(false);
    expect(matchesObjective(o, { type: 'zone_enter', zone: 'CENTRAL' })).toBe(false);
    expect(objectiveIncrement(o, { type: 'distance', mode: 'foot', meters: 12.5 })).toBe(12.5);
    expect(objectiveIncrement({ id: 'b', label: 'x', on: 'chat' }, { type: 'chat' })).toBe(1);
    expect(objectiveIncrement(o, { type: 'distance', mode: 'foot', meters: -5 })).toBe(0);
    const z = { id: 'c', label: 'x', on: 'zone_enter' as const, where: { zone: 'CENTRAL' } };
    expect(matchesObjective(z, { type: 'zone_enter', zone: 'CENTRAL' })).toBe(true);
    expect(matchesObjective(z, { type: 'zone_enter', zone: 'CENTRO' })).toBe(false);
    expect(matchesObjective({ id: 'd', label: 'x', on: 'prop', where: { slot: 'flag' } }, { type: 'prop', kind: 'flag_large', slot: 'flag' })).toBe(true);
  });

  it('curva de nível 1–10', () => {
    const c = CAT.levels;
    expect(levelForXp(c, 0)).toBe(1);
    expect(levelForXp(c, 99)).toBe(1);
    expect(levelForXp(c, 100)).toBe(2);
    expect(levelForXp(c, 699)).toBe(4);
    expect(levelForXp(c, 700)).toBe(5);
    expect(levelForXp(c, 3200)).toBe(10);
    expect(levelForXp(c, 1e9)).toBe(10);
    expect(levelBounds(c, 1)).toEqual({ cur: 0, next: 100 });
    expect(levelBounds(c, 10)).toEqual({ cur: 3200, next: null });
  });

  it('catálogo inválido não lança e descarta o que não serve', () => {
    const c = parseCatalog({ missions: [{ id: 'x', title: 'X', objectives: [{ id: 'a', label: 'a', on: 'voar' }] }, { id: 'y', title: 'Y', objectives: [{ id: 'a', label: 'a', on: 'chat' }], rewards: [{ kind: 'xp', amount: 1e9 }, { kind: 'pix' }] }], levels: { levels: [5, 3] } });
    expect(c.missions.map((m) => m.id)).toEqual(['y']);
    expect(c.missions[0].rewards).toEqual([]);
    expect(c.levels).toEqual({ levels: [0], maxLevel: 1 });
  });
});

describe('ProgressionService', () => {
  it('jogador novo: só a missão de boas-vindas; concluir revela as próximas (cadeia + nível mínimo)', async () => {
    const h = harness();
    h.svc.join('s1', { userId: 'u1', persistent: true });
    await h.settle(); h.svc.tick(h.now());
    expect(h.last('s1')!.p.active.map((a) => a.missionId)).toEqual(['boas_vindas']);
    walk(h, 's1', 30);
    const snap = h.svc.snapshot('s1')!;
    expect(snap.completedMissions).toEqual(['boas_vindas']);
    expect(snap.active.map((a) => a.missionId).sort()).toEqual(['conheca_pv', 'entre_no_clima', 'mobilidade']);
    expect(snap.xp).toBe(50 + 25); // missão + PRIMEIROS PASSOS
    expect(h.notices('s1').map((n) => n.kind)).toEqual(expect.arrayContaining(['mission', 'achievement']));
    // nível 2 abre as de nível mínimo 2
    for (const z of zones) h.ev('s1', { type: 'zone_enter', zone: z }, 3000);
    const s2 = h.svc.snapshot('s1')!;
    expect(s2.level).toBeGreaterThanOrEqual(2);
    expect(s2.active.map((a) => a.missionId)).toEqual(expect.arrayContaining(['participe_evento', 'ouvinte', 'treino_confronto']));
    expect(h.notices('s1').some((n) => n.kind === 'level')).toBe(true);
  });

  it('recompensa UMA vez: repetir os mesmos eventos não duplica missão, conquista, item nem XP', async () => {
    const store = new MemoryDataStore();
    const h = harness(store);
    h.svc.join('s1', { userId: 'u1', persistent: true });
    await h.settle();
    peacefulSession(h, 's1');
    const a = h.svc.snapshot('s1')!;
    const nNotices = h.notices('s1').length;
    for (let i = 0; i < 3; i++) peacefulSession(h, 's1');
    const b = h.svc.snapshot('s1')!;
    expect(b.xp).toBe(a.xp);
    expect(b.completedMissions).toEqual(a.completedMissions);
    expect(b.achievements).toEqual(a.achievements);
    expect(b.unlocks.sort()).toEqual(a.unlocks.sort());
    expect(h.notices('s1').length).toBe(nNotices); // nenhuma notícia nova: nada foi concedido de novo
    h.svc.leave('s1');
    await h.svc.flushAll();
    const rec = (await store.progression.load('u1'))!;
    expect(rec.completed.length).toBe(new Set(rec.completed.map((c) => c.missionId)).size);
    expect(rec.grants.length).toBe(new Set(rec.grants.map((g) => g.item)).size);
    expect(rec.completed.length).toBe(a.completedMissions.length);
    // o banco recusa duplicados mesmo se o serviço tentasse de novo (par único)
    await store.progression.save('u1', { xp: rec.xp, level: rec.level, data: rec.data, completed: [{ missionId: 'boas_vindas', at: new Date() }], achievements: [{ achievementId: 'no_palco', at: new Date() }], grants: [{ item: 'shirt:209', source: 'x', at: new Date() }] });
    const rec2 = (await store.progression.load('u1'))!;
    expect(rec2.completed.length).toBe(rec.completed.length);
    expect(rec2.grants.length).toBe(rec.grants.length);
  });

  it('anti-farm: chat/emote/item/grafite/golpe em massa não dão XP; distância só em objetivo; teto por minuto', async () => {
    const h = harness();
    h.svc.join('s1', { userId: null, persistent: false });
    for (let i = 0; i < 300; i++) {
      h.ev('s1', { type: 'chat' }, 50);
      h.ev('s1', { type: 'action', key: 'wave', category: 'gestos' }, 50);
      h.ev('s1', { type: 'prop', kind: 'megaphone' }, 50);
      h.ev('s1', { type: 'graffiti' }, 50);
      h.ev('s1', { type: 'combat_action', key: 'soco' }, 50);
      h.ev('s1', { type: 'debate_react' }, 50);
    }
    const s = h.svc.snapshot('s1')!;
    // só as conquistas únicas leves (grafite 25 XP; chat: título sem XP) — nada proporcional à quantidade
    expect(s.xp).toBe(25);
    expect(s.achievements.sort()).toEqual(['arte_na_avenida', 'boa_conversa']);
    expect(h.svc.stats.capped).toBeGreaterThan(1000);
    expect(EVENT_CAPS.chat).toBeLessThanOrEqual(5);
    // 50 km a pé: XP limitada às recompensas das missões/conquistas de distância (não cresce com os metros)
    const h2 = harness();
    h2.svc.join('s2', { userId: null, persistent: false });
    walk(h2, 's2', 50_000);
    const capXp = rewardXp(CAT.missions.find((m) => m.id === 'boas_vindas')!.rewards) + [...['primeiros_passos', 'maratona']].reduce((n, id) => n + rewardXp(CAT.achievements.find((a) => a.id === id)!.rewards), 0);
    expect(h2.svc.snapshot('s2')!.xp).toBe(capXp);
  });

  it('confronto: só objetivo concluído rende (nunca por golpe); missão opcional', () => {
    const h = harness();
    h.svc.join('s1', { userId: null, persistent: false });
    walk(h, 's1', 30); for (const z of zones) h.ev('s1', { type: 'zone_enter', zone: z }, 3000); // nível 2 → treino visível
    const before = h.svc.snapshot('s1')!.xp;
    for (let i = 0; i < 50; i++) h.ev('s1', { type: 'combat_action', key: 'soco' }, 4000);
    expect(h.svc.snapshot('s1')!.xp).toBe(before);
    h.ev('s1', { type: 'combat_action', key: 'chute' }, 4000); h.ev('s1', { type: 'combat_dodge' }, 4000); h.ev('s1', { type: 'dummy_knockdown' }, 4000);
    expect(h.svc.snapshot('s1')!.completedMissions).toContain('treino_confronto');
    expect(h.svc.snapshot('s1')!.xp).toBe(before + 150);
  });

  it('conclusão de evento: XP com retorno decrescente por evento/dia (participar não rende sozinho)', () => {
    const h = harness();
    h.svc.join('s1', { userId: null, persistent: false });
    const x0 = h.svc.snapshot('s1')!.xp;
    h.ev('s1', { type: 'event_join', eventId: 'corrida_1', format: 'race' }, 1000);
    expect(h.svc.snapshot('s1')!.xp).toBe(x0);
    const gains: number[] = [];
    for (let i = 0; i < 6; i++) { const a = h.svc.snapshot('s1')!.xp; h.ev('s1', { type: 'event_complete', eventId: 'corrida_1', format: 'race' }, 20_000); gains.push(h.svc.snapshot('s1')!.xp - a); }
    // 1ª: 40 + PRIMEIRO EVENTO (100); depois 20, 10, 5, 0, 0
    expect(gains).toEqual([140, 20, 10, 5, 0, 0]);
  });

  it('caminho PACÍFICO (sem confronto nem eventos da agenda) chega ao nível ≥ 5', () => {
    const h = harness();
    h.svc.join('s1', { userId: null, persistent: false });
    peacefulSession(h, 's1');
    const s = h.svc.snapshot('s1')!;
    expect(s.level).toBeGreaterThanOrEqual(5);
    expect(s.completedMissions).toEqual(expect.arrayContaining(['boas_vindas', 'conheca_pv', 'entre_no_clima', 'mobilidade', 'voz_na_avenida', 'grande_passeio']));
    expect(s.completedMissions).not.toContain('treino_confronto');
    expect(s.unlocks).toEqual(expect.arrayContaining(['shirt:209', 'design:noite_na_avenida', 'shirt:211', 'shirt:208', 'shirt:210']));
    expect(s.titles).toContain('Conhece a avenida');
  });

  it('gravação em LOTE: nenhuma escrita por evento; grava no prazo e na saída; saída/entrada (nova sessão) restaura', async () => {
    const store = new MemoryDataStore();
    let saves = 0;
    const orig = store.progression.save;
    store.progression.save = async (u, d) => { saves++; return orig(u, d); };
    const h = harness(store, 5000);
    h.svc.join('s1', { userId: 'u9', persistent: true });
    await h.settle();
    peacefulSession(h, 's1');
    expect(saves).toBe(0); // centenas de eventos, zero escritas
    h.svc.tick(h.now() + 10_000); await h.settle();
    expect(saves).toBe(1);
    h.svc.tick(h.now() + 20_000); await h.settle();
    expect(saves).toBe(1); // nada sujo: nada a gravar
    h.svc.seen('s1', { k: 'welcome' });
    h.svc.track('s1', { id: 'participe_evento' });
    const before = h.svc.snapshot('s1')!;
    h.svc.leave('s1'); // "logout"
    await h.settle(); await h.svc.flushAll();
    expect(saves).toBe(2);
    // "reinício do servidor": serviço NOVO, mesmo banco, sessão nova
    const h2 = harness(store);
    h2.svc.join('s2', { userId: 'u9', persistent: true });
    await h2.settle();
    const after = h2.svc.snapshot('s2')!;
    expect(after.xp).toBe(before.xp);
    expect(after.level).toBe(before.level);
    expect(after.completedMissions.sort()).toEqual(before.completedMissions.sort());
    expect(after.achievements.sort()).toEqual(before.achievements.sort());
    expect(after.unlocks.sort()).toEqual(before.unlocks.sort());
    expect(after.seen).toEqual(['welcome']);
    expect(after.tracked).toBe('participe_evento');
    expect(after.active.map((a) => a.missionId).sort()).toEqual(before.active.map((a) => a.missionId).sort());
    h2.svc.tick(h2.now() + 1);
    expect(h2.last('s2')!.persistent).toBe(true);
  });

  it('login duplicado/reconexão: a sessão nova reaproveita o estado em memória (nada se perde antes da gravação)', async () => {
    const store = new MemoryDataStore();
    const h = harness(store, 60_000);
    h.svc.join('a', { userId: 'u5', persistent: true });
    await h.settle();
    walk(h, 'a', 40);
    const xp = h.svc.snapshot('a')!.xp;
    h.svc.leave('a');
    h.svc.join('b', { userId: 'u5', persistent: true });
    expect(h.svc.snapshot('b')!.xp).toBe(xp);
  });

  it('visitante/anônimo: só memória da sessão, nada no banco; entrar de novo começa do zero', async () => {
    const store = new MemoryDataStore();
    const h = harness(store);
    h.svc.join('v1', { userId: 'test:qa', persistent: false });
    peacefulSession(h, 'v1');
    expect(h.svc.snapshot('v1')!.level).toBeGreaterThanOrEqual(5);
    h.svc.leave('v1');
    await h.svc.flushAll();
    expect(await store.progression.load('test:qa')).toBeNull();
    h.svc.join('v2', { userId: 'test:qa', persistent: false });
    expect(h.svc.snapshot('v2')!.xp).toBe(0);
    h.svc.tick(h.now());
    expect(h.last('v2')!.persistent).toBe(false);
    expect(h.svc.size).toBe(1);
  });

  it('prog ≤ 2 Hz e só para o dono', async () => {
    const h = harness(null);
    h.svc.join('s1', { userId: null, persistent: false });
    h.svc.join('s2', { userId: null, persistent: false });
    const t0 = h.now();
    for (let i = 0; i < 20; i++) { h.ev('s1', { type: 'distance', mode: 'foot', meters: 10 }, 50); h.svc.tick(t0 + i * 50); }
    const progs = h.sent.filter((s) => s.type === 'prog' && s.sid === 's1').length;
    expect(progs).toBeLessThanOrEqual(3); // 1 s de eventos a 20 Hz → ≤ 2–3 envios
    expect(h.sent.filter((s) => s.sid === 's2' && s.type === 'prog_ev')).toEqual([]);
  });
});

describe('direitos cosméticos (unlocks.ts + validadores)', () => {
  it('item liberado vale no validador de aparência e nas regras de ação/item; bloqueado cai no padrão / é negado', () => {
    const app = { ...DEFAULT_PLAYER_APPEARANCE.homem, topStyle: 'camiseta', shirtDesign: 209 };
    expect(validateAppearance(app)!.shirtDesign).toBe(0);
    expect(validateAppearance(app, null, { items: new Set(['shirt:209']) })!.shirtDesign).toBe(209);
    // o que era livre ANTES da rodada 9 continua livre (camisas 200–207, bolsa, danças)
    for (const d of [200, 205, 206, 207]) expect(validateAppearance({ ...app, shirtDesign: d })!.shirtDesign).toBe(d);
    expect(validateAppearance({ ...app, shirtDesign: 0, accessory: 'bolsa' })!.accessory).toBe('bolsa');
    expect(isAvailable('shirt:209' as ItemKey)).toBe(false);
    const actor = (items: string[]): ActionActor => ({ act: 0, actAt: 0, prop: 0, design: 0, status: 0, vehicle: '', recent: [], ent: { items: new Set(items) } });
    const dc = ACTION_BY_KEY.get('dance_classic')!.id;
    expect(validateAction(actor([]), dc, 1e6).ok).toBe(true);
    // mecanismo de ação bloqueada (nenhuma ação é recompensa hoje): tier temporário
    ITEM_TIERS['action:dance_classic' as ItemKey] = 'UNLOCKED';
    try {
      expect(validateAction(actor([]), dc, 1e6)).toEqual({ ok: false, reason: 'bloqueado' });
      expect(validateAction(actor(['action:dance_classic']), dc, 1e6).ok).toBe(true);
      expect(validateAction({ act: 0, actAt: 0, prop: 0, design: 0, status: 0, vehicle: '', recent: [] }, dc, 1e6).ok).toBe(true);
    } finally { delete ITEM_TIERS['action:dance_classic' as ItemKey]; }
    const flag = PROP_BY_KIND.get('flag_small')!.id, sun = DESIGN_BY_KEY.get('por_do_sol')!.id;
    expect(validateProp(actor([]), flag, sun, 1e6)).toEqual({ ok: false, reason: 'bloqueado' });
    expect(validateProp(actor(['design:por_do_sol']), flag, sun, 1e6).ok).toBe(true);
  });
});

describe('emissores do servidor (distance / rally_visit)', () => {
  it('distância em lotes ≥ 10 m por modo; salto (teleporte) não conta', () => {
    const d = new DistanceMeter();
    const out: number[] = [];
    for (let i = 0; i < 30; i++) { const b = d.add('s', 'foot', 0.6, 0.1); if (b) out.push(b.meters); }
    expect(out).toEqual([10.2]);
    expect(d.add('s', 'foot', 500, 0.1)).toBeNull();
    expect(d.add('s', 'trio', 5, 1)).toBeNull();
    let b = null; for (let i = 0; i < 20 && !b; i++) b = d.add('s', 'bicycle', 0.7, 0.1);
    expect(b?.mode).toBe('bicycle');
  });

  it('concentração: permanência ≥ N s no anel → uma vez por estadia', () => {
    const r = new RallyDwell(5000);
    const rings = rallyRings([{ kind: 'stage', x: 0, z: 0, heading: 0 }, { kind: 'screen', x: 500, z: 0, heading: 0 }], [{ id: 'trio1', kind: 'trio', x: 100, z: 0 }, { id: 'c1', kind: 'car', x: 300, z: 0 }]);
    expect(rings.map((x) => x.kind)).toEqual(['stage', 'trio']);
    const seq: (string | null)[] = [];
    for (let t = 0; t <= 8000; t += 1000) seq.push(r.update('s', 100, 10, rings, t));
    expect(seq.filter(Boolean)).toEqual(['trio']);
    expect(r.update('s', 1000, 1000, rings, 9000)).toBeNull(); // saiu
    const again: (string | null)[] = [];
    for (let t = 10_000; t <= 16_000; t += 1000) again.push(r.update('s', 100, 5, rings, t));
    expect(again.filter(Boolean)).toEqual(['trio']);
  });
});

describe('telemetria de gameplay', () => {
  it('agregados sem dado pessoal; linhas somam entre períodos', async () => {
    const bus = new GameplayBus();
    const tm = new GameplayTelemetry({ file: null });
    bus.on(tm.listener);
    tm.sessionStart('a', true, 0); tm.sessionStart('b', false, 0);
    bus.emit('a', { type: 'zone_enter', zone: 'CENTRAL' }); bus.emit('a', { type: 'event_join', eventId: 'x', format: 'race' });
    bus.emit('a', { type: 'race_finish', raceId: 'x', vehicle: 'bicycle', rank: 1, timeMs: 1 }); bus.emit('b', { type: 'combat_action', key: 'soco' });
    bus.emit('b', { type: 'debate_watch', seconds: 30 });
    tm.observer.missionStarted!('m'); tm.observer.missionCompleted!('m');
    tm.sessionEnd('a', 7 * 60e3); tm.sessionEnd('b', 20e3);
    const c = tm.total;
    expect(c.sessionsStarted).toBe(2); expect(c.accountSessions).toBe(1); expect(c.racesStarted).toBe(1); expect(c.racesCompleted).toBe(1);
    expect(c.combatSessions).toBe(1); expect(c.debateSessions).toBe(1); expect(c.zonesVisited.CENTRAL).toBe(1);
    expect(c.duration).toEqual({ '5-15min': 1, '<1min': 1 }); expect(c.activity).toEqual({ '1-4': 2 });
    expect(JSON.stringify(c)).not.toMatch(/"a"|"b"/);
    const agg = aggregate([JSON.stringify({ from: 'x', to: 'y', c }), JSON.stringify({ from: 'y', to: 'z', c }), 'lixo']);
    expect(agg.periods).toBe(2);
    expect(agg.c.sessionsStarted).toBe(4);
    expect(agg.c.zonesVisited.CENTRAL).toBe(2);
  });
});

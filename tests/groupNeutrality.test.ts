/**
 * Rodada 8 — NEUTRALIDADE dos grupos do evento: GRUPO 13, GRUPO 22 e NEUTRO só mudam aparência. Mesmas capacidades,
 * papel, velocidade, veículos, interesse/AOI, prioridade e qualidade; e nenhum código com ramo por grupo específico.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { can, resolveRole, type Capability } from '../src/access/policy';
import { MAX_SPEED, validateMove } from '../src/net/protocol';
import { joinableGroups, groupRecordId, withGroupShirt, groupDesigns } from '../src/events/groups';
import { validateAppearance } from '../src/characters/validateAppearance';
import { DEFAULT_PLAYER_APPEARANCE } from '../src/characters/bodyTypes';
import { registerCampaigns } from '../src/social/designs';
import { MemoryDataStore } from '../server/src/data/memory';
import { TicketService } from '../server/src/identity/tickets';
import { resolveIdentity } from '../server/src/identity/resolve';
import { loadPlayerLook } from '../server/src/identity/appearance';
import type { EventDef } from '../src/events/types';

const ev = JSON.parse(readFileSync('public/events/manifestacao.json', 'utf8')) as EventDef;
const groups = joinableGroups(ev);
registerCampaigns(JSON.parse(readFileSync('public/designs/campaigns.json', 'utf8')));

const CAPS: Capability[] = ['world.spectate', 'world.play', 'chat.read', 'chat.write', 'graffiti.create', 'report.create', 'vehicle.use', 'action.perform', 'item.hold', 'push', 'profile.edit', 'group.join'];

/** identidade resolvida pelo servidor de uma conta com licença, em cada grupo (e sem grupo) */
async function identities() {
  const store = new MemoryDataStore();
  const tickets = new TicketService();
  await store.events.upsert({ id: ev.id, name: ev.name, groups: groups.map((g, i) => ({ id: groupRecordId(ev.id, g.key), key: g.key, name: g.name, designKey: g.designKey, neutral: g.neutral, sort: i })) });
  const out: Record<string, Awaited<ReturnType<typeof resolveIdentity>>> = {};
  for (const key of [...groups.map((g) => g.key), '(sem grupo)']) {
    const u = await store.users.create({ email: `${key}@t.test`, passwordHash: 'x' });
    await store.profiles.create({ userId: u.id, nickname: `Jog${Object.keys(out).length}`, nicknameKey: `jog${Object.keys(out).length}` });
    await store.access.grant({ userId: u.id, grant: 'DEV_GRANTED', eventId: null, source: 'teste' });
    if (key !== '(sem grupo)') await store.events.setMembership(u.id, ev.id, groupRecordId(ev.id, key));
    const t = tickets.issue({ userId: u.id, authSessionId: 's', role: 'player' });
    out[key] = await resolveIdentity({ store, tickets }, { ticket: t }, ev.id);
    expect((await loadPlayerLook(store, u.id, ev.id)).groupKey).toBe(key === '(sem grupo)' ? null : key);
  }
  return out;
}

describe('grupos do evento: só aparência', () => {
  it('os dados do evento têm os três grupos escolhíveis (13, 22, neutro)', () => {
    expect(groups.map((g) => g.name)).toEqual(['GRUPO 13', 'GRUPO 22', 'NEUTRO']);
    expect(groups.filter((g) => g.neutral)).toHaveLength(1);
  });

  it('mesma identidade de jogo para todos os grupos (estado, licença, papel, capacidades)', async () => {
    const ids = await identities();
    const ref = ids['(sem grupo)'];
    for (const [key, id] of Object.entries(ids)) {
      expect(id.groupKey).toBe(key === '(sem grupo)' ? null : key);
      expect({ ...id, groupKey: null, nickname: '', userId: '' }).toEqual({ ...ref, groupKey: null, nickname: '', userId: '' });
      for (const role of ['player', 'spectator'] as const) for (const cap of CAPS) expect(can(id.state, cap, role)).toBe(can(ref.state, cap, role));
      expect(resolveRole(id.state, 'player')).toBe('player');
      expect(resolveRole(id.state, 'spectator')).toBe('spectator');
    }
  });

  it('velocidade/movimento, veículos, interesse e qualidade não recebem grupo como entrada', () => {
    // as regras são funções puras sem parâmetro de grupo: o mesmo movimento é aceito igual para qualquer um
    const prev = { x: 0, y: 0, z: 0, t: 0 };
    const mv = { x: 3, y: 0, z: 0, heading: 0, speed: 6, loco: 2, mode: 'foot' as const, seq: 1 };
    const r = validateMove(prev, mv, 500);
    for (let i = 0; i < groups.length; i++) expect(validateMove(prev, mv, 500)).toEqual(r);
    expect(Object.keys(MAX_SPEED).sort()).toEqual(['bicycle', 'car', 'foot', 'moto', 'scooter', 'soundcar', 'trio']);
    // nenhum módulo de regra/interesse/qualidade sequer menciona grupo
    for (const f of ['src/net/protocol.ts', 'src/net/rules.ts', 'src/net/authority.ts', 'src/net/spatialGrid.ts', 'src/net/crowdCodec.ts', 'src/vehicles/platform.ts', 'src/core/settings.ts', 'src/renderer/quality.ts', 'src/social/actionRules.ts', 'src/access/policy.ts']) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/groupKey|membership|EventGroup|joinable/i);
    }
  });

  it('o grupo muda só a aparência sugerida (camiseta opcional nas cores), igual para todos', () => {
    const base = validateAppearance(DEFAULT_PLAYER_APPEARANCE.idoso)!;
    for (const g of groups) {
      const a = validateAppearance(withGroupShirt(base, g))!;
      expect(a.topStyle).toBe('camiseta');
      expect(a.top).toBe(parseInt(g.colors[0].slice(1), 16));
      expect({ ...a, top: 0, topStyle: undefined }).toEqual({ ...base, top: 0, topStyle: undefined }); // nada além da camisa
      expect(groupDesigns(g, 'flag').length + groupDesigns(g, 'sign').length).toBeGreaterThan(0);
    }
  });

  it('nenhum código tem ramo por grupo específico (ids/designs dos grupos só existem nos dados)', () => {
    const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'node_modules' ? [] : walk(`${d}/${e.name}`)) : [`${d}/${e.name}`]));
    const files = [...walk('src'), ...walk('server/src')].filter((f) => /\.ts$/.test(f));
    const literals = groups.flatMap((g) => [g.key, g.designKey].filter((k): k is string => !!k && !['paz', 'brasil'].includes(k)));
    const lit = new RegExp(`['"\`](${literals.map((k) => k.replace(/[-_]/g, '[-_]')).join('|')})['"\`]`);
    // groupKey/grupo comparado com um literal: `groupKey === 'x'`, `case 'x'` dentro de switch(groupKey)…
    const branch = /group(Key|Id)?\s*[!=]==?\s*['"`]|['"`]\s*[!=]==?\s*\w*group(Key|Id)?\b|switch\s*\([^)]*group/i;
    const offenders = files.filter((f) => {
      const s = readFileSync(f, 'utf8').replace(/typeof\s+[\w.?]+\s*[!=]==?\s*['"]\w+['"]/g, ''); // checagem de tipo não é ramo
      return lit.test(s) || branch.test(s);
    });
    expect(offenders).toEqual([]);
  });

  it('rodada 9: tipos de grupo (POLITICAL/SUPPORTERS/NEUTRAL/CUSTOM) e torcidas fictícias são só dados', async () => {
    const idx = JSON.parse(readFileSync('public/events/index.json', 'utf8')) as { events: string[] };
    const all = idx.events.map((id) => JSON.parse(readFileSync(`public/events/${id}.json`, 'utf8')) as EventDef);
    for (const e of all) for (const g of e.groups ?? []) expect(['POLITICAL', 'SUPPORTERS', 'NEUTRAL', 'CUSTOM'], `${e.id}/${g.id}`).toContain(g.kind);
    expect(ev.groups!.map((g) => g.kind)).toEqual(['POLITICAL', 'POLITICAL', 'NEUTRAL']);
    // torcidas: camisas de futebol SEM escudo (designs 200–207, alvo camisa), cores próprias
    const sup = all.flatMap((e) => (e.groups ?? []).filter((g) => g.kind === 'SUPPORTERS'));
    expect(sup.length).toBeGreaterThanOrEqual(2);
    const { DESIGN_BY_KEY } = await import('../src/social/designs');
    for (const g of sup) {
      const d = DESIGN_BY_KEY.get(g.designKey ?? '')!;
      expect(d.id, g.id).toBeGreaterThanOrEqual(200); expect(d.id).toBeLessThanOrEqual(207);
      expect(d.targets).toContain('shirt');
    }
    // nenhum código decide por TIPO de grupo nem por chave de torcida
    const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'node_modules' || e.name === 'generated' ? [] : walk(`${d}/${e.name}`)) : [`${d}/${e.name}`]));
    const files = [...walk('src'), ...walk('server/src')].filter((f) => /\.ts$/.test(f));
    const keys = sup.map((g) => g.id);
    const bad = files.filter((f) => { const t = readFileSync(f, 'utf8'); return /['"`](POLITICAL|SUPPORTERS)['"`]\s*[!=]==|[!=]==\s*['"`](POLITICAL|SUPPORTERS)['"`]/.test(t) || keys.some((k) => t.includes(`'${k}'`) || t.includes(`"${k}"`)); });
    expect(bad).toEqual([]);
  });

  it('rodada 9: confronto de grupos trata as torcidas por igualdade — mesmo resultado trocando os lados', async () => {
    const { EventRuntime } = await import('../server/src/events/EventRuntime');
    const k = JSON.parse(readFileSync('public/events/classico-exemplo.json', 'utf8')) as EventDef;
    const clash = k.agenda!.find((d) => d.format === 'confronto_grupos')!;
    const run = (order: string[]) => {
      const ps = new Map(order.map((g, i) => [`p${i}`, { sid: `p${i}`, name: `P${i}`, x: 0, z: 0, vehicleKind: null, groupKey: g, status: 0, dropped: false, onPlatform: false }]));
      const rt = new EventRuntime([{ ...clash, groupRules: { ...clash.groupRules!, allowed: order } }], { participant: (s) => ps.get(s) ?? null, players: () => ps.keys(), send: () => {}, emit: () => {}, zoneOf: () => clash.zones[0] }, JSON.parse(readFileSync('public/world/manifest.json', 'utf8')).pvAxis, { clock: () => t });
      let t = (clash.recurrence.offsetMin - clash.recurrence.registrationMin / 2) * 60_000;
      rt.tick(t);
      const inst = rt.instances()[0].inst;
      const joins = [...ps.keys()].map((s) => rt.join(s, inst));
      t = rt.instances()[0].startsAt; rt.tick(t);
      rt.onKnockdown('p0', 'p1');
      return { joins, rules: [...ps.keys()].map((s) => ({ ...rt.combatEventFor(s)!, eventId: '' })), score: Object.values((rt.runnerState(inst) as { score: Record<string, number> }).score).sort() };
    };
    const g = clash.groupRules!.allowed!;
    expect(run([g[0], g[1]])).toEqual(run([g[1], g[0]]));
  });
});

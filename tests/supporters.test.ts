/**
 * Rodada 10 — TORCIDAS (data-driven): dados das 4 torcidas + neutro, designs (camisas 212–215, bandeiras/faixas
 * 216–223), política de troca (aplica fora de evento; PENDENTE durante evento competitivo; cooldown), campo de rede
 * `sup`, neutralidade (nenhuma vantagem; nenhum nome de clube no código), encontro de torcidas (runner) e a troca de
 * GRUPO DO EVENTO adiada durante confronto (RoomSupporters). Sala real com contas: tests/supportersServer.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { decideSupporterChange, isSupporterChoice, parseSupporterData, settlePending, supAt, supIndex, supporterOutfit, type SupporterState } from '../src/supporters/data';
import { DESIGN_BY_ID } from '../src/social/designs';
import { PATTERN_CODE, shirtSlot, shirtDesigns } from '../src/characters/human/garmentShader';
import { validateAppearance } from '../src/characters/validateAppearance';
import { DEFAULT_PLAYER_APPEARANCE } from '../src/characters/bodyTypes';
import { EventRuntime } from '../server/src/events/EventRuntime';
import { sanitizeAgenda } from '../server/src/events/agenda';
import type { EventHost, EventInstance, ParticipantView } from '../server/src/events/runner';
import { RoomSupporters } from '../server/src/supporters/RoomSupporters';
import type { EventDef } from '../src/events/types';
import type { GameplayEnvelope } from '../src/gameplay/events';
import type { SupporterData } from '../src/supporters/types';

const RAW = JSON.parse(readFileSync('public/gameplay/supporters.json', 'utf8'));
const parsed = parseSupporterData(RAW);
const D = parsed.data as SupporterData;
const axis: [number, number][] = JSON.parse(readFileSync('public/world/manifest.json', 'utf8')).pvAxis;
const ids = D.groups.map((g) => g.id);
const fresh = (): SupporterState => ({ current: null, pending: null, changedAt: null });

describe('torcidas: dados', () => {
  it('as 4 torcidas carregam sem erro, com camisa, bandeira e faixa existentes', () => {
    expect(parsed.errors).toEqual([]);
    expect(D.groups).toHaveLength(4);
    for (const g of D.groups) {
      expect(DESIGN_BY_ID.get(g.clothingSet.shirtDesign)?.targets, g.id).toContain('shirt');
      expect(g.flagSet.length + g.bannerSet.length).toBeGreaterThan(0);
      for (const f of g.flagSet) expect(DESIGN_BY_ID.get(f)?.targets).toContain('flag');
      for (const b of g.bannerSet) expect(DESIGN_BY_ID.get(b)?.targets).toContain('banner');
    }
    // ids reservados do contrato: camisas 212–215, bandeiras/faixas 216–223
    expect(D.groups.map((g) => g.clothingSet.shirtDesign).sort()).toEqual([212, 213, 214, 215]);
    expect(D.groups.flatMap((g) => [...g.flagSet, ...g.bannerSet]).sort((a, b) => a - b)).toEqual([216, 217, 218, 219, 220, 221, 222, 223]);
  });

  it('validação descarta grupo com design inexistente, id repetido, cor inválida ou categoria errada', () => {
    const g0 = RAW.groups[0];
    const r = parseSupporterData({ ...RAW, groups: [g0, { ...g0 }, { ...g0, id: 'x1', clothingSet: { shirtDesign: 9999 } }, { ...g0, id: 'x2', primaryColors: ['vermelho'] }, { ...g0, id: 'x3', category: 'POLITICAL' }, { ...g0, id: 'x4', flagSet: [212] }] });
    expect(r.data!.groups.map((g) => g.id)).toEqual([g0.id]);
    expect(r.errors).toHaveLength(5);
    expect(parseSupporterData(null).data).toBeNull();
    expect(parseSupporterData({ groups: [] }).data).toBeNull(); // sem neutralId
  });

  it('neutro funciona: escolha válida, sup 0, sem roupa obrigatória', () => {
    expect(isSupporterChoice(D, D.neutralId)).toBe(true);
    expect(supIndex(D, D.neutralId)).toBe(0);
    expect(supIndex(D, null)).toBe(0);
    expect(supAt(D, 0)).toBeNull();
    ids.forEach((id, i) => { expect(supIndex(D, id)).toBe(i + 1); expect(supAt(D, i + 1)?.id).toBe(id); });
    const r = decideSupporterChange(D, fresh(), D.neutralId, [], 0);
    expect(r.kind).toBe('applied');
  });

  it('designs das torcidas: camisas no sistema de shader (slots ≤ 19, padrões próprios), pesos iguais na multidão', () => {
    for (const id of [212, 213, 214, 215]) {
      const d = DESIGN_BY_ID.get(id)!;
      expect(d.family).toBe('football');
      expect(d.texture).toBeUndefined(); // sem textura por design
      expect(PATTERN_CODE[d.pattern]).toBeGreaterThan(0);
      expect(shirtSlot(id)).toBeGreaterThan(0);
    }
    expect(shirtDesigns().length).toBeLessThanOrEqual(19);
    const w = [212, 213, 214, 215, 216, 217, 218, 219, 220, 221, 222, 223].map((i) => DESIGN_BY_ID.get(i)!.crowdWeight);
    expect(new Set(w).size).toBe(1);
    // rótulos/chaves sem nome de clube (os nomes só existem nos DADOS)
    for (const i of [212, 213, 214, 215, 216, 217, 218, 219, 220, 221, 222, 223]) {
      const d = DESIGN_BY_ID.get(i)!;
      expect(`${d.key} ${d.label}`).not.toMatch(/flamengo|vasco|fluminense|botafogo/i);
      expect(d.lines ?? []).toEqual([]);
    }
  });

  it('"vestir as cores" só muda camisa/cores e passa no validador nos 4 corpos', () => {
    for (const body of ['homem', 'mulher', 'idoso', 'idosa'] as const) {
      for (const g of D.groups) {
        const base = validateAppearance({ ...DEFAULT_PLAYER_APPEARANCE[body], topStyle: 'camiseta' })!;
        const a = validateAppearance({ ...base, ...supporterOutfit(g) })!;
        expect(a.shirtDesign, `${body}/${g.id}`).toBe(g.clothingSet.shirtDesign);
        expect({ ...a, shirtDesign: 0, top: 0, bottom: 0, shoes: 0 }).toEqual({ ...base, shirtDesign: 0, top: 0, bottom: 0, shoes: 0 });
      }
    }
  });
});

describe('torcidas: política de troca', () => {
  it('fora de evento: aplica já; cooldown entre trocas; pedir a atual não muda nada', () => {
    let st = fresh();
    const r1 = decideSupporterChange(D, st, ids[0], [], 1000);
    expect(r1.kind).toBe('applied');
    st = r1.state;
    expect(st).toEqual({ current: ids[0], pending: null, changedAt: 1000 });
    expect(decideSupporterChange(D, st, ids[0], [], 2000).kind).toBe('unchanged');
    const r2 = decideSupporterChange(D, st, ids[1], [], 2000);
    expect(r2).toMatchObject({ kind: 'cooldown' });
    expect((r2 as { retryInS: number }).retryInS).toBe(D.changePolicy.cooldownS - 1);
    expect(decideSupporterChange(D, st, ids[1], [], 1000 + D.changePolicy.cooldownS * 1000).kind).toBe('applied');
    expect(decideSupporterChange(D, st, 'time_inexistente', [], 1e9).kind).toBe('invalid');
  });

  it('dentro de evento competitivo (deferDuringEventKinds): fica PENDENTE e aplica no fim/saída', () => {
    const kind = D.changePolicy.deferDuringEventKinds[0];
    expect(D.changePolicy.deferDuringEventKinds).toEqual(expect.arrayContaining(['confronto_grupos', 'torcida']));
    const st0: SupporterState = { current: ids[0], pending: null, changedAt: 0 };
    const r = decideSupporterChange(D, st0, ids[2], [kind], 1e9);
    expect(r.kind).toBe('deferred');
    expect(r.state).toEqual({ current: ids[0], pending: ids[2], changedAt: 0 });
    expect(settlePending(D, r.state, [kind], 2e9)).toBeNull(); // ainda no evento
    expect(settlePending(D, r.state, [], 2e9)).toEqual({ current: ids[2], pending: null, changedAt: 2e9 });
    // formato não competitivo (caminhada) não adia
    expect(decideSupporterChange(D, st0, ids[2], ['caminhada'], 1e9).kind).toBe('applied');
    // pedir de novo a atual cancela a pendência
    expect(decideSupporterChange(D, r.state, ids[0], [kind], 1e9).state.pending).toBeNull();
  });
});

describe('torcidas: neutralidade', () => {
  it('nenhum nome de clube em src/ nem server/src/ (inclusive comentários)', () => {
    const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (['node_modules', 'generated'].includes(e.name) ? [] : walk(`${d}/${e.name}`)) : [`${d}/${e.name}`]));
    // exceção única: lista de senhas fracas do cadastro (server/src/auth/password.ts) — palavras proibidas como senha
    const bad = [...walk('src'), ...walk('server/src')].filter((f) => /\.ts$/.test(f) && f !== 'server/src/auth/password.ts' && /(?<!\p{L})(flamengo|vasco|fluminense|botafogo)(?!\p{L})/iu.test(readFileSync(f, 'utf8')));
    expect(bad).toEqual([]);
    // os ids das torcidas também não aparecem como literal no código
    const lit = [...walk('src'), ...walk('server/src')].filter((f) => /\.ts$/.test(f) && f !== 'server/src/auth/password.ts' && ids.some((k) => readFileSync(f, 'utf8').includes(`'${k}'`)));
    expect(lit).toEqual([]);
  });

  it('torcida não entra em regra de jogo: movimento, combate, acesso, rede e qualidade não citam torcida', () => {
    for (const f of ['src/net/rules.ts', 'src/net/authority.ts', 'src/combat/policy.ts', 'src/access/policy.ts', 'src/renderer/quality.ts', 'server/src/combat/CombatSystem.ts', 'src/social/actionRules.ts']) {
      const t = readFileSync(f, 'utf8').replace(/\/\*\*[^]*?\*\//g, '');
      expect(t, f).not.toMatch(/supporter|supIndex|\.sup\b/i);
    }
  });
});

// ------------------------------------------------------------------ eventos
function fakeRoom() {
  const ps = new Map<string, ParticipantView>();
  const sent: { sid: string; type: string; msg: any }[] = [];
  const emitted: GameplayEnvelope[] = [];
  const host: EventHost = {
    participant: (sid) => ps.get(sid) ?? null,
    players: () => ps.keys(),
    send: (sid, type, msg) => sent.push({ sid, type, msg }),
    emit: (sid, ev) => emitted.push({ sid, at: 0, ev }),
    zoneOf: () => 'CENTRO',
  };
  const add = (sid: string, o: Partial<ParticipantView> = {}) => { ps.set(sid, { sid, name: sid, x: 0, z: 0, vehicleKind: null, groupKey: null, status: 0, dropped: false, onPlatform: false, ...o }); return ps.get(sid)!; };
  return { ps, sent, emitted, host, add };
}

describe('encontro de torcidas (formato torcida)', () => {
  const ev = JSON.parse(readFileSync('public/events/manifestacao.json', 'utf8')) as EventDef;
  const def = sanitizeAgenda(ev.agenda).find((d) => d.format === 'torcida')!;

  it('está na agenda dos dados, com uma concentração por torcida existente', () => {
    expect(def).toBeTruthy();
    expect(def.supporters!.points.map((p) => p.group).sort()).toEqual([...ids].sort());
    expect(def.zones).toEqual(['CENTRO']); // zonas do mundo inalteradas (avenida toda COMBAT)
  });

  it('concentrações com sup (NPCs vestem as cores) e participação por presença na SUA concentração; sem placar', () => {
    const room = fakeRoom();
    const clock = { t: 0 };
    const rt = new EventRuntime([def], room.host, axis, { clock: () => clock.t });
    const occ0 = (def.recurrence.offsetMin * 60_000);
    room.add('a', { supporter: ids[0] }); room.add('b', { supporter: ids[1] }); room.add('n', { supporter: null });
    clock.t = occ0 - 60_000; rt.tick(clock.t, 100);
    const inst = rt.instances()[0];
    expect(inst.state).toBe('REGISTRATION');
    for (const s of ['a', 'b', 'n']) expect(rt.join(s, inst.inst)).toEqual({ ok: true });
    clock.t = occ0 + 100; rt.tick(clock.t, 100);
    expect(rt.get(inst.inst)!.state).toBe('ACTIVE');
    const pts = rt.rallies();
    expect(pts.filter((p) => p.sup).map((p) => p.sup).sort()).toEqual([1, 2, 3, 4]);
    // a fica na concentração da sua torcida; b na concentração de OUTRA torcida (não conta); n em qualquer uma
    const own = pts.find((p) => p.sup === 1)!, other = pts.find((p) => p.sup === 3)!;
    Object.assign(room.ps.get('a')!, { x: own.x, z: own.z });
    Object.assign(room.ps.get('b')!, { x: other.x, z: other.z });
    Object.assign(room.ps.get('n')!, { x: other.x, z: other.z });
    const end = inst.endsAt + 200;
    while (clock.t < end) { clock.t += 100; rt.tick(clock.t, 100); }
    const done = room.emitted.filter((e) => e.ev.type === 'event_complete').map((e) => e.sid).sort();
    expect(done).toEqual(['a', 'n']);
    expect(rt.results(inst.inst)?.score).toBeUndefined();
    // evt_pts enviado com sup e sigla
    const wire = room.sent.filter((s) => s.type === 'evt_pts').flatMap((s) => s.msg.list);
    expect(wire.some((p: { sup?: number; label: string }) => p.sup === 1 && p.label === D.groups[0].shortName)).toBe(true);
  });
});

describe('RoomSupporters: troca de grupo do evento adiada durante confronto; sup na rede', () => {
  it('confronto vivo: troca de grupo fica para a saída; sem evento aplica já; sem conta usa a política na sessão', () => {
    let inst: EventInstance | null = null;
    const groupKeys = new Map<string, string | null>([['s1', 'g1']]);
    const players = new Map<string, { sup: number }>([['s1', { sup: 0 }]]);
    const rs = new RoomSupporters({
      players: () => players.entries(), userOf: () => null, instanceOf: () => inst,
      setGroupKey: (sid, k) => { groupKeys.set(sid, k); }, store: () => null, now: () => 1e12,
    });
    rs.join('s1', players.get('s1')!, null, ids[1]);
    expect(players.get('s1')!.sup).toBe(2);
    // sem evento: troca aplicada
    expect(rs.groupChange('s1', 'g2', 'g1')).toBe(true);
    // inscrito num confronto vivo (regras de grupo): adiada
    inst = { state: 'ACTIVE', def: { format: 'confronto_grupos', groupRules: { allowed: ['g1', 'g2'] } } } as unknown as EventInstance;
    rs.tick(1000);
    expect(rs.groupChange('s1', 'g2', 'g1')).toBe(false);
    expect(groupKeys.get('s1')).toBe('g1');
    // troca de torcida durante o confronto: pendente
    expect(rs.requestAnon('s1', players.get('s1'), ids[3])).toMatchObject({ ok: true, deferred: true });
    expect(players.get('s1')!.sup).toBe(2);
    // saiu do evento: grupo e torcida aplicados
    inst = null;
    rs.tick(1000);
    expect(groupKeys.get('s1')).toBe('g2');
    expect(players.get('s1')!.sup).toBe(4);
    rs.dispose();
  });
});

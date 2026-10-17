/**
 * Rodada 9 — palco de debate em texto (server/src/debate/DebateRunner.ts) sem rede: fila, turnos pelos DADOS, só o
 * orador fala, moderação = pipeline do chat (ChatService.screen → textModeration), mute por identidade, sanções,
 * reações com limite e agregadas, plateia por proximidade, denúncia DEBATE_LINE.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { ChatService, type ChatIdentity } from '../server/src/chat/ChatService';
import { DebateRunner } from '../server/src/debate/DebateRunner';
import { DebateHost, debateWindow, loadDebateDefs, validDebate } from '../server/src/debate/DebateHost';
import { MemoryDataStore } from '../server/src/data/memory';
import { textModeration } from '../src/moderation/text';
import { DEBATE_RULES, REACTION_LABEL, clock, debateSeats, reactionSummary } from '../src/events/debate';
import type { ScheduledEventDef } from '../src/events/schedule';
import type { GameplayEnvelope } from '../src/gameplay/events';

const SPOT = { x: 100, z: 0, heading: 0 };
const def = (o: Partial<NonNullable<ScheduledEventDef['debate']>> = {}): ScheduledEventDef => ({
  id: 'dbt_teste', format: 'debate', name: 'Debate teste', description: '', zones: ['CENTRO'],
  recurrence: { everyMin: 20, offsetMin: 0, registrationMin: 0, startingS: 0, durationMin: 18 }, capacity: 10, minParticipants: 0, rewards: [],
  debate: { stageSpot: 'stage0', turnSeconds: 40, turns: 3, seats: 3, reactionsPerMin: 4, topics: ['Tema neutro A', 'Tema neutro B'], ...o },
});

type Ident = ChatIdentity & { nid: number };
function setup(o: Partial<NonNullable<ScheduledEventDef['debate']>> = {}, store: MemoryDataStore | null = null) {
  const out = new Map<string, { type: string; msg: any }[]>();
  const pos = new Map<string, { x: number; z: number }>();
  const ids = new Map<string, Ident>();
  const events: GameplayEnvelope[] = [];
  const gestures: [string, string][] = [];
  const inbox = (sid: string) => { let l = out.get(sid); if (!l) out.set(sid, (l = [])); return l; };
  const chat = new ChatService({ nidOf: (sid) => ids.get(sid)?.nid ?? 0, posOf: (sid) => pos.get(sid), near: () => {}, broadcast: () => {},
    identityOfNid: (nid) => { for (const [sid, i] of ids) if (i.nid === nid) return { sid, userId: i.userId, nickname: i.nickname }; return undefined; } }, { log: () => {}, secret: 's' });
  const runner = new DebateRunner(def(o), SPOT, {
    send: (sid, type, msg) => inbox(sid).push({ type, msg }),
    who: (sid) => { const i = ids.get(sid); return i ? { nick: i.nickname, nid: i.nid, state: i.state, role: i.role, userId: i.userId } : undefined; },
    pos: (sid) => pos.get(sid),
    near: (x, z, r, fn) => { for (const [sid, p] of pos) if (Math.hypot(p.x - x, p.z - z) <= r) fn(sid); },
    screen: (sid, text, cap, now) => chat.screen(sid, text, cap, now),
    keyOf: (sid) => chat.keyOf(sid),
    mutes: (v, k) => chat.mutes(v, k),
    emit: (sid, ev, at) => events.push({ sid, ev, at }),
    gesture: (sid, k) => gestures.push([sid, k]),
    log: () => {},
  }, { store, eventId: 'teste' });
  chat.onMute((owners, key, on) => runner.muted(owners, key, on));
  let n = 1;
  const join = (sid: string, at: [number, number] | null, ident: Partial<ChatIdentity> = {}) => {
    const i: Ident = { userId: `u-${sid}`, nickname: sid, state: 'PLAYER', role: 'player', groupKey: null, nid: at ? n++ : 0, ...ident };
    ids.set(sid, i);
    if (at) pos.set(sid, { x: at[0], z: at[1] });
    chat.join(sid, i, { send: (t, m) => inbox(sid).push({ type: t, msg: m }) });
  };
  const of = (sid: string, type: string) => (out.get(sid) ?? []).filter((m) => m.type === type).map((m) => m.msg);
  const last = (sid: string, type: string) => of(sid, type).at(-1);
  return { runner, chat, join, of, last, ids, pos, events, gestures };
}

describe('debate — fila e turnos', () => {
  it('ordem de chegada, lugares no palco, turno com a duração dos DADOS e passagem para o próximo', () => {
    const t = setup({ turnSeconds: 40 });
    t.join('A', [101, 3]); t.join('B', [99, 4]); t.join('C', [100, 6]);
    t.runner.start('dbt_teste@0', 0);
    t.runner.tick(1000);
    expect(t.runner.queueReq('A', { on: true }, 1000)).toEqual({ ok: true });
    expect(t.runner.queueReq('B', { on: true }, 1100)).toEqual({ ok: true });
    expect(t.runner.queueReq('C', { on: true }, 1200)).toEqual({ ok: true });
    expect(t.runner.speakerSid).toBe('A');
    expect(t.runner.queueSids).toEqual(['B', 'C']);
    const st = t.runner.state();
    expect(st).toMatchObject({ speaker: 'A', queue: ['B', 'C'], seats: ['A', 'B', 'C'], turn: 1, turns: 3, turnSeconds: 40, active: true, turnEndsAt: 1000 + 40_000 });
    expect(st.topic).toMatch(/Tema neutro/);
    expect(t.last('B', 'dbt_me')).toMatchObject({ pos: 1, speaking: false });
    expect(t.last('C', 'dbt_me')).toMatchObject({ pos: 2 });
    // antes do fim continua A; no fim (dados: 40 s) + pausa, B assume
    t.runner.tick(40_900);
    expect(t.runner.speakerSid).toBe('A');
    t.runner.tick(41_001);
    expect(t.runner.speakerSid).toBeNull();
    t.runner.tick(41_001 + DEBATE_RULES.gapMs);
    expect(t.runner.speakerSid).toBe('B');
    expect(t.runner.state().turnEndsAt).toBe(41_001 + DEBATE_RULES.gapMs + 40_000);
    expect(t.last('B', 'dbt_me')).toMatchObject({ speaking: true, pos: 0 });
  });

  it('outro turnSeconds nos dados muda o turno (nada fixo no código); orador pode passar a vez', () => {
    const t = setup({ turnSeconds: 12 });
    t.join('A', [100, 5]); t.join('B', [100, 6]);
    t.runner.start('x@0', 0);
    t.runner.queueReq('A', { on: true }, 0); t.runner.queueReq('B', { on: true }, 0);
    expect(t.runner.state().turnEndsAt).toBe(12_000);
    t.runner.queueReq('A', { on: false }, 3000); // passa a vez
    expect(t.runner.speakerSid).toBeNull();
    t.runner.tick(3000 + DEBATE_RULES.gapMs);
    expect(t.runner.speakerSid).toBe('B');
  });

  it('fila exige estar perto do palco, debate ativo e teto da fila', () => {
    const t = setup();
    t.join('L', [400, 0]); t.join('A', [100, 5]);
    expect(t.runner.queueReq('A', { on: true }, 0)).toMatchObject({ ok: false, reason: 'inativo' });
    t.runner.start('x@0', 0);
    expect(t.runner.queueReq('L', { on: true }, 0)).toMatchObject({ ok: false, reason: 'longe' });
    expect(t.last('L', 'dbt_denied')).toMatchObject({ kind: 'queue', reason: 'longe' });
    expect(t.runner.queueReq('A', { inst: 'outra@1', on: true }, 0)).toMatchObject({ ok: false, reason: 'inativo' });
  });
});

describe('debate — falas', () => {
  it('só o orador do turno fala; texto vai à plateia (perto), não a quem está longe', () => {
    const t = setup();
    t.join('A', [100, 5]); t.join('B', [100, 6]); t.join('C', [110, 10]); t.join('Longe', [500, 0]);
    t.runner.start('x@0', 0); t.runner.tick(1000);
    t.runner.queueReq('A', { on: true }, 1000); t.runner.queueReq('B', { on: true }, 1000);
    expect(t.runner.say('B', { text: 'posso falar?' }, 2000)).toMatchObject({ ok: false, reason: 'nao_e_sua_vez' });
    expect(t.runner.say('C', { text: 'eu também' }, 2000)).toMatchObject({ ok: false, reason: 'nao_e_sua_vez' });
    const r = t.runner.say('A', { text: 'Boa tarde, minha proposta é mais sombra na avenida' }, 2100);
    expect(r.ok).toBe(true);
    for (const s of ['A', 'B', 'C']) expect(t.of(s, 'dbt_line').map((l) => l.text)).toContain('Boa tarde, minha proposta é mais sombra na avenida');
    expect(t.of('Longe', 'dbt_line')).toHaveLength(0);
    expect(t.of('Longe', 'dbt')).toHaveLength(0); // estado só para a plateia (AOI do palco)
    expect(t.last('C', 'dbt_line')).toMatchObject({ nick: 'A', turn: 1 });
    expect(JSON.stringify(t.of('C', 'dbt_line'))).not.toContain('u-A'); // id de conta nunca vai ao cliente
  });

  it('moderação REUTILIZADA: palavra bloqueada rejeitada via textModeration (contexto chat), com o cooldown do chat', () => {
    const t = setup();
    t.join('A', [100, 5]); t.join('B', [100, 6]);
    t.runner.start('x@0', 0); t.runner.tick(1000);
    t.runner.queueReq('A', { on: true }, 1000);
    const spy = vi.spyOn(textModeration, 'check');
    expect(t.runner.say('A', { text: 'seu filho da puta' }, 2000)).toMatchObject({ ok: false, reason: 'bloqueado' });
    expect(spy).toHaveBeenCalledWith('seu filho da puta', 'chat');
    spy.mockRestore();
    expect(t.of('B', 'dbt_line')).toHaveLength(0);
    // o anti-flood/cooldown é o MESMO estado do chat (por autor): o chat também fica em cooldown
    expect(t.chat.send('A', { ch: 'geral', text: 'oi' }, 2100)).toMatchObject({ ok: false, reason: 'cooldown' });
    expect(t.runner.say('A', { text: 'oi‮olleh' }, 9000)).toMatchObject({ ok: false, reason: 'caracteres' });
  });

  it('mute por identidade: quem mutou não recebe as falas do orador e as já recebidas somem (dbt_hide)', () => {
    const t = setup();
    t.join('A', [100, 5]); t.join('B', [100, 6]); t.join('C', [101, 6]);
    t.runner.start('x@0', 0); t.runner.tick(1000);
    t.runner.queueReq('A', { on: true }, 1000);
    const first = t.runner.say('A', { text: 'primeira fala' }, 2000) as { id: string };
    t.chat.mute('B', { nid: t.ids.get('A')!.nid, on: true }, 2500);
    expect(t.last('B', 'dbt_hide')).toEqual({ ids: [first.id] });
    t.runner.say('A', { text: 'segunda fala' }, 3000);
    expect(t.of('B', 'dbt_line').map((l) => l.text)).toEqual(['primeira fala']);
    expect(t.of('C', 'dbt_line').map((l) => l.text)).toEqual(['primeira fala', 'segunda fala']);
  });

  it('sanções: suspenso não entra na fila nem fala; suspenso no meio do turno perde o turno; espectador não fala', () => {
    const t = setup();
    t.join('S', [100, 5], { state: 'SUSPENDED' }); t.join('A', [100, 6]); t.join('E', null, { role: 'spectator' });
    t.runner.start('x@0', 0);
    expect(t.runner.queueReq('S', { on: true }, 0)).toMatchObject({ ok: false, reason: 'sem_permissao' });
    expect(t.runner.queueReq('E', { on: true }, 0)).toMatchObject({ ok: false, reason: 'sem_permissao' });
    t.runner.queueReq('A', { on: true }, 0);
    expect(t.runner.say('A', { text: 'falando' }, 100).ok).toBe(true);
    t.ids.get('A')!.state = 'SUSPENDED'; // releitura do banco
    expect(t.runner.say('A', { text: 'ainda?' }, 200)).toMatchObject({ ok: false, reason: 'sem_permissao' });
    t.runner.tick(1500);
    expect(t.runner.speakerSid).toBeNull();
    t.ids.get('A')!.state = 'BANNED';
    expect(t.runner.queueReq('A', { on: true }, 9000)).toMatchObject({ ok: false, reason: 'sem_permissao' });
  });
});

describe('debate — reações da plateia', () => {
  it('limite por minuto (reactionsPerMin dos dados), contagem agregada por turno, gesto existente, evento de gameplay', () => {
    const t = setup({ reactionsPerMin: 4, turnSeconds: 30 });
    t.join('A', [100, 5]); t.join('B', [100, 6]); t.join('C', [102, 8]);
    t.runner.start('x@0', 0); t.runner.tick(1000);
    expect(t.runner.react('C', { r: 'aplauso' }, 1000)).toMatchObject({ ok: false, reason: 'inativo' }); // sem orador
    t.runner.queueReq('A', { on: true }, 1000); t.runner.queueReq('B', { on: true }, 1000);
    for (let i = 0; i < 4; i++) expect(t.runner.react('C', { r: i % 2 ? 'positiva' : 'aplauso' }, 2000 + i)).toEqual({ ok: true });
    expect(t.runner.react('C', { r: 'negativa' }, 2010)).toMatchObject({ ok: false, reason: 'limite' });
    expect(t.runner.react('C', { r: 'voto' }, 2010)).toMatchObject({ ok: false, reason: 'invalido' });
    expect(t.runner.react('B', { r: 'negativa' }, 2020)).toEqual({ ok: true });
    expect(t.runner.state().reactions).toEqual({ aplauso: 2, positiva: 2, negativa: 1 });
    expect(t.gestures.filter(([s]) => s === 'C').map(([, k]) => k)).toEqual(['clap', 'thumbs_up', 'clap', 'thumbs_up']);
    expect(t.events.filter((e) => e.ev.type === 'debate_react')).toHaveLength(5);
    // janela de 1 min: volta a poder
    expect(t.runner.react('C', { r: 'negativa' }, 62_001)).toEqual({ ok: true });
    // turno novo zera a contagem
    t.runner.tick(31_001 + 1000); t.runner.tick(31_001 + 1000 + DEBATE_RULES.gapMs);
    expect(t.runner.speakerSid).toBe('B');
    expect(t.runner.state().reactions).toEqual({ aplauso: 0, positiva: 0, negativa: 0 });
  });

  it('quem não está na plateia não reage; visitante (sem conta) não reage', () => {
    const t = setup();
    t.join('A', [100, 5]); t.join('Longe', [600, 0]); t.join('V', [101, 5], { state: 'VISITOR', role: 'spectator', userId: null });
    t.runner.start('x@0', 0); t.runner.tick(1000);
    t.runner.queueReq('A', { on: true }, 1000);
    expect(t.runner.react('Longe', { r: 'aplauso' }, 1100)).toMatchObject({ ok: false, reason: 'nao_assiste' });
    expect(t.runner.react('V', { r: 'aplauso' }, 1100)).toMatchObject({ ok: false, reason: 'sem_permissao' });
    // abrir pelo painel (dbt_watch) coloca na plateia
    t.runner.watch('Longe', { on: true });
    expect(t.last('Longe', 'dbt')).toMatchObject({ speaker: 'A' });
    expect(t.runner.react('Longe', { r: 'aplauso' }, 1200)).toEqual({ ok: true });
  });

  it('texto nunca fala em vencedor/votação: só "reações da plateia"', () => {
    const s = reactionSummary({ aplauso: 3, positiva: 1, negativa: 0 });
    expect(s).toBe('reações da plateia: 3 aplausos · 1 positiva · 0 negativas');
    // só o que vai para a tela/rede (comentários de documentação citam o que é PROIBIDO)
    const code = (f: string) => readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const all = [s, ...Object.values(REACTION_LABEL).flatMap((l) => Object.values(l)), code('src/events/debate.ts'), code('src/ui/DebatePanel.ts'), code('server/src/debate/DebateRunner.ts')].join('\n');
    expect(all).not.toMatch(/venceu|vencedor|ganhou|ganhador|vitória|placar|votação|votos|enquete|resultado/i);
  });
});

describe('debate — gameplay, denúncia, dados', () => {
  it('debate_turn ao concluir um turno com fala; debate_watch em lotes para a plateia', () => {
    const t = setup({ turnSeconds: 70 });
    t.join('A', [100, 5]); t.join('C', [103, 5]);
    t.runner.start('x@0', 0); t.runner.tick(1000);
    t.runner.queueReq('A', { on: true }, 1000);
    t.runner.say('A', { text: 'uma fala' }, 1500);
    for (let s = 2; s <= 72; s++) t.runner.tick(s * 1000);
    expect(t.events.find((e) => e.sid === 'A' && e.ev.type === 'debate_turn')).toBeTruthy();
    const w = t.events.filter((e) => e.sid === 'C' && e.ev.type === 'debate_watch');
    expect(w.length).toBe(2);
    expect(w[0].ev).toEqual({ type: 'debate_watch', seconds: DEBATE_RULES.watchBatchS });
  });

  it('denúncia de fala → Report DEBATE_LINE com evidência; própria/repetida/inexistente recusadas', async () => {
    const store = new MemoryDataStore();
    const t = setup({}, store);
    t.join('A', [100, 5]); t.join('B', [100, 6]);
    t.runner.start('x@0', 0); t.runner.tick(1000);
    t.runner.queueReq('A', { on: true }, 1000);
    const l = t.runner.say('A', { text: 'fala para denunciar' }, 2000) as { id: string };
    expect(await t.runner.report('A', { id: l.id, category: 'SPAM' }, 2100)).toMatchObject({ ok: false, r: 'propria' });
    expect(await t.runner.report('B', { id: 'zzz', category: 'SPAM' }, 2100)).toMatchObject({ ok: false, r: 'inexistente' });
    expect(await t.runner.report('B', { id: l.id, category: 'ASSEDIO', details: 'insistente' }, 2200)).toMatchObject({ ok: true });
    expect(await t.runner.report('B', { id: l.id, category: 'ASSEDIO' }, 2300)).toMatchObject({ ok: false, r: 'repetida' });
    const [rep] = await store.reports.list();
    expect(rep).toMatchObject({ reporterUserId: 'u-B', targetUserId: 'u-A', targetType: 'DEBATE_LINE', category: 'ASSEDIO', details: 'insistente', eventId: 'teste', reportedNicknameAtTime: 'A' });
    expect(rep.evidence).toMatchObject({ kind: 'debate', lineId: l.id, text: 'fala para denunciar', authorNick: 'A', turn: 1 });
    expect(t.last('B', 'dbt_report_res')).toMatchObject({ ok: false, r: 'repetida' });
  });

  it('dados: debates.json válido e neutro; janela de recorrência; lugares do palco; relógio', () => {
    const defs = loadDebateDefs(undefined);
    expect(defs.length).toBeGreaterThan(0);
    for (const d of defs) { expect(validDebate(d)).toBe(true); expect(d.debate!.turnSeconds).toBeGreaterThan(0); }
    expect(validDebate(def({ turnSeconds: 1 }))).toBe(false);
    const w = debateWindow('d', { everyMin: 20, offsetMin: 0, registrationMin: 0, startingS: 0, durationMin: 18 }, 20 * 60_000 + 5000);
    expect(w).toMatchObject({ inst: `d@${20 * 60_000}`, active: true, endsAt: 38 * 60_000 });
    expect(debateWindow('d', { everyMin: 20, offsetMin: 0, registrationMin: 0, startingS: 0, durationMin: 18 }, 39 * 60_000)).toMatchObject({ active: false, nextAt: 40 * 60_000 });
    const seats = debateSeats({ x: 0, z: 0, heading: 0 }, 3);
    expect(seats[0].z).toBeCloseTo(4.6); expect(seats[0].x).toBeCloseTo(0);
    expect(Math.abs(seats[1].x)).toBeCloseTo(1.9);
    expect(clock(222_000)).toBe('03:42'); expect(clock(-5)).toBe('00:00');
    // host: palco do manifest; estado ativo pela janela; agenda do debate
    const host = new DebateHost(defs, { eventSpots: [{ id: 'stage0', kind: 'stage', x: 0, z: 0, heading: 0 }] }, { send() {}, who: () => undefined, pos: () => undefined, near() {}, screen: () => ({ ok: false, reason: 'vazio', retryMs: 0 }), keyOf: () => null, mutes: () => false });
    host.tick(5000);
    expect(host.runner()?.inst).toBe(`${defs[0].id}@0`);
    expect(host.agenda(5000)[0]).toMatchObject({ format: 'debate', state: 'ACTIVE', count: 0 });
  });
});

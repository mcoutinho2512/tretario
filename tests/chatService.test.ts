import { describe, expect, it } from 'vitest';
import { ChatService, invalidChatChars, type ChatIdentity } from '../server/src/chat/ChatService';
import { MemoryDataStore } from '../server/src/data/memory';
import { SpatialGrid } from '../src/net/spatialGrid';
import { CHAT_RULES, floodCheck, newFloodState, type ChatMessage } from '../src/chat/protocol';
import { can } from '../src/access/policy';

class Conn {
  msgs: { type: string; msg: any }[] = [];
  send(type: string, msg: any) { this.msgs.push({ type, msg }); }
  chats(): ChatMessage[] { return this.msgs.filter((m) => m.type === 'chat').map((m) => m.msg); }
  last(type: string) { return [...this.msgs].reverse().find((m) => m.type === type)?.msg; }
}

const player = (nickname: string, groupKey: string | null = null, userId: string | null = null): ChatIdentity => ({ userId, nickname, state: 'PLAYER', role: 'player', groupKey });
const spectator: ChatIdentity = { userId: null, nickname: 'Espectador', state: 'VISITOR', role: 'spectator', groupKey: null };

function setup(store: MemoryDataStore | null = null) {
  const grid = new SpatialGrid(110);
  const slots = new Map<string, number>(), slotSid: string[] = [];
  const pos = new Map<string, { x: number; z: number }>();
  const conns = new Map<string, Conn>();
  const svc = new ChatService({
    nidOf: (sid) => (slots.has(sid) ? slots.get(sid)! + 1 : 0),
    posOf: (sid) => pos.get(sid),
    near: (x, z, r, fn) => grid.forEachInRadius(x, z, r, (sl) => fn(slotSid[sl])),
    broadcast: (type, msg, except) => { for (const [sid, c] of conns) if (!except.includes(sid)) c.send(type, msg); },
  }, { store, eventId: 'teste', log: () => {} });
  const join = (sid: string, ident: ChatIdentity, at?: [number, number]) => {
    const c = new Conn();
    conns.set(sid, c);
    if (at) { const sl = slotSid.length; slotSid.push(sid); slots.set(sid, sl); pos.set(sid, { x: at[0], z: at[1] }); grid.insert(sl, at[0], at[1]); }
    svc.join(sid, ident, c);
    return c;
  };
  return { svc, join, conns };
}

describe('anti-flood (floodCheck)', () => {
  it('rajada: 5 em 8 s passam, a 6ª cai em flood; cooldown dobra a cada infração', () => {
    const s = newFloodState();
    for (let i = 0; i < CHAT_RULES.burstMax; i++) expect(floodCheck(s, `msg ${i}`, 1000 + i * 100).ok).toBe(true);
    const f = floodCheck(s, 'mais uma', 1600);
    expect(f).toMatchObject({ ok: false, reason: 'flood', retryMs: CHAT_RULES.cooldownBaseMs });
    expect(floodCheck(s, 'x', 1700)).toMatchObject({ ok: false, reason: 'cooldown' });
    // depois do cooldown, nova rajada → infração 2 = 4 s
    const t = 1600 + CHAT_RULES.cooldownBaseMs + 1;
    const f2 = floodCheck(s, 'outra', t);
    expect(f2).toMatchObject({ ok: false, reason: 'flood', retryMs: CHAT_RULES.cooldownBaseMs * 2 });
  });
  it('mensagem repetida (ignora maiúsculas/espaços) dentro da janela', () => {
    const s = newFloodState();
    expect(floodCheck(s, 'Ocupa a Vargas', 0).ok).toBe(true);
    expect(floodCheck(s, '  ocupa   a vargas ', 3000)).toMatchObject({ ok: false, reason: 'repetida' });
    const later = newFloodState();
    expect(floodCheck(later, 'oi', 0).ok).toBe(true);
    expect(floodCheck(later, 'oi', CHAT_RULES.repeatWindowMs + 1).ok).toBe(true);
  });
});

describe('ChatService — escrever e moderar', () => {
  it('texto moderado: palavrão bloqueado (com cooldown), vazio, longo, caracteres inválidos', () => {
    const { svc, join } = setup();
    const a = join('A', player('Ana'), [0, 0]);
    expect(svc.send('A', { ch: 'geral', text: '   ' }, 0)).toMatchObject({ ok: false, reason: 'vazio' });
    expect(svc.send('A', { ch: 'geral', text: 'x'.repeat(CHAT_RULES.maxChars + 1) }, 10)).toMatchObject({ ok: false, reason: 'longo' });
    expect(svc.send('A', { ch: 'geral', text: 'oi‮olleh' }, 20)).toMatchObject({ ok: false, reason: 'caracteres' });
    expect(svc.send('A', { ch: 'geral', text: 'ź̂̃̄̅' }, 30)).toMatchObject({ ok: false, reason: 'caracteres' });
    const b = svc.send('A', { ch: 'geral', text: 'seu filho da puta' }, 40);
    expect(b).toMatchObject({ ok: false, reason: 'bloqueado' });
    expect(a.last('chat_denied')).toMatchObject({ reason: 'bloqueado', retryMs: CHAT_RULES.cooldownBaseMs });
    // cooldown valendo
    expect(svc.send('A', { ch: 'geral', text: 'desculpa' }, 100)).toMatchObject({ ok: false, reason: 'cooldown' });
    expect(svc.send('A', { ch: 'geral', text: 'desculpa' }, 40 + CHAT_RULES.cooldownBaseMs + 1)).toMatchObject({ ok: true });
    // canal inválido / formato inválido
    expect(svc.send('A', { ch: 'sussurro', text: 'oi' }, 9000)).toMatchObject({ ok: false, reason: 'vazio' });
    expect(svc.send('A', { ch: 'geral', text: 42 }, 9100)).toMatchObject({ ok: false, reason: 'vazio' });
  });

  it('espectador (visitante) e conta suspensa NÃO escrevem; ambos leem o GERAL', () => {
    const { svc, join } = setup();
    join('A', player('Ana'), [0, 0]);
    const s = join('S', spectator);
    const sus = join('X', { userId: 'u-x', nickname: 'Xis', state: 'SUSPENDED', role: 'spectator', groupKey: null });
    expect(s.last('chat_hello')).toMatchObject({ canWrite: false, why: 'visitante', canReport: false });
    expect(sus.last('chat_hello')).toMatchObject({ canWrite: false, why: 'suspenso' });
    expect(svc.send('S', { ch: 'geral', text: 'oi' }, 0)).toMatchObject({ ok: false, reason: 'sem_permissao' });
    expect(svc.send('X', { ch: 'geral', text: 'oi' }, 0)).toMatchObject({ ok: false, reason: 'sem_permissao' });
    expect(svc.send('A', { ch: 'geral', text: 'bem-vindos' }, 0)).toMatchObject({ ok: true });
    expect(s.chats().map((m) => m.text)).toEqual(['bem-vindos']);
    expect(sus.chats()).toHaveLength(1);
    // capacidades da política central
    expect(can('VISITOR', 'chat.write', 'spectator')).toBe(false);
    expect(can('SUSPENDED', 'chat.write')).toBe(false);
    expect(can('REGISTERED', 'chat.write')).toBe(false);
    expect(can('VISITOR', 'chat.read', 'spectator')).toBe(true);
  });

  it('mensagem não leva ids internos: só id, canal, apelido, nid, texto, hora', () => {
    const { svc, join } = setup();
    const a = join('A', player('Ana', 'g1', 'user-secreto'), [0, 0]);
    svc.send('A', { ch: 'grupo', text: 'oi grupo' }, 0);
    const m = a.chats()[0];
    expect(Object.keys(m).sort()).toEqual(['ch', 'group', 'id', 'nick', 'nid', 't', 'text']);
    expect(JSON.stringify(a.msgs)).not.toContain('user-secreto');
  });
});

describe('ChatService — destinatários (decididos pelo servidor)', () => {
  it('PROXIMIDADE: só quem está a ≤ raio da posição do autor (grade espacial); espectador não recebe', () => {
    const { svc, join } = setup();
    const a = join('A', player('Ana'), [0, 0]);
    const b = join('B', player('Bia'), [CHAT_RULES.proximityRadius - 2, 0]);
    const c = join('C', player('Caio'), [CHAT_RULES.proximityRadius + 5, 0]);
    const s = join('S', spectator);
    const r = svc.send('A', { ch: 'proximidade', text: 'alguém aí?' }, 0);
    expect(r).toMatchObject({ ok: true, recipients: 2 });
    expect(a.chats()).toHaveLength(1);
    expect(b.chats()[0]).toMatchObject({ ch: 'proximidade', nick: 'Ana', text: 'alguém aí?' });
    expect(c.chats()).toHaveLength(0);
    expect(s.chats()).toHaveLength(0);
    // o cliente não escolhe destinatário: campos extras são ignorados
    svc.send('A', { ch: 'proximidade', text: 'oi C', to: ['C'] }, 5000);
    expect(c.chats()).toHaveLength(0);
  });

  it('GERAL: todos (jogadores + espectadores); histórico curto para quem entra', () => {
    const { svc, join } = setup();
    join('A', player('Ana'), [0, 0]);
    const c = join('C', player('Caio'), [900, 0]);
    for (let i = 0; i < 3; i++) svc.send('A', { ch: 'geral', text: `aviso ${i}` }, i * 3000);
    expect(c.chats()).toHaveLength(3);
    const late = join('L', spectator);
    expect(late.last('chat_hello').history.map((m: ChatMessage) => m.text)).toEqual(['aviso 0', 'aviso 1', 'aviso 2']);
  });

  it('GRUPO: só o mesmo groupKey; sem grupo → sem_grupo', () => {
    const { svc, join } = setup();
    const a = join('A', player('Ana', 'azul'), [0, 0]);
    const b = join('B', player('Bia', 'azul'), [800, 0]);
    const c = join('C', player('Caio', 'verde'), [1, 0]);
    const n = join('N', player('Nil'), [2, 0]);
    expect(svc.send('A', { ch: 'grupo', text: 'concentração às 15h' }, 0)).toMatchObject({ ok: true, recipients: 2 });
    expect(b.chats()[0]).toMatchObject({ ch: 'grupo', group: 'azul' });
    expect(a.chats()).toHaveLength(1);
    expect(c.chats()).toHaveLength(0);
    expect(n.chats()).toHaveLength(0);
    expect(svc.send('N', { ch: 'grupo', text: 'e eu?' }, 0)).toMatchObject({ ok: false, reason: 'sem_grupo' });
    // saiu: o índice do grupo esquece
    svc.leave('B');
    expect(svc.send('A', { ch: 'grupo', text: 'B saiu' }, 9000)).toMatchObject({ ok: true, recipients: 1 });
  });

  it('teto global do GERAL por segundo', () => {
    const { svc, join } = setup();
    for (let i = 0; i < 10; i++) join(`P${i}`, player(`Pessoa${i}`), [i, 0]);
    const res = Array.from({ length: 10 }, (_, i) => svc.send(`P${i}`, { ch: 'geral', text: `oi ${i}` }, 500));
    expect(res.filter((r) => r.ok)).toHaveLength(8);
    expect(res[9]).toMatchObject({ ok: false, reason: 'flood' });
  });

  it('anti-flood por CONTA: reconectar não zera o cooldown', () => {
    const { svc, join } = setup();
    join('A1', player('Ana', null, 'u-ana'), [0, 0]);
    for (let i = 0; i < 5; i++) svc.send('A1', { ch: 'geral', text: `m${i}` }, i);
    expect(svc.send('A1', { ch: 'geral', text: 'm6' }, 10)).toMatchObject({ ok: false, reason: 'flood' });
    svc.leave('A1');
    join('A2', player('Ana', null, 'u-ana'), [0, 0]);
    expect(svc.send('A2', { ch: 'geral', text: 'voltei' }, 20)).toMatchObject({ ok: false, reason: 'cooldown' });
  });
});

describe('ChatService — mutar e denunciar', () => {
  it('mutar: o servidor não envia mais mensagens do autor a quem mutou (GERAL e PROXIMIDADE)', () => {
    const { svc, join } = setup();
    join('A', player('Ana'), [0, 0]);
    const b = join('B', player('Bia'), [3, 0]);
    svc.mute('B', { nick: 'ANA', on: true });
    svc.send('A', { ch: 'geral', text: 'um' }, 0);
    svc.send('A', { ch: 'proximidade', text: 'dois' }, 3000);
    expect(b.chats()).toHaveLength(0);
    svc.mute('B', { nick: 'Ana', on: false });
    svc.send('A', { ch: 'geral', text: 'três' }, 6000);
    expect(b.chats().map((m) => m.text)).toEqual(['três']);
    svc.mute('B', { list: ['ana', 'Bia'] }); // a si mesmo: ignorado
    expect(svc.mutedBy('B')).toEqual(['ana']);
  });

  it('mutar com conta: persiste em preferences.chatMuted e volta na próxima entrada', async () => {
    const store = new MemoryDataStore();
    const u = await store.users.create({ email: 'b@x', passwordHash: 'h' });
    await store.profiles.create({ userId: u.id, nickname: 'Bia', nicknameKey: 'bia' });
    const { svc, join } = setup(store);
    join('B', player('Bia', null, u.id), [0, 0]);
    svc.mute('B', { nick: 'Ana', on: true });
    await new Promise((r) => setTimeout(r, 5));
    expect((await store.profiles.byUserId(u.id))!.preferences.chatMuted).toEqual(['ana']);
    svc.leave('B');
    join('B2', player('Bia', null, u.id), [0, 0]);
    await new Promise((r) => setTimeout(r, 5));
    expect(svc.mutedBy('B2')).toEqual(['ana']);
  });

  it('denúncia grava Report com a CÓPIA do servidor (texto, canal, hora, autor) e categoria; limites', async () => {
    const store = new MemoryDataStore();
    const { svc, join } = setup(store);
    join('A', player('Ana', 'g', 'u-ana'), [0, 0]);
    const b = join('B', player('Bia', 'g', 'u-bia'), [3, 0]);
    join('C', player('Caio', null, 'u-caio'), [500, 0]);
    join('S', spectator);
    svc.send('A', { ch: 'geral', text: 'compre seguidores' }, 1000);
    svc.send('A', { ch: 'proximidade', text: 'mensagem perto' }, 4000);
    const [geral, perto] = b.chats();
    // o cliente não consegue trocar o texto da evidência: o servidor usa a cópia dele
    const r = await svc.report('B', { id: geral.id, category: 'SPAM', details: 'repetindo', text: 'falso' }, 5000);
    expect(r).toMatchObject({ ok: true });
    const [rep] = await store.reports.list();
    expect(rep.targetRef).toBe(`chat:teste:${geral.id}`);
    expect(rep).toMatchObject({ reporterUserId: 'u-bia', targetUserId: 'u-ana', targetType: 'CHAT_MESSAGE', category: 'SPAM', details: 'repetindo', eventId: 'teste', status: 'OPEN' });
    expect(rep.evidence).toMatchObject({ channel: 'geral', text: 'compre seguidores', authorNick: 'Ana', authorUserId: 'u-ana' });
    expect(rep.evidence.at).toBe(new Date(1000).toISOString());
    // repetida, própria, quem não recebeu, espectador visitante, inexistente
    expect(await svc.report('B', { id: geral.id, category: 'SPAM' }, 5100)).toMatchObject({ ok: false, r: 'repetida' });
    expect(await svc.report('A', { id: geral.id, category: 'SPAM' }, 5100)).toMatchObject({ ok: false, r: 'propria' });
    expect(await svc.report('C', { id: perto.id, category: 'ASSEDIO' }, 5100)).toMatchObject({ ok: false, r: 'inexistente' });
    expect(await svc.report('S', { id: geral.id, category: 'SPAM' }, 5100)).toMatchObject({ ok: false, r: 'sem_permissao' });
    expect(await svc.report('B', { id: 'zzz', category: 'SPAM' }, 5100)).toMatchObject({ ok: false, r: 'inexistente' });
    // categoria inválida → OUTRO
    expect(await svc.report('B', { id: perto.id, category: 'XYZ' }, 5200)).toMatchObject({ ok: true });
    expect((await store.reports.list()).find((x) => x.targetRef.endsWith(`:${perto.id}`))!.category).toBe('OUTRO');
    // limite por denunciante
    for (let i = 0; i < 8; i++) svc.send('A', { ch: 'geral', text: `spam número ${i}` }, 20_000 + i * 3000);
    const ids = b.chats().slice(2).map((m) => m.id);
    const out = [];
    for (const id of ids) out.push(await svc.report('B', { id, category: 'SPAM' }, 50_000));
    expect(out.filter((o) => o.ok).length).toBe(4); // 6 por janela (2 já usadas)
    expect(out.at(-1)).toMatchObject({ ok: false, r: 'limite' });
    // nenhuma resposta a cliente carrega userId
    expect(JSON.stringify(b.msgs)).not.toContain('u-ana');
  });

  it('caracteres inválidos (função pura)', () => {
    expect(invalidChatChars('olá, tudo bem? 🙂')).toBe(false);
    expect(invalidChatChars('ação São João')).toBe(false);
    expect(invalidChatChars('a​b')).toBe(true);
  });
});

describe('custo', () => {
  it('600 conexões: GERAL e PROXIMIDADE em < 5 ms por mensagem (sem laço global na proximidade)', () => {
    const { svc, join } = setup();
    for (let i = 0; i < 600; i++) join(`P${i}`, player(`Pessoa${i}`), [(i % 30) * 20, Math.floor(i / 30) * 20]);
    const t0 = performance.now();
    svc.send('P0', { ch: 'geral', text: 'teste de custo com uma frase de tamanho normal' }, 0);
    svc.send('P1', { ch: 'proximidade', text: 'perto' }, 0);
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(50);
    const st = svc.info();
    expect(st.maxBytes).toBeLessThan(200);
    expect(st.deliveries).toBeGreaterThan(600);
  });
});

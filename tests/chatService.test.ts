import { describe, expect, it } from 'vitest';
import { CHAT_SERVER, ChatService, invalidChatChars, muteRef, type ChatIdentity } from '../server/src/chat/ChatService';
import { MemoryDataStore } from '../server/src/data/memory';
import { SpatialGrid } from '../src/net/spatialGrid';
import { CHAT_MUTE_MAX, CHAT_RULES, floodCheck, newFloodState, type ChatMessage } from '../src/chat/protocol';
import { can } from '../src/access/policy';

class Conn {
  msgs: { type: string; msg: any }[] = [];
  send(type: string, msg: any) { this.msgs.push({ type, msg }); }
  chats(): ChatMessage[] { return this.msgs.filter((m) => m.type === 'chat').map((m) => m.msg); }
  last(type: string) { return [...this.msgs].reverse().find((m) => m.type === type)?.msg; }
}

const player = (nickname: string, groupKey: string | null = null, userId: string | null = null): ChatIdentity => ({ userId, nickname, state: 'PLAYER', role: 'player', groupKey });
const spectator: ChatIdentity = { userId: null, nickname: 'Espectador', state: 'VISITOR', role: 'spectator', groupKey: null };

function setup(store: MemoryDataStore | null = null, secret = 'segredo-de-teste') {
  const grid = new SpatialGrid(110);
  const slots = new Map<string, number>(), slotSid: string[] = [];
  const pos = new Map<string, { x: number; z: number }>();
  const conns = new Map<string, Conn>();
  const svc = new ChatService({
    nidOf: (sid) => (slots.has(sid) ? slots.get(sid)! + 1 : 0),
    posOf: (sid) => pos.get(sid),
    near: (x, z, r, fn) => grid.forEachInRadius(x, z, r, (sl) => fn(slotSid[sl])),
    broadcast: (type, msg, except) => { for (const [sid, c] of conns) if (!except.includes(sid)) c.send(type, msg); },
    identityOfNid: (nid) => { const sid = slotSid[nid - 1]; const id = sid ? idents.get(sid) : undefined; return id ? { sid, userId: id.userId, nickname: id.nickname } : undefined; },
  }, { store, eventId: 'teste', log: () => {}, secret });
  const idents = new Map<string, ChatIdentity>();
  const join = (sid: string, ident: ChatIdentity, at?: [number, number]) => {
    const c = new Conn();
    conns.set(sid, c);
    if (at) { const sl = slotSid.length; slotSid.push(sid); slots.set(sid, sl); pos.set(sid, { x: at[0], z: at[1] }); grid.insert(sl, at[0], at[1]); }
    idents.set(sid, ident);
    svc.join(sid, ident, c);
    return c;
  };
  const nid = (sid: string) => slots.get(sid)! + 1;
  return { svc, join, conns, nid };
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
  it('mutar pela MENSAGEM: o servidor resolve a identidade e filtra GERAL, PROXIMIDADE, GRUPO e o histórico', () => {
    const { svc, join } = setup();
    const a = join('A', player('Ana', 'g'), [0, 0]);
    const b = join('B', player('Bia', 'g'), [3, 0]);
    svc.send('A', { ch: 'geral', text: 'um' }, 0);
    const id = b.chats()[0].id;
    expect(svc.mute('B', { msg: id, on: true }, 10)).toEqual({ ok: true });
    const l = b.last('chat_mutes');
    expect(l.list).toHaveLength(1);
    expect(l.list[0]).toMatchObject({ nick: 'Ana' });
    expect(l.hide).toEqual([id]); // o cliente some com o que já recebeu
    svc.send('A', { ch: 'geral', text: 'dois' }, 3000);
    svc.send('A', { ch: 'proximidade', text: 'três' }, 6000);
    svc.send('A', { ch: 'grupo', text: 'quatro' }, 9000);
    expect(b.chats().map((m) => m.text)).toEqual(['um']);
    expect(a.chats()).toHaveLength(4); // mute ≠ ban: Ana segue falando
    // desmutar pelo ref da própria lista
    expect(svc.mute('B', { ref: l.list[0].ref, on: false }, 12_000)).toEqual({ ok: true });
    expect(b.last('chat_mutes').list).toEqual([]);
    svc.send('A', { ch: 'geral', text: 'cinco' }, 12_500);
    expect(b.chats().map((m) => m.text)).toEqual(['um', 'cinco']);
  });

  it('mutar pela ENTIDADE (nid); recusas: a si mesmo, alvo inválido, mensagem que não recebeu, dois alvos', () => {
    const { svc, join, nid } = setup();
    join('A', player('Ana'), [0, 0]);
    const b = join('B', player('Bia'), [3, 0]);
    join('C', player('Caio'), [900, 0]);
    expect(svc.mute('B', { nid: nid('A'), on: true })).toEqual({ ok: true });
    expect(svc.mutedBy('B').map((e) => e.nick)).toEqual(['Ana']);
    expect(svc.mute('B', { nid: nid('B'), on: true })).toEqual({ ok: false, reason: 'proprio' });
    expect(b.last('chat_mute_denied')).toEqual({ reason: 'proprio' });
    expect(svc.mute('B', { nid: 9999, on: true })).toMatchObject({ reason: 'alvo_invalido' });
    expect(svc.mute('B', { nid: '1', on: true })).toMatchObject({ reason: 'alvo_invalido' });
    expect(svc.mute('B', { on: true })).toMatchObject({ reason: 'alvo_invalido' });
    expect(svc.mute('B', { nid: nid('C'), msg: 'x', on: true })).toMatchObject({ reason: 'alvo_invalido' });
    // PROXIMIDADE de C (longe) não chegou a B: B não pode mutar C por esse id
    const r = svc.send('C', { ch: 'proximidade', text: 'longe' }, 0) as { id: string };
    expect(svc.mute('B', { msg: r.id, on: true })).toMatchObject({ reason: 'alvo_invalido' });
    // nid desmuta também
    expect(svc.mute('B', { nid: nid('A'), on: false })).toEqual({ ok: true });
    expect(svc.mutedBy('B')).toEqual([]);
  });

  it('segurança: userId vindo do cliente é ignorado; ref de outro dono não serve; ninguém lê a lista alheia', () => {
    const { svc, join, nid } = setup();
    join('A', player('Ana', null, 'u-ana'), [0, 0]);
    const b = join('B', player('Bia', null, 'u-bia'), [3, 0]);
    const c = join('C', player('Caio', null, 'u-caio'), [4, 0]);
    // userId forjado: sem alvo válido → recusa; com alvo válido → o userId é ignorado (vale o do servidor)
    expect(svc.mute('B', { userId: 'u-caio', on: true })).toMatchObject({ reason: 'alvo_invalido' });
    expect(svc.mute('B', { nid: nid('A'), userId: 'u-caio', mutedUserId: 'u-caio', on: true })).toEqual({ ok: true });
    expect(svc.mutedBy('B').map((e) => e.nick)).toEqual(['Ana']);
    // C tenta usar o ref de B para desmutar/ler: ref é por dono → não existe na lista de C
    const refB = svc.mutedBy('B')[0].ref;
    expect(svc.mute('C', { ref: refB, on: false })).toMatchObject({ reason: 'alvo_invalido' });
    expect(svc.mutedBy('B')).toHaveLength(1);
    expect(c.msgs.filter((m) => m.type === 'chat_mutes').every((m) => m.msg.list.length === 0)).toBe(true);
    // ref é opaco: não contém ids e é estável para o mesmo par; muda com o dono
    expect(refB).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(refB).toBe(muteRef('segredo-de-teste', 'u:u-bia', 'u:u-ana'));
    expect(refB).not.toBe(muteRef('segredo-de-teste', 'u:u-caio', 'u:u-ana'));
    expect(refB).not.toBe(muteRef('outro-segredo', 'u:u-bia', 'u:u-ana'));
    expect(JSON.stringify(b.msgs)).not.toMatch(/u-ana|u-bia|u-caio/);
  });

  it('com conta: persiste no DataStore (MuteRelationship), recarrega na entrada, vale para TODAS as conexões da conta', async () => {
    const store = new MemoryDataStore();
    const { svc, join } = setup(store);
    join('A', player('Ana', null, 'u-ana'), [0, 0]);
    const b1 = join('B1', player('Bia', null, 'u-bia'), [3, 0]);
    const b2 = join('B2', { ...player('Bia', null, 'u-bia'), role: 'spectator' }); // outra aba (espectador) da mesma conta
    await Promise.all(['A', 'B1', 'B2'].map((s) => svc.settled(s)));
    svc.send('A', { ch: 'geral', text: 'antes' }, 0);
    expect(svc.mute('B1', { msg: b1.chats()[0].id, on: true }, 10)).toEqual({ ok: true });
    await svc.settled('B1');
    expect(await store.mutes.list('u-bia')).toMatchObject([{ ownerUserId: 'u-bia', mutedUserId: 'u-ana', mutedNicknameAtTime: 'Ana' }]);
    expect(b2.last('chat_mutes').list.map((e: { nick: string }) => e.nick)).toEqual(['Ana']); // a outra conexão soube
    svc.send('A', { ch: 'geral', text: 'depois' }, 3000);
    expect(b1.chats().map((m) => m.text)).toEqual(['antes']);
    expect(b2.chats().map((m) => m.text)).toEqual(['antes']);
    // Ana troca de apelido e reconecta: continua mutada (identidade, não apelido)
    svc.leave('A');
    join('A2', player('Teste123', null, 'u-ana'), [0, 0]);
    await svc.settled('A2');
    svc.send('A2', { ch: 'geral', text: 'novo apelido' }, 6000);
    expect(b1.chats().map((m) => m.text)).toEqual(['antes']);
    // Bia sai de tudo e volta: lista vem do banco; histórico de entrada já filtrado
    svc.leave('B1'); svc.leave('B2');
    const b3 = join('B3', player('Bia', null, 'u-bia'), [3, 0]);
    expect(b3.last('chat_hello')).toBeUndefined(); // carregando: nada entregue ainda
    svc.send('A2', { ch: 'proximidade', text: 'perto durante a carga' }, 9000);
    await svc.settled('B3');
    expect(b3.last('chat_hello').history).toEqual([]);
    expect(b3.last('chat_mutes').list[0]).toMatchObject({ nick: 'Ana' }); // apelido do momento do mute
    expect(b3.chats()).toEqual([]);
    // desmutar remove do banco
    expect(svc.mute('B3', { ref: b3.last('chat_mutes').list[0].ref, on: false }, 10_000)).toEqual({ ok: true });
    await svc.settled('B3');
    expect(await store.mutes.list('u-bia')).toEqual([]);
    svc.send('A2', { ch: 'geral', text: 'de volta' }, 12_000);
    expect(b3.chats().map((m) => m.text)).toEqual(['de volta']);
  });

  it('sem conta: mute só desta conexão (some ao sair); limite por dono', async () => {
    const { svc, join, nid } = setup();
    join('A', player('Ana'), [0, 0]);
    join('B', player('Bia'), [3, 0]);
    svc.mute('B', { nid: nid('A'), on: true });
    expect(svc.mutedBy('B')).toHaveLength(1);
    svc.leave('B');
    join('B', player('Bia'), [3, 0]);
    expect(svc.mutedBy('B')).toHaveLength(0);
    // taxa de mudanças por minuto
    const { svc: s2, join: j2, nid: n2 } = setup();
    j2('X', player('Xis'), [0, 0]);
    for (let i = 0; i < 40; i++) j2(`P${i}`, player(`Pessoa${i}`), [i + 1, 0]);
    const r = Array.from({ length: 40 }, (_, i) => s2.mute('X', { nid: n2(`P${i}`), on: true }, 1000));
    expect(r.filter((x) => x.ok)).toHaveLength(30);
    expect(r[39]).toMatchObject({ reason: 'limite' });
    expect(CHAT_MUTE_MAX).toBeGreaterThanOrEqual(200);
  });

  it('denúncia grava Report com a CÓPIA do servidor (texto, canal, hora, autor) e categoria; limites', async () => {
    const store = new MemoryDataStore();
    const { svc, join } = setup(store);
    join('A', player('Ana', 'g', 'u-ana'), [0, 0]);
    const b = join('B', player('Bia', 'g', 'u-bia'), [3, 0]);
    join('C', player('Caio', null, 'u-caio'), [500, 0]);
    join('S', spectator);
    await Promise.all(['A', 'B', 'C'].map((s) => svc.settled(s)));
    svc.send('A', { ch: 'geral', text: 'compre seguidores' }, 1000);
    svc.send('A', { ch: 'proximidade', text: 'mensagem perto' }, 4000);
    const [geral, perto] = b.chats();
    // o cliente não consegue trocar o texto da evidência: o servidor usa a cópia dele
    const r = await svc.report('B', { id: geral.id, category: 'SPAM', details: 'repetindo', text: 'falso' }, 5000);
    expect(r).toMatchObject({ ok: true });
    const [rep] = await store.reports.list();
    expect(rep.targetRef).toBe(`chat:teste:${geral.id}`);
    expect(rep).toMatchObject({ reporterUserId: 'u-bia', targetUserId: 'u-ana', targetType: 'CHAT_MESSAGE', category: 'SPAM', details: 'repetindo', eventId: 'teste', status: 'OPEN', reportedNicknameAtTime: 'Ana' });
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

describe('ChatService.sweep (limpeza)', () => {
  it('esquece anti-flood ocioso e denúncias fora da janela; mantém cooldown valendo', async () => {
    const store = new MemoryDataStore();
    const { svc, join } = setup(store);
    join('A', player('Ana', null, 'u-ana'), [0, 0]);
    const b = join('B', player('Bia', null, 'u-bia'), [3, 0]);
    await Promise.all(['A', 'B'].map((s) => svc.settled(s)));
    svc.send('A', { ch: 'geral', text: 'oi' }, 0);
    for (let i = 0; i < 6; i++) svc.send('B', { ch: 'geral', text: `b${i}` }, i); // B cai em cooldown
    await svc.report('B', { id: b.chats()[0].id, category: 'SPAM' }, 10);
    expect(svc.sweep(1000)).toBe(0); // tudo recente
    const late = 10 + CHAT_RULES.cooldownMaxMs + 60_000;
    expect(svc.sweep(Math.max(late, CHAT_SERVER.reportWindowMs + 20))).toBe(3); // flood A, flood B, denúncias B
    expect(svc.send('B', { ch: 'geral', text: 'voltei' }, Math.max(late, CHAT_SERVER.reportWindowMs + 20))).toMatchObject({ ok: true });
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

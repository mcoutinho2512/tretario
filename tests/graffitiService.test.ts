import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GraffitiService } from '../server/src/graffiti/GraffitiService';
import { JsonFileGraffitiStore, MemoryGraffitiStore } from '../server/src/graffiti/store';
import { encodeGraffiti, type GraffitiContent } from '../src/graffiti/codec';
import { GF_RULES, GF_STATE } from '../src/graffiti/rules';
import type { GraffitiSurface } from '../src/graffiti/surfaces';
import type { GfWire } from '../src/graffiti/protocol';

const S = (id: string, x: number, persistence: 'temporary' | 'permanent' = 'temporary', max = 3): GraffitiSurface =>
  ({ id, kind: persistence === 'permanent' ? 'mural' : 'wall', persistence, o: [x, 0.3, 0], u: [1, 0, 0], v: [0, 1, 0], w: 8, h: 2.5, max });
const SURFS = [S('perto', 0), S('mural', 20, 'permanent', 1), S('longe', 1000)];

const content = (s = 1, text?: string): Uint8Array => {
  const c: GraffitiContent = { rect: { s, t: 0.5, w: 1.6, h: 0.8 }, items: [{ k: 'line', color: 2, width: 1, pts: [10, 10, 100, 60, 200, 20] }] };
  if (text) c.items.push({ k: 'text', color: 1, x: 128, y: 64, size: 24, text });
  return encodeGraffiti(c);
};

class Viewer {
  msgs: { type: string; msg: any }[] = [];
  have = new Set<number>();
  send(type: string, msg: any) {
    this.msgs.push({ type, msg });
    if (type === 'gf_add') for (const w of msg as GfWire[]) this.have.add(w.i);
    if (type === 'gf_del') for (const i of msg.i) this.have.delete(i);
  }
}

async function setup(rules = { ...GF_RULES, cooldownMs: 0 }, store = new MemoryGraffitiStore()) {
  const svc = new GraffitiService(SURFS, store, { radius: 100, slices: 1, rules, adminToken: 'segredo', log: () => {} });
  await svc.init(0);
  const pos = new Map<string, { x: number; z: number }>();
  const join = (sid: string, x: number, z: number, cid = `cid-${sid}-0000`) => {
    const v = new Viewer();
    pos.set(sid, { x, z });
    svc.join(sid, `nome_${sid}`, cid, v);
    svc.update(0, (s) => pos.get(s), sid);
    return v;
  };
  const tick = (now: number) => svc.update(now, (s) => pos.get(s));
  return { svc, pos, join, tick, store };
}

describe('GraffitiService — criação e distribuição', () => {
  it('A cria → B (perto) recebe; C (longe) não; D (entra depois, perto) recebe', async () => {
    const { svc, join } = await setup();
    const A = join('A', 1.5, 2), B = join('B', 30, 10), C = join('C', 900, 0);
    const res = svc.create('A', { s: 'perto', d: content(), n: 7 }, { x: 1.5, z: 2, ok: true }, 1000);
    expect(res).toMatchObject({ op: 'new', ok: true, n: 7 });
    expect(A.have.has(res.i!)).toBe(true);
    expect(A.msgs.find((m) => m.type === 'gf_add')!.msg[0].m).toBe(1); // "meu"
    expect(B.have.has(res.i!)).toBe(true);
    expect(B.msgs.find((m) => m.type === 'gf_add')!.msg[0].m).toBeUndefined();
    expect(C.msgs).toHaveLength(0);
    const D = join('D', 10, 5);
    expect(D.have.has(res.i!)).toBe(true);
    // o id anônimo do autor nunca vai para os clientes
    expect(JSON.stringify(B.msgs)).not.toContain('cid-A');
  });

  it('nada inválido ou parcial chega aos outros', async () => {
    const { svc, join } = await setup();
    join('A', 1.5, 2);
    const B = join('B', 5, 5);
    const bad = [
      { s: 'perto', d: content().subarray(0, 12), n: 1 },
      { s: 'perto', d: 'texto', n: 2 },
      { s: 'nao_existe', d: content(), n: 3 },
      { s: 'perto', d: content(1, 'caralho'), n: 4 },
    ];
    for (const m of bad) expect(svc.create('A', m, { x: 1.5, z: 2, ok: true }, 1000).ok).toBe(false);
    expect(svc.create('A', { s: 'perto', d: content() }, { x: 1.5, z: 9, ok: true }, 1000).r).toBe('distancia');
    expect(svc.create('A', { s: 'perto', d: content() }, { x: 1.5, z: -1, ok: true }, 1000).r).toBe('lado');
    expect(svc.create('A', { s: 'perto', d: content() }, { x: 1.5, z: 2, ok: false }, 1000).r).toBe('estado');
    expect(B.msgs).toHaveLength(0);
    expect(svc.count).toBe(0);
  });

  it('cooldown e cota valem por sessão E por id anônimo', async () => {
    const { svc, join } = await setup({ ...GF_RULES, cooldownMs: 10_000, maxActivePerPlayer: 2 });
    join('A', 1.5, 2, 'aparelho-1');
    expect(svc.create('A', { s: 'perto', d: content() }, { x: 1.5, z: 2, ok: true }, 0).ok).toBe(true);
    expect(svc.create('A', { s: 'perto', d: content() }, { x: 1.5, z: 2, ok: true }, 5000).r).toBe('cooldown');
    // reconectou (sessão nova) com o mesmo aparelho: cooldown continua
    svc.leave('A');
    join('A2', 1.5, 2, 'aparelho-1');
    expect(svc.create('A2', { s: 'perto', d: content() }, { x: 1.5, z: 2, ok: true }, 6000).r).toBe('cooldown');
    expect(svc.create('A2', { s: 'perto', d: content() }, { x: 1.5, z: 2, ok: true }, 11_000).ok).toBe(true);
    expect(svc.create('A2', { s: 'perto', d: content() }, { x: 1.5, z: 2, ok: true }, 30_000).r).toBe('cota');
  });

  it('máximo por superfície: temporária recicla a mais antiga; autorizada recusa', async () => {
    const { svc, join } = await setup();
    const players = ['P1', 'P2', 'P3', 'P4'];
    const B = join('B', 4, 4);
    const ids = players.map((p, k) => { join(p, 1.5, 2); return svc.create(p, { s: 'perto', d: content() }, { x: 1.5, z: 2, ok: true }, 100 + k).i!; });
    expect(svc.count).toBe(3);
    expect(svc.get(ids[0])).toBeUndefined();
    expect(B.msgs.some((m) => m.type === 'gf_del' && m.msg.r === 'evicted' && m.msg.i.includes(ids[0]))).toBe(true);
    join('Q1', 21.5, 2); join('Q2', 21.5, 2);
    expect(svc.create('Q1', { s: 'mural', d: content() }, { x: 21.5, z: 2, ok: true }, 200).ok).toBe(true);
    expect(svc.create('Q2', { s: 'mural', d: content() }, { x: 21.5, z: 2, ok: true }, 201).r).toBe('superficie_cheia');
  });

  it('total no mundo: sai o temporário mais antigo (nunca o autorizado)', async () => {
    const { svc, join } = await setup({ ...GF_RULES, cooldownMs: 0, maxTotal: 2 });
    join('Q', 21.5, 2); join('A', 1.5, 2); join('B', 1.5, 2);
    const m = svc.create('Q', { s: 'mural', d: content() }, { x: 21.5, z: 2, ok: true }, 1).i!;
    const a = svc.create('A', { s: 'perto', d: content() }, { x: 1.5, z: 2, ok: true }, 2).i!;
    svc.create('B', { s: 'perto', d: content() }, { x: 1.5, z: 2, ok: true }, 3);
    expect(svc.get(m)).toBeDefined();
    expect(svc.get(a)).toBeUndefined();
  });

  it('área de interesse: afastar-se descarta; voltar recebe de novo', async () => {
    const { svc, join, pos, tick } = await setup();
    join('A', 1.5, 2);
    const B = join('B', 5, 5);
    const id = svc.create('A', { s: 'perto', d: content() }, { x: 1.5, z: 2, ok: true }, 1).i!;
    pos.set('B', { x: 500, z: 0 }); tick(2);
    expect(B.have.has(id)).toBe(false);
    expect(B.msgs.at(-1)).toMatchObject({ type: 'gf_del', msg: { r: 'aoi' } });
    pos.set('B', { x: 5, z: 5 }); tick(3);
    expect(B.have.has(id)).toBe(true);
  });
});

describe('GraffitiService — moderação e TTL', () => {
  it('denúncias distintas ocultam; restaurar devolve', async () => {
    const { svc, join } = await setup({ ...GF_RULES, cooldownMs: 0, reportThreshold: 2 });
    join('A', 1.5, 2);
    const B = join('B', 5, 5), C = join('C', 6, 5);
    const id = svc.create('A', { s: 'perto', d: content(1, 'Fora fome') }, { x: 1.5, z: 2, ok: true }, 1).i!;
    expect(svc.report('A', id).r).toBe('proprio');
    expect(svc.report('B', id).ok).toBe(true);
    expect(svc.get(id)!.state).toBe(GF_STATE.REPORTED);
    expect(C.msgs.some((m) => m.type === 'gf_state' && m.msg.st === GF_STATE.REPORTED)).toBe(true);
    expect(svc.report('B', id).r).toBe('repetida');
    expect(svc.report('C', id).ok).toBe(true);
    expect(svc.get(id)!.state).toBe(GF_STATE.HIDDEN);
    expect(B.have.has(id)).toBe(false);
    expect(C.msgs.at(-1)).toMatchObject({ type: 'gf_del', msg: { r: 'hidden' } });
    // entra depois: oculto não vai
    const D = join('D', 5, 5);
    expect(D.have.has(id)).toBe(false);
    expect(svc.adminAction('restore', id)).toBe(true);
    expect(D.have.has(id)).toBe(true);
  });

  it('admin: token obrigatório; remover apaga do armazenamento', async () => {
    const store = new MemoryGraffitiStore();
    const { svc, join } = await setup(undefined, store);
    join('A', 1.5, 2);
    const B = join('B', 5, 5);
    const id = svc.create('A', { s: 'perto', d: content() }, { x: 1.5, z: 2, ok: true }, 1).i!;
    expect(store.map.has(id)).toBe(true);
    expect(svc.adminMessage('B', { token: 'errado', op: 'remove', i: id })).toMatchObject({ ok: false, r: 'token' });
    const list = svc.adminMessage('B', { token: 'segredo', op: 'list' }).list as { author: { clientId: string } }[];
    expect(list[0].author.clientId).toBe('cid-A-0000');
    expect(svc.adminMessage('B', { token: 'segredo', op: 'remove', i: id })).toMatchObject({ ok: true });
    expect(svc.get(id)).toBeUndefined();
    expect(store.map.has(id)).toBe(false);
    expect(B.msgs.at(-1)).toMatchObject({ type: 'gf_del', msg: { r: 'removed' } });
    const off = new GraffitiService(SURFS, new MemoryGraffitiStore(), { log: () => {} });
    expect(off.adminMessage('x', { token: '', op: 'list' }).r).toBe('desativado');
  });

  it('TTL: temporário expira e some dos clientes; autorizado fica', async () => {
    const { svc, join, tick } = await setup({ ...GF_RULES, cooldownMs: 0, ttlMs: 1000 });
    join('A', 1.5, 2); join('Q', 21.5, 2);
    const B = join('B', 10, 5);
    const t = svc.create('A', { s: 'perto', d: content() }, { x: 1.5, z: 2, ok: true }, 0).i!;
    const p = svc.create('Q', { s: 'mural', d: content() }, { x: 21.5, z: 2, ok: true }, 0).i!;
    tick(999);
    expect(B.have.has(t)).toBe(true);
    tick(2100);
    expect(svc.get(t)).toBeUndefined();
    expect(B.have.has(t)).toBe(false);
    expect(B.msgs.some((m) => m.type === 'gf_del' && m.msg.r === 'expired')).toBe(true);
    expect(svc.get(p)).toBeDefined();
  });
});

describe('persistência (JSON local)', () => {
  it('grava, recarrega e descarta expirados/superfícies inexistentes', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'pvgf-')), 'g.json');
    const store = new JsonFileGraffitiStore(file, 10_000);
    const { svc, join: j } = await setup({ ...GF_RULES, cooldownMs: 0, ttlMs: 5000 }, store as unknown as MemoryGraffitiStore);
    j('A', 1.5, 2); j('Q', 21.5, 2);
    const t = svc.create('A', { s: 'perto', d: content(1, 'Fora fome') }, { x: 1.5, z: 2, ok: true }, 0).i!;
    const p = svc.create('Q', { s: 'mural', d: content() }, { x: 21.5, z: 2, ok: true }, 0).i!;
    expect(existsSync(file)).toBe(false); // debounced
    await svc.flushStore();
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    expect(saved.records).toHaveLength(2);
    expect(saved.records.find((r: { id: number }) => r.id === t).author).toEqual({ sessionId: 'A', name: 'nome_A', clientId: 'cid-A-0000' });
    // reabre: o temporário já venceu (agora = 10 s), o autorizado volta
    const svc2 = new GraffitiService(SURFS, new JsonFileGraffitiStore(file, 10_000), { log: () => {} });
    await svc2.init(10_000);
    expect(svc2.get(t)).toBeUndefined();
    expect(svc2.get(p)).toBeDefined();
    // ids continuam crescendo depois de recarregar
    const v = new Viewer(); svc2.join('Z', 'z', 'cid-z-00000', v); svc2.update(10_001, () => ({ x: 1.5, z: 2 }), 'Z');
    expect(svc2.create('Z', { s: 'perto', d: content() }, { x: 1.5, z: 2, ok: true }, 10_002).i).toBeGreaterThan(p);
  });
});

describe('GraffitiService — limpeza dos limites temporários (rodada 9.1)', () => {
  const H = 3600_000;
  it('não derruba cooldown nem cota por hora ativos; vencidos saem (e a cota volta a valer do zero)', async () => {
    const { svc, join } = await setup({ ...GF_RULES, cooldownMs: 10_000, maxPerHour: 2, maxActivePerPlayer: 10 });
    join('A', 1.5, 2, 'aparelho-1');
    expect(svc.create('A', { s: 'perto', d: content() }, { x: 1.5, z: 2, ok: true }, 0).ok).toBe(true);
    expect(svc.limitKeys).toBe(2); // c:aparelho-1, s:A (sem conta)
    expect(svc.sweep(5000)).toBe(0); // cooldown ativo: fica
    expect(svc.create('A', { s: 'perto', d: content() }, { x: 1.5, z: 2, ok: true }, 6000).r).toBe('cooldown');
    expect(svc.create('A', { s: 'perto', d: content() }, { x: 1.5, z: 2, ok: true }, 20_000).ok).toBe(true);
    expect(svc.sweep(60_000)).toBe(0); // cooldown venceu, mas a janela de 1 h ainda conta (cota_hora)
    expect(svc.create('A', { s: 'perto', d: content() }, { x: 1.5, z: 2, ok: true }, 60_000).r).toBe('cota_hora');
    expect(svc.sweep(H + 19_000)).toBe(0); // a criação de 20 s ainda está na janela
    expect(svc.sweep(H + 20_001)).toBe(2);
    expect(svc.limitKeys).toBe(0);
    expect(svc.sweep(H + 30_000)).toBe(0); // idempotente
  });

  it('denúncias recentes seguram a chave; conta (u:) entra na contagem; pela limpeza periódica conta em rateLimitKeysDeleted', async () => {
    const { CleanupService, liveMemorySweepers } = await import('../server/src/cleanup/CleanupService');
    const { MemoryDataStore } = await import('../server/src/data/memory');
    const { svc, join } = await setup({ ...GF_RULES, cooldownMs: 10_000 });
    const v = new Viewer();
    svc.join('U', 'nome_U', 'aparelho-u', v, 'conta-1'); svc.update(0, () => ({ x: 1.5, z: 2 }), 'U');
    join('B', 3, 2, 'aparelho-b');
    const res = svc.create('U', { s: 'perto', d: content() }, { x: 1.5, z: 2, ok: true }, 0);
    expect(res.ok).toBe(true);
    expect(svc.report('B', res.i, H - 30_000).ok).toBe(true); // denúncia de B (chave c:aparelho-b)
    expect(svc.limitKeys).toBe(4); // c:aparelho-u, s:U, u:conta-1, c:aparelho-b
    liveMemorySweepers.add(svc);
    try {
      const c = new CleanupService(new MemoryDataStore(), { config: { intervalMs: 0, firstDelayMs: 0, sessionGraceMs: 0, codeGraceMs: 0, batch: 10, maxRunMs: 1000 }, now: () => H + 1, log: () => {}, sweepers: [{ kind: 'rateLimit', sweep: (n) => [...liveMemorySweepers].reduce((k, s) => k + s.sweep(n), 0) }] });
      expect((await c.run()).rateLimitKeysDeleted).toBe(3); // denúncia de B ainda na janela de 1 min: fica
      expect(svc.limitKeys).toBe(1);
      expect(svc.sweep(H + 31_000)).toBe(1);
    } finally { liveMemorySweepers.delete(svc); }
  });
});

import { describe, expect, it } from 'vitest';
import { GraffitiService, type GfReportEvent } from '../server/src/graffiti/GraffitiService';
import { MemoryGraffitiStore } from '../server/src/graffiti/store';
import { encodeGraffiti } from '../src/graffiti/codec';
import { GF_RULES } from '../src/graffiti/rules';
import type { GraffitiSurface } from '../src/graffiti/surfaces';
import { can } from '../src/access/policy';

const SURF: GraffitiSurface = { id: 'perto', kind: 'wall', persistence: 'temporary', o: [0, 0.3, 0], u: [1, 0, 0], v: [0, 1, 0], w: 8, h: 2.5, max: 20 };
const content = () => encodeGraffiti({ rect: { s: 1, t: 0.5, w: 1.6, h: 0.8 }, items: [{ k: 'line', color: 2, width: 1, pts: [10, 10, 100, 60] }] });
class V { msgs: { type: string; msg: any }[] = []; send(type: string, msg: any) { this.msgs.push({ type, msg }); } }

async function setup() {
  const events: GfReportEvent[] = [];
  const store = new MemoryGraffitiStore();
  const svc = new GraffitiService([SURF], store, { radius: 100, slices: 1, rules: { ...GF_RULES, cooldownMs: 0 }, log: () => {}, onReport: (e) => events.push(e) });
  await svc.init(0);
  return { svc, store, events };
}

describe('grafite — identidade do autor (rodada 8)', () => {
  it('autor autenticado: userId gravado no registro, nunca enviado a clientes; "meu" pela conta', async () => {
    const { svc, store } = await setup();
    const a = new V(), b = new V();
    svc.join('A', 'Ana', 'cid-aparelho-1', a, 'user-ana');
    svc.join('B', 'Bia', 'cid-aparelho-2', b, 'user-bia');
    svc.update(0, () => ({ x: 1.5, z: 2 }));
    const r = svc.create('A', { s: 'perto', d: content(), n: 1 }, { x: 1.5, z: 2, ok: true }, 1000);
    expect(r.ok).toBe(true);
    expect(store.map.get(r.i!)!.author).toMatchObject({ name: 'Ana', clientId: 'cid-aparelho-1', userId: 'user-ana' });
    const wire = JSON.stringify([...a.msgs, ...b.msgs]);
    expect(wire).not.toContain('user-ana');
    expect(wire).not.toContain('cid-aparelho-1');
    // mesma conta em outro aparelho: o grafite continua "meu"
    const a2 = new V();
    svc.join('A2', 'Ana', 'cid-aparelho-9', a2, 'user-ana');
    svc.update(0, () => ({ x: 1.5, z: 2 }), 'A2');
    expect(a2.msgs.find((m) => m.type === 'gf_add')!.msg[0].m).toBe(1);
  });

  it('jogador de teste continua anônimo (só clientId)', async () => {
    const { svc, store } = await setup();
    svc.join('T', 'Bot', 'cid-teste-0001', new V());
    svc.update(0, () => ({ x: 1.5, z: 2 }));
    const r = svc.create('T', { s: 'perto', d: content(), n: 1 }, { x: 1.5, z: 2, ok: true }, 1000);
    expect(store.map.get(r.i!)!.author.userId).toBeUndefined();
  });

  it('cota pela CONTA: trocar de aparelho e sessão não zera', async () => {
    const { svc } = await setup();
    const rules = svc.rules;
    let ok = 0;
    for (let i = 0; i < rules.maxActivePerPlayer + 2; i++) {
      const sid = `S${i}`;
      svc.join(sid, 'Ana', `cid-aparelho-${i}0000`, new V(), 'user-ana');
      svc.update(0, () => ({ x: 1.5, z: 2 }), sid);
      if (svc.create(sid, { s: 'perto', d: content(), n: i }, { x: 1.5, z: 2, ok: true }, 1000 + i * 100_000).ok) ok++;
    }
    expect(ok).toBe(rules.maxActivePerPlayer); // sem a cota por conta, todos passariam (sessão e aparelho novos)
  });

  it('denúncia aceita gera evento com autor identificado internamente e categoria', async () => {
    const { svc, events } = await setup();
    svc.join('A', 'Ana', 'cid-aparelho-1', new V(), 'user-ana');
    svc.join('B', 'Bia', 'cid-aparelho-2', new V(), 'user-bia');
    svc.update(0, () => ({ x: 1.5, z: 2 }));
    const r = svc.create('A', { s: 'perto', d: content(), n: 1 }, { x: 1.5, z: 2, ok: true }, 1000);
    expect(svc.report('B', r.i, 2000, 'ODIO')).toMatchObject({ ok: true });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ id: r.i, category: 'ODIO', reporterUserId: 'user-bia', author: { userId: 'user-ana' }, state: 'REPORTED' });
    // repetida: nenhum evento novo; categoria inválida → OUTRO
    expect(svc.report('B', r.i, 3000, 'ODIO').ok).toBe(false);
    expect(events).toHaveLength(1);
  });

  it('visitante e espectador não criam grafite (política central usada pelo gate da sala)', () => {
    expect(can('VISITOR', 'graffiti.create', 'spectator')).toBe(false);
    expect(can('PLAYER', 'graffiti.create', 'spectator')).toBe(false);
    expect(can('REGISTERED', 'graffiti.create')).toBe(false);
    expect(can('SUSPENDED', 'graffiti.create')).toBe(false);
    expect(can('PLAYER', 'graffiti.create', 'player')).toBe(true);
  });

  it('conexão sem viewer (espectador não entra no serviço) é recusada', async () => {
    const { svc } = await setup();
    expect(svc.create('ESPECTADOR', { s: 'perto', d: content(), n: 1 }, { x: 1.5, z: 2, ok: true }, 1000)).toMatchObject({ ok: false, r: 'estado' });
  });
});

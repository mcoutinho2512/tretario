/** Multidão distante v2: vida social opcional (+5 B só para quem está fazendo algo). */
import { describe, it, expect } from 'vitest';
import { CrowdTable, decodeCrowd, encodeCrowd, type CrowdEntry } from '../src/net/crowdCodec';

const base = (nid: number, social?: CrowdEntry['social']): CrowdEntry => ({ nid, x: 10, y: 0, z: -4, heading: 0.5, speed: 1.2, body: 1, status: 0, vehicle: false, social });

describe('codec da multidão com vida social', () => {
  it('ida e volta; bloco social só quando há ação ou item', () => {
    const e = [base(1), base(2, { act: 40, ageS: 3.25, prop: 1, design: 101 }), base(3, { act: 0, ageS: 0, prop: 0, design: 0 })];
    const buf = encodeCrowd(e);
    expect(buf.byteLength).toBe(3 + 11 * 3 + 5);
    const d = decodeCrowd(buf);
    expect(d[0].social).toBeUndefined();
    expect(d[1].social).toEqual({ act: 40, ageS: 3.25, prop: 1, design: 101 });
    expect(d[2].social).toBeUndefined();
  });
  it('tabela do servidor gera o mesmo formato (com e sem aparência)', () => {
    const t = new CrowdTable();
    const app = { skin: 0x112233, hair: 0x445566, top: 0x778899, bottom: 0xaabbcc };
    t.set(0, { ...base(7, { act: 2, ageS: 70, prop: 0, design: 0 }), app });
    t.set(1, { ...base(8), app });
    const d = decodeCrowd(t.build([0, 1], 2, (s) => s === 1));
    expect(d[0].social).toEqual({ act: 2, ageS: 63.75, prop: 0, design: 0 }); // idade satura
    expect(d[0].app).toBeUndefined();
    expect(d[1].social).toBeUndefined();
    expect(d[1].app).toEqual(app);
  });
});

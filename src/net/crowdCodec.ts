/**
 * Multidão distante (mensagem "crowd"): jogadores que estão na área do cliente mas FORA do limite de jogadores
 * detalhados da `StateView` (os mais próximos). Vão em binário compacto, em baixa frequência (2 Hz), e o cliente
 * os desenha como multidão instanciada — sem esqueleto, sem nome, sem física.
 *
 * Formato (little-endian):
 *   u8 versão (1) · u16 quantidade
 *   por entrada (11 B): u16 nid · i16 x (dm) · i16 y (dm) · i16 z (dm) · u8 rumo (256 passos) · u8 vel. (×20 m/s, máx 12,75)
 *                       · u8 flags (bits 0–1 corpo, 2–3 status, 4 em veículo, 5 = segue vida social, 7 = segue aparência)
 *   vida social (v2, só de quem está fazendo algo, +5 B): u8 ação · u8 idade da ação (¼ s, satura em 63,75 s)
 *                       · u8 item · u16 design — a multidão distante dança/levanta bandeira sem estado completo
 *   aparência (só na 1ª vez que o cliente vê aquele nid, +12 B): pele, cabelo, camisa, calça (RGB 3 B cada)
 */

export interface CrowdEntry {
  nid: number;
  x: number; y: number; z: number;
  heading: number;
  speed: number;
  body: number; // índice em BODIES
  status: number;
  vehicle: boolean;
  /** vida social (ação/item); ausente = nada */
  social?: { act: number; ageS: number; prop: number; design: number };
  app?: { skin: number; hair: number; top: number; bottom: number };
}

export const CROWD_VERSION = 2;
const BASE = 11, SOC = 5, APP = 12;
const hasSocial = (s: CrowdEntry['social']) => !!s && (s.act !== 0 || s.prop !== 0);
const age4 = (ageS: number) => Math.max(0, Math.min(255, Math.round(ageS * 4)));

const q16 = (v: number) => Math.max(-32768, Math.min(32767, Math.round(v * 10)));

export function encodeCrowd(entries: readonly CrowdEntry[]): Uint8Array {
  let n = 3;
  for (const e of entries) n += BASE + (hasSocial(e.social) ? SOC : 0) + (e.app ? APP : 0);
  const buf = new Uint8Array(n);
  const dv = new DataView(buf.buffer);
  dv.setUint8(0, CROWD_VERSION);
  dv.setUint16(1, Math.min(65535, entries.length), true);
  let o = 3;
  for (const e of entries) {
    dv.setUint16(o, e.nid & 0xffff, true);
    dv.setInt16(o + 2, q16(e.x), true);
    dv.setInt16(o + 4, q16(e.y), true);
    dv.setInt16(o + 6, q16(e.z), true);
    const h = ((e.heading % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    dv.setUint8(o + 8, Math.round((h / (Math.PI * 2)) * 256) & 255);
    dv.setUint8(o + 9, Math.max(0, Math.min(255, Math.round(e.speed * 20))));
    const soc = hasSocial(e.social);
    dv.setUint8(o + 10, (e.body & 3) | ((e.status & 3) << 2) | (e.vehicle ? 16 : 0) | (soc ? 32 : 0) | (e.app ? 128 : 0));
    o += BASE;
    if (soc) {
      const s = e.social!;
      dv.setUint8(o, s.act & 255); dv.setUint8(o + 1, age4(s.ageS)); dv.setUint8(o + 2, s.prop & 255); dv.setUint16(o + 3, s.design & 0xffff, true);
      o += SOC;
    }
    if (e.app) {
      for (const c of [e.app.skin, e.app.hair, e.app.top, e.app.bottom]) {
        buf[o] = (c >> 16) & 255; buf[o + 1] = (c >> 8) & 255; buf[o + 2] = c & 255;
        o += 3;
      }
    }
  }
  return buf;
}

/**
 * Tabela compartilhada (servidor): cada jogador é codificado UMA vez por rodada (11 B + 12 B de aparência, por slot);
 * a mensagem de cada cliente é só cópia de bytes dos slots que ele vê. Mesmo formato de `encodeCrowd`.
 */
export class CrowdTable {
  private rec = new Uint8Array(256 * BASE);
  private soc = new Uint8Array(256 * SOC);
  private app = new Uint8Array(256 * APP);
  private out = new Uint8Array(3 + 64 * (BASE + SOC + APP));
  private grow(slot: number) {
    if ((slot + 1) * BASE <= this.rec.length) return;
    let n = this.rec.length / BASE;
    while (n <= slot) n *= 2;
    const r = new Uint8Array(n * BASE); r.set(this.rec); this.rec = r;
    const so = new Uint8Array(n * SOC); so.set(this.soc); this.soc = so;
    const a = new Uint8Array(n * APP); a.set(this.app); this.app = a;
  }
  /** grava o registro do slot (aparência sempre; o bit 7 é decidido por cliente em `build`) */
  set(slot: number, e: CrowdEntry & { app: NonNullable<CrowdEntry['app']> }) {
    this.grow(slot);
    const r = this.rec, o = slot * BASE;
    const i16 = (at: number, v: number) => { const q = q16(v) & 0xffff; r[at] = q & 255; r[at + 1] = q >> 8; };
    r[o] = e.nid & 255; r[o + 1] = (e.nid >> 8) & 255;
    i16(o + 2, e.x); i16(o + 4, e.y); i16(o + 6, e.z);
    const h = ((e.heading % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    r[o + 8] = Math.round((h / (Math.PI * 2)) * 256) & 255;
    r[o + 9] = Math.max(0, Math.min(255, Math.round(e.speed * 20)));
    const hs = hasSocial(e.social);
    r[o + 10] = (e.body & 3) | ((e.status & 3) << 2) | (e.vehicle ? 16 : 0) | (hs ? 32 : 0);
    if (hs) {
      const s = e.social!, so = this.soc, q = slot * SOC;
      so[q] = s.act & 255; so[q + 1] = age4(s.ageS); so[q + 2] = s.prop & 255; so[q + 3] = s.design & 255; so[q + 4] = (s.design >> 8) & 255;
    }
    const a = this.app, p = slot * APP;
    let k = p;
    for (const c of [e.app.skin, e.app.hair, e.app.top, e.app.bottom]) { a[k] = (c >> 16) & 255; a[k + 1] = (c >> 8) & 255; a[k + 2] = c & 255; k += 3; }
  }
  /** mensagem para um cliente: `slots[0..n)`; `withApp(slot)` diz se aquele cliente ainda precisa da aparência */
  build(slots: ArrayLike<number>, n: number, withApp: (slot: number) => boolean): Uint8Array {
    const need = 3 + n * (BASE + SOC + APP);
    if (this.out.length < need) this.out = new Uint8Array(Math.max(need, this.out.length * 2));
    const out = this.out;
    let o = 3;
    for (let i = 0; i < n; i++) {
      const sl = slots[i];
      const rec = this.rec, rs = sl * BASE;
      for (let k = 0; k < BASE; k++) out[o + k] = rec[rs + k];
      const flagAt = o;
      o += BASE;
      if (rec[rs + 10] & 32) {
        const so = this.soc, ss = sl * SOC;
        for (let k = 0; k < SOC; k++) out[o + k] = so[ss + k];
        o += SOC;
      }
      if (withApp(sl)) {
        out[flagAt + 10] |= 0x80;
        const app = this.app, as = sl * APP;
        for (let k = 0; k < APP; k++) out[o + k] = app[as + k];
        o += APP;
      }
    }
    out[0] = CROWD_VERSION; out[1] = n & 255; out[2] = (n >> 8) & 255;
    return out.slice(0, o);
  }
}

export function decodeCrowd(buf: Uint8Array): CrowdEntry[] {
  if (buf.byteLength < 3 || buf[0] !== CROWD_VERSION) return [];
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const n = dv.getUint16(1, true);
  const out: CrowdEntry[] = [];
  let o = 3;
  for (let i = 0; i < n && o + BASE <= buf.byteLength; i++) {
    const f = dv.getUint8(o + 10);
    let h = (dv.getUint8(o + 8) / 256) * Math.PI * 2;
    if (h > Math.PI) h -= Math.PI * 2;
    const e: CrowdEntry = {
      nid: dv.getUint16(o, true),
      x: dv.getInt16(o + 2, true) / 10, y: dv.getInt16(o + 4, true) / 10, z: dv.getInt16(o + 6, true) / 10,
      heading: h, speed: dv.getUint8(o + 9) / 20,
      body: f & 3, status: (f >> 2) & 3, vehicle: (f & 16) !== 0,
    };
    o += BASE;
    if (f & 32) {
      if (o + SOC > buf.byteLength) break;
      e.social = { act: buf[o], ageS: buf[o + 1] / 4, prop: buf[o + 2], design: buf[o + 3] | (buf[o + 4] << 8) };
      o += SOC;
    }
    if (f & 128) {
      if (o + APP > buf.byteLength) break;
      const c = (k: number) => (buf[o + k] << 16) | (buf[o + k + 1] << 8) | buf[o + k + 2];
      e.app = { skin: c(0), hair: c(3), top: c(6), bottom: c(9) };
      o += APP;
    }
    out.push(e);
  }
  return out;
}

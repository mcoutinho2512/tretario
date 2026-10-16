/**
 * Peças variantes e variedade da multidão: registro (garments.ts) casado com os configs do Blender e com os GLBs
 * publicados; aparência empacotada; sorteio plausível e sem clones; validação da rede.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { randomAppearance, type BodyType, type CharacterAppearance } from '../src/characters/bodyTypes';
import { BODY_GARMENTS, GARMENT_SLOTS, packLook, pieceFile, resolveStyle, resolvedStyles, unpackLook } from '../src/characters/garments';
import { sanitizeShirtDesign, sanitizeStyle } from '../src/net/protocol';
import { DESIGN_BY_ID } from '../src/social/designs';

const BODIES: BodyType[] = ['homem', 'mulher', 'idoso', 'idosa'];

describe('peças variantes', () => {
  it('registro = configs do Blender (tools/character/variants)', () => {
    for (const b of BODIES) {
      const cfg = JSON.parse(readFileSync(`tools/character/variants/${b}.json`, 'utf8'));
      for (const slot of GARMENT_SLOTS) {
        const g = BODY_GARMENTS[b][slot];
        expect(cfg.styles[slot], `${b} ${slot}`).toBe(g.base);
        const v = cfg.variants.filter((x: { layer: string }) => x.layer === slot);
        expect(v.filter((x: { file?: string; derive?: string }) => x.file || x.derive).map((x: { style: string }) => x.style).sort(), `${b} ${slot}`).toEqual([...g.pieces].sort());
        expect(v.filter((x: { file?: string; derive?: string }) => !x.file && !x.derive).map((x: { style: string }) => x.style).sort()).toEqual([...(g.bare ?? [])].sort());
      }
    }
  });

  it('toda peça tem GLB publicado (LOD0 e LOD1)', () => {
    for (const b of BODIES) for (const slot of GARMENT_SLOTS) for (const st of BODY_GARMENTS[b][slot].pieces) {
      for (const l of [0, 1] as const) expect(existsSync(`public/characters/${pieceFile(b, slot, st, l)}`), pieceFile(b, slot, st, l)).toBe(true);
    }
  });

  it('estilo ausente ou de outro corpo cai na roupa base', () => {
    expect(resolveStyle('idoso', 'HAIR', 'afro')).toBe('curto');
    expect(resolveStyle('mulher', 'SHIRT', 'polo')).toBe('camiseta');
    expect(resolveStyle('homem', 'SHIRT', undefined)).toBe('camiseta');
    expect(resolveStyle('homem', 'HAIR', 'raspado')).toBe('raspado');
  });

  it('aparência empacotada ida e volta', () => {
    const a = { body: 'homem' as const, topStyle: 'camisa' as const, bottomStyle: 'bermuda' as const, shoeStyle: 'chinelo' as const, hairStyle: 'raspado' as const };
    expect(unpackLook(packLook(a))).toEqual({ top: 'camisa', bottom: 'bermuda', shoes: 'chinelo', bare: true });
    expect(packLook({ body: 'idosa' })).toBe(packLook({ body: 'idosa', topStyle: 'camiseta', bottomStyle: 'social', shoeStyle: 'sapato' }));
  });
});

/** assinatura VISUAL: o que muda o que se vê (corpo, cores, peças, design, acessório) */
const signature = (a: CharacterAppearance) => {
  const s = resolvedStyles(a);
  return [a.body, a.skin, a.hair, a.shirtDesign ? `d${a.shirtDesign}` : a.top, a.bottom, a.shoes, s.SHIRT, s.PANTS, s.SHOES, s.HAIR, a.accessory].join('|');
};

describe('variedade da multidão', () => {
  const crowd = Array.from({ length: 100 }, (_, i) => randomAppearance(1000 + i * 7919, BODIES[i % 4], { football: 0.2 }));

  it('100 pessoas sorteadas não parecem clones (≥ 80 assinaturas distintas)', () => {
    const n = new Set(crowd.map(signature)).size;
    expect(n).toBeGreaterThanOrEqual(80);
    // só as PEÇAS (sem cores) já variam bastante
    expect(new Set(crowd.map((a) => Object.values(resolvedStyles(a)).join('/'))).size).toBeGreaterThanOrEqual(25);
  });

  it('determinística pela semente', () => {
    expect(randomAppearance(42, 'mulher', { football: 0.2 })).toEqual(randomAppearance(42, 'mulher', { football: 0.2 }));
  });

  it('combinações plausíveis', () => {
    const many = Array.from({ length: 4000 }, (_, i) => randomAppearance(i * 2654435761, BODIES[i % 4], { football: 0.2 }));
    const old = many.filter((a) => a.body === 'idoso' || a.body === 'idosa');
    expect(old.filter((a) => resolvedStyles(a).SHIRT === 'regata').length / old.length).toBeLessThan(0.06);
    // calça social nunca com chinelo; bermuda quase nunca com sapato
    expect(many.some((a) => a.bottomStyle === 'social' && a.shoeStyle === 'chinelo')).toBe(false);
    const berm = many.filter((a) => a.bottomStyle === 'bermuda');
    expect(berm.filter((a) => a.shoeStyle === 'sapato').length / berm.length).toBeLessThan(0.08);
    // camisa de futebol: ~15–25 % num ato; sempre camiseta, só designs de camisa
    const fut = many.filter((a) => a.shirtDesign);
    expect(fut.length / many.length).toBeGreaterThan(0.12);
    expect(fut.length / many.length).toBeLessThan(0.25);
    for (const a of fut) {
      expect(a.topStyle).toBe('camiseta');
      expect(DESIGN_BY_ID.get(a.shirtDesign!)?.targets).toContain('shirt');
    }
    // dia a dia: bem menos
    const day = Array.from({ length: 2000 }, (_, i) => randomAppearance(i * 7919 + 3, BODIES[i % 4]));
    expect(day.filter((a) => a.shirtDesign).length / day.length).toBeLessThan(0.1);
  });
});

describe('validação da rede', () => {
  it('estilos só das listas; design só de camisa', () => {
    expect(sanitizeStyle('topStyle', 'regata')).toBe('regata');
    expect(sanitizeStyle('topStyle', 'bermuda')).toBe('');
    expect(sanitizeStyle('hairStyle', '<script>')).toBe('');
    expect(sanitizeStyle('shoeStyle', 3)).toBe('');
    expect(sanitizeShirtDesign(200)).toBe(200);
    expect(sanitizeShirtDesign(1)).toBe(0); // bandeira do Brasil: não é camisa
    expect(sanitizeShirtDesign('200')).toBe(0);
    expect(sanitizeShirtDesign(99999)).toBe(0);
  });
});

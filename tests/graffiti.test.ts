import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CANVAS_H, decodeGraffiti, encodeGraffiti, simplifyStroke, type GraffitiContent } from '../src/graffiti/codec';
import { checkText, sanitizeText } from '../src/moderation/basicFilter';
import { GF_RULES, GF_STATE, checkQuota, expiresAtFor, moderate, newAuthorLimits, recordCreation, validateContent, validateReach, type ModerationRec } from '../src/graffiti/rules';
import { distanceToSurface, nearestSurface, parseSurfaceFile, placeRect, rectInside, solidRing, surfacePoint, type GraffitiSurface } from '../src/graffiti/surfaces';

const wall: GraffitiSurface = { id: 'w', kind: 'wall', persistence: 'temporary', o: [0, 0.3, 0], u: [1, 0, 0], v: [0, 1, 0], w: 8, h: 2.5, max: 4 };
const mural: GraffitiSurface = { ...wall, id: 'm', kind: 'mural', persistence: 'permanent', ttlMs: 0 };
const ground: GraffitiSurface = { id: 'g', kind: 'ground', persistence: 'temporary', o: [10, 0.15, 14], u: [1, 0, 0], v: [0, 0, -1], w: 4, h: 4, max: 6 };

/** rabisco típico: 12 traços de 40 pontos + 2 símbolos + 1 texto */
function sample(rect = { s: 1, t: 0.8, w: 1.6, h: 0.8 }): GraffitiContent {
  const items: GraffitiContent['items'] = [];
  for (let k = 0; k < 12; k++) {
    const pts: number[] = [];
    for (let i = 0; i < 40; i++) pts.push(10 + i * 5, Math.round(60 + Math.sin(i / 3 + k) * 40));
    items.push({ k: 'line', color: k % 12, width: k % 3, pts });
  }
  items.push({ k: 'stamp', color: 2, sym: 0, x: 40, y: 40, size: 30, rot: 0 });
  items.push({ k: 'stamp', color: 3, sym: 3, x: 200, y: 90, size: 50, rot: 64 });
  items.push({ k: 'text', color: 1, x: 128, y: 64, size: 28, text: 'Fora fome! Educação já' });
  return { rect, items };
}

describe('codec do grafite', () => {
  it('ida e volta preserva tudo (incluindo UTF-8)', () => {
    const c = sample();
    const b = encodeGraffiti(c);
    const d = decodeGraffiti(b)!;
    expect(d).toEqual(c);
    expect(encodeGraffiti(d)).toEqual(b);
  });

  it('tamanho: 2 bytes por ponto + cabeçalhos pequenos', () => {
    const b = encodeGraffiti(sample());
    // 10 cabeçalho + 12 × (3 + 80) + 2 × 7 + (6 + 23 bytes UTF-8 de "Fora fome! Educação já")
    expect(b.length).toBe(10 + 12 * 83 + 14 + 6 + new TextEncoder().encode('Fora fome! Educação já').length);
    expect(b.length).toBeLessThan(GF_RULES.maxBytes);
  });

  it('rejeita lixo, truncado e sobras', () => {
    const b = encodeGraffiti(sample());
    expect(decodeGraffiti(b.subarray(0, b.length - 1))).toBeNull();
    expect(decodeGraffiti(Uint8Array.from([...b, 0]))).toBeNull();
    expect(decodeGraffiti(new Uint8Array([9, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBeNull();
    const bad = b.slice(); bad[10] = 7; // tipo de item inexistente
    expect(decodeGraffiti(bad)).toBeNull();
    // UTF-8 inválido no texto
    const t = encodeGraffiti({ rect: sample().rect, items: [{ k: 'text', color: 0, x: 1, y: 1, size: 20, text: 'ab' }] });
    t[t.length - 1] = 0xff;
    expect(decodeGraffiti(t)).toBeNull();
  });

  it('simplificação reduz pontos de traço reto e mantém as pontas', () => {
    const pts: number[] = [];
    for (let i = 0; i <= 100; i++) pts.push(i * 2, 50);
    const s = simplifyStroke(pts);
    expect(s).toEqual([0, 50, 200, 50]);
  });

  it('simplificação não apaga traço fechado (círculo)', () => {
    const pts: number[] = [];
    for (let i = 0; i <= 40; i++) pts.push(Math.round(128 + Math.cos((i / 40) * Math.PI * 2) * 40), Math.round(64 + Math.sin((i / 40) * Math.PI * 2) * 40));
    expect(simplifyStroke(pts).length).toBeGreaterThan(12);
  });
});

describe('superfícies', () => {
  it('ponto, distância e lado', () => {
    expect(surfacePoint(wall, 2, 1)).toEqual([2, 1.3, 0]);
    // normal de u=(1,0,0) × v=(0,1,0) = (0,0,1): pintável do lado +z
    expect(distanceToSurface(wall, 3, 2).front).toBe(true);
    expect(distanceToSurface(wall, 3, -2).front).toBe(false);
    expect(distanceToSurface(wall, 3, 2).d).toBeCloseTo(2);
    expect(distanceToSurface(wall, 10, 0).d).toBeCloseTo(2); // passou da ponta
    expect(distanceToSurface(ground, 12, 12).d).toBe(0); // dentro do chão
  });

  it('retângulo cabe e fica à altura dos olhos', () => {
    const r = placeRect(wall, 7.9, 1, 0, 1.6)!;
    expect(rectInside(wall, r)).toBe(true);
    expect(r.s + r.w).toBeCloseTo(8); // empurrado para dentro
    expect(r.t + r.h / 2 + wall.o[1]).toBeCloseTo(1.45, 1);
    expect(rectInside(ground, placeRect(ground, 12, 12, 0, 2.2)!)).toBe(true);
  });

  it('superfície mais próxima só pelo lado pintável', () => {
    expect(nearestSurface([wall], 4, 1.5, 3)?.id).toBe('w');
    expect(nearestSurface([wall], 4, -1.5, 3)).toBeNull();
  });

  it('dados gerados: superfícies válidas e tapumes com colisão', () => {
    const f = parseSurfaceFile(JSON.parse(readFileSync('public/world/graffiti_surfaces.json', 'utf8')));
    expect(f.surfaces.length).toBeGreaterThan(30);
    const ids = new Set(f.surfaces.map((s) => s.id));
    expect(ids.size).toBe(f.surfaces.length);
    for (const s of f.surfaces) {
      expect(Math.hypot(...s.u)).toBeCloseTo(1, 2);
      expect(Math.hypot(...s.v)).toBeCloseTo(1, 2);
      expect(s.w).toBeGreaterThan(1);
      expect(s.max).toBeGreaterThan(0);
      if (s.kind === 'mural') expect(s.persistence).toBe('permanent');
    }
    expect(f.solids.length).toBeGreaterThan(0);
    for (const b of f.solids) expect(solidRing(b)).toHaveLength(4);
    expect(f.surfaces.some((s) => s.kind === 'ground')).toBe(true);
  });
});

describe('texto (saneamento e filtro PT-BR)', () => {
  it('saneia controles, invisíveis e tamanho', () => {
    expect(sanitizeText('  oi​   mundo\u0007 ')).toBe('oi mundo');
    expect(Array.from(sanitizeText('a'.repeat(40)))).toHaveLength(24);
    expect(sanitizeText('<script>')).toBe('script');
  });

  it('aceita texto de manifestação comum', () => {
    for (const t of ['Fora fome!', 'Educação já', 'Vidas negras importam', 'Porão', 'Computador', 'Cornija', 'Brasil 2026', 'Amor e paz']) {
      expect(checkText(t).ok, t).toBe(true);
    }
  });

  it('bloqueia palavrões, ódio, variações e spam', () => {
    for (const t of ['porra', 'P0RRRA', 'caralho', 'filho da puta', 'f.d.p', 'v1ado', 'nazista', 'c a r a l h o', 'puta', 'www.site', 'zap 21999998888']) {
      expect(checkText(t).ok, t).toBe(false);
    }
  });

  it('texto não saneado é recusado (cliente modificado)', () => {
    expect(checkText('oi​mundo')).toEqual({ ok: false, reason: 'caracteres' });
    expect(checkText('x'.repeat(30))).toEqual({ ok: false, reason: 'longo' });
  });
});

describe('validação do conteúdo e do alcance', () => {
  it('aceita o rabisco típico', () => {
    const v = validateContent(encodeGraffiti(sample()), wall);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.hasText).toBe(true);
  });

  it('recusa formato, retângulo fora, proporção, cor e texto', () => {
    expect(validateContent('abc', wall)).toEqual({ ok: false, reason: 'formato' });
    expect(validateContent(encodeGraffiti(sample({ s: 7, t: 0, w: 1.6, h: 0.8 })), wall)).toEqual({ ok: false, reason: 'retangulo' });
    expect(validateContent(encodeGraffiti(sample({ s: 0, t: 0, w: 1.6, h: 1.6 })), wall)).toEqual({ ok: false, reason: 'retangulo' });
    const c = sample(); (c.items[0] as { color: number }).color = 13;
    expect(validateContent(encodeGraffiti(c), wall)).toEqual({ ok: false, reason: 'formato' });
    const t = sample(); t.items.push({ k: 'text', color: 0, x: 10, y: 10, size: 20, text: 'caralho' });
    expect(validateContent(encodeGraffiti(t), wall)).toEqual({ ok: false, reason: 'texto_bloqueado' });
    expect(validateContent(encodeGraffiti({ rect: sample().rect, items: [] }), wall)).toEqual({ ok: false, reason: 'itens' });
    const y = sample(); (y.items[0] as { pts: number[] }).pts[1] = CANVAS_H + 10;
    // o codec já prende y < 128 ao codificar; um cliente modificado mandando bytes crus é pego na validação
    const raw = encodeGraffiti(y); raw[10 + 3 + 1] = 200;
    expect(validateContent(raw, wall)).toEqual({ ok: false, reason: 'formato' });
  });

  it('limite de bytes', () => {
    const big: GraffitiContent = { rect: sample().rect, items: Array.from({ length: 20 }, () => ({ k: 'line' as const, color: 0, width: 0, pts: Array.from({ length: 510 }, (_, i) => i % 120) })) };
    expect(validateContent(encodeGraffiti(big), wall)).toEqual({ ok: false, reason: 'tamanho' });
  });

  it('alcance: ≤ 3 m da área pintada e do lado certo', () => {
    const c = decodeGraffiti(encodeGraffiti(sample()))!;
    expect(validateReach(wall, c, 1.8, 2.5)).toBeNull();
    expect(validateReach(wall, c, 1.8, 3.5)).toBe('distancia');
    expect(validateReach(wall, c, 7.5, 0.5)).toBe('distancia'); // longe da área (rect em s 1..2,6)
    expect(validateReach(wall, c, 1.8, -1)).toBe('lado');
  });
});

describe('cota, cooldown e TTL', () => {
  const rules = { ...GF_RULES, cooldownMs: 1000, maxActivePerPlayer: 2, maxPerHour: 3 };
  it('cooldown, ativos e por hora', () => {
    const lim = newAuthorLimits();
    expect(checkQuota(lim, 0, 0, rules)).toBeNull();
    recordCreation(lim, 0);
    expect(checkQuota(lim, 1, 500, rules)).toBe('cooldown');
    expect(checkQuota(lim, 2, 2000, rules)).toBe('cota');
    recordCreation(lim, 2000); recordCreation(lim, 4000);
    expect(checkQuota(lim, 0, 6000, rules)).toBe('cota_hora');
    expect(checkQuota(lim, 0, 3600_000 + 5000, rules)).toBeNull();
  });

  it('expiração: temporário expira, autorizado não', () => {
    expect(expiresAtFor(wall, 1000, { ...GF_RULES, ttlMs: 500 })).toBe(1500);
    expect(expiresAtFor(mural, 1000)).toBe(0);
  });
});

describe('moderação (máquina de estados)', () => {
  const rules = { ...GF_RULES, reportThreshold: 2 };
  const rec = (): ModerationRec => ({ state: GF_STATE.ACTIVE, reports: [], author: { clientId: 'autor' }, expiresAt: 5000 });
  it('denúncias distintas → REPORTED → HIDDEN', () => {
    const r = rec();
    expect(moderate(r, { k: 'report', by: 'autor' }, rules)).toEqual({ changed: false, reason: 'proprio' });
    expect(moderate(r, { k: 'report', by: 'a' }, rules).changed).toBe(true);
    expect(r.state).toBe(GF_STATE.REPORTED);
    expect(moderate(r, { k: 'report', by: 'a' }, rules)).toEqual({ changed: false, reason: 'repetida' });
    moderate(r, { k: 'report', by: 'b' }, rules);
    expect(r.state).toBe(GF_STATE.HIDDEN);
    expect(moderate(r, { k: 'report', by: 'c' }, rules).reason).toBe('oculto');
    expect(moderate(r, { k: 'admin_restore' }, rules).changed).toBe(true);
    expect(r).toMatchObject({ state: GF_STATE.ACTIVE, reports: [] });
  });

  it('expirar e remover são terminais', () => {
    const r = rec();
    expect(moderate(r, { k: 'expire', now: 4999 }).changed).toBe(false);
    expect(moderate(r, { k: 'expire', now: 5000 }).changed).toBe(true);
    expect(r.state).toBe(GF_STATE.EXPIRED);
    expect(moderate(r, { k: 'admin_restore' }).reason).toBe('terminal');
    const p = { ...rec(), expiresAt: 0 };
    expect(moderate(p, { k: 'expire', now: 1e15 }).changed).toBe(false); // permanente
    moderate(p, { k: 'admin_remove' });
    expect(p.state).toBe(GF_STATE.REMOVED);
    expect(moderate(p, { k: 'report', by: 'x' }).reason).toBe('terminal');
  });
});

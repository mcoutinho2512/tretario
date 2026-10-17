import { describe, expect, it, beforeAll } from 'vitest';
import * as THREE from 'three';
import { PROPS } from '../src/social/props';
import { ACTION_BY_KEY } from '../src/social/actions';
import { DESIGNS } from '../src/social/designs';
import {
  FAR_PLACEMENT, HAND_GRIP, PROP_GRIPS, RAISE_ACTIONS, WAVE_ACTIONS, clothLodFor, clothSegments, gripTableComplete, mirrorU,
} from '../src/social/props/grips';
import { propModel } from '../src/social/props/propGeometry';

describe('pegadas dos itens', () => {
  it('todo PropDefinition tem pegada, modo de duas mãos e posição na multidão distante', () => {
    expect(gripTableComplete()).toEqual([]);
    for (const p of PROPS) {
      const g = PROP_GRIPS[p.kind];
      // a pegada do registro (props.ts) e a do anexo concordam: item de duas mãos não vira item de uma mão
      if (p.grip === 'two_hand' && p.kind !== 'drum') expect(g.mode).toBe('two_hand');
      if (p.grip === 'hand_r') expect(['bone', 'upright']).toContain(g.mode);
    }
  });

  it('eixos do punho são ortonormais e espelhados entre as mãos', () => {
    for (const h of ['hand_r', 'hand_l'] as const) {
      const a = new THREE.Vector3(...HAND_GRIP[h].axis), n = new THREE.Vector3(...HAND_GRIP[h].palm);
      expect(a.length()).toBeCloseTo(1, 2);
      expect(n.length()).toBeCloseTo(1, 2);
      expect(a.dot(n)).toBeCloseTo(0, 2);
      // ⟂ ao osso (+Y = dedos): o cabo atravessa o punho
      expect(a.y).toBe(0);
    }
    expect(HAND_GRIP.hand_l.axis[0]).toBeCloseTo(-HAND_GRIP.hand_r.axis[0]);
    expect(HAND_GRIP.hand_l.center[0]).toBeCloseTo(-HAND_GRIP.hand_r.center[0]);
  });

  it('ações de erguer/balançar existem no registro de ações', () => {
    for (const k of [...RAISE_ACTIONS, ...WAVE_ACTIONS]) expect(ACTION_BY_KEY.has(k), k).toBe(true);
  });

  it('itens visíveis de longe ficam na altura das mãos', () => {
    for (const [kind, pl] of Object.entries(FAR_PLACEMENT)) {
      if (!pl) continue;
      expect(pl.at[1], kind).toBeGreaterThan(0.7);
      expect(pl.at[1], kind).toBeLessThan(1.4);
    }
  });
});

describe('modelos dos itens', () => {
  for (const p of PROPS) for (const q of ['near', 'far'] as const) {
    it(`${p.kind} (${q}): malha única com cor/PBR por vértice, escala humana, design onde há slot`, () => {
      const m = propModel(p.kind, q);
      for (const k of ['position', 'normal', 'uv', 'color', 'aPbr']) expect(m.rigid.getAttribute(k), k).toBeTruthy();
      m.rigid.computeBoundingBox();
      const s = m.rigid.boundingBox!.getSize(new THREE.Vector3());
      const big = Math.max(s.x, s.y, s.z);
      expect(big).toBeGreaterThan(0.04);
      expect(big).toBeLessThan(4.5);
      expect(Number.isFinite(m.rigid.boundingSphere!.radius)).toBe(true);
      if (p.designSlot) {
        expect(m.parts.length).toBeGreaterThan(0);
        for (const part of m.parts) expect(part.slot).toBe(p.designSlot);
      } else expect(m.parts.length).toBe(0);
    });
  }

  it('a versão distante é mais barata que a próxima', () => {
    for (const p of PROPS) {
      const tri = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.getAttribute('position').count) / 3;
      expect(tri(propModel(p.kind, 'far').rigid), p.kind).toBeLessThanOrEqual(tri(propModel(p.kind, 'near').rigid));
    }
  });

  it('cartaz pequeno com espessura real (1–2 cm no máximo) e proporção do atlas de cartazes', () => {
    const m = propModel('sign_small', 'near');
    m.rigid.computeBoundingBox();
    const s = m.rigid.boundingBox!.getSize(new THREE.Vector3());
    expect(s.z).toBeGreaterThan(0.004);
    expect(s.z).toBeLessThan(0.02);
    const f = m.parts[0];
    expect(f.w / f.h).toBeCloseTo(0.75, 1);
  });
});

describe('itens de confronto (rodada 9): categoria COMBAT_PROP no MESMO registro', () => {
  it('taco, barra e spray: ids estáveis, categoria, fora da multidão, pegada de uma mão', async () => {
    const { PROP_BY_KIND, SOCIAL_PROPS, isCombatProp } = await import('../src/social/props');
    const want: [string, number][] = [['bat', 11], ['bar', 12], ['spray', 13]];
    for (const [kind, id] of want) {
      const p = PROP_BY_KIND.get(kind as never)!;
      expect(p.id, kind).toBe(id);
      expect(p.category).toBe('COMBAT_PROP');
      expect(isCombatProp(id)).toBe(true);
      expect(p.crowdWeight).toBe(0);
      expect(p.grip).toBe('hand_r');
      expect(PROP_GRIPS[p.kind].mode).toBe('bone');
      expect(p.label).not.toMatch(/visual/i);
      expect(SOCIAL_PROPS.includes(p)).toBe(false);
    }
    expect(PROP_BY_KIND.get('bar')!.carryClip).toBe('carry_bar');
    expect(PROP_BY_KIND.get('spray')!.carryClip).toBe('carry_spray');
    // ids únicos e nenhum item social marcado como de confronto
    expect(new Set(PROPS.map((p) => p.id)).size).toBe(PROPS.length);
    expect(PROPS.filter((p) => isCombatProp(p.id)).map((p) => p.kind).sort()).toEqual(['bar', 'bat', 'spray']);
  });

  it('modelos procedurais em escala real (barra ~0,8 m, lata ~0,2 m) e sem parte de design (sem rótulo/marca)', () => {
    const size = (k: 'bar' | 'spray') => { const g = propModel(k, 'near').rigid; g.computeBoundingBox(); return g.boundingBox!.getSize(new THREE.Vector3()); };
    expect(size('bar').y).toBeGreaterThan(0.7);
    expect(size('bar').y).toBeLessThan(0.9);
    expect(size('spray').y).toBeGreaterThan(0.15);
    expect(size('spray').y).toBeLessThan(0.25);
    expect(propModel('spray').parts).toEqual([]);
  });
});

describe('LOD do tecido', () => {
  it('seleção por tier/detalhe', () => {
    expect(clothLodFor(true, true)).toBe(0);
    expect(clothLodFor(true, false)).toBe(1);
    expect(clothLodFor(false, true)).toBe(2);
  });
  it('perto tem mais segmentos que longe', () => {
    for (const k of ['flag_small', 'flag_large', 'banner', 'big'] as const) {
      const [a, b] = clothSegments(k, 0), [c, d] = clothSegments(k, 1);
      expect(a * b).toBeGreaterThan(c * d);
      expect(clothSegments(k, 2)).toEqual(clothSegments(k, 1));
    }
  });
});

describe('atlas de designs', () => {
  beforeAll(() => {
    // canvas mínimo (o atlas só pinta; aqui interessa o mapeamento de UV)
    const ctx = new Proxy({}, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 10 }) : k === 'createRadialGradient' ? () => ({ addColorStop() {} }) : k === 'getImageData' ? () => ({ data: new Uint8ClampedArray(16) }) : () => {}), set: () => true });
    (globalThis as { document?: unknown }).document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
  });

  it('cada design do alvo ganha uma célula distinta dentro de [0,1]; desconhecido cai na célula 0', async () => {
    const { DesignAtlas } = await import('../src/social/designPainter');
    for (const target of ['flag', 'sign', 'banner'] as const) {
      const at = new DesignAtlas(target, 32);
      const list = DESIGNS.filter((d) => d.targets.includes(target));
      const seen = new Set<string>();
      for (const d of list) {
        const [u0, v0, du, dv] = at.uv(d.id);
        expect(u0).toBeGreaterThanOrEqual(0);
        expect(v0).toBeGreaterThanOrEqual(-1e-9);
        expect(u0 + du).toBeLessThanOrEqual(1 + 1e-9);
        expect(v0 + dv).toBeLessThanOrEqual(1 + 1e-9);
        seen.add(`${u0}:${v0}`);
        // verso: U espelhado continua na mesma célula
        expect(mirrorU(u0 + du * 0.2, u0, du)).toBeCloseTo(u0 + du * 0.8);
      }
      expect(seen.size).toBe(list.length);
      expect(at.uv(65000)).toEqual(at.uv(list[0].id));
    }
  });

  it('PropAttachment: troca de item e dispose devolvem todos os materiais de design (sem vazamento)', async () => {
    const { PropAttachment } = await import('../src/social/PropAttachment');
    const { designMaterialStats } = await import('../src/social/props/propMaterials');
    const root = new THREE.Group();
    const bones = new Map<string, THREE.Object3D>();
    const pelvis = new THREE.Bone(); pelvis.position.y = 1;
    root.add(pelvis);
    for (const n of ['hand_r', 'hand_l', 'clavicle_r']) {
      const b = new THREE.Bone();
      b.position.set(n === 'hand_r' ? -0.3 : 0.3, 0.1, 0.2);
      pelvis.add(b);
      bones.set(n, b);
    }
    bones.set('pelvis', pelvis);
    const before = designMaterialStats().refs;
    const a = new PropAttachment({ root, bones });
    const b = new PropAttachment({ root, bones });
    for (const p of PROPS) {
      a.set(p.id, 1);
      b.set(p.id, 5);
      a.update(1 / 60, 0, true);
      b.update(1 / 60, 0, false);
      a.update(1 / 60, 0, false);
      expect(root.getObjectByName(`prop_${p.kind}`), p.kind).toBeTruthy();
    }
    a.set(0, 0);
    expect(root.getObjectByName(`prop_${PROPS[PROPS.length - 1].kind}`)).toBeTruthy(); // b ainda segura o último
    b.dispose();
    a.dispose();
    expect(designMaterialStats().refs).toBe(before);
    expect(root.getObjectByProperty('isMesh', true)).toBeUndefined();
  });
});

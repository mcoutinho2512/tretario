/**
 * Rodada 10 — animação de confronto (checagens puras, esqueleto de teste):
 *  - tempos dos clipes = combat.json (preparação/janela/recuperação; a animação se adapta aos dados, não o contrário)
 *  - crossfades cabem na preparação/recuperação; o estalo do soco cai na janela ativa
 *  - valores finitos, quatérnios normalizados, pés acima do chão
 *  - pés APOIADOS não deslizam (soco, taco, barra, spray, perna de apoio do chute, pé parado do cambaleio)
 *  - levantar começa deitado e mantém os pés no chão (sem "pernas para o ar"); de bruços também
 *  - escolha da variante (esquiva, cambaleio, levantar) pela direção — src/combat/animSelect.ts
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { MIRROR_SUFFIX, SPECS, clipFades, clipFloor, proceduralClip, withBase } from '../src/characters/human/proceduralClips';
import { dodgeClipFor, getupClipFor, staggerClipFor } from '../src/combat/animSelect';
import { NPC_HIT } from '../src/combat/npcHits';
import { fakeRig } from './fixtures/fakeRig';

interface Act { key: string; animation: string; windupMs: number; activeMs: number; recoveryMs: number }
const data = JSON.parse(readFileSync('public/gameplay/combat.json', 'utf8')) as { actions: Act[]; tuning: { getupMs: number } };
const COMBAT = ['cbt_punch', 'cbt_punch2', 'cbt_kick', 'cbt_kick_final', 'cbt_dodge', 'cbt_dodge_fwd', 'cbt_dodge_side', 'cbt_dodge_side' + MIRROR_SUFFIX,
  'cbt_bat', 'cbt_bar', 'cbt_spray', 'stagger', 'stagger_back', 'stagger_side', 'stagger_side' + MIRROR_SUFFIX, 'getup', 'getup_prone', 'npc_down'];

/** posições de ossos (espaço do esqueleto) ao longo do clipe, aplicando as trilhas direto (como clipFloor) */
function sample(arm: THREE.Object3D, bones: Map<string, THREE.Bone>, clip: THREE.AnimationClip, names: string[], fps = 60) {
  const tr = clip.tracks.map((t) => {
    const dot = t.name.lastIndexOf('.');
    return { b: bones.get(t.name.slice(0, dot)), prop: t.name.slice(dot + 1), it: t.createInterpolant() };
  }).filter((x) => x.b && (x.prop === 'quaternion' || x.prop === 'position'));
  const saved = [...bones.values()].map((o) => ({ o, q: o.quaternion.clone(), p: o.position.clone() }));
  const out: { t: number; p: Record<string, THREE.Vector3> }[] = [];
  const n = Math.ceil(clip.duration * fps);
  for (let i = 0; i <= n; i++) {
    const t = Math.min(clip.duration, i / fps);
    for (const x of tr) {
      const r = x.it.evaluate(t);
      if (x.prop === 'quaternion') x.b!.quaternion.set(r[0], r[1], r[2], r[3]); else x.b!.position.set(r[0], r[1], r[2]);
    }
    arm.updateMatrixWorld(true);
    out.push({ t, p: Object.fromEntries(names.map((nm) => [nm, bones.get(nm)!.getWorldPosition(new THREE.Vector3())])) });
  }
  for (const s of saved) { s.o.quaternion.copy(s.q); s.o.position.copy(s.p); }
  arm.updateMatrixWorld(true);
  return out;
}

describe('animação de confronto (rodada 10)', () => {
  const { arm, bones, idle } = fakeRig();
  const floor = Math.min(...['ball_l', 'ball_r', 'foot_l', 'foot_r'].map((n) => bones.get(n)!.getWorldPosition(new THREE.Vector3()).y));

  it('tempos dos clipes = combat.json (dur = preparação + janela + recuperação) e crossfades cabem neles', () => {
    for (const a of data.actions) {
      const spec = SPECS[a.animation];
      if (!spec) continue; // empurrão: clipe da biblioteca
      expect(spec.cbt, a.key).toBeTruthy();
      const [w, act, rec] = spec.cbt!;
      expect(w * 1000, a.key).toBeCloseTo(a.windupMs, 3);
      expect(act * 1000, a.key).toBeCloseTo(a.activeMs, 3);
      expect(rec * 1000, a.key).toBeCloseTo(a.recoveryMs, 3);
      expect(spec.dur, a.key).toBeCloseTo(w + act + rec, 3);
      expect(spec.dur, a.key).toBeGreaterThanOrEqual(w + act);
      const f = clipFades(spec);
      expect(f.fadeIn, a.key).toBeLessThanOrEqual(Math.max(0.06, w) + 1e-9);
      expect(f.fadeOut, a.key).toBeLessThanOrEqual(rec + 1e-9);
    }
    // variantes da esquiva: mesmos tempos da esquiva
    for (const v of ['cbt_dodge_fwd', 'cbt_dodge_side']) expect(SPECS[v].cbt).toEqual(SPECS.cbt_dodge.cbt);
    // levantar = tempo de levantar do servidor e do NPC; cambaleio do NPC = duração do clipe
    expect(SPECS.getup.dur * 1000).toBeCloseTo(data.tuning.getupMs, 3);
    expect(SPECS.getup_prone.dur).toBeCloseTo(SPECS.getup.dur, 6);
    expect(SPECS.getup.dur).toBeCloseTo(NPC_HIT.getupS, 6);
    for (const s of ['stagger', 'stagger_back', 'stagger_side']) expect(SPECS[s].dur).toBeCloseTo(NPC_HIT.staggerS, 6);
  });

  it.each(COMBAT)('%s: finito, quatérnios normalizados, pés acima do chão', (name) => {
    const clip = proceduralClip(name, arm, idle)!;
    expect(clip).toBeTruthy();
    for (const t of clip.tracks) {
      for (const v of t.values) expect(Number.isFinite(v), t.name).toBe(true);
      if (t.name.endsWith('.quaternion')) for (let i = 0; i < t.values.length; i += 4) {
        expect(Math.abs(Math.hypot(t.values[i], t.values[i + 1], t.values[i + 2], t.values[i + 3]) - 1), t.name).toBeLessThan(1e-4);
      }
    }
    expect(clipFloor(arm, withBase(clip, idle))!, name).toBeGreaterThan(-0.02);
    expect(bones.get('hand_r')!.quaternion.toArray()).toEqual(new THREE.Quaternion().toArray());
  });

  // pés que ficam APOIADOS o clipe inteiro: deslocamento horizontal máximo da bola e do tornozelo ≤ 1 cm
  const planted: [string, ('l' | 'r')[]][] = [
    ['cbt_punch', ['l', 'r']], ['cbt_punch2', ['l', 'r']], ['cbt_bat', ['l', 'r']], ['cbt_bar', ['l', 'r']], ['cbt_spray', ['l', 'r']],
    ['cbt_kick', ['l']], ['cbt_kick_final', ['l']], ['stagger', ['l']], ['stagger_back', ['r']], ['stagger_side', ['l']],
  ];
  it.each(planted)('%s: pé apoiado não desliza (≤ 1 cm)', (name, sides) => {
    const clip = withBase(proceduralClip(name, arm, idle)!, idle);
    const ns = sides.flatMap((s) => [`ball_${s}`]);
    const fr = sample(arm, bones, clip, ns);
    for (const n of ns) {
      const p0 = fr[0].p[n];
      const max = Math.max(...fr.map((f) => Math.hypot(f.p[n].x - p0.x, f.p[n].z - p0.z)));
      expect(max, `${name} ${n}`).toBeLessThan(0.01);
    }
  });

  it('chute: o pé do chute volta EXATAMENTE ao ponto de partida (sem escorregar no pouso)', () => {
    for (const name of ['cbt_kick', 'cbt_kick_final']) {
      const fr = sample(arm, bones, withBase(proceduralClip(name, arm, idle)!, idle), ['ball_r', 'foot_r']);
      const a = fr[0].p.ball_r, b = fr[fr.length - 1].p.ball_r;
      expect(a.distanceTo(b), name).toBeLessThan(0.005);
      // e sobe de verdade (canela na altura do quadril/peito)
      expect(Math.max(...fr.map((f) => f.p.foot_r.y)), name).toBeGreaterThan(0.55);
    }
  });

  it('soco: o punho chega à extensão máxima dentro da janela ativa (estalo no fim da preparação)', () => {
    for (const [name, side] of [['cbt_punch', 'r'], ['cbt_punch2', 'l']] as const) {
      const [w, act] = SPECS[name].cbt!;
      const fr = sample(arm, bones, withBase(proceduralClip(name, arm, idle)!, idle), [`hand_${side}`, 'spine_03']);
      const reach = fr.map((f) => f.p[`hand_${side}`].z - f.p.spine_03.z);
      const iMax = reach.indexOf(Math.max(...reach));
      expect(fr[iMax].t, name).toBeGreaterThanOrEqual(w - 0.02);
      expect(fr[iMax].t, name).toBeLessThanOrEqual(w + act);
      // antecipação: o punho RECUA antes de sair (menos alcance no fim da preparação do que na guarda inicial)
      const iA = Math.round((w - 0.05) * 60);
      expect(reach[iA], name).toBeLessThan(reach[0] + 1e-3);
    }
  });

  it('levantar: começa deitado, pés no chão o tempo todo (sem pernas para o ar), termina em pé', () => {
    for (const name of ['getup', 'getup_prone']) {
      const fr = sample(arm, bones, proceduralClip(name, arm, idle)!, ['pelvis', 'head', 'foot_l', 'foot_r', 'ball_l', 'ball_r']);
      expect(fr[0].p.pelvis.y - floor, name).toBeLessThan(0.3);
      expect(fr[0].p.head.y - floor, name).toBeLessThan(0.65);
      for (const f of fr) for (const n of ['foot_l', 'foot_r']) expect(f.p[n].y - floor, `${name} ${n} t=${f.t.toFixed(2)}`).toBeLessThan(0.2);
      for (const f of fr) expect(f.p.head.y, `${name} cabeça t=${f.t.toFixed(2)}`).toBeGreaterThan(floor + 0.05);
      const end = fr[fr.length - 1].p;
      expect(end.pelvis.y, name).toBeGreaterThan(0.9);
    }
  });

  it('NPC derrubado: `npc_down` é a primeira pose do `getup` (emenda sem salto)', () => {
    const d = proceduralClip('npc_down', arm, idle)!, g = proceduralClip('getup', arm, idle)!;
    for (const t of d.tracks) {
      const o = g.tracks.find((x) => x.name === t.name)!;
      const k = t.getValueSize();
      for (let i = 0; i < k; i++) expect(Math.abs(t.values[i] - o.values[i]), t.name).toBeLessThan(1e-4);
    }
  });

  it('variantes: esquiva pela direção relativa, cambaleio pelo empurrão, levantar pela pose do chão', () => {
    expect(dodgeClipFor(Math.PI)).toBe('cbt_dodge');
    expect(dodgeClipFor(-Math.PI * 0.9)).toBe('cbt_dodge');
    expect(dodgeClipFor(0.1)).toBe('cbt_dodge_fwd');
    expect(dodgeClipFor(Math.PI / 2)).toBe('cbt_dodge_side' + MIRROR_SUFFIX); // + = esquerda do corpo
    expect(dodgeClipFor(-Math.PI / 2)).toBe('cbt_dodge_side');
    expect(dodgeClipFor(NaN)).toBe('cbt_dodge');
    // rumo 0 = frente +z; esquerda +x
    expect(staggerClipFor(0, -1, 0)).toBe('stagger'); // empurrado para trás: golpe de frente
    expect(staggerClipFor(0, 1, 0)).toBe('stagger_back');
    expect(staggerClipFor(-1, 0, 0)).toBe('stagger_side'); // para a direita
    expect(staggerClipFor(1, 0, 0)).toBe('stagger_side' + MIRROR_SUFFIX);
    expect(staggerClipFor(0, 0, 1)).toBe('stagger');
    // rumo π/2 (frente +x): empurrão +x = para a frente
    expect(staggerClipFor(1, 0, Math.PI / 2)).toBe('stagger_back');
    // de costas (peito para cima): pés à frente; de bruços: cabeça à frente
    const sup = getupClipFor(0.9, 0, -1);
    expect(sup.clip).toBe('getup');
    expect(Math.abs(sup.yaw)).toBeLessThan(1e-9); // cabeça em −z → pés (+z) à frente
    const pr = getupClipFor(-0.9, 1, 0);
    expect(pr.clip).toBe('getup_prone');
    expect(pr.yaw).toBeCloseTo(Math.PI / 2, 6);
    expect(getupClipFor(0, 0, 1).clip).toBe('getup'); // de lado: de costas
  });

  it('camadas adaptativas só nos golpes de mão/item e cambaleio; chute/esquiva/levantar de corpo inteiro', () => {
    for (const n of ['cbt_punch', 'cbt_punch2', 'cbt_bat', 'cbt_bar', 'cbt_spray', 'stagger', 'stagger_back', 'stagger_side']) expect(SPECS[n].adaptive, n).toBe(true);
    for (const n of ['cbt_kick', 'cbt_kick_final', 'cbt_dodge', 'getup', 'getup_prone', 'npc_down']) {
      expect(SPECS[n].layer, n).toBe('full');
      expect(!!SPECS[n].adaptive, n).toBe(false);
    }
  });
});

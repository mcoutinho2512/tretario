/**
 * Clipes de ações/itens: todo nome citado em src/social (ACTIONS[].clip, ACTIONS[].crowdClip, PROPS[].carryClip)
 * existe — procedural (src/characters/human/proceduralClips.ts) ou na biblioteca anims.glb — e os clipes
 * procedurais gerados num esqueleto "game_engine" só animam ossos que existem, com valores finitos e emenda
 * perfeita nos loops.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { ACTIONS } from '../src/social/actions';
import { PROPS } from '../src/social/props';
import { MIRROR_SUFFIX, SPECS, clipFloor, proceduralClip, withBase } from '../src/characters/human/proceduralClips';
import { fakeRig } from './fixtures/fakeRig';

/** nomes das animações do GLB da biblioteca (lê só o JSON do contêiner binário) */
function libraryClips(): Set<string> {
  const b = readFileSync('public/characters/anims.glb');
  const len = b.readUInt32LE(12);
  const j = JSON.parse(b.subarray(20, 20 + len).toString());
  return new Set((j.animations ?? []).map((a: { name: string }) => a.name));
}

describe('clipes de ações sociais e itens', () => {
  const lib = libraryClips();
  const referenced = new Set<string>([
    ...ACTIONS.map((a) => a.clip),
    ...ACTIONS.flatMap((a) => (a.crowdClip ? [a.crowdClip] : [])),
    ...PROPS.map((p) => p.carryClip),
  ]);

  it('todo clipe citado existe (procedural ou biblioteca)', () => {
    const missing = [...referenced].filter((n) => !SPECS[n] && !lib.has(n));
    expect(missing).toEqual([]);
  });

  it('ações `once` têm a mesma duração no registro e no clipe', () => {
    for (const a of ACTIONS) if (a.mode === 'once' && SPECS[a.clip]) expect(SPECS[a.clip].dur).toBeCloseTo(a.duration ?? 2, 5);
  });

  it('clipes `full` só onde a ação é de corpo inteiro; itens e gestos `upper` não mexem nas pernas', () => {
    for (const a of ACTIONS) if (SPECS[a.clip]) expect(SPECS[a.clip].layer).toBe(a.layer);
    for (const p of PROPS) expect(SPECS[p.carryClip].layer).toBe('upper');
  });

  const { arm, bones, idle } = fakeRig();
  const names = [...new Set([...referenced].filter((n) => SPECS[n]).flatMap((n) => (SPECS[n].mirror ? [n, n + MIRROR_SUFFIX] : [n])))];
  it.each(names)('%s: trilhas em ossos existentes, valores finitos', (name) => {
    const clip = proceduralClip(name, arm, idle)!;
    expect(clip).toBeTruthy();
    expect(clip.duration).toBeGreaterThan(0.5);
    const spec = SPECS[name.replace(MIRROR_SUFFIX, '')];
    for (const t of clip.tracks) {
      const bone = t.name.slice(0, t.name.lastIndexOf('.'));
      expect(bones.has(bone), `${t.name}`).toBe(true);
      for (const v of t.values) expect(Number.isFinite(v)).toBe(true);
      if (spec.layer === 'upper') expect(/^(thigh|calf|foot|ball)_|^pelvis\./.test(t.name), t.name).toBe(false);
    }
    // gerar não pode alterar a pose do esqueleto (o clipe é feito sobre o personagem vivo)
    expect(bones.get('hand_r')!.quaternion.toArray()).toEqual(new THREE.Quaternion().toArray());
  });

  it('loops emendam (primeira chave = última) e os de corpo inteiro mantêm os pés no chão', () => {
    const once = new Set(ACTIONS.filter((a) => a.mode === 'once').map((a) => a.clip));
    for (const name of names) {
      const base = name.replace(MIRROR_SUFFIX, '');
      const clip = proceduralClip(name, arm, idle)!;
      if (!once.has(base)) {
        for (const t of clip.tracks) {
          const k = t.getValueSize(), n = t.times.length;
          if (n < 2) continue;
          for (let i = 0; i < k; i++) expect(Math.abs(t.values[i] - t.values[(n - 1) * k + i]), `${name} ${t.name}`).toBeLessThan(2e-3);
        }
      }
      if (SPECS[base].layer === 'full') {
        // nenhum pé abaixo do chão da pose base (o pulo sobe, sentar mantém os pés apoiados)
        const floor = clipFloor(arm, withBase(clip, idle))!;
        expect(floor, name).toBeGreaterThan(-0.02);
      }
    }
  });

  it('espelhado troca os lados (aceno com a mão esquerda)', () => {
    const w = proceduralClip('emote_wave', arm, idle)!, m = proceduralClip('emote_wave' + MIRROR_SUFFIX, arm, idle)!;
    const lift = (clip: THREE.AnimationClip, s: 'l' | 'r') => {
      const mixer = new THREE.AnimationMixer(arm);
      mixer.clipAction(clip).play();
      mixer.setTime(1.0);
      arm.updateMatrixWorld(true);
      const y = bones.get(`hand_${s}`)!.getWorldPosition(new THREE.Vector3()).y;
      mixer.stopAllAction(); mixer.uncacheRoot(arm);
      for (const t of idle.tracks) { const [n, p] = t.name.split('.'); const b = bones.get(n)!; if (p === 'quaternion') b.quaternion.fromArray(t.values); else b.position.fromArray(t.values); }
      arm.updateMatrixWorld(true);
      return y;
    };
    expect(lift(w, 'r')).toBeGreaterThan(1.5);
    expect(lift(w, 'l')).toBeLessThan(1.1);
    expect(lift(m, 'l')).toBeGreaterThan(1.5);
    expect(lift(m, 'r')).toBeLessThan(1.1);
  });
});

describe('clipes de confronto (rodada 9, public/gameplay/combat.json)', () => {
  const lib = libraryClips();
  const data = JSON.parse(readFileSync('public/gameplay/combat.json', 'utf8')) as { actions: { animation: string }[] };
  const names = [...new Set(data.actions.map((a) => a.animation))];
  const { arm, bones, idle } = fakeRig();
  it('toda animação citada existe (procedural ou biblioteca); impulso/pouso do pulo estão na biblioteca', () => {
    expect(names.filter((n) => !SPECS[n] && !lib.has(n))).toEqual([]);
    expect(lib.has('jump_start') && lib.has('jump_land')).toBe(true);
  });
  it.each(names.filter((n) => SPECS[n]))('%s: ossos do rig, valores finitos, pés acima do chão', (name) => {
    const clip = proceduralClip(name, arm, idle)!;
    expect(clip.duration).toBeGreaterThan(0.3);
    for (const t of clip.tracks) {
      expect(bones.has(t.name.slice(0, t.name.lastIndexOf('.')))).toBe(true);
      for (const v of t.values) expect(Number.isFinite(v)).toBe(true);
      if (SPECS[name].layer === 'upper') expect(/^(thigh|calf|foot|ball)_|^pelvis\./.test(t.name), t.name).toBe(false);
    }
    if (SPECS[name].layer === 'full') expect(clipFloor(arm, withBase(clip, idle))!).toBeGreaterThan(-0.02);
  });
});

describe('clipes de confronto e estados (rodada 9)', () => {
  const { arm, bones, idle } = fakeRig();
  // nomes combinados com o sistema de confronto (CombatActionDefinition.animation) e com os estados físicos
  // rodada 10: `stagger` virou corpo inteiro adaptativo com variantes direcionais (tests/combatAnim.test.ts)
  const names = ['disoriented', 'carry_bar', 'carry_spray'];
  it.each(names)('%s: camada superior, ossos existentes, valores finitos, pose restaurada', (name) => {
    expect(SPECS[name], name).toBeTruthy();
    expect(SPECS[name].layer).toBe('upper');
    const clip = proceduralClip(name, arm, idle)!;
    for (const t of clip.tracks) {
      expect(bones.has(t.name.slice(0, t.name.lastIndexOf('.')))).toBe(true);
      expect(/^(thigh|calf|foot|ball)_|^pelvis\./.test(t.name), t.name).toBe(false);
      for (const v of t.values) expect(Number.isFinite(v)).toBe(true);
    }
    expect(bones.get('hand_r')!.quaternion.toArray()).toEqual(new THREE.Quaternion().toArray());
  });
  it('golpes são curtos (≤ 1,2 s); desorientado emenda (loop)', () => {
    for (const n of ['stagger']) expect(SPECS[n].dur).toBeLessThanOrEqual(1.2);
    const clip = proceduralClip('disoriented', arm, idle)!;
    for (const t of clip.tracks) {
      const k = t.getValueSize(), n = t.times.length;
      if (n < 2) continue;
      for (let i = 0; i < k; i++) expect(Math.abs(t.values[i] - t.values[(n - 1) * k + i]), t.name).toBeLessThan(2e-3);
    }
  });
});

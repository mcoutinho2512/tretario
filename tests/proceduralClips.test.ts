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

/** nomes das animações do GLB da biblioteca (lê só o JSON do contêiner binário) */
function libraryClips(): Set<string> {
  const b = readFileSync('public/characters/anims.glb');
  const len = b.readUInt32LE(12);
  const j = JSON.parse(b.subarray(20, 20 + len).toString());
  return new Set((j.animations ?? []).map((a: { name: string }) => a.name));
}

/** esqueleto "game_engine" aproximado (posições do idle do homem, m): braços caídos, palmas para as coxas */
function fakeRig() {
  const W: Record<string, [string | null, [number, number, number]]> = {
    Root: [null, [0, 0, 0]], pelvis: ['Root', [0, 0.98, -0.04]], spine_01: ['pelvis', [0.01, 1.06, -0.07]],
    spine_02: ['spine_01', [0.01, 1.13, -0.08]], spine_03: ['spine_02', [0.01, 1.2, -0.08]],
    neck_01: ['spine_03', [-0.02, 1.54, 0.06]], head: ['neck_01', [-0.03, 1.64, 0.1]],
  };
  for (const [s, x] of [['l', 1], ['r', -1]] as const) {
    W[`clavicle_${s}`] = ['spine_03', [x * 0.04, 1.46, 0.05]];
    W[`upperarm_${s}`] = [`clavicle_${s}`, [x * 0.17, 1.47, -0.04]];
    W[`lowerarm_${s}`] = [`upperarm_${s}`, [x * 0.22, 1.22, -0.15]];
    W[`hand_${s}`] = [`lowerarm_${s}`, [x * 0.28, 0.96, -0.1]];
    const fz: Record<string, number> = { index: 0.0, middle: -0.02, ring: -0.04, pinky: -0.06, thumb: 0.03 };
    for (const f of ['index', 'middle', 'ring', 'pinky', 'thumb']) {
      const z = -0.1 + fz[f], x0 = f === 'thumb' ? 0.27 : 0.3;
      W[`${f}_01_${s}`] = [`hand_${s}`, [x * x0, 0.88, z + (f === 'thumb' ? 0.03 : 0)]];
      W[`${f}_02_${s}`] = [`${f}_01_${s}`, [x * x0, 0.84, z + (f === 'thumb' ? 0.05 : 0.01)]];
      W[`${f}_03_${s}`] = [`${f}_02_${s}`, [x * x0, 0.81, z + (f === 'thumb' ? 0.06 : 0.02)]];
    }
    W[`thigh_${s}`] = ['pelvis', [x * 0.11, 0.97, -0.07]];
    W[`calf_${s}`] = [`thigh_${s}`, [x * 0.2, 0.52, -0.1]];
    W[`foot_${s}`] = [`calf_${s}`, [x * 0.19, 0.07, -0.15]];
    W[`ball_${s}`] = [`foot_${s}`, [x * 0.22, -0.01, 0.0]];
  }
  const bones = new Map<string, THREE.Bone>();
  const arm = new THREE.Group();
  for (const [name, [parent, p]] of Object.entries(W)) {
    const b = new THREE.Bone();
    b.name = name;
    const pw = parent ? W[parent][1] : [0, 0, 0];
    b.position.set(p[0] - pw[0], p[1] - pw[1], p[2] - pw[2]);
    bones.set(name, b);
    (parent ? bones.get(parent)! : arm).add(b);
  }
  arm.updateMatrixWorld(true);
  // "idle": uma chave com a pose acima (a base dos clipes procedurais)
  const tracks: THREE.KeyframeTrack[] = [];
  for (const [n, b] of bones) {
    tracks.push(new THREE.QuaternionKeyframeTrack(`${n}.quaternion`, [0], b.quaternion.toArray()));
    tracks.push(new THREE.VectorKeyframeTrack(`${n}.position`, [0], b.position.toArray()));
  }
  return { arm, bones, idle: new THREE.AnimationClip('idle', 1, tracks) };
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

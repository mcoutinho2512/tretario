/**
 * Pedestres NPC de ambiente (simulados no cliente, determinísticos por semente — ADR-003).
 *
 * - Nascem em calçadas/praças/canteiros num anel ao redor do jogador, preferencialmente fora da vista.
 * - Andam só onde é calçada (mapa de superfícies), desviam de prédios (raycast), uns dos outros e do jogador.
 * - Param às vezes (olham vitrines/esperam), velocidade conforme o corpo (idosos mais lentos).
 * - LOD: animação a cada N quadros conforme a distância, sombra só perto, culling manual por frustum.
 * Os mesmos personagens esqueletais do jogador → base pronta para NPCs autoritativos no servidor (fase 3/4).
 */
import * as THREE from 'three';
import type { CollisionWorld } from '../physics/CollisionWorld';
import { createCharacter, type CharacterRig } from '../characters/CharacterMesh';
import { CharacterAnimator } from '../characters/CharacterAnimator';
import { BODY_TYPES, randomAppearance, type BodyType } from '../characters/bodyTypes';

interface Ped {
  rig: CharacterRig;
  anim: CharacterAnimator;
  x: number; z: number; y: number;
  heading: number;
  speed: number;
  cruise: number;
  idleTimer: number;
  walkTimer: number;
  animAcc: number;
  frame: number;
  active: boolean;
}

const BODY_MIX: BodyType[] = ['homem', 'mulher', 'homem', 'mulher', 'idoso', 'idosa', 'homem', 'mulher'];

export class PedestrianSystem {
  readonly group = new THREE.Group();
  private peds: Ped[] = [];
  private seed = 1;
  private frustum = new THREE.Frustum();
  private projScreen = new THREE.Matrix4();
  private tmp = new THREE.Vector3();
  radius = 95;
  stats = { active: 0, visible: 0 };

  constructor(private world: CollisionWorld, private max: number) {
    this.group.name = 'pedestrians';
  }

  setMax(n: number) {
    this.max = n;
    for (let i = n; i < this.peds.length; i++) { this.peds[i].active = false; this.peds[i].rig.mesh.visible = false; }
  }

  private rnd() {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  private create(i: number): Ped {
    const body = BODY_MIX[i % BODY_MIX.length];
    const rig = createCharacter(randomAppearance(1000 + i * 7919, body));
    this.group.add(rig.mesh);
    return {
      rig, anim: new CharacterAnimator(rig), x: 0, z: 0, y: 0, heading: 0, speed: 0, cruise: 1.3,
      idleTimer: 0, walkTimer: 0, animAcc: 0, frame: i, active: false,
    };
  }

  private spawn(p: Ped, cx: number, cz: number, camFwd: THREE.Vector3, initial: boolean): boolean {
    for (let attempt = 0; attempt < 40; attempt++) {
      const a = this.rnd() * Math.PI * 2;
      const r = initial ? 6 + this.rnd() * (this.radius - 6) : 45 + this.rnd() * (this.radius - 45);
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      if (!this.world.isPedestrianWalkable(x, z)) continue;
      // não nascer encostado em outro pedestre
      if (this.peds.some((o) => o.active && o !== p && Math.abs(o.x - x) < 1.5 && Math.abs(o.z - z) < 1.5)) continue;
      // fora do campo de visão quando não é a população inicial
      if (!initial && r < 70 && (x - cx) * camFwd.x + (z - cz) * camFwd.z > 0) continue;
      p.x = x; p.z = z; p.y = this.world.groundHeight(x, z);
      p.heading = this.rnd() * Math.PI * 2;
      const bp = BODY_TYPES[p.rig.body];
      p.cruise = (1.15 + this.rnd() * 0.45) * bp.speedFactor;
      p.speed = 0;
      p.idleTimer = this.rnd() < 0.2 ? 1 + this.rnd() * 4 : 0;
      p.walkTimer = 6 + this.rnd() * 20;
      p.rig.setAppearance(randomAppearance(Math.floor(this.rnd() * 1e9), p.rig.body));
      p.active = true;
      return true;
    }
    return false;
  }

  /** livre para andar `dist` metros na direção `h`? (calçada + sem parede no caminho) */
  private clear(x: number, z: number, h: number, dist: number, y: number): boolean {
    const nx = x + Math.sin(h) * dist, nz = z + Math.cos(h) * dist;
    if (!this.world.isPedestrianWalkable(nx, nz)) return false;
    const mx = x + Math.sin(h) * dist * 0.5, mz = z + Math.cos(h) * dist * 0.5;
    if (!this.world.isPedestrianWalkable(mx, mz)) return false;
    return this.world.raycast(x, y + 1, z, nx, y + 1, nz) >= 1;
  }

  update(dt: number, camera: THREE.Camera, player: { x: number; z: number }) {
    // população
    while (this.peds.length < this.max) this.peds.push(this.create(this.peds.length));
    const camFwd = this.tmp.set(0, 0, -1).applyQuaternion(camera.quaternion).clone();
    this.projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreen);
    const cx = player.x, cz = player.z;
    let active = 0, visible = 0;

    for (let i = 0; i < this.max; i++) {
      const p = this.peds[i];
      if (!p.active) {
        const initial = this.time < 1;
        if (!this.spawn(p, cx, cz, camFwd, initial)) { p.rig.mesh.visible = false; continue; }
      }
      const d = Math.hypot(p.x - cx, p.z - cz);
      if (d > this.radius + 20) { p.active = false; p.rig.mesh.visible = false; continue; }
      active++;

      // comportamento
      if (p.idleTimer > 0) {
        p.idleTimer -= dt;
        p.speed = Math.max(0, p.speed - dt * 3);
      } else {
        p.walkTimer -= dt;
        if (p.walkTimer < 0) {
          p.walkTimer = 8 + this.rnd() * 25;
          if (this.rnd() < 0.35) p.idleTimer = 1.5 + this.rnd() * 5;
        }
        p.speed += (p.cruise - p.speed) * (1 - Math.exp(-3 * dt));
        // desvio de obstáculos: testa direções próximas à atual
        if (!this.clear(p.x, p.z, p.heading, 1.8, p.y)) {
          let found = false;
          const pref = this.rnd() < 0.5 ? 1 : -1;
          for (const off of [0.5, 1.0, 1.6, 2.3, 3.14]) {
            for (const s of [pref, -pref]) {
              const h = p.heading + off * s;
              if (this.clear(p.x, p.z, h, 2.5, p.y)) { p.heading = h; found = true; break; }
            }
            if (found) break;
          }
          if (!found) { p.speed = 0; p.heading += Math.PI * (0.5 + this.rnd()); }
        } else if (this.rnd() < dt * 0.15) {
          p.heading += (this.rnd() - 0.5) * 0.6; // leve variação de rumo
        }
      }
      // separação (outros pedestres e jogador)
      let sx = 0, sz = 0;
      for (let j = 0; j < this.max; j++) {
        if (j === i) continue;
        const o = this.peds[j];
        if (!o || !o.active) continue;
        const dx = p.x - o.x, dz = p.z - o.z;
        const dd = dx * dx + dz * dz;
        if (dd < 0.8 && dd > 1e-6) { const l = Math.sqrt(dd); sx += (dx / l) * (0.9 - l); sz += (dz / l) * (0.9 - l); }
      }
      {
        const dx = p.x - player.x, dz = p.z - player.z;
        const l = Math.hypot(dx, dz);
        if (l < 1.1 && l > 1e-6) { sx += (dx / l) * (1.1 - l) * 2; sz += (dz / l) * (1.1 - l) * 2; }
      }
      const vx = Math.sin(p.heading) * p.speed + sx * 2, vz = Math.cos(p.heading) * p.speed + sz * 2;
      const nx = p.x + vx * dt, nz = p.z + vz * dt;
      if (this.world.isPedestrianWalkable(nx, nz)) { p.x = nx; p.z = nz; }
      const pos = { x: p.x, y: p.y, z: p.z };
      this.world.resolveCircle(pos, 0.3, 1.7);
      if (this.world.isPedestrianWalkable(pos.x, pos.z)) { p.x = pos.x; p.z = pos.z; }
      p.y = this.world.groundHeight(p.x, p.z);

      // visual + LOD
      const mesh = p.rig.mesh;
      mesh.position.set(p.x, p.y, p.z);
      mesh.rotation.y = p.heading;
      const inView = this.frustum.containsPoint(this.tmp.set(p.x, p.y + 1, p.z)) || d < 3;
      mesh.visible = inView;
      if (!inView) continue;
      visible++;
      mesh.castShadow = d < 35;
      const every = d < 25 ? 1 : d < 50 ? 2 : 4;
      p.animAcc += dt;
      if ((++p.frame) % every === 0) {
        p.anim.update(p.speed, true, p.animAcc);
        p.animAcc = 0;
      }
    }
    this.time += dt;
    this.stats.active = active;
    this.stats.visible = visible;
  }

  private time = 0;
}

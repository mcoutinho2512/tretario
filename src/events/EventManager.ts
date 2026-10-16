/**
 * EventManager: carrega um EventDef (JSON) e aplica ao mundo, sem lógica específica de tema:
 *  - painéis de LED (plano de conteúdo)
 *  - decorações (banners/bandeiras nos postes da avenida, cores do evento)
 *  - cores dos grupos nas roupas de parte dos NPCs
 * Fonte hoje: public/events/*.json (?event=id). Futuro: backend define o evento ativo por sala/horário.
 */
import * as THREE from 'three';
import type { EventDef, WorldDecoration } from './types';
import type { BillboardSystem } from './Billboards';
import type { PropRec } from '../world/types';

export class EventManager {
  current: EventDef | null = null;
  readonly decorations = new THREE.Group();
  private windUniform = { value: 0 };

  constructor(
    private baseUrl: string,
    private billboards: BillboardSystem,
    private lamps: () => PropRec[],
    private heightAt: (x: number, z: number) => number,
    private onGroups: (palettes: { colors: number[]; share: number }[]) => void,
  ) {
    this.decorations.name = 'event_decorations';
  }

  async load(id?: string): Promise<EventDef> {
    let eventId = id;
    if (!eventId) {
      try {
        const idx = await (await fetch(`${this.baseUrl}index.json`)).json();
        eventId = idx.default;
      } catch { eventId = 'cotidiano'; }
    }
    const res = await fetch(`${this.baseUrl}${eventId}.json`);
    if (!res.ok) throw new Error(`evento "${eventId}" não encontrado`);
    const ev = (await res.json()) as EventDef;
    this.apply(ev);
    return ev;
  }

  apply(ev: EventDef) {
    this.current = ev;
    this.billboards.setPlan(ev.billboards);
    this.buildDecorations(ev.decorations ?? []);
    this.onGroups((ev.groups ?? []).map((g) => ({ colors: g.colors.map((c) => new THREE.Color(c).getHex()), share: g.npcShare ?? 0 })));
  }

  private buildDecorations(decs: WorldDecoration[]) {
    for (const c of [...this.decorations.children]) {
      this.decorations.remove(c);
      (c as THREE.Mesh).geometry?.dispose();
    }
    if (!decs.length) return;
    const lamps = this.lamps();
    for (const d of decs) {
      const every = Math.max(1, d.every ?? 1);
      const sel = lamps.filter((_, i) => i % every === 0);
      const isFlag = d.type === 'flag';
      const w = isFlag ? 1.3 : 0.75, h = isFlag ? 0.85 : 2.3;
      const geo = new THREE.PlaneGeometry(w, h, 6, 1);
      geo.translate(w / 2 + 0.12, 0, 0);
      const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide, roughness: 0.85 });
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = this.windUniform;
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nuniform float uTime;')
          .replace('#include <begin_vertex>', `#include <begin_vertex>
            float k = max(0.0, transformed.x - 0.12);
            #ifdef USE_INSTANCING
              float ph = instanceMatrix[3][0] * 0.3 + instanceMatrix[3][2] * 0.2;
            #else
              float ph = 0.0;
            #endif
            transformed.z += sin(uTime * 3.0 + k * 2.5 + ph) * 0.12 * k;`);
      };
      mat.customProgramCacheKey = () => 'pv-event-banner';
      const count = sel.length * 2;
      const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, count));
      mesh.castShadow = true;
      const dummy = new THREE.Object3D();
      const colors = d.colors.map((c) => new THREE.Color(c));
      let n = 0;
      sel.forEach((l, i) => {
        const y = this.heightAt(l.p[0], l.p[1]) + (isFlag ? 9.6 : 7.2);
        const base = Math.atan2(Math.cos(l.r ?? 0), Math.sin(l.r ?? 0));
        for (const side of [0, Math.PI]) {
          dummy.position.set(l.p[0], y, l.p[1]);
          dummy.rotation.set(0, base + side + Math.PI / 2, 0);
          dummy.updateMatrix();
          mesh.setMatrixAt(n, dummy.matrix);
          mesh.setColorAt(n, colors[(i + (side ? 1 : 0)) % colors.length]);
          n++;
        }
      });
      mesh.count = n;
      mesh.name = `decor_${d.type}`;
      this.decorations.add(mesh);
    }
  }

  update(time: number) {
    this.windUniform.value = time;
  }
}

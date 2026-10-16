/**
 * Cenário de EVENTO (rodada 7): caminhões de campanha, telões de treliça e palco nos lugares calculados pelo
 * pipeline (manifest.eventSpots — tools/build_world.ts; carrocerias já na colisão do servidor) + o canal dos
 * telões (src/events/screenFeed.ts), compartilhado com o telão do trio elétrico.
 *
 * Arte: DADOS do evento (`EventDef.scenery.designs`: id → chave de design). Sem configuração, os caminhões recebem
 * as campanhas cadastradas (public/designs/campaigns.json) em rodízio, mais a arte neutra do ato — o código não
 * conhece nenhuma candidatura e trata todas igualmente.
 */
import * as THREE from 'three';
import type { WorldManifest } from './types';
import type { CollisionWorld } from '../physics/CollisionWorld';
import type { EventDef } from '../events/types';
import { DESIGNS, DESIGN_BY_ID, DESIGN_BY_KEY } from '../social/designs';
import { rallyPoints, RALLY_DEFAULT_WEIGHTS } from '../social/rally';
import { applyDesign, buildCampaignTruck, buildScreenStand, buildStage, screenMeshes, setEventNight } from '../vehicles/eventModels';
import { screenFeed, type ScreenSlide } from '../events/screenFeed';

type Spot = NonNullable<WorldManifest['eventSpots']>[number];
interface Item { spot: Spot; root: THREE.Group; design: number }

export class EventScenery {
  readonly group = new THREE.Group();
  readonly items: Item[] = [];
  /** telões fora do cenário (o do trio): registrados pelo jogo */
  private extraScreens: { mesh: THREE.Mesh; anchor: THREE.Object3D }[] = [];
  private screens: { mesh: THREE.Mesh; anchor: THREE.Object3D }[] = [];

  constructor(manifest: WorldManifest, heightAt: (x: number, z: number) => number, collision?: CollisionWorld) {
    this.group.name = 'event_scenery';
    this.group.userData.category = 'world/event';
    let ti = 0;
    for (const sp of manifest.eventSpots ?? []) {
      // caminhões alternam com e sem palquinho no teto (mesma família de geometria)
      const root = sp.kind === 'truck' ? buildCampaignTruck(0, ti++ % 2 === 0) : sp.kind === 'stage' ? buildStage(0) : buildScreenStand();
      root.name = `event_${sp.id}`;
      root.position.set(sp.x, heightAt(sp.x, sp.z), sp.z);
      root.rotation.y = sp.heading;
      this.group.add(root);
      this.items.push({ spot: sp, root, design: 0 });
      for (const m of screenMeshes(root)) this.screens.push({ mesh: m, anchor: root });
      // colisão no cliente igual à do servidor (pipeline)
      if (collision) {
        const boxes = sp.kind === 'truck' ? [[0, 0, 4.25, 1.25, 3.8]] : sp.kind === 'stage' ? [[0, 0, 3.5, 5, 1.5]] : [[-2.6, 0, 0.3, 0.3, 6.5], [2.6, 0, 0.3, 0.3, 6.5]];
        const fx = Math.sin(sp.heading), fz = Math.cos(sp.heading);
        for (const [ox, , hl, hw, top] of boxes) {
          const cx = sp.x + fz * ox, cz = sp.z - fx * ox;
          const c = [[hl, hw], [hl, -hw], [-hl, -hw], [-hl, hw]].map(([a, l]) => [cx + fx * a + fz * l, cz + fz * a - fx * l]);
          for (let k = 0; k < 4; k++) collision.addSegment({ ax: c[k][0], az: c[k][1], bx: c[(k + 1) % 4][0], bz: c[(k + 1) % 4][1], bottom: 0, top });
        }
      }
      // pontos de concentração: o palco atrai muito; caminhões de campanha, pouco (cenário)
      if (sp.kind === 'stage') {
        // concentração NA FRENTE do palco (o palco olha para +z local)
        const front = { x: sp.x + Math.sin(sp.heading) * 9, z: sp.z + Math.cos(sp.heading) * 9 };
        rallyPoints.upsert({ id: `stage_${sp.id}`, kind: 'stage', x: front.x, z: front.z, inner: 3, radius: 20, strength: 0.9, actionWeights: RALLY_DEFAULT_WEIGHTS.stage, faceCenter: false });
      } else if (sp.kind === 'truck') {
        rallyPoints.upsert({ id: `truck_${sp.id}`, kind: 'event', x: sp.x, z: sp.z, inner: 5.5, radius: 11, strength: 0.35, actionWeights: RALLY_DEFAULT_WEIGHTS.event });
      }
    }
    this.applyEvent(null);
  }

  /** arte e programação dos telões a partir do evento (dados) */
  applyEvent(ev: EventDef | null | undefined) {
    const cfg = ev?.scenery;
    const byKey = (k: string | undefined) => (k ? DESIGN_BY_KEY.get(k)?.id ?? 0 : 0);
    // rodízio padrão dos caminhões: todas as campanhas cadastradas (ordem do id) + arte neutra do ato
    const rotation = [...DESIGNS.filter((d) => d.family === 'campaign' && d.targets.includes('truck')).map((d) => d.id), byKey('ato_pv')];
    let ti = 0;
    for (const it of this.items) {
      const configured = byKey(cfg?.designs?.[it.spot.id]);
      const d = configured || (it.spot.kind === 'truck' ? rotation[ti++ % rotation.length] : 0);
      this.setDesign(it.spot.id, d);
    }
    const feed = screenFeed();
    if (cfg?.screenSeconds) feed.rotateSeconds = cfg.screenSeconds;
    feed.setPlaylist(cfg?.screens?.map((k): ScreenSlide => (k === 'info' ? { type: 'info' } : k === 'eq' ? { type: 'eq', text: cfg.ticker } : { type: 'design', design: k })));
  }

  /** troca a arte de um item (id do spot) — só textura, a geometria não muda */
  setDesign(id: string, design: number | string) {
    const it = this.items.find((i) => i.spot.id === id);
    if (!it) return false;
    const d = typeof design === 'string' ? DESIGN_BY_KEY.get(design)?.id ?? 0 : DESIGN_BY_ID.has(design) ? design : 0;
    it.design = d;
    applyDesign(it.root, d);
    return true;
  }

  /** o telão do trio (ou de outro veículo) entra no mesmo controle de perto/longe */
  addScreens(root: THREE.Object3D) {
    for (const m of screenMeshes(root)) this.extraScreens.push({ mesh: m, anchor: root });
  }

  /** telões: perto → canal animado (2 Hz); longe → material liso. O canal só redesenha se algum estiver perto */
  update(dt: number, cam: THREE.Vector3, night = 0) {
    setEventNight(night);
    const feed = screenFeed();
    let anyNear = false;
    for (const list of [this.screens, this.extraScreens]) for (const s of list) {
      const p = s.anchor.position;
      const near = Math.hypot(p.x - cam.x, p.z - cam.z) < feed.nearDistance;
      s.mesh.material = near ? feed.material : feed.farMaterial;
      if (near && s.anchor.visible) anyNear = true;
    }
    feed.update(dt, anyNear);
  }
}

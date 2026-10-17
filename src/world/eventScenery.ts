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
import { rallyPoints, RALLY_DEFAULT_WEIGHTS, RALLY_SHAPE } from '../social/rally';
import { applyDesign, buildCampaignTruck, buildScreenStand, buildStage, screenMeshes, setEventNight } from '../vehicles/eventModels';
import { ScreenFeed, screenFeed, type ScreenSlide } from '../events/screenFeed';

type Spot = NonNullable<WorldManifest['eventSpots']>[number];
interface Item { spot: Spot; root: THREE.Group; design: number }

export class EventScenery {
  readonly group = new THREE.Group();
  readonly items: Item[] = [];
  /** telões fora do cenário (o do trio): registrados pelo jogo */
  private extraScreens: { mesh: THREE.Mesh; anchor: THREE.Object3D; id: string }[] = [];
  private screens: { mesh: THREE.Mesh; anchor: THREE.Object3D; id: string }[] = [];
  /** rodada 9 — telão com AdSlot (src/ads): canal PRÓPRIO = programação do evento intercalada com o conteúdo do slot */
  private adFeeds = new Map<string, { feed: ScreenFeed; slide: ScreenSlide }>();

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
      for (const m of screenMeshes(root)) this.screens.push({ mesh: m, anchor: root, id: sp.id });
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
        const S = RALLY_SHAPE.stage;
        const front = { x: sp.x + Math.sin(sp.heading) * S.front, z: sp.z + Math.cos(sp.heading) * S.front };
        rallyPoints.upsert({ id: `stage_${sp.id}`, kind: S.kind, x: front.x, z: front.z, inner: S.inner, radius: S.radius, strength: S.strength, actionWeights: RALLY_DEFAULT_WEIGHTS.stage, faceCenter: false });
      } else if (sp.kind === 'truck') {
        const T = RALLY_SHAPE.truck;
        rallyPoints.upsert({ id: `truck_${sp.id}`, kind: T.kind, x: sp.x, z: sp.z, inner: T.inner, radius: T.radius, strength: T.strength, actionWeights: RALLY_DEFAULT_WEIGHTS.event });
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
    for (const [, a] of this.adFeeds) this.adPlaylist(a.feed, a.slide);
  }

  /** conteúdo de um AdSlot num telão (id do spot / 'trio0'); null volta ao canal comum. Só slides internos */
  setScreenAd(target: string, slide: ScreenSlide | null): boolean {
    const known = this.screens.some((s) => s.id === target) || this.extraScreens.some((s) => s.id === target);
    if (!known) return false;
    const cur = this.adFeeds.get(target);
    if (!slide) { if (cur) { cur.feed.material.map?.dispose(); cur.feed.material.dispose(); cur.feed.farMaterial.dispose(); this.adFeeds.delete(target); } return true; }
    if (cur) { cur.slide = slide; this.adPlaylist(cur.feed, slide); return true; }
    const shared = screenFeed();
    const f = new ScreenFeed();
    f.info = () => shared.info(); f.now = () => shared.now(); f.zoneName = (id) => shared.zoneName(id);
    f.rotateSeconds = shared.rotateSeconds; f.nearDistance = shared.nearDistance;
    this.adFeeds.set(target, { feed: f, slide });
    this.adPlaylist(f, slide);
    return true;
  }

  /** programação do evento intercalada 1:1 com o slide do slot (agenda/avisos/arte aparecem metade do tempo) */
  private adPlaylist(f: ScreenFeed, slide: ScreenSlide) {
    const base = screenFeed().playlist;
    const out: ScreenSlide[] = [];
    for (const b of base) out.push(slide, b);
    f.setPlaylist(out.length ? out : [slide]);
  }

  /** QA: telões com canal próprio (slot) e o slide atual de cada um */
  adTargets() { return [...this.adFeeds].map(([id, a]) => ({ id, slide: a.feed.playlist[a.feed.slideIndex]?.type ?? null, ad: a.slide.type, draws: a.feed.draws })); }

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
  addScreens(root: THREE.Object3D, id = '') {
    for (const m of screenMeshes(root)) this.extraScreens.push({ mesh: m, anchor: root, id });
  }

  /** telões: perto → canal animado (2 Hz); longe → material liso. O canal só redesenha se algum estiver perto */
  update(dt: number, cam: THREE.Vector3, night = 0) {
    setEventNight(night);
    const shared = screenFeed();
    let anyNear = false;
    const adNear = new Set<string>();
    for (const list of [this.screens, this.extraScreens]) for (const s of list) {
      const p = s.anchor.position;
      const ad = this.adFeeds.get(s.id)?.feed;
      const feed = ad ?? shared;
      const near = Math.hypot(p.x - cam.x, p.z - cam.z) < feed.nearDistance;
      s.mesh.material = near ? feed.material : feed.farMaterial;
      if (near && s.anchor.visible) { if (ad) adNear.add(s.id); else anyNear = true; }
    }
    shared.update(dt, anyNear);
    for (const [id, a] of this.adFeeds) a.feed.update(dt, adNear.has(id));
  }
}

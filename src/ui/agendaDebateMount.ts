/**
 * Montagem da rodada 9 no CLIENTE (agenda, "Acontecendo agora", painel do debate, palco no mundo, telões/painéis com
 * AdSlots) — o jogo (src/core/Game.ts) chama `mountAgendaDebate` uma vez no HUD e `attach(net)` ao conectar. Tudo
 * por evento/mensagem; por quadro só `update(dt)` (pulso do lugar de quem fala).
 */
import type { HudShell } from './hud/HudShell';
import type { WorldManifest } from '../world/types';
import type { ZoneDefinition } from '../world/zones';
import { pointOnAxis } from '../world/zones';
import type { AgendaEntry } from '../events/schedule';
import type { AdSlotDefinition } from '../ads/types';
import type { BillboardContent } from '../events/types';
import type { ScreenSlide } from '../events/screenFeed';
import { screenFeed } from '../events/screenFeed';
import { AgendaFeed, AgendaPanel, NowHappening, joinDeniedText } from './AgendaUi';
import { DebatePanel } from './DebatePanel';
import { DebateStage } from '../events/DebateStage';
import { AdSlotClient } from '../ads/AdSlotClient';
import { entryTitle } from '../events/agendaFormat';
import type { RallyCrowd } from '../social/RallyCrowd';
import type * as THREE from 'three';

export interface AgendaDebateCtx {
  shell: HudShell;
  manifest: WorldManifest;
  zones: readonly ZoneDefinition[];
  isTouch: boolean;
  input: { releaseAll(): void };
  now: () => number;
  heightAt: (x: number, z: number) => number;
  scene: THREE.Object3D;
  rallyCrowd: RallyCrowd | null;
  billboards: { setPanelContent(id: string, c: BillboardContent | null): void };
  scenery: { setScreenAd(target: string, s: ScreenSlide | null): boolean };
  playerPos: () => { x: number; z: number };
  flash: (m: string, ms?: number) => void;
  /** o painel abriu/fechou (soltar/recapturar o mouse) */
  onModal: (open: boolean) => void;
  base: string;
}

export interface Transport { send(type: string, payload?: unknown): void; on(type: string, fn: (msg: any) => void): void }

export function mountAgendaDebate(c: AgendaDebateCtx) {
  const zoneName = (id: string) => c.zones.find((z) => z.id === id)?.name;
  const feed = new AgendaFeed(c.now);
  const stageSpot = c.manifest.eventSpots?.find((s) => s.kind === 'stage');
  const debate = new DebatePanel({ isTouch: c.isTouch, input: c.input, now: c.now });
  debate.onNotice = (m) => c.flash(m);
  debate.onToggle = (open) => c.onModal(open && !c.isTouch);
  // lugares do palco: 5 marcas (o estado do servidor diz quantas ocupadas)
  const stage = stageSpot ? new DebateStage(stageSpot, 5, c.heightAt, c.rallyCrowd) : null;
  if (stage) c.scene.add(stage.group);
  debate.onState = (st) => stage?.apply(st);

  /** "como chegar": ponto do evento (palco / âncora da zona) no minimapa + distância no aviso */
  const directions = (e: AgendaEntry) => {
    let p: { x: number; z: number } | null = null;
    if (e.format === 'debate' && stageSpot) p = stageSpot;
    else {
      const z = c.zones.find((q) => q.id === e.zone);
      if (z) { const a = z.anchor ?? { t: (z.from + z.to) / 2, side: 0 }; p = pointOnAxis(c.manifest.pvAxis as [number, number][], a.t, a.side); }
    }
    const title = entryTitle(e);
    if (!p) { c.flash(title); return; }
    c.shell.minimap.setTarget({ x: p.x, z: p.z, label: title });
    c.shell.toggleMap(true);
    const me = c.playerPos(), d = Math.hypot(p.x - me.x, p.z - me.z);
    c.flash(`${title}: ${d < 40 ? 'você já está aqui' : `${Math.round(d / 10) * 10} m daqui`}${e.zone && zoneName(e.zone) ? ` · ${zoneName(e.zone)}` : ''}`, 4000);
    if (e.format === 'debate' && d > 40) debate.watch(true); // acompanha o debate de longe pelo painel
  };
  const now = new NowHappening(feed, directions, zoneName);
  const agenda = new AgendaPanel(feed, (e) => { agenda.toggle(false); directions(e); }, zoneName);
  agenda.onToggle = (open) => c.onModal(open);
  feed.onResult = (r) => c.flash(r.ok ? 'Inscrição atualizada' : joinDeniedText(r.r));
  c.shell.mountNow(now);
  c.shell.mountOverlay(agenda);
  c.shell.mountOverlay(debate);
  c.shell.addMenuItem('Agenda da avenida', () => agenda.toggle(true));
  c.shell.addMenuItem('Palco de debate', () => (debate.open ? debate.toggle(false) : debate.watch(true)));

  // telões/painéis: definições (mesmo arquivo do servidor) → conteúdo pela mensagem `ads`
  let ads: AdSlotClient | null = null;
  let pending: Transport | null = null;
  const sf = screenFeed();
  sf.now = c.now;
  sf.zoneName = zoneName;
  void fetch(`${c.base}gameplay/adslots.json`).then((r) => (r.ok ? r.json() : { slots: [] })).then((j: { slots?: AdSlotDefinition[] }) => {
    ads = new AdSlotClient(j.slots ?? [], { billboard: (id, ct) => c.billboards.setPanelContent(id, ct), screen: (t, s) => c.scenery.setScreenAd(t, s) }, zoneName);
    if (pending) ads.attach(pending);
  }).catch(() => { /* sem slots: telões seguem com a programação do evento */ });

  const api = {
    feed, debate, agenda, now, stage,
    get ads() { return ads; },
    attach(net: Transport) {
      feed.attach(net);
      debate.attach(net);
      if (ads) ads.attach(net); else pending = net;
    },
    update(dt: number) { stage?.update(dt); },
    info() { return { agenda: feed.list.length, nowRenders: now.renders, debate: debate.info(), stage: stage?.stats, ads: ads ? Object.fromEntries(ads.current) : null, adStats: ads?.stats }; },
  };
  return api;
}

export type AgendaDebate = ReturnType<typeof mountAgendaDebate>;

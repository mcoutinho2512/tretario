/**
 * Rodada 11 — CONTROLADOR do inventário, equipamentos e acesso rápido (docs/INVENTORY.md, docs/EQUIPMENT_SYSTEM.md).
 *
 * O cliente só PEDE; quem decide é o servidor, pelos caminhos que já existem:
 *  roupa/acessório/camisa  conta: PUT /api/me/appearance ESTRITO (bloqueado → 403) e aviso à sala; visitante (servidor
 *                          de teste): mensagem `appearance` — a sala valida e o que ela aplicou volta pelo estado
 *  mão (HAND)              `prop {p,d}` pelo SocialController (validateProp: design bloqueado, item de confronto sem
 *                          posse → `prop_denied`); missões contam no servidor (`prop {slot}`)
 *  título                  `title {t}` (RoomTitles: só títulos GANHOS; conta grava em Profile.titleKey)
 *  torcida                 conta: PUT /api/me/supporter; visitante: `sup {group}` (mesma política)
 *
 * "Equipado" na interface = o que o servidor confirmou (NetPlayer/estado social), lido de novo a 4 Hz; o acesso
 * rápido acende o slot do item NA MÃO (a mesma fonte do indicador MÃOS e do avatar).
 */
import './inventory.css';
import type { CharacterAppearance } from '../characters/bodyTypes';
import { localEntitlements } from '../characters/unlocks';
import { validateAppearance, sameAppearance } from '../characters/validateAppearance';
import type { ProgressionCatalog } from '../progression/engine';
import { PROP_BY_ID } from '../social/props';
import { loadSupporterData } from '../supporters/data';
import { setLocalSupporter } from '../supporters/session';
import type { SupporterData } from '../supporters/types';
import { accountApi, errorText } from '../identity/client';
import { EscSlot } from '../ui/escStack';
import { buildInventory, type InventoryContext, type InventoryEntry } from './catalog';
import { planEquip, planUnequip, type EquipPlan } from './equipRules';
import { isActive, loadQuickbar, pinQuick, saveQuickbar } from './quickbar';
import { markSeen, seenItems } from './seen';
import { InventoryPanel } from './InventoryPanel';
import { QuickbarView } from './QuickbarView';
import { createInventoryPreview, previewStats, type InventoryPreview } from './previewAdapter';
import { inventoryAccount } from './accountBridge';
import type { QuickbarLayout } from './types';

export interface InventoryHost {
  touch: boolean;
  appearance(): CharacterAppearance;
  /** aplica no avatar; sem `localOnly` também avisa a sala (`appearance`) */
  setAppearance(app: CharacterAppearance, opts?: { localOnly?: boolean }): void;
  social: { prop: number; design: number; requestProp(id: number, design?: number): void };
  /** item de confronto POSSUÍDO (servidor) e `freeCombatProps` */
  carried(): number;
  freeCombat(): boolean;
  online(): boolean;
  send(type: string, payload?: unknown): void;
  on(type: string, fn: (m: any) => void): () => void;
  /** a própria entidade como o servidor a tem (NetPlayer) */
  selfPlayer(): Record<string, unknown> | null;
  /** títulos ganhos (cópia do `prog`) e catálogo de progressão (requisitos) */
  titles(): readonly string[];
  progression(): ProgressionCatalog | null;
  /** política de confronto onde o jogador está ('PEACE' | 'CONTESTED' | 'COMBAT' | 'TRAINING') */
  zonePolicy(): string;
  /** aviso curto do HUD (sem modal) */
  notify(msg: string): void;
  onModal(open: boolean): void;
  setMoveBlocked(on: boolean): void;
}

const APP_FIELDS = ['topStyle', 'bottomStyle', 'shoeStyle', 'hairStyle', 'accessory', 'shirtDesign'] as const;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class InventoryController {
  readonly panel: InventoryPanel;
  readonly quickbar: QuickbarView;
  private layout: QuickbarLayout = loadQuickbar();
  private items: InventoryEntry[] = [];
  private sig = '';
  private acc = 0;
  private sup: SupporterData | null = null;
  private preview: InventoryPreview | null = null;
  private esc = new EscSlot('inventory', 100, () => this.close());
  private titleWait: ((m: { ok: boolean; title?: string | null; reason?: string }) => void) | null = null;
  private supWait: ((m: { ok: boolean; r?: string; retryInS?: number; deferred?: boolean }) => void) | null = null;
  /** QA */
  readonly log: string[] = [];
  readonly stats = { opens: 0, closes: 0, equips: 0, refused: 0, quick: 0 };

  constructor(private h: InventoryHost) {
    this.panel = new InventoryPanel({
      select: (k) => this.select(k),
      equip: (k) => void this.equip(k),
      unequip: (k) => void this.unequip(k),
      pin: (k, i) => this.pin(k, i),
      close: () => this.close(),
      view: (s) => this.preview?.view(s),
      zoom: (by) => this.preview?.zoom?.(by),
    });
    this.panel.onCategory = () => this.syncPreview();
    this.quickbar = new QuickbarView(h.touch, { open: () => this.toggle(), use: (i) => void this.quick(i) });
    // UM ouvinte por tipo, para sempre (abrir/fechar não acumula ouvintes)
    h.on('title_res', (m) => { const f = this.titleWait; this.titleWait = null; f?.(m); });
    h.on('sup_res', (m) => { const f = this.supWait; this.supWait = null; f?.(m); });
    void loadSupporterData(`${import.meta.env.BASE_URL}gameplay/supporters.json`).then((d) => { this.sup = d; this.sig = ''; });
  }

  get open() { return this.panel.open; }

  // ------------------------------------------------------------------ abrir / fechar
  toggle() { if (this.open) this.close(); else this.openPanel(); }

  openPanel() {
    if (this.open) return;
    this.stats.opens++;
    this.refresh(true);
    this.panel.show();
    this.panel.update(this.items, this.layout, true);
    this.esc.set(true); // pilha única do Esc (prioridade de painel)
    this.h.onModal(true);
    this.h.setMoveBlocked(true);
    this.syncPreview();
    this.log.push('open');
  }

  close() {
    if (!this.open) return;
    this.stats.closes++;
    this.panel.hide();
    this.esc.set(false);
    this.preview?.dispose(); this.preview = null; // um renderer só, e só com o painel aberto
    this.h.setMoveBlocked(false);
    this.h.onModal(false);
    this.log.push('close');
  }

  // ------------------------------------------------------------------ estado
  private ctx(): InventoryContext {
    const self = this.h.selfPlayer();
    const supIdx = Number(self?.sup ?? 0);
    return {
      app: this.h.appearance(), prop: this.h.social.prop, design: this.h.social.design, ent: localEntitlements.items,
      carried: this.h.carried(), freeCombat: this.h.freeCombat(), titles: this.h.titles(),
      title: typeof self?.title === 'string' && self.title ? self.title : null,
      supporters: this.sup, supporter: supIdx > 0 ? this.sup?.groups[supIdx - 1]?.id ?? null : null,
      progression: this.h.progression(), seen: seenItems(),
    };
  }

  /** remonta o catálogo só quando algo que ele usa mudou */
  private refresh(force = false) {
    const c = this.ctx();
    const a = c.app;
    const sig = `${a.body}|${APP_FIELDS.map((f) => a[f] ?? '').join(',')}|${c.prop}.${c.design}|${c.carried}${c.freeCombat ? 'f' : ''}|${c.ent.size}|${c.titles.length}|${c.title}|${c.supporter}|${c.supporters ? 1 : 0}|${c.progression ? 1 : 0}|${c.seen?.size}`;
    if (!force && sig === this.sig) return false;
    this.sig = sig;
    this.items = buildInventory(c);
    return true;
  }

  /** por quadro (barato): 4 Hz — estado confirmado pelo servidor → painel e acesso rápido */
  frame(dt: number) {
    this.acc += dt;
    if (this.acc < 0.25) return;
    this.acc = 0;
    const changed = this.refresh();
    if (this.open && changed) { this.panel.update(this.items, this.layout); this.syncPreview(); }
    this.renderQuick();
  }

  private renderQuick() {
    const prop = this.h.social.prop, design = this.h.social.design;
    this.quickbar.set(this.layout.map((key) => {
      const item = key ? this.items.find((i) => i.key === key) ?? null : null;
      return { key, item, active: !!key && isActive(key, prop, design) };
    }), this.items.some((i) => i.isNew));
  }

  // ------------------------------------------------------------------ prévia 3D (um renderer, só aberto)
  private syncPreview() {
    if (!this.open) return;
    if (!this.panel.wants3d()) return; // categoria sem 3D: o renderer fica (troca rápida), some ao fechar
    if (!this.preview) {
      try { this.preview = createInventoryPreview(this.panel.previewHost, this.h.appearance()); } catch { this.preview = null; return; }
    }
    const sel = this.panel.selectedItem();
    const plan = sel?.preview3d ? planEquip(sel.key, this.equipState()) : null;
    this.preview.show(plan?.kind === 'appearance' ? plan.app : this.h.appearance());
  }

  private equipState() { return { app: this.h.appearance(), prop: this.h.social.prop, design: this.h.social.design, neutralId: this.sup?.neutralId ?? null }; }

  select(key: string) {
    this.panel.setSelected(key);
    if (markSeen(key)) { this.refresh(true); this.panel.update(this.items, this.layout); }
    this.syncPreview();
  }

  // ------------------------------------------------------------------ equipar / desequipar
  async equip(key: string) {
    const it = this.items.find((i) => i.key === key);
    if (!it) return;
    if (it.state === 'locked') {
      // o servidor recusaria de qualquer jeito; aqui só o aviso curto (sem modal)
      this.h.notify(it.slot === 'HAND' && it.propId ? 'Você não possui este item.' : `${it.label}: bloqueado — ${it.lockedReason ?? 'veja PROGRESSO'}`);
      return;
    }
    if (it.state === 'equipped') return;
    await this.run(planEquip(key, this.equipState()), it);
  }

  async unequip(key: string) {
    const it = this.items.find((i) => i.key === key);
    if (!it || it.state !== 'equipped' || !it.removable) return;
    await this.run(planUnequip(key, this.equipState()), it);
  }

  private async run(plan: EquipPlan, it: InventoryEntry) {
    this.stats.equips++;
    this.log.push(`${plan.kind}:${it.key}`);
    if (plan.kind === 'none') { this.h.notify(plan.reason); return; }
    this.setPending(it.key);
    try {
      if (plan.kind === 'appearance') await this.applyAppearance(plan.app, it);
      else if (plan.kind === 'prop') await this.applyProp(plan.prop, plan.design);
      else if (plan.kind === 'title') await this.applyTitle(plan.title);
      else await this.applySupporter(plan.group);
    } finally {
      this.setPending(null);
      this.refresh(true);
      if (this.open) { this.panel.update(this.items, this.layout); this.syncPreview(); }
      this.renderQuick();
    }
  }

  private setPending(k: string | null) { this.panel.pending = k; if (this.open) this.panel.render(); }

  private async applyAppearance(next: CharacterAppearance, it: InventoryEntry) {
    const acct = inventoryAccount();
    if (acct) {
      const r = await accountApi.putAppearanceStrict(next);
      if (!r.ok || !r.data) { this.stats.refused++; this.h.notify(r.error === 'bloqueado' ? `${it.label}: bloqueado — ${it.lockedReason ?? 'veja PROGRESSO'}` : errorText(r.error)); return; }
      this.h.setAppearance(r.data.appearance); // o que o SERVIDOR aceitou (a sala relê do banco)
      acct.onLook(r.data.appearance);
      return;
    }
    if (!this.h.online()) { // sem servidor: o mesmo validador, só local
      const v = validateAppearance(next, this.h.appearance(), localEntitlements);
      if (v) this.h.setAppearance(v, { localOnly: true });
      return;
    }
    this.h.setAppearance(next);
    // confirmação: o estado da própria entidade passa a refletir o pedido (ou o servidor recusou parte dele)
    const want = validateAppearance(next, this.h.appearance(), localEntitlements)!;
    for (let t = 0; t < 2000; t += 100) {
      await wait(100);
      const s = this.serverApp();
      if (s && APP_FIELDS.every((f) => (s[f] ?? null) === (want[f] ?? null))) return;
    }
    const s = this.serverApp();
    if (s && !sameAppearance(s, this.h.appearance())) { this.stats.refused++; this.h.notify(`${it.label}: recusado pelo servidor`); this.h.setAppearance(s, { localOnly: true }); }
  }

  /** aparência da própria entidade como a sala aplicou */
  private serverApp(): CharacterAppearance | null {
    const p = this.h.selfPlayer();
    if (!p || typeof p.body !== 'string') return null;
    // o servidor já validou: aqui só se lê (nenhum item é trocado pelo padrão)
    const all = { items: { has: () => true } as unknown as ReadonlySet<string> };
    const o = { body: p.body, skin: p.skin, hair: p.hair, top: p.top, bottom: p.bottom, shoes: p.shoes, accessory: p.accessory, acc: p.acc, shirtDesign: p.shirtDesign, topStyle: p.topStyle || undefined, bottomStyle: p.bottomStyle || undefined, shoeStyle: p.shoeStyle || undefined, hairStyle: p.hairStyle || undefined };
    return validateAppearance(o, null, all) ?? null;
  }

  private async applyProp(prop: number, design?: number) {
    const p = PROP_BY_ID.get(prop);
    if (p?.category === 'COMBAT_PROP' && !this.h.freeCombat() && this.h.carried() !== prop) { this.stats.refused++; this.h.notify('Você não possui este item.'); return; }
    const before = this.h.social.prop;
    if (prop === 0) { if (before) this.h.social.requestProp(0); }
    else this.h.social.requestProp(prop, design);
    if (p?.category === 'COMBAT_PROP' && this.h.zonePolicy() === 'PEACE') this.h.notify(`${p.label} não pode ser usado nesta zona.`);
    // espera a confirmação (ou a negação, que o SocialController já avisa e desfaz)
    for (let t = 0; t < 1200 && this.h.online(); t += 100) { await wait(100); if (this.h.social.prop === (prop || 0)) break; }
  }

  private async applyTitle(title: string | null) {
    if (!this.h.online()) { this.h.notify('Títulos precisam da conexão com o servidor'); return; }
    const res = new Promise<{ ok: boolean; title?: string | null; reason?: string } | null>((r) => { this.titleWait = r; setTimeout(() => { if (this.titleWait === r) { this.titleWait = null; r(null); } }, 2500); });
    this.h.send('title', { t: title });
    const m = await res;
    if (!m) { this.h.notify('Sem resposta do servidor — tente de novo'); return; }
    if (!m.ok) { this.stats.refused++; this.h.notify(m.reason === 'bloqueado' ? 'Você ainda não ganhou esse título.' : m.reason === 'rapido' ? 'Devagar…' : 'Título indisponível.'); return; }
    for (let t = 0; t < 1000; t += 100) { if ((this.h.selfPlayer()?.title ?? '') === (m.title ?? '')) break; await wait(100); }
    this.h.notify(m.title ? `Título: ${m.title}` : 'Sem título');
  }

  private async applySupporter(group: string) {
    const data = this.sup;
    if (!data) return;
    const acct = inventoryAccount();
    if (acct) {
      const r = await acct.saveSupporter(group === data.neutralId ? null : group);
      if (!r.ok) { this.stats.refused++; this.h.notify(r.error); return; }
      this.h.notify(r.msg || 'Torcida atualizada.');
      return;
    }
    if (!this.h.online()) { this.h.notify('Torcida precisa da conexão com o servidor'); return; }
    const res = new Promise<{ ok: boolean; r?: string; retryInS?: number; deferred?: boolean } | null>((r) => { this.supWait = r; setTimeout(() => { if (this.supWait === r) { this.supWait = null; r(null); } }, 2500); });
    this.h.send('sup', { group });
    const m = await res;
    if (!m?.ok) { this.stats.refused++; this.h.notify(m?.r === 'cooldown' ? `Você trocou de torcida há pouco — aguarde ${m.retryInS ?? 60} s` : 'Torcida indisponível agora.'); return; }
    setLocalSupporter(group === data.neutralId ? null : group);
    for (let t = 0; t < 1000; t += 100) { await wait(100); if (this.ctx().supporter === (group === data.neutralId ? null : group)) break; }
    this.h.notify(m.deferred ? 'Troca de torcida pendente: vale quando o evento em andamento acabar.' : 'Torcida atualizada.');
  }

  // ------------------------------------------------------------------ acesso rápido
  pin(key: string, index: number) {
    const it = this.items.find((i) => i.key === key);
    if (!it) return;
    const r = pinQuick(this.layout, it, index);
    if (!r.ok) { this.h.notify('Só itens de mão vão para o acesso rápido'); return; }
    this.layout = r.layout;
    saveQuickbar(this.layout);
    this.panel.update(this.items, this.layout, true);
    this.renderQuick();
    this.h.notify(`${it.label} no acesso rápido ${r.index + 1}`);
  }

  /** tecla 1–5 / clique no slot: pega o item (troca guarda o anterior); o mesmo de novo guarda */
  async quick(i: number) {
    this.stats.quick++;
    const key = this.layout[i];
    if (!key) { this.h.notify(`Acesso rápido ${i + 1} vazio — fixe um item no inventário (I)`); return; }
    this.refresh();
    const it = this.items.find((x) => x.key === key);
    if (!it) return;
    if (isActive(key, this.h.social.prop, this.h.social.design)) { await this.run({ kind: 'prop', prop: 0 }, it); return; }
    await this.equip(key);
  }

  // ------------------------------------------------------------------ QA
  info() {
    const byCat: Record<string, { total: number; available: number; locked: number; equipped: number }> = {};
    for (const i of this.items) {
      const c = (byCat[i.category] ??= { total: 0, available: 0, locked: 0, equipped: 0 });
      c.total++; c[i.state]++;
    }
    return {
      open: this.open, panel: this.panel.info(), layout: [...this.layout], byCat, stats: { ...this.stats },
      preview: { created: previewStats.created, disposed: previewStats.disposed, live: previewStats.live, has: !!this.preview, memory: previewStats.memory() },
      quick: this.quickbar.info(), log: this.log.slice(-30),
      equipped: this.items.filter((i) => i.state === 'equipped').map((i) => i.key),
    };
  }
  entries() { return this.items.map((i) => ({ key: i.key, category: i.category, slot: i.slot, label: i.label, state: i.state, quickbar: i.quickbar, lockedReason: i.lockedReason ?? null, isNew: !!i.isNew })); }
}

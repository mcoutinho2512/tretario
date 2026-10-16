/**
 * Ações sociais e item na mão do JOGADOR LOCAL: previsão imediata (o personagem reage na hora), pedido ao servidor
 * (que valida e decide), reconciliação com o estado autoritativo e as mesmas regras do servidor localmente
 * (andar cancela ação que não permite movimento; ação `once` termina sozinha). Offline: só local.
 */
import { worldClock } from '../net/clock';
import { ACTION_BY_ID, NO_ACTION, actionExpired } from './actions';
import { PROP_BY_ID, NO_PROP } from './props';
import { DESIGN_BY_ID, NO_DESIGN, designsFor } from './designs';
import { cancelsOnMove } from './actionRules';
import type { SocialState } from './types';

export interface SocialNet {
  requestAct(a: number, v?: number): void;
  requestProp(p: number, d?: number): void;
}

export const DENIAL_TEXT: Record<string, string> = {
  sem_item: 'Essa ação precisa de um item na mão (roda de ações → ITENS)',
  em_veiculo: 'Saia do veículo para fazer isso',
  caido: 'Espere levantar',
  rapido: 'Devagar…',
  spam: 'Muitas ações seguidas — espere um pouco',
  design_incompativel: 'Esse design não serve para esse item',
};

export class SocialController {
  /** estado atual (actAt no relógio comum, ms) */
  act = NO_ACTION;
  actAt = 0;
  actVar = 0;
  prop = NO_PROP;
  design = NO_DESIGN;

  constructor(
    private apply: (s: SocialState) => void,
    private net: () => SocialNet | null,
    private notify: (msg: string) => void,
  ) {}

  get state(): SocialState {
    return { act: this.act, phase: this.act ? Math.max(0, (worldClock.now() - this.actAt) / 1000) : 0, variation: this.actVar, prop: this.prop, design: this.design };
  }

  private push() { this.apply(this.state); }

  /** pede uma ação (0 = parar). Repetir a ação em curso a encerra (alternar) */
  requestAction(id: number) {
    if (id !== NO_ACTION && id === this.act && ACTION_BY_ID.get(id)?.mode === 'loop') id = NO_ACTION;
    const d = ACTION_BY_ID.get(id);
    if (d?.needs) {
      const p = PROP_BY_ID.get(this.prop);
      if (!p || !d.needs.includes(p.kind)) { this.notify(DENIAL_TEXT.sem_item); return; }
    }
    this.act = id; this.actAt = worldClock.now(); this.actVar = Math.floor(Math.random() * 8);
    this.push();
    this.net()?.requestAct(id, this.actVar);
  }

  /** pega/troca/larga um item; sem design → o primeiro design válido do item (ou mantém o atual se compatível) */
  requestProp(id: number, design?: number) {
    const p = PROP_BY_ID.get(id);
    let d = NO_DESIGN;
    if (p?.designSlot) {
      const ok = (x: number) => !!DESIGN_BY_ID.get(x)?.targets.includes(p.designSlot!);
      d = design !== undefined && ok(design) ? design : ok(this.design) ? this.design : designsFor(p.designSlot)[0]?.id ?? NO_DESIGN;
    }
    if (id === this.prop && d === this.design) id = NO_PROP; // alternar
    this.prop = id; this.design = id ? d : NO_DESIGN;
    // ação que dependia do item anterior termina (mesma regra do servidor)
    const a = ACTION_BY_ID.get(this.act);
    if (a?.needs && (!p || !a.needs.includes(p.kind) || id === NO_PROP)) { this.act = NO_ACTION; this.actAt = worldClock.now(); }
    this.push();
    this.net()?.requestProp(this.prop, this.design);
  }

  /** próximo design compatível com o item na mão (atalho da roda) */
  cycleDesign(step = 1) {
    const p = PROP_BY_ID.get(this.prop);
    if (!p?.designSlot) return;
    const list = designsFor(p.designSlot);
    const i = list.findIndex((d) => d.id === this.design);
    const next = list[(i + step + list.length) % list.length];
    this.prop = p.id; this.design = next.id;
    this.push();
    this.net()?.requestProp(this.prop, this.design);
  }

  /** por quadro: andar cancela ação incompatível; `once` expira; caído/veículo encerram */
  update(movedM: number, blocked: boolean) {
    if (this.act === NO_ACTION) return;
    const now = worldClock.now();
    if (blocked || cancelsOnMove(this.act, movedM) || actionExpired(this.act, this.actAt, now)) {
      this.act = NO_ACTION; this.actAt = now;
      this.push();
    }
  }

  /** estado autoritativo do servidor (confirmação/cancelamento) */
  fromServer(s: { act: number; actAt: number; actVar: number; prop: number; design: number }) {
    this.act = s.act; this.actAt = s.actAt; this.actVar = s.actVar; this.prop = s.prop; this.design = s.design;
    this.push();
  }

  denied(reason: string, server: { act: number; actAt: number; actVar: number; prop: number; design: number }) {
    this.notify(DENIAL_TEXT[reason] ?? `Ação negada (${reason})`);
    this.fromServer(server);
  }
}

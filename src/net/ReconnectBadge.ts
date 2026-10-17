/** selo discreto do estado da conexão (rodada 8): "RECONECTANDO…" enquanto o cliente tenta voltar (src/net/reconnect.ts) */
import '../spectator/spectator.css';
import type { LinkState } from './reconnect';

export class ReconnectBadge {
  readonly el: HTMLDivElement;
  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'net-link';
    this.el.setAttribute('role', 'status');
    this.el.setAttribute('aria-live', 'polite');
  }
  set(s: LinkState | 'REPLACED', detail = '') {
    const text = s === 'RECONNECTING' ? 'RECONECTANDO…' : s === 'EXPIRED' ? 'CONEXÃO PERDIDA — ENTRANDO DE NOVO…' : s === 'REPLACED' ? 'SUA CONTA ENTROU EM OUTRA JANELA' : '';
    this.el.textContent = text + (text && detail ? ` ${detail}` : '');
    this.el.classList.toggle('show', !!text);
    this.el.classList.toggle('bad', s === 'EXPIRED' || s === 'REPLACED');
  }
}

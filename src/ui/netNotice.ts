/**
 * Avisos de conexão que pedem uma DECISÃO (rodada 9.1) — modal pequeno, acessível, um por vez:
 *  - versão nova do servidor (JOIN_ERROR.protocol): "Nova versão disponível — recarregar"
 *  - sala cheia de jogadores (JOIN_ERROR.roomFull): "Sala cheia — entrar como espectador?"
 *  - lotação de espectadores (JOIN_ERROR.spectatorsFull): tentar de novo
 * Queda/reinício do servidor NÃO usa isto (é o selo RECONECTANDO…, src/net/ReconnectBadge.ts).
 */
import './beta.css';
import { JOIN_ERROR } from '../net/protocol';

export interface NoticeAction { label: string; primary?: boolean; run: () => void }

let open: HTMLDivElement | null = null;

export function showNetNotice(o: { title: string; text: string; actions: NoticeAction[]; kind?: string }): HTMLDivElement {
  open?.remove();
  const root = document.createElement('div');
  root.className = 'net-notice';
  root.dataset.kind = o.kind ?? '';
  root.setAttribute('role', 'alertdialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-labelledby', 'net-notice-title');
  const card = document.createElement('div');
  card.className = 'net-notice-card';
  const h = document.createElement('h2'); h.id = 'net-notice-title'; h.textContent = o.title;
  const p = document.createElement('p'); p.textContent = o.text;
  const row = document.createElement('div'); row.className = 'net-notice-actions';
  for (const a of o.actions) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = a.label; b.className = a.primary ? 'primary' : '';
    b.addEventListener('click', () => { root.remove(); if (open === root) open = null; a.run(); });
    row.appendChild(b);
  }
  card.append(h, p, row);
  root.appendChild(card);
  document.body.appendChild(root);
  open = root;
  document.exitPointerLock?.();
  requestAnimationFrame(() => row.querySelector<HTMLButtonElement>('button.primary, button')?.focus());
  return root;
}

/** recarrega a página mantendo os parâmetros (QA: ?mp=…) e trocando/limpando alguns */
function reloadWith(set: Record<string, string | null> = {}) {
  const q = new URLSearchParams(location.search);
  for (const [k, v] of Object.entries(set)) { if (v === null) q.delete(k); else q.set(k, v); }
  const s = q.toString();
  location.href = `${location.pathname}${s ? `?${s}` : ''}`;
}

/** aviso para um código de recusa de entrada; false = código sem aviso próprio */
export function noticeForJoinError(code: number | undefined): boolean {
  if (code === JOIN_ERROR.protocol) {
    showNetNotice({ kind: 'protocol', title: 'Nova versão disponível', text: 'O jogo foi atualizado. Recarregue a página para continuar na avenida.', actions: [{ label: 'RECARREGAR', primary: true, run: () => location.reload() }] });
    return true;
  }
  if (code === JOIN_ERROR.roomFull) {
    showNetNotice({
      kind: 'full', title: 'Sala cheia', text: 'A avenida atingiu o limite de participantes agora. Quer entrar como espectador enquanto isso?',
      actions: [
        { label: 'ENTRAR COMO ESPECTADOR', primary: true, run: () => reloadWith({ watch: '1', autostart: null, spectate: null }) },
        { label: 'VOLTAR', run: () => reloadWith({ watch: null, autostart: null }) },
      ],
    });
    return true;
  }
  if (code === JOIN_ERROR.spectatorsFull) {
    showNetNotice({ kind: 'full', title: 'Lotação de espectadores', text: 'Muita gente assistindo neste momento. Tente de novo em instantes.', actions: [{ label: 'TENTAR DE NOVO', primary: true, run: () => location.reload() }] });
    return true;
  }
  return false;
}

/**
 * Painel de AJUSTES do jogo (rodada 8): qualidade gráfica (preset existente; aplica ao recarregar), nomes dos
 * jogadores, auto-ocultar o HUD, chat recolhido por padrão, SOM (rodada 10: volumes por categoria + silenciar tudo,
 * `pv3d.audio` — src/audio/settings.ts). Folha lateral (desktop) / inferior
 * (celular); `role=dialog`, foco no primeiro controle, Esc fecha. Montado uma vez; só muda o que o jogador mexe.
 */
import { loadQualityChoice, saveQualityChoice, type QualityChoice, type QualityLevel } from '../../core/settings';
import type { HudPrefsStore } from './hudPrefs';
import { audioSettings, type VolumeKey } from '../../audio/settings'; // rodada 10 — áudio
import { audioActive, sfx } from '../../audio/bus'; // rodada 10 — áudio

const QUALITY: [QualityChoice, string][] = [['auto', 'Automática'], ['low', 'Baixa'], ['medium', 'Média'], ['high', 'Alta'], ['ultra', 'Ultra']];
const NAMES: [string, string][] = [['TODOS', 'Todos'], ['PROXIMOS', 'Próximos'], ['NENHUM', 'Nenhum']];

export class SettingsPanel {
  readonly el: HTMLDivElement;
  open = false;
  onToggle?: (open: boolean) => void;
  private reloadRow: HTMLDivElement;

  constructor(prefs: HudPrefsStore, currentLevel: QualityLevel) {
    const el = (this.el = document.createElement('div'));
    el.className = 'hud-sheet';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'false');
    el.setAttribute('aria-label', 'Ajustes');
    el.hidden = true;
    const head = document.createElement('div');
    head.className = 'sheet-head';
    const h = document.createElement('h2');
    h.textContent = 'Ajustes';
    const close = document.createElement('button');
    close.className = 'sheet-close';
    close.type = 'button';
    close.setAttribute('aria-label', 'Fechar ajustes');
    close.textContent = '×';
    close.addEventListener('click', () => this.toggle(false));
    head.append(h, close);
    el.appendChild(head);

    const saved = loadQualityChoice();
    el.appendChild(this.segment('Qualidade gráfica', 'q', QUALITY, saved, (v) => {
      saveQualityChoice(v as QualityChoice);
      this.reloadRow.hidden = false;
    }, `Agora: ${LEVEL_LABEL[currentLevel]}`));
    this.reloadRow = document.createElement('div');
    this.reloadRow.className = 'sheet-note';
    this.reloadRow.hidden = true;
    const rl = document.createElement('button');
    rl.type = 'button';
    rl.className = 'sheet-btn';
    rl.textContent = 'Recarregar para aplicar';
    rl.addEventListener('click', () => location.reload());
    this.reloadRow.append(rl);
    el.appendChild(this.reloadRow);

    el.appendChild(this.segment('Nomes dos jogadores', 'names', NAMES, prefs.value.names, (v) => prefs.set({ names: v as never })));
    el.appendChild(this.check('Esconder o HUD sozinho', 'Some quando você anda; volta ao mexer no mouse, tocar ou abrir algo', prefs.value.hudAutoHide, (v) => prefs.set({ hudAutoHide: v })));
    el.appendChild(this.check('Chat recolhido ao entrar', '', prefs.value.chatCollapsed, (v) => prefs.set({ chatCollapsed: v })));
    el.appendChild(this.audioSection()); // rodada 10 — áudio
    el.appendChild(this.check('Reduzir efeitos visuais', 'Desorientação vira só um ícone e um tom leve (sem desfoque nem vinheta)', prefs.value.reduceEffects, (v) => prefs.set({ reduceEffects: v })));
    const keys = document.createElement('p');
    keys.className = 'sheet-foot';
    keys.textContent = 'H ou P: HUD limpo · M: mapa · G: ações · F1: controles';
    el.appendChild(keys);
    el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { this.toggle(false); e.stopPropagation(); } });
  }

  toggle(v = !this.open) {
    if (v === this.open) return;
    this.open = v;
    this.el.hidden = !v;
    sfx(v ? 'ui_open' : 'ui_close'); // rodada 10 — áudio
    if (v) this.refreshAudio?.();
    if (v) (this.el.querySelector<HTMLElement>('input:checked') ?? this.el.querySelector<HTMLElement>('input'))?.focus({ preventScroll: true });
    this.onToggle?.(v);
  }

  // rodada 10 — áudio: volumes por barramento (0–100) + silenciar tudo; salva na hora (pv3d.audio)
  private refreshAudio?: () => void;
  private audioSection() {
    const fs = document.createElement('fieldset');
    fs.className = 'sheet-seg sheet-audio';
    const lg = document.createElement('legend');
    lg.textContent = 'Som';
    fs.appendChild(lg);
    const st = document.createElement('small');
    st.className = 'audio-state';
    const s0 = audioSettings.value;
    const rows: [VolumeKey, string][] = [['master', 'Volume geral'], ['ambient', 'Ambiente'], ['crowd', 'Multidão'], ['vehicles', 'Veículos'], ['events', 'Trio e carro de som'], ['sfx', 'Efeitos'], ['ui', 'Interface']];
    const inputs: HTMLInputElement[] = [];
    for (const [k, label] of rows) {
      const l = document.createElement('label');
      l.className = 'sheet-range';
      const t = document.createElement('span');
      t.textContent = label;
      const i = document.createElement('input');
      i.type = 'range'; i.min = '0'; i.max = '100'; i.step = '5'; i.value = String(Math.round(s0[k] * 100));
      i.dataset.vol = k;
      i.setAttribute('aria-label', label);
      const v = document.createElement('output');
      v.textContent = i.value;
      i.addEventListener('input', () => { v.textContent = i.value; audioSettings.set({ [k]: Number(i.value) / 100 }); });
      i.addEventListener('change', () => { if (k === 'ui' || k === 'master') sfx('ui_click'); });
      l.append(t, i, v);
      fs.appendChild(l);
      inputs.push(i);
    }
    const mute = this.check('Silenciar tudo', '', s0.muted, (on) => { audioSettings.set({ muted: on }); paint(); });
    mute.querySelector('input')!.dataset.vol = 'muted';
    fs.appendChild(mute);
    fs.appendChild(st);
    const paint = () => {
      const m = audioSettings.value.muted;
      for (const i of inputs) i.disabled = m;
      st.textContent = m ? 'Som desligado' : audioActive() ? 'Sons gerados pelo próprio jogo; o trio e a multidão soam mais forte perto deles' : 'O som liga no primeiro toque, clique ou tecla';
    };
    this.refreshAudio = paint;
    paint();
    return fs;
  }

  private segment(title: string, name: string, opts: [string, string][], value: string, on: (v: string) => void, hint = '') {
    const fs = document.createElement('fieldset');
    fs.className = 'sheet-seg';
    const lg = document.createElement('legend');
    lg.textContent = title;
    fs.appendChild(lg);
    const row = document.createElement('div');
    row.className = 'seg-row';
    for (const [v, label] of opts) {
      const l = document.createElement('label');
      const i = document.createElement('input');
      i.type = 'radio';
      i.name = `hud-${name}`;
      i.value = v;
      i.checked = v === value;
      i.addEventListener('change', () => { if (i.checked) on(v); });
      const s = document.createElement('span');
      s.textContent = label;
      l.append(i, s);
      row.appendChild(l);
    }
    fs.appendChild(row);
    if (hint) { const p = document.createElement('small'); p.textContent = hint; fs.appendChild(p); }
    return fs;
  }

  private check(title: string, hint: string, value: boolean, on: (v: boolean) => void) {
    const l = document.createElement('label');
    l.className = 'sheet-check';
    const i = document.createElement('input');
    i.type = 'checkbox';
    i.checked = value;
    i.addEventListener('change', () => on(i.checked));
    const t = document.createElement('span');
    t.textContent = title;
    l.append(i, t);
    if (hint) { const s = document.createElement('small'); s.textContent = hint; l.appendChild(s); }
    return l;
  }
}

const LEVEL_LABEL: Record<QualityLevel, string> = { low: 'Baixa', medium: 'Média', high: 'Alta', ultra: 'Ultra' };

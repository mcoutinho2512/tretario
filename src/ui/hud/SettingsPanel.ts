/**
 * Painel de AJUSTES do jogo — rodada 11: ABAS (Geral · Áudio · Gráficos · Interface · Controles).
 *  - GERAL: nomes dos jogadores, auto-ocultar o HUD, chat recolhido (rodada 8, `pv3d.hud`).
 *  - ÁUDIO: volumes por categoria + silenciar tudo (rodada 10, `pv3d.audio` — src/audio/settings.ts), sem mudanças.
 *  - GRÁFICOS: preset (aplicado AO VIVO pelo jogo — src/core/graphicsLive.ts; o que só muda ao recarregar é dito na
 *    hora), limite de FPS 30 / 60 / sem limite (ao vivo), aparelho detectado e leitura de FPS/resolução.
 *  - INTERFACE: escala 80–125 % (src/ui/uiPrefs.ts), reduzir movimento, reduzir efeitos visuais.
 *  - CONTROLES: delega à tela de controles registrada (`setControlsOpener`, src/ui/settingsApi.ts).
 * Folha lateral (desktop) / inferior (celular); `role=dialog`. Esc: pilha única (`pushEsc`, prioridade 100) — sem
 * listener próprio. Montado uma vez; só toca no DOM quando o jogador mexe (a leitura de FPS: 2 Hz com a aba aberta).
 */
import { loadQualityChoice, saveQualityChoice, type QualityChoice, type QualityLevel } from '../../core/settings';
import type { HudPrefsStore } from './hudPrefs';
import { audioSettings, type VolumeKey } from '../../audio/settings'; // rodada 10 — áudio
import { audioActive, sfx } from '../../audio/bus'; // rodada 10 — áudio
import { FPS_LABEL, loadFpsChoice, saveFpsChoice, type FpsChoice } from '../../core/fpsChoice';
import type { FpsLimit } from '../../core/frameGovernor';
import { UI_SCALES, onUiPrefs, setUiPrefs, uiPrefs } from '../uiPrefs';
import { SETTINGS_TABS, TAB_LABEL, nextTab, openControls, parseTab, registerSettingsOpener, type SettingsTab } from '../settingsApi';
import { EscSlot } from '../escStack'; // rodada 11 — entrada (Esc pela pilha única)
import { inputPrefs } from '../../input/inputPrefs'; // rodada 11 — sensibilidade / eixo Y

const QUALITY: [QualityChoice, string][] = [['auto', 'Automática'], ['low', 'Baixa'], ['medium', 'Média'], ['high', 'Alta'], ['ultra', 'Ultra']];
const NAMES: [string, string][] = [['TODOS', 'Todos'], ['PROXIMOS', 'Próximos'], ['NENHUM', 'Nenhum']];
const FPS: [FpsChoice, string][] = [['auto', FPS_LABEL.auto], ['30', '30'], ['60', '60'], ['unlimited', FPS_LABEL.unlimited]];
export const LEVEL_LABEL: Record<QualityLevel, string> = { low: 'Baixa', medium: 'Média', high: 'Alta', ultra: 'Ultra' };

/** o jogo liga o painel aos gráficos de verdade (sem host: só salva e pede para recarregar) */
export interface GraphicsHost {
  /** aplica o preset ao vivo; devolve o nível aplicado e o que só muda ao recarregar */
  setQuality(choice: QualityChoice): { level: QualityLevel; reloadFor: string[] };
  /** troca o limite de FPS ao vivo; devolve o limite efetivo (0 = sem limite) */
  setFps(choice: FpsChoice): FpsLimit;
  /** leitura para a aba (FPS medido, escala da resolução dinâmica, limite) */
  stats(): { fps: number; scale: number; limit: FpsLimit };
  device: { label: string; reason: string; recommended: QualityLevel };
}

export class SettingsPanel {
  readonly el: HTMLDivElement;
  open = false;
  tab: SettingsTab = 'geral';
  onToggle?: (open: boolean) => void;
  /** sem tela de controles registrada: o HUD mostra a ajuda de teclas */
  onShowHelp?: () => void;
  private graphicsHost: GraphicsHost | null = null;
  private reloadRow: HTMLDivElement;
  private reloadText: HTMLSpanElement;
  private appliedEl: HTMLElement;
  private deviceEl: HTMLElement;
  private liveEl: HTMLElement;
  private fpsHint: HTMLElement;
  private level: QualityLevel;
  private tabs = new Map<SettingsTab, { btn: HTMLButtonElement; panel: HTMLDivElement }>();
  private liveTimer = 0;
  private esc = new EscSlot('ajustes', 100, () => this.toggle(false));

  constructor(prefs: HudPrefsStore, currentLevel: QualityLevel) {
    this.level = currentLevel;
    const el = (this.el = document.createElement('div'));
    el.className = 'hud-sheet settings-sheet';
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

    // ---- abas
    const list = document.createElement('div');
    list.className = 'sheet-tabs';
    list.setAttribute('role', 'tablist');
    list.setAttribute('aria-label', 'Seções dos ajustes');
    el.appendChild(list);
    for (const t of SETTINGS_TABS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sheet-tab';
      btn.id = `set-tab-${t}`;
      btn.dataset.tab = t;
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-controls', `set-panel-${t}`);
      btn.textContent = TAB_LABEL[t];
      btn.addEventListener('click', () => this.show(t));
      list.appendChild(btn);
      const panel = document.createElement('div');
      panel.className = 'sheet-panel';
      panel.id = `set-panel-${t}`;
      panel.dataset.tab = t;
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', btn.id);
      panel.hidden = true;
      el.appendChild(panel);
      this.tabs.set(t, { btn, panel });
    }
    list.addEventListener('keydown', (e) => {
      const to = nextTab(this.tab, e.key);
      if (!to) return;
      e.preventDefault();
      this.show(to);
      this.tabs.get(to)!.btn.focus();
    });
    const P = (t: SettingsTab) => this.tabs.get(t)!.panel;

    // ---- GERAL
    P('geral').append(
      this.segment('Nomes dos jogadores', 'names', NAMES, prefs.value.names, (v) => prefs.set({ names: v as never })),
      this.check('Esconder o HUD sozinho', 'Some quando você anda; volta ao mexer no mouse, tocar ou abrir algo', prefs.value.hudAutoHide, (v) => prefs.set({ hudAutoHide: v })),
      this.check('Chat recolhido ao entrar', '', prefs.value.chatCollapsed, (v) => prefs.set({ chatCollapsed: v })),
      this.foot('O cursor fica sempre visível · botão direito + arrastar: câmera · F1: controles · Esc: fecha / menu · H: HUD limpo'),
    );

    // ---- ÁUDIO (rodada 10, sem mudanças)
    P('audio').append(this.audioSection());

    // ---- GRÁFICOS
    const g = P('graficos');
    g.appendChild(this.segment('Qualidade gráfica', 'q', QUALITY, loadQualityChoice(), (v) => this.onQuality(v as QualityChoice)));
    this.appliedEl = document.createElement('small');
    this.appliedEl.className = 'sheet-applied';
    g.lastElementChild!.appendChild(this.appliedEl);
    this.reloadRow = document.createElement('div');
    this.reloadRow.className = 'sheet-note';
    this.reloadRow.hidden = true;
    this.reloadText = document.createElement('span');
    const rl = document.createElement('button');
    rl.type = 'button';
    rl.className = 'sheet-btn';
    rl.textContent = 'Recarregar agora';
    rl.addEventListener('click', () => location.reload());
    this.reloadRow.append(this.reloadText, rl);
    g.appendChild(this.reloadRow);
    g.appendChild(this.segment('Limite de FPS', 'fps', FPS, loadFpsChoice(), (v) => this.onFps(v as FpsChoice)));
    this.fpsHint = document.createElement('small');
    this.fpsHint.textContent = 'Sem limite: acompanha a taxa do monitor (120/144 Hz). Aplicado na hora.';
    g.lastElementChild!.appendChild(this.fpsHint);
    this.liveEl = document.createElement('p');
    this.liveEl.className = 'sheet-live';
    this.liveEl.setAttribute('aria-live', 'off');
    g.appendChild(this.liveEl);
    this.deviceEl = document.createElement('p');
    this.deviceEl.className = 'sheet-foot';
    g.appendChild(this.deviceEl);
    this.paintApplied([]);

    // ---- INTERFACE
    const ui = P('interface');
    const scale = this.segment('Escala da interface', 'uiscale', UI_SCALES.map((s) => [String(s), `${s}%`] as [string, string]), String(uiPrefs().scale), (v) => setUiPrefs({ scale: Number(v) as never }), 'Muda o tamanho do HUD e dos painéis (não do jogo)');
    scale.classList.add('seg-compact');
    ui.append(
      scale,
      this.check('Reduzir movimento', 'Sem transições e animações do HUD e sem o giro de câmera da chegada', uiPrefs().reduceMotion, (v) => setUiPrefs({ reduceMotion: v })),
      this.check('Reduzir efeitos visuais', 'Desorientação vira só um ícone e um tom leve (sem desfoque nem vinheta)', prefs.value.reduceEffects, (v) => prefs.set({ reduceEffects: v })),
    );
    onUiPrefs((p) => { // outra origem (menu do Esc, teste) → reflete nos controles
      const r = ui.querySelector<HTMLInputElement>(`input[name="hud-uiscale"][value="${p.scale}"]`);
      if (r) r.checked = true;
    });

    // ---- CONTROLES (tela do agente A)
    const c = P('controles');
    const cp = document.createElement('p');
    cp.className = 'sheet-text';
    cp.textContent = 'Teclas, mouse e remapeamento ficam na tela de controles.';
    const cb = document.createElement('button');
    cb.type = 'button';
    cb.className = 'sheet-btn';
    cb.dataset.act = 'controls';
    cb.textContent = 'Abrir controles e teclas';
    cb.addEventListener('click', () => { if (!openControls()) { this.toggle(false); this.onShowHelp?.(); } });
    // sensibilidade e eixo Y (src/input/inputPrefs.ts — o InputManager aplica na hora)
    const sens = document.createElement('label');
    sens.className = 'sheet-range';
    const st = document.createElement('span');
    st.textContent = 'Sensibilidade da câmera';
    const si = document.createElement('input');
    si.type = 'range'; si.min = '25'; si.max = '300'; si.step = '5'; si.value = String(Math.round(inputPrefs.value.sensitivity * 100));
    si.dataset.input = 'sensitivity';
    si.setAttribute('aria-label', 'Sensibilidade da câmera');
    const so = document.createElement('output');
    so.textContent = `${si.value}%`;
    si.addEventListener('input', () => { so.textContent = `${si.value}%`; inputPrefs.set({ sensitivity: Number(si.value) / 100 }); });
    sens.append(st, si, so);
    const inv = this.check('Inverter o eixo Y', 'Arrastar para cima olha para baixo', inputPrefs.value.invertY, (v) => inputPrefs.set({ invertY: v }));
    inv.querySelector('input')!.dataset.input = 'invertY';
    c.append(cp, cb, sens, inv, this.foot('WASD andar · Shift correr · Espaço pular · E usar · G ações · M mapa · F1 controles · Esc menu'));

    this.show('geral');
    registerSettingsOpener((t) => this.openTab(t));
  }

  /** o jogo liga os gráficos ao vivo (Game, bloco "rodada 11 — gráficos") */
  setGraphicsHost(h: GraphicsHost | null) {
    this.graphicsHost = h;
    if (h) this.deviceEl.textContent = `${h.device.label}${h.device.reason ? ` (${h.device.reason})` : ''}`;
    this.paintApplied([]);
  }

  /** abre direto numa aba (contrato `openSettings`) */
  openTab(t: SettingsTab) {
    this.show(parseTab(t));
    this.toggle(true);
  }

  show(t: SettingsTab) {
    this.tab = t;
    for (const [k, { btn, panel }] of this.tabs) {
      const on = k === t;
      btn.setAttribute('aria-selected', String(on));
      btn.tabIndex = on ? 0 : -1;
      btn.classList.toggle('on', on);
      panel.hidden = !on;
    }
    if (t === 'audio') this.refreshAudio?.();
    this.syncLive();
  }

  toggle(v = !this.open) {
    if (v === this.open) return;
    this.open = v;
    this.el.hidden = !v;
    this.esc.set(v); // rodada 11 — entrada
    sfx(v ? 'ui_open' : 'ui_close'); // rodada 10 — áudio
    this.esc.set(v); // rodada 11 — Esc pela pilha única (camada 'ajustes', 100)
    if (v) {
      this.refreshAudio?.();
      this.tabs.get(this.tab)!.btn.focus({ preventScroll: true });
    }
    this.syncLive();
    this.onToggle?.(v);
  }

  // ------------------------------------------------------------------ gráficos
  private onQuality(choice: QualityChoice) {
    saveQualityChoice(choice);
    if (!this.graphicsHost) { this.paintApplied(['tudo (o jogo ainda não está pronto)']); return; }
    const r = this.graphicsHost.setQuality(choice);
    this.level = r.level;
    this.paintApplied(r.reloadFor, true);
  }

  private onFps(choice: FpsChoice) {
    saveFpsChoice(choice);
    const lim = this.graphicsHost?.setFps(choice);
    this.fpsHint.textContent = lim === undefined ? 'Vale ao entrar no jogo.' : lim === 0 ? 'Sem limite: acompanha a taxa do monitor. Aplicado na hora.' : `Limitado a ${lim} FPS. Aplicado na hora.`;
    this.syncLive();
  }

  private paintApplied(reloadFor: string[], changed = false) {
    this.appliedEl.textContent = `Em uso: ${LEVEL_LABEL[this.level]}${changed && !reloadFor.length ? ' · aplicado na hora, sem recarregar' : ''}`;
    this.reloadRow.hidden = reloadFor.length === 0;
    this.reloadText.textContent = reloadFor.length ? `Aplicado na hora, exceto ${reloadFor.join(', ')}: vale ao recarregar. ` : '';
  }

  /** leitura de FPS e resolução (2 Hz) só com o painel aberto na aba Gráficos */
  private syncLive() {
    const want = this.open && this.tab === 'graficos' && !!this.graphicsHost;
    if (want && !this.liveTimer) {
      const paint = () => {
        const s = this.graphicsHost?.stats();
        if (!s) return;
        this.liveEl.textContent = `Medido agora: ${Math.round(s.fps)} FPS · limite ${s.limit === 0 ? 'nenhum' : s.limit} · resolução ${Math.round(s.scale * 100)} %`;
      };
      paint();
      this.liveTimer = window.setInterval(paint, 500);
    } else if (!want && this.liveTimer) { clearInterval(this.liveTimer); this.liveTimer = 0; }
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

  private foot(text: string) {
    const p = document.createElement('p');
    p.className = 'sheet-foot';
    p.textContent = text;
    return p;
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

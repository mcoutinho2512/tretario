/**
 * Pichação/grafite no CLIENTE: orquestra superfícies autorizadas, tapumes, prompt "E — PICHAR", editor, rede
 * (gf_*), denúncia/ocultação local e o desenho em decalques (GraffitiRenderer). O Game só chama alguns ganchos:
 * `load`, `attachNet`, `update`, `promptText`, `tryOpen`, `editing` e a API de depuração.
 *
 * Sem servidor (single-player) os grafites ficam só locais (ids negativos) — útil para testar o desenho.
 */
import * as THREE from 'three';
import { decodeGraffiti, encodeGraffiti, type GraffitiContent } from './codec';
import { GraffitiEditor, type EditorResult } from './GraffitiEditor';
import { GraffitiRenderer, TILE_GPU_BYTES, buildTapumes, type DecalEntry } from './GraffitiRenderer';
import type { GfRes, GfWire } from './protocol';
import { GF_STATE, GF_STATE_NAME, isVisibleState, validateContent, validateReach } from './rules';
import { distanceToSurface, nearestSurface, parseSurfaceFile, placeRect, solidRing, type GraffitiSolid, type GraffitiSurface } from './surfaces';

/** o cliente oferece pichar um pouco antes do limite do servidor (3 m): folga para a latência */
const PROMPT_DIST = 2.4;
const REPORT_DIST = 5;
const HIDDEN_KEY = 'pv.graffiti.hidden';

const DENY_TEXT: Record<string, string> = {
  superficie: 'Aqui não é um lugar autorizado para pichar',
  distancia: 'Chegue mais perto da parede',
  lado: 'Fique de frente para a parede',
  formato: 'Desenho inválido',
  tamanho: 'Desenho grande demais',
  retangulo: 'Não cabe aqui — tente um tamanho menor',
  itens: 'Desenho vazio ou com elementos demais',
  texto_bloqueado: 'Texto não permitido (palavrão, ódio ou propaganda)',
  texto: 'Texto inválido',
  cooldown: 'Aguarde um pouco antes de pichar de novo',
  cota: 'Você já tem grafites demais ativos',
  cota_hora: 'Limite de grafites por hora atingido',
  superficie_cheia: 'Este painel autorizado está cheio',
  estado: 'Agora não (de pé e fora de veículos)',
  mundo_cheio: 'Limite de grafites do mundo atingido',
};

interface NetLike {
  sessionId: string;
  status: string;
  send(type: string, payload?: unknown): void;
  on(type: string, fn: (msg: any) => void): void;
}

interface Item extends DecalEntry { wire: Omit<GfWire, 'd'> & { bytes: number }; mine: boolean }

export interface PlayerLike { x: number; z: number; heading: number }

export class GraffitiSystem {
  readonly group = new THREE.Group();
  surfaces: GraffitiSurface[] = [];
  private solids: GraffitiSolid[] = [];
  private byId = new Map<string, GraffitiSurface>();
  private items = new Map<number, Item>();
  private renderer = new GraffitiRenderer();
  private editor: GraffitiEditor;
  private net: NetLike | null = null;
  private target: GraffitiSurface | null = null;
  private nonce = 1;
  private localId = -1;
  private pendingNonce = 0;
  private hidden = new Set<number>();
  private acc = 0;
  private near: GraffitiSurface | null = null;
  private reportEl: HTMLDivElement;
  private reportTarget: Item | null = null;
  private lastPlayer: PlayerLike = { x: 0, z: 0, heading: 0 };
  /** QA: tudo que chegou da rede (gf_add/gf_del/gf_state) — prova de que nada parcial/ inválido chegou */
  readonly received = { add: 0, del: 0, state: 0, invalid: 0, bytes: 0 };
  onNotice: ((m: string) => void) | null = null;

  constructor(hudRoot: HTMLElement, private isTouch: boolean, level: 'low' | 'medium' | 'high' | string = 'high') {
    this.group.name = 'graffiti_root';
    // orçamento por preset: aparelho fraco = 1 página de atlas (32 tiles, 5,6 MB de GPU) e corte mais perto
    const B = level === 'low' ? { budget: 32, dist: 60 } : level === 'medium' ? { budget: 64, dist: 80 } : { budget: 96, dist: 90 };
    this.renderer.budget = B.budget;
    this.renderer.drawDistance = B.dist;
    this.group.add(this.renderer.group);
    this.editor = new GraffitiEditor(document.body);
    this.editor.onSubmit = (r) => this.submit(r);
    this.reportEl = document.createElement('div');
    this.reportEl.className = 'gf-report';
    this.reportEl.innerHTML = '<span class="gf-who"></span><button class="gf-btn" data-a="hide">Ocultar p/ mim</button><button class="gf-btn" data-a="report">Denunciar</button>';
    this.reportEl.addEventListener('click', (e) => {
      const a = ((e.target as HTMLElement).closest('button') as HTMLButtonElement | null)?.dataset.a;
      const t = this.reportTarget;
      if (!t || !a) return;
      if (a === 'hide') { this.hideLocal(t.id); this.onNotice?.('Grafite oculto só para você'); }
      else this.report(t.id);
    });
    hudRoot.appendChild(this.reportEl);
    try { for (const id of JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? '[]') as number[]) if (Number.isInteger(id)) this.hidden.add(id); } catch { /* sem localStorage */ }
  }

  /** superfícies (mesmo arquivo do servidor) + tapumes com colisão */
  async load(base: string, groundAt: (x: number, z: number) => number, addCollider: (ring: [number, number][], bottom: number, top: number) => void) {
    try {
      const r = await fetch(`${base}graffiti_surfaces.json`);
      if (!r.ok) return;
      const f = parseSurfaceFile(await r.json());
      this.surfaces = f.surfaces;
      this.solids = f.solids;
    } catch (e) { console.warn('[grafite] superfícies não carregadas', e); return; }
    for (const sf of this.surfaces) {
      // chão: assenta na altura real do piso (o servidor só usa x/z)
      if (sf.kind === 'ground') sf.o[1] = groundAt(sf.o[0] + sf.w / 2, sf.o[2] - sf.h / 2);
      this.byId.set(sf.id, sf);
    }
    for (const b of this.solids) addCollider(solidRing(b), 0, b.height);
    const tap = buildTapumes(this.solids, groundAt);
    if (tap) this.group.add(tap);
  }

  attachNet(net: NetLike) {
    this.net = net;
    net.on('gf_add', (list: GfWire[]) => { for (const w of Array.isArray(list) ? list : []) this.addWire(w); });
    net.on('gf_del', (m: { i: number[]; r: string }) => { for (const id of m?.i ?? []) { this.received.del++; this.remove(id); } });
    net.on('gf_state', (m: { i: number; st: number }) => { this.received.state++; const it = this.items.get(m?.i); if (it) it.wire.st = m.st; });
    net.on('gf_res', (r: GfRes) => this.onRes(r));
  }

  private get online() { return !!this.net && this.net.status === 'online'; }

  private addWire(w: GfWire) {
    this.received.add++;
    const bytes = w?.d instanceof Uint8Array ? w.d : null;
    const sf = this.byId.get(w?.s);
    const content = bytes ? decodeGraffiti(bytes) : null;
    if (!sf || !content || !isVisibleState(w.st)) { this.received.invalid++; return; }
    this.received.bytes += bytes!.length;
    this.items.set(w.i, { id: w.i, sf, content, hidden: this.hidden.has(w.i), mine: w.m === 1, wire: { i: w.i, s: w.s, a: w.a, t: w.t, e: w.e, st: w.st, bytes: bytes!.length } });
    this.acc = 1; // atualiza o desenho já
  }

  private remove(id: number) {
    this.items.delete(id);
    this.renderer.release(id);
    if (this.reportTarget?.id === id) this.reportTarget = null;
  }

  // ------------------------------------------------------------------ prompt / editor
  get editing() { return this.editor.isOpen; }

  /** texto do prompt (o Game mostra quando não há veículo por perto) */
  promptText(): string {
    if (!this.near) return '';
    const what = this.near.kind === 'ground' ? 'O CHÃO' : this.near.kind === 'tapume' ? 'O TAPUME' : this.near.kind === 'mural' ? 'O MURAL' : 'A PAREDE';
    return this.isTouch ? `USAR — PICHAR ${what}` : `E — PICHAR ${what}`;
  }

  /** E/USAR perto de uma superfície autorizada: abre o editor. Retorna se abriu */
  tryOpen(p: PlayerLike): boolean {
    const sf = nearestSurface(this.surfaces, p.x, p.z, PROMPT_DIST);
    if (!sf) return false;
    this.target = sf;
    this.lastPlayer = { ...p };
    const kind = sf.kind === 'mural' ? 'MURAL AUTORIZADO (permanente)' : sf.kind === 'tapume' ? 'TAPUME (temporário)' : sf.kind === 'ground' ? 'CHÃO (temporário)' : 'PAREDE (temporário)';
    this.editor.open(`PICHAR — ${kind}`);
    return true;
  }

  private submit(r: EditorResult) {
    const sf = this.target;
    if (!sf) return;
    const p = this.lastPlayer;
    const rect = placeRect(sf, p.x, p.z, p.heading, r.size);
    if (!rect) { this.editor.setStatus(DENY_TEXT.retangulo, true); return; }
    const content: GraffitiContent = { rect, items: r.items };
    const bytes = encodeGraffiti(content);
    // mesmas regras do servidor antes de enviar (o servidor decide de novo)
    const v = validateContent(bytes, sf);
    const reach = v.ok ? validateReach(sf, v.content, p.x, p.z) : null;
    if (!v.ok || reach) { this.editor.setStatus(DENY_TEXT[!v.ok ? v.reason : reach!] ?? 'Recusado', true); return; }
    if (this.online) {
      this.pendingNonce = this.nonce++;
      this.editor.setBusy(true);
      this.net!.send('gf_new', { s: sf.id, d: bytes, n: this.pendingNonce });
      return;
    }
    // sem servidor: só local
    const id = this.localId--;
    this.items.set(id, { id, sf, content: v.content, hidden: false, mine: true, wire: { i: id, s: sf.id, a: 'você', t: Date.now(), e: 0, st: GF_STATE.ACTIVE, bytes: bytes.length } });
    this.acc = 1;
    this.editor.close();
    this.onNotice?.('Grafite feito (offline: só você vê)');
  }

  private onRes(r: GfRes) {
    if (r.op === 'new' && r.n === this.pendingNonce) {
      this.editor.setBusy(false);
      if (r.ok) { this.editor.close(); this.onNotice?.('Grafite publicado — outros jogadores já veem'); }
      else this.editor.setStatus(DENY_TEXT[r.r ?? ''] ?? `Recusado (${r.r})`, true);
    } else if (r.op === 'report') {
      const t: Record<string, string> = { proprio: 'Você não pode denunciar o próprio grafite', repetida: 'Você já denunciou este grafite', spam: 'Muitas denúncias seguidas', longe: 'Chegue mais perto', oculto: 'Já está oculto' };
      this.onNotice?.(r.ok ? 'Denúncia enviada — obrigado' : (t[r.r ?? ''] ?? `Denúncia recusada (${r.r})`));
      if (r.ok && r.i !== undefined) this.hideLocal(r.i); // quem denuncia não precisa continuar vendo
    }
    this.lastRes = r;
  }
  lastRes: GfRes | null = null;

  // ------------------------------------------------------------------ moderação (cliente)
  report(id: number) {
    if (!this.online) { this.onNotice?.('Denúncia precisa do servidor (multiplayer)'); return; }
    this.net!.send('gf_report', { i: id });
  }

  hideLocal(id: number) {
    this.hidden.add(id);
    const it = this.items.get(id);
    if (it) it.hidden = true;
    this.renderer.release(id);
    const arr = [...this.hidden].slice(-500);
    try { localStorage.setItem(HIDDEN_KEY, JSON.stringify(arr)); } catch { /* */ }
    this.acc = 1;
  }

  // ------------------------------------------------------------------ por quadro
  update(dt: number, cam: THREE.Vector3, p: PlayerLike) {
    if (!this.editing) this.lastPlayer = { x: p.x, z: p.z, heading: p.heading };
    this.acc += dt;
    // 5 Hz: superfície próxima, alvo de denúncia e escolha de tiles (rasteriza poucos por vez)
    if (this.acc < 0.2) return;
    this.acc = 0;
    this.near = this.editing ? null : nearestSurface(this.surfaces, p.x, p.z, PROMPT_DIST);
    this.renderer.update(this.items.values(), cam);
    let best: Item | null = null, bd = REPORT_DIST;
    for (const it of this.items.values()) {
      if (it.hidden || it.mine || it.id < 0) continue;
      const d = distanceToSurface(it.sf, p.x, p.z, it.content.rect);
      if (d.front && d.d < bd) { bd = d.d; best = it; }
    }
    this.reportTarget = this.editing ? null : best;
    this.reportEl.classList.toggle('show', !!this.reportTarget);
    if (best) (this.reportEl.querySelector('.gf-who') as HTMLElement).textContent = `Grafite de ${best.wire.a}${best.wire.st === GF_STATE.REPORTED ? ' (denunciado)' : ''}`;
  }

  // ------------------------------------------------------------------ QA
  info() {
    return {
      surfaces: this.surfaces.length, solids: this.solids.length, editing: this.editing, near: this.near?.id ?? null,
      list: [...this.items.values()].map((it) => ({ id: it.id, surface: it.sf.id, author: it.wire.a, state: GF_STATE_NAME[it.wire.st], mine: it.mine, hidden: it.hidden, bytes: it.wire.bytes, items: it.content.items.length, tiled: this.renderer.has(it.id), expiresAt: it.wire.e })),
      received: { ...this.received },
      renderer: { ...this.renderer.stats, tileBytes: TILE_GPU_BYTES },
      lastRes: this.lastRes,
    };
  }

  /** ganchos de automação: superfícies próximas, rascunho do editor, denúncia/ocultação diretas */
  readonly qa = {
    surfacesNear: (x: number, z: number, r = 60) => this.surfaces.filter((s) => Math.hypot(s.o[0] - x, s.o[2] - z) < r).map((s) => {
      const n = [-s.u[2], s.u[0]]; // normal horizontal das paredes: u × cima
      const mid = [s.o[0] + s.u[0] * s.w / 2, s.o[2] + s.u[2] * s.w / 2];
      return { id: s.id, kind: s.kind, w: s.w, mid, normal: n, front: s.kind === 'ground' ? [mid[0], mid[1] - s.h / 2] : [mid[0] + n[0] * 1.3, mid[1] + n[1] * 1.3] };
    }),
    open: () => this.tryOpen(this.lastPlayer),
    close: () => this.editor.close(),
    draft: () => this.editor.draft.length,
    report: (id: number) => this.report(id),
    hide: (id: number) => this.hideLocal(id),
    editorEl: () => this.editor.el,
    /**
     * MEDIÇÃO (offline): cria `n` grafites locais típicos (~12 traços + texto) nas superfícies mais próximas do
     * jogador, sem os limites do servidor — para medir memória/custo por grafite e por 100.
     */
    stress: (n: number, ignoreDistance = false) => {
      // ignoreDistance: mede o pior caso (todos com tile, até o limite de 4 páginas = 128), sem o corte por distância
      if (ignoreDistance) { this.renderer.drawDistance = 1e6; this.renderer.budget = 128; }
      const p = this.lastPlayer;
      const near = this.surfaces.slice().sort((a, b) => distanceToSurface(a, p.x, p.z).d - distanceToSurface(b, p.x, p.z).d).slice(0, Math.max(1, Math.ceil(n / 4)));
      let bytes = 0;
      for (let k = 0; k < n; k++) {
        const sf = near[k % near.length];
        const w = Math.min(1.6, sf.w), h = w / 2;
        const rect = { s: Math.round(((k * 0.37) % Math.max(0.01, sf.w - w)) * 100) / 100, t: Math.round(Math.max(0, Math.min(sf.h - h, 0.6)) * 100) / 100, w, h };
        const items: GraffitiContent['items'] = [];
        for (let j = 0; j < 12; j++) {
          const pts: number[] = [];
          for (let i = 0; i < 12; i++) pts.push(10 + i * 20, Math.round(64 + Math.sin(i / 2 + j + k) * 50));
          items.push({ k: 'line', color: (j + k) % 12, width: j % 3, pts });
        }
        items.push({ k: 'text', color: 1, x: 128, y: 64, size: 28, text: `Grafite ${k}` });
        const c = { rect, items };
        bytes += encodeGraffiti(c).length;
        const id = this.localId--;
        this.items.set(id, { id, sf, content: c, hidden: false, mine: true, wire: { i: id, s: sf.id, a: 'teste', t: Date.now(), e: 0, st: GF_STATE.ACTIVE, bytes: encodeGraffiti(c).length } });
      }
      this.renderer.rasterPerFrame = 1000;
      this.renderer.update(this.items.values(), new THREE.Vector3(p.x, 1.6, p.z));
      this.renderer.rasterPerFrame = 4;
      return { n, avgBytes: Math.round(bytes / Math.max(1, n)), ...this.renderer.stats };
    },
    /** TESTE: cliente modificado manda qualquer coisa (o servidor precisa recusar) */
    raw: (type: string, payload: unknown) => this.net?.send(type, payload),
    rawBytes: (type: string, surface: string, bytes: number[]) => this.net?.send(type, { s: surface, d: Uint8Array.from(bytes), n: 999 }),
  };
}

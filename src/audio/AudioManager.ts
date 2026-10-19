/**
 * Rodada 10 — AudioManager (WebAudio): implementa o `AudioSink` do contrato (src/audio/bus.ts).
 *
 *  grafo     fontes → [voz: ganho → pan] → barramento da categoria (ambiente, multidão, veículos, eventos,
 *            interface, efeitos) → master → compressor → limitador → saída; envio de reverberação simples
 *            (ConvolverNode com resposta gerada) dos efeitos/multidão/eventos
 *  vozes     one-shots: VoicePool fixo (cadeias ganho+pan REUSADAS; só a fonte do buffer é nova por disparo);
 *            laços: LoopScheduler (fontes lógicas ilimitadas → ≤ N vozes reais); multidão: ≤ 4 vozes agregadas
 *            (murmúrio + camada de percussão própria do perfil); ambiente: vento + cidade (2 fontes)
 *  espacial  ganho + pan manuais (spatial.ts: atenuação por distância, pan pelo rumo do ouvinte, passa-baixa de ar
 *            nos laços) com rampas `setTargetAtTime` — câmera que pula (aérea do espectador, veículo) não estala
 *  autoplay  o AudioContext só nasce/retoma num gesto (pointerdown/touchend/keydown); Safari (webkitAudioContext,
 *            buffer silencioso no iOS); bloqueado = silêncio sem erro no console; aba em segundo plano = suspenso
 *  sons      todos gerados por código (sounds.ts) num Worker, uma vez; AudioBuffers reaproveitados
 */
import { setAudioSink, type AudioSink, type CrowdAudioCell, type LoopHandle, type LoopKind, type SfxId, type SfxOpts } from './bus';
import { crowdEventRate, LOOPS, pickCrowdEvent, sfxSpec, type Bus } from './catalog';
import { AUDIBLE_MIN, airCutoff, attenuation, crowdLoudness, distTo, FALLOFF, panFor, type ListenerPose } from './spatial';
import { LoopScheduler, VoicePool } from './voices';
import { layerFamily, renderSound, soundDef } from './sounds';
import type { AudioSettingsStore } from './settings';

export interface AudioBudget { oneShots: number; loops: number; crowdVoices: number; reverb: boolean }
export const DEFAULT_BUDGET: AudioBudget = { oneShots: 24, loops: 8, crowdVoices: 4, reverb: true };

type Ctx = AudioContext;
const BUSES: Bus[] = ['ambient', 'crowd', 'vehicles', 'events', 'ui', 'sfx'];
/** sons gerados assim que o áudio libera (o resto sob demanda) */
const PRELOAD = ['ui_click', 'ui_open', 'ui_close', 'ui_denied', 'ui_ok', 'step_asphalt', 'step_sidewalk', 'jump', 'land', 'whoosh', 'punch', 'kick', 'impact', 'dodge', 'blocked', 'fall', 'getup',
  'amb_wind', 'amb_city', 'ir', 'crowd_bed', 'car_engine', 'moto_engine', 'bike_roll', 'scooter_motor', 'trio_music', 'soundcar_music', 'veh_door', 'veh_mount', 'veh_brake', 'bike_brake',
  'whistle', 'clap', 'cheer', 'shout', 'surdo', 'megaphone', 'bat', 'bar', 'spray', 'push', 'pickup', 'drop', 'step_grass', 'veh_horn', 'bike_bell'];

interface Slot { gain: GainNode; pan: StereoPannerNode | PannerNode; bus: Bus | null; src: AudioBufferSourceNode | null }
interface LoopSlot extends Slot { filter: BiquadFilterNode; key: string; target: { g: number; p: number; f: number; r: number } }
interface LoopEntry { id: number; kind: LoopKind; x: number; y?: number; z: number; rate: number; gain: number; intensity: number; aud: number; dead: boolean; t0: number }
interface CrowdVoice { bed: AudioBufferSourceNode | null; layer: AudioBufferSourceNode | null; layerKey: string; bedGain: GainNode; layerGain: GainNode; filter: BiquadFilterNode; pan: StereoPannerNode | PannerNode;
  x: number; z: number; live: boolean; loud: number; cell: CrowdAudioCell | null; nextEvent: number }

export class AudioManager implements AudioSink {
  ctx: Ctx | null = null;
  /** 'locked' até o primeiro gesto válido; 'unsupported' sem WebAudio */
  state: 'locked' | 'running' | 'suspended' | 'unsupported' = 'locked';
  readonly budget: AudioBudget;
  private master!: GainNode;
  private buses = {} as Record<Bus, GainNode>;
  private reverbSend: GainNode | null = null;
  private convolver: ConvolverNode | null = null;
  private slots: Slot[] = [];
  private pool: VoicePool;
  private loopSlots: LoopSlot[] = [];
  private sched: LoopScheduler;
  private loops = new Map<number, LoopEntry>();
  private loopList: LoopEntry[] = [];
  private nextLoopId = 1;
  private crowdVoices: CrowdVoice[] = [];
  private amb: { wind: GainNode; city: GainNode; srcW: AudioBufferSourceNode | null; srcC: AudioBufferSourceNode | null } | null = null;
  private buffers = new Map<string, AudioBuffer[]>();
  private pending = new Set<string>();
  private worker: Worker | null = null;
  private workerFailed = false;
  private fallbackQ: { key: string; variant: number }[] = [];
  private lastByKey = new Map<string, number>();
  private L: ListenerPose = { x: 0, y: 1.7, z: 0, yaw: 0 };
  private jumpUntil = 0;
  private hidden = false;
  private unlockBound = () => this.unlock();
  private heat: { x: number; z: number; t: number; k: number }[] = [];
  private megaphoneAt = -1e9;
  /** instrumentação (QA: window.__pvAudio()) */
  readonly counters = { nodesCreated: 0, nodesLive: 0, sourcesLive: 0, sfxCalls: 0, sfxInaudible: 0, sfxNoBuffer: 0, sfxRateLimited: 0, crowdCalls: 0, crowdEvents: 0,
    unlockAttempts: 0, buffersReady: 0, bufferBytes: 0, genMs: 0, updateMs: 0, updateMsMax: 0, peakSources: 0, peakNodes: 0 };
  readonly byId: Record<string, number> = {};

  constructor(private settings: AudioSettingsStore, budget: Partial<AudioBudget> = {}) {
    this.budget = { ...DEFAULT_BUDGET, ...budget };
    this.pool = new VoicePool(this.budget.oneShots);
    this.sched = new LoopScheduler(this.budget.loops);
    settings.onChange(() => this.applySettings());
  }

  // ------------------------------------------------------------------------------------------- autoplay
  /** escuta gestos válidos; o contexto só é criado/retomado dentro de um deles */
  installUnlock(target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window) {
    for (const ev of ['pointerdown', 'touchend', 'keydown', 'mousedown'] as const) target.addEventListener(ev, this.unlockBound, { capture: true, passive: true });
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => this.onVisibility(document.visibilityState === 'hidden'));
      window.addEventListener('pagehide', () => this.onVisibility(true));
      window.addEventListener('pageshow', () => this.onVisibility(document.visibilityState === 'hidden'));
    }
  }

  private unlock() {
    if (this.state === 'unsupported' || this.hidden) return;
    this.counters.unlockAttempts++;
    try {
      if (!this.ctx) {
        const C = (globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
          ?? (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!C) { this.state = 'unsupported'; return; }
        this.ctx = new C({ latencyHint: 'interactive' });
        this.ctx.onstatechange = () => this.onState();
        this.build();
      }
      const ctx = this.ctx;
      if (ctx.state !== 'running' && !this.settings.value.muted) void ctx.resume().catch(() => { /* bloqueado: tenta no próximo gesto */ });
      // iOS: tocar um buffer silencioso DENTRO do gesto destrava a saída de áudio
      const b = ctx.createBuffer(1, 1, 22050), s = ctx.createBufferSource();
      s.buffer = b; s.connect(ctx.destination); s.start(0);
    } catch { /* sem áudio: o jogo segue mudo, sem erro repetido */ }
    this.onState();
  }

  private onState() {
    const ctx = this.ctx;
    if (!ctx) return;
    const st = ctx.state as string;
    if (st === 'running') {
      this.state = 'running';
      setAudioSink(this);
      this.applySettings();
      this.startAmbience();
    } else if (this.state === 'running') this.state = 'suspended';
    if (st === 'interrupted') this.state = 'suspended'; // iOS (ligação, outra aba): o próximo gesto retoma
  }

  private onVisibility(hidden: boolean) {
    this.hidden = hidden;
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    if (hidden) {
      this.master.gain.setTargetAtTime(0, now, 0.03);
      setTimeout(() => { if (this.hidden) void ctx.suspend().catch(() => {}); }, 150);
    } else if (!this.settings.value.muted) {
      void ctx.resume().catch(() => {});
      this.master.gain.setTargetAtTime(this.settings.masterGain, now, 0.08);
    }
  }

  private applySettings() {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const s = this.settings.value, now = ctx.currentTime;
    this.master.gain.setTargetAtTime(this.hidden ? 0 : this.settings.masterGain, now, 0.05);
    for (const b of BUSES) this.buses[b].gain.setTargetAtTime(s[b], now, 0.05);
    // silenciar tudo: além do ganho zero, suspende o contexto (CPU de áudio ≈ 0)
    if (s.muted) setTimeout(() => { if (this.settings.value.muted && ctx.state === 'running') void ctx.suspend().catch(() => {}); }, 200);
    else if (ctx.state !== 'running' && !this.hidden && this.state !== 'locked') void ctx.resume().catch(() => {});
  }

  // ------------------------------------------------------------------------------------------- grafo
  private node<T extends AudioNode>(n: T): T { this.counters.nodesCreated++; this.counters.nodesLive++; return n; }
  private mkPan(): StereoPannerNode | PannerNode {
    const ctx = this.ctx!;
    if (typeof ctx.createStereoPanner === 'function') return this.node(ctx.createStereoPanner());
    const p = this.node(ctx.createPanner());
    p.panningModel = 'equalpower'; p.distanceModel = 'linear'; p.refDistance = 1; p.maxDistance = 10000; p.rolloffFactor = 0;
    return p;
  }
  private setPan(p: StereoPannerNode | PannerNode, v: number, t: number, tc: number) {
    if ('pan' in p) p.pan.setTargetAtTime(v, t, tc);
    else (p as PannerNode).setPosition(v, 0, 1 - Math.abs(v)); // Safari antigo: pan por posição (equalpower)
  }

  private build() {
    const ctx = this.ctx!;
    const limiter = this.node(ctx.createDynamicsCompressor());
    limiter.threshold.value = -3; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.002; limiter.release.value = 0.12;
    const comp = this.node(ctx.createDynamicsCompressor());
    comp.threshold.value = -18; comp.knee.value = 12; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.25;
    this.master = this.node(ctx.createGain());
    this.master.gain.value = 0;
    this.master.connect(comp); comp.connect(limiter); limiter.connect(ctx.destination);
    for (const b of BUSES) { const g = this.node(ctx.createGain()); g.gain.value = this.settings.value[b]; g.connect(this.master); this.buses[b] = g; }
    if (this.budget.reverb) {
      this.reverbSend = this.node(ctx.createGain());
      this.reverbSend.gain.value = 0.22;
      this.convolver = this.node(ctx.createConvolver());
      this.reverbSend.connect(this.convolver); this.convolver.connect(this.master);
      for (const [b, k] of [['sfx', 0.35], ['crowd', 0.25], ['events', 0.3], ['vehicles', 0.12]] as const) {
        const s = this.node(ctx.createGain()); s.gain.value = k; this.buses[b].connect(s); s.connect(this.reverbSend);
      }
    }
    for (let i = 0; i < this.budget.oneShots; i++) {
      const gain = this.node(ctx.createGain()), pan = this.mkPan();
      gain.connect(pan);
      this.slots.push({ gain, pan, bus: null, src: null });
    }
    for (let i = 0; i < this.budget.loops; i++) {
      const filter = this.node(ctx.createBiquadFilter()), gain = this.node(ctx.createGain()), pan = this.mkPan();
      filter.type = 'lowpass'; filter.frequency.value = 18000; gain.gain.value = 0;
      filter.connect(gain); gain.connect(pan);
      this.loopSlots.push({ filter, gain, pan, bus: null, src: null, key: '', target: { g: 0, p: 0, f: 18000, r: 1 } });
    }
    for (let i = 0; i < this.budget.crowdVoices; i++) {
      const bedGain = this.node(ctx.createGain()), layerGain = this.node(ctx.createGain()), filter = this.node(ctx.createBiquadFilter()), pan = this.mkPan();
      bedGain.gain.value = 0; layerGain.gain.value = 0; filter.type = 'lowpass'; filter.frequency.value = 8000;
      bedGain.connect(filter); layerGain.connect(filter); filter.connect(pan); pan.connect(this.buses.crowd);
      this.crowdVoices.push({ bed: null, layer: null, layerKey: '', bedGain, layerGain, filter, pan, x: 0, z: 0, live: false, loud: 0, cell: null, nextEvent: 0 });
    }
    const wind = this.node(ctx.createGain()), city = this.node(ctx.createGain());
    wind.gain.value = 0; city.gain.value = 0;
    wind.connect(this.buses.ambient); city.connect(this.buses.ambient);
    this.amb = { wind, city, srcW: null, srcC: null };
    for (const k of PRELOAD) this.request(k);
  }

  // ------------------------------------------------------------------------------------------- buffers
  private request(key: string) {
    if (this.buffers.has(key) || this.pending.has(key)) return;
    const d = soundDef(key);
    if (!d) return;
    this.pending.add(key);
    for (let v = 0; v < d.variants; v++) this.generate(key, v);
  }
  private generate(key: string, variant: number) {
    if (!this.worker && !this.workerFailed) {
      try {
        this.worker = new Worker(new URL('./synth.worker.ts', import.meta.url), { type: 'module' });
        this.worker.onmessage = (e) => this.onRendered(e.data);
        this.worker.onerror = () => { this.workerFailed = true; this.worker = null; for (const k of this.pending) { const d = soundDef(k); for (let v = 0; v < (d?.variants ?? 0); v++) this.fallbackQ.push({ key: k, variant: v }); } this.pumpFallback(); };
      } catch { this.workerFailed = true; }
    }
    if (this.worker) { this.worker.postMessage({ key, variant }); return; }
    this.fallbackQ.push({ key, variant });
    this.pumpFallback();
  }
  private pumping = false;
  /** sem Worker: um som por fatia de tempo ocioso (nunca trava o quadro inteiro) */
  private pumpFallback() {
    if (this.pumping) return;
    this.pumping = true;
    const step = () => {
      const job = this.fallbackQ.shift();
      if (!job) { this.pumping = false; return; }
      const t0 = performance.now();
      const r = renderSound(job.key, job.variant);
      this.onRendered({ key: job.key, variant: job.variant, data: r?.data ?? null, rate: r?.rate ?? 0, loop: !!r?.loop, ms: performance.now() - t0 });
      setTimeout(step, 16);
    };
    setTimeout(step, 0);
  }
  private onRendered(m: { key: string; variant: number; data: Float32Array | null; rate: number; loop?: boolean; ms: number }) {
    const ctx = this.ctx;
    this.counters.genMs += m.ms;
    if (!ctx || !m.data) return;
    const d = soundDef(m.key)!;
    const list = this.buffers.get(m.key) ?? [];
    let buf: AudioBuffer;
    try { buf = ctx.createBuffer(1, m.data.length, m.rate); } catch { return; }
    if (typeof buf.copyToChannel === 'function') buf.copyToChannel(m.data, 0); else buf.getChannelData(0).set(m.data);
    list[m.variant] = buf;
    this.counters.bufferBytes += m.data.length * 4;
    if (list.filter(Boolean).length >= d.variants) {
      this.pending.delete(m.key);
      this.counters.buffersReady++;
    }
    this.buffers.set(m.key, list);
    if (m.key === 'ir' && this.convolver && list[0] && list[1] && !this.convolver.buffer) {
      const ir = ctx.createBuffer(2, list[0].length, list[0].sampleRate);
      ir.getChannelData(0).set(list[0].getChannelData(0)); ir.getChannelData(1).set(list[1].getChannelData(0));
      this.convolver.buffer = ir;
    }
    if (m.key === 'amb_wind' || m.key === 'amb_city') this.startAmbience();
  }
  private buffer(key: string, pick = Math.random()): AudioBuffer | null {
    const l = this.buffers.get(key);
    if (!l || !l.length) { this.request(key); return null; }
    const ok = l.filter(Boolean);
    return ok.length ? ok[Math.floor(pick * ok.length) % ok.length] : null;
  }

  private source(buf: AudioBuffer, loop: boolean): AudioBufferSourceNode {
    const s = this.node(this.ctx!.createBufferSource());
    s.buffer = buf; s.loop = loop;
    this.counters.sourcesLive++;
    this.counters.peakSources = Math.max(this.counters.peakSources, this.counters.sourcesLive);
    this.counters.peakNodes = Math.max(this.counters.peakNodes, this.counters.nodesLive);
    s.onended = () => { this.counters.sourcesLive--; this.counters.nodesLive--; try { s.disconnect(); } catch { /* já desconectado */ } };
    return s;
  }
  private get running() { return this.state === 'running' && this.ctx?.state === 'running' && !this.hidden; }

  // ------------------------------------------------------------------------------------------- AudioSink
  sfx(id: SfxId, o?: SfxOpts) { this.play(id, o); }

  /** one-shot (contrato ou interno) com prioridade; devolve se uma voz real tocou */
  play(id: string, o?: SfxOpts & { prioMul?: number }): boolean {
    this.counters.sfxCalls++;
    this.byId[id] = (this.byId[id] ?? 0) + 1;
    const spec = sfxSpec(id, o);
    if (!spec || !this.running) return false;
    const ctx = this.ctx!, now = ctx.currentTime;
    // passo/clique repetido no mesmo instante: um só
    const last = this.lastByKey.get(spec.key) ?? -1;
    if (now - last < (spec.bus === 'ui' ? 0.03 : 0.025)) { this.counters.sfxRateLimited++; return false; }
    const positional = !!spec.falloff && o?.x !== undefined && o?.z !== undefined;
    const dist = positional ? distTo(this.L, o!.x!, o!.y, o!.z!) : 0;
    const att = positional ? attenuation(dist, spec.falloff!) : 1;
    const g = (o?.gain ?? 1) * att;
    if (g < AUDIBLE_MIN) { this.counters.sfxInaudible++; return false; }
    if (positional && (id === 'punch' || id === 'kick' || id === 'impact' || id === 'bat' || id === 'bar' || id === 'fall')) this.heat.push({ x: o!.x!, z: o!.z!, t: now, k: 1 });
    const buf = this.buffer(spec.key);
    if (!buf) { this.counters.sfxNoBuffer++; return false; }
    const prio = g * spec.weight * (o?.prioMul ?? 1);
    const rate = 1 + ((Math.random() * 2 - 1) * (o?.pitchJitter ?? 0.04));
    const dur = buf.duration / rate + 0.02;
    const a = this.pool.alloc(prio, now, dur);
    if (!a) return false;
    this.lastByKey.set(spec.key, now);
    const slot = this.slots[a.slot];
    const t = a.steal ? now + 0.012 : now;
    if (a.steal && slot.src) { slot.gain.gain.setTargetAtTime(0, now, 0.003); try { slot.src.stop(t); } catch { /* já parou */ } }
    if (slot.bus !== spec.bus) { slot.pan.disconnect(); slot.pan.connect(this.buses[spec.bus]); slot.bus = spec.bus; }
    slot.gain.gain.cancelScheduledValues(t);
    slot.gain.gain.setValueAtTime(g, t);
    const pan = positional ? panFor(this.L, o!.x!, o!.z!) : 0;
    if ('pan' in slot.pan) { slot.pan.pan.cancelScheduledValues(t); slot.pan.pan.setValueAtTime(pan, t); } else this.setPan(slot.pan, pan, t, 0.01);
    const src = this.source(buf, false);
    src.playbackRate.value = rate;
    src.connect(slot.gain);
    src.start(t);
    const prev = src.onended as () => void;
    src.onended = () => { prev(); if (slot.src === src) { slot.src = null; this.pool.release(a.slot); } };
    slot.src = src;
    return true;
  }

  loop(kind: LoopKind, o: { x: number; y?: number; z: number }): LoopHandle {
    const e: LoopEntry = { id: this.nextLoopId++, kind, x: o.x, y: o.y, z: o.z, rate: 1, gain: 1, intensity: 1, aud: 0, dead: false, t0: this.ctx?.currentTime ?? 0 };
    this.loops.set(e.id, e);
    this.request(LOOPS[kind].key);
    return {
      set: (p) => { if (e.dead) return; e.x = p.x; e.z = p.z; if (p.y !== undefined) e.y = p.y; if (p.rate !== undefined) e.rate = p.rate; if (p.gain !== undefined) e.gain = p.gain; if (p.intensity !== undefined) e.intensity = p.intensity; },
      stop: () => { e.dead = true; },
    };
  }

  private cells: readonly CrowdAudioCell[] = [];
  crowd(cells: readonly CrowdAudioCell[]) { this.counters.crowdCalls++; this.cells = cells; }

  listener(x: number, y: number, z: number, yaw: number) {
    const L = this.L;
    if (Math.hypot(x - L.x, y - L.y, z - L.z) > 25 && this.ctx) this.jumpUntil = this.ctx.currentTime + 0.35; // troca de câmera: rampas mais longas
    L.x = x; L.y = y; L.z = z; L.yaw = yaw;
  }
  get listenerPose(): Readonly<ListenerPose> { return this.L; }

  // ------------------------------------------------------------------------------------------- por quadro
  update(dt: number) {
    if (!this.running) return;
    const t0 = performance.now();
    const ctx = this.ctx!, now = ctx.currentTime;
    const tc = now < this.jumpUntil ? 0.25 : 0.06;
    this.updateLoops(now, tc);
    this.updateCrowd(now, dt, now < this.jumpUntil ? 0.6 : 0.35);
    this.updateAmbience(now);
    while (this.heat.length && now - this.heat[0].t > 6) this.heat.shift();
    if (this.heat.length > 64) this.heat.splice(0, this.heat.length - 64);
    const ms = performance.now() - t0;
    this.counters.updateMs = this.counters.updateMs * 0.95 + ms * 0.05;
    this.counters.updateMsMax = Math.max(this.counters.updateMsMax * 0.999, ms);
  }

  private updateLoops(now: number, tc: number) {
    this.loopList.length = 0;
    for (const e of this.loops.values()) {
      if (e.dead) { this.loops.delete(e.id); continue; }
      const sp = LOOPS[e.kind];
      e.aud = e.gain * e.intensity * attenuation(distTo(this.L, e.x, e.y, e.z), sp.falloff) * sp.weight;
      this.loopList.push(e);
    }
    const changes = this.sched.update(this.loopList);
    for (const c of changes) {
      const s = this.loopSlots[c.slot];
      if (s.src) { const old = s.src; s.gain.gain.setTargetAtTime(0, now, 0.02); try { old.stop(now + 0.09); } catch { /* */ } s.src = null; }
      s.key = '';
      s.target.g = 0;
    }
    for (let i = 0; i < this.loopSlots.length; i++) {
      const id = this.sched.assign[i];
      const s = this.loopSlots[i];
      if (id < 0) continue;
      const e = this.loops.get(id);
      if (!e) continue;
      const sp = LOOPS[e.kind];
      if (!s.src) {
        const buf = this.buffer(sp.key, 0);
        if (!buf) continue;
        if (s.bus !== sp.bus) { s.pan.disconnect(); s.pan.connect(this.buses[sp.bus]); s.bus = sp.bus; }
        const src = this.source(buf, true);
        src.connect(s.filter);
        // música continua "de onde estaria" (a fonte virtual nunca parou de tocar)
        const off = sp.bus === 'events' ? (now - e.t0) % buf.duration : Math.random() * buf.duration;
        src.playbackRate.value = e.rate;
        s.gain.gain.setTargetAtTime(0, now, 0.015); // a fonte anterior desta voz (se havia) some antes da nova entrar
        s.gain.gain.setValueAtTime(0, now + 0.1);
        src.start(now + 0.1, off);
        s.src = src; s.key = sp.key;
        s.target.g = -1;
      }
      const d = distTo(this.L, e.x, e.y, e.z);
      const g = e.gain * e.intensity * attenuation(d, sp.falloff);
      const p = panFor(this.L, e.x, e.z, 4), f = airCutoff(d, sp.falloff.max);
      const T = s.target;
      if (Math.abs(T.g - g) > 0.004) { s.gain.gain.setTargetAtTime(g, Math.max(now, now + (T.g < 0 ? 0.1 : 0)), T.g < 0 ? 0.08 : tc); T.g = g; }
      if (Math.abs(T.p - p) > 0.01) { this.setPan(s.pan, p, now, tc); T.p = p; }
      if (Math.abs(T.f - f) / T.f > 0.03) { s.filter.frequency.setTargetAtTime(f, now, 0.1); T.f = f; }
      if (Math.abs(T.r - e.rate) > 0.005) { s.src.playbackRate.setTargetAtTime(e.rate, now, 0.08); T.r = e.rate; }
    }
  }

  /** casa as células da vez com as vozes (a voz segue a célula mais perto da que ela já tocava: sem salto) */
  private updateCrowd(now: number, dt: number, tc: number) {
    const V = this.crowdVoices, cells = this.cells;
    const used = new Set<number>();
    for (const v of V) v.cell = null;
    for (const c of cells) {
      let best = -1, bd = 40;
      for (let i = 0; i < V.length; i++) { if (used.has(i) || !V[i].live) continue; const d = Math.hypot(V[i].x - c.x, V[i].z - c.z); if (d < bd) { bd = d; best = i; } }
      if (best < 0) best = V.findIndex((v, i) => !used.has(i) && !v.live);
      if (best < 0) best = V.findIndex((_, i) => !used.has(i));
      if (best < 0) break;
      used.add(best);
      V[best].cell = c;
    }
    const bed = this.buffer('crowd_bed', 0);
    for (let i = 0; i < V.length; i++) {
      const v = V[i], c = v.cell;
      if (!c) {
        if (v.live) { v.bedGain.gain.setTargetAtTime(0, now, 0.5); v.layerGain.gain.setTargetAtTime(0, now, 0.5); v.live = false; v.loud = 0; }
        continue;
      }
      if (!v.live) { v.x = c.x; v.z = c.z; } else { v.x += (c.x - v.x) * 0.3; v.z += (c.z - v.z) * 0.3; }
      v.live = true;
      if (!v.bed && bed) {
        const s = this.source(bed, true);
        s.playbackRate.value = 0.94 + i * 0.04;
        s.connect(v.bedGain);
        s.start(now, (i * 2.3) % bed.duration);
        v.bed = s;
      }
      const d = distTo(this.L, v.x, undefined, v.z);
      const dens = crowdLoudness(c.density);
      const loud = dens * attenuation(d, FALLOFF.crowdCell);
      v.loud = loud;
      v.bedGain.gain.setTargetAtTime(loud * (0.5 + 0.5 * c.activity), now, tc);
      this.setPan(v.pan, panFor(this.L, v.x, v.z, 14), now, tc);
      v.filter.frequency.setTargetAtTime(airCutoff(d, FALLOFF.crowdCell.max * 1.4), now, 0.2);
      // camada de percussão/palmas do perfil (só famílias com camada); troca de perfil = fonte nova com rampa
      const fam = layerFamily(c.profile);
      const lkey = fam ? `layer:${c.profile}` : '';
      if (lkey !== v.layerKey) {
        if (v.layer) { const old = v.layer; v.layerGain.gain.setTargetAtTime(0, now, 0.15); try { old.stop(now + 0.6); } catch { /* */ } v.layer = null; }
        v.layerKey = lkey;
      }
      const lw = fam ? Math.min(1, Math.max(c.celebrationIntensity, c.activity * 0.8, c.eventType ? 0.7 : 0.25)) * c.profileShare : 0;
      if (lkey && !v.layer && lw * loud > AUDIBLE_MIN) {
        const lb = this.buffer(lkey, 0);
        if (lb) {
          const s = this.source(lb, true);
          s.connect(v.layerGain);
          v.layerGain.gain.cancelScheduledValues(now);
          v.layerGain.gain.setValueAtTime(0, now);
          s.start(now, Math.random() * lb.duration);
          v.layer = s;
        }
      }
      if (v.layer) v.layerGain.gain.setTargetAtTime(loud * lw * 0.8, now, tc);
      // reações pontuais (apito, palmas, grito genérico, megafone…) sorteadas pela célula — pelo pool de one-shots
      v.nextEvent -= dt * crowdEventRate(loud, c.activity, c.celebrationIntensity, c.combatIntensity, c.profile, c.eventType);
      if (v.nextEvent <= 0) {
        v.nextEvent = 0.5 + Math.random() * 1.5;
        const megOk = now - this.megaphoneAt > 7 && c.density > 12;
        const k = pickCrowdEvent(Math.random(), c.profile, c.celebrationIntensity, c.combatIntensity, megOk);
        if (k === 'megaphone') this.megaphoneAt = now;
        const ang = Math.random() * Math.PI * 2, r = Math.random() * 10;
        if (this.play(k, { x: v.x + Math.cos(ang) * r, z: v.z + Math.sin(ang) * r, gain: 0.35 + 0.5 * Math.min(1, dens), pitchJitter: 0.08, prioMul: 0.5 })) this.counters.crowdEvents++;
      }
    }
  }

  private startAmbience() {
    const a = this.amb, ctx = this.ctx;
    if (!a || !ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    if (!a.srcW) { const b = this.buffer('amb_wind', 0); if (b) { a.srcW = this.source(b, true); a.srcW.connect(a.wind); a.srcW.start(now, Math.random() * b.duration); } }
    if (!a.srcC) { const b = this.buffer('amb_city', 0); if (b) { a.srcC = this.source(b, true); a.srcC.connect(a.city); a.srcC.start(now, Math.random() * b.duration); } }
  }

  /** vento cresce com a altura (vista aérea); a cidade abafa sob uma multidão forte */
  private updateAmbience(now: number) {
    const a = this.amb;
    if (!a) return;
    if (!a.srcW || !a.srcC) this.startAmbience();
    const alt = Math.min(1, Math.max(0, (this.L.y - 20) / 160));
    let crowd = 0;
    for (const v of this.crowdVoices) crowd = Math.max(crowd, v.loud);
    a.wind.gain.setTargetAtTime(0.16 + 0.5 * alt, now, 0.5);
    a.city.gain.setTargetAtTime((0.42 * (1 - 0.6 * alt)) * (1 - 0.45 * crowd), now, 0.5);
  }

  /** golpes/quedas recentes (calor de confronto para as células) */
  heatPoints(): readonly { x: number; z: number; t: number; k: number }[] { return this.heat; }
  get time() { return this.ctx?.currentTime ?? 0; }

  /** QA/medição */
  stats() {
    const now = this.ctx?.currentTime ?? 0;
    return {
      state: this.state, ctxState: this.ctx?.state ?? null, sampleRate: this.ctx?.sampleRate ?? null, baseLatency: this.ctx?.baseLatency ?? null, hidden: this.hidden,
      budget: this.budget, counters: { ...this.counters, updateMs: +this.counters.updateMs.toFixed(3), updateMsMax: +this.counters.updateMsMax.toFixed(3), genMs: +this.counters.genMs.toFixed(0) },
      oneShots: { ...this.pool.stats, busy: this.pool.busy(now) },
      loops: { ...this.sched.stats, logical: this.loops.size, real: this.loopSlots.filter((s) => s.src).length, kinds: [...this.loops.values()].reduce((m, e) => { m[e.kind] = (m[e.kind] ?? 0) + 1; return m; }, {} as Record<string, number>), playing: this.loopSlots.filter((s) => s.src).map((s) => s.key) },
      crowd: { cellsIn: this.cells.length, voices: this.crowdVoices.filter((v) => v.live).length, layers: this.crowdVoices.filter((v) => v.layer).map((v) => v.layerKey), loud: this.crowdVoices.map((v) => +v.loud.toFixed(3)), cells: this.cells.map((c) => ({ x: Math.round(c.x), z: Math.round(c.z), density: c.density, profile: c.profile, share: +c.profileShare.toFixed(2), activity: +c.activity.toFixed(2), ev: c.eventType ?? null })) },
      buffers: { ready: this.counters.buffersReady, pending: this.pending.size, MB: +(this.counters.bufferBytes / 1e6).toFixed(1), worker: !!this.worker },
      listener: { x: +this.L.x.toFixed(1), y: +this.L.y.toFixed(1), z: +this.L.z.toFixed(1), yaw: +this.L.yaw.toFixed(2) },
      byId: { ...this.byId },
      settings: { ...this.settings.value },
    };
  }

  /** QA: deixa o gesto para trás (testes automatizados chamam depois de um clique real) */
  unlockNow() { this.unlock(); }
  /** QA: mestre audível? (ganho alvo atual) */
  get masterTarget() { return this.master ? this.master.gain.value : 0; }
}

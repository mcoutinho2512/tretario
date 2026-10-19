/**
 * Rodada 10 — áudio (docs/AUDIO_SYSTEM.md): tudo puro ou com WebAudio FALSO (sem AudioContext real).
 * Alocador e limite de vozes, agregação da multidão em células, atenuação/pan, persistência dos volumes,
 * handle preguiçoso do contrato e o teto de nós do AudioManager.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { VoicePool, LoopScheduler } from '../src/audio/voices';
import { CrowdAudioAggregator, type SupporterAudioData } from '../src/audio/crowdCells';
import { attenuation, panFor, crowdLoudness, airCutoff, FALLOFF, AUDIBLE_MIN } from '../src/audio/spatial';
import { AudioSettingsStore, DEFAULT_AUDIO, AUDIO_SETTINGS_KEY, type KV } from '../src/audio/settings';
import { audioLoop, setAudioSink, sfx, audioActive, type AudioSink, type LoopHandle } from '../src/audio/bus';
import { combatSfx, eventCrowdProfile, pickCrowdEvent, sfxSpec, LOOPS } from '../src/audio/catalog';
import { SOUNDS, renderSound, soundDef, layerFamily } from '../src/audio/sounds';
import { AudioManager } from '../src/audio/AudioManager';

const supporters = JSON.parse(readFileSync('public/gameplay/supporters.json', 'utf8')) as SupporterAudioData & { groups: { clothingSet: { shirtDesign: number }; flagSet: number[] }[] };

describe('orçamento de vozes', () => {
  it('pool de one-shots nunca passa do limite; rouba a menos importante; descarta a irrelevante', () => {
    const p = new VoicePool(24);
    let got = 0;
    for (let i = 0; i < 200; i++) if (p.alloc(0.5, 0, 1)) got++;
    expect(p.busy(0)).toBe(24);
    expect(got).toBe(24 + p.stats.stolen);
    // menos importante que todas as tocando: descartado
    const culled = p.stats.culled;
    expect(p.alloc(0.01, 0, 1)).toBeNull();
    expect(p.stats.culled).toBe(culled + 1);
    // mais importante: rouba uma voz (sem crescer)
    const r = p.alloc(5, 0, 1)!;
    expect(r.steal).toBe(true);
    expect(p.busy(0)).toBe(24);
    // vozes acabam: vaga livre sem roubo
    const f = p.alloc(0.1, 2, 0.5)!;
    expect(f.steal).toBe(false);
    p.release(f.slot);
    expect(p.busy(2)).toBe(0);
  });

  it('laços: 60 fontes lógicas → no máximo 8 reais, as mais audíveis; inaudíveis ficam virtuais; histerese', () => {
    const s = new LoopScheduler(8);
    const loops = Array.from({ length: 60 }, (_, i) => ({ id: i + 1, aud: i < 50 ? (i + 1) / 100 : 0 }));
    s.update(loops);
    const real = s.assign.filter((x) => x >= 0);
    expect(real).toHaveLength(8);
    expect(real.sort((a, b) => a - b)).toEqual([43, 44, 45, 46, 47, 48, 49, 50]);
    expect(s.stats.virtual).toBe(52);
    // fonte nova um pouco mais forte que a mais fraca tocando: a histerese segura a troca
    loops.push({ id: 99, aud: 0.44 });
    expect(s.update(loops)).toEqual([]);
    // bem mais forte: entra no lugar da mais fraca
    loops.push({ id: 100, aud: 0.9 });
    const ch = s.update(loops);
    expect(ch).toHaveLength(1);
    expect(ch[0].from).toBe(43);
    expect(ch[0].to).toBe(100);
    // todas inaudíveis: nenhuma voz real
    s.update(loops.map((l) => ({ ...l, aud: 0 })));
    expect(s.assign.every((x) => x < 0)).toBe(true);
  });
});

describe('multidão agregada (células)', () => {
  it('500 entidades → no máximo 4 vozes de multidão, a mais relevante primeiro', () => {
    const a = new CrowdAudioAggregator();
    a.setProfiles('manifestacao', supporters);
    a.begin(0, 0);
    let k = 1;
    for (let i = 0; i < 500; i++) { k = (k * 16807) % 2147483647; const r = (k / 2147483647); a.addAgent((r - 0.5) * 220, ((i * 37) % 220) - 110, 1.2, i % 5 === 0 ? 1 : 0, 0, 0, 0); }
    const cells = a.end();
    expect(a.lastAdded).toBe(500);
    expect(cells.length).toBeLessThanOrEqual(4);
    expect(cells.length).toBeGreaterThan(0);
    const total = cells.reduce((s, c) => s + c.density, 0);
    expect(total).toBeLessThan(500); // só as relevantes viram voz
    for (const c of cells) { expect(c.profile).toBe('manifestacao'); expect(c.activity).toBeGreaterThan(0); expect(c.activity).toBeLessThanOrEqual(1); }
  });

  it('ganho da multidão é logarítmico com teto — nunca soma linear por pessoa', () => {
    expect(crowdLoudness(0)).toBe(0);
    expect(crowdLoudness(1000)).toBe(1);
    expect(crowdLoudness(500)).toBeLessThanOrEqual(1);
    const r = crowdLoudness(100) / crowdLoudness(10);
    expect(r).toBeGreaterThan(1);
    expect(r).toBeLessThan(2.5); // 10× gente ≠ 10× volume
  });

  it('perfil pelos DADOS da torcida (design de camisa/bandeira) e por NetPlayer.sup; fração do perfil dominante', () => {
    const a = new CrowdAudioAggregator();
    a.setProfiles('urbano', supporters);
    const g0 = supporters.groups[0], g1 = supporters.groups[1];
    a.begin(0, 0);
    for (let i = 0; i < 12; i++) a.addAgent(5 + i * 0.1, 5, 1, 1, 0, g0.clothingSet.shirtDesign, 0);
    for (let i = 0; i < 4; i++) a.addAgent(6, 6, 1, 0, 0, 0, g1.flagSet[0]);
    for (let i = 0; i < 4; i++) a.addAgent(7, 7, 1, 0, 0, 0, 0);
    const [c] = a.end();
    expect(c.profile).toBe(g0.audioProfile);
    expect(c.profileShare).toBeCloseTo(12 / 20, 5);
    // jogadores com `sup` (i+1) puxam o perfil para o grupo deles
    a.begin(0, 0);
    for (let i = 0; i < 6; i++) a.addAgent(5, 5, 1, 0, 0, 0, 0);
    for (let i = 0; i < 6; i++) a.addVote(5, 5, 2, 2);
    expect(a.end()[0].profile).toBe(g1.audioProfile);
    // sem dados de torcida: tudo no perfil do evento
    const b = new CrowdAudioAggregator();
    b.setProfiles('show', null);
    b.begin(0, 0);
    b.addAgent(1, 1, 0, 0, 0, g0.clothingSet.shirtDesign, 0);
    expect(b.end()[0].profile).toBe('show');
  });

  it('confronto e comemoração: quedas/calor sobem combate; ações sociais sobem comemoração; zona dá o tipo de evento', () => {
    const a = new CrowdAudioAggregator();
    a.setProfiles('manifestacao');
    a.setEventZones([{ x: 0, z: 0, r: 30, type: 'caminhada' }]);
    a.begin(0, 0);
    for (let i = 0; i < 10; i++) a.addAgent(2, 2, 0.5, i < 8 ? 1 : 0, i < 3 ? 1.2 : 0, 0, 0);
    a.addHeat(2, 2, 0.5, 0);
    const [c] = a.end();
    expect(c.combatIntensity).toBeGreaterThan(0.5);
    expect(c.celebrationIntensity).toBeGreaterThan(0.8);
    expect(c.eventType).toBe('caminhada');
  });

  it('células longe demais não viram voz; a grade é presa ao mundo', () => {
    const a = new CrowdAudioAggregator();
    a.begin(0, 0);
    for (let i = 0; i < 50; i++) a.addAgent(1000, 1000, 1, 0, 0, 0, 0);
    expect(a.end()).toHaveLength(0);
    expect(a.lastAdded).toBe(0);
  });
});

describe('espacial', () => {
  it('atenuação: perto mais forte, longe cai, fora do alcance = 0 (virtualiza)', () => {
    const f = FALLOFF.trio;
    expect(attenuation(0, f)).toBe(1);
    expect(attenuation(f.ref, f)).toBe(1);
    let prev = 1;
    for (let d = f.ref; d < f.max; d += 5) { const g = attenuation(d, f); expect(g).toBeLessThanOrEqual(prev + 1e-12); prev = g; }
    expect(attenuation(f.max, f)).toBe(0);
    expect(attenuation(f.max * 2, f)).toBe(0);
    expect(attenuation(30, f)).toBeGreaterThan(attenuation(150, f) * 3);
    // um passo a 40 m nem vira voz
    expect(attenuation(40, FALLOFF.step)).toBeLessThan(AUDIBLE_MIN);
  });

  it('pan pelo rumo do ouvinte (rumo 0 = +z; direita = −x) e agudos caem com a distância', () => {
    const L = { x: 0, y: 1.7, z: 0, yaw: 0 };
    expect(panFor(L, -10, 0)).toBeGreaterThan(0.5); // direita
    expect(panFor(L, 10, 0)).toBeLessThan(-0.5); // esquerda
    expect(Math.abs(panFor(L, 0, 10))).toBeLessThan(1e-9); // à frente
    expect(panFor({ ...L, yaw: Math.PI / 2 }, 0, 10)).toBeGreaterThan(0.5); // olhando +x: +z fica à direita
    expect(Math.abs(panFor(L, -0.5, 0))).toBeLessThan(0.3); // em cima: não pula de lado
    expect(airCutoff(5, 200)).toBeGreaterThan(airCutoff(150, 200));
  });
});

describe('volumes (pv3d.audio)', () => {
  const mem = (): KV & { m: Map<string, string> } => { const m = new Map<string, string>(); return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); } }; };
  it('persistem, validam campo a campo e silenciar zera o master', () => {
    const kv = mem();
    const s = new AudioSettingsStore(kv);
    expect(s.value).toEqual(DEFAULT_AUDIO);
    let calls = 0;
    s.onChange(() => calls++);
    s.set({ crowd: 0.3, ui: 2, master: -1 });
    expect(s.value.crowd).toBe(0.3);
    expect(s.value.ui).toBe(1);
    expect(s.value.master).toBe(0);
    s.set({ muted: true });
    expect(s.masterGain).toBe(0);
    s.set({ muted: true }); // sem mudança: sem aviso
    expect(calls).toBe(2);
    const again = new AudioSettingsStore(kv);
    expect(again.value).toEqual(s.value);
    expect(JSON.parse(kv.m.get(AUDIO_SETTINGS_KEY)!).muted).toBe(true);
  });
  it('storage corrompido ou ausente: padrão, sem erro', () => {
    const kv = mem(); kv.m.set(AUDIO_SETTINGS_KEY, '{nao é json');
    expect(new AudioSettingsStore(kv).value).toEqual(DEFAULT_AUDIO);
    const bad: KV = { getItem: () => { throw new Error('bloqueado'); }, setItem: () => { throw new Error('cheio'); } };
    const s = new AudioSettingsStore(bad);
    expect(() => s.set({ sfx: 0.2 })).not.toThrow();
    expect(s.value.sfx).toBe(0.2);
    const none = new AudioSettingsStore(null);
    expect(none.value.muted).toBe(false);
  });
});

describe('contrato (bus.ts): no-op até o áudio liberar, handle preguiçoso', () => {
  afterEach(() => setAudioSink(null));
  it('pedidos antes do registro não fazem nada; o laço liga no primeiro set depois', () => {
    const log: string[] = [];
    let live = 0;
    const sink: AudioSink = {
      sfx: (id) => { log.push(`sfx:${id}`); },
      loop: (kind) => { log.push(`loop:${kind}`); live++; const h: LoopHandle = { set: (p) => { log.push(`set:${p.x}`); }, stop: () => { live--; log.push('stop'); } }; return h; },
      crowd: () => {}, listener: () => {},
    };
    sfx('punch');
    const h = audioLoop('trio_music', { x: 1, z: 0 });
    expect(audioActive()).toBe(false);
    expect(log).toEqual([]);
    setAudioSink(sink);
    sfx('punch');
    h.set({ x: 2, z: 0 });
    expect(log).toEqual(['sfx:punch', 'loop:trio_music', 'set:2']);
    // troca de sink: a voz antiga para, nasce na nova
    const sink2: AudioSink = { ...sink, loop: (k) => { log.push(`loop2:${k}`); return { set: () => {}, stop: () => {} }; } };
    setAudioSink(sink2);
    h.set({ x: 3, z: 0 });
    expect(log.slice(-2)).toEqual(['stop', 'loop2:trio_music']);
    h.stop();
    h.set({ x: 4, z: 0 });
    expect(log.at(-1)).toBe('loop2:trio_music');
    expect(live).toBe(0);
  });
});

describe('catálogo e sons gerados', () => {
  it('golpes pelo clipe/tipo de combat.json (sem tabela por id)', () => {
    const combat = JSON.parse(readFileSync('public/gameplay/combat.json', 'utf8')) as { actions: { key: string; kind: string; animation: string }[] };
    const by = Object.fromEntries(combat.actions.map((a) => [a.key, combatSfx(a)]));
    expect(by.soco.hit).toBe('punch');
    expect(by.chute.hit).toBe('kick');
    expect(by.esquiva.swing).toBe('dodge');
    expect(by.golpe_taco.hit).toBe('bat');
    expect(by.golpe_barra.hit).toBe('bar');
    expect(by.spray.hit).toBe('spray');
    for (const a of combat.actions) expect(sfxSpec(combatSfx(a).hit)).not.toBeNull();
  });
  it('perfil da multidão pelo evento; reações por família (sem canto: só apito/palmas/grito genérico/megafone/surdo)', () => {
    const ev = JSON.parse(readFileSync('public/events/manifestacao.json', 'utf8'));
    expect(eventCrowdProfile(ev)).toBe('manifestacao');
    expect(eventCrowdProfile({ category: 'cotidiano' })).toBe('urbano');
    expect(eventCrowdProfile({ ambience: { crowd: 'show' } })).toBe('show');
    const ok = new Set(['whistle', 'clap', 'cheer', 'megaphone', 'surdo', 'shout']);
    for (const p of ['manifestacao', 'torcida_a', 'show', 'urbano']) for (let u = 0; u < 1; u += 0.05) expect(ok.has(pickCrowdEvent(u, p, 0, 0, true))).toBe(true);
    expect(pickCrowdEvent(0.1, 'torcida_a', 0, 0.9, true)).toBe('shout');
  });
  it('todos os sons rendem: finitos, não-silenciosos, sem saturar; laços marcados; camadas por perfil vêm do hash da chave', () => {
    for (const k of Object.keys(SOUNDS)) {
      const r = renderSound(k)!;
      let peak = 0, sum = 0, bad = 0;
      for (const x of r.data) { if (!Number.isFinite(x)) bad++; peak = Math.max(peak, Math.abs(x)); sum += x * x; }
      expect(bad, k).toBe(0);
      expect(peak, k).toBeLessThanOrEqual(1);
      expect(Math.sqrt(sum / r.data.length), k).toBeGreaterThan(0.01);
    }
    for (const l of Object.values(LOOPS)) expect(soundDef(l.key)?.loop, l.key).toBe(true);
    for (const g of supporters.groups) expect(layerFamily(g.audioProfile)).toBe('torcida');
    const a = renderSound(`layer:${supporters.groups[0].audioProfile}`)!, b = renderSound(`layer:${supporters.groups[1].audioProfile}`)!;
    expect(a.loop).toBe(true);
    expect(a.data.length === b.data.length && a.data.every((x, i) => x === b.data[i])).toBe(false);
    expect(soundDef('layer:urbano')).toBeNull();
    // determinístico
    expect(renderSound('punch', 1)!.data).toEqual(renderSound('punch', 1)!.data);
  });
});

// ---------------------------------------------------------------------------------------------- WebAudio falso
class FParam { value = 0; setTargetAtTime(v: number) { this.value = v; } setValueAtTime(v: number) { this.value = v; } cancelScheduledValues() {} linearRampToValueAtTime(v: number) { this.value = v; } }
let liveNodes = 0, created = 0;
class FNode { constructor() { liveNodes++; created++; } connect() { return this; } disconnect() {} }
class FGain extends FNode { gain = new FParam(); }
class FPan extends FNode { pan = new FParam(); }
class FFilter extends FNode { type = 'lowpass'; frequency = new FParam(); }
class FComp extends FNode { threshold = new FParam(); knee = new FParam(); ratio = new FParam(); attack = new FParam(); release = new FParam(); }
class FConv extends FNode { buffer: unknown = null; }
class FBuffer { constructor(readonly numberOfChannels: number, readonly length: number, readonly sampleRate: number) {} get duration() { return this.length / this.sampleRate; } getChannelData() { return new Float32Array(this.length); } copyToChannel() {} }
class FSource extends FNode {
  buffer: FBuffer | null = null; loop = false; playbackRate = new FParam(); onended: (() => void) | null = null; started = false; stopped = false;
  static all: FSource[] = [];
  constructor() { super(); FSource.all.push(this); }
  start() { this.started = true; }
  stop() { if (!this.stopped) { this.stopped = true; liveNodes--; queueMicrotask(() => this.onended?.()); } }
}
class FCtx {
  state = 'suspended'; currentTime = 0; sampleRate = 48000; baseLatency = 0.01; destination = new FNode(); onstatechange: (() => void) | null = null;
  createGain() { return new FGain(); } createStereoPanner() { return new FPan(); } createBiquadFilter() { return new FFilter(); }
  createDynamicsCompressor() { return new FComp(); } createConvolver() { return new FConv(); } createBufferSource() { return new FSource(); }
  createBuffer(c: number, l: number, r: number) { return new FBuffer(c, l, r); }
  resume() { this.state = 'running'; this.onstatechange?.(); return Promise.resolve(); }
  suspend() { this.state = 'suspended'; this.onstatechange?.(); return Promise.resolve(); }
}

describe('AudioManager com WebAudio falso: nós limitados', () => {
  beforeAll(() => {
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = FCtx;
    (globalThis as unknown as { Worker: unknown }).Worker = class { onmessage = null; onerror = null; postMessage() {} }; // síntese fica pendente; o teste injeta buffers
  });
  afterEach(() => setAudioSink(null));

  it('bloqueado até o gesto; depois 500 pedidos de som e 40 laços não fazem os nós crescerem sem limite', async () => {
    const kv = { m: new Map<string, string>(), getItem(k: string) { return this.m.get(k) ?? null; }, setItem(k: string, v: string) { this.m.set(k, v); } };
    const st = new AudioSettingsStore(kv);
    const m = new AudioManager(st, { oneShots: 24, loops: 8, crowdVoices: 4 });
    expect(m.state).toBe('locked');
    m.sfx('punch', { x: 0, z: 0 }); // sem contexto: nada
    expect(m.ctx).toBeNull();
    m.unlockNow();
    expect(m.state).toBe('running');
    expect(audioActive()).toBe(true);
    // buffers "gerados" (sem Worker no teste: injeta direto)
    const inject = (key: string, n = 2400, variants = 1) => { for (let v = 0; v < variants; v++) (m as unknown as { onRendered: (x: unknown) => void }).onRendered({ key, variant: v, data: new Float32Array(n), rate: 24000, ms: 0 }); };
    for (const k of ['punch', 'kick', 'impact', 'step_asphalt', 'whoosh']) inject(k, 4800, soundDef(k)!.variants);
    for (const l of Object.values(LOOPS)) inject(l.key, 24000);
    inject('crowd_bed', 48000); inject('amb_wind', 48000); inject('amb_city', 48000);
    const ctx = m.ctx as unknown as FCtx;
    const base = liveNodes;
    m.listener(0, 1.7, 0, 0);
    // 500 golpes no mesmo instante, espalhados até 80 m
    for (let i = 0; i < 500; i++) m.sfx(['punch', 'kick', 'impact', 'step', 'whoosh'][i % 5] as never, { x: (i % 40) * 2, z: (i % 7) * 3 });
    const playing = FSource.all.filter((s) => s.started && !s.stopped && !s.loop).length;
    expect(playing).toBeLessThanOrEqual(24);
    // 40 veículos/trios perto: ≤ 8 laços reais
    const hs = Array.from({ length: 40 }, (_, i) => m.loop((['car_engine', 'moto_engine', 'trio_music', 'bike_roll'] as const)[i % 4], { x: i * 3, z: 0 }));
    for (let f = 0; f < 30; f++) { ctx.currentTime += 1 / 60; m.update(1 / 60); }
    expect(FSource.all.filter((s) => s.loop && s.started && !s.stopped && s.buffer && s.buffer.length === 24000).length).toBeLessThanOrEqual(8);
    expect(m.stats().loops.logical).toBe(40);
    // muitas rodadas: os nós vivos voltam a um teto fixo (só fontes nascem/morrem)
    for (let round = 0; round < 20; round++) {
      ctx.currentTime += 2;
      for (const s of FSource.all) if (!s.loop && s.started && !s.stopped) s.stop();
      await Promise.resolve();
      for (let i = 0; i < 100; i++) m.sfx('punch', { x: i % 10, z: 0 });
      m.update(1 / 60);
    }
    await Promise.resolve();
    const persistent = base; // barramentos + cadeias de voz (fixos)
    const sourcesLive = liveNodes - persistent;
    expect(sourcesLive).toBeLessThanOrEqual(24 + 8 + 4 * 2 + 2 + 8); // one-shots + laços + multidão + ambiente + laços em troca
    expect(m.stats().counters.nodesLive).toBeLessThan(200);
    for (const h of hs) h.stop();
    m.update(1 / 60);
    expect(m.stats().loops.logical).toBe(0);
    // som fora do alcance não cria nó
    const before = created;
    m.sfx('step', { x: 500, z: 500 });
    expect(created).toBe(before);
    expect(m.stats().counters.sfxInaudible).toBeGreaterThan(0);
    // silenciar: suspende o contexto
    st.set({ muted: true });
    await new Promise((r) => setTimeout(r, 260));
    expect(ctx.state).toBe('suspended');
    const n0 = created;
    m.sfx('punch', { x: 0, z: 0 });
    expect(created).toBe(n0); // mudo: nada nasce
  });
});

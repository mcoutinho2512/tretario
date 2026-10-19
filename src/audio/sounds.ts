/**
 * Rodada 10 — RECEITAS de todos os sons do jogo (puras). Cada som é GERADO POR CÓDIGO aqui (ruído, osciladores,
 * filtros, envelopes — ver dsp.ts); nenhuma gravação, nenhuma amostra baixada, nenhuma música/canto de torcida/
 * discurso real. Estética de videogame arcade: golpes são "pow/tok/whoosh", sem realismo de ferimento.
 *
 * Chaves:
 *   one-shots    `<id>` (SfxId do contrato) e internos (`step_asphalt`, `surdo`, `shout`…), com variações
 *   laços        `amb_wind`, `amb_city`, `crowd_bed`, motores, `music_trio`, `music_soundcar`, `ir` (reverb)
 *   camadas      `layer:<perfil>` — percussão/palmas PRÓPRIAS por perfil de áudio agregado; a família vem do prefixo
 *                da chave (`torcida_a` → família `torcida`) e a variação (andamento, acentos, palmas) do HASH da
 *                chave inteira — dados, não ramos por grupo
 */
import { Biquad, brownNoise, whiteNoise, burst, fadeEdges, hashStr, hp, lp, bp, normalize, pinkNoise, rng, seamless, softclip, tone, voice, type Rng } from './dsp';

export interface SoundDef {
  dur: number;
  variants: number;
  loop?: boolean;
  rate?: number;
  render(r: Rng, rate: number, v: number): Float32Array;
}

const S = (dur: number, rate: number) => new Float32Array(Math.ceil(dur * rate));
/** soma circular: a cauda depois do fim volta para o começo (laço musical exato, sem cortar o ataque do 1º tempo) */
function wrapAdd(b: Float32Array, len: number): Float32Array {
  const out = b.slice(0, len);
  for (let i = len; i < b.length; i++) out[i % len] += b[i];
  return out;
}
const fin = (b: Float32Array, rate: number, peak = 0.9) => fadeEdges(normalize(b, peak), rate);

// ---------------------------------------------------------------------------------------------- passos e corpo
function step(kind: 'asphalt' | 'sidewalk' | 'grass'): SoundDef {
  return {
    dur: 0.14, variants: 4,
    render(r, rate) {
      const b = S(0.14, rate);
      if (kind === 'grass') {
        burst(b, rate, r, { dur: 0.13, att: 0.012, tau: 0.045, hp: 1400, lp: 6500, gain: 0.8 });
      } else {
        const bright = kind === 'sidewalk' ? 1 : 0;
        burst(b, rate, r, { dur: 0.08, tau: bright ? 0.012 : 0.018, bp: [bright ? 2800 + r() * 800 : 1500 + r() * 600, 1.4], gain: 1 });
        tone(b, rate, { dur: 0.06, f0: 110 + r() * 30, f1: 60, tau: 0.018, gain: 0.5 });
        burst(b, rate, r, { start: 0.02 + r() * 0.015, dur: 0.06, tau: 0.02, hp: 2500, gain: 0.25 }); // raspão
      }
      return fin(b, rate, 0.8);
    },
  };
}

const whooshDef = (f0: number, f1: number, dur: number, zip = 0): SoundDef => ({
  dur, variants: 3,
  render(r, rate) {
    const b = S(dur, rate);
    const n = b.length, f = new Biquad(rate, 'bandpass', f0, 1.8);
    for (let i = 0; i < n; i++) {
      const k = i / n;
      if (i % 32 === 0) f.set(f0 * Math.pow(f1 / f0, Math.sin(Math.PI * k * 0.9)), 1.8);
      b[i] = f.tick(r() * 2 - 1) * Math.sin(Math.PI * k) ** 1.5 * 2;
    }
    if (zip) tone(b, rate, { dur: dur * 0.7, f0: zip, f1: zip * 2.2, wave: 'tri', gain: 0.12, att: 0.01, tau: dur * 0.4 });
    return fin(b, rate, 0.85);
  },
});

/** golpe arcade: "pum" grave que desliza + estalo curto (nada de som de ferimento) */
const hitDef = (f0: number, f1: number, tau: number, snap: number, dur = 0.3, wave: 'sine' | 'square' = 'sine'): SoundDef => ({
  dur, variants: 3,
  render(r, rate) {
    const b = S(dur, rate);
    const j = 1 + (r() - 0.5) * 0.1;
    tone(b, rate, { dur: dur * 0.8, f0: f0 * j, f1: f1 * j, tau, gain: 1, wave });
    burst(b, rate, r, { dur: 0.02, tau: 0.004, hp: 2200, gain: 0.7 });
    burst(b, rate, r, { dur: 0.08, tau: 0.02, bp: [snap, 1.2], gain: 0.6 });
    return fin(softclip(b, 2.2), rate, 0.9);
  },
});

const blip = (notes: [number, number][], w: 'sine' | 'tri' | 'square' = 'tri', gap = 0.06, tau = 0.05): SoundDef => ({
  dur: notes.length * gap + 0.12, variants: 1,
  render(_r, rate) {
    const b = S(notes.length * gap + 0.12, rate);
    notes.forEach(([f0, f1], i) => tone(b, rate, { start: i * gap, dur: 0.11, f0, f1, wave: w, tau, gain: 0.7 }));
    if (w === 'square') lp(b, rate, 1800);
    return fin(b, rate, 0.7);
  },
});

// ---------------------------------------------------------------------------------------------- multidão (one-shots)
const clapPatch = (count: number, dur: number): SoundDef => ({
  dur, variants: 3,
  render(r, rate) {
    const b = S(dur, rate);
    for (let c = 0; c < count; c++) {
      const t = r() * (dur - 0.08), f = 900 + r() * 1400, g = 0.4 + r() * 0.6;
      for (let m = 0; m < 3; m++) burst(b, rate, r, { start: t + m * 0.009, dur: 0.05, tau: m === 2 ? 0.02 : 0.006, bp: [f, 1.6], gain: g });
    }
    return fin(b, rate, 0.85);
  },
});

/** reação genérica de multidão ("êêê"/"ôôô" sem palavra, sem canto): várias vozes sintéticas numa vogal */
const swell = (voices: number, dur: number, att: number, f: [number, number]): SoundDef => ({
  dur, variants: 3,
  render(r, rate) {
    const b = S(dur, rate);
    const vow = Math.floor(r() * 3);
    for (let i = 0; i < voices; i++) {
      const st = r() * 0.15;
      voice(b, rate, r, { start: st, dur: dur - st - 0.05, f0: f[0] + r() * (f[1] - f[0]), vowel: [0, 1, 3][vow], att: att + r() * 0.1, rel: 0.4 + r() * 0.3, glide: (r() - 0.3) * 0.25, gain: 0.5 + r() * 0.5, breath: 0.3 });
    }
    burst(b, rate, r, { dur: dur - 0.05, att, tau: dur * 0.5, lp: 2500, hp: 200, gain: 0.08 });
    return fin(lp(b, rate, 4200), rate, 0.85);
  },
});

/** megafone: "fala" sintética ininteligível (vogais aleatórias, sem idioma) com banda estreita e saturação */
const megaphone: SoundDef = {
  dur: 1.8, variants: 3,
  render(r, rate) {
    const b = S(1.8, rate);
    let t = 0.02;
    while (t < 1.6) {
      const d = 0.25 + r() * 0.45;
      voice(b, rate, r, { start: t, dur: Math.min(d, 1.75 - t), f0: 120 + r() * 50, syl: 4.5 + r() * 2, glide: (r() - 0.5) * 0.3, att: 0.01, rel: 0.05, breath: 0.08 });
      t += d + 0.05 + r() * 0.12;
    }
    hp(b, rate, 500); lp(b, rate, 3000); normalize(b, 1);
    softclip(b, 3.5);
    new Biquad(rate, 'peak', 1800, 2, 6).run(b);
    return fin(b, rate, 0.75);
  },
};

const whistle: SoundDef = {
  dur: 0.6, variants: 3,
  render(r, rate) {
    const b = S(0.6, rate);
    const f = 2700 + r() * 500, d = 0.25 + r() * 0.3;
    tone(b, rate, { dur: d, f0: f, wave: 'sine', att: 0.015, gain: 0.8, vib: [22 + r() * 8, 140] });
    burst(b, rate, r, { dur: d, att: 0.015, bp: [f, 4], gain: 0.25 });
    if (r() < 0.5) tone(b, rate, { start: d + 0.06, dur: 0.12, f0: f, att: 0.01, gain: 0.7, vib: [25, 140] });
    return fin(b, rate, 0.7);
  },
};

const surdo: SoundDef = {
  dur: 0.6, variants: 2,
  render(r, rate) {
    const b = S(0.6, rate);
    tone(b, rate, { dur: 0.55, f0: 85 + r() * 10, f1: 52, tau: 0.22, gain: 1 });
    burst(b, rate, r, { dur: 0.05, tau: 0.01, lp: 900, gain: 0.4 });
    return fin(softclip(b, 1.4), rate, 0.9);
  },
};

// ---------------------------------------------------------------------------------------------- veículos (one-shots)
const door: SoundDef = {
  dur: 0.35, variants: 2,
  render(r, rate) {
    const b = S(0.35, rate);
    tone(b, rate, { dur: 0.25, f0: 95, f1: 55, tau: 0.05, gain: 1 });
    burst(b, rate, r, { dur: 0.12, tau: 0.03, lp: 1200, gain: 0.7 });
    burst(b, rate, r, { start: 0.035, dur: 0.03, tau: 0.004, hp: 3000, gain: 0.35 }); // trinco
    return fin(b, rate, 0.85);
  },
};
const mount: SoundDef = {
  dur: 0.3, variants: 2,
  render(r, rate) {
    const b = S(0.3, rate);
    burst(b, rate, r, { dur: 0.02, tau: 0.003, bp: [3800, 5], gain: 0.8 });
    burst(b, rate, r, { start: 0.09, dur: 0.02, tau: 0.003, bp: [3200, 5], gain: 0.6 });
    burst(b, rate, r, { start: 0.02, dur: 0.22, att: 0.03, tau: 0.06, bp: [2200, 1], gain: 0.3 });
    return fin(b, rate, 0.7);
  },
};
const brake: SoundDef = {
  dur: 0.55, variants: 2,
  render(r, rate) {
    const b = S(0.55, rate);
    const f = 1500 + r() * 600;
    tone(b, rate, { dur: 0.5, f0: f, f1: f * 0.92, wave: 'tri', att: 0.06, tau: 0.25, gain: 0.25, vib: [9, 25] });
    burst(b, rate, r, { dur: 0.5, att: 0.04, tau: 0.2, bp: [f * 1.3, 2], gain: 0.4 });
    burst(b, rate, r, { dur: 0.45, att: 0.02, tau: 0.18, lp: 600, gain: 0.4 }); // rolagem/arrasto
    return fin(b, rate, 0.7);
  },
};
const horn: SoundDef = {
  dur: 0.5, variants: 1,
  render(_r, rate) {
    const b = S(0.5, rate);
    tone(b, rate, { dur: 0.45, f0: 415, wave: 'square', att: 0.015, gain: 0.5 });
    tone(b, rate, { dur: 0.45, f0: 520, wave: 'square', att: 0.015, gain: 0.45 });
    lp(b, rate, 1900);
    return fin(softclip(b, 1.5), rate, 0.7);
  },
};
const bell: SoundDef = {
  dur: 0.9, variants: 1,
  render(_r, rate) {
    const b = S(0.9, rate);
    for (const st of [0, 0.16]) for (const [f, g, tau] of [[2350, 0.6, 0.35], [3870, 0.3, 0.2], [5400, 0.15, 0.1], [1180, 0.2, 0.4]] as const) tone(b, rate, { start: st, dur: 0.7, f0: f, gain: g, tau, att: 0.001 });
    return fin(b, rate, 0.65);
  },
};

// ---------------------------------------------------------------------------------------------- laços: motores
function engine(fire: number, opts: { harm: number[]; lp: number; rasp: number; uneven?: number; hum?: number }): SoundDef {
  return {
    dur: 1, variants: 1, loop: true, rate: 22050,
    render(r, rate) {
      const len = rate, b = new Float32Array(len + Math.floor(0.2 * rate));
      for (let c = 0; c < fire; c++) {
        const t = (c + (opts.uneven && c % 2 ? opts.uneven : 0)) / fire;
        const a = 0.75 + r() * 0.25;
        opts.harm.forEach((h, i) => tone(b, rate, { start: t, dur: 0.06, f0: fire * h, tau: 0.012 / (1 + i * 0.4), gain: a / (1 + i) }));
        burst(b, rate, r, { start: t, dur: 0.03, tau: 0.008, lp: opts.lp, gain: opts.rasp * a });
      }
      if (opts.hum) tone(b, rate, { dur: 1.2, f0: opts.hum, gain: 0.25 });
      const out = wrapAdd(b, len);
      lp(out, rate, opts.lp);
      return normalize(softclip(out, 1.3), 0.8);
    },
  };
}
const scooterMotor: SoundDef = {
  dur: 1, variants: 1, loop: true, rate: 22050,
  render(r, rate) {
    const len = rate, b = new Float32Array(len);
    for (const [f, g] of [[440, 0.5], [880, 0.22], [1320, 0.08], [2200, 0.05], [100, 0.18]] as const) tone(b, rate, { dur: 1, f0: f, gain: g, att: 0.0001 });
    const n = pinkNoise(len, r); hp(n, rate, 800);
    for (let i = 0; i < len; i++) b[i] += n[i] * 0.05;
    return normalize(b, 0.7);
  },
};
const bikeRoll: SoundDef = {
  dur: 1, variants: 1, loop: true, rate: 22050,
  render(r, rate) {
    const len = rate, b = new Float32Array(len + Math.floor(0.05 * rate));
    const n = pinkNoise(len, r); bp(n, rate, 600, 0.6);
    for (let i = 0; i < len; i++) b[i] = n[i] * 0.6;
    const ticks = 14;
    for (let k = 0; k < ticks; k++) burst(b, rate, r, { start: (k + (r() - 0.5) * 0.2) / ticks + 0.01, dur: 0.012, tau: 0.002, hp: 3200, gain: 0.5 });
    return normalize(wrapAdd(b, len), 0.6);
  },
};

// ---------------------------------------------------------------------------------------------- laços: música própria
/** batida própria (4 compassos): bumbo, palma, chimbal, baixo e acordes curtos, gerados a partir de uma semente */
function music(o: { bpm: number; root: number; prog: number[]; minor: boolean; style: 'trio' | 'marcha' }): SoundDef {
  const step = 60 / o.bpm / 4, bars = 4, len = step * 16 * bars;
  return {
    dur: len, variants: 1, loop: true, rate: 22050,
    render(r, rate) {
      const N = Math.floor(len * rate), b = new Float32Array(N + Math.floor(0.6 * rate));
      const third = o.minor ? 3 : 4;
      for (let s = 0; s < 16 * bars; s++) {
        const t = s * step, beat = s % 16, bar = Math.floor(s / 16), root = o.root * Math.pow(2, o.prog[bar % o.prog.length] / 12);
        if (beat % 4 === 0) { tone(b, rate, { start: t, dur: 0.3, f0: 150, f1: 46, tau: 0.11, gain: 0.95 }); burst(b, rate, r, { start: t, dur: 0.01, tau: 0.002, hp: 1500, gain: 0.25 }); }
        if (beat === 4 || beat === 12) for (let m = 0; m < 3; m++) burst(b, rate, r, { start: t + m * 0.008, dur: 0.12, tau: m === 2 ? 0.05 : 0.006, bp: [1400, 1.2], gain: 0.5 });
        if (beat % 2 === 0) burst(b, rate, r, { start: t, dur: 0.04, tau: beat % 4 === 2 ? 0.02 : 0.01, hp: 6500, gain: beat % 4 === 2 ? 0.28 : 0.12 });
        // baixo: trio = sincopado; marcha = tônica/quinta nas colcheias
        const bassHit = o.style === 'trio' ? [0, 3, 6, 8, 10, 11, 14].includes(beat) : beat % 2 === 0;
        if (bassHit) {
          const f = o.style === 'marcha' && beat % 4 === 2 ? root * 1.5 : root;
          tone(b, rate, { start: t, dur: step * 1.6, f0: f, wave: 'saw', tau: 0.12, gain: 0.45 });
        }
        if (o.style === 'trio' ? beat % 4 === 2 : beat % 8 === 4) for (const iv of [12, 12 + third, 19]) tone(b, rate, { start: t, dur: step * 0.9, f0: root * Math.pow(2, iv / 12), wave: 'square', tau: 0.05, gain: 0.08 });
        if (o.style === 'marcha' && bar >= 2) { const arp = [12, 12 + third, 19, 24][beat % 4]; tone(b, rate, { start: t, dur: step * 0.9, f0: root * Math.pow(2, (arp + 12) / 12), wave: 'tri', tau: 0.06, gain: 0.07 }); }
      }
      const out = wrapAdd(b, N);
      const f = new Biquad(rate, 'lowpass', 5200); f.run(out);
      return normalize(softclip(out, 1.25), 0.85);
    },
  };
}

// ---------------------------------------------------------------------------------------------- laços: ambiente e multidão
const wind: SoundDef = {
  dur: 12, variants: 1, loop: true, rate: 16000,
  render(r, rate) {
    const n = Math.floor(12.5 * rate), b = pinkNoise(n, r);
    lp(b, rate, 420);
    const g = pinkNoise(n, r); bp(g, rate, 950, 0.8);
    const ph = [r(), r(), r()].map((x) => x * Math.PI * 2);
    for (let i = 0; i < n; i++) {
      const t = i / rate;
      // modulação com períodos que dividem 12 s (laço exato) + emenda cruzada
      const am = 0.55 + 0.25 * Math.sin((2 * Math.PI * t) / 12 + ph[0]) + 0.15 * Math.sin((2 * Math.PI * t) / 4 + ph[1]) + 0.05 * Math.sin((2 * Math.PI * t) / 1.5 + ph[2]);
      const gust = Math.max(0, Math.sin((2 * Math.PI * t) / 6 + ph[1])) ** 3;
      b[i] = b[i] * am + g[i] * gust * 0.25;
    }
    return normalize(seamless(b, Math.floor(0.5 * rate)), 0.6);
  },
};
const city: SoundDef = {
  dur: 12, variants: 1, loop: true, rate: 16000,
  render(r, rate) {
    const n = Math.floor(12.5 * rate), b = brownNoise(n, r);
    lp(b, rate, 170);
    const hiss = pinkNoise(n, r); bp(hiss, rate, 700, 0.6);
    for (let i = 0; i < n; i++) { const t = i / rate; b[i] += hiss[i] * (0.18 + 0.08 * Math.sin((2 * Math.PI * t) / 3)); }
    // murmúrio distante e batidas longe (cidade viva, abafada)
    const mur = new Float32Array(n);
    for (let k = 0; k < 6; k++) voice(mur, rate, r, { start: r() * 10, dur: 1 + r() * 1.5, f0: 110 + r() * 120, syl: 4, gain: 0.25, breath: 0.4 });
    lp(mur, rate, 700);
    for (let i = 0; i < n; i++) b[i] += mur[i] * 0.5;
    for (let k = 0; k < 4; k++) tone(b, rate, { start: r() * 11.5, dur: 0.3, f0: 70 + r() * 40, f1: 45, tau: 0.08, gain: 0.12 });
    return normalize(seamless(b, Math.floor(0.5 * rate)), 0.6);
  },
};
const crowdBed: SoundDef = {
  dur: 8, variants: 1, loop: true, rate: 22050,
  render(r, rate) {
    const n = Math.floor(8.5 * rate), b = new Float32Array(n);
    for (let v = 0; v < 14; v++) {
      let t = r() * 0.6;
      while (t < 8.3) {
        const d = 0.35 + r() * 1.1;
        voice(b, rate, r, { start: t, dur: Math.min(d, 8.45 - t), f0: 100 + r() * 180, syl: 3 + r() * 3, gain: 0.25 + r() * 0.3, breath: 0.25, att: 0.05, rel: 0.1 });
        t += d + 0.1 + r() * 0.9;
      }
    }
    const m = pinkNoise(n, r); bp(m, rate, 500, 0.5);
    for (let i = 0; i < n; i++) b[i] += m[i] * 0.35;
    // passos e roupa da massa (textura)
    for (let k = 0; k < 40; k++) burst(b, rate, r, { start: r() * 8.3, dur: 0.06, tau: 0.015, bp: [1200 + r() * 1500, 1.2], gain: 0.08 });
    lp(b, rate, 3600);
    return normalize(seamless(b, Math.floor(0.5 * rate)), 0.7);
  },
};
const ir: SoundDef = {
  dur: 1.4, variants: 2, rate: 16000,
  render(r, rate) {
    const n = Math.floor(1.4 * rate), b = whiteNoise(n, r);
    const f = new Biquad(rate, 'lowpass', 7000);
    for (let i = 0; i < n; i++) {
      const t = i / rate;
      if (i % 64 === 0) f.set(7000 * Math.exp(-t * 2.2) + 300);
      b[i] = f.tick(b[i]) * Math.exp(-t / 0.38) * (i < rate * 0.012 ? 0 : 1); // pré-atraso curto (prédios)
    }
    return normalize(b, 0.5);
  },
};

// ---------------------------------------------------------------------------------------------- camadas por perfil
/** famílias de camada (percussão e palmas próprias); perfis sem família conhecida = só o murmúrio */
export const LAYER_FAMILIES = ['manifestacao', 'torcida', 'show'] as const;
export const layerFamily = (profile: string) => (LAYER_FAMILIES as readonly string[]).includes(profile.split('_')[0]) ? profile.split('_')[0] : null;

function layerDef(profile: string): SoundDef | null {
  const fam = layerFamily(profile);
  if (!fam) return null;
  const seed = hashStr(profile);
  const pr = rng(seed);
  const bpm = fam === 'torcida' ? 116 + Math.floor(pr() * 24) : fam === 'manifestacao' ? 92 + Math.floor(pr() * 10) : 108 + Math.floor(pr() * 8);
  const step = 60 / bpm / 4, bars = 2, len = step * 16 * bars;
  // padrões vindos da semente (repetidos a cada compasso: ritmo coerente, diferente entre perfis)
  const caixaAcc = Array.from({ length: 16 }, () => pr() < 0.35);
  const palmas = Array.from({ length: 16 }, (_, i) => (i % 4 === 0 ? pr() < 0.6 : pr() < 0.18));
  const repique = Array.from({ length: 16 }, () => pr() < 0.2);
  return {
    dur: len, variants: 1, loop: true, rate: 22050,
    render(r, rate) {
      const N = Math.floor(len * rate), b = new Float32Array(N + Math.floor(0.7 * rate));
      for (let s = 0; s < 16 * bars; s++) {
        const t = s * step + (r() - 0.5) * 0.006, beat = s % 16;
        const clap = (g: number) => { for (let m = 0; m < 3; m++) burst(b, rate, r, { start: t + m * 0.009 + r() * 0.01, dur: 0.08, tau: m === 2 ? 0.025 : 0.006, bp: [1100 + r() * 700, 1.3], gain: g }); };
        if (fam === 'show') {
          if (beat === 4 || beat === 12) { clap(0.8); clap(0.6); }
          if (beat % 8 === 0) tone(b, rate, { start: t, dur: 0.25, f0: 90, f1: 50, tau: 0.08, gain: 0.5 });
          continue;
        }
        const strong = fam === 'torcida' ? beat === 4 || beat === 12 : beat === 0;
        const soft = fam === 'torcida' ? beat === 0 || beat === 8 : beat === 8 || beat === 14;
        if (strong) tone(b, rate, { start: t, dur: 0.5, f0: 80, f1: 50, tau: 0.2, gain: 0.95 });
        if (soft) tone(b, rate, { start: t, dur: 0.4, f0: 95, f1: 62, tau: 0.14, gain: 0.55 });
        const caixa = fam === 'torcida' ? true : beat % 2 === 0;
        if (caixa) burst(b, rate, r, { start: t, dur: 0.06, tau: caixaAcc[beat] ? 0.022 : 0.01, bp: [2600, 0.9], gain: caixaAcc[beat] ? 0.35 : 0.13 });
        if (fam === 'torcida' && repique[beat]) tone(b, rate, { start: t, dur: 0.12, f0: 330, f1: 280, tau: 0.04, gain: 0.3 });
        if (palmas[beat]) clap(fam === 'torcida' ? 0.45 : 0.35);
      }
      const out = wrapAdd(b, N);
      lp(out, rate, 6000);
      return normalize(softclip(out, 1.2), 0.85);
    },
  };
}

// ---------------------------------------------------------------------------------------------- catálogo
export const SOUNDS: Record<string, SoundDef> = {
  step_asphalt: step('asphalt'), step_sidewalk: step('sidewalk'), step_grass: step('grass'),
  jump: whooshDef(500, 1600, 0.2),
  land: hitDef(75, 42, 0.05, 700, 0.3),
  punch: hitDef(190, 70, 0.045, 1300, 0.25),
  kick: hitDef(140, 48, 0.07, 900, 0.32),
  whoosh: whooshDef(450, 2600, 0.24),
  dodge: whooshDef(1100, 4200, 0.17, 650),
  impact: hitDef(230, 55, 0.08, 1800, 0.38, 'square'),
  fall: { dur: 0.6, variants: 2, render(r, rate) { const b = S(0.6, rate); tone(b, rate, { dur: 0.4, f0: 65, f1: 36, tau: 0.1, gain: 1 }); burst(b, rate, r, { dur: 0.2, tau: 0.06, lp: 600, gain: 0.6 }); tone(b, rate, { start: 0.13, dur: 0.3, f0: 55, f1: 38, tau: 0.07, gain: 0.5 }); burst(b, rate, r, { start: 0.05, dur: 0.4, att: 0.03, tau: 0.12, bp: [2400, 1], gain: 0.15 }); return fin(b, rate, 0.85); } },
  getup: { dur: 0.5, variants: 2, render(r, rate) { const b = S(0.5, rate); burst(b, rate, r, { dur: 0.45, att: 0.08, tau: 0.15, bp: [2300, 0.9], gain: 0.5 }); burst(b, rate, r, { start: 0.3, dur: 0.1, tau: 0.02, bp: [1600, 1.4], gain: 0.4 }); return fin(b, rate, 0.6); } },
  bat: { dur: 0.32, variants: 2, render(r, rate) { const b = S(0.32, rate); tone(b, rate, { dur: 0.2, f0: 620 + r() * 60, f1: 560, tau: 0.035, gain: 0.8 }); burst(b, rate, r, { dur: 0.1, tau: 0.02, bp: [950, 8], gain: 1.2 }); tone(b, rate, { dur: 0.2, f0: 150, f1: 60, tau: 0.04, gain: 0.6 }); return fin(softclip(b, 1.6), rate, 0.9); } },
  bar: { dur: 0.7, variants: 2, render(r, rate) { const b = S(0.7, rate); const k = 1 + (r() - 0.5) * 0.06; for (const [f, g, tau] of [[520, 0.5, 0.25], [1340, 0.35, 0.15], [2210, 0.2, 0.1], [3170, 0.1, 0.06]] as const) tone(b, rate, { dur: 0.65, f0: f * k, gain: g, tau }); tone(b, rate, { dur: 0.2, f0: 160, f1: 60, tau: 0.04, gain: 0.6 }); return fin(softclip(b, 1.4), rate, 0.8); } },
  spray: { dur: 0.45, variants: 2, render(r, rate) { const b = S(0.45, rate); burst(b, rate, r, { dur: 0.4, att: 0.02, tau: 0.25, hp: 3200, lp: 9000, gain: 0.9 }); return fin(b, rate, 0.6); } },
  push: { dur: 0.28, variants: 2, render(r, rate) { const b = S(0.28, rate); tone(b, rate, { dur: 0.15, f0: 110, f1: 60, tau: 0.04, gain: 0.8 }); burst(b, rate, r, { dur: 0.2, att: 0.02, tau: 0.06, sweep: [600, 1800], gain: 0.5 }); return fin(b, rate, 0.75); } },
  blocked: blip([[880, 880], [620, 600]], 'square', 0.055, 0.04),
  pickup: blip([[620, 940], [1250, 1250]], 'tri', 0.06, 0.05),
  drop: { dur: 0.25, variants: 1, render(r, rate) { const b = S(0.25, rate); tone(b, rate, { dur: 0.12, f0: 520, f1: 260, wave: 'tri', tau: 0.05, gain: 0.5 }); tone(b, rate, { start: 0.06, dur: 0.15, f0: 110, f1: 60, tau: 0.04, gain: 0.6 }); burst(b, rate, r, { start: 0.06, dur: 0.05, tau: 0.01, lp: 1500, gain: 0.3 }); return fin(b, rate, 0.7); } },
  ui_click: { dur: 0.05, variants: 1, render(r, rate) { const b = S(0.05, rate); tone(b, rate, { dur: 0.03, f0: 2100, f1: 1800, tau: 0.005, gain: 0.6 }); burst(b, rate, r, { dur: 0.01, tau: 0.002, hp: 4000, gain: 0.3 }); return fin(b, rate, 0.5); } },
  ui_open: blip([[660, 660], [990, 990]], 'tri', 0.055, 0.04),
  ui_close: blip([[990, 990], [660, 660]], 'tri', 0.055, 0.04),
  ui_denied: blip([[200, 190], [180, 170]], 'square', 0.08, 0.06),
  ui_ok: { dur: 0.45, variants: 1, render(_r, rate) { const b = S(0.45, rate); tone(b, rate, { dur: 0.4, f0: 1320, tau: 0.12, gain: 0.5 }); tone(b, rate, { start: 0.05, dur: 0.38, f0: 1980, tau: 0.12, gain: 0.35 }); return fin(b, rate, 0.6); } },
  veh_door: door, veh_mount: mount, veh_brake: brake, veh_horn: horn, bike_bell: bell,
  bike_brake: { dur: 0.35, variants: 1, render(r, rate) { const b = S(0.35, rate); burst(b, rate, r, { dur: 0.3, att: 0.02, tau: 0.1, bp: [3300, 3], gain: 0.5 }); return fin(b, rate, 0.45); } },
  whistle, clap: clapPatch(14, 0.7), cheer: swell(16, 1.8, 0.25, [170, 330]), megaphone,
  shout: swell(6, 0.8, 0.06, [180, 320]), surdo,
  // laços
  amb_wind: wind, amb_city: city, crowd_bed: crowdBed, ir,
  car_engine: engine(30, { harm: [2, 4, 6], lp: 800, rasp: 0.5, hum: 30 }),
  moto_engine: engine(48, { harm: [1, 2, 3, 5], lp: 2000, rasp: 0.8, uneven: 0.12 }),
  scooter_motor: scooterMotor, bike_roll: bikeRoll,
  trio_music: music({ bpm: 124, root: 55, prog: [0, 8, 3, 10], minor: true, style: 'trio' }),
  soundcar_music: music({ bpm: 100, root: 73.42, prog: [0, 5, 7, 5], minor: false, style: 'marcha' }),
};

/** definição de uma chave (inclui `layer:<perfil>`; null = sem som para essa chave) */
const layerCache = new Map<string, SoundDef | null>();
export function soundDef(key: string): SoundDef | null {
  if (key.startsWith('layer:')) {
    const p = key.slice(6);
    if (!layerCache.has(p)) layerCache.set(p, layerDef(p));
    return layerCache.get(p)!;
  }
  return SOUNDS[key] ?? null;
}

export const DEFAULT_RATE = 24000;
/** renderiza uma variação (determinística pela chave + variação) */
export function renderSound(key: string, variant = 0): { data: Float32Array; rate: number; loop: boolean } | null {
  const d = soundDef(key);
  if (!d) return null;
  const rate = d.rate ?? DEFAULT_RATE;
  const data = d.render(rng(hashStr(key) + variant * 7919), rate, variant);
  return { data, rate, loop: !!d.loop };
}

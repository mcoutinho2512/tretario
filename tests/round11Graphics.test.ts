/**
 * Rodada 11 — gráficos, ajustes, escala da interface e HUD desktop (partes puras):
 * presets (ALTO ≥ MÉDIO campo a campo; ULTRA ≥ ALTO), o que só muda ao recarregar, limite de FPS ao vivo,
 * escala da interface (valores válidos / clamp / persistência), detecção sem penalizar o Safari, abas do painel e o
 * canal de ação bloqueada.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PRESETS, mobileAdjust, reloadOnlyChanges, type QualityPreset } from '../src/core/settings';
import { FrameGovernor } from '../src/core/frameGovernor';
import { parseFpsChoice, resolveFpsLimit } from '../src/core/fpsChoice';
import { UI_SCALES, _resetUiPrefs, clampUiScale, parseUiPrefs, setUiPrefs, uiPrefs, onUiPrefs } from '../src/ui/uiPrefs';
import { profileDevice } from '../src/core/device';
import { SETTINGS_TABS, TAB_LABEL, hasControlsOpener, nextTab, openControls, openSettings, parseTab, registerSettingsOpener, setControlsOpener } from '../src/ui/settingsApi';
import { _resetNotify, notifyBlocked, setBlockedSink } from '../src/ui/notify';

/** campos em que "mais" = mais qualidade (e mais custo) */
const MORE: (keyof QualityPreset)[] = ['pixelRatio', 'shadowMapSize', 'shadowDistance', 'vegetationDensity', 'propsDistance', 'fogFar', 'cameraFar', 'pedestrians', 'pedestrianRadius', 'billboardDistance', 'npcShadowDistance', 'anisotropy'];
const aa = (p: QualityPreset) => p.antialias || p.postAA || p.msaaSamples > 0;

describe('presets — rodada 11', () => {
  it('ALTO ≥ MÉDIO ≥ BAIXO em cada campo relevante (e ALTO tem AO + AA)', () => {
    const { low, medium, high } = PRESETS;
    for (const k of MORE) {
      expect(high[k] as number, `ALTO.${k}`).toBeGreaterThanOrEqual(medium[k] as number);
      expect(medium[k] as number, `MÉDIO.${k}`).toBeGreaterThanOrEqual(low[k] as number);
    }
    for (let i = 0; i < 3; i++) expect(high.lodDistances[i]).toBeGreaterThanOrEqual(medium.lodDistances[i]);
    expect(high.ambientOcclusion).toBe(true);
    expect(medium.ambientOcclusion).toBe(false);
    expect(aa(high) && aa(medium)).toBe(true);
    expect(aa(low)).toBe(false);
    // o ALTO é visivelmente outro patamar: sombra 2× mais resolvida, ~1,5× o alcance, ~1,7× os pedestres
    expect(high.shadowMapSize).toBeGreaterThanOrEqual(medium.shadowMapSize * 2);
    expect(high.shadowDistance).toBeGreaterThanOrEqual(medium.shadowDistance * 1.5);
    expect(high.pedestrians).toBeGreaterThanOrEqual(medium.pedestrians * 1.7);
  });
  it('ULTRA (mantido: diferença visível medida — sombra longe, MSAA, multidão distante) ≥ ALTO em tudo', () => {
    const { high, ultra } = PRESETS;
    for (const k of MORE) expect(ultra[k] as number, `ULTRA.${k}`).toBeGreaterThanOrEqual(high[k] as number);
    for (let i = 0; i < 3; i++) expect(ultra.lodDistances[i]).toBeGreaterThanOrEqual(high.lodDistances[i]);
    expect(ultra.ambientOcclusion).toBe(true);
    expect(ultra.msaaSamples).toBe(4);
  });
  it('celular nunca recebe MSAA no HDR nem anisotropia alta', () => {
    for (const p of Object.values(PRESETS)) {
      const m = mobileAdjust(p);
      expect(m.msaaSamples).toBe(0);
      expect(m.anisotropy).toBeLessThanOrEqual(4);
    }
  });
  it('só ao recarregar: suavização nativa quando o preset desenha direto no canvas; fachadas já construídas', () => {
    const { low, medium, high, ultra } = PRESETS;
    expect(reloadOnlyChanges(high, medium)).toContain('suavização de bordas (MSAA)'); // contexto criado sem MSAA
    expect(reloadOnlyChanges(medium, high)).toEqual([]); // ALTO usa o pós-processamento: o MSAA do canvas não importa
    expect(reloadOnlyChanges(high, ultra)).toEqual([]);
    expect(reloadOnlyChanges(medium, low).join()).toMatch(/fachadas/);
    expect(reloadOnlyChanges(medium, low).join()).toMatch(/desligar a suavização/);
    expect(reloadOnlyChanges(low, low)).toEqual([]);
  });
});

describe('limite de FPS — rodada 11', () => {
  it('30 / 60 / sem limite: escolha, aparelho e URL', () => {
    expect(resolveFpsLimit('auto', 60)).toBe(60);
    expect(resolveFpsLimit('auto', 30)).toBe(30);
    expect(resolveFpsLimit('30', 60)).toBe(30);
    expect(resolveFpsLimit('unlimited', 30)).toBe(0);
    expect(resolveFpsLimit('unlimited', 60, '60')).toBe(60); // ?fps= vence (testes)
    expect(resolveFpsLimit('60', 60, '0')).toBe(0);
    expect(parseFpsChoice('lixo')).toBe('auto');
    expect(parseFpsChoice('unlimited')).toBe('unlimited');
  });
  it('sem limite renderiza em todo requestAnimationFrame (taxa do monitor), sem pular quadros', () => {
    const g = new FrameGovernor(0, false);
    let n = 0;
    for (let i = 0; i < 144; i++) if (g.shouldRender(i * 6.944)) n++; // tela de 144 Hz
    expect(n).toBe(144);
    expect(g.limit).toBe(0);
    expect(g.targetFps).toBe(60); // a resolução dinâmica defende 60
  });
  it('troca ao vivo: 60 → 30 → sem limite numa tela de 120 Hz', () => {
    const g = new FrameGovernor(60, false);
    const count = (from: number) => { let n = 0; for (let i = 0; i < 120; i++) if (g.shouldRender(from + i * 8.333)) n++; return n; };
    expect(count(0)).toBe(60);
    g.setLimit(30);
    expect(g.limit).toBe(30);
    expect(count(2000)).toBeGreaterThanOrEqual(29);
    expect(count(4000)).toBeLessThanOrEqual(31);
    g.setLimit(0);
    expect(count(6000)).toBe(120);
  });
  it('resolução dinâmica continua valendo sem limite (orçamento de 60 FPS)', () => {
    const g = new FrameGovernor(0, true);
    for (let i = 0; i < 120; i++) g.onFrame(30, null); // ~33 FPS por 3,6 s
    expect(g.scale).toBeLessThan(1);
  });
});

describe('escala da interface — rodada 11', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); }, clear: () => store.clear(), key: () => null, length: 0,
    } as Storage;
    _resetUiPrefs();
  });
  afterEach(() => { delete (globalThis as unknown as { localStorage?: Storage }).localStorage; _resetUiPrefs(); });

  it('valores válidos e clamp para a escala mais próxima', () => {
    expect([...UI_SCALES]).toEqual([80, 90, 100, 110, 125]);
    for (const s of UI_SCALES) expect(clampUiScale(s)).toBe(s);
    expect(clampUiScale(50)).toBe(80);
    expect(clampUiScale(300)).toBe(125);
    expect(clampUiScale(104)).toBe(100);
    expect(clampUiScale(118)).toBe(125);
    expect(clampUiScale('110%')).toBe(110);
    expect(clampUiScale(1.1)).toBe(110); // fator
    expect(clampUiScale('abc')).toBe(100);
    expect(clampUiScale(undefined)).toBe(100);
    expect(parseUiPrefs({ scale: 'x', reduceMotion: 'sim' }, true)).toEqual({ scale: 100, reduceMotion: true });
  });
  it('persiste no navegador e avisa quem escuta (sem storage: segue em memória)', () => {
    expect(uiPrefs()).toEqual({ scale: 100, reduceMotion: false });
    const seen: number[] = [];
    onUiPrefs((p) => seen.push(p.scale));
    setUiPrefs({ scale: 125 });
    setUiPrefs({ scale: 125 }); // igual: não avisa de novo
    expect(seen).toEqual([125]);
    expect(JSON.parse(store.get('pv3d.ui')!)).toEqual({ scale: 125, reduceMotion: false });
    _resetUiPrefs();
    expect(uiPrefs().scale).toBe(125); // relido do armazenamento
    store.set('pv3d.ui', '{"scale":97,"reduceMotion":true}');
    _resetUiPrefs();
    expect(uiPrefs()).toEqual({ scale: 100, reduceMotion: true });
    store.set('pv3d.ui', 'não é json');
    _resetUiPrefs();
    expect(uiPrefs().scale).toBe(100);
  });
});

describe('detecção — rodada 11 (capacidades reais, sem penalizar o Safari)', () => {
  const macSafari = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
  const macChrome = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0 Safari/537.36';
  const win = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
  const winFirefox = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:135.0) Gecko/20100101 Firefox/135.0';
  const caps = { maxTextureSize: 16384, floatColorBuffer: true };

  it('o navegador não muda o preset: mesma máquina no Safari e no Chrome', () => {
    const s = profileDevice({ ua: macSafari, maxTouchPoints: 0, gpu: 'Apple GPU', caps });
    const c = profileDevice({ ua: macChrome, maxTouchPoints: 0, gpu: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M3, Unspecified Version)', caps });
    expect(s.recommended).toBe(c.recommended);
    expect(s.recommended).toBe('high');
    // Safari não informa deviceMemory: ausência não penaliza
    expect(s.memoryGB).toBeNull();
  });
  it('o automático nunca escolhe ULTRA (opção manual)', () => {
    for (const gpu of ['ANGLE (Apple, ANGLE Metal Renderer: Apple M5 Max)', 'NVIDIA GeForce RTX 4090/PCIe/SSE2', 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4080 Direct3D11)']) {
      expect(profileDevice({ ua: win, maxTouchPoints: 0, gpu, deviceMemory: 32, caps }).recommended).toBe('high');
    }
  });
  it('capacidades reais limitam: textura pequena ou sem alvo HDR → teto', () => {
    expect(profileDevice({ ua: win, maxTouchPoints: 0, gpu: 'NVIDIA GeForce RTX 3060', caps: { maxTextureSize: 4096, floatColorBuffer: true } }).recommended).toBe('medium');
    expect(profileDevice({ ua: win, maxTouchPoints: 0, gpu: 'NVIDIA GeForce RTX 3060', caps: { maxTextureSize: 2048 } }).recommended).toBe('low');
    const nf = profileDevice({ ua: win, maxTouchPoints: 0, gpu: 'NVIDIA GeForce RTX 3060', caps: { maxTextureSize: 16384, floatColorBuffer: false } });
    expect(nf.recommended).toBe('medium');
    expect(nf.reason).toMatch(/ponto flutuante/);
    // sem medir (capacidades ausentes) não penaliza
    expect(profileDevice({ ua: win, maxTouchPoints: 0, gpu: 'NVIDIA GeForce RTX 3060' }).recommended).toBe('high');
  });
  it('nome escondido fora do Mac (Firefox resistFingerprinting) → MÉDIO pelas capacidades, com resolução dinâmica', () => {
    const f = profileDevice({ ua: winFirefox, maxTouchPoints: 0, gpu: 'Mozilla', caps });
    expect(f.gpuClass).toBe('masked');
    expect(f.recommended).toBe('medium');
    expect(f.dynamicResolution).toBe(true);
  });
});

describe('painel de ajustes — abas e contratos (rodada 11)', () => {
  afterEach(() => { registerSettingsOpener(null); setControlsOpener(null); });
  it('cinco abas na ordem, com rótulos em português', () => {
    expect([...SETTINGS_TABS]).toEqual(['geral', 'audio', 'graficos', 'interface', 'controles']);
    expect(SETTINGS_TABS.map((t) => TAB_LABEL[t])).toEqual(['Geral', 'Áudio', 'Gráficos', 'Interface', 'Controles']);
    expect(parseTab('graficos')).toBe('graficos');
    expect(parseTab('xyz')).toBe('geral');
  });
  it('teclado: setas circulam, Home/End nas pontas, outras teclas não mexem', () => {
    expect(nextTab('geral', 'ArrowRight')).toBe('audio');
    expect(nextTab('geral', 'ArrowLeft')).toBe('controles');
    expect(nextTab('controles', 'ArrowRight')).toBe('geral');
    expect(nextTab('audio', 'End')).toBe('controles');
    expect(nextTab('interface', 'Home')).toBe('geral');
    expect(nextTab('audio', 'a')).toBeNull();
  });
  it('openSettings abre a aba pedida; Controles delega para a tela registrada', () => {
    expect(openSettings('audio')).toBe(false); // painel ainda não montado
    const opened: string[] = [];
    registerSettingsOpener((t) => opened.push(t));
    expect(openSettings('graficos')).toBe(true);
    expect(openSettings('controles')).toBe(true);
    expect(opened).toEqual(['graficos', 'controles']);
    expect(hasControlsOpener()).toBe(false);
    expect(openControls()).toBe(false);
    let n = 0;
    setControlsOpener(() => { n++; });
    expect(openControls()).toBe(true);
    expect(n).toBe(1);
  });
});

describe('ação bloqueada — notifyBlocked (rodada 11)', () => {
  afterEach(() => _resetNotify());
  it('chega ao HUD; a mesma frase repetida em < 1,5 s não empilha; antes do HUD guarda a última', () => {
    expect(notifyBlocked('Zona de paz', 0)).toBe(true);
    expect(notifyBlocked('Mãos ocupadas', 10)).toBe(true);
    const got: string[] = [];
    setBlockedSink((t) => got.push(t));
    expect(got).toEqual(['Mãos ocupadas']); // pendente entregue ao montar
    expect(notifyBlocked('Mãos ocupadas', 500)).toBe(false);
    expect(notifyBlocked('Mãos ocupadas', 2100)).toBe(true);
    expect(notifyBlocked('  ', 3000)).toBe(false);
    expect(got).toEqual(['Mãos ocupadas', 'Mãos ocupadas']);
  });
});

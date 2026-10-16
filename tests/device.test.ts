import { describe, expect, it } from 'vitest';
import { profileDevice } from '../src/core/device';

const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  ipad: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0 Safari/537.36',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  win: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  winFirefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:135.0) Gecko/20100101 Firefox/135.0',
  android: 'Mozilla/5.0 (Linux; Android 14; SM-A145) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
};

describe('perfil do aparelho', () => {
  it('iPhone → MÉDIO, 30 FPS, resolução dinâmica', () => {
    const p = profileDevice({ ua: UA.iphone, maxTouchPoints: 5, gpu: 'Apple GPU' });
    expect(p.platform).toBe('iphone');
    expect(p.browser).toBe('safari');
    expect(p.recommended).toBe('medium');
    expect(p.targetFps).toBe(30);
    expect(p.dynamicResolution).toBe(true);
    expect(p.label).toContain('iPhone detectado');
  });
  it('iPadOS que se apresenta como Mac é reconhecido pelo toque', () => {
    expect(profileDevice({ ua: UA.ipad, maxTouchPoints: 5, gpu: 'Apple GPU' }).platform).toBe('ipad');
  });
  it('Mac Apple Silicon Pro no Chrome → ULTRA a 60; Safari ("Apple GPU") → ALTO', () => {
    expect(profileDevice({ ua: UA.macChrome, maxTouchPoints: 0, gpu: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M5 Pro, Unspecified Version)', deviceMemory: 8 }).recommended).toBe('ultra');
    const s = profileDevice({ ua: UA.macSafari, maxTouchPoints: 0, gpu: 'Apple GPU' });
    expect(s.browser).toBe('safari');
    expect(s.recommended).toBe('high');
  });
  it('Windows com Intel UHD → BAIXO com resolução dinâmica; Iris Xe → MÉDIO', () => {
    const uhd = profileDevice({ ua: UA.win, maxTouchPoints: 0, gpu: 'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)', deviceMemory: 8 });
    expect(uhd.gpuClass).toBe('integrated');
    expect(uhd.recommended).toBe('low');
    expect(uhd.dynamicResolution).toBe(true);
    expect(profileDevice({ ua: UA.win, maxTouchPoints: 0, gpu: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11)', deviceMemory: 8 }).recommended).toBe('medium');
    expect(profileDevice({ ua: UA.win, maxTouchPoints: 0, gpu: 'ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11)', deviceMemory: 16 }).recommended).toBe('medium');
  });
  it('Firefox e GPU dedicada', () => {
    const f = profileDevice({ ua: UA.winFirefox, maxTouchPoints: 0, gpu: 'NVIDIA GeForce RTX 3060/PCIe/SSE2' });
    expect(f.browser).toBe('firefox');
    expect(f.recommended).toBe('high');
  });
  it('Android de entrada → BAIXO a 30; software → BAIXO', () => {
    const a = profileDevice({ ua: UA.android, maxTouchPoints: 5, gpu: 'Mali-G52', deviceMemory: 4 });
    expect(a.recommended).toBe('low');
    expect(a.targetFps).toBe(30);
    expect(profileDevice({ ua: UA.win, maxTouchPoints: 0, gpu: 'Google SwiftShader' }).recommended).toBe('low');
  });
});

/**
 * Benchmark para aparelhos reais (?bench=1): percorre 4 pontos do corredor por ~50 s e mostra o resultado
 * (aparelho detectado, preset, FPS médio e "1 % low", escala da resolução dinâmica, memória quando o navegador informa).
 * Uso no iPhone / notebook: abrir http://<ip-do-mac>:5173/?bench=1 na mesma rede (npm run dev -- --host).
 * Se a página recarregar sozinha no meio do teste, o navegador matou a aba por memória — anotar isso.
 */
type Pv = { setShot(n: string): void; metrics(): Record<string, any>; hud(v: boolean): void; takeFrames(): number[] };

const STOPS = [
  { shot: 'central', label: 'Central do Brasil' },
  { shot: 'avenue', label: 'Avenida (início)' },
  { shot: 'mid', label: 'Meio da avenida' },
  { shot: 'candelaria', label: 'Candelária' },
];

export async function runBench(pv: Pv) {
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;inset:auto 12px 12px 12px;z-index:99;max-width:560px;margin:0 auto;padding:14px 16px;border-radius:14px;background:rgba(10,16,22,.88);color:#f3efe6;font:13px/1.45 system-ui;backdrop-filter:blur(8px)';
  document.body.appendChild(box);
  const say = (h: string) => { box.innerHTML = h; };
  const per: { label: string; fps: number; low1: number; scale: number; calls: number }[] = [];
  const m0 = pv.metrics();
  say(`<b>Benchmark</b> · ${m0.device}<br>aquecendo…`);
  await wait(5000);
  for (const s of STOPS) {
    pv.setShot(s.shot);
    await wait(800); // estabiliza a troca de ponto
    pv.takeFrames();
    let minScale = 1, calls = 0, n = 0;
    for (let i = 0; i < 10; i++) {
      say(`<b>Benchmark</b> · ${m0.device}<br>${s.label} — ${10 - i} s`);
      await wait(1000);
      const m = pv.metrics();
      minScale = Math.min(minScale, m.governor?.scale ?? 1);
      calls += m.calls; n++;
    }
    const ft = pv.takeFrames().filter((x) => x > 0 && x < 1000).sort((a, b) => a - b);
    const avg = ft.reduce((a, b) => a + b, 0) / Math.max(1, ft.length);
    const p99 = ft[Math.floor(ft.length * 0.99)] ?? avg;
    per.push({ label: s.label, fps: +(1000 / avg).toFixed(1), low1: +(1000 / p99).toFixed(1), scale: +minScale.toFixed(2), calls: Math.round(calls / n) });
  }
  const m = pv.metrics();
  const result = {
    quando: new Date().toISOString(), aparelho: m.device, preset: m.quality, fpsAlvo: m.targetFps, ua: navigator.userAgent,
    gpu: (() => { try { const g = document.createElement('canvas').getContext('webgl2'); const e = g?.getExtension('WEBGL_debug_renderer_info'); return g ? String(e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER)) : 'sem webgl2'; } catch { return '?'; } })(),
    tela: `${screen.width}×${screen.height} @${devicePixelRatio}`, memoriaJS_MB: m.heapMB, trechos: per,
  };
  try { localStorage.setItem('pv3d.bench', JSON.stringify(result)); } catch { /* sem storage */ }
  // servidor de desenvolvimento grava em screenshots/bench_results/ (no build de produção não existe: ignora)
  void fetch('/__bench', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(result) }).catch(() => {});
  const rows = per.map((p) => `<tr><td>${p.label}</td><td>${p.fps}</td><td>${p.low1}</td><td>${p.scale}</td><td>${p.calls}</td></tr>`).join('');
  say(`<b>Resultado</b> · ${result.aparelho}<br>preset ${String(result.preset).toUpperCase()} · alvo ${result.fpsAlvo} FPS · GPU: ${result.gpu}
    <table style="width:100%;margin:8px 0;border-collapse:collapse;font-size:12px"><tr style="opacity:.7"><td>trecho</td><td>FPS</td><td>1% low</td><td>escala</td><td>draws</td></tr>${rows}</table>
    memória JS: ${result.memoriaJS_MB ?? 'não informada pelo navegador'} MB<br>
    <button id="pv-bench-copy" style="margin-top:8px;padding:8px 12px;border-radius:9px;border:0;background:#f2c45a;color:#1d1708;font-weight:700">Copiar resultado</button>`);
  document.getElementById('pv-bench-copy')!.onclick = async () => {
    const txt = JSON.stringify(result, null, 1);
    try { await navigator.clipboard.writeText(txt); (document.getElementById('pv-bench-copy') as HTMLButtonElement).textContent = 'Copiado'; }
    catch { prompt('Copie o resultado:', txt); }
  };
  (window as any).__pvBench = result;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

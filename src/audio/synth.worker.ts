/**
 * Rodada 10 — gera os sons (sounds.ts) FORA do thread principal: nenhum quadro trava enquanto o murmúrio da
 * multidão ou a batida do trio são sintetizados. Responde com o Float32Array transferido (sem cópia).
 */
import { renderSound } from './sounds';

self.onmessage = (e: MessageEvent<{ key: string; variant: number }>) => {
  const { key, variant } = e.data;
  const t0 = performance.now();
  const r = renderSound(key, variant);
  const ms = performance.now() - t0;
  if (!r) { (self as unknown as Worker).postMessage({ key, variant, data: null, rate: 0, loop: false, ms }); return; }
  (self as unknown as Worker).postMessage({ key, variant, data: r.data, rate: r.rate, loop: r.loop, ms }, [r.data.buffer]);
};

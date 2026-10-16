/** Recorte da pele/calça coberta pela roupa fora da thread principal (custa ~150 ms no LOD0). */
import { hideCoveredSkin, type ClothInput, type HideOptions } from './hideCovered';

export interface CullJob { pos: Float32Array; normal: Float32Array; index: ArrayLike<number> | null; cloths: ClothInput[]; opts?: HideOptions }

self.onmessage = (e: MessageEvent<{ id: number; jobs: CullJob[] }>) => {
  const { id, jobs } = e.data;
  const out = jobs.map((j) => {
    const r = hideCoveredSkin(j.pos, j.normal, j.index, j.cloths, j.opts);
    return { index: Uint32Array.from(r.index), hidden: r.hidden };
  });
  (self as unknown as Worker).postMessage({ id, out }, out.map((o) => o.index.buffer));
};

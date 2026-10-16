/** Recorte da pele/calça coberta pela roupa fora da thread principal (custa ~150 ms no LOD0 por peça). */
import { hideCoveredSkin, type ClothInput, type HideOptions } from './hideCovered';

/** UMA peça por tarefa: a máscara de vértices cobertos é guardada por (corpo, peça) e combinada por roupa vestida */
export interface CullJob { pos: Float32Array; normal: Float32Array; index: ArrayLike<number> | null; cloths: ClothInput[]; opts?: HideOptions }

self.onmessage = (e: MessageEvent<{ id: number; jobs: CullJob[] }>) => {
  const { id, jobs } = e.data;
  const out = jobs.map((j) => hideCoveredSkin(j.pos, j.normal, j.index, j.cloths, j.opts).covered);
  (self as unknown as Worker).postMessage({ id, out }, out.map((c) => c.buffer));
};

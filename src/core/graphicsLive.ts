/**
 * Rodada 11 — troca de preset gráfico AO VIVO (sem recarregar). O Game monta o `LiveGraphicsHost` com os sistemas
 * e chama `applyPresetLive`; o painel de ajustes mostra o que ficou para o próximo carregamento.
 *
 * Ao vivo: resolução (teto do pixel ratio), sombras (tamanho do mapa e alcance — o mapa é recriado), AO/SMAA/MSAA do
 * pós-processamento, anisotropia, neblina e `far` da câmera (céu acompanha), distâncias de LOD/mobiliário/telões,
 * pedestres (quantidade, raio, sombra), orçamento da multidão (até a capacidade criada no carregamento) e detalhe dos
 * personagens. Só ao recarregar: MSAA nativo do canvas (`antialias` do contexto WebGL), fachadas já construídas e a
 * capacidade extra da multidão (ver `reloadOnlyChanges`).
 */
import type * as THREE from 'three';
import { reloadOnlyChanges, type QualityPreset } from './settings';
import { CROWD_BUDGETS, type CrowdBudget } from '../characters/crowd/crowdBudget';

export interface LiveGraphicsHost {
  gr: { applyPreset(p: QualityPreset): void; applyAnisotropy(scene: THREE.Object3D, level: number): number };
  env: { applyQuality(p: QualityPreset): void; setFar(far: number): void };
  scene: THREE.Object3D;
  camera: THREE.PerspectiveCamera;
  chunks: { setPreset(p: QualityPreset): void };
  peds: { setMax(n: number): void; radius: number; shadowDistance: number };
  crowd: { budget: CrowdBudget };
  /** capacidade (instâncias) criada no carregamento — o orçamento ao vivo não passa disso */
  crowdCapacity: number;
  billboards?: { drawDistance: number } | null;
  rallyCrowd?: { shadowDistance: number } | null;
  /** detalhe máximo dos personagens NPC/remotos (0 = mais detalhado) */
  setNpcDetail(d: 0 | 1): void;
}

export interface LiveResult { applied: QualityPreset; reloadFor: string[]; anisotropyChanged: number; ms: number }

/** `built` = o preset com que o jogo CARREGOU (contexto WebGL e quarteirões já construídos): base do "só ao recarregar" */
export function applyPresetLive(h: LiveGraphicsHost, from: QualityPreset, to: QualityPreset, built: QualityPreset = from): LiveResult {
  const t0 = performance.now();
  const reloadFor = reloadOnlyChanges(built, to);
  h.gr.applyPreset(to);
  h.env.applyQuality(to);
  h.camera.far = to.cameraFar;
  h.camera.updateProjectionMatrix();
  h.env.setFar(to.cameraFar);
  h.chunks.setPreset(to);
  h.peds.setMax(to.pedestrians);
  h.peds.radius = to.pedestrianRadius;
  h.peds.shadowDistance = to.npcShadowDistance;
  if (h.billboards) h.billboards.drawDistance = to.billboardDistance;
  if (h.rallyCrowd) h.rallyCrowd.shadowDistance = to.npcShadowDistance;
  const nb = CROWD_BUDGETS[to.level] ?? CROWD_BUDGETS.medium;
  delete h.crowd.budget.lod1; delete h.crowd.budget.lod1Dist; // campos só do BAIXO
  Object.assign(h.crowd.budget, { ...nb, total: Math.min(nb.total, h.crowdCapacity) });
  if (nb.total > h.crowdCapacity) reloadFor.push('multidão completa');
  h.setNpcDetail(to.level === 'low' || to.level === 'medium' ? 1 : 0);
  const anisotropyChanged = h.gr.applyAnisotropy(h.scene, to.anisotropy);
  return { applied: to, reloadFor, anisotropyChanged, ms: +(performance.now() - t0).toFixed(1) };
}

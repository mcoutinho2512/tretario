/**
 * Itens na mão de UM personagem com esqueleto (bandeira, cartaz, megafone…). Esqueleto distante/instanciado usa
 * o instanciador de itens da multidão, não esta classe.
 * (Implementação: agente de props — ver docs/MANIFESTATION_SYSTEM.md.)
 */
import type * as THREE from 'three';

export interface PropHost {
  root: THREE.Object3D;
  bones: Map<string, THREE.Object3D>;
}

export class PropAttachment {
  prop = 0;
  design = 0;
  constructor(readonly host: PropHost) {}
  /** troca o item/design (0 = nenhum) */
  set(prop: number, design: number) { this.prop = prop; this.design = design; }
  /** animação do tecido etc. (t em segundos); `detail` = perto da câmera */
  update(_dt: number, _t: number, _detail: boolean) { /* implementado pelo sistema de props */ }
  dispose() { /* idem */ }
}

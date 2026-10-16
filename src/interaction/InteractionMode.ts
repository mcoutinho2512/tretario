/**
 * Modos de interação (docs/INTERACTION.md, ADR-009/012):
 *   PACÍFICO  — exploração; não participa de combate (padrão; obrigatório quando o evento exige).
 *   INTERAÇÃO — futuramente empurrões, socos estilizados, quedas e ragdoll (sem sangue, sem morte).
 *
 * Autoridade: o cliente NUNCA decide resultado de combate. Ele só registra `ActionRequest`s numa fila
 * (outbox) que o servidor valida (alcance, cooldown, modo de ambos, zona pacífica) e responde com o efeito.
 * Enquanto não há servidor, efeitos locais leves são aplicados apenas em NPCs de ambiente.
 */
export type InteractionModeName = 'pacifico' | 'interacao';

export interface ActionRequest {
  type: 'empurrar' | 'soco';
  /** posição e direção de quem age, no momento do pedido */
  x: number; z: number; dir: number;
  t: number;
  targetId?: string;
}

export class InteractionController {
  mode: InteractionModeName = 'pacifico';
  /** o evento/servidor permite alternar? */
  allowToggle = false;
  readonly outbox: ActionRequest[] = [];
  private cooldown = 0;

  setPolicy(eventInteraction: 'pacifico' | 'opcional' | undefined) {
    this.allowToggle = eventInteraction === 'opcional';
    if (!this.allowToggle) this.mode = 'pacifico';
  }

  toggle(): { ok: boolean; message: string } {
    if (!this.allowToggle) return { ok: false, message: 'Este evento é pacífico: interação física desativada.' };
    this.mode = this.mode === 'pacifico' ? 'interacao' : 'pacifico';
    return { ok: true, message: this.mode === 'interacao' ? 'Modo INTERAÇÃO ativo (estilizado, sem violência gráfica)' : 'Modo PACÍFICO ativo' };
  }

  update(dt: number) {
    this.cooldown = Math.max(0, this.cooldown - dt);
  }

  /** registra um pedido de ação (validado pelo servidor no multiplayer) */
  request(type: ActionRequest['type'], x: number, z: number, dir: number, t: number): ActionRequest | null {
    if (this.mode !== 'interacao' || this.cooldown > 0) return null;
    this.cooldown = 0.8;
    const r: ActionRequest = { type, x, z, dir, t };
    this.outbox.push(r);
    if (this.outbox.length > 32) this.outbox.shift();
    return r;
  }
}

/**
 * Mapa de ossos → corpos do ragdoll (para integração futura com Rapier, Apache-2.0).
 * Cada osso dos 17 vira um corpo rígido (cápsula) com junta esférica/dobradiça com limites.
 */
export const RAGDOLL_LAYOUT = [
  { bone: 'Hips', shape: 'box', parent: null, joint: null },
  { bone: 'Spine', shape: 'capsule', parent: 'Hips', joint: 'spherical' },
  { bone: 'Chest', shape: 'capsule', parent: 'Spine', joint: 'spherical' },
  { bone: 'Head', shape: 'ball', parent: 'Chest', joint: 'spherical' },
  { bone: 'LeftUpperArm', shape: 'capsule', parent: 'Chest', joint: 'spherical' },
  { bone: 'LeftLowerArm', shape: 'capsule', parent: 'LeftUpperArm', joint: 'revolute' },
  { bone: 'RightUpperArm', shape: 'capsule', parent: 'Chest', joint: 'spherical' },
  { bone: 'RightLowerArm', shape: 'capsule', parent: 'RightUpperArm', joint: 'revolute' },
  { bone: 'LeftUpperLeg', shape: 'capsule', parent: 'Hips', joint: 'spherical' },
  { bone: 'LeftLowerLeg', shape: 'capsule', parent: 'LeftUpperLeg', joint: 'revolute' },
  { bone: 'RightUpperLeg', shape: 'capsule', parent: 'Hips', joint: 'spherical' },
  { bone: 'RightLowerLeg', shape: 'capsule', parent: 'RightUpperLeg', joint: 'revolute' },
] as const;

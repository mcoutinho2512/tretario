/** Rodada 9.1: painéis de LED não acumulam texturas de conteúdo (cada AdSlot de evento novo = CanvasTexture nova). */
import { beforeAll, describe, expect, it } from 'vitest';
import type * as THREE from 'three';
import type { BillboardSlot } from '../src/world/types';

beforeAll(() => {
  // canvas mínimo: só pinta (aqui interessa o ciclo de vida da textura)
  const ctx = new Proxy({}, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 10 }) : String(k).startsWith('create') ? () => ({ addColorStop() {} }) : () => {}), set: () => true });
  (globalThis as { document?: unknown }).document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
});

const slot = (id: string): BillboardSlot => ({ id, p: [0, 0], y: 10, w: 16, h: 9, r: 0 } as unknown as BillboardSlot);

describe('BillboardSystem', () => {
  it('conteúdo trocado: a textura anterior sai da GPU acima do limite de reserva', async () => {
    const { BillboardSystem, BILLBOARD_KEEP_UNUSED } = await import('../src/events/Billboards');
    const b = new BillboardSystem([slot('a'), slot('b')]);
    const disposed: THREE.Texture[] = [];
    const seen = new Set<THREE.Texture>();
    const screen = (i: number) => ((b.group.children[i] as THREE.Group).children[1] as THREE.Mesh).material as THREE.MeshBasicMaterial;
    for (let i = 0; i < 40; i++) {
      b.setPanelContent('a', { type: 'text', text: `EVENTO ${i}`, subtext: `ÀS ${i}:00` });
      const t = screen(0).map!;
      if (!seen.has(t)) { seen.add(t); t.addEventListener('dispose', () => disposed.push(t)); }
      expect(b.cachedTextures).toBeLessThanOrEqual(2 + BILLBOARD_KEEP_UNUSED); // em uso (a, b) + reserva
    }
    expect(seen.size).toBe(40);
    expect(disposed.length).toBe(40 - 1 - BILLBOARD_KEEP_UNUSED);
    // nunca descarta a textura que um painel está mostrando
    expect(disposed).not.toContain(screen(0).map);
    expect(disposed).not.toContain(screen(1).map);
  });

  it('conteúdo que volta (rodízio) reaproveita a textura guardada', async () => {
    const { BillboardSystem } = await import('../src/events/Billboards');
    const b = new BillboardSystem([slot('a')]);
    const screen = () => ((b.group.children[0] as THREE.Group).children[1] as THREE.Mesh).material as THREE.MeshBasicMaterial;
    b.setPanelContent('a', { type: 'text', text: 'UM' });
    const um = screen().map;
    b.setPanelContent('a', { type: 'text', text: 'DOIS' });
    b.setPanelContent('a', { type: 'text', text: 'UM' });
    expect(screen().map).toBe(um);
  });
});

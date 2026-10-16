/**
 * Edifícios de reconhecimento (rodada 6): todo override `byId` chega aos chunks com seu modelo, todo
 * modelo tem construtor, e cada edifício respeita o orçamento de triângulos (corpo ≲ 40 k, LOD distante
 * bem mais barato). Ver docs/RECOGNITION_BUILDINGS.md.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import type { WorldManifest, ChunkData, BuildingRec } from '../src/world/types';
import { buildModelBuilding } from '../src/world/landmarks/models';
import type { ArchMat } from '../src/world/landmarks/arch';
import { recognitionStats } from '../src/world/landmarks/recognition';

const manifest = JSON.parse(readFileSync('public/world/manifest.json', 'utf8')) as WorldManifest;
const overrides = JSON.parse(readFileSync('data/overrides/buildings.json', 'utf8')) as { byId: Record<string, { model?: string; source?: string; confidence?: string }> };
const all: BuildingRec[] = manifest.chunks.flatMap((c) => (JSON.parse(readFileSync(`public/world/${c.file}`, 'utf8')) as ChunkData).buildings);
const mats = Object.fromEntries((['stone', 'concrete', 'granite', 'dark', 'metal', 'glass'] as ArchMat[]).map((k) => [k, new THREE.MeshBasicMaterial()])) as unknown as Record<ArchMat, THREE.Material>;

describe('edifícios de reconhecimento', () => {
  const ids = Object.keys(overrides.byId).filter((k) => !k.startsWith('_'));

  it('cada override por id tem fonte, confiança e chega ao chunk com o modelo', () => {
    expect(ids.length).toBeGreaterThanOrEqual(10);
    for (const id of ids) {
      const o = overrides.byId[id];
      expect(o.source, id).toBeTruthy();
      expect(['alta', 'media', 'baixa']).toContain(o.confidence);
      const b = all.find((x) => String(x.id) === id);
      expect(b, `edifício ${id} nos chunks`).toBeTruthy();
      expect(b!.model).toBe(o.model);
    }
  });

  it('constrói todos os modelos dentro do orçamento de triângulos', () => {
    for (const id of ids) {
      const b = all.find((x) => String(x.id) === id)!;
      const inst = buildModelBuilding(b, mats, manifest.pvAxis);
      expect(inst, `modelo ${b.model}`).not.toBeNull();
    }
    // os edifícios são agrupados em lotes por célula; o orçamento é conferido por lote (média por membro)
    let members = 0;
    for (const c of recognitionStats()) {
      const n = c.members.length;
      members += n;
      expect(c.tris.near / n, c.cluster).toBeLessThan(40000);
      expect(c.tris.far, c.cluster).toBeLessThan(c.tris.near * 0.35);
    }
    expect(members).toBe(ids.length);
  });

  it('o Banco Central tem altura publicada (~130 m) e o Paulo de Frontin 22 pavimentos', () => {
    const bc = all.find((b) => b.model === 'banco_central')!;
    expect(bc.height).toBeGreaterThan(125);
    const pf = all.find((b) => b.model === 'paulo_frontin:0')!;
    expect(pf.name).toBe('Edifício Paulo de Frontin');
    expect(pf.levels).toBe(22);
  });
});

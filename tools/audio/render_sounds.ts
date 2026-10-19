/**
 * Rodada 10 — exporta TODOS os sons gerados por código (src/audio/sounds.ts) como WAV 16 bits para ouvir/avaliar
 * fora do jogo. Nada é versionado: a saída padrão é screenshots/tmp/audio/ (ignorada pelo git).
 *
 * uso: npx tsx tools/audio/render_sounds.ts [pasta=screenshots/tmp/audio] [perfis extras: torcida_a,manifestacao,...]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { SOUNDS, renderSound, soundDef } from '../../src/audio/sounds';

const dir = process.argv[2] ?? 'screenshots/tmp/audio';
const extra = (process.argv[3] ?? 'manifestacao,show,torcida_a,torcida_b,torcida_c,torcida_d').split(',').filter(Boolean).map((p) => `layer:${p}`);
mkdirSync(dir, { recursive: true });

function wav(data: Float32Array, rate: number): Buffer {
  const b = Buffer.alloc(44 + data.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + data.length * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(data.length * 2, 40);
  for (let i = 0; i < data.length; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, data[i])) * 32767), 44 + i * 2);
  return b;
}

let n = 0;
for (const key of [...Object.keys(SOUNDS), ...extra]) {
  const d = soundDef(key);
  if (!d) continue;
  for (let v = 0; v < d.variants; v++) {
    const r = renderSound(key, v)!;
    // laços: duas voltas seguidas (dá para ouvir se a emenda estala)
    const data = r.loop ? Float32Array.from({ length: r.data.length * 2 }, (_, i) => r.data[i % r.data.length]) : r.data;
    writeFileSync(`${dir}/${key.replace(':', '_')}${d.variants > 1 ? `_${v}` : ''}.wav`, wav(data, r.rate));
    n++;
  }
}
console.log(`${n} arquivos em ${dir}`);

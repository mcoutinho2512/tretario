/**
 * Portas para os testes com servidor real: um bloco de `n` portas CONSECUTIVAS livres de verdade (testado no sistema
 * operacional), escolhido ao acaso em 20000–59999. Substitui as fórmulas `base + pid % k`, que se sobrepunham entre
 * arquivos (e com as portas dos roteiros de QA) e faziam um teste falar com o servidor de outro sob carga.
 */
import { createServer } from 'node:net';

const free = (port: number) => new Promise<boolean>((res) => {
  const s = createServer();
  s.once('error', () => res(false));
  s.listen(port, () => s.close(() => res(true)));
});

export async function freePortBlock(n = 1): Promise<number> {
  for (let tries = 0; tries < 200; tries++) {
    const base = 20000 + Math.floor(Math.random() * 40000);
    let ok = true;
    for (let i = 0; i < n && ok; i++) ok = await free(base + i);
    if (ok) return base;
  }
  throw new Error('sem bloco de portas livres');
}

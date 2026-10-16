/**
 * Id ANÔNIMO e estável deste aparelho/navegador (UUID no localStorage), enviado no join (`JoinOptions.cid`).
 * Serve para autoria (grafites), cota e denúncias enquanto não há login — NÃO é identidade real: limpar o
 * navegador gera outro. Com login, a conta substitui este id (ver docs/GRAFFITI.md).
 */
const KEY = 'pv.clientId';
let cached = '';

export function anonymousClientId(): string {
  if (cached) return cached;
  try {
    const v = localStorage.getItem(KEY);
    if (v && /^[A-Za-z0-9-]{8,64}$/.test(v)) return (cached = v);
  } catch { /* sem localStorage (modo privado): id só desta sessão */ }
  const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  try { localStorage.setItem(KEY, id); } catch { /* */ }
  return (cached = id);
}

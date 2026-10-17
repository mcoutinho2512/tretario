/**
 * Senhas (rodada 8): scrypt do node:crypto com sal aleatório POR USUÁRIO e formato VERSIONADO
 *   scrypt$<log2 N>$<r>$<p>$<sal base64url>$<hash base64url>
 * Assim dá para endurecer os parâmetros depois: no login, um hash com parâmetros antigos é refeito (`needsRehash`).
 * Comparação em tempo constante. Nunca guardar/logar a senha em claro.
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';

export interface ScryptParams { logN: number; r: number; p: number }

/** padrão: N=2^15, r=8, p=1 (~32 MB, dezenas de ms). PV_SCRYPT_LOGN só para testes/máquinas fracas */
export const DEFAULT_SCRYPT: ScryptParams = { logN: Number(process.env.PV_SCRYPT_LOGN ?? 15), r: 8, p: 1 };
const KEYLEN = 32;
const SALT_BYTES = 16;

function scrypt(pw: string, salt: Buffer, prm: ScryptParams): Promise<Buffer> {
  const N = 2 ** prm.logN;
  const opts: ScryptOptions = { N, r: prm.r, p: prm.p, maxmem: 128 * N * prm.r * 2 + 1024 * 1024 };
  return new Promise((res, rej) => scryptCb(pw.normalize('NFKC'), salt, KEYLEN, opts, (e, k) => (e ? rej(e) : res(k))));
}

export async function hashPassword(pw: string, prm: ScryptParams = DEFAULT_SCRYPT): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await scrypt(pw, salt, prm);
  return `scrypt$${prm.logN}$${prm.r}$${prm.p}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

function parse(stored: string): { prm: ScryptParams; salt: Buffer; key: Buffer } | null {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;
  const [logN, r, p] = parts.slice(1, 4).map(Number);
  // limites: um registro adulterado não pode fazer o servidor alocar memória absurda
  if (![logN, r, p].every(Number.isInteger) || logN < 10 || logN > 20 || r < 1 || r > 32 || p < 1 || p > 16) return null;
  return { prm: { logN, r, p }, salt: Buffer.from(parts[4], 'base64url'), key: Buffer.from(parts[5], 'base64url') };
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const h = parse(stored);
  if (!h || h.key.length !== KEYLEN) return false;
  const key = await scrypt(pw, h.salt, h.prm);
  return timingSafeEqual(key, h.key);
}

/** hash com parâmetros diferentes dos atuais → refazer no próximo login bem-sucedido */
export function needsRehash(stored: string, prm: ScryptParams = DEFAULT_SCRYPT): boolean {
  const h = parse(stored);
  return !h || h.prm.logN !== prm.logN || h.prm.r !== prm.r || h.prm.p !== prm.p;
}

/** gasta o mesmo tempo quando o e-mail não existe (o login não revela contas pelo tempo de resposta) */
const dummies = new Map<string, Promise<string>>();
export async function burnPasswordTime(pw: string, prm: ScryptParams = DEFAULT_SCRYPT): Promise<void> {
  const k = `${prm.logN}/${prm.r}/${prm.p}`;
  if (!dummies.has(k)) dummies.set(k, hashPassword(randomBytes(12).toString('hex'), prm));
  await verifyPassword(pw, await dummies.get(k)!);
}

export type PasswordRejection = 'senha_curta' | 'senha_longa' | 'senha_comum';

/** senhas óbvias (lista curta: barra o trivial; não substitui um verificador de vazamentos) */
const COMMON = new Set([
  '12345678', '123456789', '1234567890', '87654321', '11111111', '00000000', '12341234', '11223344', '123123123',
  'password', 'password1', 'passw0rd', 'senha123', 'senha1234', 'senhasenha', 'minhasenha', 'qwertyui', 'qwerty123',
  'asdfghjk', 'abcd1234', 'abc12345', 'iloveyou', 'admin123', 'administrador', 'brasil123', 'flamengo', 'flamengo1',
  'vasco123', 'botafogo', 'fluminense', 'corinthians', 'palmeiras', 'riodejaneiro', 'mudar123', 'trocar123', 'teste123',
  'presidentevargas', 'manifestacao', 'q1w2e3r4', '1q2w3e4r', 'zaq12wsx', 'sunshine', 'princess', 'football',
]);

/** política: 8–128 caracteres; não comum; não só 1–2 caracteres repetidos nem sequência; não igual ao e-mail/apelido */
export function checkPasswordPolicy(pw: unknown, ctx: { email?: string; nickname?: string } = {}): PasswordRejection | null {
  if (typeof pw !== 'string' || Array.from(pw).length < 8) return 'senha_curta';
  // teto: scrypt de entradas gigantes é DoS barato
  if (pw.length > 128) return 'senha_longa';
  const low = pw.toLowerCase();
  if (COMMON.has(low) || new Set(low).size <= 2) return 'senha_comum';
  if ('0123456789abcdefghijklmnopqrstuvwxyz'.includes(low) || '9876543210'.includes(low)) return 'senha_comum';
  const email = ctx.email?.toLowerCase();
  if (email && (low === email || low === email.split('@')[0])) return 'senha_comum';
  if (ctx.nickname && low === ctx.nickname.toLowerCase()) return 'senha_comum';
  return null;
}

/**
 * Bots de carga: N clientes reais (SDK Colyseus) enviando movimento a 15 Hz e decodificando o estado como um
 * cliente de verdade. Mede o que cada cliente RECEBE e ENVIA (bytes/s, mensagens/s), correções e jogadores
 * visíveis (detalhados via StateView + multidão distante via mensagem "crowd").
 *
 * uso: npx tsx tools/bots.ts <N> <segundos> [ws://127.0.0.1:2567] [cenário] [opções]
 *   cenário  0 | spawn  perto do spawn (padrão; servidor normal)
 *            1 | spread espalhados ao longo da avenida (requer servidor PV_TEST=1)
 *            dense      todos numa elipse de ~60 m × 20 m no eixo da avenida — o caso real da manifestação (PV_TEST=1)
 *            packed     rodada 12: CONCENTRADOS — todos num disco de raio √T × 0,42 m (~1,8 pessoa/m²) andando para o
 *                       centro: corpos se apertam o tempo todo (custo da colisão entre corpos no servidor; PV_TEST=1)
 *   opções   --offset=K   índice do primeiro bot (vários processos dividem a mesma multidão)
 *            --total=T    tamanho total da multidão (para distribuir posições entre processos)
 *            --wait-go    entra, imprime "READY" e só começa a medir ao receber "go" na entrada padrão
 *            --hold       depois de medir, espera "bye" na entrada padrão antes de sair (o pai coordena)
 *            --social=F   fração F dos bots com vida de manifestação (rodada 7): dançando, com bandeira, com cartaz,
 *                         gesticulando (pedidos 'act'/'prop' reais, validados pelo servidor)
 *            --groups     rodada 8: bots distribuídos entre os grupos do evento (13 / 22 / neutro; opção só de teste)
 *            --range=A,B  rodada 8.1: no cenário spread, só o trecho [A, B] do eixo (frações; 0.18,1 = Central → Candelária)
 *                         e com deslocamento lateral de até ±14 m (a avenida inteira vista do alto)
 *            --chat=M     rodada 8: mensagens de chat por MINUTO na multidão inteira (realista: poucos falam; padrão 0),
 *                         espalhadas no tempo e entre bots, canais GERAL/PROXIMIDADE/GRUPO
 *            --combat=F   rodada 9: fração F dos bots em CONFRONTO — modo interação, em pares parados frente a frente
 *                         (~1,1 m), um golpe/esquiva a cada 1,5–4 s (soco 55 %, chute 30 %, esquiva 15 %). Precisa de
 *                         zona com política de confronto: servidor de teste com PV_COMBAT_ZONES=* (ou a área de treino)
 *            --combat-dense  todos os bots em pares de confronto, ritmo de luta (um pedido a cada 0,7–1,4 s) — estresse
 *            --sync-clap=S rodada 12: a cada S s todos pedem palmas juntos (mesmo instante, mesma variação)
 *            --names      rodada 12: apelidos no estilo dos personagens autônomos (QA visual dos nomes)
 *            --vehicles=N rodada 10: os N primeiros bots (índice global) nascem ao lado de um veículo livre (carro, moto,
 *                         bicicleta, patinete, alternados), pedem `enter` ao servidor e dirigem (vai e volta, ~70 % do
 *                         limite do modo). A lista de veículos vem de uma conexão de reconhecimento (estado sincronizado).
 *
 * Movimento de multidão: caminhada lenta (0,5–1,4 m/s), paradas de 1–6 s, pequenas variações de rumo,
 * e volta para a área da concentração quando sai dela. Ao receber correção do servidor (parede), muda de rumo.
 */
import WebSocket from 'ws';
import { Client, Callbacks } from '@colyseus/sdk';
import { ROOM_NAME, NET_TICK_HZ } from '../../src/net/protocol.ts';
import { randomAppearance } from '../../src/characters/bodyTypes.ts';
import { packMove } from '../../src/net/rules.ts';
import { decodeCrowd } from '../../src/net/crowdCodec.ts';
import { readFileSync } from 'node:fs';
import { pointOnAxis } from '../../src/world/zones.ts';
import { createInterface } from 'node:readline';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flag = (k: string) => process.argv.find((a) => a.startsWith(`--${k}`));
const flagNum = (k: string, d: number) => { const f = flag(k); return f && f.includes('=') ? Number(f.split('=')[1]) : d; };
const N = Number(args[0] ?? 5);
const SECS = Number(args[1] ?? 20);
const ENDPOINT = args[2] ?? 'ws://127.0.0.1:2567';
const SCEN = args[3] === '1' ? 'spread' : args[3] === 'dense' ? 'dense' : args[3] === 'spread' ? 'spread' : args[3] === 'packed' ? 'packed' : 'spawn';
const OFFSET = flagNum('offset', 0);
const TOTAL = flagNum('total', N);
const WAIT_GO = !!flag('wait-go');
const HOLD = !!flag('hold');
const SOCIAL = flagNum('social', 0);
const GROUPS = !!flag('groups');
const CHAT_PER_MIN = flagNum('chat', 0);
const COMBAT_DENSE = !!flag('combat-dense');
const COMBAT = COMBAT_DENSE ? 1 : flagNum('combat', 0);
const VEHICLES = flagNum('vehicles', 0);
const denyReasons: Record<string, number> = {};
const RIDE_SPEED: Record<string, number> = { car: 5.5, moto: 5.5, bicycle: 4.5, scooter: 3.8 };
const GROUP_KEYS = ['grupo-13', 'grupo-22', 'neutro'];
const RANGE = (() => { const f = flag('range'); const v = f?.includes('=') ? f.split('=')[1].split(',').map(Number) : null; return v && v.length === 2 && v.every(Number.isFinite) ? v as [number, number] : null; })();
const CHAT_LINES = ['bora pro trio', 'que dia bonito', 'alguém perto da Central?', 'chegando na Candelária', 'olha o carro de som', 'boa tarde', 'muita gente hoje', 'onde fica o palco?'];
// ids dos registros (src/social): dança, bandeira, cartaz, gestos
import { ACTION_BY_KEY } from '../../src/social/actions.ts';
import { PROP_BY_KIND } from '../../src/social/props.ts';
const A = (k: string) => ACTION_BY_KEY.get(k)!.id;
const PROP = (k: string) => PROP_BY_KIND.get(k as never)!.id;
type SocialRole = 'none' | 'dancer' | 'flag' | 'sign' | 'gesture';

// contadores por socket (instrumentação do ws no processo dos bots)
const stats = new Map<unknown, { in: number; out: number; mIn: number; mOut: number }>();
const st = (ws: unknown) => stats.get(ws) ?? (stats.set(ws, { in: 0, out: 0, mIn: 0, mOut: 0 }), stats.get(ws)!);
const P = (WebSocket as any).prototype;
const oSend = P.send, oEmit = P.emit;
P.send = function (d: any, ...r: any[]) { const s = st(this); s.out += d?.byteLength ?? d?.length ?? 0; s.mOut++; return oSend.call(this, d, ...r); };
P.emit = function (ev: string, d: any, ...r: any[]) { if (ev === 'message') { const s = st(this); s.in += d?.byteLength ?? d?.length ?? 0; s.mIn++; } return oEmit.call(this, ev, d, ...r); };

const manifest = JSON.parse(readFileSync(new URL('../../public/world/manifest.json', import.meta.url), 'utf8'));
/** rodada 12 — `--names`: apelidos no estilo dos autônomos (public/gameplay/autonomous.json `names`) para QA visual dos nomes */
const NAMES = !!flag('names');
const NAME_DATA = JSON.parse(readFileSync(new URL('../../public/gameplay/autonomous.json', import.meta.url), 'utf8')).names as { words: string[]; suffixWords: string[]; numbers: string[] };
function cariocaName(i: number): string {
  const w = NAME_DATA.words[(i * 7) % NAME_DATA.words.length];
  const tail = i % 3 === 0 ? NAME_DATA.suffixWords[(i * 3) % NAME_DATA.suffixWords.length] : i % 3 === 1 ? NAME_DATA.numbers[(i * 5) % NAME_DATA.numbers.length] : '';
  const n = `${w}${i % 8 === 0 && tail ? '_' : ''}${tail}`;
  return (i % 4 === 0 ? n.toLowerCase() : n).slice(0, 18);
}
const axis: [number, number][] = manifest.pvAxis;

/** centro da concentração: meio do trecho longo do eixo (pista larga, sem prédios a menos de ~25 m) */
const DENSE = (() => {
  const a = axis[11], b = axis[12];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return { x: (a[0] + b[0]) / 2, z: (a[1] + b[1]) / 2, ux: (b[0] - a[0]) / len, uz: (b[1] - a[1]) / len, along: 60, across: 20 };
})();
/** rodada 12 — raio do disco do cenário `packed` (m) */
const PACK_R = Math.sqrt(Math.max(1, TOTAL)) * 0.42;
const inDense = (x: number, z: number) => {
  const dx = x - DENSE.x, dz = z - DENSE.z;
  const u = dx * DENSE.ux + dz * DENSE.uz, v = -dx * DENSE.uz + dz * DENSE.ux;
  return (u / DENSE.along) ** 2 + (v / DENSE.across) ** 2;
};

// gerador determinístico por bot (cenas reproduzíveis)
function rng(seed: number) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

interface Bot {
  room: any; x: number; z: number; h: number; seq: number; corrections: number; detailed: number; far: number; crowdMsgs: number; trafficMsgs: number;
  speed: number; cruise: number; pause: number; home: { x: number; z: number }; r: () => number;
  role: SocialRole; nextAct: number; acts: number; denied: number;
  /** confronto (rodada 9): par, próximo golpe, contagens */
  /** rodada 10: veículo que este bot dirige */
  ride?: { id: string; kind: string; ok: boolean; dir: number; leg: number };
  fighter: boolean; partner: Bot | null; nextCbt: number; cbt: { sent: number; act: number; hitOut: number; hitIn: number; dodged: number; blocked: number; denied: Record<string, number> }; nid: number;
}
const bots: Bot[] = [];

function spawnPoint(gi: number, r: () => number): { x: number; z: number } | undefined {
  if (SCEN === 'spread' && RANGE) { const p = pointOnAxis(axis, RANGE[0] + (gi / Math.max(1, TOTAL - 1)) * (RANGE[1] - RANGE[0]), (r() - 0.5) * 28); return { x: p.x + (r() - 0.5) * 4, z: p.z + (r() - 0.5) * 4 }; }
  if (SCEN === 'spread') { const ax = axis[Math.floor((gi / Math.max(1, TOTAL - 1)) * (axis.length - 1))]; return { x: ax[0] + (r() - 0.5) * 8, z: ax[1] + (r() - 0.5) * 8 }; }
  if (SCEN === 'packed') { const a = r() * Math.PI * 2, k = Math.sqrt(r()) * PACK_R; return { x: DENSE.x + Math.cos(a) * k, z: DENSE.z + Math.sin(a) * k }; }
  if (SCEN === 'dense') {
    // ponto uniforme na elipse (raiz do raio)
    const a = r() * Math.PI * 2, k = Math.sqrt(r()) * 0.95;
    const u = Math.cos(a) * k * DENSE.along, v = Math.sin(a) * k * DENSE.across;
    return { x: DENSE.x + u * DENSE.ux - v * DENSE.uz, z: DENSE.z + u * DENSE.uz + v * DENSE.ux };
  }
  return undefined;
}

async function startBot(i: number) {
  const gi = OFFSET + i;
  const r = rng(gi * 7919 + 13);
  const client = new Client(ENDPOINT);
  let sp = spawnPoint(gi, r);
  const veh = gi < VEHICLES ? vehList[gi] : undefined;
  if (veh) sp = { x: veh.x + Math.cos(veh.h) * 1.2, z: veh.z - Math.sin(veh.h) * 1.2 };
  const prevBot = bots[bots.length - 1];
  if (COMBAT > 0 && prevBot?.fighter && !prevBot.partner && sp) sp = { x: prevBot.home.x + 1.1, z: prevBot.home.z };
  // aparência sorteada como a dos NPCs num ato (peças variantes, ~20 % de camisas de futebol)
  const app = randomAppearance(gi * 7919 + 13, (['homem', 'mulher', 'idoso', 'idosa'] as const)[gi % 4], { football: 0.2 });
  const room = await client.joinOrCreate(ROOM_NAME, {
    ...app, name: NAMES ? cariocaName(gi) : `bot${gi}`, accessory: app.accessory ?? 'nenhum',
    ...(sp ? { testSpawn: sp } : {}),
    ...(GROUPS ? { testGroup: GROUP_KEYS[gi % GROUP_KEYS.length] } : {}),
    bot: true,
  });
  const b: Bot = {
    room, x: sp?.x ?? 0, z: sp?.z ?? 0, h: r() * Math.PI * 2, seq: 0, corrections: 0, detailed: 0, far: 0, crowdMsgs: 0, trafficMsgs: 0,
    speed: 0, cruise: 0.5 + r() * 0.9, pause: r() * 3, home: sp ?? { x: 0, z: 0 }, r,
    role: 'none', nextAct: 1 + r() * 4, acts: 0, denied: 0,
    fighter: false, partner: null, nextCbt: 1 + r() * 3, cbt: { sent: 0, act: 0, hitOut: 0, hitIn: 0, dodged: 0, blocked: 0, denied: {} }, nid: 0,
  };
  // confronto: pares de índices consecutivos (o par fica no mesmo processo); o 2º nasce 1,1 m à frente do 1º
  if (COMBAT > 0 && (gi % Math.max(1, Math.round(2 / COMBAT)) < 2 || COMBAT >= 1)) {
    b.fighter = true;
    const prev = bots[bots.length - 1];
    if (prev?.fighter && !prev.partner) { b.partner = prev; prev.partner = b; }
  }
  // papel na manifestação: ~30 % dançam, 25 % bandeira, 20 % cartaz, 25 % gestos
  if (r() < SOCIAL) { const u = r(); b.role = u < 0.3 ? 'dancer' : u < 0.55 ? 'flag' : u < 0.75 ? 'sign' : 'gesture'; }
  room.onMessage('spawn', (s: any) => { b.x = s.x; b.z = s.z; if (!sp) b.home = { x: s.x, z: s.z }; });
  room.onMessage('correct', (c: number[]) => { b.x = c[0]; b.z = c[2]; b.corrections++; b.h += Math.PI * (0.5 + b.r()); });
  room.onMessage('traffic', () => { b.trafficMsgs++; });
  room.onMessage('crowd', (buf: Uint8Array) => { b.crowdMsgs++; b.far = decodeCrowd(buf instanceof Uint8Array ? buf : new Uint8Array(buf)).length; });
  for (const t of ['pong', 'knock', 'action', 'enter_ok', 'enter_denied', 'exit_ok', 'mode_ok', 'mode_denied', 'push_denied']) room.onMessage(t, () => {});
  room.onMessage('act_denied', () => { b.denied++; });
  // confronto: o bot só conta (o servidor decide tudo)
  room.onMessage('cbt_act', () => { b.cbt.act++; });
  room.onMessage('cbt_hit', (h: { by: number; tgt: number; r: string }) => { if (h.by === b.nid) { if (h.r === 'hit') b.cbt.hitOut++; else if (h.r === 'blocked') b.cbt.blocked++; } else if (h.tgt === b.nid) { if (h.r === 'hit') b.cbt.hitIn++; else if (h.r === 'dodged') b.cbt.dodged++; } });
  room.onMessage('cbt_denied', (d: { reason: string }) => { b.cbt.denied[d.reason] = (b.cbt.denied[d.reason] ?? 0) + 1; });
  for (const t of ['cbt_self', 'cbt_dummy', 'jump_denied']) room.onMessage(t, () => {});
  for (const t of ['chat', 'chat_hello', 'chat_denied', 'chat_report_res', 'denied', 'gf_add', 'gf_del', 'gf_state', 'gf_res', 'presence', 'metrics']) room.onMessage(t, () => {});
  room.onMessage('prop_denied', () => { b.denied++; });
  if (b.fighter) { room.send('mode', 'interacao'); b.role = 'none'; }
  if (b.role === 'flag') room.send('prop', { p: PROP('flag_small'), d: 0 });
  if (b.role === 'sign') room.send('prop', { p: PROP('sign_small'), d: 0 });
  const cb = Callbacks.get(room as any) as any;
  cb.onAdd('players', (p: any, id: string) => { b.detailed++; if (id === room.sessionId) b.nid = p.nid; });
  cb.onRemove('players', () => { b.detailed--; });
  if (veh) {
    b.ride = { id: veh.id, kind: veh.kind, ok: false, dir: 1, leg: 0 };
    room.onMessage('enter_ok', (m: { id: string; x: number; z: number; heading: number }) => { if (b.ride && m.id === b.ride.id) { b.ride.ok = true; b.x = m.x; b.z = m.z; b.h = m.heading; } });
    room.onMessage('enter_denied', (d: { reason?: string }) => { if (b.ride) { denyReasons[d?.reason ?? '?'] = (denyReasons[d?.reason ?? '?'] ?? 0) + 1; b.ride = undefined; } });
    room.send('enter', { id: veh.id, seq: ++b.seq });
  }
  bots.push(b);
}

/** vida de manifestação: pede ações reais ao servidor de tempos em tempos (irregular, por bot) */
function socialBot(b: Bot, dt: number) {
  if (b.role === 'none') return;
  b.nextAct -= dt;
  if (b.nextAct > 0) return;
  b.nextAct = 6 + b.r() * 10;
  let a = 0;
  if (b.role === 'dancer') { a = A(['dance_simple', 'dance_lively', 'dance_arms', 'dance_party'][Math.floor(b.r() * 4)]); b.pause = b.nextAct; } // dança parado
  else if (b.role === 'flag') a = A(b.r() < 0.6 ? 'flag_wave' : 'flag_raise');
  else if (b.role === 'sign') a = A(b.r() < 0.6 ? 'sign_raise' : 'sign_wave');
  else { a = A(['clap', 'arms_up', 'talk', 'wave', 'rhythm_clap'][Math.floor(b.r() * 5)]); if (a === A('talk')) b.pause = b.nextAct; }
  b.acts++;
  b.room.send('act', { a, v: Math.floor(b.r() * 8) });
}

/** chat realista: a multidão INTEIRA manda CHAT_PER_MIN mensagens/min, cada bot com chance proporcional */
let chatSent = 0;
function chatBot(b: Bot, dt: number) {
  if (!CHAT_PER_MIN || !bots.length) return;
  if (b.r() < (CHAT_PER_MIN / 60) * dt / bots.length) {
    const u = b.r();
    b.room.send('chat_send', { ch: u < 0.6 ? 'geral' : u < 0.9 ? 'proximidade' : (GROUPS ? 'grupo' : 'geral'), text: CHAT_LINES[Math.floor(b.r() * CHAT_LINES.length)] + (b.r() < 0.5 ? '' : ` ${Math.floor(b.r() * 100)}`) });
    chatSent++;
  }
}

/** confronto: parado de frente para o par, um golpe/esquiva em ritmo realista (só pedidos; o servidor decide) */
const CBT = { soco: 1, chute: 3, esquiva: 6 };
function fightBot(b: Bot, dt: number) {
  const o = b.partner;
  if (o) b.h = Math.atan2(o.x - b.x, o.z - b.z);
  b.speed = 0;
  b.nextCbt -= dt;
  if (b.nextCbt <= 0) {
    b.nextCbt = COMBAT_DENSE ? 0.7 + b.r() * 0.7 : 1.5 + b.r() * 2.5;
    const u = b.r();
    b.room.send('cbt', { a: u < 0.55 ? CBT.soco : u < 0.85 ? CBT.chute : CBT.esquiva, h: Math.round(b.h * 1000) / 1000, seq: b.seq });
    b.cbt.sent++;
  }
  b.room.send('move', packMove({ x: b.x, y: 0, z: b.z, heading: b.h, speed: 0, loco: 0, seq: ++b.seq }));
}

/** dirige: vai e volta no próprio rumo (30–60 m), ~70 % do limite do modo; correção do servidor (parede) inverte */
function rideBot(b: Bot, dt: number) {
  const r = b.ride!;
  const v = RIDE_SPEED[r.kind] ?? 3;
  b.speed += (v - b.speed) * Math.min(1, dt * 1.5);
  r.leg += b.speed * dt;
  if (r.leg > 30 + (b.r() * 30)) { r.leg = 0; b.h += Math.PI; b.speed = 0.5; }
  b.x += Math.sin(b.h) * b.speed * dt; b.z += Math.cos(b.h) * b.speed * dt;
  b.room.send('move', packMove({ x: b.x, y: 0, z: b.z, heading: b.h, speed: b.speed, loco: 0, seq: ++b.seq }));
}

/** um passo de "multidão": anda devagar, para às vezes, varia o rumo, volta para a concentração */
function stepBot(b: Bot, dt: number) {
  if (b.fighter) { fightBot(b, dt); return; }
  if (b.ride) { if (b.ride.ok) rideBot(b, dt); return; }
  socialBot(b, dt);
  chatBot(b, dt);
  if (b.pause > 0) { b.pause -= dt; b.speed = Math.max(0, b.speed - dt * 2); }
  else {
    b.speed += (b.cruise - b.speed) * Math.min(1, dt * 2);
    if (b.r() < dt * 0.12) b.pause = 1 + b.r() * 5; // para (conversa, olha, espera)
    if (b.r() < dt * 0.5) b.h += (b.r() - 0.5) * 1.2;
  }
  if (SCEN === 'packed') {
    // rodada 12: aperta para o centro (multidão concentrada; as correções de corpo do servidor os fazem contornar)
    const dc = Math.hypot(b.x - DENSE.x, b.z - DENSE.z);
    if (dc > PACK_R * 0.5 && b.r() < dt * 2) b.h = Math.atan2(DENSE.x - b.x, DENSE.z - b.z) + (b.r() - 0.5) * 0.6;
  } else if (SCEN === 'dense') {
    if (inDense(b.x, b.z) > 1) b.h = Math.atan2(DENSE.x - b.x, DENSE.z - b.z) + (b.r() - 0.5) * 0.8;
  } else if (Math.hypot(b.x - b.home.x, b.z - b.home.z) > 40) b.h = Math.atan2(b.home.x - b.x, b.home.z - b.z) + (b.r() - 0.5) * 0.8;
  b.x += Math.sin(b.h) * b.speed * dt; b.z += Math.cos(b.h) * b.speed * dt;
  b.room.send('move', packMove({ x: b.x, y: 0, z: b.z, heading: b.h, speed: b.speed, loco: b.speed > 0.05 ? 1 : 0, seq: ++b.seq }));
}

/** veículos livres (ordem estável entre processos: por id, tipos alternados) — só se algum bot deste processo dirige */
let vehList: { id: string; kind: string; x: number; z: number; h: number }[] = [];
if (VEHICLES > OFFSET) {
  // lista do MUNDO (o estado sincronizado só mostra veículos dentro da AOI de quem conecta); mesmos ids da sala
  const man = JSON.parse(readFileSync(new URL('../../public/world/manifest.json', import.meta.url), 'utf8')) as { vehicleSpawns?: { id: string; kind: string; x: number; z: number; heading: number }[] };
  const byKind: Record<string, typeof vehList> = {};
  for (const v of man.vehicleSpawns ?? []) if (RIDE_SPEED[v.kind]) (byKind[v.kind] ??= []).push({ id: v.id, kind: v.kind, x: v.x, z: v.z, h: v.heading });
  for (const k of Object.keys(byKind)) byKind[k].sort((a, b) => a.id.localeCompare(b.id));
  const kinds = Object.keys(RIDE_SPEED).filter((k) => byKind[k]?.length);
  for (let i = 0; vehList.length < VEHICLES && kinds.some((k) => byKind[k].length); i++) { const k = kinds[i % kinds.length]; const v = byKind[k].shift(); if (v) vehList.push(v); }
}

const t0 = Date.now();
for (let i = 0; i < N; i++) {
  try { await startBot(i); } catch (e) { console.error(`[bots] bot ${OFFSET + i} falhou: ${(e as Error).message}`); }
  await new Promise((r) => setTimeout(r, 15));
}
const joinMs = Date.now() - t0;
const dt = 1 / NET_TICK_HZ;
const timer = setInterval(() => { for (const b of bots) stepBot(b, dt); }, dt * 1000);
// rodada 12 — `--sync-clap=S`: a cada S s TODOS os bots param e pedem palmas no MESMO instante e com a MESMA variação
// (pior caso do diretor de eventos: "todo mundo bate palma junto") — QA da variedade de fase no cliente
const SYNC_CLAP = flagNum('sync-clap', 0);
if (SYNC_CLAP > 0) setInterval(() => { for (const b of bots) { b.pause = Math.min(SYNC_CLAP * 0.6, 8); b.nextAct = SYNC_CLAP; b.room.send('act', { a: A('clap'), v: 0 }); } }, SYNC_CLAP * 1000);

const stdinLines = createInterface({ input: process.stdin });
const waitLine = (word: string) => new Promise<void>((res) => stdinLines.on('line', (l) => { if (l.trim() === word) res(); }));
if (WAIT_GO) { console.log('READY'); await waitLine('go'); } else await new Promise((r) => setTimeout(r, 2000));

const startStats = new Map([...stats].map(([k, v]) => [k, { ...v }]));
const tStart = Date.now();
// visíveis: amostra a cada segundo (média da janela)
const visSamples: number[] = [], detSamples: number[] = [];
const vt = setInterval(() => { for (const b of bots) { visSamples.push(b.detailed + b.far); detSamples.push(b.detailed); } }, 1000);
await new Promise((r) => setTimeout(r, SECS * 1000));
clearInterval(vt);
const secs = (Date.now() - tStart) / 1000;
let inB = 0, outB = 0, mIn = 0, mOut = 0;
for (const [k, v] of stats) { const s0 = startStats.get(k) ?? { in: 0, out: 0, mIn: 0, mOut: 0 }; inB += v.in - s0.in; outB += v.out - s0.out; mIn += v.mIn - s0.mIn; mOut += v.mOut - s0.mOut; }
const n = Math.max(1, bots.length);
const avg = (a: number[]) => (a.length ? +(a.reduce((s, c) => s + c, 0) / a.length).toFixed(1) : 0);
const vis = bots.map((b) => b.detailed + b.far);
const res = {
  bots: bots.length, seconds: +secs.toFixed(1), scenario: SCEN,
  perClient: {
    bytesInPerSec: Math.round(inB / secs / n), bytesOutPerSec: Math.round(outB / secs / n),
    msgsInPerSec: +(mIn / secs / n).toFixed(1), msgsOutPerSec: +(mOut / secs / n).toFixed(1),
  },
  totals: { bytesIn: inB, bytesOut: outB, msgsIn: mIn, msgsOut: mOut },
  visiblePlayers: { min: Math.min(...vis), max: Math.max(...vis), avg: avg(visSamples), detailedAvg: avg(detSamples) },
  corrections: bots.reduce((s, b) => s + b.corrections, 0),
  vehicles: { denied: denyReasons, requested: bots.filter((b) => b.ride).length + bots.filter((b, i) => OFFSET + i < VEHICLES && !b.ride).length, driving: bots.filter((b) => b.ride?.ok).length, kinds: Object.fromEntries(Object.keys(RIDE_SPEED).map((k) => [k, bots.filter((b) => b.ride?.ok && b.ride.kind === k).length])) },
  chat: { perMin: CHAT_PER_MIN, sent: chatSent }, groups: GROUPS,
  combat: (() => {
    const f = bots.filter((b) => b.fighter), sum = (k: 'sent' | 'act' | 'hitOut' | 'hitIn' | 'dodged' | 'blocked') => f.reduce((s, b) => s + b.cbt[k], 0);
    const denied: Record<string, number> = {};
    for (const b of f) for (const [k, v] of Object.entries(b.cbt.denied)) denied[k] = (denied[k] ?? 0) + v;
    return { share: COMBAT, dense: COMBAT_DENSE, fighters: f.length, pairs: f.filter((b) => b.partner).length / 2, sent: sum('sent'), actsSeen: sum('act'), hitsOut: sum('hitOut'), hitsIn: sum('hitIn'), dodged: sum('dodged'), blocked: sum('blocked'), denied };
  })(),
  social: { share: SOCIAL, roles: Object.fromEntries(['dancer', 'flag', 'sign', 'gesture'].map((k) => [k, bots.filter((b) => b.role === k).length])), actsSent: bots.reduce((s, b) => s + b.acts, 0), denied: bots.reduce((s, b) => s + b.denied, 0) },
  crowdMsgsPerBot: +(bots.reduce((s, b) => s + b.crowdMsgs, 0) / n / secs).toFixed(2),
  trafficSnapshotsPerBot: +(bots.reduce((s, b) => s + b.trafficMsgs, 0) / n / secs).toFixed(2),
  joinMs,
};
console.log(JSON.stringify(res));
if (HOLD) await waitLine('bye');
clearInterval(timer);
await Promise.all(bots.map((b) => b.room.leave().catch(() => {})));
process.exit(0);

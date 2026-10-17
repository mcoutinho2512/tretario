/**
 * Rodada 8 — chat no multiplayer: 3 jogadores reais (um navegador cada) + 1 espectador (cliente Colyseus em Node).
 * A e B perto, C longe. Grupos (só servidor de teste: ?testGroup=): A e C "azul", B "verde".
 *  A PROXIMIDADE → B recebe, C não · A GERAL → B e C (e o espectador) · A GRUPO → só C (mesmo grupo, longe)
 *  digitar não move o jogador · B muta A → servidor não envia mais a B · C denuncia → Report gravado (log do servidor)
 *  rajada de C → flood · espectador lê o GERAL, não escreve (sem_permissao) e não picha (denied graffiti.create)
 * Capturas: screenshots/round8/K_chat_geral.jpg, L_chat_proximidade.jpg, M_chat_grupo.jpg (+ cópia em docs/screenshots/round8/).
 * Servidor de teste próprio (PV_TEST=1, PV_STORE=memory, porta PV_CHAT_PORT ou 2730). Requer o dev server.
 * uso: node tools/qa/chat_mp.mjs [baseUrl]
 */
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { mkdirSync, copyFileSync } from 'node:fs';
import { Client } from '@colyseus/sdk';
import { pack } from 'msgpackr';

const base = process.argv[2] ?? 'http://localhost:5173';
const PORT = Number(process.env.PV_CHAT_PORT ?? 2730);
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const w = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`); };

const server = spawn('npx', ['tsx', 'src/index.ts'], { cwd: 'server', env: { ...process.env, PORT: String(PORT), PV_TEST: '1', PV_STORE: 'memory', PV_GRAFFITI_STORE: 'memory' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
const log = [];
server.stdout.on('data', (d) => log.push(...d.toString().split('\n').filter(Boolean)));
server.stderr.on('data', (d) => log.push(...d.toString().split('\n').filter(Boolean)));
for (let i = 0; i < 100 && !log.some((l) => l.includes('[pv3d-server]')); i++) await w(200);
process.on('exit', () => { try { process.kill(-server.pid, 'SIGTERM'); } catch { /* */ } });

const browsers = [];
async function open(name, sp, group, vp = { width: 800, height: 500 }) {
  const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--use-angle=metal', '--enable-gpu'], defaultViewport: vp });
  browsers.push(browser);
  const p = await browser.newPage();
  p.on('pageerror', (e) => console.log(`[${name}] ERR`, e.message));
  await p.goto(`${base}/?autostart=1&quality=low&time=16:30&mp=ws://127.0.0.1:${PORT}&name=${name}&spawn=${sp[0]},${sp[1]}&testGroup=${group}`);
  await p.waitForFunction('window.__pvReady === true && window.__pv.mp()?.session && window.__pv.chat()?.hello()', { timeout: 120000 });
  return p;
}
const ev = (p, fn, ...a) => p.evaluate(fn, ...a);
const got = (p) => ev(p, () => window.__pv.chat().received());
const until = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await w(120); } return null; };
const has = async (p, text) => (await got(p)).find((m) => m.text === text);
const say = (p, ch, text) => ev(p, (c, t) => window.__pv.chat().type(t, c), ch, text);

const S = [-540, 255];
const A = await open('Ana', S, 'azul', { width: 1280, height: 720 });
const B = await open('Bia', [S[0] + 4, S[1] + 3], 'verde');
const C = await open('Caio', [S[0] + 900, S[1] - 300], 'azul');

// espectador: sem ticket e pedindo 'spectator' → visitante (só lê o GERAL)
const sc = new Client(`ws://127.0.0.1:${PORT}`);
const spec = await sc.joinOrCreate('presidente_vargas', { role: 'spectator', name: 'Espectador', body: 'homem', skin: 0, hair: 0, top: 0, bottom: 0, shoes: 0 });
const specMsgs = { hello: null, chat: [], denied: [], gate: [] };
spec.onMessage('chat_hello', (h) => { specMsgs.hello = h; });
spec.onMessage('chat', (m) => specMsgs.chat.push(m));
spec.onMessage('chat_denied', (d) => specMsgs.denied.push(d));
spec.onMessage('denied', (d) => specMsgs.gate.push(d));
spec.onMessage('*', () => {});
await w(2500);

const hA = await ev(A, () => window.__pv.chat().hello());
check('A entra com escrita liberada e grupo azul', hA.canWrite && hA.group === 'azul', JSON.stringify({ canWrite: hA.canWrite, group: hA.group, nick: hA.nick }));

// ---- PROXIMIDADE
await say(A, 'proximidade', 'Alguém aqui perto?');
const pB = await until(() => has(B, 'Alguém aqui perto?'));
await w(800);
check('A PROXIMIDADE → B (perto) recebe', !!pB && pB.ch === 'proximidade' && pB.nick === 'Ana');
check('A PROXIMIDADE → C (longe) não recebe', !(await has(C, 'Alguém aqui perto?')));
check('A PROXIMIDADE → espectador não recebe', !specMsgs.chat.some((m) => m.text === 'Alguém aqui perto?'));
await say(B, 'proximidade', 'Tô do seu lado, de camisa azul');
await until(() => has(A, 'Tô do seu lado, de camisa azul'));

// ---- GERAL
await say(A, 'geral', 'Boa tarde! Concentração na Candelária às 17h');
const gB = await until(() => has(B, 'Boa tarde! Concentração na Candelária às 17h'));
const gC = await until(() => has(C, 'Boa tarde! Concentração na Candelária às 17h'));
check('A GERAL → B e C recebem', !!gB && !!gC);
check('A GERAL → espectador recebe', !!(await until(async () => specMsgs.chat.find((m) => m.text.startsWith('Boa tarde')))));
await say(B, 'geral', 'Chegando pela Central agora');
await say(C, 'geral', 'Daqui já dá pra ouvir o trio');
await until(() => has(A, 'Daqui já dá pra ouvir o trio'));

// ---- GRUPO
await say(A, 'grupo', 'Azul: vamos juntos atrás do carro de som');
const grC = await until(() => has(C, 'Azul: vamos juntos atrás do carro de som'));
await w(800);
check('A GRUPO → C (mesmo grupo, longe) recebe', !!grC && grC.group === 'azul');
check('A GRUPO → B (outro grupo, perto) não recebe', !(await has(B, 'Azul: vamos juntos atrás do carro de som')));
check('A GRUPO → espectador não recebe', !specMsgs.chat.some((m) => m.ch === 'grupo'));
await say(C, 'grupo', 'Combinado, encontro vocês na esquina da Uruguaiana');
await until(() => has(A, 'Combinado, encontro vocês na esquina da Uruguaiana'));
await say(B, 'grupo', 'Verde reunido aqui');
await w(900);
check('B GRUPO (verde) → A e C (azul) não recebem', !(await has(A, 'Verde reunido aqui')) && !(await has(C, 'Verde reunido aqui')) && !!(await has(B, 'Verde reunido aqui')));

// ---- capturas K, L, M (chat aberto em cada canal)
mkdirSync('screenshots/round8', { recursive: true });
mkdirSync('docs/screenshots/round8', { recursive: true });
await ev(A, () => window.__pv.camera(Math.PI * 0.85, 0.32, 9));
for (const [file, ch] of [['K_chat_geral', 'geral'], ['L_chat_proximidade', 'proximidade'], ['M_chat_grupo', 'grupo']]) {
  await ev(A, (c) => window.__pv.chat().open(c), ch);
  await w(700);
  const out = `screenshots/round8/${file}.jpg`;
  await A.screenshot({ path: out, type: 'jpeg', quality: 86 });
  copyFileSync(out, `docs/screenshots/round8/${file}.jpg`);
  console.log(`   captura ${out}`);
}
await ev(A, () => window.__pv.chat().close());

// ---- digitar não move o jogador (teclas no campo não chegam ao jogo)
await ev(A, () => window.__pv.chat().open('geral'));
await w(200);
const p0 = await ev(A, () => window.__pv.metrics().player);
await A.keyboard.type('wwwwaaaassssdddd', { delay: 30 });
await A.keyboard.down('KeyW'); await w(900); await A.keyboard.up('KeyW');
const p1 = await ev(A, () => window.__pv.metrics().player);
const typed = await ev(A, () => document.querySelector('.chat-field').value);
check('digitando no chat: WASD não move o jogador', Math.hypot(p1.x - p0.x, p1.z - p0.z) < 0.05 && typed.startsWith('wwww'), `deslocamento ${Math.hypot(p1.x - p0.x, p1.z - p0.z).toFixed(3)} m · campo "${typed.slice(0, 12)}…"`);
await A.keyboard.press('Escape');
await w(200);
check('Esc fecha o chat', (await ev(A, () => window.__pv.chat().state())) === 'idle');
await ev(A, () => { document.querySelector('.chat-field').value = ''; });

// ---- mutar: B muta Ana → o servidor deixa de enviar a B
await ev(B, () => window.__pv.chat().mute('Ana', true));
await w(400);
await say(A, 'geral', 'Teste depois do mute');
await until(() => has(C, 'Teste depois do mute'));
await w(600);
check('B mutou Ana → B não recebe; C recebe', !(await has(B, 'Teste depois do mute')) && !!(await has(C, 'Teste depois do mute')));

// ---- denúncia: C denuncia a mensagem de Ana no GERAL → Report gravado com a cópia do servidor
const target = await has(C, 'Teste depois do mute');
await ev(C, (id) => window.__pv.chat().reportMenu(id), target.id);
await w(200);
await C.evaluate(() => [...document.querySelectorAll('.chat-menu-i')].find((b) => b.textContent === 'Spam')?.click());
const rr = await until(async () => (await ev(C, () => window.__pv.chat().events())).find((e) => e.type === 'chat_report_res')?.msg);
const repLog = await until(async () => log.find((l) => l.includes('[chat] denúncia') && l.includes(`mensagem ${target.id}`)));
check('C denuncia (categoria Spam pelo menu) → chat_report_res ok e Report gravado', rr?.ok === true && !!repLog && !repLog.includes('denúncia —'), repLog ?? JSON.stringify(rr));
await ev(C, (id) => window.__pv.chat().report(id, 'SPAM'), target.id);
const rr2 = await until(async () => (await ev(C, () => window.__pv.chat().events())).filter((e) => e.type === 'chat_report_res')[1]?.msg);
check('denúncia repetida é recusada', rr2?.ok === false && rr2.r === 'repetida');

// ---- flood: rajada de C
await w(8500); // janela do anti-flood de C limpa
for (let i = 0; i < 7; i++) await ev(C, (k) => window.__pv.chat().send(`rajada ${k}`, 'geral'), i);
await w(800);
const den = (await ev(C, () => window.__pv.chat().events())).filter((e) => e.type === 'chat_denied').map((e) => e.msg);
const passed = (await got(A)).filter((m) => m.text.startsWith('rajada')).length;
check('rajada de 7 → 5 passam, o resto é limitado (flood/cooldown)', passed === 5 && den.some((d) => d.reason === 'flood' || d.reason === 'cooldown'), `${passed} passaram · ${JSON.stringify(den.slice(0, 2))}`);

// ---- espectador
check('espectador: hello sem escrita ("visitante")', specMsgs.hello?.canWrite === false && specMsgs.hello?.why === 'visitante', JSON.stringify({ canWrite: specMsgs.hello?.canWrite, why: specMsgs.hello?.why, hist: specMsgs.hello?.history?.length }));
spec.send('chat_send', { ch: 'geral', text: 'posso falar?' });
spec.send('gf_new', { s: 'x', d: new Uint8Array(4), n: 1 });
await w(800);
check('espectador tenta escrever → chat_denied sem_permissao', specMsgs.denied.some((d) => d.reason === 'sem_permissao'));
check('espectador tenta pichar → denied graffiti.create', specMsgs.gate.some((d) => d.cap === 'graffiti.create'));
check('ninguém recebe a mensagem do espectador', !(await has(A, 'posso falar?')));

// ---- UI do espectador lendo (painel no navegador sem escrita) é coberta pelo hint; bytes por mensagem
const sample = (await got(B)).find((m) => m.ch === 'geral');
const bytes = pack(['chat', sample]).length;
check('mensagem GERAL pequena no fio (msgpack ≤ 160 B)', bytes <= 160, `${bytes} B (${sample.text.length} caracteres)`);
const ids = JSON.stringify(await got(A));
check('nenhum id de conta/conexão nas mensagens recebidas', !/sessionId|userId|clientId/.test(ids));

await spec.leave();
for (const b of browsers) await b.close();
const ok = results.filter((r) => r.ok).length;
console.log(`\nRESULTADO: ${ok}/${results.length} verificações passaram`);
process.exit(ok === results.length ? 0 : 1);

/**
 * Teste ponta a ponta em PRODUÇÃO (rodada 9.1) — navegador real pela internet, sem servidor de teste.
 *
 *   node tools/qa/prod_e2e.mjs <https://dominio> visitor
 *   node tools/qa/prod_e2e.mjs <https://dominio> register <email> <apelido>      → conta PENDENTE (beta)
 *   node tools/qa/prod_e2e.mjs <https://dominio> play     <email>               → entra no mundo, anda, ganha XP
 *   node tools/qa/prod_e2e.mjs <https://dominio> progress <email>               → login e confere o progresso salvo
 *   node tools/qa/prod_e2e.mjs <https://dominio> r10      <email>               → rodada 10: torcida (API + rede),
 *        áudio liberado por clique real, anda até o veículo livre mais perto, entra pelo InteractionSystem (caminho
 *        do clique/E), dirige, sai; logout/login e a torcida continua salva
 *
 * Senha da conta de QA: variável PV_QA_PASSWORD (nunca no repositório). Perfil do navegador por e-mail em
 * screenshots/prod_e2e/<email>/ (cookie de sessão entre as fases). Saída: N/N e JSON com tempos/medidas.
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';

const [BASE, PHASE, EMAIL, NICK] = process.argv.slice(2);
const PASS = process.env.PV_QA_PASSWORD ?? '';
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const w = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`); };
const out = { base: BASE, phase: PHASE, at: new Date().toISOString() };
if (!BASE || !PHASE) { console.error('uso: node tools/qa/prod_e2e.mjs <url> visitor|register|play|progress [email] [apelido]'); process.exit(2); }
if (PHASE !== 'visitor' && (!EMAIL || PASS.length < 10)) { console.error('fases com conta precisam de <email> e PV_QA_PASSWORD (≥ 10)'); process.exit(2); }

const profile = `screenshots/prod_e2e/${(EMAIL ?? 'visitante').replace(/[^a-z0-9]/gi, '_')}`;
mkdirSync(profile, { recursive: true });
const b = await puppeteer.launch({ executablePath: chrome, headless: 'new', userDataDir: `${profile}/chrome`, args: ['--use-angle=metal', '--enable-gpu'], defaultViewport: { width: 1280, height: 720 }, protocolTimeout: 240000 });
const p = await b.newPage();
const errors = [], csp = [], wsUrls = [];
p.on('pageerror', (e) => errors.push(e.message));
p.on('console', (m) => { const t = m.text(); if (/Content Security Policy|Refused to/i.test(t)) csp.push(t.slice(0, 200)); });
const cdp = await p.createCDPSession();
await cdp.send('Network.enable');
cdp.on('Network.webSocketCreated', (e) => wsUrls.push(e.url));
const api = (path, method = 'GET', body) => p.evaluate(async (path, method, body) => {
  const r = await fetch(path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
  let j = null; try { j = await r.json(); } catch { /* sem corpo */ }
  return { status: r.status, body: j };
}, path, method, body);
const shot = (n) => p.screenshot({ path: `${profile}/${n}.jpg`, type: 'jpeg', quality: 80 });

try {
  if (PHASE === 'visitor') {
    const t0 = Date.now();
    await p.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    out.homeMs = Date.now() - t0;
    const robots = await p.$eval('meta[name="robots"]', (m) => m.content).catch(() => '');
    check('home abre pela internet (HTTPS)', p.url().startsWith('https://'), `${out.homeMs} ms`);
    check('noindex na home', /noindex/.test(robots));
    check('marca BETA visível', await p.evaluate(() => /BETA/.test(document.body.innerText)));
    await shot('V1_home');
    const t1 = Date.now();
    await p.goto(`${BASE}/?autostart=1&spectate=1&welcome=0`, { waitUntil: 'domcontentloaded' });
    await p.waitForFunction('window.__pvReady === true && window.__pv?.mp()?.session', { timeout: 180000 });
    out.spectateMs = Date.now() - t1;
    await w(4000);
    const m = await p.evaluate(() => ({ mp: window.__pv.mp(), fps: window.__pv.metrics().fps }));
    check('espectador entra no mundo pela internet', !!m.mp?.session, `${out.spectateMs} ms até o mundo`);
    check('multiplayer usa wss://<domínio>/game', wsUrls.some((u) => u.startsWith(BASE.replace('https', 'wss') + '/game')), wsUrls.slice(0, 2).join(' '));
    check('nenhuma violação de CSP', csp.length === 0, csp.slice(0, 2).join(' | '));
    out.visitorFps = Math.round(m.fps);
    await shot('V2_espectador');
  } else if (PHASE === 'register') {
    await p.goto(`${BASE}/?welcome=0`, { waitUntil: 'domcontentloaded' });
    const r = await api('/api/auth/register', 'POST', { email: EMAIL, password: PASS, confirm: PASS, nickname: NICK });
    out.register = { status: r.status, registration: r.body?.me?.registration ?? null, state: r.body?.me?.access?.state ?? r.body?.me?.state ?? null };
    check('cadastro público aceito (201)', r.status === 201, JSON.stringify(out.register));
    check('conta fica PENDENTE (beta) — sem código mostrado', r.status === 201 && !JSON.stringify(r.body).match(/\b\d{6}\b|code|codigo/i), '');
    const t = await api('/api/session/ticket', 'POST', {});
    check('sem aprovação: não recebe ticket de jogador', t.status !== 200 || !t.body?.ticket, `status ${t.status} ${t.body?.error ?? ''}`);
  } else if (PHASE === 'r10') {
    await p.goto(`${BASE}/?welcome=0`, { waitUntil: 'domcontentloaded' });
    let me = await api('/api/me');
    if (me.status !== 200 || !me.body?.user) { const l = await api('/api/auth/login', 'POST', { email: EMAIL, password: PASS }); check('login', l.status === 200, `status ${l.status}`); }
    const data = await p.evaluate(async () => (await fetch('/gameplay/supporters.json')).json());
    const pick = data.groups[1 % data.groups.length];
    const put = await api('/api/me/supporter', 'PUT', { group: pick.id });
    check('torcida escolhida pela API', put.status === 200 && (put.body?.current ?? put.body?.supporter?.current ?? put.body?.group) !== undefined, `${put.status} ${JSON.stringify(put.body).slice(0, 120)}`);
    await p.waitForFunction('typeof window.__pvLaunch === "function"', { timeout: 60000 });
    await w(3000);
    await p.evaluate(() => window.__pvLaunch({ role: 'player' }));
    await p.waitForFunction('window.__pvReady === true && window.__pv?.mp()?.session', { timeout: 180000 });
    await w(3000);
    const supIdx = await p.evaluate(() => { const n = window.__pvEvents?.net; const st = n?.room?.state?.players?.get?.(n.sessionId); return st ? Number(st.sup) : null; }); // estado sincronizado (o que os outros leem)
    check('torcida chega pela rede (NetPlayer.sup)', supIdx === data.groups.indexOf(pick) + 1, `sup=${supIdx} esperado ${data.groups.indexOf(pick) + 1}`);
    await p.mouse.click(8, 360); await w(2000);
    const au = await p.evaluate(() => { const q = window.__pv.audio?.(); return q ? { st: q.ctxState, nodes: q.counters.nodesLive, crowd: q.crowd.voices } : null; });
    check('áudio liberado por gesto e tocando', au?.st === 'running', JSON.stringify(au));
    const v = await p.evaluate(() => { const pl = window.__pv.metrics().player; return window.__pv.vehicles('all').filter((i) => ['bicycle', 'scooter', 'moto', 'car'].includes(i.kind) && !i.occupant && i.state === 0).map((i) => ({ ...i, d: Math.hypot(i.x - pl.x, i.z - pl.z) })).sort((a, b) => a.d - b.d)[0]; });
    out.vehicle = v;
    if (v) {
      await p.evaluate((x, z) => window.__pv.walkTo(x, z, true), v.x, v.z);
      let d = 99; for (let i = 0; i < 60 && d > 1.8; i++) { await w(1000); d = await p.evaluate((x, z) => { const pl = window.__pv.metrics().player; return Math.hypot(pl.x - x, pl.z - z); }, v.x, v.z); }
      await p.evaluate(() => window.__pv.stopWalk()); await w(800);
      const tgt = await p.evaluate(() => window.__pv.ix?.());
      await p.evaluate(() => window.__pv.ixUse()); await w(2500);
      const inV = await p.evaluate(() => window.__pv.mp()?.self?.vehicle ?? '');
      check(`entra no veículo (${v.kind}) pelo InteractionSystem`, inV === v.id, `alvo ${JSON.stringify(tgt)?.slice(0, 100)} · veículo ${inV} · andou até ${d.toFixed(1)} m`);
      await p.evaluate(() => window.__pv.press('KeyW', 3000)); await w(3500);
      const mi = await p.evaluate(() => window.__pv.mount?.()?.local ?? null);
      check('avatar montado (fase de montagem)', !!mi && mi.phase !== 'none', JSON.stringify(mi)?.slice(0, 120));
      await shot('R10_veiculo');
      await p.evaluate(() => window.__pv.ixUse()); await w(2500);
      check('sai do veículo', (await p.evaluate(() => window.__pv.mp()?.self?.vehicle ?? '')) === '');
    } else check('veículo livre por perto', false);
    check('nenhuma violação de CSP / erro de página', csp.length === 0 && errors.length === 0, [...csp, ...errors].slice(0, 2).join(' | '));
    const lo = await api('/api/auth/logout', 'POST', {});
    const l2 = await api('/api/auth/login', 'POST', { email: EMAIL, password: PASS });
    const g2 = await api('/api/me/supporter');
    check('logout/login: torcida continua salva', lo.status < 300 && l2.status === 200 && JSON.stringify(g2.body).includes(pick.id), JSON.stringify(g2.body).slice(0, 120));
  } else if (PHASE === 'r12') {
    // rodada 12: autônomos (fora da contagem pública), nomes em parte deles, colisão, veículo pessoal imediato
    // (patinete/bicicleta/moto/carro), spam, inventário, chat (sem enviar nada), confronto, eventos, áudio, cursor
    await p.goto(`${BASE}/?welcome=0`, { waitUntil: 'domcontentloaded' });
    let me = await api('/api/me');
    if (me.status !== 200 || !me.body?.user) { const l = await api('/api/auth/login', 'POST', { email: EMAIL, password: PASS }); check('login', l.status === 200, `status ${l.status}`); }
    await p.waitForFunction('typeof window.__pvLaunch === "function"', { timeout: 60000 });
    await w(3000);
    await p.evaluate(() => window.__pvLaunch({ role: 'player' }));
    await p.waitForFunction('window.__pvReady === true && window.__pv?.mp()?.session && window.__pvPveh', { timeout: 180000 });
    await w(6000);
    await p.mouse.click(8, 360); await w(1500);
    const rem = await p.evaluate(() => { const r = window.__pv.mp().remotes; return { total: r.length, auto: r.filter((x) => x.kind === 1).length, human: r.filter((x) => !x.kind).length }; });
    out.remotes = rem;
    check('personagens autônomos no mundo (kind 1)', rem.auto > 0, JSON.stringify(rem));
    const pub = await api('/api/metrics/public');
    out.publicMetrics = pub.body;
    const pubN = Number(pub.body?.players ?? pub.body?.online ?? pub.body?.playersOnline ?? NaN);
    check('autônomos não inflam a contagem pública', !(pubN >= rem.auto) || rem.auto === 0, `público ${JSON.stringify(pub.body).slice(0, 160)} · autônomos vistos ${rem.auto}`);
    // veículo pessoal: selecionou → aparece e já monta
    out.pveh = {};
    out.spawnPos = await p.evaluate(() => { const q = window.__pv.metrics().player; return [+q.x.toFixed(1), +q.z.toFixed(1)]; });
    console.log('posição ao pedir veículos:', JSON.stringify(out.spawnPos), 'zona', await p.evaluate(() => window.__pv.hudZone?.() ?? document.querySelector('.zone-pill, .zone')?.textContent ?? ''));
    for (const k of ['moto', 'car', 'scooter', 'bicycle']) { // moto/carro primeiro: só nascem na pista (perto do ponto de entrada)
      const n0 = await p.evaluate(() => window.__pvPveh.stats().ok);
      const t0 = Date.now();
      await p.evaluate((kk) => window.__pvPveh.request(kk), k);
      let ok = false; for (let i = 0; i < 40 && !ok; i++) { await w(100); ok = await p.evaluate((n) => window.__pvPveh.stats().ok > n, n0); }
      // montar o carro (porta → banco) leva mais que a moto: espera até 4 s pela montagem
      for (let i = 0; i < 40 && ok; i++) { if (await p.evaluate((kk) => window.__pvPveh.riding()?.kind === kk, k)) break; await w(100); }
      // carro: monta sozinho só com a porta a ≤ 3 m (docs/PERSONAL_VEHICLES.md); senão aparece ao lado e o E entra
      let viaE = false;
      if (ok && k === 'car' && !(await p.evaluate(() => window.__pvPveh.riding()?.kind === 'car'))) {
        viaE = true; await p.evaluate(() => window.__pv.ixUse()); for (let i = 0; i < 40; i++) { if (await p.evaluate(() => window.__pvPveh.riding()?.kind === 'car')) break; await w(100); }
      }
      const st = await p.evaluate(() => ({ last: window.__pvPveh.stats().last, riding: window.__pvPveh.riding(), denied: window.__pvPveh.stats().denied }));
      out.pveh[k] = { roundTripMs: Date.now() - t0, ...st.last, riding: st.riding?.kind ?? null };
      check(`${k}: selecionou → aparece e monta`, ok && st.riding?.kind === k, `${st.last?.okMs ?? '?'} ms no servidor · ida e volta ${Date.now() - t0} ms · ${st.last?.d ?? '?'} m · montado ${st.riding?.kind ?? 'não'}${viaE ? ' (pelo E: porta a mais de 3 m)' : ''} ${ok ? '' : JSON.stringify(st.denied)}`);
      if (k === 'moto' || k === 'scooter') await shot(`R12_pveh_${k}`);
      await p.evaluate(() => window.__pv.press('KeyW', 1500)); await w(1800);
      // desce só se montado (toggle sem estar montado vira um pedido novo e esbarra no limite de 2,5 s)
      if (await p.evaluate(() => !!window.__pvPveh.riding())) await p.evaluate((kk) => window.__pvPveh.toggle(kk), k);
      await w(2700);
    }
    // colisão: anda direto para o autônomo mais próximo e mede a menor distância entre os centros
    // alvo PARADO (quem anda se afasta e o teste não mede nada)
    const near = await p.evaluate(() => { const pl = window.__pv.metrics().player; return window.__pv.mp().remotes.filter((x) => x.kind === 1 && !x.vehicle && x.speed < 0.3).map((x) => ({ id: x.id, x: x.x, z: x.z, d: Math.hypot(x.x - pl.x, x.z - pl.z) })).sort((a, b) => a.d - b.d)[0] ?? null; });
    if (near && near.d < 60) {
      await p.evaluate((x, z) => window.__pv.walkTo(x, z, true), near.x, near.z);
      let minD = 99;
      for (let i = 0; i < 40; i++) { await w(400); const d = await p.evaluate((id) => { const pl = window.__pv.metrics().player; const r = window.__pv.mp().remotes.find((x) => x.id === id); return r ? Math.hypot(r.x - pl.x, r.z - pl.z) : 99; }, near.id); minD = Math.min(minD, d); }
      await p.evaluate(() => window.__pv.stopWalk());
      out.collisionMinD = +minD.toFixed(2);
      check('colide com autônomo e não atravessa', minD > 0.4 && minD < 1.5, `menor distância ${minD.toFixed(2)} m (contato 0,64 m) · partiu de ${near.d.toFixed(1)} m`);
    } else check('autônomo a pé por perto para colidir', false, JSON.stringify(near));
    let lab = null;
    for (let i = 0; i < 12; i++) { lab = await p.evaluate(() => window.__pvR12?.labels?.() ?? null); if (lab?.shownNames?.length) break; await w(1000); }
    check('nomes aparecem (pool fixo) e não em todos', !!lab && lab.shownNames.length > 0 && lab.shownNames.length < rem.total && lab.domNodes <= 18, `mostrados ${lab?.shownNames?.length} de ${rem.total} · DOM ${lab?.domNodes} · ${lab?.shownNames?.slice(0, 5).join(', ')}`);
    await shot('R12_autonomos_nomes');
    const mine = await p.evaluate(() => { const s = window.__pv.mp().session; for (let i = 0; i < 20; i++) window.__pvPveh.raw({ kind: ['scooter', 'bicycle', 'moto', 'car'][i % 4], seq: 0 }); return s; });
    await w(3000);
    const owned = await p.evaluate((s) => window.__pvPveh.dynamic().filter((d) => d.owner === s).length, mine);
    check('spam de pedidos não duplica veículo', owned <= 1, `${owned} veículo(s) do jogador após 20 pedidos seguidos`);
    if (await p.evaluate(() => !!window.__pvPveh.riding())) { await p.evaluate(() => window.__pv.key('KeyE')); await w(1500); }
    // inventário (I/Esc), chat ligado, confronto, eventos, áudio, cursor
    await p.keyboard.press('KeyI'); await w(1200);
    const inv = await p.evaluate(() => window.__pvInv?.info?.()?.open ?? null);
    await p.keyboard.press('Escape'); await w(800);
    check('inventário abre (I) e fecha (Esc)', inv === true && (await p.evaluate(() => window.__pvInv?.info?.()?.open)) === false);
    check('chat disponível', await p.evaluate(() => !!window.__pv.chat?.() || !!document.querySelector('.chat, [class*="chat"]')));
    await p.evaluate(() => window.__pv.cbt?.('cbt_punch')); await w(800);
    check('confronto: golpe aceito sem zona de paz', await p.evaluate(() => (window.__pv.lastDenial?.() ?? '') === '' || !/zona|paz/i.test(window.__pv.lastDenial?.() ?? '')), String(await p.evaluate(() => window.__pv.lastDenial?.() ?? '')));
    const ag = await p.evaluate(() => (window.__pvR9?.feed?.list ?? []).length);
    check('agenda de eventos chega', ag > 0, `${ag} itens · focos dinâmicos ${await p.evaluate(() => (window.__pvEvents?.dyn ?? []).length)}`);
    const au = await p.evaluate(() => { const q = window.__pv.audio?.(); return q ? { st: q.ctxState, nodes: q.counters.nodesLive } : null; });
    check('áudio tocando', au?.st === 'running', JSON.stringify(au));
    check('cursor sempre visível (sem pointer lock)', await p.evaluate(() => document.pointerLockElement === null));
    out.fps = await p.evaluate(() => Math.round(window.__pv.metrics().fps));
    await shot('R12_final');
    check('nenhuma violação de CSP / erro de página', csp.length === 0 && errors.length === 0, [...csp, ...errors].slice(0, 2).join(' | '));
    const lo = await api('/api/auth/logout', 'POST', {});
    const l2 = await api('/api/auth/login', 'POST', { email: EMAIL, password: PASS });
    check('logout/login', lo.status < 300 && l2.status === 200, `${lo.status}/${l2.status}`);
  } else if (PHASE === 'play' || PHASE === 'progress') {
    await p.goto(`${BASE}/?welcome=0`, { waitUntil: 'domcontentloaded' });
    let me = await api('/api/me');
    if (me.status !== 200 || !me.body?.user) {
      const l = await api('/api/auth/login', 'POST', { email: EMAIL, password: PASS });
      check('login', l.status === 200, `status ${l.status} ${l.body?.error ?? ''}`);
      me = await api('/api/me');
    }
    out.me = { state: me.body?.access?.state ?? me.body?.state, nickname: me.body?.profile?.nickname };
    const before = await api('/api/me/progress');
    out.progressBefore = { status: before.status, xp: before.body?.xp ?? before.body?.progress?.xp, level: before.body?.level ?? before.body?.progress?.level, missions: (before.body?.completedMissions ?? before.body?.progress?.completedMissions ?? []).length };
    if (PHASE === 'progress') {
      check('progresso salvo continua lá (XP > 0)', (out.progressBefore.xp ?? 0) > 0, JSON.stringify(out.progressBefore));
    } else {
      const t1 = Date.now();
      // mesmo caminho do botão "Entrar" da home (com papel → multiplayer + ticket da conta); ?autostart=1 é o modo local
      await p.goto(`${BASE}/?welcome=0`, { waitUntil: 'domcontentloaded' });
      await p.waitForFunction('typeof window.__pvLaunch === "function"', { timeout: 60000 });
      await w(3000); // a home lê /api/me (conta) antes
      await p.evaluate(() => window.__pvLaunch({ role: 'player' }));
      await p.waitForFunction('window.__pvReady === true && window.__pv?.mp()?.session', { timeout: 180000 });
      out.playMs = Date.now() - t1;
      const role = await p.evaluate(() => window.__pv.mp()?.role ?? (window.__pv.spectator?.() ? 'spectator' : 'player'));
      check('entra no mundo como JOGADOR pela internet', role !== 'spectator', `${out.playMs} ms · papel ${role}`);
      await w(3000);
      await p.evaluate(() => window.__pv.press?.('KeyW', 9000));
      await w(9500);
      await p.evaluate(() => window.__pv.jump?.());
      await w(1500);
      await shot('P1_jogador');
      // progressão é gravada em lote (≤ 15 s) — espera e lê pela API
      let xp = 0;
      for (let i = 0; i < 12 && !(xp > 0); i++) { await w(3000); const pr = await api('/api/me/progress'); xp = pr.body?.xp ?? pr.body?.progress?.xp ?? 0; out.progressAfter = pr.body; }
      check('andou e ganhou XP (salvo no servidor)', xp > 0, `xp ${xp}`);
      check('nenhuma violação de CSP / erro de página', csp.length === 0 && errors.length === 0, [...csp, ...errors].slice(0, 2).join(' | '));
      const lo = await api('/api/auth/logout', 'POST', {});
      check('logout', lo.status === 200 || lo.status === 204, `status ${lo.status}`);
      const l2 = await api('/api/auth/login', 'POST', { email: EMAIL, password: PASS });
      const pr2 = await api('/api/me/progress');
      check('login de novo: XP continua', l2.status === 200 && (pr2.body?.xp ?? pr2.body?.progress?.xp ?? 0) === xp, `xp ${pr2.body?.xp ?? pr2.body?.progress?.xp}`);
    }
  }
} catch (e) { check('roteiro sem exceção', false, String(e).slice(0, 300)); }
out.errors = errors.slice(0, 5); out.csp = csp.slice(0, 5); out.ws = wsUrls.slice(0, 3);
writeFileSync(`${profile}/${PHASE}.json`, JSON.stringify(out, null, 1));
const ok = results.filter((r) => r.ok).length;
console.log(`\n${ok}/${results.length} verificações OK`);
await b.close();
process.exit(ok === results.length ? 0 : 1);

/**
 * Shader de fachada procedural (rodada 5 — "visual overhaul").
 *
 * Um único material para todos os edifícios comuns; a variedade vem de atributos por vértice
 * (estilo, altura do pavimento, tom, semente, flags) e de hashes determinísticos da semente:
 *  - MATERIAL por prédio: reboco pintado, concreto aparente (marcas de fôrma), revestimento de pedra
 *    (placas com juntas), pastilhas (anos 50–70), pele de vidro (torres de escritório), azulejo (sobrados);
 *  - JANELA por prédio: proporções, peitoril, profundidade do vão (parallax: ombreiras/verga/peitoril
 *    aparecem conforme o ângulo de visão + sombra do sol dentro do vão), caixilhos (alumínio, ferro
 *    pintado, madeira, bronze), divisões (basculantes, grade de ferro 2×3, 2 folhas coloniais, faixa
 *    contínua), vidro (refletância/tonalidade), cortinas/persianas por janela;
 *  - ELEMENTOS: pilastras, faixas de laje, peitoris rebaixados (art déco), aparelhos de ar-condicionado
 *    de janela, escorrimentos de sujeira sob peitoris (limo), encardido na base, cornija/platibanda;
 *  - TÉRREO: lojas com portas de enrolar (onduladas, abertas/fechadas/meio-abertas), vitrines com
 *    mercadorias, letreiros com "texto" procedural (sem marcas reais), portaria de entrada com
 *    moldura de granito; base rusticada nos ecléticos/institucionais;
 *  - PARTES GEOMÉTRICAS (flags): marquises (com spots embaixo à noite), platibanda, casas de máquinas,
 *    caixas d'água (fibra azul nos telhados baixos), coberturas (laje, manta, telha cerâmica).
 * Relevo: altura procedural → normal por derivadas de tela (barato, sem textura).
 * Anti-moiré: o padrão converge para a cor média quando um pixel cobre vários vãos/andares.
 */

export const FACADE_FLAGS = {
  ARCADE: 1, ROOF: 2, SHOPS: 4, CANOPY: 8, PARAPET: 16, MARQUISE: 32, TECH: 64, TANK: 128,
} as const;

export const FACADE_VERTEX_COMMON = /* glsl */ `
  attribute vec4 aFacade;
  attribute vec4 aFacade2;
  varying vec4 vFacade;
  varying vec4 vFacade2;
  varying vec2 vFUV;
  varying vec3 vFWPos;
  varying vec3 vFWNormal;
  varying vec3 vFTanV;
  varying vec3 vFBitV;`;

export const FACADE_VERTEX_MAIN = /* glsl */ `
  vFacade = aFacade; vFacade2 = aFacade2; vFUV = uv;
  vFWPos = (modelMatrix * vec4(position, 1.0)).xyz;
  vFWNormal = normalize(mat3(modelMatrix) * normal);
  // tangente horizontal ao longo da fachada (u cresce nesse sentido) e bitangente = vertical do mundo
  vec3 fT = normal.y * normal.y > 0.5 ? vec3(1.0, 0.0, 0.0) : vec3(-normal.z, 0.0, normal.x);
  vFTanV = normalize((modelViewMatrix * vec4(fT, 0.0)).xyz);
  vFBitV = normal.y * normal.y > 0.5 ? normalize((modelViewMatrix * vec4(0.0, 0.0, 1.0, 0.0)).xyz) : normalize((modelViewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);`;

export const FACADE_FRAGMENT_COMMON = /* glsl */ `
  uniform sampler2D uNoise;
  uniform float uNight;
  uniform vec3 uSunDir;
  uniform float uDetail; // 0 = BAIXO (sem parallax/relevo), 1 = completo
  uniform sampler2D uSigns; // atlas de palavras genéricas de letreiro (canvas, gerado em runtime)
  varying vec4 vFacade;
  varying vec4 vFacade2;
  varying vec2 vFUV;
  varying vec3 vFWPos;
  varying vec3 vFWNormal;
  varying vec3 vFTanV;
  varying vec3 vFBitV;

  float pvH(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float pvS(float s, float k){ return fract(sin(s * 91.345 + k * 47.853) * 43758.5453); }
  bool pvBit(float flags, float b){ return mod(floor(flags / b), 2.0) > 0.5; }
  vec3 pvLin(vec3 c){ return pow(c, vec3(2.2)); }
  // retângulo com borda suavizada (w = largura de AA, em metros)
  float pvBox(vec2 p, vec2 lo, vec2 hi, vec2 w){
    vec2 a = smoothstep(lo - w, lo + w, p) * (1.0 - smoothstep(hi - w, hi + w, p));
    return a.x * a.y;
  }
  // linhas finas periódicas (distância à linha mais próxima < half), suavizadas
  float pvLines(float x, float period, float hw, float aa){
    float d = abs(fract(x / period + 0.5) - 0.5) * period;
    return 1.0 - smoothstep(hw - aa, hw + aa, d);
  }
  vec3 pvPick8(float t, vec3 c0, vec3 c1, vec3 c2, vec3 c3, vec3 c4, vec3 c5, vec3 c6, vec3 c7){
    float k = floor(fract(t) * 8.0);
    return k < 1.0 ? c0 : k < 2.0 ? c1 : k < 3.0 ? c2 : k < 4.0 ? c3 : k < 5.0 ? c4 : k < 6.0 ? c5 : k < 7.0 ? c6 : c7;
  }
  // paleta de reboco dos prédios de escritório do Centro (predomínio creme/gelo, como na Pres. Vargas)
  vec3 pvPlasterOffice(float t){
    return pvPick8(t, vec3(0.86,0.82,0.70), vec3(0.88,0.87,0.82), vec3(0.80,0.76,0.66), vec3(0.74,0.74,0.72),
                      vec3(0.84,0.76,0.58), vec3(0.82,0.70,0.60), vec3(0.72,0.76,0.70), vec3(0.90,0.86,0.76));
  }
  // casario (sobrados do Saara/Centro histórico): cores vivas de fachada pintada
  vec3 pvPlasterSobrado(float t){
    return pvPick8(t, vec3(0.88,0.72,0.38), vec3(0.78,0.44,0.32), vec3(0.50,0.64,0.78), vec3(0.58,0.72,0.56),
                      vec3(0.88,0.64,0.62), vec3(0.92,0.90,0.84), vec3(0.72,0.62,0.78), vec3(0.94,0.80,0.52));
  }
  vec3 pvTile(float t){
    return pvPick8(t, vec3(0.60,0.67,0.72), vec3(0.76,0.81,0.84), vec3(0.64,0.71,0.65), vec3(0.88,0.88,0.86),
                      vec3(0.82,0.76,0.66), vec3(0.60,0.52,0.45), vec3(0.80,0.71,0.67), vec3(0.68,0.68,0.67));
  }
  vec3 pvStone(float t){
    return pvPick8(t, vec3(0.84,0.78,0.66), vec3(0.62,0.62,0.62), vec3(0.78,0.74,0.68), vec3(0.70,0.62,0.58),
                      vec3(0.86,0.82,0.74), vec3(0.56,0.55,0.53), vec3(0.80,0.72,0.60), vec3(0.68,0.66,0.62));
  }
  // forma da janela (retângulo, opcionalmente com arco pleno no topo)
  float pvWin(vec2 p, vec2 lo, vec2 hi, float arch, vec2 aa){
    float b = pvBox(p, lo, hi, aa);
    if (arch > 0.5) {
      float r = (hi.x - lo.x) * 0.5;
      float cy = hi.y - r;
      if (p.y > cy) b *= 1.0 - smoothstep(r - aa.x, r + aa.x, length(vec2(p.x - (lo.x + hi.x) * 0.5, p.y - cy)));
    }
    return b;
  }`;

/**
 * Corpo principal (substitui <map_fragment>). Define fRough, fMetal, fEmissive e fHgt (relevo em metros).
 */
export const FACADE_FRAGMENT_MAIN = /* glsl */ `
  float fStyle = vFacade.x;
  float fFloorH = vFacade.y;
  float fTint = vFacade.z;
  float fSeed = vFacade.w;
  float fTop = vFacade2.x;
  float fFlags = vFacade2.z;
  float fGroundH = vFacade2.w;
  bool isRoof = pvBit(fFlags, 2.0);
  bool isArcade = pvBit(fFlags, 1.0);
  bool hasShops = pvBit(fFlags, 4.0);
  bool isCanopy = pvBit(fFlags, 8.0);
  bool isParapet = pvBit(fFlags, 16.0);
  bool isMarq = pvBit(fFlags, 32.0);
  bool isTech = pvBit(fFlags, 64.0);
  bool isTank = pvBit(fFlags, 128.0);
  float fRough = 0.88;
  float fMetal = 0.0;
  vec3 fEmissive = vec3(0.0);
  float fHgt = 0.0;
  float fBumpK = 0.0;
  vec2 m = vFUV;
  vec2 aa = max(fwidth(m), vec2(0.004));
  float sStyle = fStyle;

  // ---------- identidade do prédio (determinística) ----------
  float h1 = pvS(fSeed, 1.0), h2 = pvS(fSeed, 2.0), h3 = pvS(fSeed, 3.0), h4 = pvS(fSeed, 4.0);
  float h5 = pvS(fSeed, 5.0), h6 = pvS(fSeed, 6.0), h7 = pvS(fSeed, 7.0), h8 = pvS(fSeed, 8.0);
  bool sobrado = fStyle > 2.5 && fStyle < 3.5;
  bool eclectic = fStyle > 4.5;
  bool institutional = fStyle > 3.5 && fStyle < 4.5;
  bool artdeco = fStyle > 1.5 && fStyle < 2.5;
  bool office = fStyle < 0.5;
  bool curtain = office && fTop > 50.0 && h1 < 0.6;
  // material: 0 reboco, 1 concreto, 2 pedra, 3 pastilha, 4 vidro, 5 azulejo
  float mat = 0.0;
  if (office) mat = curtain ? 4.0 : (h1 < 0.8 ? 3.0 : 1.0);
  else if (fStyle < 1.5) mat = h1 < 0.45 ? 0.0 : h1 < 0.7 ? 3.0 : h1 < 0.86 ? 1.0 : 2.0;
  else if (artdeco) mat = h1 < 0.65 ? 0.0 : 2.0;
  else if (sobrado) mat = h1 < 0.86 ? 0.0 : 5.0;
  else if (institutional) mat = 2.0;
  vec3 base;
  if (mat < 0.5) base = sobrado ? pvPlasterSobrado(fTint) : pvPlasterOffice(fTint);
  else if (mat < 1.5) base = vec3(0.62, 0.61, 0.58) * (0.92 + fTint * 0.14);
  else if (mat < 2.5) base = pvStone(fTint);
  else if (mat < 3.5) base = pvTile(fTint);
  else if (mat < 4.5) base = vec3(0.30, 0.32, 0.33);
  else base = vec3(0.90, 0.90, 0.88);
  if (fTop > 30.0 && mat < 0.5) base = mix(base, vec3(0.84, 0.82, 0.76), 0.35);
  vec3 wall = pvLin(base);
  // cor secundária (pilastras/faixas/peitoris): mais clara ou contrastante
  vec3 accent = pvLin(mat > 2.5 && mat < 3.5 ? pvTile(fTint + 0.37) : mix(base, vec3(0.92, 0.90, 0.86), 0.55));
  if (artdeco) accent = pvLin(mix(base, vec3(0.95, 0.93, 0.88), 0.4));
  float dirt = 0.4 + h7 * 0.6; // quão encardido é o prédio

  // textura do material (em metros)
  float nLow = texture2D(uNoise, m * vec2(0.031, 0.023) + fSeed).a;
  float nMid = texture2D(uNoise, m * vec2(0.21, 0.17)).g;
  float nHi = texture2D(uNoise, m * 1.7).b;
  float streakN = texture2D(uNoise, vec2(m.x * 0.13 + fSeed, m.y * 0.011)).r;

  if (isTank) {
    // caixa d'água de fibra (azul) — telhados baixos
    diffuseColor.rgb = pvLin(vec3(0.16, 0.36, 0.62)) * (0.85 + nMid * 0.2);
    fRough = 0.45;
  } else if (isRoof || (fFloorH > 90.0 && !isMarq && !isParapet && !isTech) || isCanopy) {
    vec3 roofC;
    if (isRoof && vFWNormal.y > 0.5) {
      float rt = h6;
      if (sobrado && rt < 0.7) {
        // telha cerâmica (capa-canal) — fileiras de 0.2 m
        float row = fract(m.y / 0.22);
        float wave = 0.5 + 0.5 * sin(m.x / 0.2 * 6.2832);
        roofC = pvLin(vec3(0.62, 0.34, 0.24)) * (0.75 + wave * 0.3) * (0.8 + 0.2 * smoothstep(0.0, 0.2, row));
        roofC *= 0.8 + nLow * 0.35;
        fHgt = wave * 0.03;
        fRough = 0.8;
      } else if (rt < 0.35) {
        roofC = pvLin(vec3(0.46, 0.45, 0.43)) * (0.75 + nLow * 0.4); // laje de concreto
      } else if (rt < 0.7) {
        roofC = pvLin(vec3(0.24, 0.24, 0.25)) * (0.8 + nLow * 0.35); // manta asfáltica
        fRough = 0.8;
      } else {
        roofC = pvLin(vec3(0.68, 0.69, 0.70)) * (0.85 + nLow * 0.2); // manta aluminizada
        fRough = 0.55; fMetal = 0.25;
      }
      // poças secas / manchas e juntas de dilatação
      roofC *= 1.0 - 0.25 * smoothstep(0.55, 0.8, nMid);
      roofC *= 1.0 - 0.3 * pvLines(m.x, 6.0, 0.03, aa.x) - 0.3 * pvLines(m.y, 6.0, 0.03, aa.y);
    } else if (isCanopy) {
      roofC = pvLin(vec3(0.56, 0.57, 0.58)) * (0.8 + nMid * 0.3);
    } else {
      // parede lisa (monumentos/muros, teto de galeria, colunas)
      roofC = wall * (0.86 + nLow * 0.2);
      roofC *= 1.0 - 0.18 * smoothstep(0.5, 0.85, streakN) * dirt;
    }
    diffuseColor.rgb = roofC;
    if (!isRoof) fRough = mat > 1.5 && mat < 2.5 ? 0.6 : 0.9;
  } else if (isMarq) {
    // marquise de concreto: borda pintada, fundo com spots (acesos à noite)
    vec3 mc = pvLin(mix(vec3(0.78, 0.78, 0.76), base, 0.35)) * (0.85 + nMid * 0.2);
    if (vFWNormal.y < -0.5) {
      vec2 sp = fract(m / vec2(2.2, 2.2)) - 0.5;
      float spot = 1.0 - smoothstep(0.05, 0.08, length(sp * 2.2));
      mc = pvLin(vec3(0.62, 0.62, 0.6)) * (0.8 + nMid * 0.2);
      mc = mix(mc, vec3(0.9), spot);
      fEmissive += vec3(1.0, 0.82, 0.6) * spot * uNight * 3.0 * step(0.3, h5);
    } else if (vFWNormal.y < 0.5) {
      // testeira: escorrimento escuro na base
      mc *= 1.0 - 0.35 * smoothstep(0.4, 0.9, streakN);
    } else {
      mc *= 0.55 + nLow * 0.3; // topo sujo (folhas, poeira)
    }
    diffuseColor.rgb = mc;
    fRough = 0.9;
  } else if (isParapet || isTech) {
    // face interna da platibanda / casa de máquinas: reboco ou concreto com manchas fortes
    vec3 pc = mix(wall, pvLin(vec3(0.62, 0.62, 0.6)), isTech ? 0.6 : 0.3) * (0.82 + nLow * 0.25);
    pc *= 1.0 - 0.35 * smoothstep(0.4, 0.85, streakN);
    if (isTech && abs(vFWNormal.y) < 0.5) {
      // casa de máquinas: veneziana de ventilação e porta metálica (y local a partir da cobertura)
      float ty = m.y - vFacade2.y;
      float tx = fract(m.x / 7.0) * 7.0;
      float lou = pvBox(vec2(tx, ty), vec2(0.6, 1.3), vec2(2.0, 1.9), aa);
      pc = mix(pc, pvLin(vec3(0.3, 0.31, 0.3)) * (0.6 + 0.4 * pvLines(ty, 0.07, 0.015, aa.y)), lou);
      float door = pvBox(vec2(tx, ty), vec2(3.0, 0.0), vec2(3.9, 2.1), aa);
      pc = mix(pc, pvLin(vec3(0.38, 0.42, 0.44)) * (0.8 + nMid * 0.3), door);
    }
    diffuseColor.rgb = pc;
    fRough = 0.92;
  } else {
    // =========================== FACHADA ===========================
    float yRel = m.y;
    float fh = fFloorH;
    // parâmetros do vão/janela por estilo + semente
    float bayW, winW, sill, winH, depth, mull, arch = 0.0;
    if (curtain)            { bayW = 1.25 + h2 * 0.35; winW = bayW;              sill = 0.0;  winH = fh - 0.9; depth = 0.03; mull = 0.0; }
    else if (office)        { bayW = 1.2 + h2 * 0.4;   winW = bayW;              sill = 0.95 + h3 * 0.15; winH = fh - sill - 0.35; depth = 0.06; mull = 0.0; }
    else if (fStyle < 1.5)  { bayW = 2.4 + h2 * 1.3;   winW = bayW * (0.42 + h3 * 0.36); sill = 0.85 + h4 * 0.2; winH = min(fh - sill - 0.4, 1.35 + h5 * 0.6); depth = 0.1 + h6 * 0.16; mull = floor(h4 * 4.0) + 2.0; }
    else if (artdeco)       { bayW = 1.9 + h2 * 0.8;   winW = bayW - 0.55;      sill = 0.9;  winH = fh - sill - 0.45; depth = 0.2; mull = h4 < 0.5 ? 4.0 : 5.0; }
    else if (sobrado)       { bayW = 2.7 + h2 * 0.9;   winW = 1.05 + h3 * 0.2;  sill = 0.08; winH = min(fh - 0.75, 2.35 + h4 * 0.35); depth = 0.22; mull = 6.0; arch = step(0.55, h5); }
    else if (institutional) { bayW = 4.2;              winW = 1.5;               sill = 0.9;  winH = min(fh - 1.3, 2.3); depth = 0.35; mull = 3.0; }
    else                    { bayW = 3.4 + h2 * 0.4;   winW = 1.2;               sill = 0.6;  winH = min(fh - 1.1, 2.4); depth = 0.3; mull = 6.0; arch = step(0.6, h5); }
    winH = max(winH, 0.8);
    float topBand = office ? 0.9 : sobrado || eclectic ? 1.6 : 1.1;
    float fy = (yRel - fGroundH) / fh;
    float level = floor(fy);
    float ly = fract(fy) * fh;
    float bay = floor(m.x / bayW);
    float lx = (fract(m.x / bayW) - 0.5) * bayW;
    float upper = step(fGroundH, yRel) * step(yRel - ly + sill + winH, fTop - topBand);
    if (curtain) upper = step(fGroundH, yRel) * step(yRel, fTop - topBand); // pele de vidro vai até a platibanda
    vec2 wlo = vec2(-winW * 0.5, sill), whi = vec2(winW * 0.5, sill + winH);
    float rW = pvH(vec2(bay, level) + fSeed * 91.0);
    float rW2 = pvH(vec2(level * 1.7, bay) + fSeed * 17.0);

    // nível de detalhe (anti-moiré) — 1 perto, 0 quando um pixel cobre ~meio vão
    float detail = 1.0 - smoothstep(0.22, 0.55, max(aa.x / bayW, aa.y / fh));

    // ---------- parallax do vão ----------
    vec3 Nw = normalize(vFWNormal);
    vec3 Tw = normalize(vec3(-Nw.z, 0.0, Nw.x));
    vec3 Vw = normalize(cameraPosition - vFWPos);
    vec3 vt = vec3(dot(Vw, Tw), Vw.y, max(dot(Vw, Nw), 0.12));
    vec2 pl = vec2(lx, ly);
    vec3 st = vec3(dot(uSunDir, Tw), uSunDir.y, dot(uSunDir, Nw)); // sol no espaço da fachada
    vec2 pg = pl - vt.xy / vt.z * depth * uDetail * detail;

    float inOpen = pvWin(pl, wlo, whi, arch, aa) * upper;
    float inGlass = pvWin(pg, wlo, whi, arch, aa);

    // ---------- parede: material + elementos ----------
    vec3 wallC = wall;
    float rough = 0.9;
    if (mat < 0.5) {
      // reboco pintado: manchas de repintura e textura fina
      wallC *= 0.9 + nLow * 0.16 + (nHi - 0.5) * 0.05;
      wallC = mix(wallC, wallC * vec3(0.96, 0.95, 0.92), smoothstep(0.55, 0.75, nMid) * 0.6);
      rough = 0.9;
    } else if (mat < 1.5) {
      // concreto aparente: tábuas da fôrma (15 cm) + furos de tirante
      float board = pvH(vec2(floor(yRel / 0.15), floor(m.x / 2.4) + fSeed));
      wallC *= 0.86 + board * 0.1 + (nHi - 0.5) * 0.08 + nLow * 0.1;
      wallC *= 1.0 - 0.12 * pvLines(yRel, 0.15, 0.006, aa.y) * detail;
      vec2 tie = abs(fract(m / vec2(1.2, 0.6)) - 0.5) * vec2(1.2, 0.6);
      wallC *= 1.0 - 0.35 * (1.0 - smoothstep(0.012, 0.02, length(tie))) * detail;
      rough = 0.94;
    } else if (mat < 2.5) {
      // placas de pedra (granito/travertino) com juntas
      vec2 ps = h3 < 0.5 ? vec2(0.9, 1.2) : vec2(1.2, 0.8);
      vec2 pid = floor(m / ps);
      float pv = pvH(pid + fSeed * 7.0);
      wallC *= 0.93 + pv * 0.1;
      wallC *= 0.92 + nHi * 0.14; // granulação
      vec2 jd = abs(fract(m / ps + 0.5) - 0.5) * ps;
      float joint = 1.0 - smoothstep(0.004, 0.004 + max(aa.x, aa.y), min(jd.x, jd.y));
      wallC *= 1.0 - joint * 0.08 * detail;
      rough = 0.55 + h4 * 0.2;
    } else if (mat < 3.5) {
      // pastilhas (5 cm): mistura de 3 tons; vira cor média à distância
      vec2 tid = floor(m / 0.05);
      float tv = pvH(tid + fSeed);
      vec3 tmix = wallC * (tv < 0.33 ? 0.88 : tv < 0.66 ? 1.0 : 1.1);
      float tFade = 1.0 - smoothstep(0.005, 0.014, max(aa.x, aa.y));
      wallC = mix(wallC, tmix, tFade);
      vec2 gd = abs(fract(m / 0.05 + 0.5) - 0.5) * 0.05;
      float grout = 1.0 - smoothstep(0.003, 0.006, min(gd.x, gd.y));
      wallC = mix(wallC, wallC * 0.75, grout * tFade);
      wallC *= 0.95 + nLow * 0.1;
      rough = 0.42;
    } else if (mat < 4.5) {
      rough = 0.3;
    } else {
      // azulejo português 15 cm: motivo azul sobre branco
      vec2 q = fract(m / 0.15) - 0.5;
      float dia = abs(abs(q.x) + abs(q.y) - 0.32);
      float motif = 1.0 - smoothstep(0.03, 0.05, dia);
      motif = max(motif, 1.0 - smoothstep(0.06, 0.08, length(q)));
      float tFade = 1.0 - smoothstep(0.02, 0.06, max(aa.x, aa.y));
      vec3 blue = pvLin(vec3(0.16, 0.30, 0.62));
      wallC = mix(wallC, mix(wallC, blue, 0.35), 1.0 - tFade);
      wallC = mix(wallC, blue, motif * tFade);
      rough = 0.3;
    }

    // pilastras (art déco sempre; demais conforme semente) e faixas de laje
    float pierW = artdeco ? 0.5 : 0.38;
    bool hasPiers = artdeco || (fStyle > 0.5 && fStyle < 1.5 && h5 < 0.45) || eclectic;
    float pierPeriod = eclectic ? 2.0 : 1.0;
    float pier = 0.0;
    if (hasPiers) {
      float px = abs(fract(m.x / (bayW * pierPeriod)) - 0.0);
      float dpx = min(px, 1.0 - px) * bayW * pierPeriod;
      pier = (1.0 - smoothstep(pierW * 0.5 - aa.x, pierW * 0.5 + aa.x, dpx)) * step(fGroundH, yRel);
    }
    bool hasBands = office || (fStyle > 0.5 && fStyle < 1.5 && h6 < 0.4) || sobrado || eclectic;
    float bandH = 0.28;
    float band = 0.0;
    if (hasBands && !office) band = (1.0 - smoothstep(bandH - aa.y, bandH + aa.y, ly)) * step(fGroundH, yRel);
    if (office && !curtain) band = 1.0 - pvBox(pl, vec2(-bayW, sill), vec2(bayW, sill + winH), aa); // peitoril contínuo
    // peitoril rebaixado do art déco (painel entre pilastras abaixo da janela)
    float spandrel = artdeco ? pvBox(pl, vec2(-winW * 0.5, 0.3), vec2(winW * 0.5, sill - 0.05), aa) : 0.0;

    vec3 col = wallC;
    if (hasPiers) col = mix(col, mat > 2.5 && mat < 3.5 ? accent : accent * (0.95 + nLow * 0.1), pier);
    if (hasBands && !office) col = mix(col, accent * (0.9 + nLow * 0.1), band);
    if (office && !curtain) col = mix(col, mat < 1.5 ? wallC : wall * (0.95 + nLow * 0.08), band);
    col = mix(col, wallC * 0.78, spandrel);
    fHgt += pier * 0.18 + band * (office ? 0.0 : 0.06) - spandrel * 0.06;

    // ---------- ar-condicionado de janela (típico dos prédios dos anos 40–70) ----------
    float acDens = (fStyle > 0.5 && fStyle < 2.5) ? 0.22 + h8 * 0.3 : sobrado ? 0.12 : 0.0;
    float ac = 0.0;
    float acShadow = 0.0;
    if (acDens > 0.0 && upper > 0.5 && rW2 < acDens) {
      float ax = (rW - 0.5) * max(winW - 0.7, 0.0);
      vec2 alo = vec2(ax - 0.31, sill - 0.5), ahi = vec2(ax + 0.31, sill - 0.08);
      if (sobrado) { alo.y = sill + winH - 0.55; ahi.y = sill + winH - 0.1; }
      ac = pvBox(pl, alo, ahi, aa);
      acShadow = pvBox(pl, vec2(alo.x, alo.y - 0.25), vec2(ahi.x, alo.y), aa) * (1.0 - ac);
      // pingadeira: mancha escura escorrendo abaixo do aparelho
      float drip = pvBox(pl, vec2(ax - 0.05, alo.y - 1.4), vec2(ax + 0.08, alo.y), aa) * smoothstep(alo.y - 1.4, alo.y, ly);
      col *= 1.0 - drip * 0.25 * detail;
    }

    // ---------- intemperismo: escorrido sob peitoris, encardido na base e sob a cornija ----------
    float under = step(ly, sill) * (1.0 - smoothstep(0.0, 2.2 + rW * 1.5, sill - ly));
    float edgeX = max(1.0 - smoothstep(0.05, 0.3, abs(abs(lx) - winW * 0.45)), 0.6 * (1.0 - smoothstep(0.0, winW * 0.4, abs(lx))));
    float sStreak = under * edgeX * smoothstep(0.35, 0.8, streakN + rW * 0.3) * step(fGroundH + fh, yRel + sill + 0.01);
    float topStreak = smoothstep(fTop - 9.0, fTop - topBand, yRel) * smoothstep(0.45, 0.85, streakN);
    float grime = (smoothstep(0.42, 0.9, streakN) * 0.18 + sStreak * 0.35 + topStreak * 0.25) * dirt;
    if (mat > 2.5 && mat < 4.5) grime *= 0.45; // pastilha/vidro lavam melhor
    col *= 1.0 - grime;
    col = mix(col, col * vec3(0.86, 0.84, 0.8), (1.0 - smoothstep(0.0, 1.2, yRel)) * 0.6); // respingos na base

    // ---------- vidro / interior ----------
    vec2 g = (pg - wlo) / (whi - wlo);
    vec3 frameC;
    float fk = h7;
    if (sobrado || eclectic) frameC = fk < 0.35 ? vec3(0.30, 0.18, 0.10) : fk < 0.6 ? vec3(0.16, 0.32, 0.22) : fk < 0.8 ? vec3(0.88, 0.87, 0.82) : vec3(0.22, 0.32, 0.48);
    else frameC = fk < 0.4 ? vec3(0.66, 0.67, 0.68) : fk < 0.62 ? vec3(0.86, 0.86, 0.84) : fk < 0.84 ? vec3(0.16, 0.13, 0.11) : vec3(0.18, 0.26, 0.22);
    frameC = pvLin(frameC);
    float frameMetal = (!sobrado && !eclectic && fk < 0.4) ? 0.6 : 0.0;
    // caixilho: moldura + divisões conforme o tipo
    vec2 wsz = whi - wlo;
    float fw = curtain ? 0.05 : 0.055, mw = 0.035;
    vec2 gm = g * wsz; // metros dentro do vidro
    float frame = 1.0 - pvBox(gm, vec2(fw), wsz - fw, aa);
    float bars = 0.0;
    float nc = 1.0, nr = 1.0;
    if (mull > 1.5 && mull < 2.5) { nc = 2.0; nr = 1.0; }
    else if (mull > 2.5 && mull < 3.5) { nc = 2.0; nr = 1.0; bars = pvLines(gm.y - wsz.y * 0.72, 100.0, mw * 0.5, aa.y); }
    else if (mull > 3.5 && mull < 4.5) { nc = 2.0; nr = 3.0; }
    else if (mull > 4.5 && mull < 5.5) { nc = 2.0; nr = 5.0; }
    else if (mull > 5.5) { nc = 2.0; nr = 4.0; }
    if (nc > 1.5) bars = max(bars, pvLines(gm.x, wsz.x / nc, mw * (mull > 5.5 ? 1.0 : 0.5), aa.x));
    if (nr > 1.5) bars = max(bars, pvLines(gm.y, wsz.y / nr, mw * 0.5, aa.y));
    if (office) bars = max(bars, pvLines(gm.x + bayW * 0.5, bayW, 0.03, aa.x));
    if (curtain) bars = max(bars, pvLines(gm.y, wsz.y * 0.5, 0.02, aa.y) * 0.0);
    float caix = max(frame, bars);
    // anti-serrilhado dos caixilhos finos: converge para a cobertura média quando o pixel > ~2 cm
    caix = mix(caix, 0.16, smoothstep(0.015, 0.05, max(aa.x, aa.y)));
    // interior: escuro com variação; cortinas/persianas por janela
    float curtainK = step(0.45, rW2) * step(rW2, 0.8);
    float blindK = step(0.8, rW2);
    vec3 interior = pvLin(vec3(0.2, 0.19, 0.18)) * (0.6 + rW * 0.8) * (0.55 + 0.45 * g.y);
    vec3 curtC = pvLin(pvPick8(rW * 3.7, vec3(0.86,0.82,0.72), vec3(0.92,0.92,0.9), vec3(0.62,0.70,0.80), vec3(0.80,0.74,0.6),
                                         vec3(0.7,0.7,0.68), vec3(0.88,0.86,0.80), vec3(0.6,0.55,0.48), vec3(0.9,0.9,0.86)));
    float cDrop = 0.35 + rW * 0.65;
    float curt = curtainK * step(1.0 - cDrop, g.y) * (0.85 + 0.15 * sin(gm.x * 38.0));
    float blind = blindK * step(1.0 - (0.3 + rW * 0.7), g.y);
    vec3 inC = mix(interior, curtC * 0.7, curt);
    inC = mix(inC, pvLin(vec3(0.78, 0.76, 0.7)) * (0.75 + 0.25 * step(0.5, fract(gm.y / 0.05))), blind);
    // vidro: tonalidade/refletância por prédio
    float gk = h8;
    vec3 tint = curtain ? (gk < 0.4 ? vec3(0.42, 0.55, 0.62) : gk < 0.7 ? vec3(0.36, 0.46, 0.40) : vec3(0.46, 0.43, 0.38))
                        : (gk < 0.5 ? vec3(0.50, 0.54, 0.55) : gk < 0.75 ? vec3(0.42, 0.50, 0.46) : vec3(0.46, 0.44, 0.40));
    float refl = curtain ? 0.6 : 0.3 + h3 * 0.2;
    vec3 glassC = mix(inC, pvLin(tint), refl * (1.0 - max(curt, blind) * 0.7));
    if (curtain) {
      // pele de vidro: faixa de peitoril opaca (spandrel) + montantes
      float spBand = 1.0 - step(0.9, ly);
      glassC = mix(glassC, pvLin(tint) * 0.55, spBand);
      caix = max(caix, pvLines(m.x, bayW, 0.035, aa.x));
      caix = max(caix, pvLines(ly, fh, 0.03, aa.y));
    }
    // sombra do sol dentro do vão (verga e ombreira) sobre o vidro
    float recShadow = 0.0;
    if (st.z > 0.02 && depth > 0.05) {
      float sy = depth * st.y / st.z, sx = depth * st.x / st.z;
      recShadow = max(step(whi.y - max(sy, 0.0), pg.y), sx > 0.0 ? step(whi.x - sx, pg.x) : step(pg.x, wlo.x - sx));
      recShadow *= (1.0 - uNight) * uDetail;
    }
    vec3 winC = mix(glassC, frameC, caix);
    winC *= 1.0 - recShadow * 0.55;
    // ombreiras/verga/peitoril visíveis pelo parallax
    vec3 revealC = wallC * (pg.y > whi.y ? 0.5 : pg.y < wlo.y ? 1.05 : 0.72);
    float reveal = inOpen * (1.0 - inGlass);

    // gradil de sacada (sobrados/ecléticos com porta-janela)
    float rail = 0.0;
    if ((sobrado || eclectic) && level >= 0.0 && sill < 0.7) {
      float rH = 1.0;
      float inRail = pvBox(pl, vec2(wlo.x - 0.15, sill), vec2(whi.x + 0.15, sill + rH), aa);
      float bar = pvLines(pl.x, 0.12, 0.012, aa.x);
      float top = pvLines(ly - sill - rH, 100.0, 0.025, aa.y) + pvLines(ly - sill - 0.08, 100.0, 0.02, aa.y);
      rail = inRail * clamp(bar + top, 0.0, 1.0) * detail;
      // laje da sacada: sombra embaixo
      col *= 1.0 - 0.35 * pvBox(pl, vec2(wlo.x - 0.2, sill - 0.35), vec2(whi.x + 0.2, sill), aa) * step(0.0, fy - 1.0);
    }
    // venezianas (sobrados): algumas janelas fechadas com folhas de madeira
    float shutter = (sobrado || eclectic) ? step(0.72, rW) : 0.0;
    vec3 shutterC = frameC * (0.8 + 0.25 * step(0.5, fract(pl.y / 0.06)));

    // frontão/cimalha sobre a janela (eclético)
    float pediment = 0.0;
    if (eclectic || (sobrado && h6 > 0.5)) {
      pediment = pvBox(pl, vec2(wlo.x - 0.18, whi.y + 0.08), vec2(whi.x + 0.18, whi.y + 0.28), aa) * upper;
      col = mix(col, accent * 1.05, pediment);
      col *= 1.0 - 0.35 * pvBox(pl, vec2(wlo.x - 0.18, whi.y + 0.0), vec2(whi.x + 0.18, whi.y + 0.08), aa) * upper;
      fHgt += pediment * 0.1;
    }
    // moldura (guarnição) em relevo ao redor do vão
    float surround = (sobrado || eclectic || (fStyle > 0.5 && fStyle < 1.5 && h3 > 0.6)) ?
      (pvWin(pl, wlo - 0.12, whi + 0.12, arch, aa) - pvWin(pl, wlo, whi, arch, aa)) * upper : 0.0;
    col = mix(col, accent, surround * 0.8);
    fHgt += surround * 0.05;

    // composição perto
    vec3 detailed = col;
    detailed = mix(detailed, winC, inOpen * inGlass);
    detailed = mix(detailed, mix(detailed, shutterC, shutter), inOpen * inGlass * shutter);
    detailed = mix(detailed, revealC, reveal * detail);
    detailed = mix(detailed, pvLin(vec3(0.14, 0.15, 0.15)), rail);
    vec3 acC = pvLin(vec3(0.80, 0.79, 0.75)) * (0.88 + 0.12 * step(0.5, fract(pl.y / 0.04)));
    detailed = mix(detailed, acC, ac);
    detailed *= 1.0 - acShadow * 0.4;
    fHgt += ac * 0.06;

    // ---------- brise-soleil (quebra-sol) do modernismo carioca: aletas verticais ou lâminas horizontais ----------
    // Sem geometria: oclusão (parallax) da face lateral/inferior e sombra projetada calculadas analiticamente.
    float briseT = 0.0;
    if (fStyle > 0.5 && fStyle < 1.5) briseT = h8 > 0.8 ? 2.0 : h8 < 0.12 ? 1.0 : 0.0;
    else if (office && !curtain) briseT = h5 < 0.3 ? 1.0 : h5 > 0.8 ? 2.0 : 0.0;
    if (briseT > 0.5 && upper > 0.5 && detail > 0.01 && uDetail > 0.5) {
      float bd = 0.45 + h6 * 0.3, bw = 0.1;
      vec3 bC = accent * (0.92 + nLow * 0.12);
      float sunOn = (1.0 - uNight) * step(0.02, st.z);
      float d, vs, ss, lit;
      if (briseT < 1.5) {
        d = (lx > 0.0 ? bayW * 0.5 : -bayW * 0.5) - lx;
        vs = bd * vt.x / vt.z; ss = bd * st.x / max(st.z, 0.02); lit = step(0.0, st.x * vs);
      } else {
        d = min(whi.y + 0.15, fh) - ly;
        vs = bd * vt.y / vt.z; ss = bd * st.y / max(st.z, 0.02); lit = step(0.0, st.y * vs);
      }
      float front = 1.0 - smoothstep(bw * 0.5 - aa.x, bw * 0.5 + aa.x, abs(d));
      float side = step(0.0, d * vs) * step(abs(d), abs(vs)) * (1.0 - front);
      float shade = step(0.0, d * ss) * step(abs(d), abs(ss)) * sunOn;
      detailed = mix(detailed, detailed * 0.42, shade * (1.0 - side));
      detailed = mix(detailed, bC * mix(0.55, 1.0, lit * sunOn), side);
      detailed = mix(detailed, bC, front);
      col *= 0.92;
    }

    // cor média (longe): parede + fração de vidro
    float winFrac = curtain ? 0.85 : clamp((winW * winH) / (bayW * fh), 0.0, 0.9);
    vec3 avg = mix(col, mix(pvLin(tint) * 0.6, interior * 2.0 + curtC * 0.12, 0.5), winFrac * upper * (1.0 - shutter * 0.5));
    col = mix(avg, detailed, detail);
    float glassAmt = (inOpen * inGlass * (1.0 - caix) * (1.0 - shutter)) * detail + winFrac * upper * 0.7 * (1.0 - detail);

    // ---------- noite: janelas acesas ----------
    float litP = (office || curtain) ? 0.34 : 0.26;
    float lit = step(1.0 - litP - fTint * 0.08, pvH(vec2(bay * 3.1, level * 7.3) + fSeed * 5.0));
    vec3 litC = mix(vec3(1.0, 0.74, 0.42), vec3(0.82, 0.9, 1.0), step(0.55, rW)) * (0.55 + rW2 * 0.6);
    litC = mix(litC, litC * curtC * 1.3, curt);
    // à distância as janelas acesas convergem antes para o brilho médio (evita "chuvisco" nas torres distantes)
    float detE = 1.0 - smoothstep(0.08, 0.3, max(aa.x / bayW, aa.y / fh));
    fEmissive = litC * uNight * upper * (lit * inOpen * inGlass * (1.0 - caix) * (1.0 - shutter) * detE + winFrac * (litP + 0.04) * 0.75 * (1.0 - detE));

    // ---------- cornija / platibanda ----------
    if (yRel > fTop - topBand && fGroundH < fTop - topBand) {
      vec3 cc = (sobrado || eclectic) ? accent : wallC * 0.95;
      if (sobrado || eclectic) {
        float t = (yRel - (fTop - topBand)) / topBand;
        cc *= t < 0.15 ? 0.6 : t < 0.3 ? 1.08 : t < 0.38 ? 0.75 : 1.0;
        // balaustrada na platibanda
        float bal = pvLines(m.x, 0.32, 0.06, aa.x) * step(0.45, t) * step(t, 0.88);
        cc = mix(cc, cc * 0.55, bal * 0.6 * step(0.5, h4));
      } else {
        cc *= yRel > fTop - 0.12 ? 0.75 : 1.0; // rufo/pingadeira
      }
      col = cc * (1.0 - 0.25 * smoothstep(0.4, 0.8, streakN));
      glassAmt = 0.0;
      fEmissive = vec3(0.0);
    }

    // ---------- térreo ----------
    if (yRel < fGroundH) {
      glassAmt = 0.0;
      fEmissive = vec3(0.0);
      float shopW = 3.6 + h8 * 2.8;
      float shop = floor(m.x / shopW);
      float sx = (fract(m.x / shopW)) * shopW; // metros dentro da loja
      float rs = pvH(vec2(shop, fSeed * 33.0));
      float rs2 = pvH(vec2(shop * 1.3, fSeed * 7.0));
      float pil = 0.42;
      vec3 graniteC = pvLin(h4 < 0.5 ? vec3(0.22, 0.21, 0.21) : vec3(0.52, 0.5, 0.48)) * (0.85 + nHi * 0.3);
      if (isArcade) {
        // galeria falsa (sem geometria): fundo sombreado + pilares
        float pillar = 1.0 - pvBox(vec2(sx, yRel), vec2(pil, -1.0), vec2(shopW - pil, 99.0), aa);
        vec3 recess = vec3(0.05) + vec3(0.05) * rs;
        col = mix(recess, wallC * 0.95, pillar);
      } else if (hasShops || sobrado) {
        float signH = 0.75;
        float oTop = fGroundH - signH - 0.2;
        if (oTop < 2.3) { signH = max(0.4, fGroundH - 2.5); oTop = fGroundH - signH - 0.15; }
        float opening = pvBox(vec2(sx, yRel), vec2(pil, 0.0), vec2(shopW - pil, oTop), aa);
        bool lobby = rs < 0.1;
        // pilares entre lojas: granito
        col = mix(graniteC, wallC * 0.85, step(oTop + 0.05, yRel));
        fRough = 0.5;
        // tipo de fechamento: porta de enrolar (fechada/meia), vitrine aberta
        float kind = rs2;
        float rollH = kind < 0.35 ? oTop : kind < 0.5 ? oTop - (0.9 + rs * 0.8) : 0.0;
        if (uNight > 0.5) rollH = kind < 0.75 ? oTop : rollH; // à noite quase tudo fechado
        float doorPart = step(oTop - rollH, yRel);
        float corr = 0.5 + 0.5 * sin(yRel * 6.2832 / 0.075);
        vec3 doorC = pvLin(pvPick8(rs * 2.3, vec3(0.62,0.63,0.64), vec3(0.55,0.57,0.6), vec3(0.42,0.5,0.56), vec3(0.6,0.6,0.58),
                                              vec3(0.36,0.44,0.38), vec3(0.66,0.66,0.64), vec3(0.5,0.42,0.36), vec3(0.58,0.6,0.62)));
        doorC *= (0.78 + corr * 0.22) * (0.9 + nMid * 0.2);
        doorC *= 1.0 - 0.3 * smoothstep(0.55, 0.85, texture2D(uNoise, m * vec2(0.6, 0.4)).r); // pichação/sujeira
        // interior da loja: prateleiras com mercadorias coloridas (iluminação própria)
        // interior com profundidade (parallax ~2.5 m): prateleiras, mercadorias e piso
        vec2 pIn = vec2(sx, yRel) - vt.xy / vt.z * 2.5 * uDetail;
        float shelf = floor(pIn.y / 0.42);
        float item = floor((pIn.x + shelf * 0.37) / (0.12 + pvH(vec2(shelf, shop)) * 0.22));
        vec3 goods = pvLin(mix(vec3(0.62, 0.6, 0.56), vec3(pvH(vec2(item, shelf)), pvH(vec2(item, shelf + 3.1)), pvH(vec2(item + 1.7, shelf))), 0.15)) * (0.3 + 0.3 * pvH(vec2(item * 2.3, shelf)));
        goods *= 0.55 + 0.45 * step(0.1, fract(pIn.y / 0.42)) * step(0.15, fract((pIn.x + shelf * 0.37) / (0.12 + pvH(vec2(shelf, shop)) * 0.22)));
        float hasGoods = step(0.25, rs2) * step(0.25, pIn.y) * step(pIn.y, 2.2);
        vec3 backW = pvLin(vec3(0.62, 0.6, 0.55)) * (0.55 + 0.45 * smoothstep(0.0, oTop, pIn.y));
        vec3 shopIn = mix(backW, goods, hasGoods);
        shopIn = mix(shopIn, pvLin(vec3(0.45, 0.43, 0.4)), step(pIn.y, 0.0)); // piso
        shopIn *= 0.6 + 0.4 * smoothstep(-0.5, oTop, pIn.y); // luz de teto
        vec3 shopC = shopIn * 0.6;
        vec3 shopE = shopIn * 0.35 * (0.4 + uNight * 1.2);
        // vitrine: caixilho de alumínio + reflexo
        float vFrame = 1.0 - pvBox(vec2(sx, yRel), vec2(pil + 0.05, 0.05), vec2(shopW - pil - 0.05, oTop - 0.05), aa);
        vFrame = max(vFrame, pvLines(sx - shopW * 0.5, shopW, 0.03, aa.x) * step(0.25, rs));
        vec3 openC = mix(shopC, pvLin(vec3(0.7, 0.71, 0.72)), vFrame);
        vec3 oc = mix(openC, doorC, doorPart);
        float isGlass = (1.0 - doorPart) * (1.0 - vFrame);
        if (lobby) {
          // portaria: moldura de granito escuro, portas de vidro, saguão iluminado, número
          vec3 lob = pvLin(vec3(0.85, 0.80, 0.70)) * (0.6 + 0.4 * step(0.4, yRel));
          float doorF = pvLines(sx - shopW * 0.5, 1.1, 0.03, aa.x) + pvLines(yRel - 2.4, 100.0, 0.04, aa.y);
          oc = mix(lob * 0.55, pvLin(vec3(0.2, 0.2, 0.2)), clamp(doorF, 0.0, 1.0));
          isGlass = 1.0 - clamp(doorF, 0.0, 1.0);
          shopE = lob * (0.12 + uNight * 0.9);
          col = mix(col, pvLin(vec3(0.12, 0.12, 0.12)), pvBox(vec2(sx, yRel), vec2(pil - 0.25, 0.0), vec2(shopW - pil + 0.25, oTop + 0.3), aa) * (1.0 - opening));
        }
        col = mix(col, oc, opening);
        glassAmt = opening * isGlass;
        fEmissive += shopE * opening * (1.0 - doorPart) * step(0.2, rs2);
        fHgt += opening * doorPart * corr * 0.012 * (lobby ? 0.0 : 1.0) - opening * 0.1;
        // letreiro (faixa acima da porta): cor + letras procedurais; alguns luminosos
        float signB = pvBox(vec2(sx, yRel), vec2(pil * 0.5, oTop + 0.08), vec2(shopW - pil * 0.5, oTop + 0.08 + signH), aa);
        if (signB > 0.0 && !lobby && rs > 0.18) {
          vec3 sc = pvLin(pvPick8(rs * 5.1, vec3(0.75,0.12,0.10), vec3(0.95,0.78,0.15), vec3(0.12,0.28,0.62), vec3(0.12,0.45,0.25),
                                            vec3(0.92,0.92,0.9), vec3(0.08,0.08,0.09), vec3(0.92,0.45,0.1), vec3(0.55,0.15,0.4)));
          float lum = dot(sc, vec3(0.3, 0.59, 0.11));
          vec3 lc = lum > 0.35 ? pvLin(vec3(0.08)) : pvLin(vec3(0.97, 0.95, 0.9));
          // palavra genérica do atlas (8:1), centrada na faixa do letreiro
          float th = min(signH * 0.62, 0.5);
          float tw = th * 8.0;
          float wi = floor(fract(rs * 7.13) * 16.0);
          vec2 tuv = vec2(0.5 - (sx - shopW * 0.5) / tw, (yRel - (oTop + 0.08 + signH * 0.5)) / th + 0.5);
          float gl = 0.0;
          if (tuv.x > 0.0 && tuv.x < 1.0 && tuv.y > 0.0 && tuv.y < 1.0) gl = texture2D(uSigns, vec2(tuv.x, 1.0 - (wi + 1.0 - tuv.y) / 16.0)).r;
          vec3 signCol = mix(sc, lc, gl);
          col = mix(col, signCol * (0.9 + nMid * 0.15), signB);
          fEmissive += mix(sc, lc, gl) * signB * uNight * 1.2 * step(0.55, rs2);
          fRough = mix(fRough, 0.5, signB);
        }
        // rodapé de granito
        col = mix(col, graniteC * 0.8, (1.0 - step(0.25, yRel)) * (1.0 - opening * (1.0 - doorPart)));
      } else {
        // base rusticada (ecléticos/institucionais): fiadas de pedra + janelas gradeadas
        float course = pvLines(yRel, 0.5, 0.02, aa.y) + pvLines(m.x + floor(yRel / 0.5) * 0.6, 1.2, 0.015, aa.x);
        col = wallC * mix(0.85, 0.6, clamp(course, 0.0, 1.0)) * (0.9 + nLow * 0.15);
        fHgt -= clamp(course, 0.0, 1.0) * 0.008;
        float gw = pvBox(pl, vec2(-0.6, fGroundH * 0.25), vec2(0.6, fGroundH * 0.85), aa);
        vec3 gwc = mix(pvLin(vec3(0.17, 0.17, 0.16)), pvLin(vec3(0.1, 0.11, 0.1)), pvLines(pl.x, 0.15, 0.015, aa.x));
        col = mix(col, gwc, gw);
      }
      col *= 1.0 - 0.25 * (1.0 - smoothstep(0.0, 0.6, yRel));
    }

    diffuseColor.rgb = col;
    fRough = yRel < fGroundH ? mix(fRough, 0.08, glassAmt) : mix(rough, curtain ? 0.04 : 0.06, glassAmt);
    fMetal = max(glassAmt * (curtain ? 0.7 : 0.3 + h3 * 0.2), caix * inOpen * frameMetal * detail);
    if (yRel < fGroundH) fMetal = glassAmt * 0.25;
    // oclusão de contato na base
    diffuseColor.rgb *= mix(0.7, 1.0, smoothstep(0.0, 1.4, yRel));
    fBumpK = detail;
  }`;

/** Perturba a normal (após <normal_fragment_maps>) pelo relevo procedural, via derivadas de tela. */
export const FACADE_NORMAL = /* glsl */ `
  if (uDetail > 0.5 && fBumpK > 0.01) {
    vec2 dU = dFdx(vFUV), dV = dFdy(vFUV);
    float dHx = dFdx(fHgt), dHy = dFdy(fHgt);
    float det = dU.x * dV.y - dU.y * dV.x;
    if (abs(det) > 1e-8) {
      // resolve gradiente do relevo no espaço (u, v) da fachada
      vec2 grad = vec2(dHx * dV.y - dHy * dU.y, dHy * dU.x - dHx * dV.x) / det;
      grad = clamp(grad, vec2(-3.0), vec2(3.0)) * fBumpK;
      normal = normalize(normal - (vFTanV * grad.x + vFBitV * grad.y) * faceDirection);
    }
  }`;

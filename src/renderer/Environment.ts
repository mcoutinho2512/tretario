/**
 * Céu, sol, nuvens, iluminação ambiente (IBL), neblina e sombras.
 * Horário dirigido por data/hora reais (posição solar calculada) → manhã/tarde/pôr do sol/noite.
 *
 * Rodada 5 (visual): o céu Preetham (three/Sky) + nuvens densas resultavam num céu cinza-lavado.
 * Agora o céu é um shader analítico próprio calibrado para luz tropical (azul saturado no zênite,
 * horizonte claro e úmido, cúmulos esparsos), e o MESMO céu alimenta o IBL — com uma "skyline"
 * simplificada ao redor, para que vidros e metais reflitam prédios (e não um céu vazio).
 * Não usamos HDRI estático: o horário real (sol calculado) é um recurso central do jogo.
 */
import * as THREE from 'three';
import { sunPosition, sunDirection } from '../geo/solar';
import type { QualityPreset } from '../core/settings';
import { timeUniforms, nightFactor } from './timeOfDay';

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * p;
    gl_Position.z = gl_Position.w; // sempre no fundo
  }`;

/** Céu analítico (linear HDR). Mesmas fórmulas usadas em JS (skyColorsFor) para neblina/hemisfério. */
const SKY_FRAG = /* glsl */ `
  uniform vec3 uSunDir; uniform float uNight; uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uSunset;
  uniform float uSunsetAmt; uniform vec3 uSunColor; uniform float uStars; uniform float uDisk;
  varying vec3 vDir;
  float hs(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    float hu = max(h, 0.0);
    // gradiente zênite → horizonte (o horizonte tropical é claro e úmido)
    float t = pow(hu, 0.42);
    vec3 col = mix(uHorizon, uZenith, t);
    // faixa de pôr/nascer do sol do lado do sol, concentrada perto do horizonte
    vec2 dxz = normalize(d.xz + 1e-5), sxz = normalize(uSunDir.xz + 1e-5);
    float az = max(dot(dxz, sxz), 0.0);
    float band = (1.0 - smoothstep(0.0, 0.35, hu)) * (0.35 + 0.65 * az * az);
    col = mix(col, uSunset, uSunsetAmt * band);
    // halo (Mie) e disco solar
    float cs = max(dot(d, normalize(uSunDir)), 0.0);
    float day = 1.0 - uNight;
    col += uSunColor * (pow(cs, 12.0) * 0.35 + pow(cs, 90.0) * 0.6) * day * step(-0.02, uSunDir.y);
    col += uSunColor * smoothstep(0.99965, 0.9998, cs) * 40.0 * uDisk * day * step(-0.01, uSunDir.y);
    // estrelas (somente noite fechada, longe do brilho da cidade no horizonte)
    if (uStars > 0.01 && h > 0.08) {
      vec3 g = floor(d * 380.0);
      float s = hs(g);
      float star = step(0.9965, s) * (0.4 + 0.6 * hs(g + 7.0));
      col += vec3(star) * uStars * smoothstep(0.08, 0.35, h) * 0.6;
    }
    // abaixo do horizonte: tom de "chão" difuso (raramente visível)
    col = mix(col, uHorizon * 0.55, smoothstep(0.0, -0.25, h));
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export interface SkyColors {
  zenith: THREE.Color;
  horizon: THREE.Color;
  sunset: THREE.Color;
  sunsetAmt: number;
}

/** Cores do céu (lineares) em função da elevação solar (rad) e do fator noite. */
export function skyColorsFor(elev: number, night: number): SkyColors {
  const e = Math.max(elev, -0.2);
  // dia: claridade do céu cresce com o sol (saturação maior com sol alto — céu tropical)
  const dayAmt = THREE.MathUtils.clamp((e + 0.05) / 0.45, 0, 1);
  const k = 0.25 + 0.75 * dayAmt;
  const zenith = new THREE.Color(0.03 * k, 0.13 * k, 0.56 * k);
  const horizon = new THREE.Color(0.4 * k + 0.06, 0.58 * k + 0.05, 0.86 * k + 0.05);
  // crepúsculo: horizonte quente, zênite azul-arroxeado
  const low = 1 - THREE.MathUtils.clamp(e / 0.22, 0, 1);
  const sunset = new THREE.Color(1.0, 0.46, 0.2).multiplyScalar(0.9 * (1 - night * 0.85));
  const sunsetAmt = low * (1 - night * 0.6);
  horizon.lerp(new THREE.Color(0.72, 0.52, 0.42), low * 0.45 * (1 - night));
  // noite: azul profundo no zênite + brilho alaranjado da cidade no horizonte
  zenith.lerp(new THREE.Color(0.004, 0.007, 0.02), night);
  horizon.lerp(new THREE.Color(0.05, 0.04, 0.035), night);
  return { zenith, horizon, sunset, sunsetAmt };
}

export class Environment {
  readonly sky: THREE.Mesh;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly clouds: THREE.Mesh;
  readonly sunDir = new THREE.Vector3();
  private pmrem: THREE.PMREMGenerator;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private skyUniforms: Record<string, THREE.IUniform>;
  private cloudUniforms: Record<string, THREE.IUniform>;
  private shadowDistance = 0;
  /** cena usada para gerar o IBL (céu + skyline + chão), reaproveitada a cada atualização */
  private envScene: THREE.Scene;
  private envCityMat: THREE.MeshBasicMaterial;
  private envGroundMat: THREE.MeshBasicMaterial;
  private envWindowsMat: THREE.MeshBasicMaterial;
  /** 0 = dia, 1 = noite */
  night = 0;
  /** direção da luz principal (sol de dia, lua à noite) */
  private lightDir = new THREE.Vector3();

  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene, preset: QualityPreset) {
    this.skyUniforms = {
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uNight: timeUniforms.night,
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uSunset: { value: new THREE.Color() },
      uSunsetAmt: { value: 0 },
      uSunColor: { value: new THREE.Color(1, 0.95, 0.88) },
      uStars: { value: 0 },
    };
    this.sky = this.makeSky(this.skyUniforms, preset.cameraFar * 0.9, 1);
    scene.add(this.sky);

    this.sun = new THREE.DirectionalLight(0xfff0dc, 3.2);
    this.sun.name = 'sun';
    this.hemi = new THREE.HemisphereLight(0xb9d3ee, 0x8a7d6a, 0.4);
    scene.add(this.sun, this.sun.target, this.hemi);

    this.cloudUniforms = {
      uTime: { value: 0 },
      uSunDir: { value: new THREE.Vector3() },
      uSunColor: { value: new THREE.Color(1, 0.93, 0.85) },
      uCoverage: { value: 0.6 },
      uNight: timeUniforms.night,
      uHorizon: timeUniforms.skyHorizon,
      uLight: { value: 1 },
    };
    this.clouds = this.makeClouds(preset.cameraFar * 0.82);
    scene.add(this.clouds);

    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envCityMat = new THREE.MeshBasicMaterial({ color: 0x777777 });
    this.envGroundMat = new THREE.MeshBasicMaterial({ color: 0x5b5751, side: THREE.BackSide });
    this.envWindowsMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    this.envScene = this.makeEnvScene();
    this.applyQuality(preset);
  }

  applyQuality(preset: QualityPreset) {
    this.shadowDistance = preset.shadowDistance;
    const enabled = preset.shadowMapSize > 0;
    this.renderer.shadowMap.enabled = enabled;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.sun.castShadow = enabled;
    if (enabled) {
      const s = this.sun.shadow;
      s.mapSize.set(preset.shadowMapSize, preset.shadowMapSize);
      const d = preset.shadowDistance;
      const cam = s.camera as THREE.OrthographicCamera;
      cam.left = -d; cam.right = d; cam.top = d; cam.bottom = -d;
      cam.near = 1; cam.far = 1400;
      cam.updateProjectionMatrix();
      s.bias = -0.0004;
      s.normalBias = 0.04;
      // penumbra suave (PCFSoft ignora radius; mantido para PCF)
      s.radius = 3;
      s.map?.dispose();
      (s as any).map = null;
    }
    // neblina começa mais longe: o ar do Centro é úmido, mas a avenida é larga e o contraste importa
    this.scene.fog = new THREE.Fog(0xbfcfdf, 420, preset.fogFar);
  }

  /** Define o horário do mundo e recalcula sol, céu, cores e IBL. */
  setTime(date: Date, lat: number, lon: number) {
    const pos = sunPosition(date, lat, lon);
    const [x, y, z] = sunDirection(pos);
    this.sunDir.set(x, y, z).normalize();
    const elev = pos.elevation;
    const night = nightFactor(elev);
    this.night = night;
    timeUniforms.night.value = night;
    const sky = skyColorsFor(elev, night);
    const su = this.skyUniforms;
    (su.uSunDir.value as THREE.Vector3).copy(this.sunDir);
    (su.uZenith.value as THREE.Color).copy(sky.zenith);
    (su.uHorizon.value as THREE.Color).copy(sky.horizon);
    (su.uSunset.value as THREE.Color).copy(sky.sunset);
    su.uSunsetAmt.value = sky.sunsetAmt;
    su.uStars.value = THREE.MathUtils.smoothstep(night, 0.7, 1.0);
    timeUniforms.skyHorizon.value.copy(sky.horizon);
    timeUniforms.skyZenith.value.copy(sky.zenith);

    // cor/intensidade do sol: mais quente perto do horizonte (luz tropical forte ao meio-dia)
    const warm = THREE.MathUtils.clamp(1 - elev / 0.7, 0, 1);
    const sunI = THREE.MathUtils.clamp(Math.sin(Math.max(elev, 0)) * 9, 0, 3.6);
    // à noite a luz direcional vira "luar": azulada, fraca, vinda do alto (posição aproximada)
    const moonDir = new THREE.Vector3(-0.35, 0.82, 0.45).normalize();
    this.lightDir.copy(this.sunDir.y > 0.02 ? this.sunDir : moonDir);
    timeUniforms.sunDir.value.copy(this.lightDir);
    if (this.sunDir.y > 0.02) {
      this.sun.color.setRGB(1.0, 0.96 - warm * 0.2, 0.9 - warm * 0.42);
      this.sun.intensity = sunI;
    } else {
      this.sun.color.setRGB(0.62, 0.72, 1.0);
      this.sun.intensity = 0.2 * night + 0.04;
    }
    (su.uSunColor.value as THREE.Color).copy(this.sun.color);
    // hemisfério: complemento suave do IBL (céu azul em cima, rebote quente do chão embaixo)
    const dayK = 1 - night;
    this.hemi.color.setRGB(0.66 + 0.06 * dayK, 0.74 + 0.03 * dayK, 0.88).multiplyScalar(1 - night * 0.75);
    this.hemi.groundColor.setRGB(0.56, 0.5, 0.42).multiplyScalar(1 - night * 0.7);
    this.hemi.intensity = THREE.MathUtils.lerp(THREE.MathUtils.clamp(0.12 + Math.sin(Math.max(elev, 0)) * 0.4, 0.12, 0.4), 0.3, night);
    (this.cloudUniforms.uSunDir.value as THREE.Vector3).copy(this.sunDir);
    (this.cloudUniforms.uSunColor.value as THREE.Color).copy(this.sun.color);
    this.cloudUniforms.uLight.value = THREE.MathUtils.clamp(0.35 + elev * 2.2, 0.35, 1.0) * (1 - night * 0.9);
    // neblina = cor do horizonte (umidade tropical), levemente clareada de dia
    const fog = this.scene.fog as THREE.Fog;
    fog.color.copy(sky.horizon).lerp(new THREE.Color(0.86, 0.88, 0.9), 0.15 * dayK);
    // exposição: dia contido (sol forte), noite mais aberta (como olho/câmera adaptados)
    this.renderer.toneMappingExposure = THREE.MathUtils.lerp(0.95, 1.35, night);
    this.updateEnvMap(sky);
  }

  /** Cena do IBL: céu + anel de silhuetas de prédios (para reflexos urbanos) + chão. */
  private makeEnvScene(): THREE.Scene {
    const envScene = new THREE.Scene();
    envScene.add(this.makeSky(this.skyUniforms, 900, 0));
    const ground = new THREE.Mesh(new THREE.SphereGeometry(500, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), this.envGroundMat);
    envScene.add(ground);
    // skyline: blocos em anel (raio ~200–320 m) com alturas de 20–90 m → 5°–25° de elevação
    const rnd = (i: number) => { const s = Math.sin(i * 12.9898) * 43758.5453; return s - Math.floor(s); };
    const box = new THREE.BoxGeometry(1, 1, 1);
    box.translate(0, 0.5, 0);
    const N = 40;
    const city = new THREE.InstancedMesh(box, this.envCityMat, N);
    const win = new THREE.InstancedMesh(box, this.envWindowsMat, N);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + rnd(i) * 0.08;
      const r = 200 + rnd(i + 50) * 120;
      const h = 20 + rnd(i + 90) * rnd(i + 130) * 90;
      p.set(Math.cos(a) * r, -2, Math.sin(a) * r);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a);
      sc.set(12, h, 34 + rnd(i + 7) * 30);
      city.setMatrixAt(i, m.compose(p, q, sc));
      // faixa de "janelas" escuras (reflexo de vidro dos prédios em frente)
      sc.set(12.5, h * 0.8, (34 + rnd(i + 7) * 30) * 0.9);
      p.y = h * 0.12;
      win.setMatrixAt(i, m.compose(p, q, sc));
    }
    envScene.add(city, win);
    return envScene;
  }

  private updateEnvMap(sky: SkyColors) {
    const n = this.night;
    // fachadas da skyline: claras de dia (concreto/reboco iluminado), escuras à noite
    const lum = THREE.MathUtils.lerp(0.28, 0.008, n);
    this.envCityMat.color.setRGB(lum * 1.05, lum, lum * 0.92);
    // vidro dos prédios vizinhos: escuro e azulado; à noite, pontos acesos médios (quentes)
    this.envWindowsMat.color.setRGB(0.05 + n * 0.05, 0.06 + n * 0.035, 0.075 + n * 0.01).multiplyScalar(1 - n * 0.4);
    this.envGroundMat.color.copy(sky.horizon).multiplyScalar(0.35).lerp(new THREE.Color(0.2, 0.19, 0.17), 0.5 * (1 - n));
    this.envRT?.dispose();
    this.envRT = this.pmrem.fromScene(this.envScene, 0.02, 1, 1100);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = THREE.MathUtils.lerp(0.72, 0.25, n);
  }

  /** disk: 1 desenha o disco solar (céu visível); 0 no IBL (o brilho especular do sol vem da luz direcional) */
  private makeSky(uniforms: Record<string, THREE.IUniform>, radius: number, disk: number): THREE.Mesh {
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...uniforms, uDisk: { value: disk } }, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
      side: THREE.BackSide, depthWrite: false, fog: false,
    });
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat);
    m.scale.setScalar(radius);
    m.frustumCulled = false;
    m.renderOrder = -2;
    m.name = 'sky';
    return m;
  }

  private makeClouds(radius: number): THREE.Mesh {
    const geo = new THREE.SphereGeometry(radius, 48, 24, 0, Math.PI * 2, 0, Math.PI * 0.48);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.cloudUniforms,
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
      fog: false,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * p;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform vec3 uSunDir; uniform vec3 uSunColor; uniform float uCoverage; uniform float uNight;
        uniform vec3 uHorizon; uniform float uLight;
        varying vec3 vDir;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
        float n(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
          return mix(mix(h(i), h(i+vec2(1,0)), u.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), u.x), u.y); }
        float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 6; i++){ s += a * n(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
        void main() {
          if (vDir.y < 0.0) discard;
          // projeção num plano de nuvens: cúmulos de bom tempo, esparsos (céu carioca de dia claro)
          vec2 uv = vDir.xz / (vDir.y + 0.12) * 1.6 + vec2(uTime * 0.004, uTime * 0.0015);
          float d = fbm(uv);
          float d2 = fbm(uv * 2.7 + 5.0);
          float dens = d * 0.75 + d2 * 0.35;
          float c = smoothstep(uCoverage, uCoverage + 0.16, dens);
          float horizonFade = smoothstep(0.03, 0.22, vDir.y);
          float alpha = c * horizonFade * 0.95;
          if (alpha < 0.01) discard;
          // iluminação: topo/borda iluminados pelo sol, base mais cinza-azulada
          float sunAmt = clamp(dot(normalize(vec3(vDir.x, 0.25, vDir.z)), normalize(vec3(uSunDir.x, 0.25, uSunDir.z))), 0.0, 1.0);
          float core = smoothstep(uCoverage, uCoverage + 0.45, dens);
          vec3 lit = vec3(1.0) * (0.9 + 0.5 * uSunColor * sunAmt);
          vec3 shade = vec3(0.6, 0.65, 0.74);
          vec3 col = mix(lit, shade, core * 0.7) * 1.25 * uLight;
          // perto do horizonte as nuvens somem na névoa
          col = mix(col, uHorizon * 1.05, 1.0 - horizonFade * 0.85);
          // noite: nuvens escuras iluminadas por baixo pela cidade (tom alaranjado)
          col = mix(col, vec3(0.03, 0.028, 0.03) + vec3(0.07, 0.04, 0.02) * (1.0 - vDir.y), uNight);
          gl_FragColor = vec4(col, alpha * mix(1.0, 0.8, uNight));
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const m = new THREE.Mesh(geo, mat);
    m.name = 'clouds';
    m.frustumCulled = false;
    m.renderOrder = -1;
    return m;
  }

  /** Mantém céu/nuvens centrados na câmera e a caixa de sombra seguindo o jogador (com snap anti-tremor). */
  update(camera: THREE.Camera, focus: THREE.Vector3, time: number) {
    this.sky.position.copy(camera.position);
    this.clouds.position.set(camera.position.x, 0, camera.position.z);
    this.cloudUniforms.uTime.value = time;
    if (this.sun.castShadow) {
      const d = this.shadowDistance;
      const texel = (2 * d) / this.sun.shadow.mapSize.x;
      // projetar o foco no espaço da luz e quantizar
      const lightRot = new THREE.Matrix4().lookAt(new THREE.Vector3(), this.lightDir.clone().negate(), new THREE.Vector3(0, 1, 0));
      const inv = lightRot.clone().invert();
      const f = focus.clone().applyMatrix4(inv);
      f.x = Math.round(f.x / texel) * texel;
      f.y = Math.round(f.y / texel) * texel;
      const snapped = f.applyMatrix4(lightRot);
      this.sun.target.position.copy(snapped);
      this.sun.position.copy(snapped).addScaledVector(this.lightDir, 600);
      this.sun.target.updateMatrixWorld();
    } else {
      this.sun.position.copy(focus).addScaledVector(this.lightDir, 600);
      this.sun.target.position.copy(focus);
      this.sun.target.updateMatrixWorld();
    }
  }
}

/**
 * Céu, sol, nuvens, iluminação ambiente (IBL), neblina e sombras.
 * Horário dirigido por data/hora reais (posição solar calculada) → pronto para manhã/tarde/pôr do sol/noite.
 */
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { sunPosition, sunDirection } from '../geo/solar';
import type { QualityPreset } from '../core/settings';
import { timeUniforms, nightFactor } from './timeOfDay';

export class Environment {
  readonly sky: Sky;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly clouds: THREE.Mesh;
  readonly sunDir = new THREE.Vector3();
  private pmrem: THREE.PMREMGenerator;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private cloudUniforms: Record<string, THREE.IUniform>;
  private shadowDistance = 0;
  /** 0 = dia, 1 = noite */
  night = 0;
  /** direção da luz principal (sol de dia, lua à noite) */
  private lightDir = new THREE.Vector3();

  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene, preset: QualityPreset) {
    this.sky = new Sky();
    this.sky.scale.setScalar(preset.cameraFar * 0.9);
    this.sky.frustumCulled = false;
    const u = this.sky.material.uniforms;
    u.turbidity.value = 3.2;
    u.rayleigh.value = 1.25;
    u.mieCoefficient.value = 0.0045;
    u.mieDirectionalG.value = 0.82;
    scene.add(this.sky);

    this.sun = new THREE.DirectionalLight(0xfff0dc, 3.2);
    this.sun.name = 'sun';
    this.hemi = new THREE.HemisphereLight(0xb9d3ee, 0x8a7d6a, 0.55);
    scene.add(this.sun, this.sun.target, this.hemi);

    this.cloudUniforms = {
      uTime: { value: 0 },
      uSunDir: { value: new THREE.Vector3() },
      uSunColor: { value: new THREE.Color(1, 0.93, 0.85) },
      uCoverage: { value: 0.47 },
      uNight: timeUniforms.night,
    };
    this.clouds = this.makeClouds(preset.cameraFar * 0.82);
    scene.add(this.clouds);

    this.pmrem = new THREE.PMREMGenerator(renderer);
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
      s.radius = 2.5;
      s.map?.dispose();
      (s as any).map = null;
    }
    this.scene.fog = new THREE.Fog(0xbfcfdf, 320, preset.fogFar);
  }

  /** Define o horário do mundo e recalcula sol, céu, cores e IBL. */
  setTime(date: Date, lat: number, lon: number) {
    const pos = sunPosition(date, lat, lon);
    const [x, y, z] = sunDirection(pos);
    this.sunDir.set(x, y, z).normalize();
    this.sky.material.uniforms.sunPosition.value.copy(this.sunDir);
    const elev = pos.elevation;
    const night = nightFactor(elev);
    this.night = night;
    timeUniforms.night.value = night;
    // cor/intensidade do sol: mais quente perto do horizonte
    const warm = THREE.MathUtils.clamp(1 - elev / 0.9, 0, 1);
    const sunI = THREE.MathUtils.clamp(Math.sin(Math.max(elev, 0)) * 11, 0, 3.8);
    // à noite a luz direcional vira "luar": azulada, fraca, vinda do alto (posição aproximada)
    const moonDir = new THREE.Vector3(-0.35, 0.82, 0.45).normalize();
    this.lightDir.copy(this.sunDir.y > 0.02 ? this.sunDir : moonDir);
    if (this.sunDir.y > 0.02) {
      this.sun.color.setRGB(1.0, 0.95 - warm * 0.16, 0.88 - warm * 0.3);
      this.sun.intensity = sunI;
    } else {
      this.sun.color.setRGB(0.62, 0.72, 1.0);
      this.sun.intensity = 0.22 * night + 0.05;
    }
    this.hemi.color.setRGB(0.72 - night * 0.55, 0.83 - night * 0.6, 0.93 - night * 0.55);
    this.hemi.groundColor.setRGB(0.54 - night * 0.3, 0.49 - night * 0.3, 0.42 - night * 0.25);
    this.hemi.intensity = THREE.MathUtils.lerp(THREE.MathUtils.clamp(0.12 + Math.sin(Math.max(elev, 0)) * 0.5, 0.12, 0.42), 0.35, night);
    (this.cloudUniforms.uSunDir.value as THREE.Vector3).copy(this.sunDir);
    (this.cloudUniforms.uSunColor.value as THREE.Color).copy(this.sun.color);
    // neblina: horizonte (dia) → azul-escuro com brilho alaranjado da cidade (noite)
    const fog = this.scene.fog as THREE.Fog;
    fog.color.setRGB(
      THREE.MathUtils.lerp(0.74 + warm * 0.08, 0.06, night),
      THREE.MathUtils.lerp(0.80 + warm * 0.02, 0.07, night),
      THREE.MathUtils.lerp(0.88 - warm * 0.06, 0.11, night),
    );
    this.renderer.toneMappingExposure = THREE.MathUtils.lerp(0.82, 1.25, night);
    this.updateEnvMap();
  }

  private updateEnvMap() {
    const envScene = new THREE.Scene();
    const sky = new Sky();
    sky.scale.setScalar(1000);
    const u = sky.material.uniforms, s = this.sky.material.uniforms;
    for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) u[k].value = s[k].value;
    u.sunPosition.value.copy(this.sunDir);
    envScene.add(sky);
    // "chão" difuso para que reflexos inferiores não fiquem pretos
    const ground = new THREE.Mesh(new THREE.SphereGeometry(500, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x5b5751, side: THREE.BackSide }));
    envScene.add(ground);
    this.envRT?.dispose();
    this.envRT = this.pmrem.fromScene(envScene, 0.02, 1, 1100);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = THREE.MathUtils.lerp(0.42, 0.12, this.night);
    sky.geometry.dispose();
    sky.material.dispose();
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
        varying vec3 vDir;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
        float n(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
          return mix(mix(h(i), h(i+vec2(1,0)), u.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), u.x), u.y); }
        float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 6; i++){ s += a * n(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
        void main() {
          if (vDir.y < 0.0) discard;
          // projeção num plano de nuvens (cúmulos espalhados)
          vec2 uv = vDir.xz / (vDir.y + 0.12) * 1.6 + vec2(uTime * 0.004, uTime * 0.0015);
          float d = fbm(uv);
          float d2 = fbm(uv * 2.7 + 5.0);
          float c = smoothstep(uCoverage, uCoverage + 0.22, d * 0.75 + d2 * 0.35);
          float horizonFade = smoothstep(0.02, 0.2, vDir.y);
          float alpha = c * horizonFade * 0.92;
          if (alpha < 0.01) discard;
          // iluminação: borda iluminada pelo sol, base mais escura
          float sunAmt = clamp(dot(normalize(vec3(vDir.x, 0.25, vDir.z)), normalize(vec3(uSunDir.x, 0.25, uSunDir.z))), 0.0, 1.0);
          vec3 base = mix(vec3(0.62, 0.66, 0.72), vec3(0.98, 0.97, 0.95), d2);
          vec3 col = base * (0.75 + 0.35 * uSunColor * (0.4 + sunAmt));
          col = mix(col, vec3(0.80, 0.84, 0.90), 1.0 - horizonFade * 0.8);
          // noite: nuvens escuras iluminadas por baixo pela cidade (tom alaranjado)
          col = mix(col, vec3(0.10, 0.09, 0.10) + vec3(0.10, 0.06, 0.03) * (1.0 - vDir.y), uNight);
          gl_FragColor = vec4(col, alpha * mix(1.0, 0.85, uNight));
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

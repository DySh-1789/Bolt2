import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { PostFxState } from '../types/game';

/**
 * Accepts Bolt 2's PostFxState plus optional Bolt 1 / cinematic fields (soulkiller, letterbox)
 * safely so callers remain compatible across concurrent updates.
 */
export type EnginePostFxInput = Partial<PostFxState> & {
  soulkiller?: number;
  letterbox?: number;
};

/**
 * Unified Cyberpunk Post-Processing Shader combining Bolt 1 & Bolt 2 effects:
 * Glitch tear, Relic biochip malfunction, Sandevistan overdrive, Huyeshi Cyberspace matrix,
 * Soulkiller digital matrix dissolution, high-speed driving lines, damage vignette,
 * eyelids blink, widescreen cinema letterbox bars & blackout fade.
 */
const CyberpunkPostShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uGlitch: { value: 0 },
    uRelicGlitch: { value: 0 },
    uDamageVignette: { value: 0 },
    uSandevistan: { value: 0 },
    uCyberspace: { value: 0 },
    uSoulkiller: { value: 0 },
    uSpeedLines: { value: 0 },
    uBlackout: { value: 0 },
    uEyelids: { value: 0 },
    uChromaticBoost: { value: 0 },
    uLetterbox: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uGlitch;
    uniform float uRelicGlitch;
    uniform float uDamageVignette;
    uniform float uSandevistan;
    uniform float uCyberspace;
    uniform float uSoulkiller;
    uniform float uSpeedLines;
    uniform float uBlackout;
    uniform float uEyelids;
    uniform float uChromaticBoost;
    uniform float uLetterbox;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    void main() {
      vec2 uv = vUv;

      // Horizontal glitch slicing (Relic malfunction / damage / Soulkiller / Cyberspace)
      float glitchAmt = clamp(
        uGlitch + uRelicGlitch * 0.85 + uSoulkiller * 0.65 + uCyberspace * 0.25,
        0.0,
        1.5
      );
      if (glitchAmt > 0.01) {
        float slice = floor(uv.y * 44.0 + floor(uTime * 19.0));
        float rnd = hash(vec2(slice, floor(uTime * 24.0)));
        if (rnd > 0.72 - glitchAmt * 0.26) {
          uv.x += (rnd - 0.5) * 0.068 * glitchAmt;
        }
      }

      // Chromatic aberration
      vec2 centerVec = uv - 0.5;
      float distCenter = length(centerVec);
      float ca = 0.0012
        + uChromaticBoost * 0.007
        + uSandevistan * 0.006
        + uSpeedLines * 0.004
        + glitchAmt * 0.011;
      vec2 caOffset = centerVec * ca * (0.6 + distCenter * 1.35);

      float r = texture2D(tDiffuse, clamp(uv + caOffset, 0.001, 0.999)).r;
      float g = texture2D(tDiffuse, clamp(uv, 0.001, 0.999)).g;
      float b = texture2D(tDiffuse, clamp(uv - caOffset, 0.001, 0.999)).b;
      vec3 col = vec3(r, g, b);

      // Subtle cyberpunk CRT scanlines
      float scan = sin(uv.y * 720.0 + uTime * 3.0) * 0.011;
      col -= scan * (0.32 + glitchAmt * 1.35);

      // Relic biochip malfunction cyan/crimson interference pulse
      if (uRelicGlitch > 0.01) {
        float band = sin(uv.y * 60.0 + uTime * 32.0) * 0.5 + 0.5;
        vec3 relicCol = mix(vec3(0.0, 0.95, 1.0), vec3(1.0, 0.05, 0.35), band);
        col = mix(col, col + relicCol * 0.32, uRelicGlitch * 0.55);
      }

      // Sandevistan golden-cyan overdrive grading
      if (uSandevistan > 0.01) {
        vec3 sandyTint = vec3(0.08, 0.92, 1.0);
        float rim = smoothstep(0.24, 0.85, distCenter);
        col = mix(col, col * vec3(0.92, 1.08, 1.18) + sandyTint * rim * 0.24, uSandevistan * 0.72);
      }

      // High-speed driving radial streaks
      if (uSpeedLines > 0.02) {
        float angle = atan(centerVec.y, centerVec.x);
        float streak = pow(max(0.0, sin(angle * 48.0 + uTime * 14.0)), 8.0);
        float rimMask = smoothstep(0.32, 0.78, distCenter);
        col += vec3(0.0, 0.9, 1.0) * streak * rimMask * uSpeedLines * 0.25;
      }

      // Huyeshi Cyberspace wireframe/matrix grading
      if (uCyberspace > 0.01) {
        float gx = abs(fract(uv.x * 36.0) - 0.5);
        float gy = abs(fract(uv.y * 22.0 - uTime * 1.1) - 0.5);
        float grid = smoothstep(0.47, 0.5, max(gx, gy));
        vec3 cyberTint = mix(vec3(0.0, 0.95, 1.0), vec3(1.0, 0.08, 0.42), smoothstep(0.15, 0.85, uv.y));
        col = mix(col, col * 0.85 + cyberTint * (0.14 + grid * 0.35), uCyberspace * 0.75);
      }

      // Exact Bolt 1 Soulkiller digital matrix dissolution (red/cyan wireframe & scan grid)
      if (uSoulkiller > 0.01) {
        float gx = abs(fract(uv.x * 36.0) - 0.5);
        float gy = abs(fract(uv.y * 22.0 - uTime * 1.4) - 0.5);
        float grid = smoothstep(0.46, 0.5, max(gx, gy));
        float luma = dot(col, vec3(0.299, 0.587, 0.114));
        vec3 engramCol = mix(
          vec3(1.0, 0.02, 0.24),
          vec3(0.0, 0.95, 1.0),
          smoothstep(0.15, 0.75, luma + sin(uTime * 4.0 + uv.y * 8.0) * 0.2)
        );
        vec3 matrixCol = engramCol * (0.4 + luma * 1.4) + vec3(0.0, 1.0, 1.0) * grid * 0.55;
        col = mix(col, matrixCol, clamp(uSoulkiller * 0.92, 0.0, 0.95));
        // Ascending white-cyan flash near 100% extraction
        float surge = smoothstep(0.82, 1.0, uSoulkiller);
        col = mix(col, vec3(0.75, 0.98, 1.0), surge * 0.85);
      }

      // Subtle cinematic vignette + crimson trauma overlay
      float baseVignette = smoothstep(0.56, 1.0, distCenter) * 0.20;
      col *= (1.0 - baseVignette);
      if (uDamageVignette > 0.01) {
        float dmgMask = smoothstep(0.22, 0.85, distCenter) * uDamageVignette;
        col = mix(col, vec3(0.88, 0.02, 0.08), clamp(dmgMask * 0.85, 0.0, 0.9));
      }

      // Eyelid blink / awakening on Junkyard or operating table
      if (uEyelids > 0.01) {
        float dy = abs(vUv.y - 0.5) * 2.0;
        float openThreshold = clamp(1.0 - uEyelids, 0.0, 1.0);
        float lidMask = smoothstep(openThreshold - 0.14, openThreshold + 0.04, dy);
        col *= (1.0 - lidMask);
      }

      // Smooth widescreen black cinema bars at top/bottom during cutscenes
      if (uLetterbox > 0.001) {
        float barHeight = clamp(uLetterbox, 0.0, 1.0) * 0.115;
        float distEdge = min(vUv.y, 1.0 - vUv.y);
        float barMask = smoothstep(barHeight - 0.004, barHeight + 0.004, distEdge);
        col *= barMask;
      }

      // Full blackout fade
      col *= (1.0 - clamp(uBlackout, 0.0, 1.0));
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export class Engine {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private bloomPass: UnrealBloomPass;
  private outputPass: OutputPass;
  private postPass: ShaderPass;
  private envRenderTarget: THREE.WebGLRenderTarget;
  private container: HTMLElement;
  private elapsed = 0;

  constructor(container: HTMLElement) {
    this.container = container;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x070a18);
    this.scene.fog = new THREE.FogExp2(0x090e20, 0.0042);

    const width = Math.max(container.clientWidth, window.innerWidth, 1);
    const height = Math.max(container.clientHeight, window.innerHeight, 1);

    // Far clip 680m so distant Zailiyskiy Alatau mountains, Kok-Tobe & Marakulin Tower shine across 500x500m city
    this.camera = new THREE.PerspectiveCamera(75, width / height, 0.08, 680);

    // Subtle tactical rim/fill light on player weapon & close characters without harsh wall hotspots
    const cameraFill = new THREE.PointLight(0x9ec4e8, 1.6, 11, 1.6);
    cameraFill.position.set(0, 0.18, 0.25);
    this.camera.add(cameraFill);
    this.scene.add(this.camera);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.04;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    // Rich Cyberpunk PMREM IBL environment map for metallic chrome, wet asphalt & armor reflections
    this.envRenderTarget = this.createCyberpunkEnvironment();
    this.scene.environment = this.envRenderTarget.texture;
    this.scene.environmentIntensity = 0.48;

    // Post-processing pipeline: Render (linear) -> Bloom (HDR linear) -> OutputPass (ACES + sRGB) -> CyberpunkPostShader
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(width, height), 0.36, 0.42, 0.88);
    this.composer.addPass(this.bloomPass);

    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);

    this.postPass = new ShaderPass(CyberpunkPostShader);
    this.composer.addPass(this.postPass);

    window.addEventListener('resize', this.handleResize);
  }

  private createCyberpunkEnvironment(): THREE.WebGLRenderTarget {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    pmrem.compileEquirectangularShader();

    const envScene = new THREE.Scene();
    envScene.background = new THREE.Color(0x0a1022);

    const tempMeshes: THREE.Mesh[] = [];
    const addPanel = (
      x: number,
      y: number,
      z: number,
      w: number,
      h: number,
      d: number,
      colorHex: number,
    ) => {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, d),
        new THREE.MeshBasicMaterial({ color: colorHex }),
      );
      m.position.set(x, y, z);
      envScene.add(m);
      tempMeshes.push(m);
    };

    // Overhead alpine-night skylight + deep horizon glow panels
    addPanel(0, 10, 0, 16, 0.5, 16, 0x4b6a9c);
    addPanel(-10, 3.2, 0, 0.5, 5.5, 14, 0x00a8c2);
    addPanel(10, 3.2, 0, 0.5, 5.5, 14, 0xb81a4a);
    addPanel(0, 4.2, -10, 14, 3.8, 0.5, 0xa88a2e);
    addPanel(0, 4.2, 10, 14, 3.8, 0.5, 0x453594);
    addPanel(0, -8, 0, 20, 0.5, 20, 0x12192b);

    // Crisp specular neon accent strips for realistic blade, car & wet-puddle highlights
    addPanel(-7.5, 6.5, -5.5, 0.4, 2.2, 5.0, 0x55f6ff);
    addPanel(7.5, 6.0, -4.5, 0.4, 2.0, 4.5, 0xff2a6d);
    addPanel(0, 7.2, 7.5, 6.5, 1.2, 0.4, 0xfcee0a);

    const rt = pmrem.fromScene(envScene, 0.05);
    for (const m of tempMeshes) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    pmrem.dispose();
    return rt;
  }

  private handleResize = (): void => {
    const width = Math.max(this.container.clientWidth, window.innerWidth, 1);
    const height = Math.max(this.container.clientHeight, window.innerHeight, 1);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.composer.setSize(width, height);
    this.bloomPass.setSize(width, height);
  };

  setAtmosphere(bgHex: number, fogHex: number, fogDensity: number): void {
    this.scene.background = new THREE.Color(bgHex);
    this.scene.fog = new THREE.FogExp2(fogHex, fogDensity);
  }

  /** Bolt 1 compatibility helper for dynamic fog density transitions. */
  setFogDensity(density: number, colorHex = 0x070914): void {
    this.scene.fog = new THREE.FogExp2(colorHex, density);
  }

  render(dt: number, fx: EnginePostFxInput): void {
    this.elapsed += dt;

    const glitch = fx.glitch ?? 0;
    const relicGlitch = fx.relicGlitch ?? 0;
    const damageVignette = fx.damageVignette ?? 0;
    const sandevistan = fx.sandevistan ?? 0;
    const cyberspace = fx.cyberspace ?? 0;
    const soulkiller = fx.soulkiller ?? 0;
    const speedLines = fx.speedLines ?? 0;
    const blackout = fx.blackout ?? 0;
    const eyelids = fx.eyelids ?? 0;
    const chromaticBoost = fx.chromaticBoost ?? 0;
    const letterbox = fx.letterbox ?? 0;

    const u = this.postPass.uniforms;
    u.uTime.value = this.elapsed;
    u.uGlitch.value = glitch;
    u.uRelicGlitch.value = relicGlitch;
    u.uDamageVignette.value = damageVignette;
    u.uSandevistan.value = sandevistan;
    u.uCyberspace.value = cyberspace;
    u.uSoulkiller.value = soulkiller;
    u.uSpeedLines.value = speedLines;
    u.uBlackout.value = blackout;
    u.uEyelids.value = eyelids;
    u.uChromaticBoost.value = chromaticBoost;
    u.uLetterbox.value = letterbox;

    this.bloomPass.strength = 0.36 + cyberspace * 0.42 + soulkiller * 0.52 + sandevistan * 0.16;
    this.composer.render();
  }

  dispose(): void {
    window.removeEventListener('resize', this.handleResize);
    this.envRenderTarget.dispose();
    this.bloomPass.dispose();
    this.postPass.dispose();
    this.outputPass.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}

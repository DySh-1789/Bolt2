import * as THREE from 'three';
import type { InteractablePoint } from '../types/game';
import type { PhysicsWorld } from '../engine/Physics';
import type { ProceduralTextures } from '../engine/ProceduralTextures';
import {
  animateHologramRig,
  buildLevMarakulinModel,
  buildRodionModel,
  buildSamirHologram,
  buildSanzharModel,
  buildTaisiyaCyberspaceModel,
  type CharacterRig,
} from './CharacterModels';
import { ElevatorRig } from './ElevatorSystem';

export const INSTANCE_Y = {
  PENTHOUSE: 120,
  CHASE: 220,
  UNDERGROUND: -90,
  CYBERSPACE: 320,
  TALDYKORGAN: 420,
} as const;

interface SupplyCrateVisual {
  id: string;
  group: THREE.Group;
  glowMat: THREE.MeshStandardMaterial;
  light: THREE.PointLight;
  used: boolean;
}

interface TrafficStreak {
  mesh: THREE.Mesh;
  speed: number;
  minZ: number;
  maxZ: number;
}

interface OrbitingShard {
  mesh: THREE.Mesh;
  radius: number;
  baseY: number;
  speed: number;
  phase: number;
  bobAmp: number;
}

interface PenthouseAv {
  mesh: THREE.Group;
  speed: number;
  minZ: number;
  maxZ: number;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function smoothstep(t: number): number {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}

/**
 * Isolated vertical story instances so all scripted set-pieces from Сценарий.odt
 * load instantaneously without conflicting with the 500x500m Cyber-Almaty chunk grid.
 *
 * Upgraded to Bolt 1's Marakulin Tower & OperatingTableScene lighting and architectural craft.
 */
export class StoryInstances {
  readonly interactables: InteractablePoint[] = [];

  // Penthouse (Act 2: 2 weeks ago)
  readonly penthouseGroup = new THREE.Group();
  readonly penthouseSanzhar: CharacterRig;
  readonly penthouseRodion: CharacterRig;
  readonly penthouseLev: CharacterRig;
  readonly penthouseSmasherProp = new THREE.Group();
  readonly biochipCase = new THREE.Group();
  readonly penthouseElevator: ElevatorRig;
  private penthouseAvs: PenthouseAv[] = [];
  private penthouseHoloRing: THREE.Mesh | null = null;
  private penthouseSmasherLeftArm: THREE.Group | null = null;
  private penthouseSmasherRightArm: THREE.Group | null = null;

  // Taxi Chase Highway & Cyber-Akhmed 1st-Person Interior (Act 3)
  readonly chaseGroup = new THREE.Group();
  readonly chaseSanzhar: CharacterRig;
  private chaseArches: THREE.Group[] = [];
  private chaseSkyscrapers: THREE.Group[] = [];
  private chaseTraffic: TrafficStreak[] = [];
  private chaseSteeringWheel: THREE.Group | null = null;
  private chaseBiochip = new THREE.Group();
  private chaseBiochipLight: THREE.PointLight | null = null;
  private chaseBiochipVisible = false;
  private chaseBiochipProgress = 0;
  private chaseSanzharWounded = false;
  private chaseSanzharWoundMesh: THREE.Mesh | null = null;
  private chaseCabinLight: THREE.PointLight | null = null;

  // Marakulin Tower Assault & Underground Huyeshi (Acts 7-8)
  readonly undergroundGroup = new THREE.Group();
  readonly undergroundSamir: CharacterRig;
  readonly undergroundElevator: ElevatorRig;
  private towerAlarmLights: THREE.PointLight[] = [];
  private towerHoloSpinner: THREE.Group | null = null;
  private supplyCrates = new Map<string, SupplyCrateVisual>();
  private securityTerminalBeaconMat: THREE.MeshStandardMaterial | null = null;
  private securityTerminalLight: THREE.PointLight | null = null;

  // Huyeshi Chamber Surgical / Neural Extraction Set-Piece (Z = -90)
  private huyeshiCrown = new THREE.Group();
  private huyeshiLasers = new THREE.Group();
  private huyeshiSurgicalLight!: THREE.SpotLight;
  private huyeshiExtractLight!: THREE.PointLight;
  private huyeshiAmbientRing: THREE.Mesh | null = null;
  private huyeshiParticles!: THREE.Points;
  private huyeshiParticleSpeeds!: Float32Array;
  private huyeshiExtractionProgress = 0;

  // Cyberspace & Taisiya (Act 9)
  readonly cyberspaceGroup = new THREE.Group();
  readonly taisiyaRig: CharacterRig;
  private cyberParticles!: THREE.Points;
  private cyberShards: OrbitingShard[] = [];
  private cyberDataStreams: THREE.Mesh[] = [];
  private cyberPortalRings: THREE.Mesh[] = [];
  private cyberBlackwallMat: THREE.MeshStandardMaterial | null = null;

  // Taldykorgan Road Epilogue (Act 10B)
  readonly taldykorganGroup = new THREE.Group();
  private taldyRoadPosts: THREE.Group[] = [];
  private taldyDustParticles!: THREE.Points;
  private taldyDashCharm: THREE.Mesh | null = null;
  private taldySteeringWheel: THREE.Group | null = null;

  private physics: PhysicsWorld;
  private textures: ProceduralTextures;
  private localTextures: THREE.CanvasTexture[] = [];

  constructor(scene: THREE.Scene, physics: PhysicsWorld, textures: ProceduralTextures) {
    this.physics = physics;
    this.textures = textures;

    // Build Penthouse (Y = 120)
    this.penthouseSanzhar = buildSanzharModel();
    this.penthouseRodion = buildRodionModel();
    this.penthouseLev = buildLevMarakulinModel();
    this.penthouseElevator = new ElevatorRig(
      {
        id: 'penthouse_escape_elev',
        centerX: 0,
        centerZ: -38,
        startY: INSTANCE_Y.PENTHOUSE,
        endY: INSTANCE_Y.PENTHOUSE - 18,
        startFloorLabel: 92,
        endFloorLabel: 1,
        travelDuration: 3.4,
        doorFacingZ: 1,
      },
      this.penthouseGroup,
      physics,
      textures,
    );
    this.buildPenthouse();
    scene.add(this.penthouseGroup);

    // Build Chase Track & Cyber-Akhmed Interior (Y = 220)
    this.chaseSanzhar = buildSanzharModel();
    this.buildChaseTrack();
    scene.add(this.chaseGroup);

    // Build Marakulin Tower Lobby + Underground Smasher Arena + Huyeshi Chamber (Y = -66 / -90)
    this.undergroundSamir = buildSamirHologram();
    this.undergroundElevator = new ElevatorRig(
      {
        id: 'tower_descent_elev',
        centerX: 0,
        centerZ: -30,
        startY: INSTANCE_Y.UNDERGROUND + 24,
        endY: INSTANCE_Y.UNDERGROUND,
        startFloorLabel: 1,
        endFloorLabel: -12,
        travelDuration: 3.6,
        doorFacingZ: 1,
      },
      this.undergroundGroup,
      physics,
      textures,
    );
    this.buildMarakulinUnderground();
    scene.add(this.undergroundGroup);

    // Build Cyberspace (Y = 320)
    this.taisiyaRig = buildTaisiyaCyberspaceModel();
    this.buildCyberspace();
    scene.add(this.cyberspaceGroup);

    // Build Taldykorgan Highway Epilogue (Y = 420)
    this.buildTaldykorganRoad();
    scene.add(this.taldykorganGroup);

    this.setActiveInstance('NONE');
  }

  setActiveInstance(name: 'NONE' | 'PENTHOUSE' | 'CHASE' | 'UNDERGROUND' | 'CYBERSPACE' | 'TALDYKORGAN'): void {
    this.penthouseGroup.visible = name === 'PENTHOUSE';
    this.chaseGroup.visible = name === 'CHASE';
    this.undergroundGroup.visible = name === 'UNDERGROUND';
    this.cyberspaceGroup.visible = name === 'CYBERSPACE';
    this.taldykorganGroup.visible = name === 'TALDYKORGAN';
  }

  // =========================================================================
  // SHARED GEOMETRY & PROCEDURAL TEXTURE HELPERS (BOLT 1 VISUAL CRAFT)
  // =========================================================================

  private createCanvasTexture(
    width: number,
    height: number,
    draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
    repeatX = 1,
    repeatY = 1,
  ): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      draw(ctx, width, height);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeatX, repeatY);
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    this.localTextures.push(tex);
    return tex;
  }

  private addNeonStrip(
    parent: THREE.Object3D,
    cx: number,
    cy: number,
    cz: number,
    sx: number,
    sy: number,
    sz: number,
    colorHex: number,
    intensity = 1.55,
  ): THREE.Mesh {
    const mat = new THREE.MeshStandardMaterial({
      color: colorHex,
      emissive: colorHex,
      emissiveIntensity: Math.min(intensity, 2.2),
      roughness: 0.3,
    });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    mesh.position.set(cx, cy, cz);
    parent.add(mesh);
    return mesh;
  }

  private addEmissiveBanner(
    parent: THREE.Object3D,
    texture: THREE.Texture,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    rotY = 0,
    emissiveIntensity = 0.82,
  ): THREE.Mesh {
    const mat = new THREE.MeshStandardMaterial({
      map: texture,
      emissiveMap: texture,
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity,
      roughness: 0.42,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotY;
    parent.add(mesh);
    return mesh;
  }

  private createEcgMonitorTexture(): THREE.CanvasTexture {
    return this.createCanvasTexture(512, 256, (ctx, w, h) => {
      ctx.fillStyle = '#040a12';
      ctx.fillRect(0, 0, w, h);

      // Subtle medical oscilloscope grid
      ctx.strokeStyle = 'rgba(0, 240, 255, 0.14)';
      ctx.lineWidth = 1;
      for (let x = 0; x < w; x += 24) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let y = 0; y < h; y += 24) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      ctx.strokeStyle = '#00ffaa';
      ctx.lineWidth = 4;
      ctx.strokeRect(5, 5, w - 10, h - 10);

      // Header
      ctx.fillStyle = '#00ffaa';
      ctx.font = '900 22px monospace';
      ctx.fillText('NEURO-ECG // МОНИТОР ЖИЗНЕОБЕСПЕЧЕНИЯ', 18, 34);

      ctx.fillStyle = '#ff003c';
      ctx.font = '800 20px monospace';
      ctx.fillText('BPM: 142 [КРИТ.]', 310, 68);

      ctx.fillStyle = '#00f0ff';
      ctx.font = '700 17px monospace';
      ctx.fillText('СИНХРОНИЗАЦИЯ РЕЛИКВИИ: 91.4%', 18, 68);

      // Glowing heartbeat waveform
      ctx.save();
      ctx.strokeStyle = '#00ffaa';
      ctx.shadowColor = '#00ffaa';
      ctx.shadowBlur = 14;
      ctx.lineWidth = 4;
      ctx.beginPath();
      const baseY = 146;
      const pts: Array<[number, number]> = [
        [18, baseY],
        [70, baseY],
        [86, baseY - 14],
        [100, baseY],
        [114, baseY + 12],
        [128, baseY - 62],
        [142, baseY + 32],
        [156, baseY],
        [185, baseY - 16],
        [208, baseY],
        [260, baseY],
        [276, baseY - 12],
        [290, baseY],
        [304, baseY + 14],
        [318, baseY - 58],
        [332, baseY + 28],
        [346, baseY],
        [380, baseY - 18],
        [406, baseY],
        [494, baseY],
      ];
      pts.forEach(([px, py], idx) => {
        if (idx === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
      ctx.restore();

      // Bottom warning strip
      ctx.fillStyle = '#ff003c';
      ctx.fillRect(18, 204, w - 36, 30);
      ctx.fillStyle = '#ffffff';
      ctx.font = '900 17px monospace';
      ctx.fillText('ВНИМАНИЕ: ЭКСТРАКЦИЯ «ХУЕШИ» ГОТОВА К ПУСКУ', 34, 224);
    });
  }

  private createAkhmedHudTexture(): THREE.CanvasTexture {
    return this.createCanvasTexture(512, 256, (ctx, w, h) => {
      ctx.fillStyle = '#040a16';
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = '#00f0ff';
      ctx.lineWidth = 6;
      ctx.strokeRect(6, 6, w - 12, h - 12);

      // Scanlines
      ctx.fillStyle = 'rgba(0, 240, 255, 0.05)';
      for (let y = 12; y < h - 12; y += 8) {
        ctx.fillRect(12, y, w - 24, 2);
      }

      ctx.save();
      ctx.shadowColor = '#00f0ff';
      ctx.shadowBlur = 18;
      ctx.fillStyle = '#00f0ff';
      ctx.font = '900 38px "Segoe UI", sans-serif';
      ctx.fillText('КИБЕР-АХМЕД AI', 24, 58);
      ctx.restore();

      ctx.fillStyle = '#ff2a6d';
      ctx.font = '800 22px monospace';
      ctx.fillText('БОЕВОЙ РЕЖИМ // УХОД ОТ ПОГОНИ', 24, 96);

      ctx.fillStyle = '#fcee0a';
      ctx.font = '900 44px monospace';
      ctx.fillText('186 КМ/Ч', 24, 158);

      ctx.fillStyle = '#a8e8ff';
      ctx.font = '700 18px monospace';
      ctx.fillText('МАРШРУТ: МАРАКУЛИН → ПР. АБАЯ → ТАСТАК', 24, 198);
      ctx.fillText('БРОНЯ КУЗОВА: 94%   |   НИТРО: АКТИВНО', 24, 228);

      // Animated-look equalizer bars on right side
      for (let i = 0; i < 8; i++) {
        const bh = 28 + ((i * 23) % 72);
        ctx.fillStyle = i % 2 === 0 ? '#00f0ff' : '#ff2a6d';
        ctx.fillRect(326 + i * 20, 162 - bh, 12, bh);
      }
    });
  }

  private createBlackwallTexture(): THREE.CanvasTexture {
    return this.createCanvasTexture(
      512,
      512,
      (ctx, w, h) => {
        const grad = ctx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, '#12020a');
        grad.addColorStop(0.5, '#2d0414');
        grad.addColorStop(1, '#090208');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);

        // Glowing crimson data columns
        for (let col = 0; col < 32; col++) {
          const x = col * 16;
          const intensity = 0.25 + ((col * 19) % 10) * 0.07;
          ctx.fillStyle = `rgba(255, 0, 60, ${intensity.toFixed(2)})`;
          ctx.fillRect(x + 2, 0, 10, h);

          ctx.fillStyle = col % 5 === 0 ? 'rgba(0, 240, 255, 0.45)' : 'rgba(255, 80, 110, 0.75)';
          for (let row = 0; row < 24; row++) {
            if ((col * 7 + row * 13) % 3 === 0) {
              ctx.fillRect(x + 3, row * 22 + 4, 8, 12);
            }
          }
        }

        // Horizontal Blackwall firewall glitch bars
        for (let y = 0; y < h; y += 32) {
          ctx.fillStyle = y % 64 === 0 ? 'rgba(255, 0, 60, 0.42)' : 'rgba(0, 240, 255, 0.16)';
          ctx.fillRect(0, y, w, 4);
        }

        ctx.save();
        ctx.strokeStyle = '#ff003c';
        ctx.lineWidth = 6;
        ctx.strokeRect(8, 8, w - 16, h - 16);
        ctx.restore();
      },
      3,
      1,
    );
  }

  private createSunsetSkyTexture(): THREE.CanvasTexture {
    return this.createCanvasTexture(1024, 512, (ctx, w, h) => {
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0.0, '#09071a');
      grad.addColorStop(0.24, '#1b0d30');
      grad.addColorStop(0.42, '#5a1638');
      grad.addColorStop(0.56, '#c7342b');
      grad.addColorStop(0.68, '#ff7b24');
      grad.addColorStop(0.78, '#ffbe55');
      grad.addColorStop(0.86, '#5c2618');
      grad.addColorStop(1.0, '#22100a');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      // Subtle twilight stars in zenith
      ctx.fillStyle = 'rgba(255, 240, 210, 0.72)';
      for (let i = 0; i < 120; i++) {
        const sx = (i * 197) % w;
        const sy = (i * 53) % Math.floor(h * 0.36);
        ctx.fillRect(sx, sy, 2, 2);
      }

      // Distant Kazakh steppe ridge silhouette along horizon
      ctx.fillStyle = '#240f0c';
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let x = 0; x <= w; x += 32) {
        const ridgeY = h * 0.78 - Math.sin(x * 0.018) * 14 - Math.cos(x * 0.047) * 8;
        ctx.lineTo(x, ridgeY);
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fill();
    });
  }

  private createSynthwaveSunTexture(): THREE.CanvasTexture {
    return this.createCanvasTexture(512, 512, (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      ctx.save();
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, w * 0.46, 0, Math.PI * 2);
      ctx.clip();

      const grad = ctx.createLinearGradient(0, h * 0.04, 0, h * 0.96);
      grad.addColorStop(0.0, '#fff57a');
      grad.addColorStop(0.38, '#ffaa22');
      grad.addColorStop(0.7, '#ff3a2d');
      grad.addColorStop(1.0, '#c20a54');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      // Iconic retro-synthwave horizontal slices on lower half
      ctx.globalCompositeOperation = 'destination-out';
      const stripes = [
        [278, 7],
        [308, 10],
        [342, 13],
        [378, 17],
        [418, 22],
        [462, 28],
      ];
      for (const [sy, sh] of stripes) {
        ctx.fillRect(0, sy, w, sh);
      }
      ctx.restore();
    });
  }

  private addSupplyCrate(parent: THREE.Object3D, id: string, x: number, baseY: number, z: number): void {
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x1e2c3b,
      metalness: 0.45,
      roughness: 0.46,
    });
    const glowMat = new THREE.MeshStandardMaterial({
      color: 0x00ff88,
      emissive: 0x00ff88,
      emissiveIntensity: 1.65,
      roughness: 0.25,
    });

    const base = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.74, 0.84), bodyMat);
    base.position.y = 0.37;
    group.add(base);

    const lid = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.1, 0.88), bodyMat);
    lid.position.y = 0.76;
    group.add(lid);

    // Iconic Bolt 1 glowing green medical cross on top
    const crossH = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.07, 0.12), glowMat);
    crossH.position.set(0, 0.83, 0);
    const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.07, 0.44), glowMat);
    crossV.position.set(0, 0.83, 0);
    group.add(crossH, crossV);

    // Glowing wrap-around neon belt
    const strip = new THREE.Mesh(new THREE.BoxGeometry(1.19, 0.07, 0.88), glowMat);
    strip.position.y = 0.56;
    group.add(strip);

    const light = new THREE.PointLight(0x00ff88, 8, 9, 1.5);
    light.position.set(0, 1.35, 0);
    group.add(light);

    group.position.set(x, baseY, z);
    parent.add(group);

    this.physics.addBox(`${id}_box`, x, baseY + 0.38, z, 1.15, 0.76, 0.84, {
      blocksSight: false,
      blocksBullets: true,
    });

    this.supplyCrates.set(id, { id, group, glowMat, light, used: false });
    this.interactables.push({
      id,
      label: '[E] ПОПОЛНИТЬ MAXDOC И БРОНЮ',
      x,
      y: baseY + 0.9,
      z,
      radius: 2.9,
      enabled: true,
      category: 'loot',
    });
  }

  // =========================================================================
  // 1. PENTHOUSE HEIST (Y = 120) — BOLT 1 CUTSCENE QUALITY
  // =========================================================================

  private buildDetailedSmasherProp(): void {
    const obsidian = new THREE.MeshStandardMaterial({
      color: 0x131722,
      metalness: 0.86,
      roughness: 0.24,
    });
    const chrome = new THREE.MeshStandardMaterial({
      color: 0x677899,
      metalness: 0.92,
      roughness: 0.18,
    });
    const crimsonGlow = new THREE.MeshStandardMaterial({
      color: 0xff003c,
      emissive: 0xff003c,
      emissiveIntensity: 2.3,
      roughness: 0.2,
    });

    // Heavy armored cyber-legs (3m total height!)
    for (const sx of [-0.48, 0.48]) {
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.26, 0.78), obsidian);
      boot.position.set(sx, 0.13, 0.08);
      const shin = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.72, 0.56), obsidian);
      shin.position.set(sx, 0.58, 0);
      const knee = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.22, 0.64), chrome);
      knee.position.set(sx, 0.96, 0.06);
      const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.54, 0.6), obsidian);
      thigh.position.set(sx, 1.24, 0);
      this.penthouseSmasherProp.add(boot, shin, knee, thigh);
    }

    // Armored pelvis & hulking exo-torso
    const pelvis = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.34, 0.86), chrome);
    pelvis.position.set(0, 1.54, 0);
    const torso = new THREE.Mesh(new THREE.BoxGeometry(1.66, 1.18, 1.06), obsidian);
    torso.position.set(0, 2.18, 0);
    const chestPlate = new THREE.Mesh(new THREE.BoxGeometry(1.38, 0.78, 0.18), chrome);
    chestPlate.position.set(0, 2.28, 0.52);
    const reactor = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.14, 14), crimsonGlow);
    reactor.rotation.x = Math.PI / 2;
    reactor.position.set(0, 2.24, 0.59);
    this.penthouseSmasherProp.add(pelvis, torso, chestPlate, reactor);

    // Massive armored shoulder pauldrons
    for (const sx of [-1.06, 1.06]) {
      const pauldron = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.68, 0.96), chrome);
      pauldron.position.set(sx, 2.66, 0);
      const trim = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.08, 0.98), crimsonGlow);
      trim.position.set(sx, 2.98, 0);
      this.penthouseSmasherProp.add(pauldron, trim);
    }

    // Shoulder-mounted 6-tube missile pod on left shoulder
    const missilePod = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.48, 0.68), obsidian);
    missilePod.position.set(-1.12, 3.16, -0.08);
    this.penthouseSmasherProp.add(missilePod);
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 3; c++) {
        const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.14, 8), crimsonGlow);
        tip.rotation.x = Math.PI / 2;
        tip.position.set(-1.3 + c * 0.18, 3.07 + r * 0.18, 0.28);
        this.penthouseSmasherProp.add(tip);
      }
    }

    // Cyber-skull head with glowing crimson optics visor
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.3, 0.2, 10), obsidian);
    neck.position.set(0, 2.84, 0.05);
    const skull = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.54, 0.56), chrome);
    skull.position.set(0, 3.12, 0.08);
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.18, 0.44), obsidian);
    jaw.position.set(0, 2.86, 0.16);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.12, 0.14), crimsonGlow);
    visor.position.set(0, 3.15, 0.35);
    this.penthouseSmasherProp.add(neck, skull, jaw, visor);

    // Right arm with multi-barrel rotary autocannon
    const rightArm = new THREE.Group();
    rightArm.position.set(1.18, 2.24, 0.12);
    const upperR = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.96, 0.42), obsidian);
    upperR.position.y = -0.38;
    const gunHousing = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.38, 0.72), obsidian);
    gunHousing.position.set(0, -0.68, 0.42);
    rightArm.add(upperR, gunHousing);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 1.15, 8), chrome);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(Math.cos(a) * 0.1, -0.68 + Math.sin(a) * 0.1, 1.12);
      rightArm.add(barrel);
    }
    const muzzleClamp = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.12, 12), crimsonGlow);
    muzzleClamp.rotation.x = Math.PI / 2;
    muzzleClamp.position.set(0, -0.68, 1.56);
    rightArm.add(muzzleClamp);
    this.penthouseSmasherRightArm = rightArm;
    this.penthouseSmasherProp.add(rightArm);

    // Left arm hydraulic claw
    const leftArm = new THREE.Group();
    leftArm.position.set(-1.18, 2.24, 0.12);
    const upperL = new THREE.Mesh(new THREE.BoxGeometry(0.44, 1.06, 0.44), obsidian);
    upperL.position.y = -0.44;
    const clawBase = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.24, 0.44), chrome);
    clawBase.position.set(0, -1.04, 0.12);
    leftArm.add(upperL, clawBase);
    this.penthouseSmasherLeftArm = leftArm;
    this.penthouseSmasherProp.add(leftArm);

    // Menacing crimson rim glow
    const smasherRim = new THREE.PointLight(0xff003c, 12, 14, 1.5);
    smasherRim.position.set(0, 2.6, 0.9);
    this.penthouseSmasherProp.add(smasherRim);
  }

  private buildPenthouse(): void {
    const y = INSTANCE_Y.PENTHOUSE;

    const marbleFloorMat = new THREE.MeshStandardMaterial({
      map: this.textures.getFloorTile('#fcee0a', 7, 12),
      roughness: 0.18,
      metalness: 0.62,
    });
    const wallMat = new THREE.MeshStandardMaterial({
      map: this.textures.getWallPanel('#fcee0a', 4, 2),
      roughness: 0.32,
      metalness: 0.52,
    });
    const darkMarbleMat = new THREE.MeshStandardMaterial({
      color: 0x181318,
      roughness: 0.22,
      metalness: 0.68,
    });
    const darkGoldMat = new THREE.MeshStandardMaterial({
      color: 0x2c2114,
      roughness: 0.3,
      metalness: 0.78,
    });
    const closetWoodMat = new THREE.MeshStandardMaterial({
      color: 0x22160f,
      roughness: 0.48,
      metalness: 0.35,
    });
    const slatMat = new THREE.MeshStandardMaterial({
      color: 0x1a120d,
      roughness: 0.42,
      metalness: 0.5,
    });

    // Main suite + escape corridor polished marble floor & dark coffered ceiling
    const floor = new THREE.Mesh(new THREE.BoxGeometry(26, 0.4, 56), marbleFloorMat);
    floor.position.set(0, y - 0.2, -10);
    this.penthouseGroup.add(floor);

    const ceil = new THREE.Mesh(
      new THREE.BoxGeometry(26, 0.4, 56),
      new THREE.MeshStandardMaterial({ color: 0x0f0e16, roughness: 0.75, metalness: 0.35 }),
    );
    ceil.position.set(0, y + 6.4, -10);
    this.penthouseGroup.add(ceil);

    const addW = (id: string, cx: number, cz: number, sx: number, sz: number, mat = wallMat) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, 6.4, sz), mat);
      m.position.set(cx, y + 3.2, cz);
      this.penthouseGroup.add(m);
      this.physics.addBox(id, cx, y + 3.2, cz, sx, 6.4, sz);
    };

    // Perimeter walls (East side of suite Z: -1..17 has panoramic glass window bay!)
    addW('ph_left', -12.6, -10, 0.8, 56);
    addW('ph_right_corridor', 12.6, -19.5, 0.8, 37);
    // Invisible glass collider along East panoramic suite window (Z: -1..17.6)
    this.physics.addBox('ph_right_window_col', 12.4, y + 3.2, 8.3, 0.6, 6.4, 18.8);
    addW('ph_back', 0, 17.6, 26, 0.8);
    addW('ph_front_l', -7.5, -36, 10, 0.8);
    addW('ph_front_r', 7.5, -36, 10, 0.8);
    addW('ph_front_top', 0, -36, 5.2, 0.8); // header above elevator entry

    // Divider wall between Rodion's suite (Z: 0..17) and Escape Corridor (Z: -36..0)
    addW('ph_div_l', -7.5, -1.5, 10, 0.8);
    addW('ph_div_r', 7.5, -1.5, 10, 0.8);
    const divHeader = new THREE.Mesh(new THREE.BoxGeometry(5.2, 2.2, 0.8), darkMarbleMat);
    divHeader.position.set(0, y + 5.3, -1.5);
    this.penthouseGroup.add(divHeader);
    this.addNeonStrip(this.penthouseGroup, 0, y + 4.18, -1.1, 5.1, 0.08, 0.08, 0xfcee0a, 1.55);

    // --- PANORAMIC FLOOR-TO-CEILING NIGHT SKYLINE WINDOWS (EAST SUITE WALL) ---
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x0e1d36,
      metalness: 0.9,
      roughness: 0.08,
      transparent: true,
      opacity: 0.24,
    });
    const eastGlass = new THREE.Mesh(new THREE.PlaneGeometry(18.2, 5.8), glassMat);
    eastGlass.position.set(12.2, y + 3.1, 8.2);
    eastGlass.rotation.y = -Math.PI / 2;
    this.penthouseGroup.add(eastGlass);

    // Sleek dark-gold window mullions & sill
    this.addNeonStrip(this.penthouseGroup, 12.15, y + 0.16, 8.2, 0.18, 0.12, 18.2, 0xfcee0a, 1.2);
    this.addNeonStrip(this.penthouseGroup, 12.15, y + 6.08, 8.2, 0.18, 0.12, 18.2, 0xfcee0a, 1.2);
    for (const mz of [0.2, 4.2, 8.2, 12.2, 16.2]) {
      const mullion = new THREE.Mesh(new THREE.BoxGeometry(0.24, 6.2, 0.22), darkGoldMat);
      mullion.position.set(12.2, y + 3.1, mz);
      this.penthouseGroup.add(mullion);
    }

    // Glowing Cyber-Almaty mountain & skyscraper night skyline outside the 92nd-floor window!
    const skylineTex = this.textures.getAlmatyMountainSkyline();
    const skylineBackdrop = new THREE.Mesh(
      new THREE.PlaneGeometry(78, 34),
      new THREE.MeshStandardMaterial({
        map: skylineTex,
        emissiveMap: skylineTex,
        emissive: new THREE.Color(0xffffff),
        emissiveIntensity: 0.95,
        roughness: 0.9,
      }),
    );
    skylineBackdrop.position.set(42, y + 4.5, 8.2);
    skylineBackdrop.rotation.y = -Math.PI / 2;
    this.penthouseGroup.add(skylineBackdrop);

    // Distant lit cyberpunk skyscraper silhouettes outside window
    const facadeCyan = this.textures.getBuildingFacade('#00f0ff', '#090e1c', 2, 4);
    const facadeCrimson = this.textures.getBuildingFacade('#ff003c', '#120918', 2, 4);
    const facadeGold = this.textures.getBuildingFacade('#fcee0a', '#100d18', 2, 4);
    const towerSpecs: Array<[number, number, number, number, THREE.CanvasTexture]> = [
      [25, -4, 6, 32, facadeCyan],
      [29, 6, 7.5, 42, facadeCrimson],
      [24, 15, 5.5, 28, facadeGold],
      [34, 23, 8, 38, facadeCyan],
      [33, -12, 7, 36, facadeCrimson],
    ];
    for (const [tx, tz, tw, th, tex] of towerSpecs) {
      const bldg = new THREE.Mesh(
        new THREE.BoxGeometry(tw, th, tw),
        new THREE.MeshStandardMaterial({
          map: tex,
          emissiveMap: tex,
          emissive: new THREE.Color(0xddeeff),
          emissiveIntensity: 0.72,
          roughness: 0.5,
        }),
      );
      bldg.position.set(tx, y - 6 + th * 0.25, tz);
      this.penthouseGroup.add(bldg);
    }

    // Flying night-city AVs gliding past the 92nd-floor panoramic glass (like Bolt 1!)
    for (let i = 0; i < 4; i++) {
      const av = new THREE.Group();
      const hull = new THREE.Mesh(
        new THREE.BoxGeometry(1.1, 0.5, 2.8),
        new THREE.MeshStandardMaterial({ color: 0x161b2a, metalness: 0.7, roughness: 0.3 }),
      );
      const thrusters = new THREE.Mesh(
        new THREE.BoxGeometry(0.9, 0.16, 0.24),
        new THREE.MeshBasicMaterial({ color: i % 2 === 0 ? 0x00f0ff : 0xff003c }),
      );
      thrusters.position.z = 1.45;
      av.add(hull, thrusters);
      const dir = i % 2 === 0 ? 1 : -1;
      av.position.set(17 + i * 2.4, y + 1.2 + i * 1.4, -12 + i * 9);
      if (dir < 0) av.rotation.y = Math.PI;
      this.penthouseGroup.add(av);
      this.penthouseAvs.push({
        mesh: av,
        speed: (7.5 + i * 2.1) * dir,
        minZ: -26,
        maxZ: 34,
      });
    }

    // --- GOLDEN ARCHITECTURAL NEON TRIMS & LUXURY SUITE DETAILS ---
    // Ceiling golden coves in Rodion's suite
    for (const cz of [2, 8, 14]) {
      this.addNeonStrip(this.penthouseGroup, 0, y + 6.12, cz, 20, 0.12, 0.22, 0xfcee0a, 1.45);
    }
    // Marble architectural pilasters along West suite wall
    for (const pz of [2, 12.5]) {
      const pil = new THREE.Mesh(new THREE.BoxGeometry(0.9, 6.2, 1.2), darkMarbleMat);
      pil.position.set(-11.8, y + 3.1, pz);
      this.penthouseGroup.add(pil);
      this.addNeonStrip(this.penthouseGroup, -11.32, y + 3.1, pz, 0.08, 5.8, 0.14, 0xfcee0a, 1.5);
    }

    // Luxury marble lounge table & crimson velvet cyber-sofa near East window
    const sofaBase = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 0.65, 4.8),
      new THREE.MeshStandardMaterial({ color: 0x3b0b18, roughness: 0.65, metalness: 0.18 }),
    );
    sofaBase.position.set(8.6, y + 0.34, 10.5);
    const sofaBack = new THREE.Mesh(
      new THREE.BoxGeometry(0.35, 0.9, 4.8),
      new THREE.MeshStandardMaterial({ color: 0x4c0e20, roughness: 0.6, metalness: 0.2 }),
    );
    sofaBack.position.set(9.25, y + 0.78, 10.5);
    this.penthouseGroup.add(sofaBase, sofaBack);
    this.physics.addBox('ph_sofa', 8.7, y + 0.55, 10.5, 1.8, 1.1, 4.8, { blocksSight: false });

    const coffeeTable = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.44, 3.2), darkMarbleMat);
    coffeeTable.position.set(6.2, y + 0.22, 10.5);
    this.penthouseGroup.add(coffeeTable);
    this.addNeonStrip(this.penthouseGroup, 6.2, y + 0.45, 10.5, 1.44, 0.04, 3.24, 0xfcee0a, 1.25);

    // --- REALISTIC 3D SLATTED CLOSET HIDEOUT AROUND (-10.2, y, 7) ---
    // Camera in CLOSET mode sits at (-9.8, y + 1.68, 7.0) looking East-Northeast toward (0, y+1.4, 4.2).
    // Hollow interior enclosed by dark wood/metal walls + angled horizontal louver slats on East face!
    const closetGroup = new THREE.Group();
    closetGroup.position.set(-10.2, y, 7);

    // Back wall (West), Side walls (North/South), Ceiling cap
    const clBack = new THREE.Mesh(new THREE.BoxGeometry(0.18, 3.3, 3.5), closetWoodMat);
    clBack.position.set(-1.35, 1.65, 0);
    const clNorth = new THREE.Mesh(new THREE.BoxGeometry(2.75, 3.3, 0.18), closetWoodMat);
    clNorth.position.set(0, 1.65, -1.68);
    const clSouth = new THREE.Mesh(new THREE.BoxGeometry(2.75, 3.3, 0.18), closetWoodMat);
    clSouth.position.set(0, 1.65, 1.68);
    const clTop = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.2, 3.55), closetWoodMat);
    clTop.position.set(0, 3.25, 0);
    closetGroup.add(clBack, clNorth, clSouth, clTop);

    // Outer door frame stiles & golden trim on East face (local X = +1.34 -> world X = -8.86)
    const stileN = new THREE.Mesh(new THREE.BoxGeometry(0.16, 3.25, 0.2), darkGoldMat);
    stileN.position.set(1.34, 1.62, -1.56);
    const stileS = new THREE.Mesh(new THREE.BoxGeometry(0.16, 3.25, 0.2), darkGoldMat);
    stileS.position.set(1.34, 1.62, 1.56);
    // Offset vertical door mullion (shifted South to local z = +0.62 so it doesn't obstruct center sightline!)
    const stileMid = new THREE.Mesh(new THREE.BoxGeometry(0.12, 3.15, 0.1), darkGoldMat);
    stileMid.position.set(1.34, 1.6, 0.62);
    const doorTopBar = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.22, 3.3), darkGoldMat);
    doorTopBar.position.set(1.34, 3.12, 0);
    const doorBotBar = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.24, 3.3), darkGoldMat);
    doorBotBar.position.set(1.34, 0.12, 0);
    closetGroup.add(stileN, stileS, stileMid, doorTopBar, doorBotBar);

    // Horizontal dark wood/metal louver slats along East face (eye-level is local Y = 1.68)
    // Carefully spaced so slats dramatically frame upper & lower vision while leaving a clean slit at 1.52..1.84!
    const slatHeights: number[] = [];
    for (let sy = 0.28; sy <= 1.48; sy += 0.13) slatHeights.push(sy);
    for (let sy = 1.84; sy <= 2.98; sy += 0.13) slatHeights.push(sy);
    const slatGeo = new THREE.BoxGeometry(0.1, 0.028, 3.0);
    for (const sy of slatHeights) {
      const slat = new THREE.Mesh(slatGeo, slatMat);
      slat.position.set(1.34, sy, 0);
      slat.rotation.z = 0.34;
      closetGroup.add(slat);
    }

    // Subtle vertical gold trim strips framing the closet exterior
    this.addNeonStrip(closetGroup, 1.42, 1.62, -1.58, 0.04, 3.0, 0.04, 0xfcee0a, 1.15);
    this.addNeonStrip(closetGroup, 1.42, 1.62, 1.58, 0.04, 3.0, 0.04, 0xfcee0a, 1.15);
    this.penthouseGroup.add(closetGroup);

    // Thin outer side colliders only (interior stays 100% open for CLOSET camera & exit!)
    this.physics.addBox('ph_closet_n', -10.2, y + 1.65, 5.32, 2.7, 3.3, 0.22);
    this.physics.addBox('ph_closet_s', -10.2, y + 1.65, 8.68, 2.7, 3.3, 0.22);

    // --- BIOCHIP RELIC PEDESTAL & GLOWING CASE ---
    const pedestal = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.1, 1.7), darkMarbleMat);
    pedestal.position.set(0, y + 0.55, 6);
    this.penthouseGroup.add(pedestal);
    this.addNeonStrip(this.penthouseGroup, 0, y + 1.11, 6, 1.76, 0.05, 1.76, 0xfcee0a, 1.55);
    this.physics.addBox('ph_pedestal', 0, y + 0.55, 6, 1.7, 1.1, 1.7, { blocksSight: false });

    const caseShell = new THREE.Mesh(
      new THREE.BoxGeometry(0.72, 0.24, 0.5),
      new THREE.MeshStandardMaterial({ color: 0x101828, metalness: 0.85, roughness: 0.2 }),
    );
    caseShell.position.set(0, y + 1.24, 6);
    const caseCore = new THREE.Mesh(
      new THREE.BoxGeometry(0.56, 0.12, 0.34),
      new THREE.MeshStandardMaterial({
        color: 0x00f0ff,
        emissive: 0x00f0ff,
        emissiveIntensity: 1.9,
      }),
    );
    caseCore.position.set(0, y + 1.34, 6);
    this.penthouseHoloRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.54, 0.025, 8, 28),
      new THREE.MeshBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.75 }),
    );
    this.penthouseHoloRing.rotation.x = Math.PI / 2;
    this.penthouseHoloRing.position.set(0, y + 1.48, 6);
    const caseGlow = new THREE.PointLight(0x00f0ff, 8, 8, 1.5);
    caseGlow.position.set(0, y + 1.85, 6);
    this.biochipCase.add(caseShell, caseCore, this.penthouseHoloRing, caseGlow);
    this.penthouseGroup.add(this.biochipCase);

    // --- ESCAPE CORRIDOR COVER BLOCKS & NEON TRUSSES (Z: -36 .. -1.5) ---
    for (const [cx, cz, idx] of [
      [-4.4, -9.5, 1],
      [4.4, -15.5, 2],
      [-3.8, -23.5, 3],
      [3.8, -29.0, 4],
    ]) {
      const cov = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.35, 1.2), darkMarbleMat);
      cov.position.set(cx, y + 0.68, cz);
      this.penthouseGroup.add(cov);
      this.addNeonStrip(this.penthouseGroup, cx, y + 1.38, cz, 3.44, 0.06, 1.24, idx % 2 === 0 ? 0xff003c : 0xfcee0a, 1.4);
      this.physics.addBox(`ph_cov_${idx}`, cx, y + 0.68, cz, 3.4, 1.35, 1.2, { blocksSight: false });
    }

    // Escape corridor ceiling neon trusses & floor guide rails
    this.addNeonStrip(this.penthouseGroup, -2.4, y + 0.03, -19, 0.12, 0.04, 33, 0xff003c, 1.45);
    this.addNeonStrip(this.penthouseGroup, 2.4, y + 0.03, -19, 0.12, 0.04, 33, 0xff003c, 1.45);
    for (const cz of [-8, -18, -28]) {
      const isCrimson = cz !== -18;
      this.addNeonStrip(this.penthouseGroup, 0, y + 6.12, cz, 19, 0.14, 0.26, isCrimson ? 0xff003c : 0xfcee0a, 1.5);
    }

    // --- CHARACTERS FOR HEIST CUTSCENE ---
    this.penthouseSanzhar.group.position.set(3.2, y, 10);
    this.penthouseSanzhar.group.rotation.y = Math.PI;
    this.penthouseGroup.add(this.penthouseSanzhar.group);

    this.penthouseRodion.group.position.set(0.8, y, 4.2);
    this.penthouseRodion.group.rotation.y = -Math.PI * 0.5;
    this.penthouseRodion.group.visible = false;
    this.penthouseGroup.add(this.penthouseRodion.group);

    this.penthouseLev.group.position.set(-0.6, y, 4.2);
    this.penthouseLev.group.rotation.y = Math.PI * 0.5;
    this.penthouseLev.group.visible = false;
    this.penthouseGroup.add(this.penthouseLev.group);

    // Upgraded detailed 3-meter Rikhard Smasher armored cyborg prop
    this.buildDetailedSmasherProp();
    this.penthouseSmasherProp.position.set(2.5, y, 2.1);
    this.penthouseSmasherProp.rotation.y = -Math.PI * 0.22;
    this.penthouseSmasherProp.visible = false;
    this.penthouseGroup.add(this.penthouseSmasherProp);

    // Emissive penthouse signs
    this.addEmissiveBanner(
      this.penthouseGroup,
      this.textures.getNeonSign('ПЕНТХАУС РОДИОНА', 'МАРАКУЛИН ТАУЭР // 92 ЭТАЖ', '#fcee0a', '#ff003c'),
      0,
      y + 4.6,
      17.1,
      10.5,
      2.6,
      Math.PI,
      0.85,
    );
    this.addEmissiveBanner(
      this.penthouseGroup,
      this.textures.getNeonSign('ЭВАКУАЦИОННЫЙ ЛИФТ', 'ЭТАЖ 92 → ПОДЗЕМНЫЙ ГАРАЖ', '#ff003c', '#fcee0a'),
      0,
      y + 4.7,
      -35.4,
      9.2,
      2.2,
      0,
      0.85,
    );

    // --- BALANCED WARM-GOLD + CRIMSON RIM LIGHTING (BOLT 1 CALIBRATED) ---
    this.penthouseGroup.add(new THREE.HemisphereLight(0x7c8eb8, 0x2b1b14, 0.58));
    this.penthouseGroup.add(new THREE.AmbientLight(0x2a2232, 0.28));

    const suiteGoldKey = new THREE.PointLight(0xffcc6e, 25, 34, 1.5);
    suiteGoldKey.position.set(0.5, y + 5.4, 8.5);
    this.penthouseGroup.add(suiteGoldKey);

    const murderRimCrimson = new THREE.PointLight(0xff284e, 22, 30, 1.5);
    murderRimCrimson.position.set(-2.5, y + 4.8, 3.0);
    this.penthouseGroup.add(murderRimCrimson);

    const windowGoldFill = new THREE.PointLight(0xffb85c, 20, 28, 1.5);
    windowGoldFill.position.set(8.5, y + 4.8, 7.5);
    this.penthouseGroup.add(windowGoldFill);

    const corrRed1 = new THREE.PointLight(0xff2244, 24, 34, 1.5);
    corrRed1.position.set(0, y + 5.2, -10);
    this.penthouseGroup.add(corrRed1);

    const corrGold = new THREE.PointLight(0xf5be6b, 22, 34, 1.5);
    corrGold.position.set(0, y + 5.2, -21);
    this.penthouseGroup.add(corrGold);

    const corrRed2 = new THREE.PointLight(0xff2244, 24, 32, 1.5);
    corrRed2.position.set(0, y + 5.2, -31);
    this.penthouseGroup.add(corrRed2);

    this.interactables.push(
      {
        id: 'heist_steal_biochip',
        label: '[E] УКРАСТЬ БИОЧИП ИЗ КЕЙСА РОДИОНА',
        x: 0,
        y: y + 1.2,
        z: 6,
        radius: 3.4,
        enabled: false,
        category: 'story',
      },
      {
        id: 'heist_hide_closet',
        label: '[E] СПРЯТАТЬСЯ В ШКАФ С САНЖАРОМ',
        x: -9.5,
        y: y + 1.2,
        z: 7,
        radius: 3.6,
        enabled: false,
        category: 'story',
      },
      {
        id: 'heist_elevator_btn',
        label: '[E] ВЫЗВАТЬ ЛИФТ В ГАРАЖ КИБЕР-АХМЕДА',
        x: 0,
        y: y + 1.2,
        z: -37.5,
        radius: 3.5,
        enabled: false,
        category: 'elevator',
      },
    );
  }

  /**
   * Smoothly choreographs the 92nd-floor Penthouse patricide cutscene viewed through the slatted closet:
   *  - 0.0 .. 1.8s: Lev & Rodion confront each other while Rikhard Smasher looms behind
   *  - 1.8 .. 3.0s: Rodion strides up to Lev and lunges forward to grab his throat
   *  - 3.0 .. 4.4s: Rodion chokes Lev while Lev struggles and tilts back
   *  - 4.4 .. 5.6s: Lev collapses onto the polished marble floor; Rodion steps back
   *  - 5.6 .. 8.2s: Rodion and Rikhard Smasher march coldly out toward the escape corridor
   */
  animatePenthouseMurder(phaseTime: number): void {
    const y = INSTANCE_Y.PENTHOUSE;
    const t = Math.max(0, phaseTime);
    const rodion = this.penthouseRodion;
    const lev = this.penthouseLev;
    const smasher = this.penthouseSmasherProp;

    rodion.group.visible = true;
    lev.group.visible = true;
    smasher.visible = true;

    // Reset base transforms before applying phase pose
    lev.group.rotation.set(0, Math.PI * 0.48, 0);
    lev.head.rotation.set(0, 0, 0);
    lev.leftArm.rotation.set(0, 0, 0);
    lev.rightArm.rotation.set(0, 0, 0);

    rodion.group.rotation.set(0, -Math.PI * 0.5, 0);
    rodion.head.rotation.set(0, 0, 0);
    rodion.leftArm.rotation.set(0, 0, 0);
    rodion.rightArm.rotation.set(0, 0, 0);

    smasher.rotation.set(0, -Math.PI * 0.22, 0);

    if (t < 1.8) {
      // Phase 0: Heated argument
      const p = smoothstep(t / 1.8);
      rodion.group.position.set(THREE.MathUtils.lerp(1.4, 1.05, p), y, 4.2);
      rodion.rightArm.rotation.x = -0.35 - Math.sin(t * 5) * 0.14;
      lev.group.position.set(-0.6, y, 4.2);
      lev.rightArm.rotation.x = -0.85 + Math.sin(t * 7.5) * 0.2;
      lev.head.rotation.y = Math.sin(t * 4) * 0.08;
      smasher.position.set(2.5, y, 2.1);
      return;
    }

    if (t < 3.0) {
      // Phase 1: Rodion strides rapidly up to Lev and grabs his throat
      const p = smoothstep((t - 1.8) / 1.2);
      rodion.group.position.set(THREE.MathUtils.lerp(1.05, 0.04, p), y + Math.abs(Math.sin(p * Math.PI * 2)) * 0.05, 4.2);
      rodion.leftArm.rotation.x = THREE.MathUtils.lerp(-0.2, -1.48, p);
      rodion.rightArm.rotation.x = THREE.MathUtils.lerp(-0.35, -1.48, p);
      rodion.leftArm.rotation.z = THREE.MathUtils.lerp(0, 0.18, p);
      rodion.rightArm.rotation.z = THREE.MathUtils.lerp(0, -0.18, p);

      lev.group.position.set(THREE.MathUtils.lerp(-0.6, -0.78, p), y, 4.2);
      lev.leftArm.rotation.x = THREE.MathUtils.lerp(0, -1.15, p);
      lev.rightArm.rotation.x = THREE.MathUtils.lerp(-0.6, -1.15, p);
      lev.head.rotation.x = THREE.MathUtils.lerp(0, -0.25, p);

      smasher.position.set(2.5, y, 2.1);
      smasher.rotation.y = THREE.MathUtils.lerp(-Math.PI * 0.22, -Math.PI * 0.34, p);
      return;
    }

    if (t < 4.4) {
      // Phase 2: Choking struggle
      const p = clamp01((t - 3.0) / 1.4);
      const shake = Math.sin(t * 26) * 0.035;
      rodion.group.position.set(0.04 + shake, y, 4.2);
      rodion.leftArm.rotation.set(-1.5, 0, 0.2);
      rodion.rightArm.rotation.set(-1.5, 0, -0.2);

      lev.group.position.set(-0.78 - shake * 1.2, y - p * 0.08, 4.2);
      lev.head.rotation.x = -0.34 - Math.sin(t * 16) * 0.08;
      lev.leftArm.rotation.x = -1.05 + Math.sin(t * 15) * 0.28 * (1 - p * 0.6);
      lev.rightArm.rotation.x = -1.05 - Math.sin(t * 15) * 0.28 * (1 - p * 0.6);

      smasher.position.set(2.5, y, 2.1);
      smasher.rotation.y = -Math.PI * 0.34;
      return;
    }

    if (t < 5.6) {
      // Phase 3: Lev collapses onto the marble floor; Rodion releases & turns to Smasher
      const p = smoothstep((t - 4.4) / 1.0);
      lev.group.position.set(THREE.MathUtils.lerp(-0.78, -1.08, p), THREE.MathUtils.lerp(y - 0.08, y + 0.22, p), 4.2);
      lev.group.rotation.set(THREE.MathUtils.lerp(0, -Math.PI / 2, p), Math.PI * 0.48, THREE.MathUtils.lerp(0, 0.14, p));
      lev.leftArm.rotation.x = THREE.MathUtils.lerp(-0.9, -0.2, p);
      lev.rightArm.rotation.x = THREE.MathUtils.lerp(-0.9, 0.15, p);

      rodion.group.position.set(THREE.MathUtils.lerp(0.04, 0.3, p), y, 4.2);
      rodion.group.rotation.y = THREE.MathUtils.lerp(-Math.PI * 0.5, Math.PI * 0.92, p);
      rodion.leftArm.rotation.x = THREE.MathUtils.lerp(-1.5, 0, p);
      rodion.rightArm.rotation.x = THREE.MathUtils.lerp(-1.5, 0, p);

      smasher.position.set(2.5, y, 2.1);
      smasher.rotation.y = THREE.MathUtils.lerp(-Math.PI * 0.34, Math.PI, p);
      return;
    }

    // Phase 4 (t >= 5.6): Rodion & Smasher march coldly out toward the escape corridor
    const walkP = clamp01((t - 5.6) / 2.6);
    const stride = Math.sin((t - 5.6) * 8.5);
    lev.group.position.set(-1.08, y + 0.22, 4.2);
    lev.group.rotation.set(-Math.PI / 2, Math.PI * 0.48, 0.14);

    rodion.group.position.set(
      THREE.MathUtils.lerp(0.3, -0.25, walkP),
      y + Math.abs(stride) * 0.04,
      THREE.MathUtils.lerp(4.2, -5.2, walkP),
    );
    rodion.group.rotation.y = Math.PI;
    rodion.leftArm.rotation.x = stride * 0.45;
    rodion.rightArm.rotation.x = -stride * 0.45;

    const stomp = Math.sin((t - 5.6) * 5.2);
    smasher.position.set(
      THREE.MathUtils.lerp(2.5, 0.65, walkP),
      y + Math.abs(stomp) * 0.06,
      THREE.MathUtils.lerp(2.1, -6.2, walkP),
    );
    smasher.rotation.y = Math.PI;
    if (this.penthouseSmasherLeftArm && this.penthouseSmasherRightArm) {
      this.penthouseSmasherLeftArm.rotation.x = stomp * 0.22;
      this.penthouseSmasherRightArm.rotation.x = -stomp * 0.15;
    }
  }

  // =========================================================================
  // 2. CYBER-AKHMED CHASE INTERIOR & HIGHWAY (Y = 220)
  // =========================================================================

  private buildChaseTrack(): void {
    const y = INSTANCE_Y.CHASE;

    // Wet neon highway road surface
    const roadMat = new THREE.MeshStandardMaterial({
      map: this.textures.getRoadSurface(1, 34),
      roughness: 0.32,
      metalness: 0.45,
    });
    const road = new THREE.Mesh(new THREE.PlaneGeometry(34, 420), roadMat);
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, y, -140);
    this.chaseGroup.add(road);

    // Highway concrete guardrails with glowing cyan & crimson neon runner strips
    const barrierMat = new THREE.MeshStandardMaterial({ color: 0x161b2a, roughness: 0.55, metalness: 0.5 });
    for (const sx of [-16.5, 16.5]) {
      const barrier = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.5, 420), barrierMat);
      barrier.position.set(sx, y + 0.75, -140);
      this.chaseGroup.add(barrier);
      this.addNeonStrip(this.chaseGroup, sx > 0 ? sx - 0.5 : sx + 0.5, y + 1.15, -140, 0.12, 0.14, 420, 0x00f0ff, 1.5);
    }

    // Neon overhead highway arches rushing past
    const archColors = [0x00f0ff, 0xff2a6d, 0xfcee0a];
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0x121826, metalness: 0.6, roughness: 0.4 });
    for (let i = 0; i < 16; i++) {
      const archGroup = new THREE.Group();
      const col = archColors[i % archColors.length];
      const arch = new THREE.Mesh(
        new THREE.TorusGeometry(16.2, 0.36, 8, 22, Math.PI),
        new THREE.MeshBasicMaterial({ color: col }),
      );
      archGroup.add(arch);
      for (const sx of [-16.2, 16.2]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.85, 5.5, 0.85), pillarMat);
        leg.position.set(sx, 2.75, 0);
        archGroup.add(leg);
      }
      archGroup.position.set(0, y, 42 - i * 24);
      this.chaseGroup.add(archGroup);
      this.chaseArches.push(archGroup);
    }

    // Speeding cyber-city skyscrapers flanking both sides of the highway
    const facadePool = [
      this.textures.getBuildingFacade('#00f0ff', '#0c1222', 2, 5),
      this.textures.getBuildingFacade('#ff2a6d', '#150c1e', 2, 5),
      this.textures.getBuildingFacade('#fcee0a', '#10121e', 2, 5),
    ];
    for (let i = 0; i < 20; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const bGroup = new THREE.Group();
      const bw = 10 + (i % 3) * 4;
      const bh = 32 + (i % 5) * 11;
      const tex = facadePool[i % facadePool.length];
      const mat = new THREE.MeshStandardMaterial({
        map: tex,
        emissiveMap: tex,
        emissive: new THREE.Color(0xcceeff),
        emissiveIntensity: 0.72,
        roughness: 0.45,
      });
      const tower = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bw), mat);
      tower.position.y = bh * 0.5 - 4;
      bGroup.add(tower);

      // Rooftop neon crown
      const crownColor = archColors[i % archColors.length];
      const crown = new THREE.Mesh(
        new THREE.BoxGeometry(bw + 0.3, 0.45, bw + 0.3),
        new THREE.MeshBasicMaterial({ color: crownColor }),
      );
      crown.position.y = bh - 4;
      bGroup.add(crown);

      bGroup.position.set(side * (25 + (i % 3) * 6.5), y, 36 - i * 17);
      this.chaseGroup.add(bGroup);
      this.chaseSkyscrapers.push(bGroup);
    }

    // Glowing traffic streaks zooming past along outer lanes
    for (let i = 0; i < 14; i++) {
      const oncoming = i % 2 === 0;
      const laneX = oncoming ? -11.5 - (i % 3) * 1.4 : 11.5 + (i % 3) * 1.4;
      const streak = new THREE.Mesh(
        new THREE.BoxGeometry(0.32, 0.16, 6.5 + (i % 3) * 2.5),
        new THREE.MeshBasicMaterial({ color: oncoming ? 0x00f0ff : 0xff003c }),
      );
      streak.position.set(laneX, y + 0.85, 30 - i * 26);
      this.chaseGroup.add(streak);
      this.chaseTraffic.push({
        mesh: streak,
        speed: oncoming ? 118 + (i % 4) * 12 : 76 + (i % 3) * 10,
        minZ: -320,
        maxZ: 55,
      });
    }

    // --- IMMERSIVE 1ST-PERSON 3D CABIN INTERIOR OF CYBER-АХМЕД ---
    // Camera sits at (0, y + 0.5 + 1.68 = y + 2.18, 4.0) looking along -Z toward drones at Z = -18..-32.
    const cabin = new THREE.Group();
    cabin.position.set(0, y, 4.0);

    const carbonMat = new THREE.MeshStandardMaterial({ color: 0x111520, metalness: 0.65, roughness: 0.38 });
    const leatherMat = new THREE.MeshStandardMaterial({ color: 0x171a26, metalness: 0.25, roughness: 0.7 });
    const chromeMat = new THREE.MeshStandardMaterial({ color: 0x6c7fa3, metalness: 0.88, roughness: 0.2 });

    // Armored nose hood extending forward outside windshield (gives instant speed & car presence!)
    const hood = new THREE.Mesh(new THREE.BoxGeometry(2.55, 0.24, 2.2), carbonMat);
    hood.position.set(0.18, 1.32, -2.3);
    hood.rotation.x = 0.04;
    cabin.add(hood);
    this.addNeonStrip(cabin, -0.72, 1.45, -2.3, 0.06, 0.04, 1.9, 0x00f0ff, 1.7);
    this.addNeonStrip(cabin, 1.08, 1.45, -2.3, 0.06, 0.04, 1.9, 0x00f0ff, 1.7);

    // Sculpted dashboard spanning below eye line (Y = 1.56 vs camera eye Y = 2.18)
    const dashMain = new THREE.Mesh(new THREE.BoxGeometry(2.85, 0.58, 0.82), carbonMat);
    dashMain.position.set(0.18, 1.32, -1.05);
    cabin.add(dashMain);

    const dashLip = new THREE.Mesh(new THREE.BoxGeometry(2.88, 0.08, 0.86), leatherMat);
    dashLip.position.set(0.18, 1.62, -1.05);
    cabin.add(dashLip);

    // Glowing cyan interior trim strip across the dashboard
    this.addNeonStrip(cabin, 0.18, 1.58, -0.62, 2.74, 0.032, 0.04, 0x00f0ff, 1.85);

    // Center console divider between Ai (left) and Sanzhar (right)
    const centerConsole = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.52, 1.45), carbonMat);
    centerConsole.position.set(0.45, 1.15, -0.25);
    cabin.add(centerConsole);
    this.addNeonStrip(cabin, 0.45, 1.42, -0.25, 0.04, 0.02, 1.35, 0x00f0ff, 1.45);

    // Glowing "КИБЕР-АХМЕД AI" holographic screen angled toward the player
    const akhmedTex = this.createAkhmedHudTexture();
    const screenFrame = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.36, 0.05), chromeMat);
    screenFrame.position.set(0.32, 1.72, -1.02);
    screenFrame.rotation.set(-0.22, -0.28, 0);
    const screenFace = new THREE.Mesh(
      new THREE.PlaneGeometry(0.62, 0.31),
      new THREE.MeshStandardMaterial({
        map: akhmedTex,
        emissiveMap: akhmedTex,
        emissive: new THREE.Color(0xffffff),
        emissiveIntensity: 1.15,
        roughness: 0.2,
      }),
    );
    screenFace.position.set(0, 0, 0.028);
    screenFrame.add(screenFace);
    cabin.add(screenFrame);

    // Steering wheel on the left turning gently during autonomous chase!
    const wheelGroup = new THREE.Group();
    wheelGroup.position.set(-0.42, 1.68, -0.68);
    wheelGroup.rotation.x = -0.32;
    const wheelRim = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.024, 8, 22), leatherMat);
    const wheelHub = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.05, 12), chromeMat);
    wheelHub.rotation.x = Math.PI / 2;
    const wheelSpokeH = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.03, 0.025), chromeMat);
    const wheelSpokeV = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.19, 0.025), chromeMat);
    wheelSpokeV.position.y = -0.1;
    const wheelLed = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.018, 0.032),
      new THREE.MeshBasicMaterial({ color: 0x00f0ff }),
    );
    wheelLed.position.y = 0.19;
    wheelGroup.add(wheelRim, wheelHub, wheelSpokeH, wheelSpokeV, wheelLed);
    this.chaseSteeringWheel = wheelGroup;
    cabin.add(wheelGroup);

    // Slanted A-pillars & panoramic windshield frame (wide clear view for shooting drones!)
    for (const [px, sideSign] of [
      [-1.24, -1],
      [1.6, 1],
    ]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.11, 1.48, 0.12), carbonMat);
      pillar.position.set(px, 2.22, -0.92);
      pillar.rotation.x = 0.56;
      cabin.add(pillar);

      const pillarNeon = new THREE.Mesh(
        new THREE.BoxGeometry(0.022, 1.32, 0.022),
        new THREE.MeshBasicMaterial({ color: 0x00f0ff }),
      );
      pillarNeon.position.set(px - sideSign * 0.058, 2.22, -0.9);
      pillarNeon.rotation.x = 0.56;
      cabin.add(pillarNeon);

      // Door sill & side trim
      const doorSill = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.55, 1.85), carbonMat);
      doorSill.position.set(px, 1.35, -0.05);
      cabin.add(doorSill);
      this.addNeonStrip(cabin, px - sideSign * 0.06, 1.62, -0.05, 0.025, 0.025, 1.65, 0x00f0ff, 1.4);
    }

    // Windshield top roof header + rearview mirror silhouette
    const roofHeader = new THREE.Mesh(new THREE.BoxGeometry(2.96, 0.14, 0.45), carbonMat);
    roofHeader.position.set(0.18, 2.86, -0.45);
    cabin.add(roofHeader);
    this.addNeonStrip(cabin, 0.18, 2.78, -0.45, 2.5, 0.025, 0.03, 0xff2a6d, 1.35);

    const roofBack = new THREE.Mesh(new THREE.BoxGeometry(2.96, 0.1, 1.4), carbonMat);
    roofBack.position.set(0.18, 2.88, 0.35);
    cabin.add(roofBack);

    const mirrorStem = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.14, 0.04), chromeMat);
    mirrorStem.position.set(0.18, 2.72, -0.72);
    const mirrorBody = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.09, 0.05), carbonMat);
    mirrorBody.position.set(0.18, 2.64, -0.72);
    cabin.add(mirrorStem, mirrorBody);

    // Passenger seat backrest behind Sanzhar
    const seatBack = new THREE.Mesh(new THREE.BoxGeometry(0.68, 1.15, 0.16), leatherMat);
    seatBack.position.set(0.92, 1.68, 0.22);
    seatBack.rotation.x = -0.12;
    cabin.add(seatBack);

    // --- SANZHAR SEATED IN THE RIGHT PASSENGER SEAT ---
    this.chaseSanzhar.group.position.set(0.92, 0.56, -0.22);
    this.chaseSanzhar.group.rotation.y = Math.PI * 0.84;
    this.chaseSanzhar.leftArm.rotation.set(-0.55, 0, -0.15);
    this.chaseSanzhar.rightArm.rotation.set(-0.65, 0, 0.15);

    // Subtle crimson wound indicator on Sanzhar's jacket (shown when wounded)
    const woundMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.26, 0.24, 0.06),
      new THREE.MeshStandardMaterial({
        color: 0x990018,
        emissive: 0xff0028,
        emissiveIntensity: 0.9,
        roughness: 0.4,
      }),
    );
    woundMesh.position.set(0.08, 1.12, 0.16);
    woundMesh.visible = false;
    this.chaseSanzharWoundMesh = woundMesh;
    this.chaseSanzhar.group.add(woundMesh);
    cabin.add(this.chaseSanzhar.group);

    // Toggleable glowing blue Relic Biochip prop that animates toward the player's camera when inserted!
    const chipWafer = new THREE.Mesh(
      new THREE.BoxGeometry(0.09, 0.15, 0.025),
      new THREE.MeshStandardMaterial({ color: 0x101c2d, metalness: 0.85, roughness: 0.2 }),
    );
    const chipCore = new THREE.Mesh(
      new THREE.BoxGeometry(0.065, 0.11, 0.032),
      new THREE.MeshStandardMaterial({
        color: 0x00f0ff,
        emissive: 0x00f0ff,
        emissiveIntensity: 2.8,
      }),
    );
    this.chaseBiochipLight = new THREE.PointLight(0x00f0ff, 5, 4, 1.5);
    this.chaseBiochip.add(chipWafer, chipCore, this.chaseBiochipLight);
    this.chaseBiochip.position.set(0.58, 1.85, -0.45);
    this.chaseBiochip.visible = false;
    cabin.add(this.chaseBiochip);

    // Interior cabin cyber-glow + road headlights
    this.chaseCabinLight = new THREE.PointLight(0x38d8ff, 8, 7, 1.5);
    this.chaseCabinLight.position.set(0.25, 2.35, -0.55);
    cabin.add(this.chaseCabinLight);

    const headlights = new THREE.SpotLight(0xd8f4ff, 36, 70, Math.PI / 3.2, 0.45, 1.4);
    headlights.position.set(0.18, 1.25, -3.2);
    headlights.target.position.set(0.18, 0.2, -32);
    cabin.add(headlights, headlights.target);

    this.chaseGroup.add(cabin);

    // Ambient night highway lighting
    this.chaseGroup.add(new THREE.HemisphereLight(0x5588ff, 0x260c24, 1.25));
    this.chaseGroup.add(new THREE.AmbientLight(0x1e2844, 0.35));
  }

  /**
   * Shows/hides the glowing blue Relic biochip in Sanzhar's hand during the Cyber-Akhmed chase.
   * When enabled, smoothly animates the biochip from Sanzhar's hand toward the player's camera/slot!
   */
  setChaseBiochipVisible(visible: boolean): void {
    this.chaseBiochipVisible = visible;
    this.chaseBiochip.visible = visible;
    if (visible) {
      this.chaseBiochipProgress = 0;
      this.chaseBiochip.position.set(0.58, 1.86, -0.42);
    }
  }

  /**
   * Transitions Sanzhar in the Cyber-Akhmed passenger seat into his mortally wounded pose
   * (slumped posture, clutching his side, leaning toward Ai before inserting the Relic).
   */
  setChaseSanzharWounded(wounded: boolean): void {
    this.chaseSanzharWounded = wounded;
    if (this.chaseSanzharWoundMesh) {
      this.chaseSanzharWoundMesh.visible = wounded;
    }
    if (wounded) {
      this.chaseSanzhar.group.position.set(0.9, 0.46, -0.2);
      this.chaseSanzhar.group.rotation.set(0.12, Math.PI * 0.72, 0.16);
      this.chaseSanzhar.head.rotation.set(0.28, 0.34, 0.18);
      this.chaseSanzhar.leftArm.rotation.set(-0.95, 0, -0.45);
      this.chaseSanzhar.rightArm.rotation.set(-1.15, 0.25, 0.25);
    } else {
      this.chaseSanzhar.group.position.set(0.92, 0.56, -0.22);
      this.chaseSanzhar.group.rotation.set(0, Math.PI * 0.84, 0);
      this.chaseSanzhar.head.rotation.set(0, 0, 0);
      this.chaseSanzhar.leftArm.rotation.set(-0.55, 0, -0.15);
      this.chaseSanzhar.rightArm.rotation.set(-0.65, 0, 0.15);
    }
  }

  // =========================================================================
  // 3. MARAKULIN TOWER ASSAULT & UNDERGROUND HUYESHI (Y = -66 / -90)
  // =========================================================================

  private buildMarakulinUnderground(): void {
    const yLobby = INSTANCE_Y.UNDERGROUND + 24; // -66
    const yCore = INSTANCE_Y.UNDERGROUND; // -90

    // Balanced Bolt 1 Marakulin Tower base lighting!
    this.undergroundGroup.add(new THREE.HemisphereLight(0x6e8ec4, 0x261626, 0.7));
    this.undergroundGroup.add(new THREE.AmbientLight(0x2a3650, 0.3));

    const floorMat = new THREE.MeshStandardMaterial({
      map: this.textures.getFloorTile('#ff003c', 8, 12),
      roughness: 0.42,
      metalness: 0.28,
    });
    const wallMat = new THREE.MeshStandardMaterial({
      map: this.textures.getWallPanel('#ff003c', 5, 2),
      roughness: 0.56,
      metalness: 0.32,
    });
    const darkMarbleMat = new THREE.MeshStandardMaterial({
      color: 0x1d2438,
      roughness: 0.42,
      metalness: 0.38,
    });
    const rackTex = this.textures.getServerRack();
    const rackMat = new THREE.MeshStandardMaterial({
      map: rackTex,
      emissiveMap: rackTex,
      emissive: new THREE.Color(0x99ccff),
      emissiveIntensity: 0.65,
      roughness: 0.46,
      metalness: 0.35,
    });
    const trussSteelMat = new THREE.MeshStandardMaterial({
      color: 0x141926,
      metalness: 0.68,
      roughness: 0.4,
    });

    const addBox = (
      id: string,
      cx: number,
      cy: number,
      cz: number,
      sx: number,
      sy: number,
      sz: number,
      mat: THREE.Material = wallMat,
      blocksSight = true,
    ) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
      m.position.set(cx, cy, cz);
      this.undergroundGroup.add(m);
      this.physics.addBox(id, cx, cy, cz, sx, sy, sz, { blocksSight });
    };

    // ---------------------------------------------------------------------
    // UPPER LEVEL: MARAKULIN TOWER MAIN ATRIUM LOBBY (Y = -66)
    // ---------------------------------------------------------------------
    const lobbyH = 9.2;
    const lobbyFloor = new THREE.Mesh(new THREE.BoxGeometry(30, 0.4, 52), floorMat);
    lobbyFloor.position.set(0, yLobby - 0.2, -8);
    this.undergroundGroup.add(lobbyFloor);

    const lobbyCeil = new THREE.Mesh(
      new THREE.BoxGeometry(30, 0.4, 52),
      new THREE.MeshStandardMaterial({ color: 0x101524, roughness: 0.85 }),
    );
    lobbyCeil.position.set(0, yLobby + lobbyH + 0.2, -8);
    this.undergroundGroup.add(lobbyCeil);

    addBox('ug_l_w', -14.6, yLobby + lobbyH * 0.5, -8, 0.8, lobbyH, 52);
    addBox('ug_l_e', 14.6, yLobby + lobbyH * 0.5, -8, 0.8, lobbyH, 52);
    addBox('ug_l_s', 0, yLobby + lobbyH * 0.5, 17.6, 30, lobbyH, 0.8);
    addBox('ug_l_nl', -8.8, yLobby + lobbyH * 0.5, -28.2, 12, lobbyH, 0.8);
    addBox('ug_l_nr', 8.8, yLobby + lobbyH * 0.5, -28.2, 12, lobbyH, 0.8);
    // Header above elevator portal
    const elevHeader = new THREE.Mesh(new THREE.BoxGeometry(6.2, lobbyH - 3.8, 0.8), wallMat);
    elevHeader.position.set(0, yLobby + 3.8 + (lobbyH - 3.8) * 0.5, -28.2);
    this.undergroundGroup.add(elevHeader);
    this.addNeonStrip(this.undergroundGroup, 0, yLobby + 3.82, -27.76, 5.4, 0.1, 0.1, 0x00f0ff, 1.65);

    // Central crimson-trimmed dais + spinning holographic Marakulin monument (Bolt 1 Atrium signature!)
    addBox('ug_dais', 0, yLobby + 0.6, -4.5, 2.8, 1.2, 2.8, darkMarbleMat, false);
    this.addNeonStrip(this.undergroundGroup, 0, yLobby + 1.23, -4.5, 2.9, 0.07, 2.9, 0xff003c, 1.6);

    const holoSpinner = new THREE.Group();
    holoSpinner.position.set(0, yLobby + 3.6, -4.5);
    const coreOct = new THREE.Mesh(
      new THREE.OctahedronGeometry(1.15, 0),
      new THREE.MeshBasicMaterial({ color: 0xff003c, wireframe: true, transparent: true, opacity: 0.78 }),
    );
    const outerRing = new THREE.Mesh(
      new THREE.TorusGeometry(1.75, 0.06, 8, 28),
      new THREE.MeshBasicMaterial({ color: 0x00f0ff, wireframe: true, transparent: true, opacity: 0.6 }),
    );
    outerRing.rotation.x = Math.PI / 3;
    holoSpinner.add(coreOct, outerRing);
    this.towerHoloSpinner = holoSpinner;
    this.undergroundGroup.add(holoSpinner);

    // 6 Tall dark marble architectural columns with vertical crimson & cyan neon light strips
    const lobbyCols: Array<[number, number, number]> = [
      [-9.5, 4, 1],
      [9.5, 4, 2],
      [-9.5, -10, 3],
      [9.5, -10, 4],
      [-9.5, -21, 5],
      [9.5, -21, 6],
    ];
    for (const [px, pz, idx] of lobbyCols) {
      addBox(`ug_pil_${idx}`, px, yLobby + lobbyH * 0.5, pz, 2.2, lobbyH, 2.2, darkMarbleMat);
      this.addNeonStrip(this.undergroundGroup, px, yLobby + lobbyH * 0.5, pz + 1.13, 0.16, lobbyH - 0.6, 0.08, 0xff003c, 1.55);
      this.addNeonStrip(this.undergroundGroup, px, yLobby + lobbyH * 0.5, pz - 1.13, 0.16, lobbyH - 0.6, 0.08, 0x00f0ff, 1.55);
    }

    // Wall-mounted emissiveMap server rack banks along West/East walls
    for (const rz of [0, -14]) {
      const rackW = new THREE.Mesh(new THREE.BoxGeometry(1.1, 4.6, 4.4), rackMat);
      rackW.position.set(-13.6, yLobby + 2.3, rz);
      this.undergroundGroup.add(rackW);
      this.addNeonStrip(this.undergroundGroup, -13.02, yLobby + 4.62, rz, 0.08, 0.08, 4.44, 0x00f0ff, 1.5);
    }
    const rackE = new THREE.Mesh(new THREE.BoxGeometry(1.1, 4.6, 4.4), rackMat);
    rackE.position.set(13.6, yLobby + 2.3, -14);
    this.undergroundGroup.add(rackE);
    this.addNeonStrip(this.undergroundGroup, 13.02, yLobby + 4.62, -14, 0.08, 0.08, 4.44, 0xff003c, 1.5);

    // Tactical waist-high cover blocks with glowing cyan top neon trim
    const lobbyCovers: Array<[string, number, number, number, number]> = [
      ['ug_cov_1', -4.6, 5.5, 3.2, 1.0],
      ['ug_cov_2', 4.6, 5.5, 3.2, 1.0],
      ['ug_cov_3', -4.6, -7.5, 3.2, 1.0],
      ['ug_cov_4', 4.6, -7.5, 3.2, 1.0],
      ['ug_cov_5', 0, -21.5, 4.4, 1.1],
    ];
    for (const [id, cx, cz, w, d] of lobbyCovers) {
      addBox(id, cx, yLobby + 0.65, cz, w, 1.3, d, darkMarbleMat, false);
      this.addNeonStrip(this.undergroundGroup, cx, yLobby + 1.33, cz, w + 0.06, 0.06, d + 0.06, 0x00f0ff, 1.45);
    }

    // Overhead neon ceiling trusses alternating crimson (0xff003c) & cyan (0x00f0ff) + physically attenuated PointLights
    const lobbyTrussZ = [10, 0, -10, -20];
    lobbyTrussZ.forEach((lz, i) => {
      const isCrimson = i % 2 === 1;
      const trussBeam = new THREE.Mesh(new THREE.BoxGeometry(27, 0.42, 0.52), trussSteelMat);
      trussBeam.position.set(0, yLobby + lobbyH - 0.25, lz);
      this.undergroundGroup.add(trussBeam);

      this.addNeonStrip(
        this.undergroundGroup,
        0,
        yLobby + lobbyH - 0.5,
        lz,
        24,
        0.16,
        0.32,
        isCrimson ? 0xff003c : 0x00f0ff,
        1.55,
      );

      const pt = new THREE.PointLight(isCrimson ? 0xff3b62 : 0x64d6f5, isCrimson ? 25 : 27, 34, 1.5);
      pt.position.set(0, yLobby + lobbyH - 1.6, lz);
      this.undergroundGroup.add(pt);
      if (isCrimson) {
        this.towerAlarmLights.push(pt);
      }
    });

    // Emissive corporate banners in Main Atrium Lobby
    this.addEmissiveBanner(
      this.undergroundGroup,
      this.textures.getNeonSign('MARAKULIN CORP // ГЛАВНЫЙ ХОЛЛ', 'ОХРАНА КЛАССА А → ЛИФТ К ЯДРУ «ХУЕШИ»', '#ff003c', '#00f0ff'),
      0,
      yLobby + 6.4,
      -27.7,
      14.8,
      3.3,
      0,
      0.82,
    );
    this.addEmissiveBanner(
      this.undergroundGroup,
      this.textures.getNeonSign('СЕКТОР 01 // КОД КРАСНЫЙ', 'ТРЕВОГА БЕЗОПАСНОСТИ // ЛИКВИДАЦИЯ', '#ff003c', '#fcee0a'),
      -14.1,
      yLobby + 6.2,
      -5,
      11.5,
      2.6,
      Math.PI / 2,
      0.78,
    );
    this.addEmissiveBanner(
      this.undergroundGroup,
      this.textures.getNeonSign('ХУЕШИ // ЯДРО СИСТЕМЫ', 'КОНТРОЛЬ ЭНГРАММ // МАРАКУЛИН ТАУЭР', '#00f0ff', '#ff003c'),
      14.1,
      yLobby + 6.2,
      -5,
      11.5,
      2.6,
      -Math.PI / 2,
      0.78,
    );

    // Glowing green MaxDoc Supply Crate #1 in Main Atrium Lobby
    this.addSupplyCrate(this.undergroundGroup, 'tower_supply_lobby', -11.8, yLobby, 9.5);

    // Hackable Security Server Terminal in Lobby (linear-nonlinear gameplay option!)
    const termGroup = new THREE.Group();
    termGroup.position.set(11.8, yLobby, -3.5);
    termGroup.rotation.y = -Math.PI / 2;

    const termDesk = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.15, 0.9), darkMarbleMat);
    termDesk.position.y = 0.58;
    const termRack = new THREE.Mesh(new THREE.BoxGeometry(2.4, 3.8, 0.75), rackMat);
    termRack.position.set(0, 1.9, -0.75);
    const termScreenTex = this.textures.getNeonSign(
      'УЗЕЛ БЕЗОПАСНОСТИ',
      'ТУРЕЛИ + ЩИТ СМЭШЕРА // [E] ВЗЛОМ',
      '#fcee0a',
      '#00f0ff',
    );
    const termScreen = new THREE.Mesh(
      new THREE.PlaneGeometry(1.85, 0.82),
      new THREE.MeshStandardMaterial({
        map: termScreenTex,
        emissiveMap: termScreenTex,
        emissive: new THREE.Color(0xffffff),
        emissiveIntensity: 1.0,
      }),
    );
    termScreen.position.set(0, 1.72, -0.34);
    termScreen.rotation.x = -0.18;

    this.securityTerminalBeaconMat = new THREE.MeshStandardMaterial({
      color: 0xfcee0a,
      emissive: 0xfcee0a,
      emissiveIntensity: 1.9,
    });
    const termBeacon = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.1, 0.12), this.securityTerminalBeaconMat);
    termBeacon.position.set(0, 2.25, -0.34);
    const termKeyPad = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.05, 0.45), this.securityTerminalBeaconMat);
    termKeyPad.position.set(0, 1.18, 0.1);

    this.securityTerminalLight = new THREE.PointLight(0xfcee0a, 12, 12, 1.5);
    this.securityTerminalLight.position.set(0, 2.3, 0.65);

    termGroup.add(termDesk, termRack, termScreen, termBeacon, termKeyPad, this.securityTerminalLight);
    this.undergroundGroup.add(termGroup);
    this.physics.addBox('ug_sec_terminal', 12.1, yLobby + 1.5, -3.5, 1.6, 3.0, 2.4, { blocksSight: false });

    this.interactables.push({
      id: 'tower_hack_security',
      label: '[E] ВЗЛОМАТЬ УЗЕЛ БЕЗОПАСНОСТИ (ОТКЛЮЧИТЬ ТУРЕЛИ И ЩИТ СМЭШЕРА)',
      x: 11.8,
      y: yLobby + 1.2,
      z: -3.5,
      radius: 3.4,
      enabled: true,
      category: 'story',
    });

    // Samir Hologram standing beside Ai at assault entrance
    this.undergroundSamir.group.position.set(2.4, yLobby, 10);
    this.undergroundSamir.group.rotation.y = Math.PI;
    this.undergroundGroup.add(this.undergroundSamir.group);

    // ---------------------------------------------------------------------
    // LOWER LEVEL: SMASHER BOSS ARENA (Y = -90) + HUYESHI CHAMBER (Z = -90)
    // ---------------------------------------------------------------------
    const arenaH = 11.0;
    const arenaFloor = new THREE.Mesh(new THREE.BoxGeometry(44, 0.4, 72), floorMat);
    arenaFloor.position.set(0, yCore - 0.2, -62);
    this.undergroundGroup.add(arenaFloor);

    const arenaCeil = new THREE.Mesh(
      new THREE.BoxGeometry(44, 0.4, 72),
      new THREE.MeshStandardMaterial({ color: 0x0d1220, roughness: 0.85 }),
    );
    arenaCeil.position.set(0, yCore + arenaH + 0.2, -62);
    this.undergroundGroup.add(arenaCeil);

    addBox('boss_w', -21.6, yCore + arenaH * 0.5, -62, 0.8, arenaH, 72);
    addBox('boss_e', 21.6, yCore + arenaH * 0.5, -62, 0.8, arenaH, 72);
    addBox('boss_n', 0, yCore + arenaH * 0.5, -97.6, 44, arenaH, 0.8);
    addBox('boss_sl', -12.5, yCore + arenaH * 0.5, -26.6, 19, arenaH, 0.8);
    addBox('boss_sr', 12.5, yCore + arenaH * 0.5, -26.6, 19, arenaH, 0.8);

    // Crimson floor runway lines guiding player from elevator to Smasher & Huyeshi
    this.addNeonStrip(this.undergroundGroup, -2.8, yCore + 0.03, -58, 0.16, 0.04, 54, 0xff003c, 1.55);
    this.addNeonStrip(this.undergroundGroup, 2.8, yCore + 0.03, -58, 0.16, 0.04, 54, 0xff003c, 1.55);

    // 4 Massive dark marble + server-rack tactical pillars with crimson & gold neon strips
    for (const [px, pz, idx] of [
      [-10.5, -48, 1],
      [10.5, -48, 2],
      [-10.5, -72, 3],
      [10.5, -72, 4],
    ]) {
      addBox(`boss_col_${idx}`, px, yCore + 4.5, pz, 3.2, 9.0, 3.2, rackMat);
      this.addNeonStrip(this.undergroundGroup, px, yCore + 4.5, pz + 1.64, 0.18, 8.4, 0.08, 0xff003c, 1.55);
      this.addNeonStrip(this.undergroundGroup, px, yCore + 4.5, pz - 1.64, 0.18, 8.4, 0.08, 0xfcee0a, 1.55);
      this.addNeonStrip(this.undergroundGroup, px, yCore + 9.05, pz, 3.28, 0.1, 3.28, 0xfcee0a, 1.45);
    }

    // 4 Waist-high tactical cover monoliths with glowing golden top neon trim
    const arenaLowCovers: Array<[string, number, number]> = [
      ['boss_low_1', -6.8, -42],
      ['boss_low_2', 6.8, -42],
      ['boss_low_3', -7.8, -60],
      ['boss_low_4', 7.8, -60],
    ];
    for (const [id, lx, lz] of arenaLowCovers) {
      addBox(id, lx, yCore + 0.82, lz, 3.4, 1.64, 1.4, darkMarbleMat, false);
      this.addNeonStrip(this.undergroundGroup, lx, yCore + 1.67, lz, 3.46, 0.07, 1.46, 0xfcee0a, 1.5);
    }

    // Flanking emissiveMap server rack banks along West & East Arena walls
    for (const rz of [-40, -56, -72]) {
      for (const sx of [-20.5, 20.5]) {
        const bank = new THREE.Mesh(new THREE.BoxGeometry(1.2, 5.4, 6.2), rackMat);
        bank.position.set(sx, yCore + 2.7, rz);
        this.undergroundGroup.add(bank);
        this.addNeonStrip(
          this.undergroundGroup,
          sx > 0 ? sx - 0.64 : sx + 0.64,
          yCore + 5.45,
          rz,
          0.08,
          0.08,
          6.24,
          rz === -56 ? 0xfcee0a : 0xff003c,
          1.45,
        );
      }
    }

    // Overhead neon ceiling trusses alternating crimson (0xff003c) & golden (0xfcee0a) + physically attenuated PointLights
    const arenaTrussZ = [-36, -50, -64, -78];
    arenaTrussZ.forEach((lz, i) => {
      const isCrimson = i % 2 === 0;
      const trussBeam = new THREE.Mesh(new THREE.BoxGeometry(38, 0.48, 0.56), trussSteelMat);
      trussBeam.position.set(0, yCore + arenaH - 0.28, lz);
      this.undergroundGroup.add(trussBeam);

      this.addNeonStrip(
        this.undergroundGroup,
        0,
        yCore + arenaH - 0.56,
        lz,
        34,
        0.18,
        0.36,
        isCrimson ? 0xff003c : 0xfcee0a,
        1.55,
      );

      const pt = new THREE.PointLight(isCrimson ? 0xff3b62 : 0xf5be6b, isCrimson ? 26 : 28, 34, 1.5);
      pt.position.set(0, yCore + arenaH - 1.8, lz);
      this.undergroundGroup.add(pt);
      if (isCrimson) {
        this.towerAlarmLights.push(pt);
      }
    });

    // Emissive corporate banners in Smasher Boss Arena
    this.addEmissiveBanner(
      this.undergroundGroup,
      this.textures.getNeonSign('ХУЕШИ // ЯДРО СИСТЕМЫ', 'ПОДЗЕМНЫЙ КОМПЛЕКС -12 ЭТ. // НЕЙРО-СЕПАРАТОР', '#ff003c', '#00f0ff'),
      0,
      yCore + 9.1,
      -97.0,
      16.5,
      3.2,
      0,
      0.88,
    );
    this.addEmissiveBanner(
      this.undergroundGroup,
      this.textures.getNeonSign('MARAKULIN CORP // БИОЧИП', 'АВТОРИЗАЦИЯ: УРОВЕНЬ ОМЕГА', '#fcee0a', '#ff003c'),
      -21.0,
      yCore + 7.6,
      -58,
      14.0,
      3.0,
      Math.PI / 2,
      0.8,
    );
    this.addEmissiveBanner(
      this.undergroundGroup,
      this.textures.getNeonSign('РИХАРД СМЭШЕР // ОХРАНА', 'ПРОТОКОЛ ТОТАЛЬНОГО УНИЧТОЖЕНИЯ', '#ff003c', '#fcee0a'),
      21.0,
      yCore + 7.6,
      -58,
      14.0,
      3.0,
      -Math.PI / 2,
      0.8,
    );

    // Glowing green MaxDoc Supply Crate #2 in the Smasher Boss Arena
    this.addSupplyCrate(this.undergroundGroup, 'tower_supply_arena', -16.5, yCore, -56);

    // ---------------------------------------------------------------------
    // HUYESHI CHAMBER (Z = -90) — BOLT 1 OperatingTableScene VISUAL CRAFT
    // ---------------------------------------------------------------------
    this.buildHuyeshiChamber(yCore);

    this.interactables.push(
      {
        id: 'tower_elevator_down',
        label: '[E] СПУСТИТЬСЯ НА ЛИФТЕ К КОМПЛЕКСУ «ХУЕШИ»',
        x: 0,
        y: yLobby + 1.2,
        z: -29.5,
        radius: 3.6,
        enabled: false,
        category: 'elevator',
      },
      {
        id: 'smasher_execute',
        label: '[E] ДОБИТЬ РИХАРДА СМЭШЕРА ИЗ MALORIAN S-3516',
        x: 0,
        y: yCore + 1.2,
        z: -62,
        radius: 5.5,
        enabled: false,
        category: 'story',
      },
      {
        id: 'huyeshi_jack_in',
        label: '[E] ПОДКЛЮЧИТЬСЯ К АППАРАТУ «ХУЕШИ»',
        x: 0,
        y: yCore + 1.5,
        z: -90,
        radius: 4.5,
        enabled: false,
        category: 'story',
      },
    );
  }

  private buildHuyeshiChamber(yCore: number): void {
    const steelMat = new THREE.MeshStandardMaterial({
      color: 0x384357,
      metalness: 0.62,
      roughness: 0.36,
    });
    const darkChassisMat = new THREE.MeshStandardMaterial({
      color: 0x111726,
      metalness: 0.72,
      roughness: 0.28,
    });
    const cuffMat = new THREE.MeshStandardMaterial({
      color: 0xff003c,
      emissive: 0xff003c,
      emissiveIntensity: 2.3,
      roughness: 0.2,
    });

    // Stepped circular neural dais (0.22m step height so player smoothly steps up!)
    const daisBase = new THREE.Mesh(new THREE.CylinderGeometry(4.8, 5.4, 0.22, 24), darkChassisMat);
    daisBase.position.set(0, yCore + 0.11, -90);
    this.undergroundGroup.add(daisBase);

    const daisTrim = new THREE.Mesh(
      new THREE.TorusGeometry(4.85, 0.07, 10, 36),
      new THREE.MeshStandardMaterial({
        color: 0x00f0ff,
        emissive: 0x00f0ff,
        emissiveIntensity: 1.8,
      }),
    );
    daisTrim.rotation.x = Math.PI / 2;
    daisTrim.position.set(0, yCore + 0.24, -90);
    this.undergroundGroup.add(daisTrim);

    // Ambient rotating Huyeshi hologram ring framing the chamber
    this.huyeshiAmbientRing = new THREE.Mesh(
      new THREE.TorusGeometry(4.1, 0.1, 10, 36),
      new THREE.MeshBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.62 }),
    );
    this.huyeshiAmbientRing.position.set(0, yCore + 3.4, -90);
    this.undergroundGroup.add(this.huyeshiAmbientRing);

    // Neural Jack-In Chair with glowing crimson laser restraints (inspired by Bolt 1 OperatingTableScene)
    const chairGroup = new THREE.Group();
    chairGroup.position.set(0, yCore + 0.22, -90);

    const chairPedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.85, 0.62, 14), steelMat);
    chairPedestal.position.y = 0.31;
    const chairSeat = new THREE.Mesh(new THREE.BoxGeometry(1.22, 0.22, 1.55), darkChassisMat);
    chairSeat.position.set(0, 0.72, 0.12);
    const chairBack = new THREE.Mesh(new THREE.BoxGeometry(1.18, 1.48, 0.24), darkChassisMat);
    chairBack.position.set(0, 1.38, -0.68);
    chairBack.rotation.x = -0.34;
    const headrest = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.36, 0.26), steelMat);
    headrest.position.set(0, 2.04, -0.95);
    chairGroup.add(chairPedestal, chairSeat, chairBack, headrest);

    // Armrests + glowing crimson laser-restraint cuffs!
    for (const sx of [-0.66, 0.66]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.16, 1.35), steelMat);
      arm.position.set(sx, 1.02, 0.05);
      chairGroup.add(arm);

      const wristCuff = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.18, 0.28), cuffMat);
      wristCuff.position.set(sx, 1.16, 0.36);
      const ankleCuff = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, 0.26), cuffMat);
      ankleCuff.position.set(sx * 0.78, 0.86, 0.82);
      chairGroup.add(wristCuff, ankleCuff);
    }

    // Thin crimson laser restraint arcs spanning across chair armrests
    const laserBarMat = new THREE.MeshBasicMaterial({ color: 0xff003c, transparent: true, opacity: 0.75 });
    const restraintBeam1 = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.32, 6), laserBarMat);
    restraintBeam1.rotation.z = Math.PI / 2;
    restraintBeam1.position.set(0, 1.18, 0.36);
    const restraintBeam2 = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.04, 6), laserBarMat);
    restraintBeam2.rotation.z = Math.PI / 2;
    restraintBeam2.position.set(0, 0.88, 0.82);
    chairGroup.add(restraintBeam1, restraintBeam2);

    this.undergroundGroup.add(chairGroup);
    this.physics.addBox('huyeshi_chair_col', 0, yCore + 1.1, -90, 1.4, 2.2, 1.6, { blocksSight: false });

    // Flanking ECG & Huyeshi Monitors on articulated chrome stands
    const ecgTex = this.createEcgMonitorTexture();
    const ecgMat = new THREE.MeshStandardMaterial({
      map: ecgTex,
      emissiveMap: ecgTex,
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity: 1.05,
      roughness: 0.3,
    });
    const huyeshiTex = this.textures.getHuyeshiMonitor();
    const huyeshiMonMat = new THREE.MeshStandardMaterial({
      map: huyeshiTex,
      emissiveMap: huyeshiTex,
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity: 1.12,
      roughness: 0.3,
    });

    const mountMonitor = (x: number, z: number, rotY: number, mat: THREE.Material) => {
      const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.14, 2.7, 10), steelMat);
      stand.position.set(x, yCore + 1.35, z);
      const housing = new THREE.Mesh(new THREE.BoxGeometry(2.75, 1.48, 0.14), darkChassisMat);
      housing.position.set(x, yCore + 2.85, z);
      housing.rotation.y = rotY;
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(2.55, 1.3), mat);
      screen.position.z = 0.08;
      housing.add(screen);
      this.undergroundGroup.add(stand, housing);
    };

    mountMonitor(-3.65, -92.1, 0.52, ecgMat);
    mountMonitor(3.65, -92.1, -0.52, huyeshiMonMat);

    // Large central Huyeshi diagnostic display on North chamber wall
    const centralScreen = new THREE.Mesh(new THREE.PlaneGeometry(6.8, 3.3), huyeshiMonMat);
    centralScreen.position.set(0, yCore + 5.6, -97.0);
    this.undergroundGroup.add(centralScreen);

    // Overhead Descending Neural Crown + Converging Red Extraction Laser Beams
    this.huyeshiCrown.position.set(0, yCore + 5.6, -90);

    const crownOuter = new THREE.Mesh(new THREE.TorusGeometry(1.45, 0.11, 10, 32), steelMat);
    crownOuter.rotation.x = Math.PI / 2;
    this.huyeshiCrown.add(crownOuter);

    const crownLamp = new THREE.Mesh(
      new THREE.TorusGeometry(1.2, 0.06, 8, 28),
      new THREE.MeshStandardMaterial({
        color: 0xd8f8ff,
        emissive: 0xb8f0ff,
        emissiveIntensity: 2.5,
      }),
    );
    crownLamp.rotation.x = Math.PI / 2;
    crownLamp.position.y = -0.06;
    this.huyeshiCrown.add(crownLamp);

    // 6 Emitter prongs + converging crimson extraction laser beams
    const laserMat = new THREE.MeshBasicMaterial({
      color: 0xff003c,
      transparent: true,
      opacity: 0.88,
    });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const prong = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.42, 0.14), steelMat);
      prong.position.set(Math.cos(a) * 1.25, -0.22, Math.sin(a) * 1.25);
      this.huyeshiCrown.add(prong);

      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.016, 2.8, 6), laserMat);
      beam.position.set(Math.cos(a) * 0.62, -1.45, Math.sin(a) * 0.62);
      beam.rotation.z = Math.cos(a) * 0.34;
      beam.rotation.x = -Math.sin(a) * 0.34;
      this.huyeshiLasers.add(beam);
    }
    this.huyeshiLasers.visible = false;
    this.huyeshiCrown.add(this.huyeshiLasers);
    this.undergroundGroup.add(this.huyeshiCrown);

    // Rising cyan/crimson engram extraction particles around the Huyeshi dais
    const pCount = 260;
    const pPos = new Float32Array(pCount * 3);
    const pCol = new Float32Array(pCount * 3);
    this.huyeshiParticleSpeeds = new Float32Array(pCount);
    for (let i = 0; i < pCount; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.6 + Math.random() * 3.8;
      pPos[i * 3] = Math.cos(a) * r;
      pPos[i * 3 + 1] = 0.4 + Math.random() * 5.2;
      pPos[i * 3 + 2] = Math.sin(a) * r;
      this.huyeshiParticleSpeeds[i] = 0.7 + Math.random() * 1.9;
      const isCyan = i % 2 === 0;
      pCol[i * 3] = isCyan ? 0.0 : 1.0;
      pCol[i * 3 + 1] = isCyan ? 0.94 : 0.04;
      pCol[i * 3 + 2] = isCyan ? 1.0 : 0.25;
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
    this.huyeshiParticles = new THREE.Points(
      pGeo,
      new THREE.PointsMaterial({
        size: 0.1,
        vertexColors: true,
        transparent: true,
        opacity: 0.25,
        depthWrite: false,
      }),
    );
    this.huyeshiParticles.position.set(0, yCore, -90);
    this.undergroundGroup.add(this.huyeshiParticles);

    // Dramatic Bolt 1 OperatingTableScene Surgical SpotLight + flanking Rim Lights
    this.huyeshiSurgicalLight = new THREE.SpotLight(0xd8eefc, 32, 20, Math.PI / 2.5, 0.55, 1.45);
    this.huyeshiSurgicalLight.position.set(0, yCore + 8.4, -89.2);
    this.huyeshiSurgicalLight.target.position.set(0, yCore + 1.4, -90);
    this.undergroundGroup.add(this.huyeshiSurgicalLight, this.huyeshiSurgicalLight.target);

    const huyeshiCyanRim = new THREE.PointLight(0x38e4f5, 18, 22, 1.5);
    huyeshiCyanRim.position.set(-4.5, yCore + 4.2, -91);
    this.undergroundGroup.add(huyeshiCyanRim);

    const huyeshiRedRim = new THREE.PointLight(0xff2e58, 16, 22, 1.5);
    huyeshiRedRim.position.set(4.5, yCore + 4.2, -91);
    this.undergroundGroup.add(huyeshiRedRim);

    this.huyeshiExtractLight = new THREE.PointLight(0xff003c, 0, 18, 1.45);
    this.huyeshiExtractLight.position.set(0, yCore + 3.1, -90);
    this.undergroundGroup.add(this.huyeshiExtractLight);
  }

  /**
   * Drives the overhead descending Neural Crown, converging red extraction laser beams,
   * crimson extraction lighting, and ascending engram particles in the Huyeshi Chamber (`Z = -90`).
   */
  setHuyeshiExtraction(progress: number): void {
    const yCore = INSTANCE_Y.UNDERGROUND;
    const p = clamp01(progress);
    this.huyeshiExtractionProgress = p;
    this.huyeshiLasers.visible = p > 0.02;
    this.huyeshiCrown.position.y = THREE.MathUtils.lerp(yCore + 5.6, yCore + 3.45, Math.min(1, p * 1.35));
    this.huyeshiExtractLight.intensity = p * 28;
    const pMat = this.huyeshiParticles.material as THREE.PointsMaterial;
    pMat.opacity = 0.25 + p * 0.72;
  }

  /**
   * Marks a Marakulin Tower MaxDoc Supply Crate as used (dimmed) or available (glowing green).
   */
  setSupplyCrateUsed(id: string, used = true): void {
    const crate = this.supplyCrates.get(id);
    if (crate) {
      crate.used = used;
      if (used) {
        crate.glowMat.color.setHex(0x334444);
        crate.glowMat.emissive.setHex(0x112222);
        crate.glowMat.emissiveIntensity = 0.15;
        crate.light.intensity = 0;
      } else {
        crate.glowMat.color.setHex(0x00ff88);
        crate.glowMat.emissive.setHex(0x00ff88);
        crate.glowMat.emissiveIntensity = 1.65;
        crate.light.intensity = 8;
      }
    }
    this.setInteractableEnabled(id, !used);
  }

  /**
   * Updates visual indicator state of the Lobby Security Server Terminal once hacked.
   */
  setTowerSecurityHacked(hacked: boolean): void {
    const hex = hacked ? 0x00ff88 : 0xfcee0a;
    if (this.securityTerminalBeaconMat) {
      this.securityTerminalBeaconMat.color.setHex(hex);
      this.securityTerminalBeaconMat.emissive.setHex(hex);
      this.securityTerminalBeaconMat.emissiveIntensity = hacked ? 1.5 : 1.9;
    }
    if (this.securityTerminalLight) {
      this.securityTerminalLight.color.setHex(hex);
    }
    this.setInteractableEnabled('tower_hack_security', !hacked);
  }

  // =========================================================================
  // 4. CYBERSPACE & BLACKWALL (Y = 320)
  // =========================================================================

  private buildCyberspace(): void {
    const y = INSTANCE_Y.CYBERSPACE;

    this.cyberspaceGroup.add(new THREE.HemisphereLight(0x38c8ff, 0x3a0824, 0.95));
    this.cyberspaceGroup.add(new THREE.AmbientLight(0x181c36, 0.4));

    // Glowing digital bridge with cyan neon edge rails & center data spine
    const bridge = new THREE.Mesh(
      new THREE.BoxGeometry(8, 0.3, 48),
      new THREE.MeshStandardMaterial({
        color: 0x091628,
        emissive: 0x00a8cc,
        emissiveIntensity: 0.55,
        roughness: 0.22,
        metalness: 0.65,
      }),
    );
    bridge.position.set(0, y - 0.15, -13);
    this.cyberspaceGroup.add(bridge);

    this.addNeonStrip(this.cyberspaceGroup, -3.95, y + 0.08, -13, 0.12, 0.12, 48, 0x00f0ff, 1.85);
    this.addNeonStrip(this.cyberspaceGroup, 3.95, y + 0.08, -13, 0.12, 0.12, 48, 0x00f0ff, 1.85);
    this.addNeonStrip(this.cyberspaceGroup, 0, y + 0.02, -13, 0.18, 0.04, 46, 0xff2a6d, 1.45);

    // Bridge holographic guide pylons
    for (let z = 2; z >= -26; z -= 7) {
      for (const sx of [-4.2, 4.2]) {
        const pylon = new THREE.Mesh(
          new THREE.BoxGeometry(0.14, 2.2, 0.14),
          new THREE.MeshBasicMaterial({ color: z % 14 === 0 ? 0xff2a6d : 0x00f0ff, transparent: true, opacity: 0.72 }),
        );
        pylon.position.set(sx, y + 1.1, z);
        this.cyberspaceGroup.add(pylon);
      }
    }

    // Infinite-feel wireframe floor grid
    const grid = new THREE.GridHelper(180, 44, 0xff0055, 0x00f0ff);
    grid.position.set(0, y - 4, -18);
    this.cyberspaceGroup.add(grid);

    // Towering Crimson/Cyan Blackwall Digital Firewall in the background (Z = -48)
    const blackwallTex = this.createBlackwallTexture();
    this.cyberBlackwallMat = new THREE.MeshStandardMaterial({
      map: blackwallTex,
      emissiveMap: blackwallTex,
      emissive: new THREE.Color(0xff2255),
      emissiveIntensity: 1.35,
      transparent: true,
      opacity: 0.92,
      roughness: 0.3,
    });
    const blackwall = new THREE.Mesh(new THREE.PlaneGeometry(150, 56), this.cyberBlackwallMat);
    blackwall.position.set(0, y + 18, -48);
    this.cyberspaceGroup.add(blackwall);

    // Wireframe crimson firewall lattice overlay slightly in front of Blackwall
    const blackwallGrid = new THREE.Mesh(
      new THREE.PlaneGeometry(148, 54, 28, 12),
      new THREE.MeshBasicMaterial({ color: 0xff003c, wireframe: true, transparent: true, opacity: 0.34 }),
    );
    blackwallGrid.position.set(0, y + 18, -46.8);
    this.cyberspaceGroup.add(blackwallGrid);

    // Pulsing vertical data streams & wireframe data monoliths flanking the void
    const monoMat = new THREE.MeshBasicMaterial({ color: 0xff004c, wireframe: true, transparent: true, opacity: 0.55 });
    for (let i = 0; i < 16; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const monoH = 18 + (i % 4) * 6;
      const mono = new THREE.Mesh(new THREE.BoxGeometry(3.2, monoH, 3.2), monoMat);
      mono.position.set(side * (13 + (i % 3) * 7), y + 4, 8 - i * 4.2);
      this.cyberspaceGroup.add(mono);

      // Pulsing vertical light data stream column
      const streamMat = new THREE.MeshBasicMaterial({
        color: i % 3 === 0 ? 0xff003c : 0x00f0ff,
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
      });
      const stream = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 34, 6), streamMat);
      stream.position.set(side * (9 + (i % 4) * 5.2), y + 10, 6 - i * 3.6);
      this.cyberspaceGroup.add(stream);
      this.cyberDataStreams.push(stream);
    }

    // Floating digital cloud particles
    const count = 520;
    const pos = new Float32Array(count * 3);
    const cols = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 68;
      pos[i * 3 + 1] = y + Math.random() * 26 - 3;
      pos[i * 3 + 2] = -46 + Math.random() * 64;
      const isRed = i % 3 === 0;
      cols[i * 3] = isRed ? 1.0 : 0.0;
      cols[i * 3 + 1] = isRed ? 0.08 : 0.94;
      cols[i * 3 + 2] = isRed ? 0.32 : 1.0;
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    pGeo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    this.cyberParticles = new THREE.Points(
      pGeo,
      new THREE.PointsMaterial({ size: 0.26, vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false }),
    );
    this.cyberspaceGroup.add(this.cyberParticles);

    // Taisiya waiting at end of the digital bridge + orbiting neural shards!
    this.taisiyaRig.group.position.set(0, y, -26);
    this.cyberspaceGroup.add(this.taisiyaRig.group);

    const taisiyaLight = new THREE.PointLight(0xff44aa, 18, 18, 1.5);
    taisiyaLight.position.set(0, y + 3.2, -24.5);
    this.cyberspaceGroup.add(taisiyaLight);

    // 12 Orbiting crystalline neural shards around Taisiya
    const shardGeo = new THREE.OctahedronGeometry(0.24, 0);
    for (let i = 0; i < 12; i++) {
      const isCyan = i % 2 === 0;
      const shard = new THREE.Mesh(
        shardGeo,
        new THREE.MeshStandardMaterial({
          color: isCyan ? 0x00f0ff : 0xff2a88,
          emissive: isCyan ? 0x00f0ff : 0xff2a88,
          emissiveIntensity: 1.9,
          roughness: 0.15,
        }),
      );
      this.cyberspaceGroup.add(shard);
      this.cyberShards.push({
        mesh: shard,
        radius: 1.45 + (i % 3) * 0.55,
        baseY: y + 0.9 + (i % 4) * 0.45,
        speed: (i % 2 === 0 ? 1 : -1) * (0.75 + (i % 3) * 0.35),
        phase: (i / 12) * Math.PI * 2,
        bobAmp: 0.18 + (i % 3) * 0.08,
      });
    }

    // Twin Dramatic Light-Beam Portals behind Taisiya:
    // Left (Cyan) = Return to Body (Ai), Right (Crimson) = Give Body to Samir
    const buildPortal = (px: number, colorHex: number, title: string, subtitle: string, hexStr: string) => {
      const outer = new THREE.Mesh(
        new THREE.TorusGeometry(2.5, 0.14, 12, 32),
        new THREE.MeshBasicMaterial({ color: colorHex }),
      );
      outer.position.set(px, y + 2.7, -33);
      this.cyberspaceGroup.add(outer);

      const inner = new THREE.Mesh(
        new THREE.TorusGeometry(1.95, 0.08, 10, 28),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 }),
      );
      inner.position.set(px, y + 2.7, -33);
      this.cyberspaceGroup.add(inner);
      this.cyberPortalRings.push(outer, inner);

      // Swirling translucent vortex core
      const vortex = new THREE.Mesh(
        new THREE.CircleGeometry(2.15, 28),
        new THREE.MeshBasicMaterial({
          color: colorHex,
          transparent: true,
          opacity: 0.24,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      vortex.position.set(px, y + 2.7, -33);
      this.cyberspaceGroup.add(vortex);

      // Towering vertical light beam shooting into cyberspace zenith
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(1.1, 2.3, 46, 16, 1, true),
        new THREE.MeshBasicMaterial({
          color: colorHex,
          transparent: true,
          opacity: 0.18,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      beam.position.set(px, y + 21, -33);
      this.cyberspaceGroup.add(beam);

      const pLight = new THREE.PointLight(colorHex, 24, 24, 1.5);
      pLight.position.set(px, y + 3.2, -31);
      this.cyberspaceGroup.add(pLight);

      this.addEmissiveBanner(
        this.cyberspaceGroup,
        this.textures.getNeonSign(title, subtitle, hexStr, '#ffffff'),
        px,
        y + 6.4,
        -33,
        6.4,
        1.55,
        0,
        0.92,
      );
    };

    buildPortal(-5.4, 0x00f0ff, 'ВЕРНУТЬСЯ В ТЕЛО', 'АИ // ЛЕГЕНДА ЕБЛАНХАНЫ', '#00f0ff');
    buildPortal(5.4, 0xff003c, 'ОТДАТЬ ТЕЛО САМИРУ', 'НОВАЯ ЖИЗНЬ // ТАЛДЫКОРГАН', '#ff003c');
  }

  // =========================================================================
  // 5. TALDYKORGAN HIGHWAY EPILOGUE (Y = 420)
  // =========================================================================

  private buildTaldykorganRoad(): void {
    const y = INSTANCE_Y.TALDYKORGAN;

    // Warm sunset desert lighting
    this.taldykorganGroup.add(new THREE.HemisphereLight(0xff9d5c, 0x3b1a12, 1.15));
    this.taldykorganGroup.add(new THREE.AmbientLight(0x3a1c14, 0.35));
    const sunKey = new THREE.PointLight(0xff7733, 36, 280, 1.1);
    sunKey.position.set(0, y + 28, -95);
    this.taldykorganGroup.add(sunKey);

    // Warm Sunset Desert Sky Dome (BackSide gradient with twilight stars & distant steppe horizon)
    const skyTex = this.createSunsetSkyTexture();
    const skyDome = new THREE.Mesh(
      new THREE.SphereGeometry(265, 28, 18),
      new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false }),
    );
    skyDome.position.set(0, y + 8, -40);
    this.taldykorganGroup.add(skyDome);

    // Kazakh steppe desert plain
    const steppe = new THREE.Mesh(
      new THREE.PlaneGeometry(420, 420),
      new THREE.MeshStandardMaterial({ color: 0x341c12, roughness: 0.94, metalness: 0.05 }),
    );
    steppe.rotation.x = -Math.PI / 2;
    steppe.position.set(0, y - 0.06, -100);
    this.taldykorganGroup.add(steppe);

    // Desert highway asphalt with warm-lit sheen
    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(16, 420),
      new THREE.MeshStandardMaterial({
        map: this.textures.getRoadSurface(1, 28),
        roughness: 0.52,
        metalness: 0.25,
      }),
    );
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, y, -100);
    this.taldykorganGroup.add(road);

    // Glowing Retro-Synthwave Setting Sun + outer solar halo
    const sunTex = this.createSynthwaveSunTexture();
    const sun = new THREE.Mesh(
      new THREE.PlaneGeometry(66, 66),
      new THREE.MeshBasicMaterial({ map: sunTex, transparent: true, fog: false, depthWrite: false }),
    );
    sun.position.set(0, y + 29, -215);
    this.taldykorganGroup.add(sun);

    const sunHalo = new THREE.Mesh(
      new THREE.RingGeometry(31, 44, 36),
      new THREE.MeshBasicMaterial({
        color: 0xff5511,
        transparent: true,
        opacity: 0.26,
        fog: false,
        depthWrite: false,
      }),
    );
    sunHalo.position.set(0, y + 29, -216);
    this.taldykorganGroup.add(sunHalo);

    // Highway Sign "ТАЛДЫКОРГАН → 280 КМ" on twin steel gantry posts
    const postSteel = new THREE.MeshStandardMaterial({ color: 0x261d1c, metalness: 0.65, roughness: 0.45 });
    for (const sx of [6.5, 15.5]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 6.2, 8), postSteel);
      leg.position.set(sx, y + 3.1, -26.2);
      this.taldykorganGroup.add(leg);
    }
    this.addEmissiveBanner(
      this.taldykorganGroup,
      this.textures.getNeonSign('ТАЛДЫКОРГАН → 280 КМ', 'ДОБРО ПОЖАЛОВАТЬ В ГОРОД-АД', '#ff6600', '#fcee0a'),
      11,
      y + 4.7,
      -26,
      12.2,
      3.2,
      0,
      0.95,
    );

    // Rushing roadside neon mileposts along both edges of the highway
    const mileBodyMat = new THREE.MeshStandardMaterial({ color: 0x221614, metalness: 0.5, roughness: 0.5 });
    const mileGlowMat = new THREE.MeshBasicMaterial({ color: 0xff7722 });
    for (let i = 0; i < 16; i++) {
      const postGroup = new THREE.Group();
      const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.32, 3.6, 0.32), mileBodyMat);
      shaft.position.y = 1.8;
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.9, 0.42), mileGlowMat);
      cap.position.y = 3.2;
      postGroup.add(shaft, cap);
      postGroup.position.set(i % 2 === 0 ? -9.6 : 9.6, y, 22 - i * 18);
      this.taldykorganGroup.add(postGroup);
      this.taldyRoadPosts.push(postGroup);
    }

    // Warm sunlit desert dust particles drifting across the highway
    const dustCount = 280;
    const dustPos = new Float32Array(dustCount * 3);
    for (let i = 0; i < dustCount; i++) {
      dustPos[i * 3] = (Math.random() - 0.5) * 44;
      dustPos[i * 3 + 1] = y + 0.4 + Math.random() * 10;
      dustPos[i * 3 + 2] = -95 + Math.random() * 110;
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
    this.taldyDustParticles = new THREE.Points(
      dustGeo,
      new THREE.PointsMaterial({
        color: 0xffb366,
        size: 0.16,
        transparent: true,
        opacity: 0.65,
        depthWrite: false,
      }),
    );
    this.taldykorganGroup.add(this.taldyDustParticles);

    // --- DETAILED INTERCITY BUS / CAR DASHBOARD SILHOUETTE AROUND VIEWER ---
    // Camera is at (sin(t*0.4)*0.4, y + 1.6, 8) looking toward (0, y + 2.5, -40) with fov 74.
    const busCab = new THREE.Group();
    busCab.position.set(0, y, 8.0);

    const cabMat = new THREE.MeshStandardMaterial({ color: 0x0e0b0d, metalness: 0.42, roughness: 0.65 });
    const amberGlowMat = new THREE.MeshBasicMaterial({ color: 0xff8822 });

    // Wide lower bus dashboard (top at local Y = 1.15, framing lower windshield cleanly!)
    const dash = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.72, 0.95), cabMat);
    dash.position.set(0, 0.78, -1.45);
    busCab.add(dash);

    // Subtle warm amber instrument gauges on left side of dash
    const gaugePanel = new THREE.Mesh(
      new THREE.BoxGeometry(0.92, 0.18, 0.06),
      new THREE.MeshStandardMaterial({
        color: 0xff8822,
        emissive: 0xff6600,
        emissiveIntensity: 1.5,
      }),
    );
    gaugePanel.position.set(-0.92, 1.18, -1.32);
    gaugePanel.rotation.x = -0.35;
    busCab.add(gaugePanel);

    // Amber dash trim line
    this.addNeonStrip(busCab, 0, 1.14, -0.99, 4.2, 0.025, 0.03, 0xff7722, 1.3);

    // Bus steering wheel silhouette on the left
    const busWheel = new THREE.Group();
    busWheel.position.set(-0.95, 1.24, -1.08);
    busWheel.rotation.x = -0.62;
    const bRim = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.028, 8, 22), cabMat);
    const bSpoke = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.035, 0.03), cabMat);
    busWheel.add(bRim, bSpoke);
    this.taldySteeringWheel = busWheel;
    busCab.add(busWheel);

    // Wide panoramic bus windshield A-pillars (at X = ±2.15 so ±0.4 camera sway never clips!)
    for (const sx of [-2.15, 2.15]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.2, 0.16), cabMat);
      pillar.position.set(sx, 1.98, -1.35);
      pillar.rotation.x = 0.16;
      busCab.add(pillar);
    }

    // Overhead bus roof header / sun visor
    const visor = new THREE.Mesh(new THREE.BoxGeometry(4.55, 0.24, 0.65), cabMat);
    visor.position.set(0, 2.95, -1.15);
    busCab.add(visor);

    // Little dangling glowing cyber-charm hanging from top center of windshield
    const charmCord = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.28, 6), cabMat);
    charmCord.position.set(0.12, 2.72, -1.32);
    const charm = new THREE.Mesh(new THREE.OctahedronGeometry(0.055, 0), amberGlowMat);
    charm.position.set(0.12, 2.55, -1.32);
    this.taldyDashCharm = charm;
    busCab.add(charmCord, charm);

    const dashFill = new THREE.PointLight(0xff7722, 4.5, 6, 1.5);
    dashFill.position.set(-0.5, 1.45, -0.95);
    busCab.add(dashFill);

    this.taldykorganGroup.add(busCab);
  }

  // =========================================================================
  // INTERACTABLE MANAGEMENT & FRAME UPDATE LOOP
  // =========================================================================

  setInteractableEnabled(id: string, enabled: boolean): void {
    const it = this.interactables.find((i) => i.id === id);
    if (it) it.enabled = enabled;
  }

  updateInteractablePos(id: string, x: number, y: number, z: number): void {
    const it = this.interactables.find((i) => i.id === id);
    if (it) {
      it.x = x;
      it.y = y;
      it.z = z;
    }
  }

  update(dt: number, elapsed: number): void {
    // 1. Penthouse animations (flying Night City AVs & Biochip holographic ring)
    if (this.penthouseGroup.visible) {
      for (const av of this.penthouseAvs) {
        av.mesh.position.z += av.speed * dt;
        if (av.speed > 0 && av.mesh.position.z > av.maxZ) av.mesh.position.z = av.minZ;
        if (av.speed < 0 && av.mesh.position.z < av.minZ) av.mesh.position.z = av.maxZ;
      }
      if (this.penthouseHoloRing && this.biochipCase.visible) {
        this.penthouseHoloRing.rotation.z = elapsed * 1.4;
        this.penthouseHoloRing.position.y = INSTANCE_Y.PENTHOUSE + 1.48 + Math.sin(elapsed * 2.8) * 0.05;
      }
    }

    // 2. Cyber-Akhmed Chase Interior & High-Speed Highway
    if (this.chaseGroup.visible) {
      for (const arch of this.chaseArches) {
        arch.position.z += dt * 68;
        if (arch.position.z > 52) arch.position.z -= 16 * 24;
      }
      for (const bldg of this.chaseSkyscrapers) {
        bldg.position.z += dt * 52;
        if (bldg.position.z > 46) bldg.position.z -= 20 * 17;
      }
      for (const tr of this.chaseTraffic) {
        tr.mesh.position.z += dt * tr.speed;
        if (tr.mesh.position.z > tr.maxZ) tr.mesh.position.z = tr.minZ;
      }
      if (this.chaseSteeringWheel) {
        this.chaseSteeringWheel.rotation.z = Math.sin(elapsed * 1.9) * 0.14 + Math.sin(elapsed * 4.3) * 0.04;
      }
      if (this.chaseCabinLight) {
        this.chaseCabinLight.intensity = 7.5 + Math.sin(elapsed * 9.0) * 1.2;
      }

      // Animate glowing Relic Biochip from Sanzhar's hand smoothly toward Ai's neural slot / camera
      if (this.chaseBiochipVisible) {
        this.chaseBiochipProgress = Math.min(1, this.chaseBiochipProgress + dt * 0.45);
        const p = smoothstep(this.chaseBiochipProgress);
        this.chaseBiochip.position.set(
          THREE.MathUtils.lerp(0.58, 0.14, p),
          THREE.MathUtils.lerp(1.86, 2.06, p),
          THREE.MathUtils.lerp(-0.42, -0.18, p),
        );
        this.chaseBiochip.rotation.y = elapsed * 2.4;
        this.chaseBiochip.rotation.z = Math.sin(elapsed * 3) * 0.18;

        // Extend Sanzhar's right arm gently toward Ai as he inserts the biochip
        this.chaseSanzhar.rightArm.rotation.x = THREE.MathUtils.lerp(-1.15, -1.55, p);
        this.chaseSanzhar.rightArm.rotation.z = THREE.MathUtils.lerp(0.25, 0.52, p);
      } else if (this.chaseSanzharWounded) {
        // Subtle pained breathing while wounded
        this.chaseSanzhar.head.rotation.x = 0.28 + Math.sin(elapsed * 2.6) * 0.04;
      }
    }

    // 3. Marakulin Tower Lobby, Smasher Arena & Huyeshi Chamber
    if (this.undergroundGroup.visible) {
      animateHologramRig(this.undergroundSamir, elapsed);

      // Pulse crimson alarm lights throughout Lobby & Smasher Arena (Bolt 1 signature!)
      for (let i = 0; i < this.towerAlarmLights.length; i++) {
        this.towerAlarmLights[i].intensity = 24 + Math.sin(elapsed * 5.2 + i * 1.2) * 7.5;
      }

      // Rotate Lobby holographic corporate monument
      if (this.towerHoloSpinner) {
        this.towerHoloSpinner.rotation.y += dt * 0.72;
        this.towerHoloSpinner.position.y = INSTANCE_Y.UNDERGROUND + 24 + 3.6 + Math.sin(elapsed * 1.9) * 0.2;
      }

      // Huyeshi Chamber ambient ring + surgical lamp flicker + Neural Crown extraction animation
      if (this.huyeshiAmbientRing) {
        this.huyeshiAmbientRing.rotation.z = elapsed * 0.45;
        this.huyeshiAmbientRing.rotation.x = Math.sin(elapsed * 0.5) * 0.22;
      }
      this.huyeshiSurgicalLight.intensity = 32 + Math.sin(elapsed * 11) * (this.huyeshiExtractionProgress > 0 ? 9 : 1.8);

      const spinRate = 0.45 + this.huyeshiExtractionProgress * 5.2;
      this.huyeshiCrown.rotation.y += dt * spinRate;

      const posAttr = this.huyeshiParticles.geometry.getAttribute('position') as THREE.BufferAttribute;
      const speedMult = 0.55 + this.huyeshiExtractionProgress * 2.8;
      const rotStep = dt * (0.35 + this.huyeshiExtractionProgress * 1.45);
      const cosR = Math.cos(rotStep);
      const sinR = Math.sin(rotStep);
      for (let i = 0; i < posAttr.count; i++) {
        let py = posAttr.getY(i) + this.huyeshiParticleSpeeds[i] * dt * speedMult;
        if (py > 5.8) py = 0.35;
        const px = posAttr.getX(i);
        const pz = posAttr.getZ(i);
        posAttr.setXYZ(i, px * cosR - pz * sinR, py, px * sinR + pz * cosR);
      }
      posAttr.needsUpdate = true;
    }

    // 4. Cyberspace (Blackwall, orbiting shards around Taisiya, pulsing data streams, twin portals)
    if (this.cyberspaceGroup.visible) {
      animateHologramRig(this.taisiyaRig, elapsed);
      this.cyberParticles.rotation.y = elapsed * 0.08;

      if (this.cyberBlackwallMat) {
        this.cyberBlackwallMat.emissiveIntensity = 1.2 + Math.sin(elapsed * 3.4) * 0.28;
      }

      for (let i = 0; i < this.cyberDataStreams.length; i++) {
        const st = this.cyberDataStreams[i];
        const mat = st.material as THREE.MeshBasicMaterial;
        mat.opacity = 0.16 + (Math.sin(elapsed * 3.2 + i * 0.8) * 0.5 + 0.5) * 0.26;
      }

      for (const s of this.cyberShards) {
        const a = elapsed * s.speed + s.phase;
        s.mesh.position.set(
          Math.cos(a) * s.radius,
          s.baseY + Math.sin(elapsed * 2.4 + s.phase) * s.bobAmp,
          -26 + Math.sin(a) * s.radius,
        );
        s.mesh.rotation.x = elapsed * 1.3 + s.phase;
        s.mesh.rotation.y = elapsed * 1.8;
      }

      for (let i = 0; i < this.cyberPortalRings.length; i++) {
        const ring = this.cyberPortalRings[i];
        ring.rotation.z = elapsed * (i % 2 === 0 ? 0.65 : -1.15);
      }
    }

    // 5. Taldykorgan Sunset Highway Epilogue
    if (this.taldykorganGroup.visible) {
      for (const p of this.taldyRoadPosts) {
        p.position.z += dt * 34;
        if (p.position.z > 28) p.position.z -= 16 * 18;
      }

      const dAttr = this.taldyDustParticles.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < dAttr.count; i++) {
        let pz = dAttr.getZ(i) + dt * 22;
        if (pz > 16) pz = -95;
        dAttr.setZ(i, pz);
      }
      dAttr.needsUpdate = true;

      if (this.taldyDashCharm) {
        this.taldyDashCharm.position.x = 0.12 + Math.sin(elapsed * 2.2) * 0.04;
        this.taldyDashCharm.rotation.y = elapsed * 1.1;
      }
      if (this.taldySteeringWheel) {
        this.taldySteeringWheel.rotation.z = Math.sin(elapsed * 0.85) * 0.06;
      }
    }
  }
}

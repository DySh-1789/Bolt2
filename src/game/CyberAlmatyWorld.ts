import * as THREE from 'three';
import { WORLD_HALF, WORLD_SIZE, type InteractablePoint, type Vec3 } from '../types/game';
import type { ChunkManager } from '../engine/ChunkManager';
import type { PhysicsWorld } from '../engine/Physics';
import type { ProceduralTextures } from '../engine/ProceduralTextures';
import {
  animateHologramRig,
  animateSeatedSamir,
  buildArtemModel,
  buildBodyguardModel,
  buildEgorModel,
  buildRipperdocModel,
  buildSamirHologram,
  buildSeatedSamirRooftop,
  type CharacterRig,
} from './CharacterModels';

export interface CityBlockRect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  color: string;
}

export interface RooftopCameraPose {
  position: Vec3;
  lookAt: Vec3;
  fov: number;
}

interface SteamPuffState {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  baseX: number;
  baseY: number;
  baseZ: number;
  phase: number;
  speed: number;
  driftX: number;
  driftZ: number;
  maxRise: number;
  baseScale: number;
}

interface FlyingAVState {
  group: THREE.Group;
  mode: 'line' | 'orbit';
  axis?: 'x' | 'z';
  lanePos: number;
  altitude: number;
  speed: number;
  dir: number;
  phase: number;
  centerX?: number;
  centerZ?: number;
  radiusX?: number;
  radiusZ?: number;
}

/**
 * Builds the 500x500m semi-open world of Cyber-Almaty streamed via ChunkManager (10x10 chunks of 50x50m):
 * - 5 distinct districts: Cyber-Tastak, Prospekt Abaya / Eblanhana (Anti-cafe Marum), Junkyard,
 *   Marakulin Tower Plaza, Lower Quarter & Kok-Tobe Overlook Rooftop.
 * - Always-visible landmark layer: Marakulin Tower upper spire, Kok-Tobe TV Tower, Zailiyskiy Alatau mountains,
 *   rooftop skyline vistas, flying AV traffic, and 3D cyber-rain.
 */
export class CyberAlmatyWorld {
  readonly interactables: InteractablePoint[] = [];
  readonly minimapBuildings: CityBlockRect[] = [];
  readonly rooftopPos: Vec3 = { x: 165, y: 36, z: 165 };
  readonly marumPos: Vec3 = { x: -46, y: 0, z: -40 };
  readonly junkyardWakePos: Vec3 = { x: -165, y: 0, z: 165 };
  readonly motelRoomPos: Vec3 = { x: -165, y: 0, z: -162 };
  readonly motelSinkPos: Vec3 = { x: -172.6, y: 0.25, z: -173.2 };
  readonly towerEntrancePos: Vec3 = { x: 170, y: 0, z: -136 };

  private samirRooftopRig!: CharacterRig;
  private samirJunkyardRig!: CharacterRig;
  private egorMarumRig!: CharacterRig;
  private motelArtemRig!: CharacterRig;
  private motelBodyguardRig!: CharacterRig;
  private motelBodyguardChoking = false;
  private artemCorpseGroup = new THREE.Group();

  private hologramSigns: Array<{ mesh: THREE.Mesh; baseY: number }> = [];
  private steamPuffs: SteamPuffState[] = [];
  private motelNeonSignMat?: THREE.MeshStandardMaterial;
  private motelBathTubeMat?: THREE.MeshStandardMaterial;
  private motelTvMat?: THREE.MeshStandardMaterial;
  private motelBedNeonMat?: THREE.MeshStandardMaterial;
  private motelLockDoorMesh: THREE.Group | null = null;
  private gigPropMats = new Map<string, { beaconMat: THREE.MeshStandardMaterial; propMesh?: THREE.Object3D }>();
  private avFleet: FlyingAVState[] = [];
  private blinkingBeacons: THREE.MeshStandardMaterial[] = [];
  private localTextures: THREE.CanvasTexture[] = [];

  // Lightweight 3D Cyber-Rain state
  private rainLines!: THREE.LineSegments;
  private rainPositions!: Float32Array;
  private rainOffsets!: Float32Array;
  private rainSpeeds!: Float32Array;
  private rainCount = 540;
  private lastElapsed = 0;

  private chunks: ChunkManager;
  private physics: PhysicsWorld;
  private textures: ProceduralTextures;

  constructor(chunks: ChunkManager, physics: PhysicsWorld, textures: ProceduralTextures) {
    this.chunks = chunks;
    this.physics = physics;
    this.textures = textures;

    this.buildGlobalGroundAndRoads();
    this.buildSkylineLandmarks();
    this.buildMarumAntiCafe();
    this.buildArtemMotel();
    this.buildJunkyardDistrict();
    this.buildMarakulinTowerPlaza();
    this.buildKokTobeOverlookBuilding();
    this.buildOpenWorldGigProps();
    this.buildProceduralCityBlocks();
    this.buildStreetFurniture();
    this.buildFlyingAVTraffic();
    this.buildCyberRain();
    this.registerInteractables();
  }

  /**
   * Registers a pooled, zero-recompilation dynamic light anchor with ChunkManager
   * instead of creating per-chunk PointLights that trigger WebGL shader stalls.
   */
  private registerLightAnchor(
    x: number,
    y: number,
    z: number,
    colorHex: number,
    intensity: number,
    distance: number,
  ): void {
    const chunkApi = this.chunks as unknown as {
      registerLightAnchor?: (
        ax: number,
        ay: number,
        az: number,
        color: number,
        int: number,
        dist: number,
      ) => void;
    };
    if (typeof chunkApi.registerLightAnchor === 'function') {
      chunkApi.registerLightAnchor(x, y, z, colorHex, intensity, distance);
    }
  }

  // ---------------------------------------------------------------------------
  // Bolt 1 Visual Material & Procedural Canvas Helpers
  // ---------------------------------------------------------------------------

  /**
   * Bolt 1 neon sign material standard: Standard PBR with map + emissiveMap + controlled glow.
   */
  private makeSignMaterial(texture: THREE.Texture, intensity = 0.78): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
      map: texture,
      emissiveMap: texture,
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity: intensity,
      roughness: 0.42,
      metalness: 0.16,
    });
  }

  /**
   * Glowing architectural neon trim strip material (emissiveIntensity 1.5).
   */
  private makeNeonStripMaterial(colorHex: number | string, intensity = 1.5): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
      color: colorHex,
      emissive: colorHex,
      emissiveIntensity: intensity,
      roughness: 0.3,
      metalness: 0.25,
    });
  }

  private createCanvasTex(
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

  private createWeatheredParapetTexture(): THREE.CanvasTexture {
    return this.createCanvasTex(1024, 256, (ctx, w, h) => {
      // Dark weathered night concrete base
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, '#2a333e');
      grad.addColorStop(0.2, '#1c232c');
      grad.addColorStop(1, '#12171f');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      // Concrete slab seams & rain grime streaks
      ctx.strokeStyle = 'rgba(8, 12, 18, 0.72)';
      ctx.lineWidth = 5;
      for (let x = 128; x < w; x += 256) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let i = 0; i < 42; i++) {
        const sx = (i * 73) % w;
        const sh = 40 + ((i * 47) % 160);
        ctx.fillStyle = i % 3 === 0 ? 'rgba(0,0,0,0.22)' : 'rgba(130, 170, 195, 0.06)';
        ctx.fillRect(sx, 0, 10 + (i % 14), sh);
      }

      // Subtle gritty cyan-teal & pale street graffiti tags along lower-right parapet (matching IMG-20261123-WA0011.jpg)
      ctx.save();
      ctx.globalAlpha = 0.34;
      ctx.strokeStyle = '#3ad8e8';
      ctx.lineWidth = 4;
      ctx.font = 'italic 900 44px "Impact", sans-serif';
      ctx.strokeText('ALMATY//77', 610, 148);
      ctx.fillStyle = '#257c94';
      ctx.fillText('SAMIR', 680, 198);
      ctx.strokeStyle = '#6da8c4';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(110, 155);
      ctx.bezierCurveTo(160, 110, 210, 185, 275, 130);
      ctx.bezierCurveTo(310, 105, 340, 170, 390, 140);
      ctx.stroke();
      ctx.restore();

      // Top concrete lip bevel shadow
      ctx.fillStyle = 'rgba(200, 230, 255, 0.14)';
      ctx.fillRect(0, 0, w, 10);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.fillRect(0, 10, w, 14);
    });
  }

  private createSecureYourSoulTexture(): THREE.CanvasTexture {
    return this.createCanvasTex(512, 512, (ctx, w, h) => {
      // Dark monolithic corporate steel-teal facade panel
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, '#0a1622');
      grad.addColorStop(0.5, '#0d1f2d');
      grad.addColorStop(1, '#08121b');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      // Subtle architectural vertical seams
      ctx.strokeStyle = 'rgba(0, 210, 255, 0.16)';
      ctx.lineWidth = 3;
      ctx.strokeRect(18, 18, w - 36, h - 36);

      // Small illuminated white corporate emblem near top
      ctx.fillStyle = '#e8f7ff';
      ctx.fillRect(w / 2 - 22, 68, 44, 54);
      ctx.fillStyle = '#0a1622';
      ctx.fillRect(w / 2 - 12, 80, 24, 14);
      ctx.fillRect(w / 2 - 6, 100, 12, 16);

      // Iconic glowing white "SECURE YOUR SOUL" + "ХУЕШИ" typography
      ctx.save();
      ctx.textAlign = 'center';
      ctx.shadowColor = '#8ceeff';
      ctx.shadowBlur = 18;
      ctx.fillStyle = '#ffffff';
      ctx.font = '900 54px "Segoe UI", "Arial Black", sans-serif';
      ctx.fillText('SECURE', w / 2, 232);
      ctx.fillText('YOUR SOUL', w / 2, 294);
      ctx.restore();

      // Divider + ХУЕШИ sub-label
      ctx.fillStyle = '#00f0ff';
      ctx.fillRect(96, 326, w - 192, 4);

      ctx.save();
      ctx.textAlign = 'center';
      ctx.shadowColor = '#00f0ff';
      ctx.shadowBlur = 14;
      ctx.fillStyle = '#8ef6ff';
      ctx.font = '700 32px "Consolas", monospace';
      ctx.fillText('// ХУЕШИ //', w / 2, 376);
      ctx.fillStyle = 'rgba(180, 235, 255, 0.65)';
      ctx.font = '600 18px "Consolas", monospace';
      ctx.fillText('SOULKILLER ENGRAM VAULT', w / 2, 418);
      ctx.restore();
    });
  }

  private createMarakulinCrownTexture(): THREE.CanvasTexture {
    return this.createCanvasTex(1024, 384, (ctx, w, h) => {
      ctx.fillStyle = '#0a121d';
      ctx.fillRect(0, 0, w, h);

      // White glowing circular corporate emblem (inspired by Arasaka rooftop emblem in IMG-20261123-WA0011.jpg)
      ctx.save();
      ctx.strokeStyle = '#ffffff';
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = '#bfefff';
      ctx.shadowBlur = 26;
      ctx.lineWidth = 12;
      ctx.beginPath();
      ctx.arc(w / 2, 118, 72, 0, Math.PI * 2);
      ctx.stroke();

      // Inner stylized triad symbol
      ctx.beginPath();
      ctx.moveTo(w / 2, 66);
      ctx.lineTo(w / 2, 174);
      ctx.moveTo(w / 2, 120);
      ctx.lineTo(w / 2 - 42, 92);
      ctx.moveTo(w / 2, 120);
      ctx.lineTo(w / 2 + 42, 92);
      ctx.stroke();
      for (const [cx, cy] of [
        [w / 2, 68],
        [w / 2 - 44, 92],
        [w / 2 + 44, 92],
      ]) {
        ctx.beginPath();
        ctx.arc(cx, cy, 12, 0, Math.PI * 2);
        ctx.fill();
      }

      // Bold glowing white МАРАКУЛИН lettering beneath emblem
      ctx.textAlign = 'center';
      ctx.font = '900 108px "Segoe UI", "Arial Black", sans-serif';
      ctx.fillText('МАРАКУЛИН', w / 2, 316);
      ctx.restore();
    });
  }

  private createHoloAdTexture(
    headline: string,
    sub: string,
    bgA: string,
    bgB: string,
    accent: string,
  ): THREE.CanvasTexture {
    return this.createCanvasTex(512, 256, (ctx, w, h) => {
      const grad = ctx.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, bgA);
      grad.addColorStop(1, bgB);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      // Stylized cyber silhouette / graphic wave on left
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      ctx.beginPath();
      ctx.arc(110, 128, 72, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#090c18';
      ctx.beginPath();
      ctx.arc(110, 108, 34, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(72, 146, 76, 84);

      // Scanlines
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      for (let y = 0; y < h; y += 6) {
        ctx.fillRect(0, y, w, 2);
      }

      // Bold ad typography
      ctx.save();
      ctx.shadowColor = accent;
      ctx.shadowBlur = 18;
      ctx.fillStyle = '#ffffff';
      ctx.font = '900 46px "Impact", "Arial Black", sans-serif';
      ctx.fillText(headline, 206, 118);
      ctx.fillStyle = accent;
      ctx.font = '700 24px "Consolas", monospace';
      ctx.fillText(sub, 208, 168);
      ctx.restore();

      ctx.strokeStyle = accent;
      ctx.lineWidth = 6;
      ctx.strokeRect(8, 8, w - 16, h - 16);
    });
  }

  private createSteamPuffTexture(): THREE.CanvasTexture {
    return this.createCanvasTex(128, 128, (ctx, w, h) => {
      const grad = ctx.createRadialGradient(w / 2, h / 2, 6, w / 2, h / 2, w / 2);
      grad.addColorStop(0, 'rgba(255, 190, 130, 0.72)');
      grad.addColorStop(0.35, 'rgba(255, 108, 52, 0.42)');
      grad.addColorStop(0.7, 'rgba(185, 65, 38, 0.16)');
      grad.addColorStop(1, 'rgba(90, 30, 20, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    });
  }

  private createMotelWallpaperTexture(repeatX = 3, repeatY = 1): THREE.CanvasTexture {
    return this.createCanvasTex(
      512,
      512,
      (ctx, w, h) => {
        // Aged seedy burgundy-ochre retro motel plaster & peeling wallpaper
        const grad = ctx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, '#2a161c');
        grad.addColorStop(0.55, '#3b1c22');
        grad.addColorStop(0.74, '#241418');
        grad.addColorStop(1, '#1a1114');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);

        // Faded vertical vintage wallpaper stripes
        for (let x = 0; x < w; x += 32) {
          ctx.fillStyle = x % 64 === 0 ? 'rgba(140, 56, 68, 0.18)' : 'rgba(18, 8, 10, 0.22)';
          ctx.fillRect(x, 0, 14, h * 0.72);
        }

        // Scuffed dark wood-panel wainscot along lower third + trim rail
        ctx.fillStyle = '#221512';
        ctx.fillRect(0, h * 0.72, w, h * 0.28);
        ctx.fillStyle = '#472a20';
        ctx.fillRect(0, h * 0.71, w, 10);
        for (let x = 0; x < w; x += 64) {
          ctx.fillStyle = 'rgba(0,0,0,0.34)';
          ctx.fillRect(x, h * 0.72, 4, h * 0.28);
        }

        // Damp water stains & peeling plaster patches
        for (let i = 0; i < 16; i++) {
          const sx = (i * 97 + 24) % w;
          const sy = (i * 53 + 12) % Math.floor(h * 0.65);
          ctx.fillStyle = i % 3 === 0 ? 'rgba(10, 8, 12, 0.32)' : 'rgba(130, 110, 92, 0.14)';
          ctx.fillRect(sx, sy, 28 + (i % 4) * 14, 42 + (i % 5) * 18);
        }
      },
      repeatX,
      repeatY,
    );
  }

  private createMotelFloorTexture(repeatX = 5, repeatY = 5): THREE.CanvasTexture {
    return this.createCanvasTex(
      256,
      256,
      (ctx, w, h) => {
        // Worn stained dark maroon-brown cheap motel carpet
        ctx.fillStyle = '#211418';
        ctx.fillRect(0, 0, w, h);

        // Faded retro geometric motel carpet diamond weave
        ctx.strokeStyle = 'rgba(130, 52, 62, 0.28)';
        ctx.lineWidth = 3;
        for (let y = 0; y < h; y += 32) {
          for (let x = 0; x < w; x += 32) {
            ctx.beginPath();
            ctx.moveTo(x + 16, y + 3);
            ctx.lineTo(x + 29, y + 16);
            ctx.lineTo(x + 16, y + 29);
            ctx.lineTo(x + 3, y + 16);
            ctx.closePath();
            ctx.stroke();
          }
        }

        // Scuff grime & cigarette burn marks
        for (let i = 0; i < 24; i++) {
          ctx.fillStyle = i % 2 === 0 ? 'rgba(8, 6, 8, 0.35)' : 'rgba(90, 60, 44, 0.14)';
          ctx.beginPath();
          ctx.arc((i * 47) % w, (i * 83) % h, 4 + (i % 9), 0, Math.PI * 2);
          ctx.fill();
        }
      },
      repeatX,
      repeatY,
    );
  }

  private createBathroomTileTexture(repeatX = 4, repeatY = 4): THREE.CanvasTexture {
    return this.createCanvasTex(
      256,
      256,
      (ctx, w, h) => {
        // Cold dirty off-white / pale-cyan porcelain bathroom tiles
        ctx.fillStyle = '#aebdc0';
        ctx.fillRect(0, 0, w, h);

        const step = 32;
        for (let y = 0; y < h; y += step) {
          for (let x = 0; x < w; x += step) {
            const shade = ((x * 13 + y * 29) % 5) * 6;
            ctx.fillStyle = `rgb(${182 - shade}, ${196 - shade}, ${198 - shade})`;
            ctx.fillRect(x + 2, y + 2, step - 4, step - 4);
          }
        }

        // Dark mildew grout lines
        ctx.strokeStyle = '#38464c';
        ctx.lineWidth = 3;
        for (let i = 0; i <= w; i += step) {
          ctx.beginPath();
          ctx.moveTo(i, 0);
          ctx.lineTo(i, h);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(0, i);
          ctx.lineTo(w, i);
          ctx.stroke();
        }

        // Subtle rust / water grime streaks
        for (let i = 0; i < 10; i++) {
          ctx.fillStyle = i % 2 === 0 ? 'rgba(65, 52, 40, 0.18)' : 'rgba(35, 62, 72, 0.15)';
          ctx.fillRect((i * 59) % w, (i * 37) % h, 14 + (i % 12), 28 + (i % 24));
        }
      },
      repeatX,
      repeatY,
    );
  }

  private createMotelTvTexture(): THREE.CanvasTexture {
    return this.createCanvasTex(512, 256, (ctx, w, h) => {
      // Flickering CRT late-night news static broadcast
      const grad = ctx.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, '#071b2e');
      grad.addColorStop(0.55, '#14263b');
      grad.addColorStop(1, '#260b1a');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      // CRT scanlines
      ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
      for (let y = 0; y < h; y += 5) {
        ctx.fillRect(0, y, w, 2);
      }

      // Breaking news red bar
      ctx.fillStyle = '#ff003c';
      ctx.fillRect(16, 18, w - 32, 34);
      ctx.fillStyle = '#ffffff';
      ctx.font = '900 22px "Consolas", monospace';
      ctx.fillText('LIVE // ALMATY-54 NEWS — РОЗЫСК', 28, 42);

      // Main static headline
      ctx.fillStyle = '#00f0ff';
      ctx.font = '900 32px "Segoe UI", "Arial Black", sans-serif';
      ctx.fillText('УБИЙСТВО ЛЬВА МАРАКУЛИНА', 24, 114);
      ctx.fillStyle = '#fcee0a';
      ctx.font = '700 22px "Consolas", monospace';
      ctx.fillText('ПОДОЗРЕВАЕМЫЕ СКРЫЛИСЬ В ТАСТАКЕ', 24, 158);

      // Lower ticker bar
      ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
      ctx.fillRect(16, h - 54, w - 32, 34);
      ctx.fillStyle = '#ff6a8a';
      ctx.font = '700 18px "Consolas", monospace';
      ctx.fillText('КОРПОРАЦИЯ ОБЪЯВИЛА НАГРАДУ: 500 000 ₸ // НЕ ВЕРЬТЕ НИКОМУ', 26, h - 31);
    });
  }

  // ---------------------------------------------------------------------------
  // Ground, Roads & Wet Reflective Puddles
  // ---------------------------------------------------------------------------

  private buildGlobalGroundAndRoads(): void {
    // Base 500x500 rain-damp asphalt ground plane in landmark layer so horizon never shows holes
    const groundMat = new THREE.MeshStandardMaterial({
      map: this.textures.getCyberAsphalt(36, 36),
      roughness: 0.56,
      metalness: 0.34,
    });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(WORLD_SIZE + 40, WORLD_SIZE + 40), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    this.chunks.addLandmark(ground);

    // Outer world boundary colliders (always active so player/taxi stays in 500x500m city)
    const wallH = 26;
    this.physics.addBox('city_bound_n', 0, wallH / 2, -WORLD_HALF, WORLD_SIZE + 4, wallH, 4, {
      blocksSight: false,
    });
    this.physics.addBox('city_bound_s', 0, wallH / 2, WORLD_HALF, WORLD_SIZE + 4, wallH, 4, {
      blocksSight: false,
    });
    this.physics.addBox('city_bound_w', -WORLD_HALF, wallH / 2, 0, 4, wallH, WORLD_SIZE + 4, {
      blocksSight: false,
    });
    this.physics.addBox('city_bound_e', WORLD_HALF, wallH / 2, 0, 4, wallH, WORLD_SIZE + 4, {
      blocksSight: false,
    });

    // Global ambient lighting for rain-slick night-neon Cyber-Almaty
    const hemi = new THREE.HemisphereLight(0x5278b8, 0x1c1028, 1.05);
    this.chunks.addLandmark(hemi);
    const moonDir = new THREE.DirectionalLight(0x88b8ff, 0.78);
    moonDir.castShadow = false;
    moonDir.position.set(120, 220, 180);
    this.chunks.addLandmark(moonDir);

    // Road strips (Prospekt Abaya Z=0, Seifullin Ave X=0, Secondary X=±115, Z=±115, Outer Ring ±220)
    const roadMatEW = new THREE.MeshStandardMaterial({
      map: this.textures.getRoadSurface(1, 22),
      roughness: 0.34,
      metalness: 0.48,
    });
    const roadMatNS = new THREE.MeshStandardMaterial({
      map: this.textures.getRoadSurface(1, 22),
      roughness: 0.34,
      metalness: 0.48,
    });

    const addRoadNS = (x: number, width: number, len = 460) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(width, len), roadMatNS);
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, 0.02, 0);
      this.chunks.addLandmark(m);
    };
    const addRoadEW = (z: number, width: number, len = 460) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(width, len), roadMatEW);
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = Math.PI / 2;
      m.position.set(0, 0.03, z);
      this.chunks.addLandmark(m);
    };

    // Primary cross boulevards
    addRoadEW(0, 24, 460); // Prospekt Abaya
    addRoadNS(0, 24, 460); // Prospekt Dostyk / Seifullin
    // Secondary avenues
    addRoadEW(-115, 16, 440);
    addRoadEW(115, 16, 440);
    addRoadNS(-115, 16, 440);
    addRoadNS(115, 16, 440);
    // Outer ring boulevard
    addRoadEW(-220, 18, 460);
    addRoadEW(220, 18, 460);
    addRoadNS(-220, 18, 460);
    addRoadNS(220, 18, 460);

    // Wet reflective neon puddle sheen patches along Prospekt Abaya & Seifullin Ave
    const cyanPuddleMat = new THREE.MeshStandardMaterial({
      color: 0x163854,
      emissive: 0x00a8cc,
      emissiveIntensity: 0.32,
      roughness: 0.07,
      metalness: 0.92,
      transparent: true,
      opacity: 0.56,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });
    const pinkPuddleMat = new THREE.MeshStandardMaterial({
      color: 0x3b1234,
      emissive: 0xff2a6d,
      emissiveIntensity: 0.28,
      roughness: 0.07,
      metalness: 0.92,
      transparent: true,
      opacity: 0.52,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });

    for (let px = -190; px <= 190; px += 28) {
      if (Math.abs(px) < 16) continue;
      const side = px % 56 === 0 ? -5.8 : 5.8;
      const puddle = new THREE.Mesh(
        new THREE.CircleGeometry(3.2 + (Math.abs(px) % 3) * 0.7, 14),
        side > 0 ? cyanPuddleMat : pinkPuddleMat,
      );
      puddle.rotation.x = -Math.PI / 2;
      puddle.scale.set(1.85, 0.72, 1);
      puddle.position.set(px, 0.045, side);
      this.chunks.addToChunk(px, side, puddle);

      // Matching wet sheen along Seifullin Ave
      const puddleNS = new THREE.Mesh(
        new THREE.CircleGeometry(2.9 + (Math.abs(px) % 2) * 0.8, 12),
        side > 0 ? pinkPuddleMat : cyanPuddleMat,
      );
      puddleNS.rotation.x = -Math.PI / 2;
      puddleNS.scale.set(0.75, 1.8, 1);
      puddleNS.position.set(side, 0.045, px);
      this.chunks.addToChunk(side, px, puddleNS);
    }
  }

  private buildSkylineLandmarks(): void {
    // 1. Zailiyskiy Alatau snowy mountain ridge on South horizon (Z = +390)
    const mtnMat = new THREE.MeshBasicMaterial({
      map: this.textures.getAlmatyMountainSkyline(),
      transparent: true,
      opacity: 0.96,
      side: THREE.DoubleSide,
      fog: false,
    });
    const mtnWall = new THREE.Mesh(new THREE.PlaneGeometry(1100, 340), mtnMat);
    mtnWall.position.set(0, 130, 390);
    mtnWall.rotation.y = Math.PI;
    this.chunks.addLandmark(mtnWall);

    // 3D stylized low-poly Alatau peaks in front of backdrop for real parallax
    const peakMat = new THREE.MeshStandardMaterial({
      color: 0x131d38,
      emissive: 0x0a1c3b,
      emissiveIntensity: 0.35,
      roughness: 0.85,
      metalness: 0.15,
    });
    const peakCoords: Array<[number, number, number, number]> = [
      [-260, 340, 135, 145],
      [-110, 355, 160, 185],
      [60, 365, 175, 210],
      [230, 345, 145, 165],
    ];
    for (const [px, pz, r, h] of peakCoords) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(r, h, 5), peakMat);
      cone.position.set(px, h * 0.45, pz);
      this.chunks.addLandmark(cone);
    }

    // 2. Iconic glowing Kok-Tobe TV Tower (South-East hill behind the city)
    const kokTobe = new THREE.Group();
    kokTobe.position.set(95, 0, 305);
    const towerBase = new THREE.Mesh(
      new THREE.CylinderGeometry(3.2, 8.5, 120, 8),
      new THREE.MeshStandardMaterial({ color: 0x1c2742, metalness: 0.7, roughness: 0.35 }),
    );
    towerBase.position.y = 60;
    kokTobe.add(towerBase);

    const obsDeck = new THREE.Mesh(
      new THREE.CylinderGeometry(11, 9, 14, 10),
      this.makeNeonStripMaterial(0x00f0ff, 1.5),
    );
    obsDeck.position.y = 122;
    kokTobe.add(obsDeck);

    const spire = new THREE.Mesh(
      new THREE.CylinderGeometry(0.6, 3, 95, 8),
      this.makeNeonStripMaterial(0xff2a6d, 1.5),
    );
    spire.position.y = 175;
    kokTobe.add(spire);
    this.chunks.addLandmark(kokTobe);

    // 3. Distant horizon ring wall of mega-city silhouettes on North
    const skyMat = new THREE.MeshBasicMaterial({
      map: this.textures.getAlmatyMountainSkyline(),
      opacity: 0.5,
      transparent: true,
      side: THREE.DoubleSide,
      fog: false,
    });
    const northHorizon = new THREE.Mesh(new THREE.PlaneGeometry(1100, 260), skyMat);
    northHorizon.position.set(0, 100, -390);
    this.chunks.addLandmark(northHorizon);
  }

  // ---------------------------------------------------------------------------
  // Anti-cafe "Marum" (X=-46, Z=-40) — Upgraded Cyberpunk Hub
  // ---------------------------------------------------------------------------

  private buildMarumAntiCafe(): void {
    const cx = -46;
    const cz = -40;
    const group = new THREE.Group();

    const wallMat = new THREE.MeshStandardMaterial({
      map: this.textures.getWallPanel('#00f0ff', 2, 1),
      roughness: 0.44,
      metalness: 0.52,
    });
    const floorMat = new THREE.MeshStandardMaterial({
      map: this.textures.getFloorTile('#fcee0a', 4, 4),
      roughness: 0.26,
      metalness: 0.48,
    });
    const trussMat = new THREE.MeshStandardMaterial({ color: 0x151c2b, roughness: 0.45, metalness: 0.78 });
    const cyanNeon = this.makeNeonStripMaterial(0x00f0ff, 1.5);
    const warmNeon = this.makeNeonStripMaterial(0xffb833, 1.5);
    const pinkNeon = this.makeNeonStripMaterial(0xff2a6d, 1.5);
    const emeraldNeon = this.makeNeonStripMaterial(0x00ffaa, 1.5);

    // Floor & roof
    const floor = new THREE.Mesh(new THREE.BoxGeometry(24, 0.3, 22), floorMat);
    floor.position.set(cx, 0.12, cz);
    group.add(floor);

    const roof = new THREE.Mesh(new THREE.BoxGeometry(25, 1.2, 23), wallMat);
    roof.position.set(cx, 7.2, cz);
    group.add(roof);
    this.chunks.addChunkCollider(this.physics, 'marum_roof_col', cx, 7.2, cz, 25, 1.2, 23);

    // Warm neon ceiling trusses spanning the anti-cafe lounge
    for (let tz = -6.5; tz <= 6.5; tz += 4.3) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(22.4, 0.28, 0.35), trussMat);
      beam.position.set(cx, 6.45, cz + tz);
      group.add(beam);

      const tube = new THREE.Mesh(
        new THREE.BoxGeometry(19.5, 0.1, 0.12),
        Math.abs(tz) < 3 ? warmNeon : cyanNeon,
      );
      tube.position.set(cx, 6.26, cz + tz);
      group.add(tube);
    }

    // Back, left, right walls (open front facing +Z toward Prospekt Abaya)
    const addWall = (id: string, wx: number, wz: number, sx: number, sz: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, 7, sz), wallMat);
      m.position.set(wx, 3.5, wz);
      group.add(m);
      this.chunks.addChunkCollider(this.physics, id, wx, 3.5, wz, sx, 7, sz);
    };
    addWall('marum_back', cx, cz - 10.6, 24, 0.8);
    addWall('marum_left', cx - 11.6, cz, 0.8, 22);
    addWall('marum_right', cx + 11.6, cz, 0.8, 22);
    addWall('marum_front_l', cx - 8.2, cz + 10.6, 7, 0.8);
    addWall('marum_front_r', cx + 8.2, cz + 10.6, 7, 0.8);

    // Glowing architectural facade strips framing entrance
    for (const sx of [-4.6, 4.6]) {
      const doorStrip = new THREE.Mesh(new THREE.BoxGeometry(0.18, 6.2, 0.24), cyanNeon);
      doorStrip.position.set(cx + sx, 3.2, cz + 11.05);
      group.add(doorStrip);
    }

    // Giant neon sign above entrance (Bolt 1 MeshStandardMaterial standard)
    const signFrame = new THREE.Mesh(new THREE.BoxGeometry(18.6, 4.6, 0.35), trussMat);
    signFrame.position.set(cx, 9.8, cz + 11.0);
    group.add(signFrame);

    const marumSignTex = this.textures.getNeonSign(
      'АНТИКАФЕ «МАРУМ»',
      'ЛЕГЕНДЫ ЕБЛАНХАНЫ // РИПЕРДОК & ЗАКАЗЫ',
      '#00f0ff',
      '#fcee0a',
    );
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(18, 4.2), this.makeSignMaterial(marumSignTex, 0.78));
    sign.position.set(cx, 9.8, cz + 11.24);
    group.add(sign);
    this.hologramSigns.push({ mesh: sign, baseY: 9.8 });

    // Bar counter with neon under-glow & glowing back-shelf bottles
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(8.6, 1.15, 1.8),
      new THREE.MeshStandardMaterial({ color: 0x1b243b, metalness: 0.65, roughness: 0.32 }),
    );
    bar.position.set(cx, 0.68, cz - 7.2);
    group.add(bar);
    this.chunks.addChunkCollider(this.physics, 'marum_bar', cx, 0.68, cz - 7.2, 8.6, 1.15, 1.8);

    const barLip = new THREE.Mesh(new THREE.BoxGeometry(8.7, 0.1, 0.14), warmNeon);
    barLip.position.set(cx, 1.24, cz - 6.26);
    group.add(barLip);

    // Back bar shelves + rows of glowing bottles
    const shelfMat = new THREE.MeshStandardMaterial({ color: 0x121826, metalness: 0.7, roughness: 0.35 });
    const bottleMats = [cyanNeon, warmNeon, pinkNeon, emeraldNeon];
    for (let row = 0; row < 2; row++) {
      const sy = 1.65 + row * 0.95;
      const shelf = new THREE.Mesh(new THREE.BoxGeometry(7.6, 0.1, 0.55), shelfMat);
      shelf.position.set(cx, sy, cz - 9.8);
      group.add(shelf);
      for (let b = 0; b < 11; b++) {
        const bx = cx - 3.3 + b * 0.66;
        const bottle = new THREE.Mesh(
          new THREE.CylinderGeometry(0.065, 0.08, 0.42 + (b % 3) * 0.08, 8),
          bottleMats[(b + row * 2) % bottleMats.length],
        );
        bottle.position.set(bx, sy + 0.28, cz - 9.75);
        group.add(bottle);
      }
    }

    // Cozy cyberpunk lounge booths (East & West flanks near front, leaving center corridor clear)
    const sofaMat = new THREE.MeshStandardMaterial({ color: 0x261530, roughness: 0.6, metalness: 0.2 });
    const tableMat = new THREE.MeshStandardMaterial({ color: 0x121b2b, roughness: 0.25, metalness: 0.75 });
    for (const [bx, bz, rot] of [
      [cx + 8.6, cz + 4.2, -Math.PI / 2],
      [cx - 8.6, cz + 4.2, Math.PI / 2],
    ]) {
      const booth = new THREE.Group();
      const seat = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.55, 1.15), sofaMat);
      seat.position.set(0, 0.4, 0);
      booth.add(seat);
      const back = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.15, 0.35), sofaMat);
      back.position.set(0, 0.85, -0.45);
      booth.add(back);
      const trim = new THREE.Mesh(new THREE.BoxGeometry(3.42, 0.08, 0.1), pinkNeon);
      trim.position.set(0, 1.44, -0.45);
      booth.add(trim);
      const table = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.65, 1.0), tableMat);
      table.position.set(0, 0.45, 1.35);
      booth.add(table);
      const tableTopGlow = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.05, 0.8), cyanNeon);
      tableTopGlow.position.set(0, 0.79, 1.35);
      booth.add(tableTopGlow);
      booth.position.set(bx, 0.15, bz);
      booth.rotation.y = rot;
      group.add(booth);
    }
    this.chunks.addChunkCollider(this.physics, 'marum_booth_e', cx + 7.95, 0.7, cz + 4.2, 2.5, 1.4, 3.4, {
      blocksSight: false,
    });
    this.chunks.addChunkCollider(this.physics, 'marum_booth_w', cx - 7.95, 0.7, cz + 4.2, 2.5, 1.4, 3.4, {
      blocksSight: false,
    });

    // Ripperdoc surgical bay with articulated overhead surgical lamp & spotlight
    const ripperChair = new THREE.Mesh(
      new THREE.BoxGeometry(2.2, 1.2, 2.8),
      new THREE.MeshStandardMaterial({
        color: 0x112b38,
        emissive: 0x00ffaa,
        emissiveIntensity: 0.42,
        roughness: 0.32,
        metalness: 0.65,
      }),
    );
    ripperChair.position.set(cx - 7.5, 0.7, cz - 4);
    group.add(ripperChair);
    this.chunks.addChunkCollider(this.physics, 'marum_ripper_chair', cx - 7.5, 0.7, cz - 4, 2.2, 1.2, 2.8, {
      blocksSight: false,
    });

    const lampStem = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 2.8, 8), trussMat);
    lampStem.position.set(cx - 7.5, 5.1, cz - 4);
    group.add(lampStem);
    const lampRing = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.08, 8, 20), emeraldNeon);
    lampRing.rotation.x = Math.PI / 2;
    lampRing.position.set(cx - 7.5, 3.65, cz - 4);
    group.add(lampRing);

    this.registerLightAnchor(cx - 7.5, 3.4, cz - 4, 0x66ffdd, 4.2, 14);

    const ripperNpc = buildRipperdocModel();
    ripperNpc.group.position.set(cx - 5.8, 0.25, cz - 4);
    ripperNpc.group.rotation.y = Math.PI * 0.5;
    group.add(ripperNpc.group);

    // Gig terminal
    const gigTerm = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 2.1, 0.8),
      new THREE.MeshStandardMaterial({
        color: 0x101828,
        emissive: 0xfcee0a,
        emissiveIntensity: 0.72,
        roughness: 0.35,
        metalness: 0.6,
      }),
    );
    gigTerm.position.set(cx + 7.2, 1.15, cz - 3);
    group.add(gigTerm);
    this.chunks.addChunkCollider(this.physics, 'marum_gig_term', cx + 7.2, 1.15, cz - 3, 1.4, 2.1, 0.8, {
      blocksSight: false,
    });

    // Egor model (hidden until Marum epilogue)
    this.egorMarumRig = buildEgorModel();
    this.egorMarumRig.group.position.set(cx, 0.25, cz + 1.5);
    this.egorMarumRig.group.rotation.y = Math.PI;
    this.egorMarumRig.group.visible = false;
    group.add(this.egorMarumRig.group);

    // Pooled light anchors for Marum cyberpunk lounge & bar (zero WebGL shader recompiles)
    this.registerLightAnchor(cx, 5.6, cz + 1, 0x00e5ff, 4.4, 28);
    this.registerLightAnchor(cx, 4.4, cz - 7.2, 0xffaa33, 3.4, 18);

    this.chunks.addToChunk(cx, cz, group);
    this.minimapBuildings.push({
      minX: cx - 12,
      maxX: cx + 12,
      minZ: cz - 11,
      maxZ: cz + 11,
      color: '#00f0ff',
    });
  }

  // ---------------------------------------------------------------------------
  // Seedy Cyber-Tastak Motel Room 204 (X=-165, Z=-165) — Act 4 Betrayal
  // ---------------------------------------------------------------------------

  private buildArtemMotel(): void {
    const cx = -165;
    const cz = -165;
    const wallH = 5.4;
    const group = new THREE.Group();

    const exteriorMat = new THREE.MeshStandardMaterial({
      map: this.textures.getWallPanel('#ff2a6d', 2, 1),
      roughness: 0.64,
      metalness: 0.38,
    });
    const wallpaperMat = new THREE.MeshStandardMaterial({
      map: this.createMotelWallpaperTexture(3, 1),
      roughness: 0.78,
      metalness: 0.12,
    });
    const carpetMat = new THREE.MeshStandardMaterial({
      map: this.createMotelFloorTexture(5, 5),
      roughness: 0.88,
      metalness: 0.08,
    });
    const bathTileFloorMat = new THREE.MeshStandardMaterial({
      map: this.createBathroomTileTexture(4, 4),
      roughness: 0.34,
      metalness: 0.18,
    });
    const bathTileWallMat = new THREE.MeshStandardMaterial({
      map: this.createBathroomTileTexture(3, 2),
      roughness: 0.36,
      metalness: 0.16,
    });
    const ceilingMat = new THREE.MeshStandardMaterial({ color: 0x1a151b, roughness: 0.9, metalness: 0.1 });
    const darkSteel = new THREE.MeshStandardMaterial({ color: 0x171b24, roughness: 0.48, metalness: 0.72 });
    const scuffedWood = new THREE.MeshStandardMaterial({ color: 0x2f1c14, roughness: 0.76, metalness: 0.14 });
    const leatherMat = new THREE.MeshStandardMaterial({ color: 0x2b1216, roughness: 0.56, metalness: 0.16 });
    const porcelainMat = new THREE.MeshStandardMaterial({ color: 0xd4dfe2, roughness: 0.24, metalness: 0.15 });
    const chromeMat = new THREE.MeshStandardMaterial({ color: 0xd8e4f0, roughness: 0.16, metalness: 0.94 });
    const bloodMat = new THREE.MeshStandardMaterial({
      color: 0x7d0614,
      emissive: 0x2e0207,
      emissiveIntensity: 0.4,
      roughness: 0.22,
      metalness: 0.18,
    });
    const redNeonMat = this.makeNeonStripMaterial(0xff2255, 1.65);
    this.motelBedNeonMat = redNeonMat;
    const amberLampMat = this.makeNeonStripMaterial(0xff9b33, 1.55);
    const cyanCredMat = this.makeNeonStripMaterial(0x00f0ff, 1.6);
    const goldCredMat = this.makeNeonStripMaterial(0xfcee0a, 1.5);
    const bottleGreenMat = this.makeNeonStripMaterial(0x28cc66, 0.85);
    const bottleAmberMat = this.makeNeonStripMaterial(0xff9922, 0.95);

    // Main room floor (X: -176..-154, Z: -176..-154) & low seedy ceiling
    const floor = new THREE.Mesh(new THREE.BoxGeometry(22.8, 0.25, 22.8), carpetMat);
    floor.position.set(cx, 0.1, cz);
    group.add(floor);

    const roof = new THREE.Mesh(new THREE.BoxGeometry(23.6, 0.85, 23.6), exteriorMat);
    roof.position.set(cx, wallH + 0.42, cz);
    group.add(roof);
    this.chunks.addChunkCollider(this.physics, 'motel_roof_col', cx, wallH + 0.42, cz, 23.6, 0.85, 23.6);

    const ceilingDrop = new THREE.Mesh(new THREE.PlaneGeometry(21.6, 21.6), ceilingMat);
    ceilingDrop.rotation.x = Math.PI / 2;
    ceilingDrop.position.set(cx, wallH - 0.02, cz);
    group.add(ceilingDrop);

    const addOuterWall = (id: string, wx: number, wz: number, sx: number, sz: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, wallH, sz), exteriorMat);
      m.position.set(wx, wallH * 0.5, wz);
      group.add(m);
      this.chunks.addChunkCollider(this.physics, id, wx, wallH * 0.5, wz, sx, wallH, sz);
    };
    // Room 204 outer shell (X: -176..-154, Z: -176..-154), entrance facing +Z at Z = -154.4
    addOuterWall('motel_back', cx, -175.6, 22.4, 0.8);
    addOuterWall('motel_left', -175.6, cz, 0.8, 22.4);
    addOuterWall('motel_right', -154.4, cz, 0.8, 22.4);
    addOuterWall('motel_front_l', -171.6, -154.4, 8.4, 0.8);
    addOuterWall('motel_front_r', -158.4, -154.4, 8.4, 0.8);

    // Toggleable Motel Room 204 steel security door (locked during Act 4 Betrayal)
    const lockDoorGroup = new THREE.Group();
    const lockDoorMesh = new THREE.Mesh(new THREE.BoxGeometry(4.9, 3.85, 0.24), darkSteel);
    lockDoorMesh.position.set(cx, 1.95, -154.4);
    const lockDoorBar = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.1, 0.3), redNeonMat);
    lockDoorBar.position.set(cx, 2.0, -154.4);
    lockDoorGroup.add(lockDoorMesh, lockDoorBar);
    lockDoorGroup.visible = false;
    this.motelLockDoorMesh = lockDoorGroup;
    group.add(lockDoorGroup);
    this.chunks.addChunkCollider(this.physics, 'motel_entry_lock', cx, 2.0, -154.4, 5.0, 4.0, 0.6, {
      active: false,
    });

    // Interior wallpaper lining on main room walls so interior feels unmistakably like a cheap motel
    const northLining = new THREE.Mesh(new THREE.PlaneGeometry(12.6, wallH), wallpaperMat);
    northLining.position.set(-161.1, wallH * 0.5, -175.16);
    group.add(northLining);

    const eastLining = new THREE.Mesh(new THREE.PlaneGeometry(20.4, wallH), wallpaperMat);
    eastLining.rotation.y = -Math.PI / 2;
    eastLining.position.set(-154.84, wallH * 0.5, cz);
    group.add(eastLining);

    const westSouthLining = new THREE.Mesh(new THREE.PlaneGeometry(12.6, wallH), wallpaperMat);
    westSouthLining.rotation.y = Math.PI / 2;
    westSouthLining.position.set(-175.16, wallH * 0.5, -161.1);
    group.add(westSouthLining);

    const southLiningL = new THREE.Mesh(new THREE.PlaneGeometry(7.8, wallH), wallpaperMat);
    southLiningL.rotation.y = Math.PI;
    southLiningL.position.set(-171.3, wallH * 0.5, -154.84);
    group.add(southLiningL);

    const southLiningR = new THREE.Mesh(new THREE.PlaneGeometry(7.8, wallH), wallpaperMat);
    southLiningR.rotation.y = Math.PI;
    southLiningR.position.set(-158.7, wallH * 0.5, -154.84);
    group.add(southLiningR);

    // Entrance transom header, rain canopy, red trim & glowing Room "204" door plate
    const entryHeader = new THREE.Mesh(new THREE.BoxGeometry(4.9, 1.55, 0.82), exteriorMat);
    entryHeader.position.set(cx, 4.62, -154.4);
    group.add(entryHeader);

    const canopy = new THREE.Mesh(new THREE.BoxGeometry(9.6, 0.28, 2.4), darkSteel);
    canopy.position.set(cx, 4.05, -153.1);
    group.add(canopy);
    const canopyTrim = new THREE.Mesh(new THREE.BoxGeometry(9.65, 0.1, 0.12), redNeonMat);
    canopyTrim.position.set(cx, 3.98, -151.9);
    group.add(canopyTrim);

    const room204Tex = this.textures.getNeonSign('204', 'НОМЕР', '#fcee0a', '#ff2a6d');
    const room204Plate = new THREE.Mesh(new THREE.PlaneGeometry(1.45, 0.72), this.makeSignMaterial(room204Tex, 0.9));
    room204Plate.position.set(-161.7, 2.45, -153.96);
    group.add(room204Plate);

    // Scuffed doormat inside entrance
    const doormat = new THREE.Mesh(
      new THREE.BoxGeometry(2.4, 0.04, 1.15),
      new THREE.MeshStandardMaterial({ color: 0x3b261c, roughness: 0.95 }),
    );
    doormat.position.set(cx, 0.24, -155.5);
    group.add(doormat);

    // -------------------------------------------------------------------------
    // SEPARATE ENCLOSED TILED BATHROOM IN NW CORNER (X: -176..-167.5, Z: -176..-167.5)
    // South wall at Z=-167.5, East wall at X=-167.5 with clean 2.4m doorway (Z: -171.2..-168.8)
    // -------------------------------------------------------------------------
    const bathFloor = new THREE.Mesh(new THREE.BoxGeometry(7.7, 0.06, 7.7), bathTileFloorMat);
    bathFloor.position.set(-171.4, 0.235, -171.4);
    group.add(bathFloor);

    // Tiled inner wall panels on North & West outer walls inside bathroom
    const bathNorthTile = new THREE.Mesh(new THREE.PlaneGeometry(7.7, wallH), bathTileWallMat);
    bathNorthTile.position.set(-171.4, wallH * 0.5, -175.15);
    group.add(bathNorthTile);

    const bathWestTile = new THREE.Mesh(new THREE.PlaneGeometry(7.7, wallH), bathTileWallMat);
    bathWestTile.rotation.y = Math.PI / 2;
    bathWestTile.position.set(-175.15, wallH * 0.5, -171.4);
    group.add(bathWestTile);

    // South bathroom partition wall (Z = -167.5, X: -175.2..-167.5)
    const bathSouthWall = new THREE.Mesh(new THREE.BoxGeometry(7.7, wallH, 0.45), wallpaperMat);
    bathSouthWall.position.set(-171.35, wallH * 0.5, -167.5);
    group.add(bathSouthWall);
    this.chunks.addChunkCollider(this.physics, 'motel_bath_south', -171.35, wallH * 0.5, -167.5, 7.7, wallH, 0.45);

    const bathSouthInnerTile = new THREE.Mesh(new THREE.PlaneGeometry(7.6, wallH), bathTileWallMat);
    bathSouthInnerTile.rotation.y = Math.PI;
    bathSouthInnerTile.position.set(-171.35, wallH * 0.5, -167.74);
    group.add(bathSouthInnerTile);

    // East bathroom partition wall (X = -167.5) split cleanly around 2.4m doorway (Z: -171.2..-168.8)
    const bathEastNorth = new THREE.Mesh(new THREE.BoxGeometry(0.45, wallH, 4.0), wallpaperMat);
    bathEastNorth.position.set(-167.5, wallH * 0.5, -173.2);
    group.add(bathEastNorth);
    this.chunks.addChunkCollider(this.physics, 'motel_bath_east_n', -167.5, wallH * 0.5, -173.2, 0.45, wallH, 4.0);

    const bathEastNorthInner = new THREE.Mesh(new THREE.PlaneGeometry(3.95, wallH), bathTileWallMat);
    bathEastNorthInner.rotation.y = -Math.PI / 2;
    bathEastNorthInner.position.set(-167.74, wallH * 0.5, -173.2);
    group.add(bathEastNorthInner);

    const bathEastSouth = new THREE.Mesh(new THREE.BoxGeometry(0.45, wallH, 1.52), wallpaperMat);
    bathEastSouth.position.set(-167.5, wallH * 0.5, -168.04);
    group.add(bathEastSouth);
    this.chunks.addChunkCollider(this.physics, 'motel_bath_east_s', -167.5, wallH * 0.5, -168.04, 0.45, wallH, 1.52);

    const bathEastSouthInner = new THREE.Mesh(new THREE.PlaneGeometry(1.48, wallH), bathTileWallMat);
    bathEastSouthInner.rotation.y = -Math.PI / 2;
    bathEastSouthInner.position.set(-167.74, wallH * 0.5, -168.04);
    group.add(bathEastSouthInner);

    // Doorway lintel & wooden/steel door jambs framing Z: -171.2..-168.8
    const bathLintel = new THREE.Mesh(new THREE.BoxGeometry(0.48, 2.35, 2.44), wallpaperMat);
    bathLintel.position.set(-167.5, 4.22, -170.0);
    group.add(bathLintel);

    for (const jz of [-171.18, -168.82]) {
      const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.54, 3.08, 0.14), scuffedWood);
      jamb.position.set(-167.5, 1.54, jz);
      group.add(jamb);
    }
    const topJamb = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.14, 2.5), scuffedWood);
    topJamb.position.set(-167.5, 3.04, -170.0);
    group.add(topJamb);

    // Slightly ajar scuffed bathroom door swung inward into NE bathroom corner (clear of doorway & choke spot)
    const bathDoor = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.9, 1.95), scuffedWood);
    bathDoor.position.set(-168.15, 1.48, -172.05);
    bathDoor.rotation.y = 0.52;
    group.add(bathDoor);

    // Tiled plumbing bulkhead behind the sink so sink & mirror sit flush against tiled wall
    const sinkBulkhead = new THREE.Mesh(new THREE.BoxGeometry(3.8, wallH, 0.92), bathTileWallMat);
    sinkBulkhead.position.set(-173.25, wallH * 0.5, -174.7);
    group.add(sinkBulkhead);
    this.chunks.addChunkCollider(this.physics, 'motel_sink_bulkhead', -173.25, wallH * 0.5, -174.7, 3.8, wallH, 0.92);

    // Porcelain Sink & Chrome Faucet with subtle crimson stains at (-173.2, 0.25, -173.8)
    const sinkX = -173.2;
    const sinkZ = -173.8;
    const sinkPedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.26, 0.72, 10), porcelainMat);
    sinkPedestal.position.set(sinkX, 0.61, sinkZ - 0.04);
    group.add(sinkPedestal);

    const sinkCounter = new THREE.Mesh(new THREE.BoxGeometry(1.38, 0.2, 0.84), porcelainMat);
    sinkCounter.position.set(sinkX, 1.02, sinkZ);
    group.add(sinkCounter);
    this.chunks.addChunkCollider(this.physics, 'motel_sink_col', sinkX, 0.6, sinkZ, 1.38, 1.2, 0.84, {
      blocksSight: false,
    });

    const sinkBasin = new THREE.Mesh(
      new THREE.BoxGeometry(1.02, 0.09, 0.56),
      new THREE.MeshStandardMaterial({ color: 0x62737c, roughness: 0.28, metalness: 0.3 }),
    );
    sinkBasin.position.set(sinkX, 1.09, sinkZ + 0.03);
    group.add(sinkBasin);

    // Subtle crimson bloodstains inside sink basin, rim drip, and floor tiles
    const bloodPool = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.025, 0.38), bloodMat);
    bloodPool.position.set(sinkX, 1.135, sinkZ + 0.03);
    group.add(bloodPool);

    const bloodRim = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.16, 0.03), bloodMat);
    bloodRim.position.set(sinkX + 0.24, 1.01, sinkZ + 0.43);
    group.add(bloodRim);

    const bloodDrop = new THREE.Mesh(new THREE.CircleGeometry(0.28, 10), bloodMat);
    bloodDrop.rotation.x = -Math.PI / 2;
    bloodDrop.position.set(sinkX + 0.18, 0.275, sinkZ + 0.78);
    group.add(bloodDrop);

    // Chrome faucet & twin taps
    const faucetStem = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.032, 0.26, 8), chromeMat);
    faucetStem.position.set(sinkX, 1.24, sinkZ - 0.28);
    group.add(faucetStem);
    const faucetSpout = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, 0.24), chromeMat);
    faucetSpout.position.set(sinkX, 1.35, sinkZ - 0.18);
    group.add(faucetSpout);
    for (const tx of [-0.14, 0.14]) {
      const tap = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.08, 8), chromeMat);
      tap.position.set(sinkX + tx, 1.16, sinkZ - 0.28);
      group.add(tap);
    }

    // Glowing chrome-framed bathroom mirror directly above sink
    const mirrorFrame = new THREE.Mesh(new THREE.BoxGeometry(1.94, 1.46, 0.09), chromeMat);
    mirrorFrame.position.set(sinkX, 1.98, -174.22);
    group.add(mirrorFrame);

    const mirrorGlass = new THREE.Mesh(
      new THREE.PlaneGeometry(1.78, 1.3),
      new THREE.MeshStandardMaterial({
        color: 0x8ad8f8,
        emissive: 0x1a5a78,
        emissiveIntensity: 0.85,
        metalness: 0.96,
        roughness: 0.06,
      }),
    );
    mirrorGlass.position.set(sinkX, 1.98, -174.16);
    group.add(mirrorGlass);

    // Cold cyan flickering fluorescent tube overhead (mirror + bathroom ceiling)
    this.motelBathTubeMat = this.makeNeonStripMaterial(0xaef6ff, 1.85);
    const mirrorTubeHousing = new THREE.Mesh(new THREE.BoxGeometry(1.88, 0.12, 0.16), darkSteel);
    mirrorTubeHousing.position.set(sinkX, 2.94, -174.14);
    group.add(mirrorTubeHousing);
    const mirrorTube = new THREE.Mesh(new THREE.BoxGeometry(1.76, 0.08, 0.1), this.motelBathTubeMat);
    mirrorTube.position.set(sinkX, 2.86, -174.08);
    group.add(mirrorTube);

    const ceilingBathTube = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.09, 0.16), this.motelBathTubeMat);
    ceilingBathTube.position.set(-171.4, wallH - 0.12, -171.3);
    group.add(ceilingBathTube);

    // Porcelain Toilet prop in SW bathroom corner (-174.35, 0.25, -168.7) facing East
    const toiletGroup = new THREE.Group();
    toiletGroup.position.set(-174.35, 0.25, -168.7);
    const toiletTank = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.72, 0.56), porcelainMat);
    toiletTank.position.set(-0.26, 0.76, 0);
    toiletGroup.add(toiletTank);
    const toiletBase = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.2, 0.44, 10), porcelainMat);
    toiletBase.position.set(0.1, 0.24, 0);
    toiletGroup.add(toiletBase);
    const toiletBowl = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.24, 0.14, 12), porcelainMat);
    toiletBowl.position.set(0.14, 0.48, 0);
    toiletGroup.add(toiletBowl);
    const toiletSeat = new THREE.Mesh(
      new THREE.TorusGeometry(0.22, 0.04, 8, 14),
      new THREE.MeshStandardMaterial({ color: 0xbac6ca, roughness: 0.3 }),
    );
    toiletSeat.rotation.x = Math.PI / 2;
    toiletSeat.position.set(0.15, 0.56, 0);
    toiletGroup.add(toiletSeat);
    const flushHandle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 0.14), chromeMat);
    flushHandle.position.set(-0.14, 1.02, 0.3);
    toiletGroup.add(flushHandle);
    group.add(toiletGroup);
    this.chunks.addChunkCollider(this.physics, 'motel_toilet_col', -174.35, 0.65, -168.7, 0.85, 1.1, 0.72, {
      blocksSight: false,
    });

    // -------------------------------------------------------------------------
    // MAIN MOTEL ROOM 204 PROPS (Distinctly seedy Cyber-Tastak atmosphere)
    // -------------------------------------------------------------------------

    // 1. Cheap scuffed motel bed against East wall (-157, 0.25, -163) with rumpled blanket & red neon headboard tube
    const bedX = -156.85;
    const bedZ = -163.0;
    const bedFrame = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.42, 2.55), scuffedWood);
    bedFrame.position.set(bedX, 0.44, bedZ);
    group.add(bedFrame);
    this.chunks.addChunkCollider(this.physics, 'motel_bed', bedX, 0.62, bedZ, 3.6, 0.9, 2.55);

    const headboard = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.38, 2.65), scuffedWood);
    headboard.position.set(-155.02, 0.94, bedZ);
    group.add(headboard);

    // Buzzing red neon tube mounted right above the motel headboard
    const headboardNeon = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 2.45), redNeonMat);
    headboardNeon.position.set(-154.96, 1.88, bedZ);
    group.add(headboardNeon);

    const mattress = new THREE.Mesh(
      new THREE.BoxGeometry(3.35, 0.26, 2.38),
      new THREE.MeshStandardMaterial({ color: 0x7c756c, roughness: 0.92, metalness: 0.04 }),
    );
    mattress.position.set(bedX - 0.06, 0.76, bedZ);
    group.add(mattress);

    // Rumpled cheap burgundy-plum motel blanket & crinkled folds
    const blanketMat = new THREE.MeshStandardMaterial({ color: 0x4c1728, roughness: 0.9, metalness: 0.05 });
    const blanketMain = new THREE.Mesh(new THREE.BoxGeometry(2.25, 0.14, 2.42), blanketMat);
    blanketMain.position.set(bedX - 0.62, 0.92, bedZ + 0.04);
    blanketMain.rotation.y = 0.06;
    group.add(blanketMain);

    const blanketFold = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.18, 1.85), blanketMat);
    blanketFold.position.set(bedX - 0.25, 0.97, bedZ - 0.18);
    blanketFold.rotation.set(0.08, -0.22, 0.14);
    group.add(blanketFold);

    // Two crooked stained pillows
    const pillowMat = new THREE.MeshStandardMaterial({ color: 0xa9a295, roughness: 0.88 });
    for (const [pz, rot] of [
      [bedZ - 0.56, 0.16],
      [bedZ + 0.52, -0.22],
    ]) {
      const pillow = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.18, 0.82), pillowMat);
      pillow.position.set(-155.55, 0.96, pz);
      pillow.rotation.y = rot;
      group.add(pillow);
    }

    // Chipped bedside nightstand + sleazy amber motel lamp
    const nightstand = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.72, 0.85), scuffedWood);
    nightstand.position.set(-155.5, 0.58, -160.85);
    group.add(nightstand);
    this.chunks.addChunkCollider(this.physics, 'motel_nightstand_col', -155.5, 0.58, -160.85, 0.85, 1.1, 0.85, {
      blocksSight: false,
    });
    const lampBase = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 0.34, 8), darkSteel);
    lampBase.position.set(-155.5, 1.12, -160.85);
    group.add(lampBase);
    const lampShade = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.26, 0.28, 10), amberLampMat);
    lampShade.position.set(-155.5, 1.38, -160.85);
    group.add(lampShade);

    // 2. Red Venetian-blind motel window on East wall (X = -154.88, Z = -158.0)
    const winFrame = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.05, 3.75), darkSteel);
    winFrame.position.set(-154.9, 2.45, -158.0);
    group.add(winFrame);

    const winGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(3.52, 1.82),
      this.makeNeonStripMaterial(0xff1e4d, 1.25),
    );
    winGlow.rotation.y = -Math.PI / 2;
    winGlow.position.set(-154.96, 2.45, -158.0);
    group.add(winGlow);

    // 11 slightly tilted horizontal Venetian blind slats letting red neon bleed through
    const slatMat = new THREE.MeshStandardMaterial({ color: 0x141016, roughness: 0.45, metalness: 0.65 });
    for (let s = 0; s < 11; s++) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 3.54), slatMat);
      slat.position.set(-155.02, 1.62 + s * 0.165, -158.0);
      slat.rotation.z = 0.28;
      group.add(slat);
    }

    // 3. Flickering CRT / holo wall TV mounted on the North wall (-161.5, 2.55, -174.8)
    const tvHousing = new THREE.Mesh(new THREE.BoxGeometry(2.35, 1.45, 0.58), darkSteel);
    tvHousing.position.set(-161.5, 2.55, -174.82);
    group.add(tvHousing);

    this.motelTvMat = this.makeSignMaterial(this.createMotelTvTexture(), 0.92);
    const tvScreen = new THREE.Mesh(new THREE.PlaneGeometry(2.06, 1.16), this.motelTvMat);
    tvScreen.position.set(-161.5, 2.55, -174.51);
    group.add(tvScreen);

    for (const [ax, rot] of [
      [-161.85, 0.35],
      [-161.15, -0.35],
    ]) {
      const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, 0.72, 6), chromeMat);
      ant.position.set(ax, 3.55, -174.85);
      ant.rotation.z = rot;
      group.add(ant);
    }

    // 4. Artem's cracked leather armchair at (-160, 0.25, -169) + sleazy coffee table with bottles & credchips
    const chairGroup = new THREE.Group();
    chairGroup.position.set(-160.0, 0.25, -169.4);
    chairGroup.rotation.y = -0.32;
    const chairSeat = new THREE.Mesh(new THREE.BoxGeometry(1.24, 0.44, 1.12), leatherMat);
    chairSeat.position.set(0, 0.3, 0);
    chairGroup.add(chairSeat);
    const chairBack = new THREE.Mesh(new THREE.BoxGeometry(1.24, 1.02, 0.28), leatherMat);
    chairBack.position.set(0, 0.86, -0.44);
    chairGroup.add(chairBack);
    for (const ax of [-0.54, 0.54]) {
      const armRest = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.52, 1.08), leatherMat);
      armRest.position.set(ax, 0.58, -0.02);
      chairGroup.add(armRest);
    }
    group.add(chairGroup);
    this.chunks.addChunkCollider(this.physics, 'motel_chair_col', -160.0, 0.75, -169.4, 1.3, 1.3, 1.2, {
      blocksSight: false,
    });

    // Sleazy low coffee table with liquor bottles & glowing credchips
    const tableX = -162.3;
    const tableZ = -167.2;
    const tableTop = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.1, 1.05), scuffedWood);
    tableTop.position.set(tableX, 0.78, tableZ);
    group.add(tableTop);
    this.chunks.addChunkCollider(this.physics, 'motel_coffee_table_col', tableX, 0.45, tableZ, 1.85, 0.9, 1.05, {
      blocksSight: false,
    });
    for (const [lx, lz] of [
      [-0.78, -0.4],
      [0.78, -0.4],
      [-0.78, 0.4],
      [0.78, 0.4],
    ]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.56, 0.08), darkSteel);
      leg.position.set(tableX + lx, 0.48, tableZ + lz);
      group.add(leg);
    }
    // Bottles (standing + knocked-over)
    const b1 = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.075, 0.36, 8), bottleAmberMat);
    b1.position.set(tableX - 0.52, 1.01, tableZ - 0.14);
    group.add(b1);
    const b2 = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.07, 0.32, 8), bottleGreenMat);
    b2.position.set(tableX - 0.34, 0.99, tableZ + 0.16);
    group.add(b2);
    const bFallen = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.065, 0.3, 8), bottleAmberMat);
    bFallen.rotation.z = Math.PI / 2;
    bFallen.rotation.y = 0.6;
    bFallen.position.set(tableX + 0.1, 0.89, tableZ + 0.22);
    group.add(bFallen);
    // Glowing credchips stacked on table
    for (let c = 0; c < 4; c++) {
      const chip = new THREE.Mesh(
        new THREE.BoxGeometry(0.18, 0.024, 0.11),
        c % 2 === 0 ? cyanCredMat : goldCredMat,
      );
      chip.position.set(tableX + 0.42 + (c % 2) * 0.14, 0.845 + Math.floor(c / 2) * 0.028, tableZ - 0.12);
      chip.rotation.y = 0.25 * c;
      group.add(chip);
    }

    // Main room ceiling buzzing red neon halo fixture
    const mainCeilRing = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.06, 8, 20), redNeonMat);
    mainCeilRing.rotation.x = Math.PI / 2;
    mainCeilRing.position.set(-161.8, wallH - 0.15, -163.5);
    group.add(mainCeilRing);

    // -------------------------------------------------------------------------
    // Toggleable Story Props: Artem & Huge Cyber-Bodyguard
    // -------------------------------------------------------------------------
    this.motelArtemRig = buildArtemModel();
    this.motelArtemRig.group.position.set(-160.0, 0.25, -168.4);
    this.motelArtemRig.group.rotation.y = -0.32;
    this.motelArtemRig.group.visible = false;
    group.add(this.motelArtemRig.group);

    this.motelBodyguardRig = buildBodyguardModel();
    this.motelBodyguardRig.group.position.set(-165.5, 0.25, -169.8);
    this.motelBodyguardRig.group.rotation.y = 0.08;
    this.motelBodyguardRig.group.visible = false;
    group.add(this.motelBodyguardRig.group);

    // Exterior flickering red neon motel sign: МОТЕЛЬ «ТАСТАК» // НОМЕР 204
    const motelSignFrame = new THREE.Mesh(new THREE.BoxGeometry(16.8, 4.1, 0.34), darkSteel);
    motelSignFrame.position.set(cx, 7.6, -154.0);
    group.add(motelSignFrame);

    const motelSignTex = this.textures.getNeonSign(
      'МОТЕЛЬ «ТАСТАК»',
      'НОМЕР 204 // ПОЧАСОВО • КИБЕР-ТАСТАК',
      '#ff2a6d',
      '#fcee0a',
    );
    this.motelNeonSignMat = this.makeSignMaterial(motelSignTex, 0.84);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(16.2, 3.7), this.motelNeonSignMat);
    sign.position.set(cx, 7.6, -153.8);
    group.add(sign);

    // Pooled light anchors for Motel Room 204 (zero WebGL shader recompiles)
    this.registerLightAnchor(-161.8, 4.4, -163.5, 0xff2255, 4.4, 24);
    this.registerLightAnchor(-156.2, 2.8, -161.2, 0xff8c2b, 3.2, 16);
    this.registerLightAnchor(-171.8, 3.4, -172.0, 0x88f0ff, 3.6, 13);

    this.chunks.addToChunk(cx, cz, group);
    this.minimapBuildings.push({
      minX: cx - 11.5,
      maxX: cx + 11.5,
      minZ: cz - 11.5,
      maxZ: cz + 11.5,
      color: '#ff2a6d',
    });
  }

  // ---------------------------------------------------------------------------
  // Junkyard / Industrial Outskirts (SW, X=-165, Z=165) — Act 5 Awakening
  // ---------------------------------------------------------------------------

  private buildJunkyardDistrict(): void {
    const cx = -165;
    const cz = 165;
    const group = new THREE.Group();

    const rustMat = new THREE.MeshStandardMaterial({
      color: 0x3b2c25,
      roughness: 0.88,
      metalness: 0.42,
    });
    const containerMat = new THREE.MeshStandardMaterial({
      color: 0x1d293b,
      roughness: 0.7,
      metalness: 0.5,
    });

    // Scrap hills & rusted shipping containers framing the awakening pit
    const piles: Array<[number, number, number, number, number]> = [
      [cx - 18, cz - 12, 10, 6, 8],
      [cx + 16, cz - 14, 12, 5, 7],
      [cx - 14, cz + 18, 9, 4.5, 11],
      [cx + 18, cz + 14, 11, 6.5, 9],
      [cx - 26, cz + 2, 8, 7, 14],
    ];
    piles.forEach(([px, pz, sx, sy, sz], i) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), i % 2 === 0 ? rustMat : containerMat);
      m.position.set(px, sy * 0.5, pz);
      group.add(m);
      this.chunks.addChunkCollider(this.physics, `junk_pile_${i}`, px, sy * 0.5, pz, sx, sy, sz);
    });

    // Burning oil barrel near wake spot
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 1.3, 10), rustMat);
    barrel.position.set(cx + 4.5, 0.65, cz - 4);
    group.add(barrel);
    const fire = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.5, 0),
      this.makeNeonStripMaterial(0xff6a00, 1.6),
    );
    fire.position.set(cx + 4.5, 1.45, cz - 4);
    group.add(fire);

    // Artem's body lying on the junkyard beside Ai
    const artemRig = buildArtemModel();
    artemRig.group.rotation.x = -Math.PI / 2;
    artemRig.group.rotation.z = 0.6;
    artemRig.group.position.set(cx - 2.6, 0.25, cz - 2.2);
    this.artemCorpseGroup.add(artemRig.group);
    group.add(this.artemCorpseGroup);

    // Samir Hologram standing over Ai in Act 5
    this.samirJunkyardRig = buildSamirHologram();
    this.samirJunkyardRig.group.position.set(cx + 1.2, 0, cz - 3.6);
    this.samirJunkyardRig.group.rotation.y = 0;
    this.samirJunkyardRig.group.visible = false;
    group.add(this.samirJunkyardRig.group);

    // Junkyard sign (Bolt 1 MeshStandardMaterial standard)
    const junkTex = this.textures.getNeonSign('СВАЛКА // СЕКТОР 09', 'УТИЛИЗАЦИЯ КИБЕРХЛАМА', '#fcee0a', '#ff5500');
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(15, 3.6), this.makeSignMaterial(junkTex, 0.78));
    sign.position.set(cx, 7.5, cz - 24);
    group.add(sign);

    this.registerLightAnchor(cx + 4.5, 2.5, cz - 4, 0xff7722, 4.4, 26);

    this.chunks.addToChunk(cx, cz, group);
  }

  // ---------------------------------------------------------------------------
  // Marakulin Tower Plaza (NE, X=170, Z=-170)
  // ---------------------------------------------------------------------------

  private buildMarakulinTowerPlaza(): void {
    const cx = 170;
    const cz = -170;

    const towerMat = new THREE.MeshStandardMaterial({
      map: this.textures.getBuildingFacade('#ff003c', '#0b0e1a', 3, 10),
      roughness: 0.28,
      metalness: 0.74,
    });
    const crimsonStrip = this.makeNeonStripMaterial(0xff003c, 1.5);

    // Giant tower in landmarkGroup (always visible across 500x500m)
    const towerGroup = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(52, 165, 52), towerMat);
    base.position.set(cx, 82.5, cz);
    towerGroup.add(base);

    const crown = new THREE.Mesh(new THREE.BoxGeometry(36, 35, 36), towerMat);
    crown.position.set(cx, 180, cz);
    towerGroup.add(crown);

    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 2.2, 45, 8), crimsonStrip);
    antenna.position.set(cx, 218, cz);
    towerGroup.add(antenna);

    // Corner red neon ribs
    for (const sx of [-26.2, 26.2]) {
      for (const sz of [-26.2, 26.2]) {
        const rib = new THREE.Mesh(new THREE.BoxGeometry(0.85, 165, 0.85), crimsonStrip);
        rib.position.set(cx + sx, 82.5, cz + sz);
        towerGroup.add(rib);
      }
    }

    // Giant billboard readable from Rooftop & Prospekt Abaya (Bolt 1 MeshStandardMaterial)
    const giantTex = this.textures.getNeonSign('МАРАКУЛИН ТАУЭР', 'МЕГАКОРПОРАЦИЯ // СЕКТОР 01', '#ff003c', '#ffffff');
    const giantMat = this.makeSignMaterial(giantTex, 0.78);

    const giantSign = new THREE.Mesh(new THREE.PlaneGeometry(46, 11.5), giantMat);
    giantSign.position.set(cx, 95, cz + 26.5);
    towerGroup.add(giantSign);

    const giantSignWest = new THREE.Mesh(new THREE.PlaneGeometry(46, 11.5), giantMat);
    giantSignWest.position.set(cx - 26.5, 95, cz);
    giantSignWest.rotation.y = -Math.PI / 2;
    towerGroup.add(giantSignWest);

    // Entrance archway on South face (+Z)
    const arch = new THREE.Mesh(
      new THREE.BoxGeometry(14, 7.5, 4),
      new THREE.MeshStandardMaterial({
        color: 0x1a0810,
        emissive: 0xff003c,
        emissiveIntensity: 0.65,
      }),
    );
    arch.position.set(cx, 3.75, cz + 27);
    towerGroup.add(arch);

    this.chunks.addLandmark(towerGroup);
    this.physics.addBox('marakulin_tower_body', cx, 82.5, cz, 52, 165, 52);

    this.minimapBuildings.push({
      minX: cx - 26,
      maxX: cx + 26,
      minZ: cz - 26,
      maxZ: cz + 26,
      color: '#ff003c',
    });
  }

  // ---------------------------------------------------------------------------
  // Kok-Tobe Overlook Rooftop (SE, X=165, Y=36, Z=165)
  // Reconstructed directly from /home/antigravity/IMG-20261123-WA0011.jpg!
  // ---------------------------------------------------------------------------

  private buildKokTobeOverlookBuilding(): void {
    const cx = 165;
    const cz = 165;
    const h = 36;
    const group = new THREE.Group();

    const bodyMat = new THREE.MeshStandardMaterial({
      map: this.textures.getBuildingFacade('#b537f2', '#121528', 2, 4),
      roughness: 0.4,
      metalness: 0.55,
    });
    const body = new THREE.Mesh(new THREE.BoxGeometry(28, h, 28), bodyMat);
    body.position.set(cx, h * 0.5, cz);
    group.add(body);

    // Gritty rooftop asphalt/concrete terrace surface
    const deckMat = new THREE.MeshStandardMaterial({
      map: this.textures.getCyberAsphalt(4, 4),
      roughness: 0.72,
      metalness: 0.22,
    });
    const deck = new THREE.Mesh(new THREE.BoxGeometry(28.1, 0.14, 28.1), deckMat);
    deck.position.set(cx, h + 0.04, cz);
    group.add(deck);

    // Perimeter low safety ledges along outer terrace edges
    const outerLedgeMat = new THREE.MeshStandardMaterial({ color: 0x1b2330, roughness: 0.8, metalness: 0.25 });
    const cyanTrimMat = this.makeNeonStripMaterial(0x00f0ff, 1.5);
    for (const [rx, rz, sx, sz] of [
      [cx, cz + 13.7, 28, 0.45],
      [cx + 13.7, cz, 0.45, 28],
    ]) {
      const ledge = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.85, sz), outerLedgeMat);
      ledge.position.set(rx, h + 0.45, rz);
      group.add(ledge);
      const trim = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.08, sz), cyanTrimMat);
      trim.position.set(rx, h + 0.9, rz);
      group.add(trim);
    }

    // -------------------------------------------------------------------------
    // Rooftop Hero Diorama (local space centered at 163, 36, 163, rotY = +45°)
    // Local +Z -> SE (toward Ai/camera), Local -Z -> NW (across gap to skyline)
    // Local -X -> Viewer's LEFT (slanted pipe + orange steam cloud)
    // Local +X -> Viewer's RIGHT (Samir's chrome cyber-arm + holographic ads)
    // -------------------------------------------------------------------------
    const diorama = new THREE.Group();
    diorama.position.set(163.0, h, 163.0);
    diorama.rotation.y = Math.PI * 0.25;

    const parapetTex = this.createWeatheredParapetTexture();
    const parapetMat = new THREE.MeshStandardMaterial({
      map: parapetTex,
      roughness: 0.84,
      metalness: 0.14,
    });
    const capMat = new THREE.MeshStandardMaterial({ color: 0x262f3b, roughness: 0.78, metalness: 0.18 });
    const darkIronMat = new THREE.MeshStandardMaterial({ color: 0x181d24, roughness: 0.48, metalness: 0.78 });

    // Wide weathered concrete parapet wall where Samir sits
    const parapetWall = new THREE.Mesh(new THREE.BoxGeometry(11.4, 0.82, 0.78), parapetMat);
    parapetWall.position.set(0, 0.41, 0);
    diorama.add(parapetWall);

    // Beveled concrete cap ledge on top (top surface at local Y = 0.90)
    const parapetCap = new THREE.Mesh(new THREE.BoxGeometry(11.6, 0.1, 0.92), capMat);
    parapetCap.position.set(0, 0.85, 0.02);
    diorama.add(parapetCap);

    // Concrete left end-pillar framing the left foreground (matches IMG-20261123-WA0011.jpg)
    const leftPillar = new THREE.Mesh(new THREE.BoxGeometry(1.15, 1.38, 1.15), parapetMat);
    leftPillar.position.set(-5.35, 0.69, 0.1);
    diorama.add(leftPillar);
    const leftPillarCap = new THREE.Mesh(new THREE.BoxGeometry(1.26, 0.12, 1.26), capMat);
    leftPillarCap.position.set(-5.35, 1.4, 0.1);
    diorama.add(leftPillarCap);

    // Scattered gritty rooftop paper flyers on concrete floor in front of parapet
    const flyerMat = new THREE.MeshStandardMaterial({ color: 0x7b8ea0, roughness: 0.9 });
    for (const [fx, fz, rot] of [
      [-2.1, 1.15, 0.4],
      [-1.4, 1.65, -0.7],
      [-0.5, 1.32, 0.9],
      [1.25, 1.48, -0.3],
      [-2.8, 1.9, 1.1],
    ]) {
      const flyer = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.18), flyerMat);
      flyer.rotation.x = -Math.PI / 2;
      flyer.rotation.z = rot;
      flyer.position.set(fx, 0.12, fz);
      diorama.add(flyer);
    }

    // Slanted dark iron railing / pipe descending from left housing onto parapet (exact screenshot detail!)
    const pipeLen = 3.95;
    const slantedPipe = new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.068, pipeLen, 10), darkIronMat);
    slantedPipe.position.set(-3.05, 1.54, -0.32);
    slantedPipe.rotation.z = 1.24; // slanted down from left-high to right-low on parapet
    diorama.add(slantedPipe);

    const pipeBracket = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 0.24), darkIronMat);
    pipeBracket.position.set(-1.32, 0.96, -0.3);
    diorama.add(pipeBracket);

    // Left vent stack, exhaust duct & weathered rooftop dish behind the slanted pipe
    const ventBase = new THREE.Mesh(new THREE.BoxGeometry(1.3, 2.3, 1.3), darkIronMat);
    ventBase.position.set(-4.35, 1.15, -1.65);
    diorama.add(ventBase);

    const curvedVent = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.48, 3.6, 10), darkIronMat);
    curvedVent.position.set(-4.45, 2.9, -2.05);
    diorama.add(curvedVent);

    const dish = new THREE.Mesh(
      new THREE.CylinderGeometry(0.75, 0.15, 0.22, 14),
      new THREE.MeshStandardMaterial({ color: 0x263140, roughness: 0.6, metalness: 0.6 }),
    );
    dish.position.set(-4.65, 2.45, -0.72);
    dish.rotation.set(0.35, 0.5, 1.2);
    diorama.add(dish);

    // Animated warm orange-red billowing steam/smoke cloud puffs rising from left vent behind railing!
    const steamTex = this.createSteamPuffTexture();
    const steamGeo = new THREE.PlaneGeometry(1.0, 1.0);
    for (let i = 0; i < 18; i++) {
      const puffMat = new THREE.MeshBasicMaterial({
        map: steamTex,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const puff = new THREE.Mesh(steamGeo, puffMat);
      const baseX = -3.65 + (i % 5) * 0.44;
      const baseY = 0.72 + (i % 3) * 0.28;
      const baseZ = -1.65 - (i % 4) * 0.38;
      puff.position.set(baseX, baseY, baseZ);
      diorama.add(puff);
      this.steamPuffs.push({
        mesh: puff,
        mat: puffMat,
        baseX,
        baseY,
        baseZ,
        phase: (i / 18) * 1.0,
        speed: 0.17 + (i % 4) * 0.032,
        driftX: 0.55 + (i % 3) * 0.25,
        driftZ: -0.25 - (i % 2) * 0.2,
        maxRise: 3.4 + (i % 3) * 0.7,
        baseScale: 1.45 + (i % 4) * 0.42,
      });
    }

    // Pooled light anchors for rooftop steam glow, cyan skyline rim, and Samir face fill (zero PointLights!)
    const upAxis = new THREE.Vector3(0, 1, 0);
    const registerDioramaLight = (
      lx: number,
      ly: number,
      lz: number,
      colorHex: number,
      intensity: number,
      distance: number,
    ) => {
      const worldPt = new THREE.Vector3(lx, ly, lz).applyAxisAngle(upAxis, Math.PI * 0.25).add(diorama.position);
      this.registerLightAnchor(worldPt.x, worldPt.y, worldPt.z, colorHex, intensity, distance);
    };
    registerDioramaLight(-2.75, 1.95, -1.35, 0xff4a18, 7.2, 16);
    registerDioramaLight(2.4, 2.6, -2.5, 0x00d8ff, 3.2, 20);
    registerDioramaLight(0.5, 2.1, 3.1, 0x88c8e8, 2.2, 10);

    // SEATED SAMIR on the concrete parapet ledge (directly reconstructed from IMG-20261123-WA0011.jpg)
    this.samirRooftopRig = buildSeatedSamirRooftop();
    this.samirRooftopRig.group.position.set(0, 0.9, 0.06);
    diorama.add(this.samirRooftopRig.group);

    // Secondary rooftop chair tucked politely off to the right behind Ai's seated camera spot
    const chairMat = new THREE.MeshStandardMaterial({ color: 0x1c2538, metalness: 0.5, roughness: 0.45 });
    const sideChair = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.85, 0.95), chairMat);
    sideChair.position.set(3.2, 0.45, 3.2);
    diorama.add(sideChair);

    // -------------------------------------------------------------------------
    // Dramatic Layered Cyber-Skyscrapers Directly Framing Samir Across the Gap!
    // -------------------------------------------------------------------------
    const darkCorpoMat = new THREE.MeshStandardMaterial({
      color: 0x0b1520,
      roughness: 0.42,
      metalness: 0.68,
    });
    const darkSteppedFacade = new THREE.MeshStandardMaterial({
      map: this.textures.getBuildingFacade('#42c8e8', '#0c1622', 3, 6),
      roughness: 0.44,
      metalness: 0.58,
    });
    const tealTrim = this.makeNeonStripMaterial(0x00d4ff, 1.5);

    // 1. Mid-ground Monolithic Dark Tower right behind Samir's left shoulder: "SECURE YOUR SOUL // ХУЕШИ"
    const monolith = new THREE.Group();
    monolith.position.set(5.4, -h, -27.5);
    const monoBody = new THREE.Mesh(new THREE.BoxGeometry(12.5, 46.5, 12.5), darkCorpoMat);
    monoBody.position.y = 23.25;
    monolith.add(monoBody);

    // Vertical teal tech rib along tower corner
    const monoRib = new THREE.Mesh(new THREE.BoxGeometry(0.28, 46.5, 0.28), tealTrim);
    monoRib.position.set(-6.28, 23.25, 6.28);
    monolith.add(monoRib);

    // Crisp glowing "SECURE YOUR SOUL // ХУЕШИ" facade panel
    const secureTex = this.createSecureYourSoulTexture();
    const securePanel = new THREE.Mesh(new THREE.PlaneGeometry(9.6, 9.8), this.makeSignMaterial(secureTex, 0.82));
    securePanel.position.set(0.2, 40.4, 6.32);
    monolith.add(securePanel);
    diorama.add(monolith);

    // 2. High Center-Back Stepped Skyscraper Complex with white glowing "МАРАКУЛИН" rooftop sign!
    const marakulinVista = new THREE.Group();
    marakulinVista.position.set(-1.5, -h, -92);

    // Left stepped illuminated window tower wing (behind Samir's right side)
    const leftWing = new THREE.Mesh(new THREE.BoxGeometry(22, 66, 18), darkSteppedFacade);
    leftWing.position.set(-11, 33, 2);
    marakulinVista.add(leftWing);

    const leftCrownCap = new THREE.Mesh(new THREE.BoxGeometry(24, 3.2, 19), darkCorpoMat);
    leftCrownCap.position.set(-11, 66.5, 2);
    marakulinVista.add(leftCrownCap);

    // Right main corporate tower crown topped by glowing white МАРАКУЛИН rooftop sign
    const rightWing = new THREE.Mesh(new THREE.BoxGeometry(24, 72, 18), darkCorpoMat);
    rightWing.position.set(11, 36, 0);
    marakulinVista.add(rightWing);

    const crownTex = this.createMarakulinCrownTexture();
    const crownSign = new THREE.Mesh(new THREE.PlaneGeometry(21, 7.8), this.makeSignMaterial(crownTex, 0.86));
    crownSign.position.set(11, 67.2, 9.15);
    marakulinVista.add(crownSign);

    // Small vivid crimson-pink neon sign just below-right of МАРАКУЛИН crown (screenshot accent!)
    const miniRedTex = this.createHoloAdTexture('НЕОН-24', 'КОРПО // АЛМАТЫ', '#4a061c', '#180512', '#ff2a6d');
    const miniRedSign = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 3.6), this.makeSignMaterial(miniRedTex, 0.82));
    miniRedSign.position.set(18.5, 59.8, 9.25);
    marakulinVista.add(miniRedSign);
    diorama.add(marakulinVista);

    // 3. Right-Background Tiered Cyber-Towers with Glowing Holographic Neon Ad Screens!
    const rightComplex = new THREE.Group();
    rightComplex.position.set(17.8, -h, -28.5);

    const rightTower = new THREE.Mesh(new THREE.BoxGeometry(11, 51, 11), darkSteppedFacade);
    rightTower.position.set(1.5, 25.5, -2.5);
    rightComplex.add(rightTower);

    // Stepped lower terrace deck with neon band
    const lowerDeck = new THREE.Mesh(new THREE.BoxGeometry(12.5, 38.5, 11.5), darkCorpoMat);
    lowerDeck.position.set(0, 19.25, 2.2);
    rightComplex.add(lowerDeck);

    const deckNeon = new THREE.Mesh(new THREE.BoxGeometry(12.7, 0.25, 11.7), tealTrim);
    deckNeon.position.set(0, 38.6, 2.2);
    rightComplex.add(deckNeon);

    // Bright upper holographic ad screen (cyan-magenta neon portrait ad!)
    const holoAd1Tex = this.createHoloAdTexture('КИБЕР-ХРОМ', 'КИБЕР-АЛМАТЫ // 2077', '#261447', '#083a58', '#00f0ff');
    const holoAd1 = new THREE.Mesh(new THREE.PlaneGeometry(6.8, 3.6), this.makeSignMaterial(holoAd1Tex, 0.84));
    holoAd1.position.set(-0.8, 41.6, 7.6);
    rightComplex.add(holoAd1);

    // Secondary lower bright neon ad billboard on lower terrace
    const holoAd2Tex = this.createHoloAdTexture('ТАКСИ АХМЕД', 'НОЧНОЙ РЕЙС // 24/7', '#0c2b44', '#2e1038', '#fcee0a');
    const holoAd2 = new THREE.Mesh(new THREE.PlaneGeometry(7.4, 3.1), this.makeSignMaterial(holoAd2Tex, 0.8));
    holoAd2.position.set(-1.2, 35.8, 8.15);
    rightComplex.add(holoAd2);

    diorama.add(rightComplex);

    group.add(diorama);

    // Street-level glowing elevator pad to reach rooftop
    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(2.2, 2.5, 0.35, 16),
      this.makeNeonStripMaterial(0xb537f2, 1.5),
    );
    pad.position.set(cx - 16.5, 0.18, cz - 8);
    group.add(pad);

    const padTex = this.textures.getNeonSign('ЛИФТ НА КРЫШУ', 'СМОТРОВАЯ // ТОЧКА НЕВОЗВРАТА', '#b537f2', '#00f0ff');
    const padSign = new THREE.Mesh(new THREE.PlaneGeometry(8, 2.1), this.makeSignMaterial(padTex, 0.78));
    padSign.position.set(cx - 14.3, 4.2, cz - 8);
    padSign.rotation.y = -Math.PI / 2;
    group.add(padSign);

    // Rooftop return elevator pad & glowing sign at (154, 36, 155) matching rooftop_elevator_down
    const downPad = new THREE.Mesh(
      new THREE.CylinderGeometry(1.9, 2.1, 0.24, 16),
      this.makeNeonStripMaterial(0xb537f2, 1.65),
    );
    downPad.position.set(154, h + 0.14, 155);
    group.add(downPad);

    const downSignTex = this.textures.getNeonSign('ЛИФТ ВНИЗ', 'ВЕРНУТЬСЯ В КИБЕР-АЛМАТЫ // [E]', '#b537f2', '#fcee0a');
    const downSign = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 1.15), this.makeSignMaterial(downSignTex, 0.85));
    downSign.position.set(154, h + 2.15, 153.2);
    group.add(downSign);

    this.chunks.addLandmark(group);
    // Solid body collider + walkable rooftop surface + 4 invisible perimeter guardrails
    this.physics.addBox('overlook_body', cx, h * 0.5, cz, 28, h, 28);
    this.physics.addBox('overlook_rail_n', cx, h + 3, cz - 14.1, 28.6, 6, 0.5, {
      blocksSight: false,
      blocksBullets: false,
    });
    this.physics.addBox('overlook_rail_s', cx, h + 3, cz + 14.1, 28.6, 6, 0.5, {
      blocksSight: false,
      blocksBullets: false,
    });
    this.physics.addBox('overlook_rail_w', cx - 14.1, h + 3, cz, 0.5, 6, 28.6, {
      blocksSight: false,
      blocksBullets: false,
    });
    this.physics.addBox('overlook_rail_e', cx + 14.1, h + 3, cz, 0.5, 6, 28.6, {
      blocksSight: false,
      blocksBullets: false,
    });

    // Street-level colliders & minimap footprints for the 3 rooftop-vista skyscrapers
    const vistaTowers: Array<{ id: string; x: number; z: number; sx: number; sy: number; sz: number }> = [
      { id: 'vista_monolith', x: 147.4, z: 139.7, sx: 14.5, sy: 46.5, sz: 14.5 },
      { id: 'vista_right_complex', x: 156.0, z: 130.0, sx: 14.5, sy: 51.0, sz: 14.5 },
      { id: 'vista_marakulin_l', x: 90.5, z: 106.5, sx: 19.0, sy: 66.0, sz: 15.0 },
      { id: 'vista_marakulin_r', x: 104.7, z: 91.2, sx: 19.0, sy: 72.0, sz: 18.0 },
    ];
    for (const vt of vistaTowers) {
      this.chunks.addChunkCollider(this.physics, vt.id, vt.x, vt.sy * 0.5, vt.z, vt.sx, vt.sy, vt.sz);
      this.minimapBuildings.push({
        minX: vt.x - vt.sx * 0.5,
        maxX: vt.x + vt.sx * 0.5,
        minZ: vt.z - vt.sz * 0.5,
        maxZ: vt.z + vt.sz * 0.5,
        color: '#1b2640',
      });
    }

    this.minimapBuildings.push({
      minX: cx - 14,
      maxX: cx + 14,
      minZ: cz - 14,
      maxZ: cz + 14,
      color: '#b537f2',
    });
  }

  /**
   * Builds visible 3D interactive set-piece props for open-world gigs (Samir's Malorian Stash
   * & Cyber-Tastak Marakulin Surveillance Relay) so objectives are never invisible floating prompts.
   */
  private buildOpenWorldGigProps(): void {
    const steelMat = new THREE.MeshStandardMaterial({ color: 0x161d2c, metalness: 0.72, roughness: 0.36 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x101420, metalness: 0.6, roughness: 0.45 });

    // 1. Samir's Malorian S-3516 Tactical Weapons Stash at (-165, 0, -78)
    const stashGroup = new THREE.Group();
    stashGroup.position.set(-165, 0, -78);
    const crate = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.85, 1.1), steelMat);
    crate.position.y = 0.425;
    stashGroup.add(crate);

    const stashBeaconMat = this.makeNeonStripMaterial(0xfcee0a, 2.0);
    const crateTrim = new THREE.Mesh(new THREE.BoxGeometry(1.76, 0.08, 1.16), stashBeaconMat);
    crateTrim.position.y = 0.86;
    stashGroup.add(crateTrim);

    // Floating holographic Malorian pistol silhouette above stash crate
    const holoGun = new THREE.Group();
    const gunSlide = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.14, 0.56), stashBeaconMat);
    const gunGrip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.24, 0.12), stashBeaconMat);
    gunGrip.position.set(0, -0.15, 0.18);
    gunGrip.rotation.x = 0.22;
    holoGun.add(gunSlide, gunGrip);
    holoGun.position.set(0, 1.38, 0);
    stashGroup.add(holoGun);

    const stashSignTex = this.textures.getNeonSign('ТАЙНИК САМИРА', 'MALORIAN S-3516 // [E]', '#fcee0a', '#ff003c');
    const stashSign = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.9), this.makeSignMaterial(stashSignTex, 0.9));
    stashSign.position.set(0, 2.25, 0);
    stashGroup.add(stashSign);

    this.chunks.addToChunk(-165, -78, stashGroup);
    this.chunks.addChunkCollider(this.physics, 'gig_malorian_crate', -165, 0.45, -78, 1.7, 0.9, 1.1, {
      blocksSight: false,
    });
    this.gigPropMats.set('gig_malorian', { beaconMat: stashBeaconMat, propMesh: holoGun });

    // 2. Cyber-Tastak Marakulin Surveillance Relay Terminal at (-82, 0, -162)
    const relayGroup = new THREE.Group();
    relayGroup.position.set(-82, 0, -162);
    const relayBase = new THREE.Mesh(new THREE.BoxGeometry(1.8, 2.4, 1.1), darkMat);
    relayBase.position.y = 1.2;
    relayGroup.add(relayBase);

    const relayMast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 4.6, 8), steelMat);
    relayMast.position.set(0, 4.5, -0.2);
    relayGroup.add(relayMast);

    const relayBeaconMat = this.makeNeonStripMaterial(0xff003c, 2.1);
    const relayDish = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.08, 8, 20), relayBeaconMat);
    relayDish.position.set(0, 6.2, -0.1);
    relayGroup.add(relayDish);

    const relayScreenTex = this.textures.getNeonSign(
      'КОРПО-РЕТРАНСЛЯТОР',
      'MARAKULIN NET // [E] ВЗЛОМ',
      '#ff003c',
      '#00f0ff',
    );
    const relayScreen = new THREE.Mesh(new THREE.PlaneGeometry(1.55, 0.8), this.makeSignMaterial(relayScreenTex, 1.0));
    relayScreen.position.set(0, 1.65, 0.58);
    relayGroup.add(relayScreen);

    this.chunks.addToChunk(-82, -162, relayGroup);
    this.chunks.addChunkCollider(this.physics, 'gig_tastak_relay', -82, 1.2, -162, 1.8, 2.4, 1.1, {
      blocksSight: false,
    });
    this.gigPropMats.set('gig_tastak_hack', { beaconMat: relayBeaconMat });
  }

  setGigPropCompleted(gigId: string, completed: boolean): void {
    const entry = this.gigPropMats.get(gigId);
    if (!entry) return;
    if (completed) {
      entry.beaconMat.color.setHex(0x00ff88);
      entry.beaconMat.emissive.setHex(0x00ff88);
      entry.beaconMat.emissiveIntensity = 1.2;
      if (entry.propMesh) entry.propMesh.visible = false;
    } else {
      const hex = gigId === 'gig_malorian' ? 0xfcee0a : 0xff003c;
      entry.beaconMat.color.setHex(hex);
      entry.beaconMat.emissive.setHex(hex);
      entry.beaconMat.emissiveIntensity = 2.0;
      if (entry.propMesh) entry.propMesh.visible = true;
    }
  }

  setMotelLocked(locked: boolean): void {
    if (this.motelLockDoorMesh) {
      this.motelLockDoorMesh.visible = locked;
    }
    this.physics.setActive('motel_entry_lock', locked);
  }

  // ---------------------------------------------------------------------------
  // Procedural Cyber-Almaty City Blocks (Architectural Neon, Antennas, Balconies)
  // ---------------------------------------------------------------------------

  private buildProceduralCityBlocks(): void {
    const accents = ['#00f0ff', '#ff2a6d', '#fcee0a', '#b537f2', '#00ffaa'];
    const facades = accents.map(
      (hex, i) =>
        new THREE.MeshStandardMaterial({
          map: this.textures.getBuildingFacade(hex, i % 2 === 0 ? '#0d1324' : '#131628', 2, 4),
          roughness: 0.44,
          metalness: 0.54,
        }),
    );
    const neonStripMats = accents.map((hex) => this.makeNeonStripMaterial(hex, 1.5));
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x0a0f1c, roughness: 0.68, metalness: 0.46 });
    const antennaMat = new THREE.MeshStandardMaterial({ color: 0x263147, roughness: 0.4, metalness: 0.82 });
    const beaconMat = this.makeNeonStripMaterial(0xff1e3c, 1.8);
    this.blinkingBeacons.push(beaconMat);

    // Reserved centers where special landmarks, quests, rooftop vista towers, or roads exist
    const isReserved = (x: number, z: number): boolean => {
      // Road lanes
      if (Math.abs(x) < 22 || Math.abs(z) < 22) return true;
      if (Math.abs(Math.abs(x) - 115) < 16 || Math.abs(Math.abs(z) - 115) < 16) return true;
      if (Math.abs(x) > 202 || Math.abs(z) > 202) return true;
      // Marum hub
      if (Math.hypot(x - -46, z - -40) < 28) return true;
      // Artem motel
      if (Math.hypot(x - -165, z - -165) < 30) return true;
      // Junkyard awakening pit
      if (Math.hypot(x - -165, z - 165) < 36) return true;
      // Marakulin tower plaza
      if (Math.hypot(x - 170, z - -170) < 48) return true;
      // Kok-Tobe Overlook building + pad + dedicated rooftop vista skyline corridor!
      if (Math.hypot(x - 165, z - 165) < 34) return true;
      if (Math.hypot(x - 148, z - 140) < 20) return true; // Secure Your Soul monolith
      if (Math.hypot(x - 157, z - 131) < 18) return true; // Right holo-ad complex
      if (Math.hypot(x - 96, z - 98) < 28) return true; // Stepped Marakulin vista skyscraper
      // Gig arenas
      if (Math.hypot(x - -165, z - -78) < 22) return true; // Samir stash
      if (Math.hypot(x - -158, z - 82) < 22) return true; // Junkyard scavs
      if (Math.hypot(x - 165, z - 75) < 24) return true; // Cyberpsycho arena
      if (Math.hypot(x - -82, z - -162) < 22) return true; // Tastak relays
      return false;
    };

    const labels: Array<[string, string]> = [
      ['КИБЕР-АЛМАТЫ 2077', 'НЕОН // ХРОМ // ЕБЛАНХАНА'],
      ['КИБЕР-АХМЕД ТАКСИ', 'ВЫЗОВ [C] // БЕЗ ПРОБОК'],
      ['МАРАКУЛИН КОРП', 'БУДУЩЕЕ ПРИНАДЛЕЖИТ НАМ'],
      ['КИБЕР-ТАСТАК', 'ИМПЛАНТЫ СО СКИДКОЙ 40%'],
      ['ПЕСНИ МИНТИМЕРА', 'ТУР ПО ЕБЛАНХАНЕ // LIVE'],
    ];

    let idx = 0;
    for (let gx = -188; gx <= 188; gx += 34) {
      for (let gz = -188; gz <= 188; gz += 34) {
        if (isReserved(gx, gz)) continue;

        const seed = Math.abs(Math.sin(gx * 12.9898 + gz * 78.233) * 43758.5453) % 1;
        const w = 16 + Math.floor(seed * 10);
        const d = 16 + Math.floor(((seed * 17) % 1) * 10);
        const isCorpo = gx > 35 && gz < 35;
        const isJunk = gx < -35 && gz > 35;
        const h = isCorpo
          ? 34 + Math.floor(((seed * 31) % 1) * 44)
          : isJunk
            ? 8 + Math.floor(((seed * 23) % 1) * 14)
            : 16 + Math.floor(((seed * 29) % 1) * 26);

        const accentIdx = idx % facades.length;
        const bGroup = new THREE.Group();
        bGroup.position.set(gx, 0, gz);

        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), facades[accentIdx]);
        mesh.position.y = h * 0.5;
        bGroup.add(mesh);

        // Rooftop AC/mechanical housing cap
        const cap = new THREE.Mesh(new THREE.BoxGeometry(w * 0.62, 1.6, d * 0.62), roofMat);
        cap.position.y = h + 0.8;
        bGroup.add(cap);

        // Glowing architectural neon roof rim (emissiveIntensity: 1.5)
        if (idx % 2 === 0) {
          const rim = new THREE.Mesh(new THREE.BoxGeometry(w + 0.45, 0.48, d + 0.45), neonStripMats[accentIdx]);
          rim.position.y = h - 0.45;
          bGroup.add(rim);
        }

        // Vertical corner glowing architectural neon strip on taller buildings
        if (h >= 24 && idx % 3 !== 0) {
          const strip = new THREE.Mesh(new THREE.BoxGeometry(0.32, h * 0.84, 0.32), neonStripMats[accentIdx]);
          strip.position.set(w * 0.5 + 0.08, h * 0.5, d * 0.5 + 0.08);
          bGroup.add(strip);
        }

        // Protruding cyber-balcony ledges on mid/high-rise buildings
        if (h >= 18 && idx % 3 === 1) {
          const balY = Math.min(h - 5, 11);
          const balcony = new THREE.Mesh(new THREE.BoxGeometry(w * 0.72, 0.45, 1.4), roofMat);
          balcony.position.set(0, balY, d * 0.5 + 0.65);
          bGroup.add(balcony);
          const balTrim = new THREE.Mesh(new THREE.BoxGeometry(w * 0.72, 0.14, 0.16), neonStripMats[accentIdx]);
          balTrim.position.set(0, balY + 0.25, d * 0.5 + 1.32);
          bGroup.add(balTrim);
        }

        // Rooftop radio antennas with red aviation beacons
        if (h >= 22 && idx % 2 === 1) {
          const antH = 7 + (idx % 5) * 2.2;
          const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.22, antH, 6), antennaMat);
          pole.position.set(w * 0.18, h + 1.5 + antH * 0.5, -d * 0.15);
          bGroup.add(pole);
          const tip = new THREE.Mesh(new THREE.SphereGeometry(0.32, 6, 6), beaconMat);
          tip.position.set(w * 0.18, h + 1.5 + antH, -d * 0.15);
          bGroup.add(tip);
        }

        // Cyrillic Cyber-Almaty district billboards (Bolt 1 MeshStandardMaterial standard)
        if (idx % 5 === 0) {
          const [t, s] = labels[idx % labels.length];
          const bTex = this.textures.getNeonSign(t, s, accents[accentIdx], '#ffffff');
          const sign = new THREE.Mesh(new THREE.PlaneGeometry(11.5, 2.9), this.makeSignMaterial(bTex, 0.78));
          sign.position.set(0, Math.min(h - 3.5, 12.5), d * 0.5 + 0.26);
          bGroup.add(sign);
        }

        this.chunks.addToChunk(gx, gz, bGroup);
        this.chunks.addChunkCollider(this.physics, `bldg_${idx}`, gx, h * 0.5, gz, w, h, d);
        this.minimapBuildings.push({
          minX: gx - w * 0.5,
          maxX: gx + w * 0.5,
          minZ: gz - d * 0.5,
          maxZ: gz + d * 0.5,
          color: isCorpo ? '#3a1b2b' : isJunk ? '#352b18' : '#1b2640',
        });
        idx++;
      }
    }
  }

  private buildStreetFurniture(): void {
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x1e283b, metalness: 0.8, roughness: 0.3 });
    const cyanBulb = this.makeNeonStripMaterial(0x00f0ff, 1.5);
    const pinkBulb = this.makeNeonStripMaterial(0xff2a6d, 1.5);

    // Streetlights along Prospekt Abaya (Z=±14) and Seifullin Ave (X=±14) streamed into chunks
    for (let pos = -200; pos <= 200; pos += 40) {
      if (Math.abs(pos) < 20) continue;
      for (const side of [-14, 14]) {
        const lamp1 = new THREE.Group();
        const p1 = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 7.5, 6), poleMat);
        p1.position.y = 3.75;
        lamp1.add(p1);
        const head1 = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.22, 0.4), side > 0 ? cyanBulb : pinkBulb);
        head1.position.set(0, 7.5, -Math.sign(side) * 0.6);
        lamp1.add(head1);
        lamp1.position.set(pos, 0, side);
        this.chunks.addToChunk(pos, side, lamp1);

        if (Math.abs(pos) % 80 === 0) {
          const lampColor = side > 0 ? 0x00e5ff : 0xff2a6d;
          this.registerLightAnchor(pos, 7.1, side, lampColor, 2.5, 24);
          this.registerLightAnchor(side, 7.1, pos, lampColor, 2.5, 24);
        }

        // Cross boulevard lamp
        const lamp2 = lamp1.clone();
        lamp2.position.set(side, 0, pos);
        lamp2.rotation.y = Math.PI / 2;
        this.chunks.addToChunk(side, pos, lamp2);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Flying Neon AV Skyline Traffic (8 Sleek Cyberpunk AVs)
  // ---------------------------------------------------------------------------

  private buildFlyingAVTraffic(): void {
    const hullMat = new THREE.MeshStandardMaterial({ color: 0x111726, roughness: 0.28, metalness: 0.82 });
    const canopyMat = new THREE.MeshStandardMaterial({
      color: 0x091a2e,
      emissive: 0x083858,
      emissiveIntensity: 0.65,
      roughness: 0.12,
      metalness: 0.9,
    });
    const headLightMat = this.makeNeonStripMaterial(0x00f0ff, 2.2);
    const tailLightMat = this.makeNeonStripMaterial(0xff003c, 2.2);
    const thrusterMat = this.makeNeonStripMaterial(0x55d8ff, 1.9);

    const createAVMesh = (): THREE.Group => {
      const av = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.85, 5.2), hullMat);
      av.add(body);

      const canopy = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.52, 2.4), canopyMat);
      canopy.position.set(0, 0.56, 0.2);
      av.add(canopy);

      // Side thruster pods
      for (const sx of [-1.35, 1.35]) {
        const pod = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.5, 3.4), hullMat);
        pod.position.set(sx, -0.08, -0.2);
        av.add(pod);
        const pad = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.14, 1.2), thrusterMat);
        pad.position.set(sx, -0.36, -0.2);
        av.add(pad);
      }

      // Twin cyan headlights (+Z nose)
      for (const hx of [-0.72, 0.72]) {
        const hl = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.18, 0.18), headLightMat);
        hl.position.set(hx, -0.05, 2.62);
        av.add(hl);
      }

      // Full-width crimson taillight bar (-Z tail)
      const tailBar = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.2, 0.18), tailLightMat);
      tailBar.position.set(0, 0.05, -2.62);
      av.add(tailBar);

      return av;
    };

    const specs: Array<Omit<FlyingAVState, 'group'>> = [
      // Prospekt Abaya E/W sky-lanes
      { mode: 'line', axis: 'x', lanePos: -10, altitude: 34, speed: 32, dir: 1, phase: 0.1 },
      { mode: 'line', axis: 'x', lanePos: 12, altitude: 44, speed: 38, dir: -1, phase: 0.55 },
      // Seifullin N/S sky-lanes
      { mode: 'line', axis: 'z', lanePos: -12, altitude: 38, speed: 35, dir: 1, phase: 0.3 },
      { mode: 'line', axis: 'z', lanePos: 10, altitude: 52, speed: 40, dir: -1, phase: 0.78 },
      // Rooftop vista diagonal / outer skyline cruisers (visible right over Kok-Tobe Overlook!)
      { mode: 'line', axis: 'x', lanePos: 115, altitude: 48, speed: 30, dir: -1, phase: 0.2 },
      { mode: 'line', axis: 'z', lanePos: 115, altitude: 58, speed: 28, dir: -1, phase: 0.65 },
      // Corporate orbits around Marakulin Tower & central skyline
      { mode: 'orbit', lanePos: 0, altitude: 68, speed: 0.16, dir: 1, phase: 0.0, centerX: 155, centerZ: -140, radiusX: 72, radiusZ: 64 },
      { mode: 'orbit', lanePos: 0, altitude: 54, speed: 0.13, dir: -1, phase: 2.4, centerX: 60, centerZ: 55, radiusX: 95, radiusZ: 82 },
    ];

    for (const s of specs) {
      const group = createAVMesh();
      this.chunks.addLandmark(group);
      this.avFleet.push({ group, ...s });
    }
  }

  // ---------------------------------------------------------------------------
  // Lightweight 3D Cyber-Rain Particle System
  // ---------------------------------------------------------------------------

  private buildCyberRain(): void {
    const count = this.rainCount;
    this.rainPositions = new Float32Array(count * 6); // 2 vertices per rain streak
    this.rainOffsets = new Float32Array(count * 3); // relative x, y, z inside volume
    this.rainSpeeds = new Float32Array(count);
    const colors = new Float32Array(count * 6);

    const spreadX = 68;
    const spreadY = 38;
    const spreadZ = 68;

    for (let i = 0; i < count; i++) {
      const rx = (Math.random() - 0.5) * spreadX;
      const ry = Math.random() * spreadY;
      const rz = (Math.random() - 0.5) * spreadZ;
      this.rainOffsets[i * 3] = rx;
      this.rainOffsets[i * 3 + 1] = ry;
      this.rainOffsets[i * 3 + 2] = rz;
      this.rainSpeeds[i] = 22 + Math.random() * 11;

      // Neon-tinted rain palette: cyan, ice-blue, subtle violet
      const tone = i % 7;
      const r = tone === 0 ? 0.82 : tone < 3 ? 0.12 : 0.42;
      const g = tone === 0 ? 0.38 : tone < 3 ? 0.92 : 0.78;
      const b = 1.0;

      // Dimmer top vertex, brighter bottom droplet head
      const cIdx = i * 6;
      colors[cIdx] = r * 0.45;
      colors[cIdx + 1] = g * 0.45;
      colors[cIdx + 2] = b * 0.55;
      colors[cIdx + 3] = r;
      colors[cIdx + 4] = g;
      colors[cIdx + 5] = b;
    }

    const geo = new THREE.BufferGeometry();
    const posAttr = new THREE.BufferAttribute(this.rainPositions, 3);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', posAttr);
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    });

    this.rainLines = new THREE.LineSegments(geo, mat);
    this.rainLines.frustumCulled = false;
    this.chunks.addLandmark(this.rainLines);
  }

  private registerInteractables(): void {
    this.interactables.push(
      {
        id: 'ripperdoc_marum',
        label: '[E] РИПЕРДОК «МАРУМА» — ИМПЛАНТЫ И ОРУЖИЕ',
        x: -53.5,
        y: 1.2,
        z: -44,
        radius: 3.6,
        enabled: true,
        category: 'ripperdoc',
      },
      {
        id: 'gig_board_marum',
        label: '[E] ТЕРМИНАЛ ЗАКАЗОВ ЕБЛАНХАНЫ',
        x: -38.8,
        y: 1.4,
        z: -43,
        radius: 3.4,
        enabled: true,
        category: 'gig',
      },
      {
        id: 'rooftop_elevator_up',
        label: '[E] ПОДНЯТЬСЯ НА СМОТРОВУЮ КРЫШУ (ТОЧКА НЕВОЗВРАТА)',
        x: 148.5,
        y: 1.2,
        z: 157,
        radius: 3.8,
        enabled: true,
        category: 'elevator',
      },
      {
        id: 'rooftop_start_assault',
        label: '[E] ПОГОВОРИТЬ С САМИРОМ И НАЧАТЬ ШТУРМ МАРАКУЛИН ТАУЭР',
        x: 163,
        y: 37.2,
        z: 163,
        radius: 4.0,
        enabled: true,
        category: 'story',
      },
      {
        id: 'rooftop_elevator_down',
        label: '[E] СПУСТИТЬСЯ ОБРАТНО В КИБЕР-АЛМАТЫ',
        x: 154,
        y: 37.2,
        z: 155,
        radius: 3.6,
        enabled: true,
        category: 'elevator',
      },
      {
        id: 'motel_sink',
        label: '[E] УМЫТЬСЯ В ВАННОЙ',
        x: -172.6,
        y: 1.2,
        z: -173.2,
        radius: 3.4,
        enabled: false,
        category: 'story',
      },
      {
        id: 'gig_malorian_stash',
        label: '[E] ЗАБРАТЬ MALORIAN S-3516 САМИРА',
        x: -165,
        y: 1.0,
        z: -78,
        radius: 3.5,
        enabled: false,
        category: 'loot',
      },
      {
        id: 'gig_tastak_terminal',
        label: '[E] ВЗЛОМАТЬ КОРПО-РЕТРАНСЛЯТОР ТАСТАКА',
        x: -82,
        y: 1.4,
        z: -162,
        radius: 3.6,
        enabled: false,
        category: 'gig',
      },
    );
  }

  // ---------------------------------------------------------------------------
  // Public Accessors & Story Helpers
  // ---------------------------------------------------------------------------

  /**
   * Returns the exact seated cinematic camera pose facing Samir on the Kok-Tobe Overlook parapet,
   * matching the framing of IMG-20261123-WA0011.jpg.
   */
  getRooftopCameraPose(): RooftopCameraPose {
    return {
      position: { x: 165.45, y: 37.48, z: 165.45 },
      lookAt: { x: 163.0, y: 37.14, z: 163.0 },
      fov: 54,
    };
  }

  getSamirRooftopRig(): CharacterRig {
    return this.samirRooftopRig;
  }

  getMotelArtemRig(): CharacterRig {
    return this.motelArtemRig;
  }

  getMotelBodyguardRig(): CharacterRig {
    return this.motelBodyguardRig;
  }

  /**
   * Positions and poses Artem's massive cyber-bodyguard either intimidatingly beside the motel
   * bathroom doorway (active=false) or directly face-to-face in front of Ai's bathroom camera
   * with both armored arms outstretched forward choking Ai's throat (active=true).
   */
  setMotelBodyguardChokePose(active: boolean): void {
    this.motelBodyguardChoking = active;
    const rig = this.motelBodyguardRig;
    if (active) {
      rig.group.visible = true;
      rig.group.position.set(-170.2, 0.25, -171.6);
      // Face directly toward Ai/sink at (-171.5, 0.25, -172.6)
      rig.group.rotation.y = Math.atan2(-171.5 - -170.2, -172.6 - -171.6);
      rig.leftArm.rotation.set(-1.42, -0.22, -0.14);
      rig.rightArm.rotation.set(-1.42, 0.22, 0.14);
      if (rig.leftForearm) rig.leftForearm.rotation.set(-0.2, 0, -0.18);
      if (rig.rightForearm) rig.rightForearm.rotation.set(-0.2, 0, 0.18);
      if (rig.torso) rig.torso.rotation.set(0.12, 0, 0);
      rig.head.rotation.set(0.08, 0, 0);
    } else {
      rig.group.position.set(-165.5, 0.25, -169.8);
      rig.group.rotation.y = 0.08;
      rig.leftArm.rotation.set(0, 0, 0.06);
      rig.rightArm.rotation.set(0, 0, -0.06);
      if (rig.leftForearm) rig.leftForearm.rotation.set(0, 0, 0);
      if (rig.rightForearm) rig.rightForearm.rotation.set(0, 0, 0);
      if (rig.torso) rig.torso.rotation.set(0, 0, 0);
      rig.head.rotation.set(0, 0, 0);
    }
  }

  positionMotelBodyguardForChoke(active = true): void {
    this.setMotelBodyguardChokePose(active);
  }

  setInteractableEnabled(id: string, enabled: boolean): void {
    const it = this.interactables.find((i) => i.id === id);
    if (it) it.enabled = enabled;
  }

  setStoryProps(opts: {
    samirRooftop?: boolean;
    samirJunkyard?: boolean;
    artemCorpse?: boolean;
    egorMarum?: boolean;
    motelArtem?: boolean;
    motelBodyguard?: boolean;
  }): void {
    if (opts.samirRooftop !== undefined) this.samirRooftopRig.group.visible = opts.samirRooftop;
    if (opts.samirJunkyard !== undefined) this.samirJunkyardRig.group.visible = opts.samirJunkyard;
    if (opts.artemCorpse !== undefined) this.artemCorpseGroup.visible = opts.artemCorpse;
    if (opts.egorMarum !== undefined) this.egorMarumRig.group.visible = opts.egorMarum;
    if (opts.motelArtem !== undefined) this.motelArtemRig.group.visible = opts.motelArtem;
    if (opts.motelBodyguard !== undefined) {
      this.motelBodyguardRig.group.visible = opts.motelBodyguard;
      if (!opts.motelBodyguard) {
        this.setMotelBodyguardChokePose(false);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Frame Update (Seated Samir, Rooftop Steam, Rain, AV Traffic, Neon Flicker)
  // ---------------------------------------------------------------------------

  update(elapsed: number, playerPos?: Vec3): void {
    const dt = Math.max(0.001, Math.min(0.05, elapsed - this.lastElapsed));
    this.lastElapsed = elapsed;

    // 1. Character rig animations
    if (this.samirRooftopRig.group.visible) {
      animateSeatedSamir(this.samirRooftopRig, elapsed, 1.0);
    }
    if (this.samirJunkyardRig.group.visible) {
      animateHologramRig(this.samirJunkyardRig, elapsed);
    }
    if (this.motelArtemRig.group.visible) {
      this.motelArtemRig.head.rotation.y = Math.sin(elapsed * 0.9) * 0.14;
      this.motelArtemRig.rightArm.rotation.x = -0.32 + Math.sin(elapsed * 1.4) * 0.04;
    }
    if (this.motelBodyguardRig.group.visible) {
      if (this.motelBodyguardChoking) {
        // Violent choke struggle shaking directly in front of Ai's bathroom camera
        const rig = this.motelBodyguardRig;
        rig.group.position.set(
          -170.2 + Math.sin(elapsed * 34.0) * 0.035,
          0.25 + Math.cos(elapsed * 41.0) * 0.018,
          -171.6 + Math.sin(elapsed * 29.0) * 0.03,
        );
        rig.leftArm.rotation.set(
          -1.42 + Math.sin(elapsed * 32.0) * 0.08,
          -0.22 + Math.sin(elapsed * 26.0) * 0.06,
          -0.14 + Math.cos(elapsed * 30.0) * 0.05,
        );
        rig.rightArm.rotation.set(
          -1.42 + Math.cos(elapsed * 35.0) * 0.08,
          0.22 - Math.sin(elapsed * 26.0) * 0.06,
          0.14 - Math.cos(elapsed * 30.0) * 0.05,
        );
        if (rig.torso) {
          rig.torso.rotation.x = 0.12 + Math.sin(elapsed * 28.0) * 0.05;
          rig.torso.rotation.z = Math.sin(elapsed * 23.0) * 0.04;
        }
        rig.head.rotation.set(0.08 + Math.sin(elapsed * 19.0) * 0.04, Math.sin(elapsed * 24.0) * 0.08, 0);
      } else {
        this.motelBodyguardRig.head.rotation.y = Math.sin(elapsed * 0.75) * 0.18;
      }
    }

    // 2. Floating Marum hologram sign
    for (const s of this.hologramSigns) {
      s.mesh.position.y = s.baseY + Math.sin(elapsed * 2.1) * 0.08;
    }

    // 3. Rooftop billowing orange-red steam puffs
    for (const p of this.steamPuffs) {
      const t = (p.phase + elapsed * p.speed) % 1;
      const fadeIn = Math.min(1, t * 4.2);
      const fadeOut = Math.max(0, 1 - Math.max(0, (t - 0.38) / 0.62));
      p.mesh.position.set(
        p.baseX + p.driftX * t + Math.sin(elapsed * 1.4 + p.phase * 12) * 0.22,
        p.baseY + p.maxRise * t,
        p.baseZ + p.driftZ * t,
      );
      const sc = p.baseScale * (0.72 + t * 1.55);
      p.mesh.scale.set(sc, sc * 1.15, 1);
      p.mesh.rotation.z = (p.phase * 6.28) + t * 0.9;
      p.mat.opacity = fadeIn * fadeOut * 0.44;
    }

    // 4. Sleazy Motel flickering red neon sign, bathroom fluorescent tube & CRT wall TV
    const buzz = Math.sin(elapsed * 29.0) * Math.sin(elapsed * 7.3) > 0.74 ? 0.28 : 1.0;
    if (this.motelNeonSignMat) {
      this.motelNeonSignMat.emissiveIntensity = 0.84 * buzz;
    }
    if (this.motelBedNeonMat) {
      this.motelBedNeonMat.emissiveIntensity = 1.65 * (buzz < 0.5 ? 0.52 : 1.0);
    }
    if (this.motelBathTubeMat) {
      const bathFlicker = Math.sin(elapsed * 37.0) * Math.sin(elapsed * 11.7) > 0.78 ? 0.32 : 1.0;
      this.motelBathTubeMat.emissiveIntensity = 1.85 * bathFlicker;
    }
    if (this.motelTvMat) {
      this.motelTvMat.emissiveIntensity = 0.86 + Math.sin(elapsed * 19.0) * 0.1 + Math.sin(elapsed * 43.0) * 0.05;
    }

    // 5. Blinking rooftop aviation beacons
    const beaconGlow = Math.sin(elapsed * 3.1) > 0.25 ? 2.0 : 0.25;
    for (const b of this.blinkingBeacons) {
      b.emissiveIntensity = beaconGlow;
    }

    // 6. Flying Neon AV Skyline Traffic
    const halfSpan = WORLD_HALF - 15;
    const span = halfSpan * 2;
    for (const av of this.avFleet) {
      if (av.mode === 'line') {
        const travel = ((elapsed * av.speed + av.phase * span) % span) - halfSpan;
        const pos = travel * av.dir;
        const bob = Math.sin(elapsed * 2.2 + av.phase * 10) * 0.45;
        if (av.axis === 'x') {
          av.group.position.set(pos, av.altitude + bob, av.lanePos);
          av.group.rotation.y = av.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
        } else {
          av.group.position.set(av.lanePos, av.altitude + bob, pos);
          av.group.rotation.y = av.dir > 0 ? 0 : Math.PI;
        }
      } else {
        const angle = elapsed * av.speed * av.dir + av.phase;
        const rx = av.radiusX ?? 80;
        const rz = av.radiusZ ?? 80;
        const x = (av.centerX ?? 0) + Math.cos(angle) * rx;
        const z = (av.centerZ ?? 0) + Math.sin(angle) * rz;
        const dx = -Math.sin(angle) * rx * av.dir;
        const dz = Math.cos(angle) * rz * av.dir;
        av.group.position.set(x, av.altitude + Math.sin(elapsed * 1.8 + av.phase) * 0.6, z);
        av.group.rotation.y = Math.atan2(dx, dz);
      }
    }

    // 7. 3D Cyber-Rain Streaks following player (hidden while indoors inside Marum or Motel 204)
    const isIndoors =
      playerPos !== undefined &&
      ((playerPos.x >= -58 &&
        playerPos.x <= -34 &&
        playerPos.z >= -51 &&
        playerPos.z <= -29 &&
        playerPos.y < 7) ||
        (playerPos.x >= -176 &&
          playerPos.x <= -154 &&
          playerPos.z >= -176 &&
          playerPos.z <= -154 &&
          playerPos.y < 5.8));

    this.rainLines.visible = !isIndoors;
    if (isIndoors) {
      return;
    }

    const centerX = playerPos ? playerPos.x : this.samirRooftopRig.group.visible ? 165 : 0;
    const centerY = playerPos ? playerPos.y : this.samirRooftopRig.group.visible ? 36 : 4;
    const centerZ = playerPos ? playerPos.z : this.samirRooftopRig.group.visible ? 165 : 0;

    const spreadY = 38;
    const streakLen = 1.05;
    const windX = 0.14;
    const windZ = 0.08;
    const pos = this.rainPositions;
    const off = this.rainOffsets;

    for (let i = 0; i < this.rainCount; i++) {
      const oi = i * 3;
      let ry = off[oi + 1] - this.rainSpeeds[i] * dt;
      if (ry < -4) {
        ry += spreadY;
      }
      off[oi + 1] = ry;

      const wx = centerX + off[oi];
      const wy = centerY + ry;
      const wz = centerZ + off[oi + 2];

      const vi = i * 6;
      pos[vi] = wx;
      pos[vi + 1] = wy;
      pos[vi + 2] = wz;
      pos[vi + 3] = wx + windX;
      pos[vi + 4] = wy - streakLen;
      pos[vi + 5] = wz + windZ;
    }

    const attr = this.rainLines.geometry.getAttribute('position') as THREE.BufferAttribute;
    attr.needsUpdate = true;
  }

  dispose(): void {
    for (const tex of this.localTextures) {
      tex.dispose();
    }
    this.localTextures.length = 0;
  }
}

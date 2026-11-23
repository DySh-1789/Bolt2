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
  readonly motelSinkPos: Vec3 = { x: -172, y: 0, z: -170 };
  readonly towerEntrancePos: Vec3 = { x: 170, y: 0, z: -136 };

  private samirRooftopRig!: CharacterRig;
  private samirJunkyardRig!: CharacterRig;
  private egorMarumRig!: CharacterRig;
  private motelArtemRig!: CharacterRig;
  private motelBodyguardRig!: CharacterRig;
  private artemCorpseGroup = new THREE.Group();

  private hologramSigns: Array<{ mesh: THREE.Mesh; baseY: number }> = [];
  private steamPuffs: SteamPuffState[] = [];
  private rooftopSteamLight?: THREE.PointLight;
  private motelNeonSignMat?: THREE.MeshStandardMaterial;
  private motelFlickerLight?: THREE.PointLight;
  private avFleet: FlyingAVState[] = [];
  private blinkingBeacons: THREE.MeshStandardMaterial[] = [];

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
    this.buildProceduralCityBlocks();
    this.buildStreetFurniture();
    this.buildFlyingAVTraffic();
    this.buildCyberRain();
    this.registerInteractables();
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

    const lampStem = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 2.8, 8), trussMat);
    lampStem.position.set(cx - 7.5, 5.1, cz - 4);
    group.add(lampStem);
    const lampRing = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.08, 8, 20), emeraldNeon);
    lampRing.rotation.x = Math.PI / 2;
    lampRing.position.set(cx - 7.5, 3.65, cz - 4);
    group.add(lampRing);

    const surgicalLight = new THREE.PointLight(0x66ffdd, 4.2, 14);
    surgicalLight.position.set(cx - 7.5, 3.4, cz - 4);
    this.chunks.addToChunk(cx, cz, surgicalLight);

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

    // Egor model (hidden until Marum epilogue)
    this.egorMarumRig = buildEgorModel();
    this.egorMarumRig.group.position.set(cx, 0.25, cz + 1.5);
    this.egorMarumRig.group.rotation.y = Math.PI;
    this.egorMarumRig.group.visible = false;
    group.add(this.egorMarumRig.group);

    // Warm cyberpunk lounge illumination
    const mainLight = new THREE.PointLight(0x00e5ff, 4.4, 28);
    mainLight.position.set(cx, 5.6, cz + 1);
    this.chunks.addToChunk(cx, cz, mainLight);

    const barWarmLight = new THREE.PointLight(0xffaa33, 3.4, 18);
    barWarmLight.position.set(cx, 4.4, cz - 7.2);
    this.chunks.addToChunk(cx, cz, barWarmLight);

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
  // Gritty Artem's Motel in Cyber-Tastak (X=-165, Z=-165) — Act 4 Betrayal
  // ---------------------------------------------------------------------------

  private buildArtemMotel(): void {
    const cx = -165;
    const cz = -165;
    const group = new THREE.Group();

    const wallMat = new THREE.MeshStandardMaterial({
      map: this.textures.getWallPanel('#ff2a6d', 2, 1),
      roughness: 0.58,
      metalness: 0.42,
    });
    const floorMat = new THREE.MeshStandardMaterial({
      map: this.textures.getFloorTile('#ff2a6d', 3, 3),
      roughness: 0.48,
      metalness: 0.3,
    });
    const darkSteel = new THREE.MeshStandardMaterial({ color: 0x161a24, roughness: 0.45, metalness: 0.72 });
    const chromeMat = new THREE.MeshStandardMaterial({ color: 0xd8e4f0, roughness: 0.16, metalness: 0.94 });
    const bloodMat = new THREE.MeshStandardMaterial({
      color: 0x7d0614,
      emissive: 0x2a0206,
      emissiveIntensity: 0.35,
      roughness: 0.22,
      metalness: 0.18,
    });

    const floor = new THREE.Mesh(new THREE.BoxGeometry(24, 0.25, 22), floorMat);
    floor.position.set(cx, 0.1, cz);
    group.add(floor);

    const roof = new THREE.Mesh(new THREE.BoxGeometry(25, 1, 23), wallMat);
    roof.position.set(cx, 6.2, cz);
    group.add(roof);

    const addWall = (id: string, wx: number, wz: number, sx: number, sz: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, 6, sz), wallMat);
      m.position.set(wx, 3, wz);
      group.add(m);
      this.chunks.addChunkCollider(this.physics, id, wx, 3, wz, sx, 6, sz);
    };
    addWall('motel_back', cx, cz - 10.6, 24, 0.8);
    addWall('motel_left', cx - 11.6, cz, 0.8, 22);
    addWall('motel_right', cx + 11.6, cz, 0.8, 22);
    addWall('motel_front_l', cx - 8, cz + 10.6, 7.5, 0.8);
    addWall('motel_front_r', cx + 8, cz + 10.6, 7.5, 0.8);
    // Bathroom divider inside motel
    addWall('motel_bath_wall', cx - 3.5, cz - 4.5, 0.6, 8);

    // Bathroom Sink with chrome faucet + gritty crimson bloodstain detail (Act 4 wash-up scene)
    const sinkBase = new THREE.Mesh(
      new THREE.BoxGeometry(1.55, 0.92, 1.02),
      new THREE.MeshStandardMaterial({ color: 0x99aebf, roughness: 0.28, metalness: 0.55 }),
    );
    sinkBase.position.set(cx - 7.5, 0.56, cz - 9.4);
    group.add(sinkBase);

    const basin = new THREE.Mesh(
      new THREE.BoxGeometry(1.15, 0.14, 0.72),
      new THREE.MeshStandardMaterial({ color: 0x3a4854, roughness: 0.35, metalness: 0.4 }),
    );
    basin.position.set(cx - 7.5, 1.0, cz - 9.35);
    group.add(basin);

    // Bloody water pool & splatter in sink + drops on floor
    const bloodPool = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.04, 0.52), bloodMat);
    bloodPool.position.set(cx - 7.5, 1.07, cz - 9.35);
    group.add(bloodPool);

    const bloodRim = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.18, 0.04), bloodMat);
    bloodRim.position.set(cx - 7.25, 0.94, cz - 8.88);
    group.add(bloodRim);

    const bloodFloor = new THREE.Mesh(new THREE.CircleGeometry(0.36, 10), bloodMat);
    bloodFloor.rotation.x = -Math.PI / 2;
    bloodFloor.position.set(cx - 7.3, 0.24, cz - 8.45);
    group.add(bloodFloor);

    // Chrome faucet
    const faucetPipe = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.28, 8), chromeMat);
    faucetPipe.position.set(cx - 7.5, 1.16, cz - 9.76);
    group.add(faucetPipe);
    const faucetSpout = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.22), chromeMat);
    faucetSpout.position.set(cx - 7.5, 1.28, cz - 9.65);
    group.add(faucetSpout);

    // Chrome-framed mirror + buzzing overhead fluorescent light bar
    const mirrorFrame = new THREE.Mesh(new THREE.BoxGeometry(2.04, 1.54, 0.08), darkSteel);
    mirrorFrame.position.set(cx - 7.5, 1.92, cz - 10.14);
    group.add(mirrorFrame);

    const mirror = new THREE.Mesh(
      new THREE.PlaneGeometry(1.86, 1.36),
      new THREE.MeshStandardMaterial({
        color: 0x77ccff,
        emissive: 0x164466,
        emissiveIntensity: 0.78,
        metalness: 0.95,
        roughness: 0.07,
      }),
    );
    mirror.position.set(cx - 7.5, 1.92, cz - 10.08);
    group.add(mirror);

    const bathTube = new THREE.Mesh(
      new THREE.BoxGeometry(1.8, 0.1, 0.12),
      this.makeNeonStripMaterial(0xc8f4ff, 1.5),
    );
    bathTube.position.set(cx - 7.5, 2.86, cz - 9.95);
    group.add(bathTube);

    // Gritty motel furniture tucked cleanly against East wall (clear combat arena!)
    const bedFrame = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.55, 2.6), darkSteel);
    bedFrame.position.set(cx + 8.6, 0.45, cz - 7.4);
    group.add(bedFrame);
    const mattress = new THREE.Mesh(
      new THREE.BoxGeometry(3.9, 0.28, 2.35),
      new THREE.MeshStandardMaterial({ color: 0x451a2e, roughness: 0.82, metalness: 0.08 }),
    );
    mattress.position.set(cx + 8.6, 0.85, cz - 7.4);
    group.add(mattress);

    // Low sleazy side table + bottles
    const lowTable = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.65, 1.2), darkSteel);
    lowTable.position.set(cx + 8.8, 0.45, cz + 2.5);
    group.add(lowTable);
    const bottleGlow = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.08, 0.36, 8),
      this.makeNeonStripMaterial(0xffaa22, 1.5),
    );
    bottleGlow.position.set(cx + 8.5, 0.96, cz + 2.4);
    group.add(bottleGlow);

    // Toggleable Story Props: Artem & Bodyguard waiting in Motel room before bathroom betrayal
    this.motelArtemRig = buildArtemModel();
    this.motelArtemRig.group.position.set(cx + 3.8, 0.22, cz - 2.2);
    this.motelArtemRig.group.rotation.y = -0.35;
    this.motelArtemRig.group.visible = false;
    group.add(this.motelArtemRig.group);

    this.motelBodyguardRig = buildBodyguardModel();
    this.motelBodyguardRig.group.position.set(cx - 1.5, 0.22, cz - 3.2);
    this.motelBodyguardRig.group.rotation.y = 0.25;
    this.motelBodyguardRig.group.visible = false;
    group.add(this.motelBodyguardRig.group);

    // Flickering red neon motel sign (Bolt 1 MeshStandardMaterial standard)
    const motelSignFrame = new THREE.Mesh(new THREE.BoxGeometry(16.5, 4.0, 0.32), darkSteel);
    motelSignFrame.position.set(cx, 8.2, cz + 11.0);
    group.add(motelSignFrame);

    const motelSignTex = this.textures.getNeonSign(
      'МОТЕЛЬ «ТАСТАК»',
      'НОМЕРА ПОЧАСОВО // ОФИС АРТЁМА',
      '#ff2a6d',
      '#fcee0a',
    );
    this.motelNeonSignMat = this.makeSignMaterial(motelSignTex, 0.78);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(16, 3.6), this.motelNeonSignMat);
    sign.position.set(cx, 8.2, cz + 11.2);
    group.add(sign);

    // Flickering red neon light + warm sleazy amber interior lamp
    this.motelFlickerLight = new THREE.PointLight(0xff2255, 4.4, 24);
    this.motelFlickerLight.position.set(cx - 1, 4.8, cz + 3);
    this.chunks.addToChunk(cx, cz, this.motelFlickerLight);

    const warmSleazyLight = new THREE.PointLight(0xff8c2b, 3.0, 18);
    warmSleazyLight.position.set(cx + 6.5, 3.6, cz - 4.5);
    this.chunks.addToChunk(cx, cz, warmSleazyLight);

    this.chunks.addToChunk(cx, cz, group);
    this.minimapBuildings.push({
      minX: cx - 12,
      maxX: cx + 12,
      minZ: cz - 11,
      maxZ: cz + 11,
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

    const fireLight = new THREE.PointLight(0xff7722, 4.2, 26);
    fireLight.position.set(cx + 4.5, 2.5, cz - 4);
    this.chunks.addToChunk(cx, cz, fireLight);

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

    // Warm fiery orange-red light illuminating the steam cloud & Samir's right shoulder
    this.rooftopSteamLight = new THREE.PointLight(0xff4a18, 7.2, 16);
    this.rooftopSteamLight.position.set(-2.75, 1.95, -1.35);
    diorama.add(this.rooftopSteamLight);

    // Cool cyan skyline rim light catching Samir's chrome cyber-arm and concrete cap
    const cityRimLight = new THREE.PointLight(0x00d8ff, 3.2, 20);
    cityRimLight.position.set(2.4, 2.6, -2.5);
    diorama.add(cityRimLight);

    // Subtle soft fill light from Ai's side so Samir's face/beard/dog-tags read clearly
    const faceFillLight = new THREE.PointLight(0x88c8e8, 2.2, 10);
    faceFillLight.position.set(0.5, 2.1, 3.1);
    diorama.add(faceFillLight);

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

    this.chunks.addLandmark(group);
    // Solid body collider + walkable rooftop surface
    this.physics.addBox('overlook_body', cx, h * 0.5, cz, 28, h, 28);

    this.minimapBuildings.push({
      minX: cx - 14,
      maxX: cx + 14,
      minZ: cz - 14,
      maxZ: cz + 14,
      color: '#b537f2',
    });
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
          const pt = new THREE.PointLight(side > 0 ? 0x00e5ff : 0xff2a6d, 2.3, 24);
          pt.position.set(pos, 7.1, side);
          this.chunks.addToChunk(pos, side, pt);
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
        x: -172.5,
        y: 1.2,
        z: -173.5,
        radius: 3.2,
        enabled: false,
        category: 'story',
      },
      {
        id: 'marakulin_front_doors',
        label: '[E] ВОЙТИ В МАРАКУЛИН ТАУЭР (ШТУРМ)',
        x: 170,
        y: 1.5,
        z: -140,
        radius: 5.5,
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
    if (opts.motelBodyguard !== undefined) this.motelBodyguardRig.group.visible = opts.motelBodyguard;
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

    // 2. Floating Marum hologram sign
    for (const s of this.hologramSigns) {
      s.mesh.position.y = s.baseY + Math.sin(elapsed * 2.1) * 0.08;
    }

    // 3. Rooftop billowing orange-red steam puffs & flickering warm light
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
    if (this.rooftopSteamLight) {
      this.rooftopSteamLight.intensity = 6.8 + Math.sin(elapsed * 6.5) * 0.8 + Math.sin(elapsed * 15.3) * 0.35;
    }

    // 4. Sleazy Motel flickering red neon sign & interior bulb
    const buzz = Math.sin(elapsed * 29.0) * Math.sin(elapsed * 7.3) > 0.74 ? 0.28 : 1.0;
    if (this.motelNeonSignMat) {
      this.motelNeonSignMat.emissiveIntensity = 0.78 * buzz;
    }
    if (this.motelFlickerLight) {
      this.motelFlickerLight.intensity = 4.4 * (buzz < 0.5 ? 0.45 : 1.0);
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

    // 7. 3D Cyber-Rain Streaks following player (or rooftop/city center when playerPos omitted)
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
}

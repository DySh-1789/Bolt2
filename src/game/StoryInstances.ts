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
  buildSeatedSanzharTaxi,
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

export type StoryInstanceName =
  | 'NONE'
  | 'PENTHOUSE'
  | 'CHASE'
  | 'UNDERGROUND'
  | 'CYBERSPACE'
  | 'TALDYKORGAN';

export type PenthouseSanzharMode =
  | 'room'
  | 'approaching_closet'
  | 'inside_closet'
  | 'corridor';

interface SupplyCrateVisual {
  id: string;
  group: THREE.Group;
  glowMat: THREE.MeshStandardMaterial;
  haloMat: THREE.MeshBasicMaterial;
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
 * Uses a SINGLE shared Instance Lighting Rig (3 always-visible PointLights + 1 HemisphereLight
 * attached directly to the scene) so toggling active instances causes ZERO WebGL shader
 * recompilations and ZERO frame freezes.
 */
export class StoryInstances {
  readonly interactables: InteractablePoint[] = [];

  // Penthouse (Act 2: 2 weeks ago — Luxury Hotel Suite 9201 + Corridor + Escape Elevator)
  readonly penthouseGroup = new THREE.Group();
  readonly penthouseSanzhar: CharacterRig;
  readonly penthouseRodion: CharacterRig;
  readonly penthouseLev: CharacterRig;
  readonly penthouseSmasherProp = new THREE.Group();
  readonly biochipCase = new THREE.Group();
  readonly penthouseElevator: ElevatorRig;
  private penthouseSanzharMode: PenthouseSanzharMode = 'room';
  private penthouseCorridorLocked = true;
  private phCorridorDoorMesh: THREE.Group | null = null;
  private penthouseAvs: PenthouseAv[] = [];
  private penthouseHoloRing: THREE.Mesh | null = null;
  private penthouseSmasherLeftArm: THREE.Group | null = null;
  private penthouseSmasherRightArm: THREE.Group | null = null;

  // Taxi Chase Highway & Unobstructed Cyber-Akhmed 1st-Person Interior (Act 3)
  readonly chaseGroup = new THREE.Group();
  readonly chaseSanzhar: CharacterRig;
  private chaseArches: THREE.Group[] = [];
  private chaseSkyscrapers: THREE.Group[] = [];
  private chaseTraffic: TrafficStreak[] = [];
  private chaseSteeringWheel: THREE.Group | null = null;
  private chaseBiochip = new THREE.Group();
  private chaseBiochipVisible = false;
  private chaseBiochipProgress = 0;
  private chaseSanzharWounded = false;
  private chaseSanzharWoundMesh: THREE.Mesh | null = null;

  // Marakulin Tower Assault Atrium + Pass-Through Elevator + Smasher Arena + Huyeshi (Acts 7-8)
  readonly undergroundGroup = new THREE.Group();
  readonly undergroundSamir: CharacterRig;
  readonly undergroundElevator: ElevatorRig;
  private towerHoloSpinner: THREE.Group | null = null;
  private supplyCrates = new Map<string, SupplyCrateVisual>();
  private securityTerminalBeaconMat: THREE.MeshStandardMaterial | null = null;

  // Huyeshi Chamber Surgical / Neural Extraction Set-Piece (Z = -90)
  private huyeshiCrown = new THREE.Group();
  private huyeshiLasers = new THREE.Group();
  private huyeshiSurgicalBeamMat: THREE.MeshBasicMaterial | null = null;
  private huyeshiCrownLampMat: THREE.MeshStandardMaterial | null = null;
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

  // Shared Zero-Freeze Instance Lighting Rig (ONLY 3 PointLights + 1 HemisphereLight, ALWAYS visible!)
  private readonly instanceHemiLight: THREE.HemisphereLight;
  private readonly instanceKeyLight: THREE.PointLight;
  private readonly instanceFillLight: THREE.PointLight;
  private readonly instanceAccentLight: THREE.PointLight;
  private activeInstance: StoryInstanceName = 'NONE';

  private physics: PhysicsWorld;
  private textures: ProceduralTextures;
  private localTextures: THREE.CanvasTexture[] = [];

  constructor(scene: THREE.Scene, physics: PhysicsWorld, textures: ProceduralTextures) {
    this.physics = physics;
    this.textures = textures;

    // Shared always-visible lighting rig attached directly to the scene (NEVER toggle .visible!)
    this.instanceHemiLight = new THREE.HemisphereLight(0x88a8dc, 0x261824, 0);
    this.instanceKeyLight = new THREE.PointLight(0xffffff, 0, 56, 1.25);
    this.instanceFillLight = new THREE.PointLight(0xffffff, 0, 56, 1.25);
    this.instanceAccentLight = new THREE.PointLight(0xffffff, 0, 56, 1.25);
    scene.add(
      this.instanceHemiLight,
      this.instanceKeyLight,
      this.instanceFillLight,
      this.instanceAccentLight,
    );

    // 1. Build Penthouse Suite 9201 + Luxury Hotel Corridor + Escape Elevator (Y = 120 -> 96)
    this.penthouseSanzhar = buildSanzharModel();
    this.penthouseRodion = buildRodionModel();
    this.penthouseLev = buildLevMarakulinModel();
    this.penthouseElevator = new ElevatorRig(
      {
        id: 'penthouse_escape_elev',
        centerX: 0,
        centerZ: -38,
        startY: INSTANCE_Y.PENTHOUSE,
        endY: INSTANCE_Y.PENTHOUSE - 24,
        startFloorLabel: 92,
        endFloorLabel: 1,
        travelDuration: 3.4,
        doorFacingZ: 1,
        exitDoorFacingZ: 1,
        width: 4.4,
        depth: 4.4,
        cabinHeight: 3.6,
        accentHex: 0xfcee0a,
        accentCss: '#fcee0a',
        destinationLabel: 'ГАРАЖ КИБЕР-АХМЕДА',
      },
      this.penthouseGroup,
      physics,
      textures,
    );
    this.buildPenthouse();
    scene.add(this.penthouseGroup);

    // 2. Build Chase Track & Unobstructed Cyber-Akhmed Interior (Y = 220)
    this.chaseSanzhar = buildSeatedSanzharTaxi();
    this.chaseSanzhar.setBiochipVisible?.(false);
    this.buildChaseTrack();
    scene.add(this.chaseGroup);

    // 3. Build Marakulin Tower Lobby + Pass-Through Elevator + Smasher Arena + Huyeshi (Y = -66 / -90)
    this.undergroundSamir = buildSamirHologram();
    this.undergroundElevator = new ElevatorRig(
      {
        id: 'tower_descent_elev',
        centerX: 0,
        centerZ: -30.5,
        startY: INSTANCE_Y.UNDERGROUND + 24,
        endY: INSTANCE_Y.UNDERGROUND,
        startFloorLabel: 1,
        endFloorLabel: -12,
        travelDuration: 3.6,
        doorFacingZ: 1, // Enter from South (+Z) Lobby at Z = -28.0
        exitDoorFacingZ: -1, // Exit straight North (-Z) into Boss Arena at Z = -33.0!
        width: 4.6,
        depth: 5.0,
        cabinHeight: 3.6,
        accentHex: 0xff003c,
        accentCss: '#ff003c',
        destinationLabel: 'КОМПЛЕКС «ХУЕШИ» // -12 ЭТ.',
      },
      this.undergroundGroup,
      physics,
      textures,
    );
    this.buildMarakulinUnderground();
    scene.add(this.undergroundGroup);

    // 4. Build Cyberspace (Y = 320)
    this.taisiyaRig = buildTaisiyaCyberspaceModel();
    this.buildCyberspace();
    scene.add(this.cyberspaceGroup);

    // 5. Build Taldykorgan Highway Epilogue (Y = 420)
    this.buildTaldykorganRoad();
    scene.add(this.taldykorganGroup);

    this.setActiveInstance('NONE');
  }

  setPenthouseCorridorLocked(locked: boolean): void {
    this.penthouseCorridorLocked = locked;
    if (this.phCorridorDoorMesh) {
      this.phCorridorDoorMesh.visible = locked;
    }
    this.physics.setActive('ph_corridor_lock', locked && this.activeInstance === 'PENTHOUSE');
  }

  setActiveInstance(name: StoryInstanceName): void {
    this.activeInstance = name;
    const isPh = name === 'PENTHOUSE';
    const isUg = name === 'UNDERGROUND';
    const isCyb = name === 'CYBERSPACE';

    this.penthouseGroup.visible = isPh;
    this.chaseGroup.visible = name === 'CHASE';
    this.undergroundGroup.visible = isUg;
    this.cyberspaceGroup.visible = isCyb;
    this.taldykorganGroup.visible = name === 'TALDYKORGAN';

    // Keep inactive instance colliders disabled so they cannot interfere with physics/raycasts
    this.physics.setCollidersActiveByPrefix('ph_', isPh);
    this.physics.setActive('ph_corridor_lock', isPh && this.penthouseCorridorLocked);
    this.penthouseElevator.setCollidersActive(isPh);

    this.physics.setCollidersActiveByPrefix('ug_', isUg);
    this.physics.setCollidersActiveByPrefix('boss_', isUg);
    this.physics.setCollidersActiveByPrefix('huyeshi_', isUg);
    this.physics.setCollidersActiveByPrefix('tower_supply_', isUg);
    this.undergroundElevator.setCollidersActive(isUg);

    this.physics.setCollidersActiveByPrefix('cyb_', isCyb);

    if (isPh) {
      this.setPenthouseSanzharState('room');
    }

    this.configureSharedLighting(name);
  }

  /**
   * Repositions and recolors the 3 shared PointLights + 1 HemisphereLight WITHOUT ever
   * toggling `.visible`, guaranteeing 0 WebGL shader recompilations and 0 freezes.
   */
  private configureSharedLighting(name: StoryInstanceName): void {
    if (name === 'NONE') {
      this.instanceHemiLight.intensity = 0;
      this.instanceKeyLight.intensity = 0;
      this.instanceFillLight.intensity = 0;
      this.instanceAccentLight.intensity = 0;
      return;
    }

    if (name === 'PENTHOUSE') {
      const y = INSTANCE_Y.PENTHOUSE;
      this.instanceHemiLight.color.setHex(0xb4c8ee);
      this.instanceHemiLight.groundColor.setHex(0x3a2416);
      this.instanceHemiLight.intensity = 0.95;

      // Key: warm golden suite chandelier glow over Suite 9201 (bed, lounge, closet, murder stage)
      this.instanceKeyLight.color.setHex(0xffd27a);
      this.instanceKeyLight.intensity = 42;
      this.instanceKeyLight.distance = 48;
      this.instanceKeyLight.decay = 1.3;
      this.instanceKeyLight.position.set(0.5, y + 5.2, 8.2);

      // Fill: crimson/warm luxury corridor wash
      this.instanceFillLight.color.setHex(0xff3858);
      this.instanceFillLight.intensity = 34;
      this.instanceFillLight.distance = 46;
      this.instanceFillLight.decay = 1.3;
      this.instanceFillLight.position.set(0, y + 5.2, -14.5);

      // Accent: warm amber elevator foyer & lower corridor glow
      this.instanceAccentLight.color.setHex(0xffd680);
      this.instanceAccentLight.intensity = 32;
      this.instanceAccentLight.distance = 42;
      this.instanceAccentLight.decay = 1.3;
      this.instanceAccentLight.position.set(0, y + 5.0, -32.0);
      return;
    }

    if (name === 'CHASE') {
      const y = INSTANCE_Y.CHASE;
      this.instanceHemiLight.color.setHex(0x6e9eff);
      this.instanceHemiLight.groundColor.setHex(0x280e28);
      this.instanceHemiLight.intensity = 1.35;

      // Key: interior Cyber-Akhmed cyan cabin illumination (lights dash & wounded Sanzhar clearly)
      this.instanceKeyLight.color.setHex(0x46e0ff);
      this.instanceKeyLight.intensity = 14;
      this.instanceKeyLight.distance = 14;
      this.instanceKeyLight.decay = 1.35;
      this.instanceKeyLight.position.set(0.35, y + 2.45, 3.65);

      // Fill: forward headlight wash illuminating highway & pursuit drones
      this.instanceFillLight.color.setHex(0xd8f4ff);
      this.instanceFillLight.intensity = 46;
      this.instanceFillLight.distance = 68;
      this.instanceFillLight.decay = 1.2;
      this.instanceFillLight.position.set(0, y + 3.0, -16);

      // Accent: cyberpunk magenta highway rim light
      this.instanceAccentLight.color.setHex(0xff2a6d);
      this.instanceAccentLight.intensity = 28;
      this.instanceAccentLight.distance = 58;
      this.instanceAccentLight.decay = 1.25;
      this.instanceAccentLight.position.set(0, y + 6.0, -28);
      return;
    }

    if (name === 'UNDERGROUND') {
      this.instanceHemiLight.color.setHex(0x7ca2de);
      this.instanceHemiLight.groundColor.setHex(0x2e1628);
      this.instanceHemiLight.intensity = 1.05;
      this.syncUndergroundLighting(0);
      return;
    }

    if (name === 'CYBERSPACE') {
      const y = INSTANCE_Y.CYBERSPACE;
      this.instanceHemiLight.color.setHex(0x44ccff);
      this.instanceHemiLight.groundColor.setHex(0x4a0c2e);
      this.instanceHemiLight.intensity = 1.15;

      // Key: Taisiya magenta core illumination
      this.instanceKeyLight.color.setHex(0xff44aa);
      this.instanceKeyLight.intensity = 30;
      this.instanceKeyLight.distance = 36;
      this.instanceKeyLight.decay = 1.3;
      this.instanceKeyLight.position.set(0, y + 3.6, -24.5);

      // Fill: Left Cyan Portal glow
      this.instanceFillLight.color.setHex(0x00f0ff);
      this.instanceFillLight.intensity = 34;
      this.instanceFillLight.distance = 38;
      this.instanceFillLight.decay = 1.3;
      this.instanceFillLight.position.set(-5.4, y + 3.4, -31);

      // Accent: Right Crimson Portal glow
      this.instanceAccentLight.color.setHex(0xff003c);
      this.instanceAccentLight.intensity = 34;
      this.instanceAccentLight.distance = 38;
      this.instanceAccentLight.decay = 1.3;
      this.instanceAccentLight.position.set(5.4, y + 3.4, -31);
      return;
    }

    if (name === 'TALDYKORGAN') {
      const y = INSTANCE_Y.TALDYKORGAN;
      this.instanceHemiLight.color.setHex(0xffa466);
      this.instanceHemiLight.groundColor.setHex(0x421d14);
      this.instanceHemiLight.intensity = 1.3;

      // Key: Setting desert sun
      this.instanceKeyLight.color.setHex(0xff7733);
      this.instanceKeyLight.intensity = 48;
      this.instanceKeyLight.distance = 280;
      this.instanceKeyLight.decay = 1.0;
      this.instanceKeyLight.position.set(0, y + 28, -95);

      // Fill: Warm amber bus cab dash glow
      this.instanceFillLight.color.setHex(0xff8833);
      this.instanceFillLight.intensity = 9;
      this.instanceFillLight.distance = 10;
      this.instanceFillLight.decay = 1.4;
      this.instanceFillLight.position.set(-0.4, y + 1.5, 6.8);

      // Accent: Highway sign warm wash
      this.instanceAccentLight.color.setHex(0xffaa44);
      this.instanceAccentLight.intensity = 24;
      this.instanceAccentLight.distance = 75;
      this.instanceAccentLight.decay = 1.2;
      this.instanceAccentLight.position.set(6, y + 8, -22);
    }
  }

  private syncUndergroundLighting(elapsed: number): void {
    const yLobby = INSTANCE_Y.UNDERGROUND + 24; // -66
    const yCore = INSTANCE_Y.UNDERGROUND; // -90
    const alarmPulse = Math.sin(elapsed * 5.2);

    if (this.huyeshiExtractionProgress > 0.01) {
      const p = this.huyeshiExtractionProgress;
      // Intense surgical overhead + crimson extraction surge + cyan rim over Huyeshi Chair
      this.instanceKeyLight.color.setHex(0xd8f2ff);
      this.instanceKeyLight.intensity = 38 + Math.sin(elapsed * 11) * (4 + p * 8);
      this.instanceKeyLight.distance = 36;
      this.instanceKeyLight.decay = 1.3;
      this.instanceKeyLight.position.set(0, yCore + 6.8, -89.4);

      this.instanceFillLight.color.setHex(0xff003c);
      this.instanceFillLight.intensity = 10 + p * 36;
      this.instanceFillLight.distance = 28;
      this.instanceFillLight.decay = 1.35;
      this.instanceFillLight.position.set(0, yCore + 3.2, -90);

      this.instanceAccentLight.color.setHex(0x2ce4ff);
      this.instanceAccentLight.intensity = 24;
      this.instanceAccentLight.distance = 28;
      this.instanceAccentLight.decay = 1.35;
      this.instanceAccentLight.position.set(-4.5, yCore + 4.4, -91);
      return;
    }

    if (this.undergroundElevator.state.currentY < -78) {
      // All 3 PointLights focused on Smasher Boss Arena + Huyeshi Chamber (Y = -90)
      this.instanceKeyLight.color.setHex(0xff2e58);
      this.instanceKeyLight.intensity = 38 + alarmPulse * 11;
      this.instanceKeyLight.distance = 58;
      this.instanceKeyLight.decay = 1.2;
      this.instanceKeyLight.position.set(0, yCore + 9.2, -50);

      this.instanceFillLight.color.setHex(0xf5be6b);
      this.instanceFillLight.intensity = 40;
      this.instanceFillLight.distance = 58;
      this.instanceFillLight.decay = 1.2;
      this.instanceFillLight.position.set(0, yCore + 9.2, -70);

      this.instanceAccentLight.color.setHex(0xb8eeff);
      this.instanceAccentLight.intensity = 34 + Math.sin(elapsed * 9) * 2.5;
      this.instanceAccentLight.distance = 36;
      this.instanceAccentLight.decay = 1.3;
      this.instanceAccentLight.position.set(0, yCore + 7.4, -90);
      return;
    }

    // 2 PointLights illuminating Main Atrium Lobby (Y = -66) + 1 backup crimson-gold Arena light (Y = -90)
    this.instanceKeyLight.color.setHex(0xff2e58);
    this.instanceKeyLight.intensity = 36 + alarmPulse * 10;
    this.instanceKeyLight.distance = 50;
    this.instanceKeyLight.decay = 1.25;
    this.instanceKeyLight.position.set(0, yLobby + 7.6, -4);

    this.instanceFillLight.color.setHex(0x5ad8ff);
    this.instanceFillLight.intensity = 38;
    this.instanceFillLight.distance = 48;
    this.instanceFillLight.decay = 1.25;
    this.instanceFillLight.position.set(0, yLobby + 7.6, -20);

    this.instanceAccentLight.color.setHex(0xff5268);
    this.instanceAccentLight.intensity = 40 + alarmPulse * 6;
    this.instanceAccentLight.distance = 68;
    this.instanceAccentLight.decay = 1.15;
    this.instanceAccentLight.position.set(0, yCore + 9.2, -62);
  }

  // =========================================================================
  // SHARED GEOMETRY & PROCEDURAL TEXTURE HELPERS
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
    intensity = 1.65,
  ): THREE.Mesh {
    const mat = new THREE.MeshStandardMaterial({
      color: colorHex,
      emissive: colorHex,
      emissiveIntensity: Math.min(intensity, 2.4),
      roughness: 0.28,
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
    emissiveIntensity = 0.88,
  ): THREE.Mesh {
    const mat = new THREE.MeshStandardMaterial({
      map: texture,
      emissiveMap: texture,
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity,
      roughness: 0.4,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotY;
    parent.add(mesh);
    return mesh;
  }

  private createHotelRunnerTexture(): THREE.CanvasTexture {
    return this.createCanvasTexture(
      512,
      512,
      (ctx, w, h) => {
        // Deep royal crimson velvet runner base
        const grad = ctx.createLinearGradient(0, 0, w, 0);
        grad.addColorStop(0.0, '#1e070e');
        grad.addColorStop(0.08, '#4a0b1c');
        grad.addColorStop(0.5, '#641026');
        grad.addColorStop(0.92, '#4a0b1c');
        grad.addColorStop(1.0, '#1e070e');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);

        // Woven velvet grain
        ctx.fillStyle = 'rgba(255, 220, 140, 0.04)';
        for (let y = 0; y < h; y += 8) {
          ctx.fillRect(40, y, w - 80, 2);
        }

        // Twin brushed-gold luxury border bands
        ctx.fillStyle = '#e8b948';
        ctx.fillRect(20, 0, 14, h);
        ctx.fillRect(w - 34, 0, 14, h);
        ctx.fillStyle = '#fcee0a';
        ctx.fillRect(42, 0, 5, h);
        ctx.fillRect(w - 47, 0, 5, h);

        // Subtle geometric Kazakh-cyber diamond medallions down the center
        ctx.strokeStyle = 'rgba(248, 212, 100, 0.42)';
        ctx.lineWidth = 4;
        for (let cy = 64; cy < h; cy += 128) {
          ctx.beginPath();
          ctx.moveTo(w * 0.5, cy - 38);
          ctx.lineTo(w * 0.5 + 56, cy);
          ctx.lineTo(w * 0.5, cy + 38);
          ctx.lineTo(w * 0.5 - 56, cy);
          ctx.closePath();
          ctx.stroke();

          ctx.beginPath();
          ctx.moveTo(w * 0.5, cy - 18);
          ctx.lineTo(w * 0.5 + 28, cy);
          ctx.lineTo(w * 0.5, cy + 18);
          ctx.lineTo(w * 0.5 - 28, cy);
          ctx.closePath();
          ctx.stroke();
        }
      },
      1,
      7,
    );
  }

  private createRoomPlaqueTexture(roomNumber: string, subtitle: string): THREE.CanvasTexture {
    return this.createCanvasTexture(256, 128, (ctx, w, h) => {
      const grad = ctx.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, '#1c150c');
      grad.addColorStop(0.5, '#2b2011');
      grad.addColorStop(1, '#140e08');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = '#f5c74c';
      ctx.lineWidth = 6;
      ctx.strokeRect(6, 6, w - 12, h - 12);

      ctx.fillStyle = '#ffe17d';
      ctx.font = '900 54px "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(roomNumber, w / 2, 72);

      ctx.fillStyle = '#d4a64a';
      ctx.font = '700 16px monospace';
      ctx.fillText(subtitle, w / 2, 104);
      ctx.textAlign = 'left';
    });
  }

  private createEcgMonitorTexture(): THREE.CanvasTexture {
    return this.createCanvasTexture(512, 256, (ctx, w, h) => {
      ctx.fillStyle = '#040a12';
      ctx.fillRect(0, 0, w, h);

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

      ctx.fillStyle = '#00ffaa';
      ctx.font = '900 22px monospace';
      ctx.fillText('NEURO-ECG // МОНИТОР ЖИЗНЕОБЕСПЕЧЕНИЯ', 18, 34);

      ctx.fillStyle = '#ff003c';
      ctx.font = '800 20px monospace';
      ctx.fillText('BPM: 142 [КРИТ.]', 310, 68);

      ctx.fillStyle = '#00f0ff';
      ctx.font = '700 17px monospace';
      ctx.fillText('СИНХРОНИЗАЦИЯ РЕЛИКВИИ: 91.4%', 18, 68);

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

      ctx.fillStyle = 'rgba(255, 240, 210, 0.72)';
      for (let i = 0; i < 120; i++) {
        const sx = (i * 197) % w;
        const sy = (i * 53) % Math.floor(h * 0.36);
        ctx.fillRect(sx, sy, 2, 2);
      }

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
      emissiveIntensity: 2.0,
      roughness: 0.22,
    });
    const haloMat = new THREE.MeshBasicMaterial({
      color: 0x00ff88,
      transparent: true,
      opacity: 0.28,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    const base = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.74, 0.84), bodyMat);
    base.position.y = 0.37;
    group.add(base);

    const lid = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.1, 0.88), bodyMat);
    lid.position.y = 0.76;
    group.add(lid);

    // Iconic Bolt 1 glowing green medical cross on top
    const crossH = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.08, 0.13), glowMat);
    crossH.position.set(0, 0.84, 0);
    const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.08, 0.46), glowMat);
    crossV.position.set(0, 0.84, 0);
    group.add(crossH, crossV);

    const strip = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.08, 0.9), glowMat);
    strip.position.y = 0.56;
    group.add(strip);

    // Soft emissive floor halo ring (zero PointLights!)
    const floorHalo = new THREE.Mesh(new THREE.RingGeometry(0.65, 1.05, 24), haloMat);
    floorHalo.rotation.x = -Math.PI / 2;
    floorHalo.position.y = 0.03;
    group.add(floorHalo);

    group.position.set(x, baseY, z);
    parent.add(group);

    this.physics.addBox(`${id}_box`, x, baseY + 0.38, z, 1.15, 0.76, 0.84, {
      blocksSight: false,
      blocksBullets: true,
    });

    this.supplyCrates.set(id, { id, group, glowMat, haloMat, used: false });
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
  // 1. LUXURY HOTEL PENTHOUSE SUITE 9201 + CORRIDOR (Y = 120)
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
      emissiveIntensity: 2.4,
      roughness: 0.2,
    });

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

    for (const sx of [-1.06, 1.06]) {
      const pauldron = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.68, 0.96), chrome);
      pauldron.position.set(sx, 2.66, 0);
      const trim = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.08, 0.98), crimsonGlow);
      trim.position.set(sx, 2.98, 0);
      this.penthouseSmasherProp.add(pauldron, trim);
    }

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

    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.3, 0.2, 10), obsidian);
    neck.position.set(0, 2.84, 0.05);
    const skull = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.54, 0.56), chrome);
    skull.position.set(0, 3.12, 0.08);
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.18, 0.44), obsidian);
    jaw.position.set(0, 2.86, 0.16);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.12, 0.14), crimsonGlow);
    visor.position.set(0, 3.15, 0.35);
    this.penthouseSmasherProp.add(neck, skull, jaw, visor);

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

    const leftArm = new THREE.Group();
    leftArm.position.set(-1.18, 2.24, 0.12);
    const upperL = new THREE.Mesh(new THREE.BoxGeometry(0.44, 1.06, 0.44), obsidian);
    upperL.position.y = -0.44;
    const clawBase = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.24, 0.44), chrome);
    clawBase.position.set(0, -1.04, 0.12);
    leftArm.add(upperL, clawBase);
    this.penthouseSmasherLeftArm = leftArm;
    this.penthouseSmasherProp.add(leftArm);
  }

  private buildPenthouse(): void {
    const y = INSTANCE_Y.PENTHOUSE;

    const marbleFloorMat = new THREE.MeshStandardMaterial({
      map: this.textures.getFloorTile('#fcee0a', 7, 12),
      roughness: 0.18,
      metalness: 0.58,
    });
    const wallMat = new THREE.MeshStandardMaterial({
      map: this.textures.getWallPanel('#fcee0a', 4, 2),
      roughness: 0.34,
      metalness: 0.48,
    });
    const darkMarbleMat = new THREE.MeshStandardMaterial({
      color: 0x18131a,
      roughness: 0.22,
      metalness: 0.65,
    });
    const brushedGoldMat = new THREE.MeshStandardMaterial({
      color: 0xb68b38,
      roughness: 0.26,
      metalness: 0.86,
    });
    const darkGoldMat = new THREE.MeshStandardMaterial({
      color: 0x302414,
      roughness: 0.3,
      metalness: 0.78,
    });
    const mahoganyMat = new THREE.MeshStandardMaterial({
      color: 0x2a1610,
      roughness: 0.44,
      metalness: 0.25,
    });
    const closetWoodMat = new THREE.MeshStandardMaterial({
      color: 0x24170f,
      roughness: 0.46,
      metalness: 0.3,
    });
    const slatMat = new THREE.MeshStandardMaterial({
      color: 0x1b120c,
      roughness: 0.4,
      metalness: 0.45,
    });
    const velvetCrimsonMat = new THREE.MeshStandardMaterial({
      color: 0x4b0d1e,
      roughness: 0.7,
      metalness: 0.12,
    });
    const blackLeatherMat = new THREE.MeshStandardMaterial({
      color: 0x15141a,
      roughness: 0.55,
      metalness: 0.22,
    });
    const warmLampMat = new THREE.MeshStandardMaterial({
      color: 0xffe4a0,
      emissive: 0xffc864,
      emissiveIntensity: 1.9,
      roughness: 0.25,
    });

    // --- SUITE 9201 FLOOR & CEILING (Z: -1.5 .. 17.6, X: -12.6 .. 12.6) ---
    const suiteFloor = new THREE.Mesh(new THREE.BoxGeometry(25.6, 0.4, 19.6), marbleFloorMat);
    suiteFloor.position.set(0, y - 0.2, 8.0);
    this.penthouseGroup.add(suiteFloor);

    const suiteCeil = new THREE.Mesh(
      new THREE.BoxGeometry(25.6, 0.4, 19.6),
      new THREE.MeshStandardMaterial({ color: 0x100e18, roughness: 0.72, metalness: 0.32 }),
    );
    suiteCeil.position.set(0, y + 6.4, 8.0);
    this.penthouseGroup.add(suiteCeil);
    this.physics.addBox('ph_suite_ceil', 0, y + 6.4, 8.0, 25.6, 0.4, 19.6);

    // --- LUXURY HOTEL CORRIDOR FLOOR & CEILING (Z: -35.8 .. -1.5, X: -9.4 .. 9.4) ---
    const corrFloor = new THREE.Mesh(new THREE.BoxGeometry(19.2, 0.4, 34.6), marbleFloorMat);
    corrFloor.position.set(0, y - 0.2, -18.6);
    this.penthouseGroup.add(corrFloor);

    const corrCeil = new THREE.Mesh(
      new THREE.BoxGeometry(19.2, 0.4, 34.6),
      new THREE.MeshStandardMaterial({ color: 0x110e17, roughness: 0.72, metalness: 0.32 }),
    );
    corrCeil.position.set(0, y + 6.4, -18.6);
    this.penthouseGroup.add(corrCeil);
    this.physics.addBox('ph_corr_ceil', 0, y + 6.4, -18.6, 19.2, 0.4, 34.6);

    // Helper for full-height structural walls
    const addW = (
      id: string,
      cx: number,
      cz: number,
      sx: number,
      sz: number,
      mat: THREE.Material = wallMat,
    ) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, 6.4, sz), mat);
      m.position.set(cx, y + 3.2, cz);
      this.penthouseGroup.add(m);
      this.physics.addBox(id, cx, y + 3.2, cz, sx, 6.4, sz);
    };

    // Suite 9201 Perimeter Walls (East wall is full floor-to-ceiling panoramic glass bay!)
    addW('ph_suite_w', -12.4, 8.0, 0.8, 19.6);
    addW('ph_suite_s', 0, 17.6, 25.6, 0.8);
    // Invisible glass collider along East panoramic suite window (Z: -1.5..17.6)
    this.physics.addBox('ph_right_window_col', 12.4, y + 3.2, 8.0, 0.6, 6.4, 19.6);

    // Suite / Hotel Corridor Divider Wall at Z = -1.5 (with open 5.0m Suite 9201 arch!)
    addW('ph_div_l', -7.5, -1.5, 10.2, 0.8);
    addW('ph_div_r', 7.5, -1.5, 10.2, 0.8);
    const divHeader = new THREE.Mesh(new THREE.BoxGeometry(5.2, 2.4, 0.82), darkMarbleMat);
    divHeader.position.set(0, y + 5.2, -1.5);
    this.penthouseGroup.add(divHeader);
    this.addNeonStrip(this.penthouseGroup, 0, y + 4.02, -1.08, 5.1, 0.08, 0.08, 0xfcee0a, 1.6);
    this.addNeonStrip(this.penthouseGroup, 0, y + 4.02, -1.92, 5.1, 0.08, 0.08, 0xfcee0a, 1.6);

    // Suite 9201 security doors locking corridor until heist escape begins (subStep = 3)
    const lockDoorGroup = new THREE.Group();
    const lockDoorPanel = new THREE.Mesh(new THREE.BoxGeometry(5.05, 4.0, 0.28), mahoganyMat);
    lockDoorPanel.position.set(0, y + 2.0, -1.5);
    const lockDoorSeam = new THREE.Mesh(new THREE.BoxGeometry(0.12, 3.8, 0.34), brushedGoldMat);
    lockDoorSeam.position.set(0, y + 2.0, -1.5);
    this.addNeonStrip(lockDoorGroup, 0, y + 2.0, -1.32, 4.8, 0.07, 0.04, 0xff003c, 1.5);
    lockDoorGroup.add(lockDoorPanel, lockDoorSeam);
    this.phCorridorDoorMesh = lockDoorGroup;
    this.penthouseGroup.add(lockDoorGroup);
    this.physics.addBox('ph_corridor_lock', 0, y + 2.0, -1.5, 5.2, 4.0, 0.65, {
      active: this.penthouseCorridorLocked,
    });

    // Luxury Hotel Corridor Side Walls (X = ±9.2, Z: -35.8 .. -1.5)
    addW('ph_corr_w', -9.2, -18.65, 0.8, 34.8);
    addW('ph_corr_e', 9.2, -18.65, 0.8, 34.8);

    // Corridor North Wall at Z = -35.8 (FLUSH with Penthouse Escape Elevator South portal at -38 + 2.2 = -35.8!)
    addW('ph_front_l', -5.7, -35.8, 7.0, 0.6);
    addW('ph_front_r', 5.7, -35.8, 7.0, 0.6);
    // Upper portal header ONLY above Y = y + 3.6 (NEVER blocks the elevator doorway!)
    const elevHeader = new THREE.Mesh(new THREE.BoxGeometry(4.6, 2.8, 0.62), darkMarbleMat);
    elevHeader.position.set(0, y + 5.0, -35.8);
    this.penthouseGroup.add(elevHeader);
    this.addNeonStrip(this.penthouseGroup, 0, y + 3.64, -35.46, 4.5, 0.09, 0.08, 0xfcee0a, 1.75);

    // --- PANORAMIC FLOOR-TO-CEILING NIGHT SKYLINE WINDOWS (EAST SUITE WALL) ---
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x0e1d36,
      metalness: 0.9,
      roughness: 0.08,
      transparent: true,
      opacity: 0.22,
    });
    const eastGlass = new THREE.Mesh(new THREE.PlaneGeometry(18.6, 5.9), glassMat);
    eastGlass.position.set(12.2, y + 3.1, 8.0);
    eastGlass.rotation.y = -Math.PI / 2;
    this.penthouseGroup.add(eastGlass);

    this.addNeonStrip(this.penthouseGroup, 12.15, y + 0.16, 8.0, 0.18, 0.12, 18.6, 0xfcee0a, 1.3);
    this.addNeonStrip(this.penthouseGroup, 12.15, y + 6.08, 8.0, 0.18, 0.12, 18.6, 0xfcee0a, 1.3);
    for (const mz of [-0.4, 3.8, 8.0, 12.2, 16.4]) {
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
        emissiveIntensity: 0.98,
        roughness: 0.9,
      }),
    );
    skylineBackdrop.position.set(42, y + 4.5, 8.2);
    skylineBackdrop.rotation.y = -Math.PI / 2;
    this.penthouseGroup.add(skylineBackdrop);

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
          emissiveIntensity: 0.78,
          roughness: 0.5,
        }),
      );
      bldg.position.set(tx, y - 6 + th * 0.25, tz);
      this.penthouseGroup.add(bldg);
    }

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

    // --- LUXURY SUITE 9201 ARCHITECTURAL COVES & GOLDEN TRIM ---
    for (const cz of [2.2, 8.2, 14.2]) {
      this.addNeonStrip(this.penthouseGroup, 0, y + 6.12, cz, 20.5, 0.12, 0.22, 0xfcee0a, 1.55);
    }
    for (const pz of [2.0, 10.2]) {
      const pil = new THREE.Mesh(new THREE.BoxGeometry(0.7, 6.2, 1.0), darkMarbleMat);
      pil.position.set(-11.75, y + 3.1, pz);
      this.penthouseGroup.add(pil);
      this.addNeonStrip(this.penthouseGroup, -11.36, y + 3.1, pz, 0.07, 5.8, 0.12, 0xfcee0a, 1.5);
    }

    // --- LUXURY KING-SIZED BLACK & GOLD BED (South-West Suite 9201, X: -11.7..-8.1, Z: 11.4..15.2) ---
    const bedGroup = new THREE.Group();
    bedGroup.position.set(-9.9, y, 13.3);

    // Woven dark obsidian-and-gold bedroom carpet beneath the bed
    const bedRug = new THREE.Mesh(
      new THREE.BoxGeometry(4.6, 0.03, 5.4),
      new THREE.MeshStandardMaterial({ color: 0x1a141c, roughness: 0.88 }),
    );
    bedRug.position.set(0.25, 0.015, 0);
    bedGroup.add(bedRug);
    this.addNeonStrip(bedGroup, 0.25, 0.035, -2.68, 4.6, 0.02, 0.06, 0xe8b948, 1.25);
    this.addNeonStrip(bedGroup, 0.25, 0.035, 2.68, 4.6, 0.02, 0.06, 0xe8b948, 1.25);

    // Black obsidian floating platform base with golden neon underglow
    const bedBase = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.36, 3.3), darkMarbleMat);
    bedBase.position.set(0, 0.22, 0);
    bedGroup.add(bedBase);
    this.addNeonStrip(bedGroup, 0.04, 0.06, 0, 3.44, 0.05, 3.34, 0xfcee0a, 1.45);

    // Plush charcoal mattress + deep crimson/gold silk duvet
    const mattress = new THREE.Mesh(
      new THREE.BoxGeometry(3.15, 0.32, 3.05),
      new THREE.MeshStandardMaterial({ color: 0x22202b, roughness: 0.78 }),
    );
    mattress.position.set(0, 0.56, 0);
    const duvet = new THREE.Mesh(new THREE.BoxGeometry(2.35, 0.34, 3.1), velvetCrimsonMat);
    duvet.position.set(0.42, 0.58, 0);
    const goldThrow = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.36, 3.12), brushedGoldMat);
    goldThrow.position.set(1.15, 0.59, 0);
    bedGroup.add(mattress, duvet, goldThrow);

    // 4 Luxury pillows against the headboard
    const pillowMat = new THREE.MeshStandardMaterial({ color: 0x191722, roughness: 0.72 });
    const accentPillowMat = new THREE.MeshStandardMaterial({ color: 0x8e6b2a, roughness: 0.48, metalness: 0.35 });
    for (const pz of [-0.72, 0.72]) {
      const pBack = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.24, 1.05), pillowMat);
      pBack.position.set(-1.12, 0.82, pz);
      pBack.rotation.z = -0.22;
      const pFront = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.2, 0.74), accentPillowMat);
      pFront.position.set(-0.76, 0.8, pz);
      pFront.rotation.z = -0.26;
      bedGroup.add(pBack, pFront);
    }

    // Tall tufted black-leather & brushed-gold headboard with golden neon cove
    const headboard = new THREE.Mesh(new THREE.BoxGeometry(0.24, 2.25, 4.7), blackLeatherMat);
    headboard.position.set(-1.72, 1.15, 0);
    const headFrameTop = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.1, 4.78), brushedGoldMat);
    headFrameTop.position.set(-1.72, 2.28, 0);
    bedGroup.add(headboard, headFrameTop);
    for (let kz = -1.8; kz <= 1.8; kz += 0.9) {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(0.26, 2.15, 0.06), brushedGoldMat);
      rib.position.set(-1.7, 1.15, kz);
      bedGroup.add(rib);
    }
    this.addNeonStrip(bedGroup, -1.58, 2.16, 0, 0.06, 0.06, 4.6, 0xfcee0a, 1.75);

    // Twin marble nightstands & warm glowing bedside lamps
    for (const nz of [-2.12, 2.12]) {
      const stand = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.62, 0.78), darkMarbleMat);
      stand.position.set(-1.26, 0.31, nz);
      const standTrim = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.04, 0.8), brushedGoldMat);
      standTrim.position.set(-1.26, 0.63, nz);
      const lampBase = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 0.26, 10), brushedGoldMat);
      lampBase.position.set(-1.26, 0.76, nz);
      const lampShade = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 0.34, 12), warmLampMat);
      lampShade.position.set(-1.26, 1.04, nz);
      bedGroup.add(stand, standTrim, lampBase, lampShade);
    }

    this.penthouseGroup.add(bedGroup);
    this.physics.addBox('ph_bed', -9.9, y + 0.6, 13.3, 3.6, 1.2, 4.9, { blocksSight: false });

    // --- VELVET LOUNGE SOFA, MARBLE COFFEE TABLE & LUXURY BAR CART (EAST SUITE) ---
    const loungeRug = new THREE.Mesh(
      new THREE.BoxGeometry(5.6, 0.03, 6.2),
      new THREE.MeshStandardMaterial({ color: 0x201319, roughness: 0.85 }),
    );
    loungeRug.position.set(7.6, y + 0.015, 8.8);
    this.penthouseGroup.add(loungeRug);
    this.addNeonStrip(this.penthouseGroup, 7.6, y + 0.035, 5.7, 5.6, 0.02, 0.06, 0xe8b948, 1.2);
    this.addNeonStrip(this.penthouseGroup, 7.6, y + 0.035, 11.9, 5.6, 0.02, 0.06, 0xe8b948, 1.2);

    const sofaBase = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.62, 4.8), velvetCrimsonMat);
    sofaBase.position.set(8.8, y + 0.36, 8.8);
    const sofaBack = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.92, 4.8), velvetCrimsonMat);
    sofaBack.position.set(9.45, y + 0.8, 8.8);
    const sofaTrim = new THREE.Mesh(new THREE.BoxGeometry(1.66, 0.07, 4.86), brushedGoldMat);
    sofaTrim.position.set(8.8, y + 0.06, 8.8);
    for (const az of [6.48, 11.12]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(1.56, 0.56, 0.28), velvetCrimsonMat);
      arm.position.set(8.8, y + 0.64, az);
      this.penthouseGroup.add(arm);
    }
    this.penthouseGroup.add(sofaBase, sofaBack, sofaTrim);
    this.physics.addBox('ph_sofa', 8.85, y + 0.55, 8.8, 1.8, 1.1, 4.9, { blocksSight: false });

    // Marble coffee table with gold frame
    const coffeeTable = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.44, 3.2), darkMarbleMat);
    coffeeTable.position.set(6.4, y + 0.22, 8.8);
    this.penthouseGroup.add(coffeeTable);
    this.addNeonStrip(this.penthouseGroup, 6.4, y + 0.45, 8.8, 1.46, 0.04, 3.26, 0xfcee0a, 1.35);
    this.physics.addBox('ph_coffee_table', 6.4, y + 0.25, 8.8, 1.4, 0.5, 3.2, { blocksSight: false });

    // Luxury Bar Cart & Champagne Credenza (South-East corner at X = 8.4, Z = 14.8)
    const barGroup = new THREE.Group();
    barGroup.position.set(8.4, y, 14.8);
    const barBody = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.96, 0.95), darkMarbleMat);
    barBody.position.y = 0.48;
    const barTop = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.07, 1.02), brushedGoldMat);
    barTop.position.y = 0.98;
    const barRail = new THREE.Mesh(new THREE.BoxGeometry(2.64, 0.05, 0.96), brushedGoldMat);
    barRail.position.y = 1.12;
    barGroup.add(barBody, barTop, barRail);
    this.addNeonStrip(barGroup, 0, 0.08, 0.49, 2.55, 0.05, 0.04, 0xfcee0a, 1.45);

    // Glowing luxury liquor bottles & champagne decanter on the bar cart
    const bottleColors = [0xffaa22, 0x00f0ff, 0xff2a6d, 0xfcee0a, 0x55ffaa];
    for (let i = 0; i < 5; i++) {
      const bMat = new THREE.MeshStandardMaterial({
        color: bottleColors[i],
        emissive: bottleColors[i],
        emissiveIntensity: 1.25,
        roughness: 0.15,
        metalness: 0.2,
      });
      const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.075, 0.34 + (i % 2) * 0.08, 10), bMat);
      bottle.position.set(-0.85 + i * 0.36, 1.18, -0.14);
      barGroup.add(bottle);
    }
    this.penthouseGroup.add(barGroup);
    this.physics.addBox('ph_bar_cart', 8.4, y + 0.6, 14.8, 2.7, 1.2, 1.05, { blocksSight: false });

    // --- SPACIOUS 2-PERSON LOUVERED WALK-IN CLOSET (West Wall: X: -11.5..-8.8, Z: 5.0..9.2) ---
    // Center X = -10.15 (width 2.7m), Center Z = 7.1 (depth 4.2m)!
    // Ai stands at (-10.1, y, 6.7..7.0) and Sanzhar crouches right beside Ai at (-10.1, y, 8.25)!
    const closetGroup = new THREE.Group();
    closetGroup.position.set(-10.15, y, 7.1);

    const clBack = new THREE.Mesh(new THREE.BoxGeometry(0.18, 3.4, 4.25), closetWoodMat);
    clBack.position.set(-1.32, 1.7, 0);
    const clNorth = new THREE.Mesh(new THREE.BoxGeometry(2.74, 3.4, 0.18), closetWoodMat);
    clNorth.position.set(0, 1.7, -2.08);
    const clSouth = new THREE.Mesh(new THREE.BoxGeometry(2.74, 3.4, 0.18), closetWoodMat);
    clSouth.position.set(0, 1.7, 2.08);
    const clTop = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.2, 4.3), closetWoodMat);
    clTop.position.set(0, 3.34, 0);
    const clShelf = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.08, 4.0), mahoganyMat);
    clShelf.position.set(-0.92, 2.78, 0);
    const clRod = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 3.9, 8), brushedGoldMat);
    clRod.rotation.x = Math.PI / 2;
    clRod.position.set(-0.96, 2.52, 0);
    closetGroup.add(clBack, clNorth, clSouth, clTop, clShelf, clRod);

    // Tailored dark corporate suit silhouettes hanging cleanly on far North & South edges of rod
    const suitMat = new THREE.MeshStandardMaterial({ color: 0x151822, roughness: 0.65 });
    for (const hz of [-1.72, -1.46, 1.62, 1.84]) {
      const jacket = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.95, 0.14), suitMat);
      jacket.position.set(-0.96, 1.98, hz);
      closetGroup.add(jacket);
    }

    // Outer door frame stiles & brushed gold trim on East face (local X = +1.34 -> world X = -8.81)
    const stileN = new THREE.Mesh(new THREE.BoxGeometry(0.16, 3.34, 0.2), darkGoldMat);
    stileN.position.set(1.34, 1.67, -1.96);
    const stileS = new THREE.Mesh(new THREE.BoxGeometry(0.16, 3.34, 0.2), darkGoldMat);
    stileS.position.set(1.34, 1.67, 1.96);
    // Vertical center stile positioned at local Z = +0.65 (world Z = 7.75: between Ai & Sanzhar, 0 sightline block!)
    const stileMid = new THREE.Mesh(new THREE.BoxGeometry(0.12, 3.22, 0.1), darkGoldMat);
    stileMid.position.set(1.34, 1.64, 0.65);
    const doorTopBar = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.22, 4.1), darkGoldMat);
    doorTopBar.position.set(1.34, 3.2, 0);
    const doorBotBar = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.24, 4.1), darkGoldMat);
    doorBotBar.position.set(1.34, 0.12, 0);
    closetGroup.add(stileN, stileS, stileMid, doorTopBar, doorBotBar);

    // Real angled horizontal louver slats on East face (eye-level 1.50..1.86 kept clean for crystal-clear view!)
    const slatHeights: number[] = [];
    for (let sy = 0.28; sy <= 1.46; sy += 0.13) slatHeights.push(sy);
    for (let sy = 1.86; sy <= 3.04; sy += 0.13) slatHeights.push(sy);
    const slatGeo = new THREE.BoxGeometry(0.1, 0.028, 3.82);
    for (const sy of slatHeights) {
      const slat = new THREE.Mesh(slatGeo, slatMat);
      slat.position.set(1.34, sy, 0);
      slat.rotation.z = 0.34;
      closetGroup.add(slat);
    }

    this.addNeonStrip(closetGroup, 1.42, 1.67, -1.98, 0.04, 3.1, 0.04, 0xfcee0a, 1.25);
    this.addNeonStrip(closetGroup, 1.42, 1.67, 1.98, 0.04, 3.1, 0.04, 0xfcee0a, 1.25);
    this.penthouseGroup.add(closetGroup);

    // Thin outer North/South colliders & ceiling (interior stays 100% open for Ai + Sanzhar!)
    this.physics.addBox('ph_closet_n', -10.15, y + 1.7, 5.02, 2.75, 3.4, 0.22);
    this.physics.addBox('ph_closet_s', -10.15, y + 1.7, 9.18, 2.75, 3.4, 0.22);
    this.physics.addBox('ph_closet_ceil', -10.15, y + 3.45, 7.1, 2.8, 0.25, 4.3);

    // --- BIOCHIP RELIC PEDESTAL & GLOWING CASE AT (0, y, 6) ---
    const pedestal = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.1, 1.7), darkMarbleMat);
    pedestal.position.set(0, y + 0.55, 6);
    this.penthouseGroup.add(pedestal);
    this.addNeonStrip(this.penthouseGroup, 0, y + 1.11, 6, 1.76, 0.05, 1.76, 0xfcee0a, 1.65);
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
        emissiveIntensity: 2.2,
      }),
    );
    caseCore.position.set(0, y + 1.34, 6);
    this.penthouseHoloRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.54, 0.025, 8, 28),
      new THREE.MeshBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.82 }),
    );
    this.penthouseHoloRing.rotation.x = Math.PI / 2;
    this.penthouseHoloRing.position.set(0, y + 1.48, 6);
    this.biochipCase.add(caseShell, caseCore, this.penthouseHoloRing);
    this.penthouseGroup.add(this.biochipCase);

    // --- REAL LUXURY HOTEL CORRIDOR (Z: -1.5 .. -35.8) ---
    // Plush Crimson & Gold Carpet Runner down the center
    const runnerTex = this.createHotelRunnerTexture();
    const runnerMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(5.0, 33.8),
      new THREE.MeshStandardMaterial({
        map: runnerTex,
        roughness: 0.78,
        metalness: 0.1,
      }),
    );
    runnerMesh.rotation.x = -Math.PI / 2;
    runnerMesh.position.set(0, y + 0.02, -18.7);
    this.penthouseGroup.add(runnerMesh);

    this.addNeonStrip(this.penthouseGroup, -2.55, y + 0.03, -18.7, 0.08, 0.04, 33.8, 0xfcee0a, 1.45);
    this.addNeonStrip(this.penthouseGroup, 2.55, y + 0.03, -18.7, 0.08, 0.04, 33.8, 0xfcee0a, 1.45);

    // Suite 9201 Golden Room Plaque right beside the suite entrance in the hotel corridor
    this.addEmissiveBanner(
      this.penthouseGroup,
      this.createRoomPlaqueTexture('9201', 'PENTHOUSE SUITE'),
      -3.45,
      y + 2.35,
      -1.95,
      1.15,
      0.58,
      Math.PI,
      0.95,
    );

    // Numbered Hotel Room Doors (9202, 9203, 9204, 9206) along left & right corridor walls
    const hotelRooms: Array<{ num: string; sub: string; side: -1 | 1; z: number }> = [
      { num: '9202', sub: 'EXECUTIVE SUITE', side: -1, z: -10.5 },
      { num: '9203', sub: 'EXECUTIVE SUITE', side: 1, z: -10.5 },
      { num: '9204', sub: 'VIP LOUNGE', side: -1, z: -24.5 },
      { num: '9206', sub: 'IMPERIAL SUITE', side: 1, z: -24.5 },
    ];
    for (const rm of hotelRooms) {
      const wx = rm.side * 8.74;
      const inward = -rm.side;
      const doorFrame = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.95, 2.05), darkGoldMat);
      doorFrame.position.set(wx, y + 1.48, rm.z);
      const doorLeaf = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.75, 1.72), mahoganyMat);
      doorLeaf.position.set(wx + inward * 0.05, y + 1.38, rm.z);
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.28, 0.06), brushedGoldMat);
      handle.position.set(wx + inward * 0.14, y + 1.24, rm.z + 0.56);
      this.penthouseGroup.add(doorFrame, doorLeaf, handle);

      // Glowing golden hotel room number plaque beside each door
      this.addEmissiveBanner(
        this.penthouseGroup,
        this.createRoomPlaqueTexture(rm.num, rm.sub),
        wx + inward * 0.12,
        y + 2.05,
        rm.z - 1.55,
        0.92,
        0.46,
        rm.side === -1 ? Math.PI / 2 : -Math.PI / 2,
        0.95,
      );

      // Warm luxury hotel wall sconces flanking each door
      for (const sz of [-1.45, 1.45]) {
        const sconceBase = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.85, 0.16), brushedGoldMat);
        sconceBase.position.set(wx + inward * 0.08, y + 2.9, rm.z + sz);
        const sconceGlow = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.65, 0.12), warmLampMat);
        sconceGlow.position.set(wx + inward * 0.14, y + 2.9, rm.z + sz);
        this.penthouseGroup.add(sconceBase, sconceGlow);
      }
    }

    // Tactical Luxury Marble Planters & Ornamental Cyber-Foliage Cover in the Corridor
    const foliageMat = new THREE.MeshStandardMaterial({
      color: 0x10382a,
      emissive: 0x06241a,
      emissiveIntensity: 0.4,
      roughness: 0.65,
    });
    for (const [cx, cz, idx] of [
      [-4.4, -9.5, 1],
      [4.4, -15.5, 2],
      [-3.8, -23.5, 3],
      [3.8, -29.0, 4],
    ]) {
      const cov = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.25, 1.15), darkMarbleMat);
      cov.position.set(cx, y + 0.625, cz);
      this.penthouseGroup.add(cov);
      this.addNeonStrip(
        this.penthouseGroup,
        cx,
        y + 1.27,
        cz,
        3.26,
        0.05,
        1.2,
        idx % 2 === 0 ? 0xff003c : 0xfcee0a,
        1.45,
      );

      // Decorative planter foliage crown on the outer end (leaves center aiming sightline clean)
      const bush = new THREE.Mesh(new THREE.DodecahedronGeometry(0.42, 0), foliageMat);
      bush.position.set(cx + (cx < 0 ? -1.05 : 1.05), y + 1.52, cz);
      this.penthouseGroup.add(bush);

      this.physics.addBox(`ph_cov_${idx}`, cx, y + 0.65, cz, 3.2, 1.3, 1.15, { blocksSight: false });
    }

    // Hotel corridor ceiling coffers & warm-gold / crimson alarm strips
    for (const cz of [-7, -15, -23, -31]) {
      const isCrimson = cz === -15 || cz === -31;
      this.addNeonStrip(
        this.penthouseGroup,
        0,
        y + 6.12,
        cz,
        14.5,
        0.14,
        0.24,
        isCrimson ? 0xff003c : 0xfcee0a,
        1.55,
      );
    }

    // --- CHARACTERS FOR HEIST & CLOSET CUTSCENE ---
    this.penthouseGroup.add(this.penthouseSanzhar.group);
    this.setPenthouseSanzharState('room');

    this.penthouseRodion.group.position.set(0.8, y, 4.2);
    this.penthouseRodion.group.rotation.y = -Math.PI * 0.5;
    this.penthouseRodion.group.visible = false;
    this.penthouseGroup.add(this.penthouseRodion.group);

    this.penthouseLev.group.position.set(-0.6, y, 4.2);
    this.penthouseLev.group.rotation.y = Math.PI * 0.5;
    this.penthouseLev.group.visible = false;
    this.penthouseGroup.add(this.penthouseLev.group);

    this.buildDetailedSmasherProp();
    this.penthouseSmasherProp.position.set(2.5, y, 2.1);
    this.penthouseSmasherProp.rotation.y = -Math.PI * 0.22;
    this.penthouseSmasherProp.visible = false;
    this.penthouseGroup.add(this.penthouseSmasherProp);

    // Emissive Luxury Suite & Escape Elevator Signs
    this.addEmissiveBanner(
      this.penthouseGroup,
      this.textures.getNeonSign('НОМЕР 9201 // РОДИОН МАРАКУЛИН', 'MARAKULIN TOWER HOTEL // 92 ЭТАЖ', '#fcee0a', '#ff003c'),
      0,
      y + 4.7,
      17.1,
      11.0,
      2.5,
      Math.PI,
      0.9,
    );
    this.addEmissiveBanner(
      this.penthouseGroup,
      this.textures.getNeonSign('ЭВАКУАЦИОННЫЙ ЛИФТ', 'ЭТАЖ 92 → ГАРАЖ КИБЕР-АХМЕДА', '#ff003c', '#fcee0a'),
      0,
      y + 4.9,
      -35.42,
      8.8,
      2.0,
      0,
      0.9,
    );

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
        z: -37.8,
        radius: 2.65,
        enabled: false,
        category: 'elevator',
      },
    );
  }

  /**
   * Positions & poses Sanzhar cleanly throughout the Suite 9201 Heist sequence,
   * including crouching RIGHT INSIDE the 2-person walk-in closet beside Ai!
   */
  setPenthouseSanzharState(mode: PenthouseSanzharMode): void {
    const y = INSTANCE_Y.PENTHOUSE;
    this.penthouseSanzharMode = mode;
    const s = this.penthouseSanzhar;

    s.group.visible = true;
    s.head.rotation.set(0, 0, 0);
    s.leftArm.rotation.set(0, 0, 0);
    s.rightArm.rotation.set(0, 0, 0);

    if (mode === 'room') {
      s.group.position.set(3.0, y, 10);
      s.group.rotation.set(0, Math.PI, 0);
      s.group.scale.set(1, 1, 1);
      return;
    }

    if (mode === 'approaching_closet') {
      s.group.position.set(-7.2, y, 7.8);
      s.group.rotation.set(0, -Math.PI * 0.5, 0);
      s.group.scale.set(1, 1, 1);
      s.leftArm.rotation.set(-0.35, 0, -0.15);
      s.rightArm.rotation.set(-0.45, 0, 0.15);
      return;
    }

    if (mode === 'inside_closet') {
      // Crouched right inside the 2-person louvered walk-in closet beside Ai facing East toward Rodion & Lev!
      s.group.position.set(-10.1, y, 8.25);
      s.group.rotation.set(0, Math.PI * 0.44, 0);
      s.group.scale.set(1, 0.86, 1);
      s.head.rotation.set(0.06, 0.12, 0);
      s.leftArm.rotation.set(-0.72, 0, -0.25);
      s.rightArm.rotation.set(-0.78, 0, 0.25);
      return;
    }

    // 'corridor': stepped out into the hotel escape corridor behind cover
    s.group.position.set(-3.2, y, -8);
    s.group.rotation.set(0, Math.PI, 0);
    s.group.scale.set(1, 1, 1);
    s.leftArm.rotation.set(-0.4, 0, -0.1);
    s.rightArm.rotation.set(-0.85, 0, 0.08);
  }

  /**
   * Smoothly choreographs the 92nd-floor Penthouse patricide cutscene viewed through the slatted closet.
   */
  animatePenthouseMurder(phaseTime: number): void {
    const y = INSTANCE_Y.PENTHOUSE;
    const t = Math.max(0, phaseTime);
    const rodion = this.penthouseRodion;
    const lev = this.penthouseLev;
    const smasher = this.penthouseSmasherProp;

    // Guarantee Sanzhar is crouched inside the walk-in closet beside Ai during the murder cutscene!
    if (this.penthouseSanzharMode !== 'inside_closet') {
      this.setPenthouseSanzharState('inside_closet');
    }

    rodion.group.visible = true;
    lev.group.visible = true;
    smasher.visible = true;

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
      const p = smoothstep((t - 1.8) / 1.2);
      rodion.group.position.set(
        THREE.MathUtils.lerp(1.05, 0.04, p),
        y + Math.abs(Math.sin(p * Math.PI * 2)) * 0.05,
        4.2,
      );
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
      const p = smoothstep((t - 4.4) / 1.0);
      lev.group.position.set(
        THREE.MathUtils.lerp(-0.78, -1.08, p),
        THREE.MathUtils.lerp(y - 0.08, y + 0.22, p),
        4.2,
      );
      lev.group.rotation.set(
        THREE.MathUtils.lerp(0, -Math.PI / 2, p),
        Math.PI * 0.48,
        THREE.MathUtils.lerp(0, 0.14, p),
      );
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
  // 2. CYBER-AKHMED CHASE INTERIOR & HIGHWAY (Y = 220) — UNOBSTRUCTED CABIN!
  // =========================================================================

  private buildChaseTrack(): void {
    const y = INSTANCE_Y.CHASE;

    const roadMat = new THREE.MeshStandardMaterial({
      map: this.textures.getRoadSurface(1, 34),
      roughness: 0.32,
      metalness: 0.45,
    });
    const road = new THREE.Mesh(new THREE.PlaneGeometry(34, 420), roadMat);
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, y, -140);
    this.chaseGroup.add(road);

    const barrierMat = new THREE.MeshStandardMaterial({ color: 0x161b2a, roughness: 0.55, metalness: 0.5 });
    for (const sx of [-16.5, 16.5]) {
      const barrier = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.5, 420), barrierMat);
      barrier.position.set(sx, y + 0.75, -140);
      this.chaseGroup.add(barrier);
      this.addNeonStrip(
        this.chaseGroup,
        sx > 0 ? sx - 0.5 : sx + 0.5,
        y + 1.15,
        -140,
        0.12,
        0.14,
        420,
        0x00f0ff,
        1.55,
      );
    }

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
        emissiveIntensity: 0.78,
        roughness: 0.45,
      });
      const tower = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bw), mat);
      tower.position.y = bh * 0.5 - 4;
      bGroup.add(tower);

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

    // --- UNOBSTRUCTED 1ST-PERSON 3D CABIN INTERIOR OF CYBER-АХМЕД ---
    // Camera eye sits at cabin-local (0, 2.18, 0) looking along -Z toward pursuit drones!
    // Dashboard, hood, and A-pillars sit LOW & WIDE with ZERO roof bar or mirror blocking crosshair!
    const cabin = new THREE.Group();
    cabin.position.set(0, y, 4.0);

    const carbonMat = new THREE.MeshStandardMaterial({ color: 0x111520, metalness: 0.65, roughness: 0.38 });
    const leatherMat = new THREE.MeshStandardMaterial({ color: 0x171a26, metalness: 0.25, roughness: 0.7 });
    const chromeMat = new THREE.MeshStandardMaterial({ color: 0x6c7fa3, metalness: 0.88, roughness: 0.2 });

    // Low sloped armored nose hood well below eye line (Y = 1.16 vs camera eye Y = 2.18)
    const hood = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.2, 2.35), carbonMat);
    hood.position.set(0.12, 1.14, -2.35);
    hood.rotation.x = 0.06;
    cabin.add(hood);
    this.addNeonStrip(cabin, -0.95, 1.26, -2.35, 0.06, 0.035, 2.0, 0x00f0ff, 1.75);
    this.addNeonStrip(cabin, 1.2, 1.26, -2.35, 0.06, 0.035, 2.0, 0x00f0ff, 1.75);

    // Translucent volumetric headlight beams on road ahead (zero SpotLights!)
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xa8ecff,
      transparent: true,
      opacity: 0.14,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    for (const hx of [-0.9, 1.15]) {
      const beam = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 26), beamMat);
      beam.rotation.x = -Math.PI / 2;
      beam.position.set(hx, 0.08, -16.5);
      cabin.add(beam);
    }

    // Low sculpted panoramic dashboard (top at Y = 1.46 — full 0.72m clearance below eye height!)
    const dashMain = new THREE.Mesh(new THREE.BoxGeometry(3.55, 0.46, 0.82), carbonMat);
    dashMain.position.set(0.12, 1.2, -1.08);
    cabin.add(dashMain);

    const dashLip = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.06, 0.88), leatherMat);
    dashLip.position.set(0.12, 1.45, -1.08);
    cabin.add(dashLip);

    // Crisp glowing cyan cockpit dash accent strip
    this.addNeonStrip(cabin, 0.12, 1.43, -0.64, 3.46, 0.028, 0.035, 0x00f0ff, 1.9);

    // Center console divider between Ai (left) and Sanzhar (right)
    const centerConsole = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.48, 1.45), carbonMat);
    centerConsole.position.set(0.45, 1.06, -0.25);
    cabin.add(centerConsole);
    this.addNeonStrip(cabin, 0.45, 1.31, -0.25, 0.04, 0.02, 1.35, 0x00f0ff, 1.5);

    // Glowing "КИБЕР-АХМЕД AI" holographic display mounted low-right on dash (100% clear of crosshair!)
    const akhmedTex = this.createAkhmedHudTexture();
    const screenFrame = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.34, 0.04), chromeMat);
    screenFrame.position.set(0.42, 1.55, -1.06);
    screenFrame.rotation.set(-0.24, -0.32, 0);
    const screenFace = new THREE.Mesh(
      new THREE.PlaneGeometry(0.62, 0.29),
      new THREE.MeshStandardMaterial({
        map: akhmedTex,
        emissiveMap: akhmedTex,
        emissive: new THREE.Color(0xffffff),
        emissiveIntensity: 1.25,
        roughness: 0.2,
      }),
    );
    screenFace.position.set(0, 0, 0.024);
    screenFrame.add(screenFace);
    cabin.add(screenFrame);

    // Steering wheel positioned low-left (clear of center sightline)
    const wheelGroup = new THREE.Group();
    wheelGroup.position.set(-0.48, 1.52, -0.72);
    wheelGroup.rotation.x = -0.34;
    const wheelRim = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.022, 8, 22), leatherMat);
    const wheelHub = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.045, 12), chromeMat);
    wheelHub.rotation.x = Math.PI / 2;
    const wheelSpokeH = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.028, 0.022), chromeMat);
    const wheelSpokeV = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.18, 0.022), chromeMat);
    wheelSpokeV.position.y = -0.095;
    const wheelLed = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.016, 0.028),
      new THREE.MeshBasicMaterial({ color: 0x00f0ff }),
    );
    wheelLed.position.y = 0.18;
    wheelGroup.add(wheelRim, wheelHub, wheelSpokeH, wheelSpokeV, wheelLed);
    this.chaseSteeringWheel = wheelGroup;
    cabin.add(wheelGroup);

    // Wide, slim outer A-pillars & low door sills (wide-open unobstructed forward combat viewport!)
    for (const [px, sideSign] of [
      [-1.72, -1],
      [1.96, 1],
    ]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.18, 0.09), carbonMat);
      pillar.position.set(px, 1.98, -1.04);
      pillar.rotation.x = 0.52;
      cabin.add(pillar);

      const pillarNeon = new THREE.Mesh(
        new THREE.BoxGeometry(0.02, 1.06, 0.02),
        new THREE.MeshBasicMaterial({ color: 0x00f0ff }),
      );
      pillarNeon.position.set(px - sideSign * 0.045, 1.98, -1.02);
      pillarNeon.rotation.x = 0.52;
      cabin.add(pillarNeon);

      const doorSill = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.48, 1.9), carbonMat);
      doorSill.position.set(px, 1.24, -0.05);
      cabin.add(doorSill);
      this.addNeonStrip(cabin, px - sideSign * 0.06, 1.48, -0.05, 0.025, 0.025, 1.7, 0x00f0ff, 1.45);
    }

    // Rear open-targa roll bar BEHIND the player's head (zero forward roof obstruction!)
    const rearRollBar = new THREE.Mesh(new THREE.BoxGeometry(3.75, 0.14, 0.24), carbonMat);
    rearRollBar.position.set(0.12, 2.75, 0.65);
    cabin.add(rearRollBar);

    // Passenger seat cushion & backrest for seated Sanzhar
    const seatCushion = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.18, 0.62), leatherMat);
    seatCushion.position.set(0.94, 1.08, -0.18);
    const seatBack = new THREE.Mesh(new THREE.BoxGeometry(0.68, 1.15, 0.16), leatherMat);
    seatBack.position.set(0.94, 1.62, 0.14);
    seatBack.rotation.x = -0.12;
    cabin.add(seatCushion, seatBack);

    // --- SEATED SANZHAR CLEARLY VISIBLE IN THE RIGHT PASSENGER SEAT ---
    this.chaseSanzhar.group.position.set(0.94, 1.18, -0.22);
    this.chaseSanzhar.group.rotation.set(0, Math.PI * 0.88, 0);
    if (this.chaseSanzhar.torso) {
      this.chaseSanzhar.torso.rotation.set(-0.04, -0.18, 0);
    }
    this.chaseSanzhar.head.rotation.set(0.04, -0.15, 0);
    this.chaseSanzhar.leftArm.rotation.set(-0.55, -0.15, -0.12);
    this.chaseSanzhar.rightArm.rotation.set(-0.48, 0.1, 0.15);

    const woundMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.26, 0.24, 0.04),
      new THREE.MeshStandardMaterial({
        color: 0xaa001a,
        emissive: 0xff0028,
        emissiveIntensity: 1.35,
        roughness: 0.35,
      }),
    );
    woundMesh.position.set(-0.07, 0.19, 0.175);
    woundMesh.visible = false;
    this.chaseSanzharWoundMesh = woundMesh;
    (this.chaseSanzhar.torso ?? this.chaseSanzhar.group).add(woundMesh);
    cabin.add(this.chaseSanzhar.group);

    // Glowing blue Relic Biochip prop that animates from Sanzhar toward Ai's neural slot
    const chipWafer = new THREE.Mesh(
      new THREE.BoxGeometry(0.09, 0.15, 0.025),
      new THREE.MeshStandardMaterial({ color: 0x101c2d, metalness: 0.85, roughness: 0.2 }),
    );
    const chipCore = new THREE.Mesh(
      new THREE.BoxGeometry(0.065, 0.11, 0.032),
      new THREE.MeshStandardMaterial({
        color: 0x00f0ff,
        emissive: 0x00f0ff,
        emissiveIntensity: 3.0,
      }),
    );
    const chipHalo = new THREE.Mesh(
      new THREE.RingGeometry(0.08, 0.12, 16),
      new THREE.MeshBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.65, side: THREE.DoubleSide }),
    );
    this.chaseBiochip.add(chipWafer, chipCore, chipHalo);
    this.chaseBiochip.position.set(0.62, 1.84, -0.46);
    this.chaseBiochip.visible = false;
    cabin.add(this.chaseBiochip);

    this.chaseGroup.add(cabin);
  }

  setChaseBiochipVisible(visible: boolean): void {
    this.chaseBiochipVisible = visible;
    this.chaseBiochip.visible = visible;
    this.chaseSanzhar.setBiochipVisible?.(false);
    if (visible) {
      this.chaseBiochipProgress = 0;
      this.chaseBiochip.position.set(0.62, 1.84, -0.46);
    }
  }

  setChaseSanzharWounded(wounded: boolean): void {
    this.chaseSanzharWounded = wounded;
    if (this.chaseSanzharWoundMesh) {
      this.chaseSanzharWoundMesh.visible = wounded;
    }
    if (wounded) {
      this.chaseSanzhar.group.position.set(0.88, 1.12, -0.22);
      this.chaseSanzhar.group.rotation.set(0.06, Math.PI * 0.82, 0.08);
      if (this.chaseSanzhar.torso) {
        this.chaseSanzhar.torso.rotation.set(-0.14, -0.25, -0.09);
      }
      this.chaseSanzhar.head.rotation.set(0.24, -0.26, -0.14);
      this.chaseSanzhar.leftArm.rotation.set(-1.05, -0.35, -0.12);
      this.chaseSanzhar.rightArm.rotation.set(-0.48, 0.2, 0.24);
    } else {
      this.chaseSanzhar.group.position.set(0.94, 1.18, -0.22);
      this.chaseSanzhar.group.rotation.set(0, Math.PI * 0.88, 0);
      if (this.chaseSanzhar.torso) {
        this.chaseSanzhar.torso.rotation.set(-0.04, -0.18, 0);
      }
      this.chaseSanzhar.head.rotation.set(0.04, -0.15, 0);
      this.chaseSanzhar.leftArm.rotation.set(-0.55, -0.15, -0.12);
      this.chaseSanzhar.rightArm.rotation.set(-0.48, 0.1, 0.15);
    }
  }

  // =========================================================================
  // 3. MARAKULIN TOWER ASSAULT + PASS-THROUGH ELEVATOR + BOSS ARENA (Y = -66 / -90)
  // =========================================================================

  private buildMarakulinUnderground(): void {
    const yLobby = INSTANCE_Y.UNDERGROUND + 24; // -66
    const yCore = INSTANCE_Y.UNDERGROUND; // -90

    const floorMat = new THREE.MeshStandardMaterial({
      map: this.textures.getFloorTile('#ff003c', 8, 12),
      roughness: 0.42,
      metalness: 0.28,
    });
    const wallMat = new THREE.MeshStandardMaterial({
      map: this.textures.getWallPanel('#ff003c', 5, 2),
      roughness: 0.54,
      metalness: 0.32,
    });
    const darkMarbleMat = new THREE.MeshStandardMaterial({
      color: 0x1d2438,
      roughness: 0.4,
      metalness: 0.38,
    });
    const rackTex = this.textures.getServerRack();
    const rackMat = new THREE.MeshStandardMaterial({
      map: rackTex,
      emissiveMap: rackTex,
      emissive: new THREE.Color(0x99ccff),
      emissiveIntensity: 0.78,
      roughness: 0.44,
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
    // UPPER LEVEL: MARAKULIN TOWER MAIN ATRIUM LOBBY (Y = -66, Z: 18 .. -28)
    // ---------------------------------------------------------------------
    const lobbyH = 9.2;
    const lobbyFloor = new THREE.Mesh(new THREE.BoxGeometry(30, 0.4, 46), floorMat);
    lobbyFloor.position.set(0, yLobby - 0.2, -5);
    this.undergroundGroup.add(lobbyFloor);

    const lobbyCeil = new THREE.Mesh(
      new THREE.BoxGeometry(30, 0.4, 46),
      new THREE.MeshStandardMaterial({ color: 0x101524, roughness: 0.85 }),
    );
    lobbyCeil.position.set(0, yLobby + lobbyH + 0.2, -5);
    this.undergroundGroup.add(lobbyCeil);
    this.physics.addBox('ug_lobby_ceil', 0, yLobby + lobbyH + 0.2, -5, 30, 0.4, 46);

    addBox('ug_l_w', -14.6, yLobby + lobbyH * 0.5, -5, 0.8, lobbyH, 46);
    addBox('ug_l_e', 14.6, yLobby + lobbyH * 0.5, -5, 0.8, lobbyH, 46);
    addBox('ug_l_s', 0, yLobby + lobbyH * 0.5, 17.6, 30, lobbyH, 0.8);

    // Lobby North wall FLUSH at Z = -28.0 (matches Pass-Through Elevator South entry at -30.5 + 2.5 = -28.0!)
    addBox('ug_l_nl', -8.65, yLobby + lobbyH * 0.5, -27.7, 12.7, lobbyH, 0.6);
    addBox('ug_l_nr', 8.65, yLobby + lobbyH * 0.5, -27.7, 12.7, lobbyH, 0.6);
    // Upper portal header ONLY above Y = yLobby + 3.6
    const elevHeader = new THREE.Mesh(new THREE.BoxGeometry(4.8, lobbyH - 3.6, 0.62), wallMat);
    elevHeader.position.set(0, yLobby + 3.6 + (lobbyH - 3.6) * 0.5, -27.7);
    this.undergroundGroup.add(elevHeader);
    this.addNeonStrip(this.undergroundGroup, 0, yLobby + 3.64, -27.36, 4.7, 0.1, 0.1, 0x00f0ff, 1.8);

    // Central crimson-trimmed dais + spinning corporate hologram monument
    addBox('ug_dais', 0, yLobby + 0.6, -4.5, 2.8, 1.2, 2.8, darkMarbleMat, false);
    this.addNeonStrip(this.undergroundGroup, 0, yLobby + 1.23, -4.5, 2.9, 0.07, 2.9, 0xff003c, 1.75);

    const holoSpinner = new THREE.Group();
    holoSpinner.position.set(0, yLobby + 3.6, -4.5);
    const coreOct = new THREE.Mesh(
      new THREE.OctahedronGeometry(1.15, 0),
      new THREE.MeshBasicMaterial({ color: 0xff003c, wireframe: true, transparent: true, opacity: 0.82 }),
    );
    const outerRing = new THREE.Mesh(
      new THREE.TorusGeometry(1.75, 0.06, 8, 28),
      new THREE.MeshBasicMaterial({ color: 0x00f0ff, wireframe: true, transparent: true, opacity: 0.65 }),
    );
    outerRing.rotation.x = Math.PI / 3;
    holoSpinner.add(coreOct, outerRing);
    this.towerHoloSpinner = holoSpinner;
    this.undergroundGroup.add(holoSpinner);

    // 6 Tall dark marble columns with crimson & cyan vertical neon strips
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
      this.addNeonStrip(this.undergroundGroup, px, yLobby + lobbyH * 0.5, pz + 1.13, 0.16, lobbyH - 0.6, 0.08, 0xff003c, 1.65);
      this.addNeonStrip(this.undergroundGroup, px, yLobby + lobbyH * 0.5, pz - 1.13, 0.16, lobbyH - 0.6, 0.08, 0x00f0ff, 1.65);
    }

    // Wall-mounted emissiveMap server rack banks
    [0, -14].forEach((rz, idx) => {
      const rackW = new THREE.Mesh(new THREE.BoxGeometry(1.1, 4.6, 4.4), rackMat);
      rackW.position.set(-13.6, yLobby + 2.3, rz);
      this.undergroundGroup.add(rackW);
      this.physics.addBox(`ug_rack_w_${idx}`, -13.6, yLobby + 2.3, rz, 1.1, 4.6, 4.4);
      this.addNeonStrip(this.undergroundGroup, -13.02, yLobby + 4.62, rz, 0.08, 0.08, 4.44, 0x00f0ff, 1.6);
    });
    const rackE = new THREE.Mesh(new THREE.BoxGeometry(1.1, 4.6, 4.4), rackMat);
    rackE.position.set(13.6, yLobby + 2.3, -14);
    this.undergroundGroup.add(rackE);
    this.physics.addBox('ug_rack_e_0', 13.6, yLobby + 2.3, -14, 1.1, 4.6, 4.4);
    this.addNeonStrip(this.undergroundGroup, 13.02, yLobby + 4.62, -14, 0.08, 0.08, 4.44, 0xff003c, 1.6);

    // Tactical waist-high cover blocks with cyan neon trim
    const lobbyCovers: Array<[string, number, number, number, number]> = [
      ['ug_cov_1', -4.6, 5.5, 3.2, 1.0],
      ['ug_cov_2', 4.6, 5.5, 3.2, 1.0],
      ['ug_cov_3', -4.6, -7.5, 3.2, 1.0],
      ['ug_cov_4', 4.6, -7.5, 3.2, 1.0],
      ['ug_cov_5', 0, -21.5, 4.4, 1.1],
    ];
    for (const [id, cx, cz, w, d] of lobbyCovers) {
      addBox(id, cx, yLobby + 0.65, cz, w, 1.3, d, darkMarbleMat, false);
      this.addNeonStrip(this.undergroundGroup, cx, yLobby + 1.33, cz, w + 0.06, 0.06, d + 0.06, 0x00f0ff, 1.55);
    }

    // Overhead neon ceiling trusses alternating crimson & cyan (bright emissive strips, zero extra PointLights!)
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
        0.18,
        0.34,
        isCrimson ? 0xff003c : 0x00f0ff,
        1.8,
      );
    });

    // Emissive corporate banners in Main Atrium Lobby
    this.addEmissiveBanner(
      this.undergroundGroup,
      this.textures.getNeonSign('MARAKULIN CORP // ГЛАВНЫЙ ХОЛЛ', 'ОХРАНА КЛАССА А → ЛИФТ К ЯДРУ «ХУЕШИ»', '#ff003c', '#00f0ff'),
      0,
      yLobby + 6.4,
      -27.3,
      14.8,
      3.3,
      0,
      0.9,
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
      0.85,
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
      0.85,
    );

    // Glowing green MaxDoc Supply Crate #1 in Main Atrium Lobby
    this.addSupplyCrate(this.undergroundGroup, 'tower_supply_lobby', -11.8, yLobby, 9.5);

    // Hackable Security Server Terminal in Lobby
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
        emissiveIntensity: 1.15,
      }),
    );
    termScreen.position.set(0, 1.72, -0.34);
    termScreen.rotation.x = -0.18;

    this.securityTerminalBeaconMat = new THREE.MeshStandardMaterial({
      color: 0xfcee0a,
      emissive: 0xfcee0a,
      emissiveIntensity: 2.1,
    });
    const termBeacon = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.12, 0.14), this.securityTerminalBeaconMat);
    termBeacon.position.set(0, 2.25, -0.34);
    const termKeyPad = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.05, 0.45), this.securityTerminalBeaconMat);
    termKeyPad.position.set(0, 1.18, 0.1);

    termGroup.add(termDesk, termRack, termScreen, termBeacon, termKeyPad);
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
    // LOWER LEVEL: SMASHER BOSS ARENA (Y = -90, Z: -33 .. -98) + HUYESHI CHAMBER
    // ---------------------------------------------------------------------
    const arenaH = 11.0;
    const arenaFloor = new THREE.Mesh(new THREE.BoxGeometry(44, 0.4, 65.4), floorMat);
    arenaFloor.position.set(0, yCore - 0.2, -65.5);
    this.undergroundGroup.add(arenaFloor);

    const arenaCeil = new THREE.Mesh(
      new THREE.BoxGeometry(44, 0.4, 65.4),
      new THREE.MeshStandardMaterial({ color: 0x0d1220, roughness: 0.85 }),
    );
    arenaCeil.position.set(0, yCore + arenaH + 0.2, -65.5);
    this.undergroundGroup.add(arenaCeil);
    this.physics.addBox('boss_arena_ceil', 0, yCore + arenaH + 0.2, -65.5, 44, 0.4, 65.4);

    addBox('boss_w', -21.6, yCore + arenaH * 0.5, -65.5, 0.8, arenaH, 65.4);
    addBox('boss_e', 21.6, yCore + arenaH * 0.5, -65.5, 0.8, arenaH, 65.4);
    addBox('boss_n', 0, yCore + arenaH * 0.5, -97.8, 44, arenaH, 0.8);

    // South wall at Z = -33.0 FLUSH with Pass-Through Elevator North exit portal (X: -2.4 .. 2.4)!
    addBox('boss_sl', -12.2, yCore + arenaH * 0.5, -33.3, 19.6, arenaH, 0.6);
    addBox('boss_sr', 12.2, yCore + arenaH * 0.5, -33.3, 19.6, arenaH, 0.6);
    // Upper portal header above elevator exit (Y > yCore + 3.6)
    const arenaElevHeader = new THREE.Mesh(new THREE.BoxGeometry(5.0, arenaH - 3.6, 0.62), wallMat);
    arenaElevHeader.position.set(0, yCore + 3.6 + (arenaH - 3.6) * 0.5, -33.3);
    this.undergroundGroup.add(arenaElevHeader);
    this.addNeonStrip(this.undergroundGroup, 0, yCore + 3.65, -33.64, 4.9, 0.1, 0.1, 0xff003c, 1.85);

    // Crimson floor runway lines guiding player from elevator exit (Z = -33) straight to Smasher & Huyeshi
    this.addNeonStrip(this.undergroundGroup, -2.6, yCore + 0.03, -60, 0.16, 0.04, 52, 0xff003c, 1.65);
    this.addNeonStrip(this.undergroundGroup, 2.6, yCore + 0.03, -60, 0.16, 0.04, 52, 0xff003c, 1.65);

    // 4 Massive dark marble + emissive server-rack tactical pillars with crimson & gold neon strips
    for (const [px, pz, idx] of [
      [-10.5, -48, 1],
      [10.5, -48, 2],
      [-10.5, -72, 3],
      [10.5, -72, 4],
    ]) {
      addBox(`boss_col_${idx}`, px, yCore + 4.5, pz, 3.2, 9.0, 3.2, rackMat);
      this.addNeonStrip(this.undergroundGroup, px, yCore + 4.5, pz + 1.64, 0.18, 8.4, 0.08, 0xff003c, 1.65);
      this.addNeonStrip(this.undergroundGroup, px, yCore + 4.5, pz - 1.64, 0.18, 8.4, 0.08, 0xfcee0a, 1.65);
      this.addNeonStrip(this.undergroundGroup, px, yCore + 9.05, pz, 3.28, 0.1, 3.28, 0xfcee0a, 1.55);
    }

    // 4 Waist-high tactical cover monoliths with glowing golden top trim
    const arenaLowCovers: Array<[string, number, number]> = [
      ['boss_low_1', -6.8, -42],
      ['boss_low_2', 6.8, -42],
      ['boss_low_3', -7.8, -60],
      ['boss_low_4', 7.8, -60],
    ];
    for (const [id, lx, lz] of arenaLowCovers) {
      addBox(id, lx, yCore + 0.82, lz, 3.4, 1.64, 1.4, darkMarbleMat, false);
      this.addNeonStrip(this.undergroundGroup, lx, yCore + 1.67, lz, 3.46, 0.07, 1.46, 0xfcee0a, 1.6);
    }

    // Flanking emissiveMap server rack banks along West & East Arena walls
    let bossRackIdx = 0;
    for (const rz of [-42, -57, -72]) {
      for (const sx of [-20.5, 20.5]) {
        const bank = new THREE.Mesh(new THREE.BoxGeometry(1.2, 5.4, 6.2), rackMat);
        bank.position.set(sx, yCore + 2.7, rz);
        this.undergroundGroup.add(bank);
        this.physics.addBox(`boss_rack_${bossRackIdx++}`, sx, yCore + 2.7, rz, 1.2, 5.4, 6.2);
        this.addNeonStrip(
          this.undergroundGroup,
          sx > 0 ? sx - 0.64 : sx + 0.64,
          yCore + 5.45,
          rz,
          0.08,
          0.08,
          6.24,
          rz === -57 ? 0xfcee0a : 0xff003c,
          1.55,
        );
      }
    }

    // Overhead neon ceiling trusses alternating crimson & golden
    const arenaTrussZ = [-38, -51, -64, -77];
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
        0.2,
        0.38,
        isCrimson ? 0xff003c : 0xfcee0a,
        1.8,
      );
    });

    // Emissive corporate banners in Smasher Boss Arena
    this.addEmissiveBanner(
      this.undergroundGroup,
      this.textures.getNeonSign('ХУЕШИ // ЯДРО СИСТЕМЫ', 'ПОДЗЕМНЫЙ КОМПЛЕКС -12 ЭТ. // НЕЙРО-СЕПАРАТОР', '#ff003c', '#00f0ff'),
      0,
      yCore + 9.1,
      -97.2,
      16.5,
      3.2,
      0,
      0.92,
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
      0.86,
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
      0.86,
    );

    // Glowing green MaxDoc Supply Crate #2 in the Smasher Boss Arena
    this.addSupplyCrate(this.undergroundGroup, 'tower_supply_arena', -16.5, yCore, -56);

    // Huyeshi Chamber (Z = -90)
    this.buildHuyeshiChamber(yCore);

    this.interactables.push(
      {
        id: 'tower_elevator_down',
        label: '[E] СПУСТИТЬСЯ НА ЛИФТЕ К КОМПЛЕКСУ «ХУЕШИ»',
        x: 0,
        y: yLobby + 1.2,
        z: -30.5,
        radius: 2.8,
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

    // Stepped circular neural dais
    const daisBase = new THREE.Mesh(new THREE.CylinderGeometry(4.8, 5.4, 0.22, 24), darkChassisMat);
    daisBase.position.set(0, yCore + 0.11, -90);
    this.undergroundGroup.add(daisBase);

    const daisTrim = new THREE.Mesh(
      new THREE.TorusGeometry(4.85, 0.07, 10, 36),
      new THREE.MeshStandardMaterial({
        color: 0x00f0ff,
        emissive: 0x00f0ff,
        emissiveIntensity: 1.9,
      }),
    );
    daisTrim.rotation.x = Math.PI / 2;
    daisTrim.position.set(0, yCore + 0.24, -90);
    this.undergroundGroup.add(daisTrim);

    // Ambient rotating Huyeshi hologram ring framing the chamber
    this.huyeshiAmbientRing = new THREE.Mesh(
      new THREE.TorusGeometry(4.1, 0.1, 10, 36),
      new THREE.MeshBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.65 }),
    );
    this.huyeshiAmbientRing.position.set(0, yCore + 3.4, -90);
    this.undergroundGroup.add(this.huyeshiAmbientRing);

    // Neural Jack-In Chair with glowing crimson laser restraints
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

    const laserBarMat = new THREE.MeshBasicMaterial({ color: 0xff003c, transparent: true, opacity: 0.78 });
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
      emissiveIntensity: 1.12,
      roughness: 0.3,
    });
    const huyeshiTex = this.textures.getHuyeshiMonitor();
    const huyeshiMonMat = new THREE.MeshStandardMaterial({
      map: huyeshiTex,
      emissiveMap: huyeshiTex,
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity: 1.18,
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
    centralScreen.position.set(0, yCore + 5.6, -97.1);
    this.undergroundGroup.add(centralScreen);

    // Overhead Descending Neural Crown + Surgical Volumetric Beam + 6 Converging Red Extraction Lasers
    this.huyeshiCrown.position.set(0, yCore + 5.6, -90);

    const crownOuter = new THREE.Mesh(new THREE.TorusGeometry(1.45, 0.11, 10, 32), steelMat);
    crownOuter.rotation.x = Math.PI / 2;
    this.huyeshiCrown.add(crownOuter);

    this.huyeshiCrownLampMat = new THREE.MeshStandardMaterial({
      color: 0xd8f8ff,
      emissive: 0xb8f0ff,
      emissiveIntensity: 2.6,
    });
    const crownLamp = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.07, 8, 28), this.huyeshiCrownLampMat);
    crownLamp.rotation.x = Math.PI / 2;
    crownLamp.position.y = -0.06;
    this.huyeshiCrown.add(crownLamp);

    // Translucent volumetric surgical light cone (rich Bolt 1 OperatingTable glow with 0 SpotLights!)
    this.huyeshiSurgicalBeamMat = new THREE.MeshBasicMaterial({
      color: 0xb8ecff,
      transparent: true,
      opacity: 0.14,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const surgicalCone = new THREE.Mesh(
      new THREE.CylinderGeometry(1.22, 2.75, 5.2, 20, 1, true),
      this.huyeshiSurgicalBeamMat,
    );
    surgicalCone.position.y = -2.6;
    this.huyeshiCrown.add(surgicalCone);

    const laserMat = new THREE.MeshBasicMaterial({
      color: 0xff003c,
      transparent: true,
      opacity: 0.9,
    });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const prong = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.42, 0.14), steelMat);
      prong.position.set(Math.cos(a) * 1.25, -0.22, Math.sin(a) * 1.25);
      this.huyeshiCrown.add(prong);

      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.016, 2.8, 6), laserMat);
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
  }

  setHuyeshiExtraction(progress: number): void {
    const yCore = INSTANCE_Y.UNDERGROUND;
    const p = clamp01(progress);
    this.huyeshiExtractionProgress = p;
    this.huyeshiLasers.visible = p > 0.02;
    this.huyeshiCrown.position.y = THREE.MathUtils.lerp(yCore + 5.6, yCore + 3.45, Math.min(1, p * 1.35));
    const pMat = this.huyeshiParticles.material as THREE.PointsMaterial;
    pMat.opacity = 0.25 + p * 0.72;
    if (this.huyeshiSurgicalBeamMat) {
      this.huyeshiSurgicalBeamMat.color.setHex(p > 0.35 ? 0xff4477 : 0xb8ecff);
      this.huyeshiSurgicalBeamMat.opacity = 0.14 + p * 0.16;
    }
    if (this.activeInstance === 'UNDERGROUND') {
      this.syncUndergroundLighting(0);
    }
  }

  setSupplyCrateUsed(id: string, used = true): void {
    const crate = this.supplyCrates.get(id);
    if (crate) {
      crate.used = used;
      if (used) {
        crate.glowMat.color.setHex(0x334444);
        crate.glowMat.emissive.setHex(0x112222);
        crate.glowMat.emissiveIntensity = 0.15;
        crate.haloMat.opacity = 0.0;
      } else {
        crate.glowMat.color.setHex(0x00ff88);
        crate.glowMat.emissive.setHex(0x00ff88);
        crate.glowMat.emissiveIntensity = 2.0;
        crate.haloMat.opacity = 0.28;
      }
    }
    this.setInteractableEnabled(id, !used);
  }

  setTowerSecurityHacked(hacked: boolean): void {
    const hex = hacked ? 0x00ff88 : 0xfcee0a;
    if (this.securityTerminalBeaconMat) {
      this.securityTerminalBeaconMat.color.setHex(hex);
      this.securityTerminalBeaconMat.emissive.setHex(hex);
      this.securityTerminalBeaconMat.emissiveIntensity = hacked ? 1.65 : 2.1;
    }
    this.setInteractableEnabled('tower_hack_security', !hacked);
  }

  // =========================================================================
  // 4. CYBERSPACE & BLACKWALL (Y = 320)
  // =========================================================================

  private buildCyberspace(): void {
    const y = INSTANCE_Y.CYBERSPACE;

    const bridge = new THREE.Mesh(
      new THREE.BoxGeometry(8, 0.3, 48),
      new THREE.MeshStandardMaterial({
        color: 0x091628,
        emissive: 0x00a8cc,
        emissiveIntensity: 0.65,
        roughness: 0.22,
        metalness: 0.65,
      }),
    );
    bridge.position.set(0, y - 0.15, -13);
    this.cyberspaceGroup.add(bridge);

    // Invisible guardrails keeping the player on the 8m-wide Cyberspace bridge
    this.physics.addBox('cyb_rail_l', -4.35, y + 2.5, -13, 0.8, 5, 50, { blocksSight: false });
    this.physics.addBox('cyb_rail_r', 4.35, y + 2.5, -13, 0.8, 5, 50, { blocksSight: false });
    this.physics.addBox('cyb_back', 0, y + 2.5, 11.4, 9.5, 5, 0.8, { blocksSight: false });
    this.physics.addBox('cyb_front', 0, y + 2.5, -24.2, 9.5, 5, 0.8, { blocksSight: false });

    this.addNeonStrip(this.cyberspaceGroup, -3.95, y + 0.08, -13, 0.12, 0.12, 48, 0x00f0ff, 1.9);
    this.addNeonStrip(this.cyberspaceGroup, 3.95, y + 0.08, -13, 0.12, 0.12, 48, 0x00f0ff, 1.9);
    this.addNeonStrip(this.cyberspaceGroup, 0, y + 0.02, -13, 0.18, 0.04, 46, 0xff2a6d, 1.5);

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

    const grid = new THREE.GridHelper(180, 44, 0xff0055, 0x00f0ff);
    grid.position.set(0, y - 4, -18);
    this.cyberspaceGroup.add(grid);

    const blackwallTex = this.createBlackwallTexture();
    this.cyberBlackwallMat = new THREE.MeshStandardMaterial({
      map: blackwallTex,
      emissiveMap: blackwallTex,
      emissive: new THREE.Color(0xff2255),
      emissiveIntensity: 1.4,
      transparent: true,
      opacity: 0.92,
      roughness: 0.3,
    });
    const blackwall = new THREE.Mesh(new THREE.PlaneGeometry(150, 56), this.cyberBlackwallMat);
    blackwall.position.set(0, y + 18, -48);
    this.cyberspaceGroup.add(blackwall);

    const blackwallGrid = new THREE.Mesh(
      new THREE.PlaneGeometry(148, 54, 28, 12),
      new THREE.MeshBasicMaterial({ color: 0xff003c, wireframe: true, transparent: true, opacity: 0.34 }),
    );
    blackwallGrid.position.set(0, y + 18, -46.8);
    this.cyberspaceGroup.add(blackwallGrid);

    const monoMat = new THREE.MeshBasicMaterial({ color: 0xff004c, wireframe: true, transparent: true, opacity: 0.55 });
    for (let i = 0; i < 16; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const monoH = 18 + (i % 4) * 6;
      const mono = new THREE.Mesh(new THREE.BoxGeometry(3.2, monoH, 3.2), monoMat);
      mono.position.set(side * (13 + (i % 3) * 7), y + 4, 8 - i * 4.2);
      this.cyberspaceGroup.add(mono);

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

    // Taisiya waiting at end of the digital bridge + 12 orbiting neural shards
    this.taisiyaRig.group.position.set(0, y, -26);
    this.cyberspaceGroup.add(this.taisiyaRig.group);

    const shardGeo = new THREE.OctahedronGeometry(0.24, 0);
    for (let i = 0; i < 12; i++) {
      const isCyan = i % 2 === 0;
      const shard = new THREE.Mesh(
        shardGeo,
        new THREE.MeshStandardMaterial({
          color: isCyan ? 0x00f0ff : 0xff2a88,
          emissive: isCyan ? 0x00f0ff : 0xff2a88,
          emissiveIntensity: 2.0,
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

    const buildPortal = (px: number, colorHex: number, title: string, subtitle: string, hexStr: string) => {
      const outer = new THREE.Mesh(
        new THREE.TorusGeometry(2.5, 0.14, 12, 32),
        new THREE.MeshBasicMaterial({ color: colorHex }),
      );
      outer.position.set(px, y + 2.7, -33);
      this.cyberspaceGroup.add(outer);

      const inner = new THREE.Mesh(
        new THREE.TorusGeometry(1.95, 0.08, 10, 28),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.72 }),
      );
      inner.position.set(px, y + 2.7, -33);
      this.cyberspaceGroup.add(inner);
      this.cyberPortalRings.push(outer, inner);

      const vortex = new THREE.Mesh(
        new THREE.CircleGeometry(2.15, 28),
        new THREE.MeshBasicMaterial({
          color: colorHex,
          transparent: true,
          opacity: 0.25,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      vortex.position.set(px, y + 2.7, -33);
      this.cyberspaceGroup.add(vortex);

      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(1.1, 2.3, 46, 16, 1, true),
        new THREE.MeshBasicMaterial({
          color: colorHex,
          transparent: true,
          opacity: 0.2,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      beam.position.set(px, y + 21, -33);
      this.cyberspaceGroup.add(beam);

      this.addEmissiveBanner(
        this.cyberspaceGroup,
        this.textures.getNeonSign(title, subtitle, hexStr, '#ffffff'),
        px,
        y + 6.4,
        -33,
        6.4,
        1.55,
        0,
        0.95,
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

    const skyTex = this.createSunsetSkyTexture();
    const skyDome = new THREE.Mesh(
      new THREE.SphereGeometry(265, 28, 18),
      new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false }),
    );
    skyDome.position.set(0, y + 8, -40);
    this.taldykorganGroup.add(skyDome);

    const steppe = new THREE.Mesh(
      new THREE.PlaneGeometry(420, 420),
      new THREE.MeshStandardMaterial({ color: 0x341c12, roughness: 0.94, metalness: 0.05 }),
    );
    steppe.rotation.x = -Math.PI / 2;
    steppe.position.set(0, y - 0.06, -100);
    this.taldykorganGroup.add(steppe);

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
      0.96,
    );

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

    // Intercity Bus / Car Dashboard Silhouette
    const busCab = new THREE.Group();
    busCab.position.set(0, y, 8.0);

    const cabMat = new THREE.MeshStandardMaterial({ color: 0x0e0b0d, metalness: 0.42, roughness: 0.65 });
    const amberGlowMat = new THREE.MeshBasicMaterial({ color: 0xff8822 });

    const dash = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.72, 0.95), cabMat);
    dash.position.set(0, 0.78, -1.45);
    busCab.add(dash);

    const gaugePanel = new THREE.Mesh(
      new THREE.BoxGeometry(0.92, 0.18, 0.06),
      new THREE.MeshStandardMaterial({
        color: 0xff8822,
        emissive: 0xff6600,
        emissiveIntensity: 1.7,
      }),
    );
    gaugePanel.position.set(-0.92, 1.18, -1.32);
    gaugePanel.rotation.x = -0.35;
    busCab.add(gaugePanel);

    this.addNeonStrip(busCab, 0, 1.14, -0.99, 4.2, 0.025, 0.03, 0xff7722, 1.45);

    const busWheel = new THREE.Group();
    busWheel.position.set(-0.95, 1.24, -1.08);
    busWheel.rotation.x = -0.62;
    const bRim = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.028, 8, 22), cabMat);
    const bSpoke = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.035, 0.03), cabMat);
    busWheel.add(bRim, bSpoke);
    this.taldySteeringWheel = busWheel;
    busCab.add(busWheel);

    for (const sx of [-2.15, 2.15]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.2, 0.16), cabMat);
      pillar.position.set(sx, 1.98, -1.35);
      pillar.rotation.x = 0.16;
      busCab.add(pillar);
    }

    const visor = new THREE.Mesh(new THREE.BoxGeometry(4.55, 0.24, 0.65), cabMat);
    visor.position.set(0, 2.95, -1.15);
    busCab.add(visor);

    const charmCord = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.28, 6), cabMat);
    charmCord.position.set(0.12, 2.72, -1.32);
    const charm = new THREE.Mesh(new THREE.OctahedronGeometry(0.055, 0), amberGlowMat);
    charm.position.set(0.12, 2.55, -1.32);
    this.taldyDashCharm = charm;
    busCab.add(charmCord, charm);

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
      // Subtle warm golden chandelier breath + corridor alarm pulse
      this.instanceKeyLight.intensity = 41 + Math.sin(elapsed * 2.1) * 2.2;
      this.instanceFillLight.intensity = 33 + Math.sin(elapsed * 4.5) * 4.5;
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
      this.instanceKeyLight.intensity = 13.5 + Math.sin(elapsed * 8.5) * 1.8;

      if (this.chaseBiochipVisible) {
        this.chaseBiochipProgress = Math.min(1, this.chaseBiochipProgress + dt * 0.45);
        const p = smoothstep(this.chaseBiochipProgress);
        this.chaseBiochip.position.set(
          THREE.MathUtils.lerp(0.62, 0.14, p),
          THREE.MathUtils.lerp(1.84, 2.04, p),
          THREE.MathUtils.lerp(-0.46, -0.2, p),
        );
        this.chaseBiochip.rotation.y = elapsed * 2.4;
        this.chaseBiochip.rotation.z = Math.sin(elapsed * 3) * 0.18;

        this.chaseSanzhar.rightArm.rotation.x = THREE.MathUtils.lerp(-1.15, -1.55, p);
        this.chaseSanzhar.rightArm.rotation.z = THREE.MathUtils.lerp(0.25, 0.52, p);
        this.instanceKeyLight.intensity = 17 + Math.sin(elapsed * 12) * 2.5;
      } else if (this.chaseSanzharWounded) {
        this.chaseSanzhar.head.rotation.x = 0.26 + Math.sin(elapsed * 2.6) * 0.04;
      }
    }

    // 3. Marakulin Tower Lobby, Smasher Arena & Huyeshi Chamber
    if (this.undergroundGroup.visible) {
      animateHologramRig(this.undergroundSamir, elapsed);
      this.syncUndergroundLighting(elapsed);

      if (this.towerHoloSpinner) {
        this.towerHoloSpinner.rotation.y += dt * 0.72;
        this.towerHoloSpinner.position.y = INSTANCE_Y.UNDERGROUND + 24 + 3.6 + Math.sin(elapsed * 1.9) * 0.2;
      }

      if (this.huyeshiAmbientRing) {
        this.huyeshiAmbientRing.rotation.z = elapsed * 0.45;
        this.huyeshiAmbientRing.rotation.x = Math.sin(elapsed * 0.5) * 0.22;
      }
      if (this.huyeshiCrownLampMat) {
        this.huyeshiCrownLampMat.emissiveIntensity =
          2.5 + Math.sin(elapsed * 11) * (this.huyeshiExtractionProgress > 0 ? 0.8 : 0.2);
      }

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

    // 4. Cyberspace
    if (this.cyberspaceGroup.visible) {
      animateHologramRig(this.taisiyaRig, elapsed);
      this.cyberParticles.rotation.y = elapsed * 0.08;

      if (this.cyberBlackwallMat) {
        this.cyberBlackwallMat.emissiveIntensity = 1.25 + Math.sin(elapsed * 3.4) * 0.28;
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

  dispose(): void {
    for (const tex of this.localTextures) {
      tex.dispose();
    }
    this.localTextures.length = 0;
    this.penthouseElevator.dispose();
    this.undergroundElevator.dispose();
  }
}

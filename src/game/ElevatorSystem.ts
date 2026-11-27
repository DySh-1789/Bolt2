import * as THREE from 'three';
import type { AABB } from '../types/game';
import type { PhysicsWorld } from '../engine/Physics';
import type { ProceduralTextures } from '../engine/ProceduralTextures';

export interface ElevatorConfig {
  id: string;
  centerX: number;
  centerZ: number;
  startY: number;
  endY: number;
  startFloorLabel: number;
  endFloorLabel: number;
  travelDuration: number;
  doorFacingZ: 1 | -1; // entry side at startY (+1 = South, -1 = North)
  exitDoorFacingZ?: 1 | -1; // exit side at endY (defaults to doorFacingZ; -doorFacingZ = pass-through)
  width?: number;
  depth?: number;
  cabinHeight?: number;
  accentHex?: number;
  accentCss?: string;
  destinationLabel?: string;
}

export interface ElevatorStepResult {
  startedMoving: boolean;
  arrived: boolean;
  floorChanged: boolean;
  displayFloor: number;
}

/**
 * Pure elevator state machine borrowed and adapted from Bolt 1.
 * Decoupled from Three.js/DOM for deterministic unit tests.
 */
export class ElevatorState {
  readonly config: ElevatorConfig;
  phase: 'IDLE_START' | 'CLOSING' | 'MOVING' | 'OPENING' | 'ARRIVED' = 'IDLE_START';
  currentY: number;
  doorOpen = 1;
  progress = 0;
  displayFloor: number;

  constructor(config: ElevatorConfig) {
    this.config = config;
    this.currentY = config.startY;
    this.displayFloor = config.startFloorLabel;
  }

  reset(): void {
    this.phase = 'IDLE_START';
    this.currentY = this.config.startY;
    this.doorOpen = 1;
    this.progress = 0;
    this.displayFloor = this.config.startFloorLabel;
  }

  snapToArrived(): void {
    this.phase = 'ARRIVED';
    this.currentY = this.config.endY;
    this.doorOpen = 1;
    this.progress = 1;
    this.displayFloor = this.config.endFloorLabel;
  }

  startRide(): boolean {
    if (this.phase !== 'IDLE_START') return false;
    this.phase = 'CLOSING';
    return true;
  }

  step(dt: number): ElevatorStepResult {
    let startedMoving = false;
    let arrived = false;
    let floorChanged = false;

    if (this.phase === 'CLOSING') {
      this.doorOpen = Math.max(0, this.doorOpen - dt * 1.9);
      if (this.doorOpen <= 0) {
        this.phase = 'MOVING';
        startedMoving = true;
      }
    } else if (this.phase === 'MOVING') {
      this.progress = Math.min(1, this.progress + dt / this.config.travelDuration);
      const eased =
        this.progress < 0.5
          ? 2 * this.progress * this.progress
          : 1 - Math.pow(-2 * this.progress + 2, 2) / 2;
      this.currentY = this.config.startY + (this.config.endY - this.config.startY) * eased;

      const nextFloor = Math.round(
        this.config.startFloorLabel +
          (this.config.endFloorLabel - this.config.startFloorLabel) * eased,
      );
      if (nextFloor !== this.displayFloor) {
        this.displayFloor = nextFloor;
        floorChanged = true;
      }

      if (this.progress >= 1) {
        this.currentY = this.config.endY;
        this.displayFloor = this.config.endFloorLabel;
        this.phase = 'OPENING';
      }
    } else if (this.phase === 'OPENING') {
      this.doorOpen = Math.min(1, this.doorOpen + dt * 1.6);
      if (this.doorOpen >= 1) {
        this.phase = 'ARRIVED';
        arrived = true;
      }
    }

    return { startedMoving, arrived, floorChanged, displayFloor: this.displayFloor };
  }

  isRideActive(): boolean {
    return this.phase === 'CLOSING' || this.phase === 'MOVING' || this.phase === 'OPENING';
  }
}

function formatFloorLabel(floor: number): string {
  if (floor < 0) {
    return `-${String(Math.abs(floor)).padStart(2, '0')}`;
  }
  return String(floor).padStart(2, '0');
}

/**
 * Physical 3D Cyberpunk Elevator Shaft + Moving Cabin with:
 * - Full-height solid vertical shaft colliders (left, right, and back or pass-through wall segments)
 * - Dynamic moving front (+Z) and back (-Z) cabin door colliders synced every frame to currentY
 * - Panoramic tinted side glass looking out onto recessed shaft neon floor rings
 * - Bolt 1 live Canvas digital floor counter (ЭТ.92 -> ЭТ.01 / ЭТ.01 -> ЭТ.-12)
 * - Zero PointLights (bright emissive ceiling diffuser preserves strict global light budget)
 */
export class ElevatorRig {
  readonly state: ElevatorState;
  readonly group = new THREE.Group();

  private readonly width: number;
  private readonly depth: number;
  private readonly cabinHeight: number;
  private readonly accentHex: number;
  private readonly accentCss: string;
  private readonly entrySide: 1 | -1;
  private readonly exitSide: 1 | -1;
  private readonly isPassThrough: boolean;
  private readonly destinationLabel: string;

  private readonly cabinGroup = new THREE.Group();
  private entryLeftDoor!: THREE.Mesh;
  private entryRightDoor!: THREE.Mesh;
  private exitLeftDoor: THREE.Mesh | null = null;
  private exitRightDoor: THREE.Mesh | null = null;

  private readonly physics: PhysicsWorld;
  private readonly frontDoorColliderId: string;
  private readonly backDoorColliderId: string;
  private readonly ceilingColliderId: string;
  private readonly frontDoorCollider: AABB;
  private readonly backDoorCollider: AABB;
  private readonly ceilingCollider: AABB;
  private collidersEnabled = true;

  private readonly displayCanvas: HTMLCanvasElement;
  private readonly displayCtx: CanvasRenderingContext2D | null;
  private readonly displayTex: THREE.CanvasTexture;
  private readonly buttonGlowMat: THREE.MeshStandardMaterial;
  private lastRenderedFloor = Number.NaN;
  private lastRenderedPhase: ElevatorState['phase'] | null = null;

  constructor(
    config: ElevatorConfig,
    parent: THREE.Object3D,
    physics: PhysicsWorld,
    textures: ProceduralTextures,
  ) {
    this.state = new ElevatorState(config);
    this.physics = physics;

    this.width = config.width ?? 4.4;
    this.depth = config.depth ?? 4.4;
    this.cabinHeight = config.cabinHeight ?? 3.6;
    this.accentHex = config.accentHex ?? 0x00f0ff;
    this.accentCss = config.accentCss ?? '#00f0ff';
    this.entrySide = config.doorFacingZ;
    this.exitSide = config.exitDoorFacingZ ?? config.doorFacingZ;
    this.isPassThrough = this.exitSide !== this.entrySide;
    this.destinationLabel =
      config.destinationLabel ??
      `ЭТ.${formatFloorLabel(config.endFloorLabel)} // MARAKULIN EXPRESS`;

    this.displayCanvas = document.createElement('canvas');
    this.displayCanvas.width = 512;
    this.displayCanvas.height = 192;
    this.displayCtx = this.displayCanvas.getContext('2d');
    this.displayTex = new THREE.CanvasTexture(this.displayCanvas);
    this.displayTex.colorSpace = THREE.SRGBColorSpace;

    this.buttonGlowMat = new THREE.MeshStandardMaterial({
      color: 0xfcee0a,
      emissive: 0xfcee0a,
      emissiveIntensity: 1.85,
      roughness: 0.25,
    });

    this.frontDoorColliderId = `${config.id}_door_front`;
    this.backDoorColliderId = `${config.id}_door_back`;
    this.ceilingColliderId = `${config.id}_cabin_ceil`;

    const halfD = this.depth * 0.5;
    // Dynamic moving cabin door colliders on BOTH front (+Z) and back (-Z) of the cabin
    this.frontDoorCollider = this.physics.addBox(
      this.frontDoorColliderId,
      config.centerX,
      config.startY + this.cabinHeight * 0.5,
      config.centerZ + (halfD - 0.16),
      this.width + 0.2,
      this.cabinHeight + 0.4,
      0.42,
      { active: this.entrySide !== 1 },
    );
    this.backDoorCollider = this.physics.addBox(
      this.backDoorColliderId,
      config.centerX,
      config.startY + this.cabinHeight * 0.5,
      config.centerZ - (halfD - 0.16),
      this.width + 0.2,
      this.cabinHeight + 0.4,
      0.42,
      { active: this.entrySide !== -1 },
    );
    this.ceilingCollider = this.physics.addBox(
      this.ceilingColliderId,
      config.centerX,
      config.startY + this.cabinHeight + 0.2,
      config.centerZ,
      this.width + 0.2,
      0.4,
      this.depth + 0.2,
      { active: true },
    );

    this.buildShaft();
    this.buildCabin(textures);

    this.group.add(this.cabinGroup);
    parent.add(this.group);

    this.syncColliders();
    this.syncVisuals();
  }

  private buildShaft(): void {
    const c = this.state.config;
    const minY = Math.min(c.startY, c.endY);
    const maxY = Math.max(c.startY, c.endY);
    const shaftBottom = minY;
    const shaftTop = maxY + 4.4;
    const colliderBottom = minY - 0.5;
    const colliderHeight = shaftTop - colliderBottom;
    const colliderMidY = (colliderBottom + shaftTop) * 0.5;
    const visualHeight = shaftTop - shaftBottom + 0.6;
    const visualMidY = (shaftBottom - 0.6 + shaftTop) * 0.5;

    const halfW = this.width * 0.5;
    const halfD = this.depth * 0.5;

    const frameMat = new THREE.MeshStandardMaterial({
      color: 0x1a2234,
      metalness: 0.45,
      roughness: 0.52,
    });
    const shaftWallMat = new THREE.MeshStandardMaterial({
      color: 0x121828,
      metalness: 0.3,
      roughness: 0.65,
    });
    const neonMat = new THREE.MeshStandardMaterial({
      color: this.accentHex,
      emissive: this.accentHex,
      emissiveIntensity: 1.65,
      roughness: 0.3,
    });
    const altRingHex = this.accentHex === 0x00f0ff ? 0xff003c : 0x00f0ff;
    const altRingMat = new THREE.MeshStandardMaterial({
      color: altRingHex,
      emissive: altRingHex,
      emissiveIntensity: 1.55,
      roughness: 0.3,
    });

    // Full-height Left & Right solid shaft wall colliders active across the ENTIRE shaft height
    this.physics.addBox(
      `${c.id}_shaft_left`,
      c.centerX - (halfW + 0.36),
      colliderMidY,
      c.centerZ,
      0.72,
      colliderHeight,
      this.depth + 0.72,
    );
    this.physics.addBox(
      `${c.id}_shaft_right`,
      c.centerX + (halfW + 0.36),
      colliderMidY,
      c.centerZ,
      0.72,
      colliderHeight,
      this.depth + 0.72,
    );

    // Recessed outer shaft shell + structural guide rails + vertical neon strips (visible through cabin glass!)
    const outerOffset = halfW + 1.65;
    for (const side of [-1, 1]) {
      const outerWall = new THREE.Mesh(
        new THREE.BoxGeometry(0.36, visualHeight, this.depth + 0.4),
        shaftWallMat,
      );
      outerWall.position.set(c.centerX + side * outerOffset, visualMidY, c.centerZ);
      this.group.add(outerWall);

      for (const rz of [-halfD + 0.55, 0, halfD - 0.55]) {
        const rail = new THREE.Mesh(
          new THREE.BoxGeometry(0.24, visualHeight, 0.24),
          frameMat,
        );
        rail.position.set(c.centerX + side * (halfW + 0.62), visualMidY, c.centerZ + rz);
        this.group.add(rail);
      }

      const vNeon = new THREE.Mesh(
        new THREE.BoxGeometry(0.1, visualHeight, 0.14),
        neonMat,
      );
      vNeon.position.set(c.centerX + side * (halfW + 1.32), visualMidY, c.centerZ);
      this.group.add(vNeon);
    }

    // Passing horizontal luminous floor rings spaced every 2.2m vertically along the shaft
    let ringIdx = 0;
    for (let ry = shaftBottom + 1.4; ry < shaftTop - 0.8; ry += 2.2) {
      const ringMat = ringIdx % 2 === 0 ? neonMat : altRingMat;
      ringIdx++;

      for (const side of [-1, 1]) {
        const sideBar = new THREE.Mesh(
          new THREE.BoxGeometry(0.16, 0.14, this.depth - 0.5),
          ringMat,
        );
        sideBar.position.set(c.centerX + side * (halfW + 1.3), ry, c.centerZ);
        this.group.add(sideBar);
      }

      // Cross-shaft neon ribs on faces outside open doorway zones
      const inEntryDoor = ry >= c.startY - 0.2 && ry <= c.startY + this.cabinHeight + 0.3;
      const inExitDoor = ry >= c.endY - 0.2 && ry <= c.endY + this.cabinHeight + 0.3;

      const entryFaceZ = c.centerZ + this.entrySide * (halfD + 0.22);
      const exitFaceZ = c.centerZ + this.exitSide * (halfD + 0.22);

      if (!inEntryDoor && !(this.entrySide === this.exitSide && inExitDoor)) {
        const bar = new THREE.Mesh(
          new THREE.BoxGeometry(this.width + 0.6, 0.14, 0.14),
          ringMat,
        );
        bar.position.set(c.centerX, ry, entryFaceZ);
        this.group.add(bar);
      }
      if (this.isPassThrough && !inExitDoor) {
        const bar = new THREE.Mesh(
          new THREE.BoxGeometry(this.width + 0.6, 0.14, 0.14),
          ringMat,
        );
        bar.position.set(c.centerX, ry, exitFaceZ);
        this.group.add(bar);
      }
    }

    // Helper to place a solid shaft face wall + collider over a vertical [y0, y1] span
    const addShaftFaceSegment = (
      segId: string,
      faceDirZ: 1 | -1,
      y0: number,
      y1: number,
    ) => {
      const h = y1 - y0;
      if (h < 0.25) return;
      const cy = y0 + h * 0.5;
      const cz = c.centerZ + faceDirZ * (halfD + 0.36);

      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(this.width + 1.2, h, 0.56),
        shaftWallMat,
      );
      mesh.position.set(c.centerX, cy, cz);
      this.group.add(mesh);

      this.physics.addBox(segId, c.centerX, cy, cz, this.width + 1.2, h, 0.72);
    };

    if (!this.isPassThrough) {
      // Single-door shaft: solid full-height back shaft wall collider on -entrySide
      addShaftFaceSegment(`${c.id}_shaft_back`, (this.entrySide * -1) as 1 | -1, colliderBottom, shaftTop);

      // On entrySide, fill shaft wall between startY & endY doorways and above/below them
      const lowDoorY = Math.min(c.startY, c.endY);
      const highDoorY = Math.max(c.startY, c.endY);
      addShaftFaceSegment(`${c.id}_shaft_front_mid`, this.entrySide, lowDoorY + this.cabinHeight + 0.05, highDoorY);
      addShaftFaceSegment(`${c.id}_shaft_front_top`, this.entrySide, highDoorY + this.cabinHeight + 0.05, shaftTop);
    } else {
      // Pass-through dual-door shaft:
      // entrySide has a doorway ONLY at [startY, startY + cabinHeight]
      addShaftFaceSegment(`${c.id}_shaft_entry_lower`, this.entrySide, colliderBottom, c.startY);
      addShaftFaceSegment(
        `${c.id}_shaft_entry_upper`,
        this.entrySide,
        c.startY + this.cabinHeight + 0.05,
        shaftTop,
      );

      // exitSide has a doorway ONLY at [endY, endY + cabinHeight]
      addShaftFaceSegment(`${c.id}_shaft_exit_lower`, this.exitSide, colliderBottom, c.endY);
      addShaftFaceSegment(
        `${c.id}_shaft_exit_upper`,
        this.exitSide,
        c.endY + this.cabinHeight + 0.05,
        shaftTop,
      );
    }

    // Shaft pit base & top cap (prevents seeing any void at top or bottom of shaft)
    const pitFloor = new THREE.Mesh(
      new THREE.BoxGeometry(this.width + 3.8, 0.5, this.depth + 1.0),
      frameMat,
    );
    pitFloor.position.set(c.centerX, shaftBottom - 0.45, c.centerZ);
    this.group.add(pitFloor);

    const topCap = new THREE.Mesh(
      new THREE.BoxGeometry(this.width + 3.8, 0.6, this.depth + 1.0),
      frameMat,
    );
    topCap.position.set(c.centerX, shaftTop + 0.3, c.centerZ);
    this.group.add(topCap);
  }

  private buildCabin(textures: ProceduralTextures): void {
    const innerW = this.width - 0.16;
    const innerD = this.depth - 0.24;
    const halfW = innerW * 0.5;
    const halfD = innerD * 0.5;
    const h = this.cabinHeight;

    const floorMat = new THREE.MeshStandardMaterial({
      map: textures.getFloorTile(this.accentCss, 2, 2),
      roughness: 0.32,
      metalness: 0.48,
    });
    const metalMat = new THREE.MeshStandardMaterial({
      color: 0x1e2638,
      roughness: 0.42,
      metalness: 0.62,
    });
    const backWallMat = new THREE.MeshStandardMaterial({
      map: textures.getWallPanel(this.accentCss, 2, 1),
      roughness: 0.38,
      metalness: 0.55,
    });
    const doorMat = new THREE.MeshStandardMaterial({
      color: 0x172033,
      roughness: 0.32,
      metalness: 0.78,
    });
    const railMat = new THREE.MeshStandardMaterial({
      color: 0xaab8d0,
      roughness: 0.26,
      metalness: 0.78,
    });
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x1a3354,
      roughness: 0.12,
      metalness: 0.2,
      transparent: true,
      opacity: 0.24,
    });
    const trimMat = new THREE.MeshStandardMaterial({
      color: this.accentHex,
      emissive: this.accentHex,
      emissiveIntensity: 1.7,
      roughness: 0.3,
    });

    // Solid cabin floor plate
    const floorPlate = new THREE.Mesh(new THREE.BoxGeometry(innerW, 0.26, innerD), floorMat);
    floorPlate.position.set(0, -0.13, 0);
    this.cabinGroup.add(floorPlate);

    // Ceiling plate + bright emissive ceiling diffuser (NO PointLight to preserve global light budget!)
    const ceilPlate = new THREE.Mesh(new THREE.BoxGeometry(innerW, 0.24, innerD), metalMat);
    ceilPlate.position.set(0, h + 0.12, 0);
    this.cabinGroup.add(ceilPlate);

    const ceilDiffuser = new THREE.Mesh(
      new THREE.BoxGeometry(innerW * 0.62, 0.06, innerD * 0.68),
      new THREE.MeshStandardMaterial({
        color: 0xe6f6ff,
        emissive: 0xa8e4ff,
        emissiveIntensity: 1.9,
        roughness: 0.2,
      }),
    );
    ceilDiffuser.position.set(0, h - 0.03, 0);
    this.cabinGroup.add(ceilDiffuser);

    // Side walls: lower kickplate + upper header + panoramic tinted shaft glass + chrome handrails
    for (const side of [-1, 1]) {
      const wx = side * (halfW - 0.08);

      const lowerWall = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.02, innerD), metalMat);
      lowerWall.position.set(wx, 0.51, 0);
      this.cabinGroup.add(lowerWall);

      const upperWall = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.78, innerD), metalMat);
      upperWall.position.set(wx, h - 0.39, 0);
      this.cabinGroup.add(upperWall);

      for (const mz of [-halfD + 0.12, halfD - 0.12]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.2, h, 0.22), metalMat);
        post.position.set(wx, h * 0.5, mz);
        this.cabinGroup.add(post);
      }

      const glassH = h - 1.8;
      const glassPane = new THREE.Mesh(new THREE.BoxGeometry(0.05, glassH, innerD - 0.36), glassMat);
      glassPane.position.set(wx, 1.02 + glassH * 0.5, 0);
      this.cabinGroup.add(glassPane);

      const handrail = new THREE.Mesh(
        new THREE.CylinderGeometry(0.034, 0.034, innerD - 0.9, 8),
        railMat,
      );
      handrail.rotation.x = Math.PI / 2;
      handrail.position.set(wx - side * 0.2, 1.1, 0);
      this.cabinGroup.add(handrail);

      const floorTrim = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.07, innerD - 0.36), trimMat);
      floorTrim.position.set(wx - side * 0.07, 0.06, 0);
      this.cabinGroup.add(floorTrim);

      const ceilTrim = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.07, innerD - 0.36), trimMat);
      ceilTrim.position.set(wx - side * 0.07, h - 0.08, 0);
      this.cabinGroup.add(ceilTrim);
    }

    // Sliding door helper
    const doorW = (innerW - 0.2) * 0.5;
    const doorH = h - 0.42;
    const buildDoorPair = (faceDirZ: 1 | -1): [THREE.Mesh, THREE.Mesh] => {
      const dz = faceDirZ * (halfD - 0.08);

      // Door lintel header
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(innerW, 0.44, 0.22), metalMat);
      lintel.position.set(0, h - 0.22, dz);
      this.cabinGroup.add(lintel);

      const leftDoor = new THREE.Mesh(new THREE.BoxGeometry(doorW, doorH, 0.14), doorMat);
      leftDoor.position.set(-doorW * 0.5, doorH * 0.5, dz);
      const rightDoor = new THREE.Mesh(new THREE.BoxGeometry(doorW, doorH, 0.14), doorMat);
      rightDoor.position.set(doorW * 0.5, doorH * 0.5, dz);

      // Glowing vertical accent seam on each door leaf
      const seamGeo = new THREE.BoxGeometry(0.05, doorH - 0.3, 0.16);
      const seamL = new THREE.Mesh(seamGeo, trimMat);
      seamL.position.set(doorW * 0.46, 0, 0);
      leftDoor.add(seamL);
      const seamR = new THREE.Mesh(seamGeo, trimMat);
      seamR.position.set(-doorW * 0.46, 0, 0);
      rightDoor.add(seamR);

      this.cabinGroup.add(leftDoor, rightDoor);
      return [leftDoor, rightDoor];
    };

    // Entry doors on entrySide
    [this.entryLeftDoor, this.entryRightDoor] = buildDoorPair(this.entrySide);

    if (this.isPassThrough) {
      // Pass-through exit doors on exitSide
      [this.exitLeftDoor, this.exitRightDoor] = buildDoorPair(this.exitSide);
    } else {
      // Solid luxury back wall on -entrySide
      const backZ = -this.entrySide * (halfD - 0.08);
      const backWall = new THREE.Mesh(new THREE.BoxGeometry(innerW, h, 0.18), backWallMat);
      backWall.position.set(0, h * 0.5, backZ);
      this.cabinGroup.add(backWall);

      const backTrim = new THREE.Mesh(new THREE.BoxGeometry(innerW - 0.4, 0.08, 0.08), trimMat);
      backTrim.position.set(0, 1.15, backZ + this.entrySide * 0.1);
      this.cabinGroup.add(backTrim);
    }

    // Glowing Elevator Button Control Console on interior right wall
    const consoleBody = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.96, 0.48), metalMat);
    consoleBody.position.set(halfW - 0.2, 1.44, -this.entrySide * 0.95);
    this.cabinGroup.add(consoleBody);

    const callBtn = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.22, 0.22), this.buttonGlowMat);
    callBtn.position.set(halfW - 0.29, 1.52, -this.entrySide * 0.95);
    this.cabinGroup.add(callBtn);

    // Live Digital Floor Display mounted high on the forward interior wall (-entrySide) facing the rider
    const displayW = this.isPassThrough ? 2.25 : 2.55;
    const displayH = this.isPassThrough ? 0.4 : 0.92;
    const displayY = this.isPassThrough ? h - 0.22 : h - 0.56;
    const displayPanel = new THREE.Mesh(
      new THREE.PlaneGeometry(displayW, displayH),
      new THREE.MeshStandardMaterial({
        map: this.displayTex,
        emissiveMap: this.displayTex,
        emissive: new THREE.Color(0xffffff),
        emissiveIntensity: 0.95,
        roughness: 0.35,
      }),
    );
    const displayZ = -this.entrySide * (halfD - 0.24);
    displayPanel.position.set(0, displayY, displayZ);
    displayPanel.rotation.y = this.entrySide === 1 ? 0 : Math.PI;
    this.cabinGroup.add(displayPanel);
  }

  private redrawDisplay(): void {
    const ctx = this.displayCtx;
    const phase = this.state.phase;
    const floor = this.state.displayFloor;

    if (ctx) {
      const goingUp = this.state.config.endY > this.state.config.startY;
      const floorStr = formatFloorLabel(floor);

      ctx.fillStyle = '#060a14';
      ctx.fillRect(0, 0, 512, 192);

      ctx.strokeStyle = this.accentCss;
      ctx.lineWidth = 6;
      ctx.strokeRect(6, 6, 500, 180);

      // Subtle scanlines
      ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
      for (let sy = 12; sy < 180; sy += 8) {
        ctx.fillRect(10, sy, 492, 2);
      }

      // Status header
      ctx.fillStyle =
        phase === 'MOVING'
          ? '#fcee0a'
          : phase === 'ARRIVED' || phase === 'OPENING'
            ? '#00ff88'
            : this.accentCss;
      ctx.font = '800 21px monospace';
      const statusText =
        phase === 'IDLE_START'
          ? 'ЛИФТ ГОТОВ // НАЖМИТЕ [E]'
          : phase === 'CLOSING'
            ? 'ДВЕРИ ЗАКРЫВАЮТСЯ...'
            : phase === 'MOVING'
              ? goingUp
                ? '▲ ПОДЪЁМ // MARAKULIN EXPRESS'
                : '▼ СПУСК // MARAKULIN EXPRESS'
              : phase === 'OPENING'
                ? 'ДВЕРИ ОТКРЫВАЮТСЯ...'
                : '✓ ПРИБЫТИЕ НА ЭТАЖ';
      ctx.fillText(statusText, 24, 38);

      // Large digital floor readout
      ctx.save();
      ctx.shadowColor = this.accentCss;
      ctx.shadowBlur = 14;
      ctx.fillStyle = '#ffffff';
      ctx.font = '900 80px monospace';
      ctx.fillText(`ЭТ.${floorStr}`, 24, 130);
      ctx.restore();

      // Directional arrow icon during ride
      if (phase === 'CLOSING' || phase === 'MOVING') {
        ctx.fillStyle = '#fcee0a';
        ctx.beginPath();
        if (goingUp) {
          ctx.moveTo(430, 58);
          ctx.lineTo(474, 128);
          ctx.lineTo(386, 128);
        } else {
          ctx.moveTo(430, 130);
          ctx.lineTo(474, 60);
          ctx.lineTo(386, 60);
        }
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.fillStyle = phase === 'ARRIVED' ? '#00ff88' : this.accentCss;
        ctx.font = '900 42px monospace';
        ctx.fillText(phase === 'ARRIVED' ? 'OK' : '[E]', 398, 114);
      }

      // Destination footer
      ctx.fillStyle = '#9be8ff';
      ctx.font = '700 19px monospace';
      ctx.fillText(`ЦЕЛЬ: ${this.destinationLabel}`, 24, 168);

      this.displayTex.needsUpdate = true;
    }

    const btnHex =
      phase === 'IDLE_START'
        ? 0xfcee0a
        : phase === 'ARRIVED' || phase === 'OPENING'
          ? 0x00ff88
          : this.accentHex;
    this.buttonGlowMat.color.setHex(btnHex);
    this.buttonGlowMat.emissive.setHex(btnHex);

    this.lastRenderedFloor = floor;
    this.lastRenderedPhase = phase;
  }

  private syncColliders(): void {
    const y = this.state.currentY;
    const minY = y - 0.2;
    const maxY = y + this.cabinHeight + 0.2;

    // Update dynamic cabin door & ceiling AABBs directly every frame to track cabin Y
    this.frontDoorCollider.minY = minY;
    this.frontDoorCollider.maxY = maxY;
    this.backDoorCollider.minY = minY;
    this.backDoorCollider.maxY = maxY;
    this.ceilingCollider.minY = y + this.cabinHeight;
    this.ceilingCollider.maxY = y + this.cabinHeight + 0.4;

    if (!this.collidersEnabled) {
      this.frontDoorCollider.active = false;
      this.backDoorCollider.active = false;
      this.ceilingCollider.active = false;
      this.physics.setActive(this.frontDoorColliderId, false);
      this.physics.setActive(this.backDoorColliderId, false);
      this.physics.setActive(this.ceilingColliderId, false);
      return;
    }

    const phase = this.state.phase;
    let frontActive = true;
    let backActive = true;

    if (this.state.isRideActive()) {
      // Lock BOTH front (+Z) and back (-Z) cabin doors during CLOSING / MOVING / OPENING
      frontActive = true;
      backActive = true;
    } else if (phase === 'IDLE_START') {
      // Entry side OPEN, opposite side CLOSED
      frontActive = this.entrySide !== 1;
      backActive = this.entrySide !== -1;
    } else if (phase === 'ARRIVED') {
      // Exit side OPEN, opposite side CLOSED
      frontActive = this.exitSide !== 1;
      backActive = this.exitSide !== -1;
    }

    this.frontDoorCollider.active = frontActive;
    this.backDoorCollider.active = backActive;
    this.ceilingCollider.active = true;
    this.physics.setActive(this.frontDoorColliderId, frontActive);
    this.physics.setActive(this.backDoorColliderId, backActive);
    this.physics.setActive(this.ceilingColliderId, true);
  }

  setCollidersActive(active: boolean): void {
    this.collidersEnabled = active;
    this.physics.setCollidersActiveByPrefix(`${this.state.config.id}_`, active);
    this.syncColliders();
  }

  isPlayerInside(px: number, pz: number): boolean {
    const c = this.state.config;
    return (
      Math.abs(px - c.centerX) < this.width * 0.5 - 0.2 &&
      Math.abs(pz - c.centerZ) < this.depth * 0.5 - 0.25
    );
  }

  reset(): void {
    this.state.reset();
    this.syncColliders();
    this.syncVisuals();
  }

  snapToArrived(): void {
    this.state.snapToArrived();
    this.syncColliders();
    this.syncVisuals();
  }

  update(dt: number): ElevatorStepResult {
    const res = this.state.step(dt);
    this.syncColliders();
    this.syncVisuals();
    return res;
  }

  dispose(): void {
    this.displayTex.dispose();
  }

  private syncVisuals(): void {
    const c = this.state.config;
    const phase = this.state.phase;
    this.cabinGroup.position.set(c.centerX, this.state.currentY, c.centerZ);

    const doorHalfW = (this.width - 0.36) * 0.25;
    const maxSlide = this.width * 0.39;

    // Determine entry vs exit door opening fractions
    let entryOpen = 0;
    let exitOpen = 0;

    if (!this.isPassThrough) {
      entryOpen = this.state.doorOpen;
    } else {
      if (phase === 'IDLE_START' || phase === 'CLOSING') {
        entryOpen = this.state.doorOpen;
        exitOpen = 0;
      } else if (phase === 'MOVING') {
        entryOpen = 0;
        exitOpen = 0;
      } else {
        // OPENING or ARRIVED
        entryOpen = 0;
        exitOpen = this.state.doorOpen;
      }
    }

    const entrySlide = entryOpen * maxSlide;
    this.entryLeftDoor.position.x = -doorHalfW - entrySlide;
    this.entryRightDoor.position.x = doorHalfW + entrySlide;

    if (this.exitLeftDoor && this.exitRightDoor) {
      const exitSlide = exitOpen * maxSlide;
      this.exitLeftDoor.position.x = -doorHalfW - exitSlide;
      this.exitRightDoor.position.x = doorHalfW + exitSlide;
    }

    if (
      this.state.displayFloor !== this.lastRenderedFloor ||
      phase !== this.lastRenderedPhase
    ) {
      this.redrawDisplay();
    }
  }
}

import * as THREE from 'three';
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
  doorFacingZ: 1 | -1; // which side the cabin entrance opens on
}

export interface ElevatorStepResult {
  startedMoving: boolean;
  arrived: boolean;
  floorChanged: boolean;
  displayFloor: number;
}

/**
 * Pure elevator state machine borrowed and adapted from Bolt 1.
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

export class ElevatorRig {
  readonly state: ElevatorState;
  readonly group = new THREE.Group();
  private cabinGroup = new THREE.Group();
  private leftDoor!: THREE.Mesh;
  private rightDoor!: THREE.Mesh;
  private physics: PhysicsWorld;
  private doorColliderId: string;

  constructor(
    config: ElevatorConfig,
    parent: THREE.Object3D,
    physics: PhysicsWorld,
    textures: ProceduralTextures,
  ) {
    this.state = new ElevatorState(config);
    this.physics = physics;
    this.doorColliderId = `${config.id}_door_lock`;

    this.buildCabin(textures);
    this.group.add(this.cabinGroup);
    parent.add(this.group);

    // Door collider blocks exit while moving
    const dz = config.doorFacingZ * 2.1;
    this.physics.addBox(
      this.doorColliderId,
      config.centerX,
      config.startY + 1.8,
      config.centerZ + dz,
      4.2,
      3.6,
      0.4,
      { active: false },
    );

    this.syncVisuals();
  }

  private buildCabin(textures: ProceduralTextures): void {
    const wallMat = new THREE.MeshStandardMaterial({
      map: textures.getWallPanel('#00f0ff', 1, 1),
      roughness: 0.45,
      metalness: 0.55,
    });
    const floorMat = new THREE.MeshStandardMaterial({
      map: textures.getFloorTile('#fcee0a', 2, 2),
      roughness: 0.35,
      metalness: 0.4,
    });
    const doorMat = new THREE.MeshStandardMaterial({
      color: 0x1a2438,
      roughness: 0.35,
      metalness: 0.75,
    });
    const neonMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff });

    const floor = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.25, 4.4), floorMat);
    floor.position.y = -0.125;
    this.cabinGroup.add(floor);

    const ceil = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.25, 4.4), wallMat);
    ceil.position.y = 3.6;
    this.cabinGroup.add(ceil);

    // Side & back walls
    const backZ = -this.state.config.doorFacingZ * 2.15;
    const backWall = new THREE.Mesh(new THREE.BoxGeometry(4.4, 3.6, 0.22), wallMat);
    backWall.position.set(0, 1.8, backZ);
    this.cabinGroup.add(backWall);

    for (const sx of [-2.15, 2.15]) {
      const side = new THREE.Mesh(new THREE.BoxGeometry(0.22, 3.6, 4.4), wallMat);
      side.position.set(sx, 1.8, 0);
      this.cabinGroup.add(side);
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 3.1, 0.12), neonMat);
      strip.position.set(sx * 0.94, 1.8, 0);
      this.cabinGroup.add(strip);
    }

    // Sliding doors
    const frontZ = this.state.config.doorFacingZ * 2.1;
    this.leftDoor = new THREE.Mesh(new THREE.BoxGeometry(2.1, 3.4, 0.18), doorMat);
    this.leftDoor.position.set(-1.05, 1.7, frontZ);
    this.cabinGroup.add(this.leftDoor);

    this.rightDoor = new THREE.Mesh(new THREE.BoxGeometry(2.1, 3.4, 0.18), doorMat);
    this.rightDoor.position.set(1.05, 1.7, frontZ);
    this.cabinGroup.add(this.rightDoor);

    const cabinLight = new THREE.PointLight(0x88e8ff, 3.2, 9);
    cabinLight.position.set(0, 3.1, 0);
    this.cabinGroup.add(cabinLight);
  }

  isPlayerInside(px: number, pz: number): boolean {
    const c = this.state.config;
    return Math.abs(px - c.centerX) < 1.95 && Math.abs(pz - c.centerZ) < 1.95;
  }

  reset(): void {
    this.state.reset();
    this.physics.setActive(this.doorColliderId, false);
    this.syncVisuals();
  }

  update(dt: number): ElevatorStepResult {
    const res = this.state.step(dt);
    this.physics.setActive(this.doorColliderId, this.state.isRideActive());
    this.syncVisuals();
    return res;
  }

  private syncVisuals(): void {
    const c = this.state.config;
    this.cabinGroup.position.set(c.centerX, this.state.currentY, c.centerZ);
    const slide = this.state.doorOpen * 1.65;
    this.leftDoor.position.x = -1.05 - slide;
    this.rightDoor.position.x = 1.05 + slide;
  }
}

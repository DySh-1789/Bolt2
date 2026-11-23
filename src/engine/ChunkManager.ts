import * as THREE from 'three';
import { CHUNK_SIZE, WORLD_HALF, WORLD_SIZE } from '../types/game';
import type { PhysicsWorld } from './Physics';

export interface ChunkCoord {
  cx: number;
  cz: number;
  key: string;
}

export interface ChunkStats {
  currentKey: string;
  currentCx: number;
  currentCz: number;
  visibleChunks: number;
  physicsChunks: number;
  totalChunks: number;
}

/**
 * Pure spatial chunk grid math (500x500m divided into 10x10 = 100 chunks of 50x50m).
 * Independent of Three.js so it can be thoroughly unit tested.
 */
export class ChunkGrid {
  readonly worldSize: number;
  readonly worldHalf: number;
  readonly chunkSize: number;
  readonly gridCount: number;

  constructor(worldSize = WORLD_SIZE, chunkSize = CHUNK_SIZE) {
    this.worldSize = worldSize;
    this.worldHalf = worldSize / 2;
    this.chunkSize = chunkSize;
    this.gridCount = Math.ceil(worldSize / chunkSize);
  }

  static makeKey(cx: number, cz: number): string {
    return `${cx},${cz}`;
  }

  worldToChunk(x: number, z: number): ChunkCoord {
    const rawCx = Math.floor((x + this.worldHalf) / this.chunkSize);
    const rawCz = Math.floor((z + this.worldHalf) / this.chunkSize);
    const cx = Math.max(0, Math.min(this.gridCount - 1, rawCx));
    const cz = Math.max(0, Math.min(this.gridCount - 1, rawCz));
    return { cx, cz, key: ChunkGrid.makeKey(cx, cz) };
  }

  chunkCenter(cx: number, cz: number): { x: number; z: number } {
    return {
      x: -this.worldHalf + (cx + 0.5) * this.chunkSize,
      z: -this.worldHalf + (cz + 0.5) * this.chunkSize,
    };
  }

  getActiveKeys(worldX: number, worldZ: number, radiusChunks: number): Set<string> {
    const center = this.worldToChunk(worldX, worldZ);
    const active = new Set<string>();
    const r = Math.max(0, Math.floor(radiusChunks));

    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const cx = center.cx + dx;
        const cz = center.cz + dz;
        if (cx >= 0 && cx < this.gridCount && cz >= 0 && cz < this.gridCount) {
          active.add(ChunkGrid.makeKey(cx, cz));
        }
      }
    }
    return active;
  }

  getTotalChunks(): number {
    return this.gridCount * this.gridCount;
  }
}

interface ChunkCell {
  cx: number;
  cz: number;
  key: string;
  group: THREE.Group;
  lights: THREE.Light[];
}

/**
 * Streams 50x50m Cyber-Almaty city chunks around the player (render radius + tighter physics radius),
 * while keeping distant iconic landmarks (Marakulin Tower spire, Zailiyskiy Alatau mountains, Kok-Tobe)
 * always rendered on the skyline.
 */
export class ChunkManager {
  readonly grid = new ChunkGrid(WORLD_SIZE, CHUNK_SIZE);
  readonly rootGroup = new THREE.Group();
  readonly landmarkGroup = new THREE.Group();

  private chunks = new Map<string, ChunkCell>();
  private lastCenterKey = '';
  private lastOpenWorldFlag = false;
  private visibleChunkCount = 0;
  private physicsChunkCount = 0;
  private renderRadiusChunks = 3; // 7x7 chunks = 350x350m rendered smoothly
  private physicsRadiusChunks = 2; // 5x5 chunks = 250x250m active colliders
  private lightRadiusChunks = 1; // 3x3 chunks = 150x150m active dynamic point lights for high FPS

  constructor(scene: THREE.Scene) {
    this.rootGroup.name = 'cyber_almaty_chunks';
    this.landmarkGroup.name = 'cyber_almaty_landmarks';
    scene.add(this.rootGroup);
    scene.add(this.landmarkGroup);

    // Pre-create 10x10 chunk groups
    for (let cz = 0; cz < this.grid.gridCount; cz++) {
      for (let cx = 0; cx < this.grid.gridCount; cx++) {
        const key = ChunkGrid.makeKey(cx, cz);
        const group = new THREE.Group();
        group.name = `chunk_${key}`;
        group.visible = false;
        this.rootGroup.add(group);
        this.chunks.set(key, { cx, cz, key, group, lights: [] });
      }
    }
  }

  getChunkKey(x: number, z: number): string {
    return this.grid.worldToChunk(x, z).key;
  }

  addToChunk(x: number, z: number, object: THREE.Object3D): string {
    const coord = this.grid.worldToChunk(x, z);
    const cell = this.chunks.get(coord.key);
    if (cell) {
      cell.group.add(object);
      if (object instanceof THREE.Light) {
        cell.lights.push(object);
      }
    } else {
      this.landmarkGroup.add(object);
    }
    return coord.key;
  }

  addLandmark(object: THREE.Object3D): void {
    this.landmarkGroup.add(object);
  }

  addChunkCollider(
    physics: PhysicsWorld,
    id: string,
    cx: number,
    cy: number,
    cz: number,
    sx: number,
    sy: number,
    sz: number,
    options?: {
      active?: boolean;
      blocksSight?: boolean;
      blocksBullets?: boolean;
      isFloor?: boolean;
    },
  ): void {
    // Register collider in its primary chunk (and if large, mark as global so big walls never pop out)
    const isLarge = sx > CHUNK_SIZE * 0.8 || sz > CHUNK_SIZE * 0.8;
    const chunkKey = isLarge ? undefined : this.getChunkKey(cx, cz);
    physics.addBox(id, cx, cy, cz, sx, sy, sz, {
      ...options,
      chunkKey,
    });
  }

  update(playerX: number, playerZ: number, inOpenWorld: boolean, physics: PhysicsWorld): void {
    const clampedX = Math.max(-WORLD_HALF, Math.min(WORLD_HALF, playerX));
    const clampedZ = Math.max(-WORLD_HALF, Math.min(WORLD_HALF, playerZ));
    const coord = this.grid.worldToChunk(clampedX, clampedZ);

    if (coord.key === this.lastCenterKey && inOpenWorld === this.lastOpenWorldFlag) {
      return;
    }

    this.lastCenterKey = coord.key;
    this.lastOpenWorldFlag = inOpenWorld;

    if (!inOpenWorld) {
      // Hide city chunks while inside isolated high-altitude / underground story instances
      this.rootGroup.visible = false;
      this.landmarkGroup.visible = false;
      physics.setActiveChunks(new Set());
      this.visibleChunkCount = 0;
      this.physicsChunkCount = 0;
      return;
    }

    this.rootGroup.visible = true;
    this.landmarkGroup.visible = true;

    const renderKeys = this.grid.getActiveKeys(clampedX, clampedZ, this.renderRadiusChunks);
    const physicsKeys = this.grid.getActiveKeys(clampedX, clampedZ, this.physicsRadiusChunks);
    const lightKeys = this.grid.getActiveKeys(clampedX, clampedZ, this.lightRadiusChunks);

    for (const [key, cell] of this.chunks.entries()) {
      const visible = renderKeys.has(key);
      cell.group.visible = visible;
      const lightsOn = lightKeys.has(key);
      for (const light of cell.lights) {
        light.visible = lightsOn;
      }
    }

    physics.setActiveChunks(physicsKeys);
    this.visibleChunkCount = renderKeys.size;
    this.physicsChunkCount = physicsKeys.size;
  }

  forceRefresh(playerX: number, playerZ: number, inOpenWorld: boolean, physics: PhysicsWorld): void {
    this.lastCenterKey = '';
    this.update(playerX, playerZ, inOpenWorld, physics);
  }

  getStats(): ChunkStats {
    const parts = this.lastCenterKey ? this.lastCenterKey.split(',').map(Number) : [5, 5];
    return {
      currentKey: this.lastCenterKey || '5,5',
      currentCx: parts[0] ?? 5,
      currentCz: parts[1] ?? 5,
      visibleChunks: this.visibleChunkCount,
      physicsChunks: this.physicsChunkCount,
      totalChunks: this.grid.getTotalChunks(),
    };
  }
}

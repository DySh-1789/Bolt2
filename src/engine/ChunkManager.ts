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

export interface LightAnchor {
  x: number;
  y: number;
  z: number;
  colorHex: number;
  intensity: number;
  distance: number;
}

interface ChunkCell {
  cx: number;
  cz: number;
  key: string;
  group: THREE.Group;
}

interface LandmarkLightEntry {
  light: THREE.Light;
  baseIntensity: number;
}

/**
 * Streams 50x50m Cyber-Almaty city chunks around the player (render radius + tighter physics radius),
 * while keeping distant iconic landmarks (Marakulin Tower spire, Zailiyskiy Alatau mountains, Kok-Tobe)
 * always rendered on the skyline.
 *
 * Uses a fixed pool of 3 always-visible PointLights on landmarkGroup (intensity modulated, NEVER
 * toggling `.visible`) so Three.js NUM_POINT_LIGHTS never changes and WebGL shaders never recompile.
 */
export class ChunkManager {
  private static readonly POOLED_LIGHT_COUNT = 3;

  readonly grid = new ChunkGrid(WORLD_SIZE, CHUNK_SIZE);
  readonly rootGroup = new THREE.Group();
  readonly landmarkGroup = new THREE.Group();

  private landmarkMeshGroup = new THREE.Group();
  private landmarkLights: LandmarkLightEntry[] = [];
  private lightPool: THREE.PointLight[] = [];
  private lightAnchors: LightAnchor[] = [];
  private chunks = new Map<string, ChunkCell>();
  private lastCenterKey = '';
  private lastOpenWorldFlag = false;
  private visibleChunkCount = 0;
  private physicsChunkCount = 0;
  private renderRadiusChunks = 3; // 7x7 chunks = 350x350m rendered smoothly
  private physicsRadiusChunks = 2; // 5x5 chunks = 250x250m active colliders

  constructor(scene: THREE.Scene) {
    this.rootGroup.name = 'cyber_almaty_chunks';
    this.landmarkGroup.name = 'cyber_almaty_landmarks';
    this.landmarkMeshGroup.name = 'cyber_almaty_landmark_meshes';
    this.landmarkGroup.add(this.landmarkMeshGroup);
    scene.add(this.rootGroup);
    scene.add(this.landmarkGroup);

    // Fixed pool of 3 always-visible PointLights attached to landmarkGroup.
    // We keep landmarkGroup.visible = true and modulate .intensity (never .visible)
    // so WebGL never triggers synchronous GLSL shader recompilation.
    for (let i = 0; i < ChunkManager.POOLED_LIGHT_COUNT; i++) {
      const light = new THREE.PointLight(0x00e5ff, 0, 24, 1.5);
      light.name = `chunk_pooled_light_${i}`;
      light.visible = true;
      light.position.set(0, -1000, 0);
      this.landmarkGroup.add(light);
      this.lightPool.push(light);
    }

    // Pre-create 10x10 chunk groups
    for (let cz = 0; cz < this.grid.gridCount; cz++) {
      for (let cx = 0; cx < this.grid.gridCount; cx++) {
        const key = ChunkGrid.makeKey(cx, cz);
        const group = new THREE.Group();
        group.name = `chunk_${key}`;
        group.visible = false;
        this.rootGroup.add(group);
        this.chunks.set(key, { cx, cz, key, group });
      }
    }
  }

  getChunkKey(x: number, z: number): string {
    return this.grid.worldToChunk(x, z).key;
  }

  /**
   * Registers a lightweight city streetlamp or interior light anchor.
   * The 3 closest anchors to the player dynamically drive the fixed 3-light pool.
   */
  registerLightAnchor(
    x: number,
    y: number,
    z: number,
    colorHex: number,
    intensity: number,
    distance: number,
  ): void {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
    this.lightAnchors.push({
      x,
      y,
      z,
      colorHex,
      intensity: Number.isFinite(intensity) ? intensity : 0,
      distance: Number.isFinite(distance) && distance > 0 ? distance : 24,
    });
  }

  addToChunk(x: number, z: number, object: THREE.Object3D): string {
    const coord = this.grid.worldToChunk(x, z);

    // Never attach extra THREE.Light instances to chunk groups; auto-convert to pooled anchors.
    if (object instanceof THREE.Light) {
      const hasWorldPos = object.position.lengthSq() > 1e-6;
      const lx = hasWorldPos ? object.position.x : x;
      const ly = hasWorldPos ? object.position.y : 4;
      const lz = hasWorldPos ? object.position.z : z;
      const distance =
        object instanceof THREE.PointLight || object instanceof THREE.SpotLight
          ? object.distance || 24
          : 24;
      this.registerLightAnchor(lx, ly, lz, object.color.getHex(), object.intensity, distance);
      return coord.key;
    }

    const cell = this.chunks.get(coord.key);
    if (cell) {
      cell.group.add(object);
    } else {
      this.landmarkMeshGroup.add(object);
    }
    return coord.key;
  }

  addLandmark(object: THREE.Object3D): void {
    if (object instanceof THREE.PointLight || object instanceof THREE.SpotLight) {
      this.registerLightAnchor(
        object.position.x,
        object.position.y,
        object.position.z,
        object.color.getHex(),
        object.intensity,
        object.distance || 24,
      );
      return;
    }

    // Keep HemisphereLight / DirectionalLight always visible on landmarkGroup and modulate intensity
    // so entering/leaving isolated story instances never triggers shader recompiles.
    if (object instanceof THREE.Light) {
      object.visible = true;
      this.landmarkGroup.add(object);
      this.landmarkLights.push({ light: object, baseIntensity: object.intensity });
      return;
    }

    this.landmarkMeshGroup.add(object);
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

  private updatePooledLights(playerX: number, playerZ: number, inOpenWorld: boolean): void {
    if (!inOpenWorld || this.lightAnchors.length === 0) {
      for (let i = 0; i < this.lightPool.length; i++) {
        this.lightPool[i].intensity = 0;
      }
      return;
    }

    // Zero-allocation top-3 nearest anchor scan
    let idx0 = -1;
    let idx1 = -1;
    let idx2 = -1;
    let d0 = Number.POSITIVE_INFINITY;
    let d1 = Number.POSITIVE_INFINITY;
    let d2 = Number.POSITIVE_INFINITY;

    const anchors = this.lightAnchors;
    for (let i = 0; i < anchors.length; i++) {
      const a = anchors[i];
      const dx = a.x - playerX;
      const dz = a.z - playerZ;
      const distSq = dx * dx + dz * dz;

      if (distSq < d0) {
        d2 = d1;
        idx2 = idx1;
        d1 = d0;
        idx1 = idx0;
        d0 = distSq;
        idx0 = i;
      } else if (distSq < d1) {
        d2 = d1;
        idx2 = idx1;
        d1 = distSq;
        idx1 = i;
      } else if (distSq < d2) {
        d2 = distSq;
        idx2 = i;
      }
    }

    const chosen0 = idx0 >= 0 ? anchors[idx0] : null;
    const chosen1 = idx1 >= 0 ? anchors[idx1] : null;
    const chosen2 = idx2 >= 0 ? anchors[idx2] : null;

    this.applyAnchorToPoolLight(this.lightPool[0], chosen0);
    this.applyAnchorToPoolLight(this.lightPool[1], chosen1);
    this.applyAnchorToPoolLight(this.lightPool[2], chosen2);
  }

  private applyAnchorToPoolLight(light: THREE.PointLight, anchor: LightAnchor | null): void {
    if (!anchor) {
      light.intensity = 0;
      return;
    }
    light.position.set(anchor.x, anchor.y, anchor.z);
    light.color.setHex(anchor.colorHex);
    light.intensity = anchor.intensity;
    light.distance = anchor.distance;
  }

  update(playerX: number, playerZ: number, inOpenWorld: boolean, physics: PhysicsWorld): void {
    const safeX = Number.isFinite(playerX) ? playerX : 0;
    const safeZ = Number.isFinite(playerZ) ? playerZ : 0;
    const clampedX = Math.max(-WORLD_HALF, Math.min(WORLD_HALF, safeX));
    const clampedZ = Math.max(-WORLD_HALF, Math.min(WORLD_HALF, safeZ));

    // Smoothly track the 3 closest city light anchors without ever toggling .visible
    this.updatePooledLights(clampedX, clampedZ, inOpenWorld);

    const coord = this.grid.worldToChunk(clampedX, clampedZ);
    if (coord.key === this.lastCenterKey && inOpenWorld === this.lastOpenWorldFlag) {
      return;
    }

    this.lastCenterKey = coord.key;
    this.lastOpenWorldFlag = inOpenWorld;

    if (!inOpenWorld) {
      // Hide city geometry while inside isolated high-altitude / underground story instances,
      // keeping landmarkGroup.visible = true so pooled & ambient lights never trigger shader recompiles.
      this.rootGroup.visible = false;
      this.landmarkMeshGroup.visible = false;
      for (const entry of this.landmarkLights) {
        entry.light.intensity = 0;
      }
      physics.setActiveChunks(new Set());
      this.visibleChunkCount = 0;
      this.physicsChunkCount = 0;
      return;
    }

    this.rootGroup.visible = true;
    this.landmarkMeshGroup.visible = true;
    for (const entry of this.landmarkLights) {
      entry.light.intensity = entry.baseIntensity;
    }

    const renderKeys = this.grid.getActiveKeys(clampedX, clampedZ, this.renderRadiusChunks);
    const physicsKeys = this.grid.getActiveKeys(clampedX, clampedZ, this.physicsRadiusChunks);

    for (const [key, cell] of this.chunks.entries()) {
      cell.group.visible = renderKeys.has(key);
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

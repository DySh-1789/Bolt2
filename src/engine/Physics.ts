import type { AABB, Vec3 } from '../types/game';

export interface RayHit {
  hit: boolean;
  distance: number;
  point: Vec3;
  colliderId: string | null;
}

/**
 * Axis-aligned collision & raycast world evolved from Bolt 1,
 * extended with chunk-level activation and vehicle collision support for 500x500m Cyber-Almaty.
 */
export class PhysicsWorld {
  private colliders: AABB[] = [];
  private byId = new Map<string, AABB>();
  private byChunk = new Map<string, AABB[]>();
  private activeChunks = new Set<string>();
  private chunkFilteringEnabled = false;

  addCollider(box: AABB): AABB {
    const existing = this.byId.get(box.id);
    if (existing) {
      Object.assign(existing, box);
      return existing;
    }
    this.colliders.push(box);
    this.byId.set(box.id, box);
    if (box.chunkKey) {
      let arr = this.byChunk.get(box.chunkKey);
      if (!arr) {
        arr = [];
        this.byChunk.set(box.chunkKey, arr);
      }
      arr.push(box);
    }
    return box;
  }

  addBox(
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
      chunkKey?: string;
    },
  ): AABB {
    return this.addCollider({
      id,
      minX: cx - sx * 0.5,
      maxX: cx + sx * 0.5,
      minY: cy - sy * 0.5,
      maxY: cy + sy * 0.5,
      minZ: cz - sz * 0.5,
      maxZ: cz + sz * 0.5,
      active: options?.active ?? true,
      blocksSight: options?.blocksSight ?? true,
      blocksBullets: options?.blocksBullets ?? true,
      isFloor: options?.isFloor ?? false,
      chunkKey: options?.chunkKey,
    });
  }

  setActive(id: string, active: boolean): void {
    const box = this.byId.get(id);
    if (box) {
      box.active = active;
    }
  }

  setChunkFiltering(enabled: boolean): void {
    this.chunkFilteringEnabled = enabled;
  }

  setActiveChunks(chunkKeys: Set<string>): void {
    this.activeChunks = chunkKeys;
    this.chunkFilteringEnabled = true;
  }

  getCollider(id: string): AABB | undefined {
    return this.byId.get(id);
  }

  getAllColliders(): readonly AABB[] {
    return this.colliders;
  }

  getChunkColliderCount(chunkKey: string): number {
    return this.byChunk.get(chunkKey)?.length ?? 0;
  }

  clear(): void {
    this.colliders = [];
    this.byId.clear();
    this.byChunk.clear();
    this.activeChunks.clear();
    this.chunkFilteringEnabled = false;
  }

  private isBoxEnabled(box: AABB): boolean {
    if (!box.active) return false;
    if (this.chunkFilteringEnabled && box.chunkKey && !this.activeChunks.has(box.chunkKey)) {
      return false;
    }
    return true;
  }

  /**
   * Returns the highest walkable support surface (floor or top of low cover/crate/platform)
   * beneath a cylinder at (x, z) without snapping up walls taller than the player's feet.
   */
  getSupportY(x: number, z: number, radius: number, feetY: number, baseGroundY: number): number {
    let supportY = baseGroundY;
    const stepAllowance = 0.25; // allows smooth climbing over curbs & steps
    for (const box of this.colliders) {
      if (!this.isBoxEnabled(box)) continue;
      if (box.maxY <= supportY) continue;
      if (box.maxY > feetY + stepAllowance) continue;
      if (box.maxY < baseGroundY - 2) continue;
      if (this.circleIntersectsAABB(x, z, radius * 0.92, box)) {
        supportY = box.maxY;
      }
    }
    return supportY;
  }

  /**
   * Resolves horizontal player movement against active AABBs using substepped X/Z sliding.
   */
  resolveCylinderMove(
    current: Vec3,
    targetX: number,
    targetZ: number,
    radius: number,
    feetY: number,
    height: number,
  ): { x: number; z: number; collided: boolean } {
    const totalDx = targetX - current.x;
    const totalDz = targetZ - current.z;
    const totalDist = Math.hypot(totalDx, totalDz);
    const maxStep = Math.max(0.25, radius * 0.55);
    const steps = Math.max(1, Math.ceil(totalDist / maxStep));

    let curX = current.x;
    let curZ = current.z;
    let anyCollided = false;

    for (let s = 1; s <= steps; s++) {
      const nextTargetX = curX + totalDx / steps;
      const nextTargetZ = curZ + totalDz / steps;
      const stepRes = this.resolveCylinderSubstep(curX, curZ, nextTargetX, nextTargetZ, radius, feetY, height);
      curX = stepRes.x;
      curZ = stepRes.z;
      if (stepRes.collided) anyCollided = true;
    }

    return { x: curX, z: curZ, collided: anyCollided };
  }

  /**
   * Resolves horizontal vehicle movement using an elevated collision hull (ignores low curbs <= 0.35m).
   */
  resolveVehicleMove(
    current: Vec3,
    targetX: number,
    targetZ: number,
    radius: number,
    groundY: number,
  ): { x: number; z: number; collided: boolean } {
    return this.resolveCylinderMove(current, targetX, targetZ, radius, groundY + 0.35, 1.5);
  }

  private resolveCylinderSubstep(
    startX: number,
    startZ: number,
    targetX: number,
    targetZ: number,
    radius: number,
    feetY: number,
    height: number,
  ): { x: number; z: number; collided: boolean } {
    let x = targetX;
    let z = startZ;
    let collided = false;
    const topY = feetY + height;
    const stepUpHeight = 0.22;

    if (x !== startX) {
      for (const box of this.colliders) {
        if (!this.isBoxEnabled(box) || box.isFloor) continue;
        if (topY <= box.minY + 0.05 || feetY >= box.maxY - stepUpHeight) continue;

        if (this.circleIntersectsAABB(x, z, radius, box)) {
          collided = true;
          if (x > startX) {
            x = Math.min(x, box.minX - radius - 0.001);
          } else {
            x = Math.max(x, box.maxX + radius + 0.001);
          }
        }
      }
    }

    z = targetZ;
    if (z !== startZ) {
      for (const box of this.colliders) {
        if (!this.isBoxEnabled(box) || box.isFloor) continue;
        if (topY <= box.minY + 0.05 || feetY >= box.maxY - stepUpHeight) continue;

        if (this.circleIntersectsAABB(x, z, radius, box)) {
          collided = true;
          if (z > startZ) {
            z = Math.min(z, box.minZ - radius - 0.001);
          } else {
            z = Math.max(z, box.maxZ + radius + 0.001);
          }
        }
      }
    }

    for (let iter = 0; iter < 3; iter++) {
      for (const box of this.colliders) {
        if (!this.isBoxEnabled(box) || box.isFloor) continue;
        if (topY <= box.minY + 0.05 || feetY >= box.maxY - stepUpHeight) continue;

        const closestX = Math.max(box.minX, Math.min(x, box.maxX));
        const closestZ = Math.max(box.minZ, Math.min(z, box.maxZ));
        const dx = x - closestX;
        const dz = z - closestZ;
        const distSq = dx * dx + dz * dz;

        if (distSq < radius * radius) {
          collided = true;
          if (distSq > 1e-8) {
            const dist = Math.sqrt(distSq);
            const overlap = radius - dist + 0.001;
            x += (dx / dist) * overlap;
            z += (dz / dist) * overlap;
          } else {
            const penLeft = Math.abs(x - box.minX);
            const penRight = Math.abs(box.maxX - x);
            const penNear = Math.abs(z - box.minZ);
            const penFar = Math.abs(box.maxZ - z);
            const minPen = Math.min(penLeft, penRight, penNear, penFar);
            if (minPen === penLeft) x = box.minX - radius - 0.001;
            else if (minPen === penRight) x = box.maxX + radius + 0.001;
            else if (minPen === penNear) z = box.minZ - radius - 0.001;
            else z = box.maxZ + radius + 0.001;
          }
        }
      }
    }

    return { x, z, collided };
  }

  circleIntersectsAABB(cx: number, cz: number, radius: number, box: AABB): boolean {
    const closestX = Math.max(box.minX, Math.min(cx, box.maxX));
    const closestZ = Math.max(box.minZ, Math.min(cz, box.maxZ));
    const dx = cx - closestX;
    const dz = cz - closestZ;
    return dx * dx + dz * dz < radius * radius;
  }

  raycast(origin: Vec3, dir: Vec3, maxDistance: number, sightOnly = false, bulletsOnly = false): RayHit {
    const clampedMax = Math.max(0, maxDistance);
    let closestT = clampedMax;
    let hitId: string | null = null;

    for (const box of this.colliders) {
      if (!this.isBoxEnabled(box)) continue;
      if (sightOnly && box.blocksSight === false) continue;
      if (bulletsOnly && box.blocksBullets === false) continue;

      let tmin = -Number.POSITIVE_INFINITY;
      let tmax = Number.POSITIVE_INFINITY;

      if (Math.abs(dir.x) <= 1e-8) {
        if (origin.x < box.minX || origin.x > box.maxX) continue;
      } else {
        const invX = 1 / dir.x;
        let t1 = (box.minX - origin.x) * invX;
        let t2 = (box.maxX - origin.x) * invX;
        if (t1 > t2) {
          const tmp = t1;
          t1 = t2;
          t2 = tmp;
        }
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) continue;
      }

      if (Math.abs(dir.y) <= 1e-8) {
        if (origin.y < box.minY || origin.y > box.maxY) continue;
      } else {
        const invY = 1 / dir.y;
        let t1 = (box.minY - origin.y) * invY;
        let t2 = (box.maxY - origin.y) * invY;
        if (t1 > t2) {
          const tmp = t1;
          t1 = t2;
          t2 = tmp;
        }
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) continue;
      }

      if (Math.abs(dir.z) <= 1e-8) {
        if (origin.z < box.minZ || origin.z > box.maxZ) continue;
      } else {
        const invZ = 1 / dir.z;
        let t1 = (box.minZ - origin.z) * invZ;
        let t2 = (box.maxZ - origin.z) * invZ;
        if (t1 > t2) {
          const tmp = t1;
          t1 = t2;
          t2 = tmp;
        }
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) continue;
      }

      if (tmax < 0) continue;

      const t = tmin >= 0 ? tmin : 0;
      if (t >= 0 && t < closestT) {
        closestT = t;
        hitId = box.id;
      }
    }

    return {
      hit: hitId !== null,
      distance: closestT,
      colliderId: hitId,
      point: {
        x: origin.x + dir.x * closestT,
        y: origin.y + dir.y * closestT,
        z: origin.z + dir.z * closestT,
      },
    };
  }

  raycastBullets(origin: Vec3, dir: Vec3, maxDistance: number): RayHit {
    return this.raycast(origin, dir, maxDistance, false, true);
  }

  hasLineOfSight(from: Vec3, to: Vec3): boolean {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 1e-4) return true;

    const dir: Vec3 = { x: dx / dist, y: dy / dist, z: dz / dist };
    const result = this.raycast(from, dir, Math.max(0, dist - 0.15), true);
    return !result.hit;
  }
}

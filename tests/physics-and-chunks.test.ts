import { describe, expect, it } from 'vitest';
import { ChunkGrid } from '../src/engine/ChunkManager';
import { PhysicsWorld } from '../src/engine/Physics';
import { CHUNK_SIZE, WORLD_SIZE } from '../src/types/game';

describe('ChunkGrid (500x500m Cyber-Almaty)', () => {
  it('divides 500x500m into a 10x10 grid of 50x50m chunks', () => {
    const grid = new ChunkGrid(WORLD_SIZE, CHUNK_SIZE);
    expect(grid.gridCount).toBe(10);
    expect(grid.getTotalChunks()).toBe(100);

    expect(grid.worldToChunk(-250, -250)).toEqual({ cx: 0, cz: 0, key: '0,0' });
    expect(grid.worldToChunk(0, 0)).toEqual({ cx: 5, cz: 5, key: '5,5' });
    expect(grid.worldToChunk(249, 249)).toEqual({ cx: 9, cz: 9, key: '9,9' });
    // Clamps out-of-bounds cleanly
    expect(grid.worldToChunk(999, -999)).toEqual({ cx: 9, cz: 0, key: '9,0' });
  });

  it('computes active chunk radius accurately at center and corners', () => {
    const grid = new ChunkGrid(500, 50);
    const centerRender = grid.getActiveKeys(0, 0, 3);
    expect(centerRender.size).toBe(49); // 7x7 around (5,5)

    const cornerRender = grid.getActiveKeys(-240, -240, 2);
    expect(cornerRender.size).toBe(9); // 3x3 at corner (0,0)
    expect(cornerRender.has('0,0')).toBe(true);
    expect(cornerRender.has('2,2')).toBe(true);
    expect(cornerRender.has('3,3')).toBe(false);
  });
});

describe('PhysicsWorld with Chunk Filtering & Vehicle Collisions', () => {
  it('slides player smoothly along AABB walls and respects active chunks', () => {
    const physics = new PhysicsWorld();
    physics.addBox('wall_chunk_0_0', -220, 4, -220, 10, 8, 10, { chunkKey: '0,0' });

    // Chunk 0,0 active -> blocks movement
    physics.setActiveChunks(new Set(['0,0']));
    const blocked = physics.resolveCylinderMove(
      { x: -226, y: 0, z: -220 },
      -222,
      -220,
      0.45,
      0,
      1.8,
    );
    expect(blocked.collided).toBe(true);
    expect(blocked.x).toBeLessThan(-225.4);

    // Chunk 0,0 unloaded -> collider skipped
    physics.setActiveChunks(new Set(['5,5']));
    const free = physics.resolveCylinderMove(
      { x: -226, y: 0, z: -220 },
      -222,
      -220,
      0.45,
      0,
      1.8,
    );
    expect(free.collided).toBe(false);
    expect(free.x).toBeCloseTo(-222, 3);
  });

  it('raycasts bullets and computes line of sight accurately', () => {
    const physics = new PhysicsWorld();
    physics.addBox('pillar', 0, 2, -10, 4, 4, 2);

    const hit = physics.raycastBullets({ x: 0, y: 1.5, z: 0 }, { x: 0, y: 0, z: -1 }, 50);
    expect(hit.hit).toBe(true);
    expect(hit.colliderId).toBe('pillar');
    expect(hit.distance).toBeCloseTo(9, 2);

    expect(physics.hasLineOfSight({ x: 0, y: 1.5, z: 0 }, { x: 0, y: 1.5, z: -20 })).toBe(false);
    expect(physics.hasLineOfSight({ x: 5, y: 1.5, z: 0 }, { x: 5, y: 1.5, z: -20 })).toBe(true);
  });

  it('guards resolveCylinderMove against NaN and updates moving elevator door bounds', () => {
    const physics = new PhysicsWorld();
    const safe = physics.resolveCylinderMove({ x: 1, y: 0, z: 2 }, Number.NaN, 5, 0.45, 0, 1.8);
    expect(safe).toEqual({ x: 1, z: 2, collided: false });

    physics.addBox('elev_door', 0, 121.8, -35.8, 4.4, 3.6, 0.5, { active: true });
    physics.updateColliderBounds('elev_door', { minY: 96, maxY: 99.6, active: true });
    const box = physics.getCollider('elev_door');
    expect(box?.minY).toBe(96);
    expect(box?.maxY).toBe(99.6);

    // Blocks player at new bottom elevator floor Y=96
    const blocked = physics.resolveCylinderMove({ x: 0, y: 96, z: -37.2 }, 0, -35.0, 0.45, 96, 1.8);
    expect(blocked.collided).toBe(true);
  });

  it('detects ceilings, checks cylinder clearance, finds nearest clear spawn, and toggles prefix colliders', () => {
    const physics = new PhysicsWorld();
    physics.addBox('room_ceil', 0, 3.6, 0, 8, 0.4, 8);
    expect(physics.getCeilingY(0, 0, 0.45, 0, 1.8)).toBeCloseTo(3.4, 2);
    expect(physics.getCeilingY(20, 0, 0.45, 0, 1.8)).toBe(Number.POSITIVE_INFINITY);

    physics.addBox('bldg_block', 10, 5, 10, 8, 10, 8);
    expect(physics.isCylinderFree(10, 10, 2.0, 0.2, 1.6)).toBe(false);
    const clear = physics.findNearestClearPosition(10, 10, 2.0, 0.2, 1.6, { maxRadius: 20, step: 1.5 });
    expect(clear.found).toBe(true);
    expect(physics.isCylinderFree(clear.x, clear.z, 2.0, 0.2, 1.6)).toBe(true);

    physics.setCollidersActiveByPrefix('bldg_', false);
    expect(physics.isCylinderFree(10, 10, 2.0, 0.2, 1.6)).toBe(true);
  });

  it('keeps step-up height aligned with getSupportY (0.25m curb) and updates chunkKey in byChunk', () => {
    const physics = new PhysicsWorld();
    physics.addBox('curb', 0, 0.12, -5, 4, 0.24, 4);
    expect(physics.getSupportY(0, -5, 0.45, 0, 0)).toBeCloseTo(0.24, 2);
    const step = physics.resolveCylinderMove({ x: 0, y: 0, z: -8 }, 0, -5, 0.45, 0, 1.8);
    expect(step.collided).toBe(false);
    expect(step.z).toBeCloseTo(-5, 2);

    physics.addBox('moving_prop', 0, 2, 0, 2, 4, 2, { chunkKey: '1,1' });
    physics.addBox('moving_prop', 0, 2, 0, 2, 4, 2, { chunkKey: '2,2' });
    physics.setActiveChunks(new Set(['1,1']));
    expect(physics.isCylinderFree(0, 0, 0.45, 0, 1.8)).toBe(true);
    physics.setActiveChunks(new Set(['2,2']));
    expect(physics.isCylinderFree(0, 0, 0.45, 0, 1.8)).toBe(false);
  });
});

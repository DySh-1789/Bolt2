import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { ChunkManager } from '../src/engine/ChunkManager';
import { PhysicsWorld } from '../src/engine/Physics';
import { ProceduralTextures } from '../src/engine/ProceduralTextures';
import { CyberAlmatyWorld } from '../src/game/CyberAlmatyWorld';
import { INSTANCE_Y, StoryInstances } from '../src/game/StoryInstances';
import { VehicleSystem } from '../src/game/VehicleSystem';
import { getGigEnemyWave, OPEN_WORLD_GIGS } from '../src/game/OpenWorldSystem';
import { DISTRICTS } from '../src/types/game';

describe('World & Story Instance Spatial Integrity', () => {
  beforeAll(() => {
    const fakeGradient = { addColorStop: () => {} };
    const fakeCtx = new Proxy(
      {
        createLinearGradient: () => fakeGradient,
        createRadialGradient: () => fakeGradient,
        measureText: () => ({ width: 10 }),
      },
      {
        get(target, prop) {
          if (prop in target) return (target as Record<PropertyKey, unknown>)[prop];
          return () => {};
        },
        set() {
          return true;
        },
      },
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      fakeCtx as unknown as CanvasRenderingContext2D,
    );
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it('verifies all open-world spawns, fast-travel taxi summons, gig waves, and rooftop rails are collision-free', () => {
    const scene = new THREE.Scene();
    const physics = new PhysicsWorld();
    const chunks = new ChunkManager(scene);
    const textures = new ProceduralTextures();
    const city = new CyberAlmatyWorld(chunks, physics, textures);
    const vehicle = new VehicleSystem(scene, textures);

    // 1. Every district fast-travel player spot & physics-safe summoned taxi spot must be free
    for (const d of DISTRICTS) {
      chunks.forceRefresh(d.fastTravelPos.x, d.fastTravelPos.z, true, physics);
      expect(
        physics.isCylinderFree(d.fastTravelPos.x, d.fastTravelPos.z, 0.45, 0.25, 1.8),
        `Player fastTravelPos blocked in ${d.id}`,
      ).toBe(true);

      vehicle.summonNear(d.fastTravelPos.x, d.fastTravelPos.z, d.fastTravelYaw, physics);
      expect(
        physics.isCylinderFree(vehicle.state.x, vehicle.state.z, vehicle.state.radius, 0.35, 1.6),
        `Taxi summon blocked in ${d.id} at (${vehicle.state.x.toFixed(1)}, ${vehicle.state.z.toFixed(1)})`,
      ).toBe(true);
    }

    // 2. Key open-world spawns & choke breakout spots must be free
    const playerSpots: Array<{ name: string; x: number; y: number; z: number }> = [
      { name: 'open_world_start', x: -46, y: 0.25, z: -24 },
      { name: 'marum_interior', x: -46, y: 0.25, z: -40 },
      { name: 'motel_spawn', x: -165, y: 0.25, z: -158 },
      { name: 'motel_doorway', x: -167.5, y: 0.25, z: -170.0 },
      { name: 'motel_breakout', x: -170.8, y: 0.25, z: -170.4 },
      { name: 'junkyard_wake', x: -165, y: 0.25, z: 165 },
      { name: 'rooftop_up_dest', x: 162, y: 36, z: 160 },
      { name: 'rooftop_down_dest', x: 148, y: 0.25, z: 152 },
    ];
    for (const s of playerSpots) {
      chunks.forceRefresh(s.x, s.z, true, physics);
      expect(
        physics.isCylinderFree(s.x, s.z, 0.45, s.y, 1.8),
        `Spawn blocked: ${s.name}`,
      ).toBe(true);
    }

    // 3. Rooftop perimeter guardrails block walking off the 36m ledge
    chunks.forceRefresh(165, 165, true, physics);
    const edgeAttempt = physics.resolveCylinderMove(
      { x: 165, y: 36, z: 177 },
      165,
      184,
      0.45,
      36,
      1.8,
    );
    expect(edgeAttempt.collided).toBe(true);
    expect(edgeAttempt.z).toBeLessThan(179);

    // 4. All open-world gig enemy wave spawns must be clear of city colliders
    for (const gig of OPEN_WORLD_GIGS) {
      const wave = getGigEnemyWave(gig.id);
      for (const e of wave) {
        chunks.forceRefresh(e.x, e.z, true, physics);
        expect(
          physics.isCylinderFree(e.x, e.z, 0.45, e.y + 0.1, 1.8),
          `Gig enemy ${e.id} (${gig.id}) spawned inside collider at (${e.x}, ${e.z})`,
        ).toBe(true);
      }
    }

    // 5. Motel lock blocks exit when locked and opens when unlocked
    chunks.forceRefresh(-165, -158, true, physics);
    city.setMotelLocked(true);
    const lockedMove = physics.resolveCylinderMove({ x: -165, y: 0.25, z: -156 }, -165, -152, 0.45, 0.25, 1.8);
    expect(lockedMove.collided).toBe(true);
    city.setMotelLocked(false);
    const openMove = physics.resolveCylinderMove({ x: -165, y: 0.25, z: -156 }, -165, -152, 0.45, 0.25, 1.8);
    expect(openMove.collided).toBe(false);

    city.dispose();
    textures.dispose();
  });

  it('verifies story instance collider isolation, penthouse lock, ceiling heights, and cyberspace guardrails', () => {
    const scene = new THREE.Scene();
    const physics = new PhysicsWorld();
    const textures = new ProceduralTextures();
    const instances = new StoryInstances(scene, physics, textures);

    // Penthouse active: corridor locked initially, unlocks cleanly, ceiling catches jumps
    instances.setPenthouseCorridorLocked(true);
    instances.setActiveInstance('PENTHOUSE');
    const yPh = INSTANCE_Y.PENTHOUSE;
    expect(physics.isCylinderFree(0, 13, 0.45, yPh, 1.8)).toBe(true);
    expect(physics.isCylinderFree(-10.1, 6.7, 0.45, yPh, 1.8)).toBe(true);
    expect(physics.getCeilingY(-10.1, 6.7, 0.45, yPh, 1.8)).toBeLessThan(yPh + 3.6);

    const lockedCorridor = physics.resolveCylinderMove({ x: 0, y: yPh, z: 1 }, 0, -4, 0.45, yPh, 1.8);
    expect(lockedCorridor.collided).toBe(true);
    instances.setPenthouseCorridorLocked(false);
    const openCorridor = physics.resolveCylinderMove({ x: 0, y: yPh, z: 1 }, 0, -4, 0.45, yPh, 1.8);
    expect(openCorridor.collided).toBe(false);

    // Switching to UNDERGROUND disables penthouse colliders & enables underground lobby/arena
    instances.undergroundElevator.snapToArrived();
    instances.setActiveInstance('UNDERGROUND');
    expect(physics.getCeilingY(-10.1, 6.7, 0.45, yPh, 1.8)).toBe(Number.POSITIVE_INFINITY);
    const yCore = INSTANCE_Y.UNDERGROUND;
    expect(physics.isCylinderFree(0, -34, 0.45, yCore, 1.8)).toBe(true);
    expect(physics.getCeilingY(0, -50, 0.45, yCore, 1.8)).toBeLessThan(yCore + 12);

    // Switching to CYBERSPACE enforces bridge guardrails
    instances.setActiveInstance('CYBERSPACE');
    const yCyb = INSTANCE_Y.CYBERSPACE;
    const offBridge = physics.resolveCylinderMove({ x: 0, y: yCyb, z: 0 }, 8, 0, 0.45, yCyb, 1.8);
    expect(offBridge.collided).toBe(true);
    expect(offBridge.x).toBeLessThan(4.0);

    instances.dispose();
    textures.dispose();
  });
});

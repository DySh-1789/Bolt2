import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { PhysicsWorld } from '../src/engine/Physics';
import { EnemyManager } from '../src/game/EnemyManager';
import { RikhardSmasherBoss, RikhardSmasherState } from '../src/game/RikhardSmasherBoss';
import { StoryStateMachine } from '../src/game/StoryDirector';
import { ElevatorState } from '../src/game/ElevatorSystem';

describe('RikhardSmasherState (3-Phase Beatable Boss + Malorian Execution)', () => {
  it('progresses through Phases 1 -> 2 -> 3 -> STAGGERED -> EXECUTED', () => {
    const boss = new RikhardSmasherState();
    boss.startFight();
    expect(boss.phase).toBe('PHASE_1');

    const r1 = boss.applyDamage(520); // drops below 65% of 1400 (910)
    expect(r1.enteredPhase2).toBe(true);
    expect(boss.phase).toBe('PHASE_2');

    const r2 = boss.applyDamage(500); // drops to 380 <= 30% (420)
    expect(r2.enteredPhase3).toBe(true);
    expect(boss.phase).toBe('PHASE_3');

    const r3 = boss.applyDamage(500); // drops to 0 -> STAGGERED
    expect(r3.enteredStaggered).toBe(true);
    expect(boss.hp).toBe(0);
    expect(boss.phase).toBe('STAGGERED');

    expect(boss.executeWithMalorian()).toBe(true);
    expect(boss.phase).toBe('EXECUTED');
  });

  it('reduces starting HP up to 20% when Netrunner armor weakening is applied', () => {
    const boss = new RikhardSmasherState();
    boss.startFight();
    const reduced = boss.setArmorWeakened(20);
    expect(reduced).toBe(20);
    expect(boss.hp).toBe(1120); // 1400 * 0.8
  });
});

describe('StoryStateMachine (Full Campaign & Both Endings)', () => {
  it('handles open-world visibility and branches into both Marum and Taldykorgan endings', () => {
    const sm = new StoryStateMachine();
    sm.transition('OPEN_WORLD');
    expect(sm.isOpenWorldLike()).toBe(true);

    sm.transition('SMASHER_BOSS');
    expect(sm.isOpenWorldLike()).toBe(false);

    sm.transition('HUYESHI_CYBERSPACE');
    expect(sm.selectFinaleEnding('marum')).toBe('EPILOGUE_MARUM');
    expect(sm.endingChoice).toBe('marum');

    sm.transition('HUYESHI_CYBERSPACE');
    expect(sm.selectFinaleEnding('taldykorgan')).toBe('EPILOGUE_TALDYKORGAN');
    expect(sm.endingChoice).toBe('taldykorgan');
  });
});

describe('ElevatorState', () => {
  it('closes doors, travels smoothly to destination floor, and opens doors', () => {
    const elev = new ElevatorState({
      id: 'test_elev',
      centerX: 0,
      centerZ: 0,
      startY: 0,
      endY: -24,
      startFloorLabel: 1,
      endFloorLabel: -12,
      travelDuration: 2.0,
      doorFacingZ: 1,
    });

    expect(elev.startRide()).toBe(true);
    let arrived = false;
    for (let i = 0; i < 80; i++) {
      const r = elev.step(0.05);
      if (r.arrived) {
        arrived = true;
        break;
      }
    }
    expect(arrived).toBe(true);
    expect(elev.currentY).toBe(-24);
    expect(elev.displayFloor).toBe(-12);
  });
});

describe('EnemyManager death re-entrancy safety', () => {
  it('never crashes when onPlayerHit kills the player and calls clearZone() while multiple bullets are in flight', () => {
    const scene = new THREE.Scene();
    const physics = new PhysicsWorld();
    const mgr = new EnemyManager(scene);

    // Spawn 3 guards at close range so multiple bullets are simultaneously in flight
    mgr.spawnWave([
      { id: 'g1', archetype: 'guard', zoneId: 'test', x: 0, y: 0, z: -4 },
      { id: 'g2', archetype: 'guard', zoneId: 'test', x: 0.5, y: 0, z: -4 },
      { id: 'g3', archetype: 'guard', zoneId: 'test', x: -0.5, y: 0, z: -4 },
    ]);

    let hits = 0;
    expect(() => {
      for (let step = 0; step < 60; step++) {
        mgr.update(
          0.05,
          { x: 0, y: 0, z: 0 },
          { x: 0, y: 1.68, z: 0 },
          physics,
          {
            onEnemyShot: () => {},
            onPlayerHit: () => {
              hits++;
              // Simulate lethal respawn clearing enemies & bullets synchronously mid-loop
              mgr.clearZone();
            },
          },
        );
      }
    }).not.toThrow();

    expect(hits).toBeGreaterThan(0);
  });

  it('blocks enemy bullets behind cover, registers humanoid leg hits, and blocks melee through walls', () => {
    const scene = new THREE.Scene();
    const physics = new PhysicsWorld();
    const mgr = new EnemyManager(scene);

    // Solid cover wall between enemy at Z=-8 and player at Z=0
    physics.addBox('cover_wall', 0, 2, -4, 6, 4, 1);
    mgr.spawnWave([{ id: 'g_cover', archetype: 'guard', zoneId: 'cover', x: 0, y: 0, z: -8 }]);

    let hits = 0;
    for (let step = 0; step < 50; step++) {
      mgr.update(
        0.05,
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 1.68, z: 0 },
        physics,
        {
          onEnemyShot: () => {},
          onPlayerHit: () => {
            hits++;
          },
        },
      );
    }
    expect(hits).toBe(0);

    // Melee arc through the solid wall must not connect
    const blockedMelee = mgr.applyMeleeArc(
      new THREE.Vector3(0, 1.5, -2.5),
      new THREE.Vector3(0, 0, -1),
      8,
      90,
      physics,
    );
    expect(blockedMelee.length).toBe(0);

    // Bullet aimed at humanoid legs (y = 0.45) must register as a hit
    mgr.clearZone();
    mgr.spawnWave([{ id: 'g_legs', archetype: 'guard', zoneId: 'legs', x: 0, y: 0, z: -8 }]);
    const legHit = mgr.checkBulletHit(
      new THREE.Vector3(0, 0.45, -5.5),
      new THREE.Vector3(0, 0, -1),
      10,
      25,
      2.0,
    );
    expect(legHit.hit).toBe(true);
    expect(legHit.headshot).toBe(false);
  });
});

describe('ElevatorState.snapToArrived & RikhardSmasherBoss combat guards', () => {
  it('snaps elevator directly to destination floor and doors open', () => {
    const elev = new ElevatorState({
      id: 'snap_elev',
      centerX: 0,
      centerZ: -30.5,
      startY: -66,
      endY: -90,
      startFloorLabel: 1,
      endFloorLabel: -12,
      travelDuration: 3.6,
      doorFacingZ: 1,
      exitDoorFacingZ: -1,
    });
    elev.snapToArrived();
    expect(elev.phase).toBe('ARRIVED');
    expect(elev.currentY).toBe(-90);
    expect(elev.displayFloor).toBe(-12);
    expect(elev.doorOpen).toBe(1);
  });

  it('prevents damaging Rikhard Smasher through pillars or while STAGGERED/DORMANT', () => {
    const scene = new THREE.Scene();
    const physics = new PhysicsWorld();
    const boss = new RikhardSmasherBoss(scene, 0);

    // Dormant -> immune to bullets and melee
    expect(
      boss.checkBulletHit(new THREE.Vector3(0, 1.5, 5), new THREE.Vector3(0, 0, -1), 20, 100, 2).hit,
    ).toBe(false);
    expect(
      boss.applyMeleeDamage(new THREE.Vector3(0, 1.5, -1), 5, 100, new THREE.Vector3(0, 0, -1), physics).hit,
    ).toBe(false);

    boss.activateAt(0, 0, -6);
    // Solid pillar blocking melee line-of-sight at Z=-3
    physics.addBox('arena_pillar', 0, 2, -3, 3, 4, 1);
    expect(
      boss.applyMeleeDamage(new THREE.Vector3(0, 1.5, -1.5), 6, 100, new THREE.Vector3(0, 0, -1), physics).hit,
    ).toBe(false);

    // Facing away from boss -> melee cone rejects hit
    physics.setActive('arena_pillar', false);
    expect(
      boss.applyMeleeDamage(new THREE.Vector3(0, 1.5, -3.5), 6, 100, new THREE.Vector3(0, 0, 1), physics).hit,
    ).toBe(false);

    // Stagger boss -> further shots/melee must be ignored
    boss.state.applyDamage(2000);
    expect(boss.state.phase).toBe('STAGGERED');
    expect(
      boss.applyMeleeDamage(new THREE.Vector3(0, 1.5, -3.5), 6, 100, new THREE.Vector3(0, 0, -1), physics).hit,
    ).toBe(false);
  });
});

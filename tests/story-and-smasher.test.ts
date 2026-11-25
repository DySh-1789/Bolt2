import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { PhysicsWorld } from '../src/engine/Physics';
import { EnemyManager } from '../src/game/EnemyManager';
import { RikhardSmasherState } from '../src/game/RikhardSmasherBoss';
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
});

import { describe, expect, it } from 'vitest';
import { ArsenalState } from '../src/game/WeaponSystem';
import { PlayerState } from '../src/game/Player';

describe('ArsenalState (Mantis Blades + Firearms + Malorian S-3516)', () => {
  it('supports 3-hit Mantis Blades combo and lunge cooldown', () => {
    const arsenal = new ArsenalState();
    arsenal.reset(['mantis_blades', 'alatau_pistol'], 'mantis_blades');

    const hit1 = arsenal.tryFire();
    expect(hit1.fired).toBe(true);
    expect(hit1.comboStep).toBe(0);

    arsenal.update(0.35);
    const hit2 = arsenal.tryFire();
    expect(hit2.comboStep).toBe(1);

    arsenal.update(0.35);
    const hit3 = arsenal.tryFire();
    expect(hit3.comboStep).toBe(2);

    expect(arsenal.tryMantisLunge()).toBe(true);
    expect(arsenal.tryMantisLunge()).toBe(false); // on cooldown
    arsenal.update(1.7);
    expect(arsenal.tryMantisLunge()).toBe(true);
  });

  it('unlocks Malorian S-3516, fires, empties mag, and reloads cleanly', () => {
    const arsenal = new ArsenalState();
    expect(arsenal.unlockWeapon('malorian', true)).toBe(true);
    expect(arsenal.activeWeapon).toBe('malorian');
    expect(arsenal.getAmmo()).toBe(8);

    for (let i = 0; i < 8; i++) {
      const r = arsenal.tryFire();
      expect(r.fired).toBe(true);
      arsenal.update(0.3);
    }
    expect(arsenal.getAmmo()).toBe(0);

    const emptyAttempt = arsenal.tryFire();
    expect(emptyAttempt.fired).toBe(false);
    expect(emptyAttempt.needReload).toBe(true);
    expect(arsenal.reloading).toBe(true);

    const done = arsenal.update(1.5);
    expect(done.reloadCompleted).toBe(true);
    expect(arsenal.getAmmo()).toBe(8);
  });
});

describe('PlayerState (Cyberware, Economy, and Ripperdoc Upgrades)', () => {
  it('absorbs 55% damage via armor and upgrades HP/Armor via reinforced plating', () => {
    const player = new PlayerState();
    const dmg = player.takeDamage(40);
    expect(dmg.died).toBe(false);
    expect(player.armor).toBeCloseTo(28, 1); // 50 - 22
    expect(player.hp).toBeCloseTo(82, 1); // 100 - 18

    expect(player.applyUpgrade('reinforcedPlating')).toBe(true);
    expect(player.maxHp).toBe(150);
    expect(player.maxArmor).toBe(100);
    expect(player.hp).toBe(150);
  });

  it('manages Cyber-Tenge spending and Sandevistan Mk.II slow-mo', () => {
    const player = new PlayerState();
    expect(player.spendTenge(500)).toBe(true);
    expect(player.tenge).toBe(1000);
    expect(player.spendTenge(5000)).toBe(false);

    player.applyUpgrade('sandevistanMk2');
    const toggled = player.toggleSandevistan();
    expect(toggled.active).toBe(true);
    expect(player.getWorldTimeScale()).toBeCloseTo(0.28, 2);

    player.updateTimers(2.0);
    // Mk.II drains at 15/sec -> 70% energy left after 2s
    expect(player.sandevistanEnergy).toBeCloseTo(70, 1);
  });
});

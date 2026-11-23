import { describe, expect, it } from 'vitest';
import { PhysicsWorld } from '../src/engine/Physics';
import { CyberAkhmedState } from '../src/game/VehicleSystem';
import { OpenWorldState } from '../src/game/OpenWorldSystem';
import {
  formatDialogueText,
  getAssaultPlanChoices,
  getCyberspaceFarewellLines,
} from '../src/game/DialogueLibrary';
import { getDistrictAt } from '../src/types/game';

describe('CyberAkhmedState (Drivable Taxi & Autopilot)', () => {
  it('accelerates with nitro boost and reaches autopilot destination', () => {
    const physics = new PhysicsWorld();
    const car = new CyberAkhmedState();
    car.setPose(0, 0, 0, 0); // facing -Z

    // Manual nitro burst
    for (let i = 0; i < 40; i++) {
      car.step(0.05, 1, 0, false, true, physics);
    }
    expect(car.getSpeedKmh()).toBeGreaterThan(100);
    expect(car.z).toBeLessThan(-30);
    expect(car.nitroEnergy).toBeLessThan(100);

    // Autopilot drive to target
    car.setPose(0, 0, 0, 0);
    car.startAutopilot({ x: 0, y: 0, z: -45 });
    let arrived = false;
    for (let i = 0; i < 120; i++) {
      const r = car.step(0.05, 0, 0, false, false, physics);
      if (r.arrivedAutopilot) {
        arrived = true;
        break;
      }
    }
    expect(arrived).toBe(true);
    expect(car.autopilotActive).toBe(false);
  });
});

describe('OpenWorldState, Districts, and Dialogue Censorship', () => {
  it('maps 500x500m Cyber-Almaty coordinates to all 5 districts', () => {
    expect(getDistrictAt(0, 0).id).toBe('abay_eblanhana');
    expect(getDistrictAt(-165, -165).id).toBe('cyber_tastak');
    expect(getDistrictAt(170, -170).id).toBe('marakulin_plaza');
    expect(getDistrictAt(-165, 165).id).toBe('junkyard');
    expect(getDistrictAt(165, 165).id).toBe('koktobe_overlook');
  });

  it('tracks open world gigs completion and automatically tracks next gig', () => {
    const ow = new OpenWorldState();
    expect(ow.trackedGigId).toBe('gig_malorian');
    const done = ow.completeGig('gig_malorian');
    expect(done?.unlocksWeapon).toBe('malorian');
    expect(ow.getCompletedCount()).toBe(1);
    expect(ow.trackedGigId).not.toBe('gig_malorian');
  });

  it('preserves authentic scenario dialogue by default and censors when toggled', () => {
    const raw = 'Вставай ебанат блять, у нас Кибер-Алматы на сожжение. Пошли к Хуеши в Ебланхане.';
    expect(formatDialogueText(raw, false)).toBe(raw);
    const clean = formatDialogueText(raw, true);
    expect(clean).not.toContain('ебанат');
    expect(clean).not.toContain('блять');
    expect(clean).toContain('Микоши');
  });

  it('unlocks linear-nonlinear assault approaches and customizes farewells by Samir affinity', () => {
    const ow = new OpenWorldState();
    expect(ow.hasNetrunnerIntel()).toBe(false);
    ow.completeGig('gig_tastak_hack');
    ow.completeGig('gig_malorian');
    expect(ow.hasNetrunnerIntel()).toBe(true);
    expect(ow.hasEblanhanaSupport(5)).toBe(true);

    const bonuses = ow.getAssaultBonuses(5);
    expect(bonuses.smasherArmorReductionPercent).toBe(20);
    expect(bonuses.disableLobbyTurrets).toBe(true);
    expect(bonuses.grantFullArmor).toBe(true);

    const choices = getAssaultPlanChoices({
      hasNetrunnerIntel: true,
      hasEblanhanaSupport: true,
      censored: false,
    });
    expect(choices.length).toBe(3);
    expect(choices.every((c) => !c.disabled)).toBe(true);

    const highSync = getCyberspaceFarewellLines('taldykorgan', 85, false);
    const lowSync = getCyberspaceFarewellLines('taldykorgan', 20, false);
    expect(highSync.length).toBeGreaterThan(0);
    expect(highSync.map((l) => l.text).join(' ')).not.toBe(
      lowSync.map((l) => l.text).join(' '),
    );
  });
});

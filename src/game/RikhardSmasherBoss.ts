import * as THREE from 'three';
import type { BossPhase, Vec3 } from '../types/game';
import type { PhysicsWorld } from '../engine/Physics';

/**
 * Pure 3-phase boss state machine evolved from Bolt 1's LevSmasherState.
 * Unlike Bolt 1, Rikhard Smasher in Bolt 2 IS BEATABLE: reaches STAGGERED at 0 HP for interactive Malorian execution!
 */
export class RikhardSmasherState {
  readonly maxHp = 1400;
  hp = 1400;
  phase: BossPhase = 'DORMANT';
  readonly phase2Threshold = 0.65;
  readonly phase3Threshold = 0.3;
  armorWeakenedPercent = 0;

  reset(): void {
    this.hp = this.maxHp;
    this.phase = 'DORMANT';
    this.armorWeakenedPercent = 0;
  }

  getHpRatio(): number {
    return this.hp / this.maxHp;
  }

  /**
   * Applies Netrunner armor weakening (clamped to 0..20% starting HP reduction).
   * Works whether invoked before startFight() or while the fight is active.
   */
  setArmorWeakened(percent: number): number {
    const clamped = Math.max(0, Math.min(20, Math.round(percent)));
    this.armorWeakenedPercent = clamped;
    const weakenedCap = Math.round(this.maxHp * (1 - clamped / 100));
    if (this.phase === 'PHASE_1' || this.phase === 'PHASE_2' || this.phase === 'PHASE_3') {
      this.hp = Math.min(this.hp, weakenedCap);
    } else if (this.phase === 'DORMANT') {
      this.hp = weakenedCap;
    }
    return clamped;
  }

  startFight(): void {
    this.hp = Math.round(this.maxHp * (1 - this.armorWeakenedPercent / 100));
    this.phase = 'PHASE_1';
  }

  applyDamage(amount: number): {
    actualDamage: number;
    enteredPhase2: boolean;
    enteredPhase3: boolean;
    enteredStaggered: boolean;
  } {
    if (this.phase !== 'PHASE_1' && this.phase !== 'PHASE_2' && this.phase !== 'PHASE_3') {
      return { actualDamage: 0, enteredPhase2: false, enteredPhase3: false, enteredStaggered: false };
    }

    const prev = this.hp;
    this.hp = Math.max(0, this.hp - Math.max(0, amount));
    const actualDamage = prev - this.hp;

    let enteredPhase2 = false;
    let enteredPhase3 = false;
    let enteredStaggered = false;

    if (this.phase === 'PHASE_1' && this.getHpRatio() <= this.phase2Threshold) {
      this.phase = 'PHASE_2';
      enteredPhase2 = true;
    }
    if ((this.phase === 'PHASE_1' || this.phase === 'PHASE_2') && this.getHpRatio() <= this.phase3Threshold) {
      this.phase = 'PHASE_3';
      enteredPhase3 = true;
    }
    if (this.hp <= 0) {
      this.phase = 'STAGGERED';
      enteredStaggered = true;
    }

    return { actualDamage, enteredPhase2, enteredPhase3, enteredStaggered };
  }

  executeWithMalorian(): boolean {
    if (this.phase !== 'STAGGERED') return false;
    this.phase = 'EXECUTED';
    return true;
  }
}

interface BossProjectile {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  damage: number;
  life: number;
}

interface TelegraphMissile {
  ring: THREE.Mesh;
  missile: THREE.Mesh;
  startPos: THREE.Vector3;
  targetPos: THREE.Vector3;
  timer: number;
  maxTimer: number;
}

interface ShockwaveRing {
  mesh: THREE.Mesh;
  radius: number;
  maxRadius: number;
  damagedPlayer: boolean;
}

interface AfterimageGhost {
  mesh: THREE.Mesh;
  life: number;
  maxLife: number;
}

interface ArmorSpark {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
}

export interface SmasherHitResult {
  hit: boolean;
  headshot: boolean;
  damage: number;
  enteredPhase2: boolean;
  enteredPhase3: boolean;
  enteredStaggered: boolean;
  point: THREE.Vector3;
}

export interface SmasherCallbacks {
  onAutocannonShot: () => void;
  onMissileExplode: () => void;
  onRoar: () => void;
  onPlayerDamaged: (amount: number, shake: number) => void;
}

/**
 * Towering 3.1-meter full-borg juggernaut — Rikhard Smasher (evolved from Bolt 1's Lev Smasher).
 * Features articulated hydraulic legs, ribbed chest plates, crimson reactor core & dorsal spine tubes,
 * armored cyber-skull with glowing red optic slit, shoulder rocket pod, 6-barrel rotary autocannon,
 * and massive hydraulic cyber-claw.
 */
export class RikhardSmasherBoss {
  readonly state = new RikhardSmasherState();
  readonly group = new THREE.Group();

  private bodyHitbox!: THREE.Mesh;
  private headHitbox!: THREE.Mesh;
  private hitMeshes: THREE.Object3D[] = [];
  private leftLegPivot!: THREE.Group;
  private rightLegPivot!: THREE.Group;
  private rightCannon!: THREE.Group;
  private rotaryBarrels!: THREE.Group;
  private leftClaw!: THREE.Group;
  private muzzleGlow!: THREE.Mesh;
  private coreMat!: THREE.MeshStandardMaterial;
  private chestPlateMat!: THREE.MeshStandardMaterial;
  private auraLight!: THREE.PointLight;

  private projectiles: BossProjectile[] = [];
  private missiles: TelegraphMissile[] = [];
  private shockwaves: ShockwaveRing[] = [];
  private ghosts: AfterimageGhost[] = [];
  private sparks: ArmorSpark[] = [];

  private scene: THREE.Scene;
  private raycaster = new THREE.Raycaster();
  private arenaFloorY = -90;
  private burstTimer = 1.6;
  private missileTimer = 4.2;
  private dashTimer = 5.5;
  private shockwaveTimer = 7.0;
  private flashTimer = 0;
  private sparkTimer = 0;
  private walkCycle = 0;
  private rotarySpinSpeed = 0;

  constructor(scene: THREE.Scene, arenaFloorY: number) {
    this.scene = scene;
    this.arenaFloorY = arenaFloorY;
    this.buildModel();
    this.group.visible = false;
    scene.add(this.group);
  }

  private buildModel(): void {
    const darkArmor = new THREE.MeshStandardMaterial({
      color: 0x262c3d,
      metalness: 0.72,
      roughness: 0.28,
    });
    const gunmetal = new THREE.MeshStandardMaterial({
      color: 0x56647d,
      metalness: 0.84,
      roughness: 0.22,
    });
    const crimsonAccent = new THREE.MeshStandardMaterial({
      color: 0xb81432,
      metalness: 0.56,
      roughness: 0.32,
    });
    this.chestPlateMat = crimsonAccent.clone();
    this.coreMat = new THREE.MeshStandardMaterial({
      color: 0xff003c,
      emissive: 0xff003c,
      emissiveIntensity: 3.2,
      roughness: 0.2,
      metalness: 0.2,
    });

    const hitList: THREE.Object3D[] = [];
    const registerBodyHit = (mesh: THREE.Mesh) => {
      mesh.userData = { isBoss: true, isHead: false };
      hitList.push(mesh);
      return mesh;
    };
    const registerHeadHit = (mesh: THREE.Mesh) => {
      mesh.userData = { isBoss: true, isHead: true };
      hitList.push(mesh);
      return mesh;
    };

    // 1. Heavy articulated hydraulic legs (armored boots, shins, calf pistons, knee guards, thighs)
    const buildLeg = (side: -1 | 1): THREE.Group => {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.48, 1.32, 0);

      // Upper armored thigh
      const thigh = registerBodyHit(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.62, 0.58), darkArmor));
      thigh.position.set(0, -0.32, 0);
      pivot.add(thigh);

      // Thigh side hydraulic damper
      const thighPiston = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.52, 8), gunmetal);
      thighPiston.position.set(side * 0.28, -0.34, 0.04);
      pivot.add(thighPiston);

      // Reinforced crimson knee guard
      const knee = registerBodyHit(new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.3, 0.66), crimsonAccent));
      knee.position.set(0, -0.62, 0.08);
      pivot.add(knee);

      // Armored shin
      const shin = registerBodyHit(new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.58, 0.52), darkArmor));
      shin.position.set(0, -0.98, -0.02);
      pivot.add(shin);

      // Rear calf hydraulic cylinder
      const calfPiston = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.06, 0.54, 8), gunmetal);
      calfPiston.position.set(0, -0.96, -0.31);
      calfPiston.rotation.x = 0.14;
      pivot.add(calfPiston);

      // Massive armored cyber-boot
      const boot = registerBodyHit(new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.22, 0.78), gunmetal));
      boot.position.set(0, -1.21, 0.1);
      pivot.add(boot);

      return pivot;
    };

    this.leftLegPivot = buildLeg(-1);
    this.rightLegPivot = buildLeg(1);
    this.group.add(this.leftLegPivot, this.rightLegPivot);

    // Armored pelvis & waist hydraulics
    const pelvis = registerBodyHit(new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.34, 0.8), gunmetal));
    pelvis.position.set(0, 1.34, 0);
    this.group.add(pelvis);

    for (const sx of [-0.52, 0.52]) {
      const waistPiston = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.42, 8), gunmetal);
      waistPiston.position.set(sx, 1.48, 0.22);
      waistPiston.rotation.z = sx > 0 ? 0.15 : -0.15;
      this.group.add(waistPiston);
    }

    // 2. Massive armored exo-torso (Primary Body Hitbox)
    this.bodyHitbox = registerBodyHit(new THREE.Mesh(new THREE.BoxGeometry(1.58, 1.34, 0.98), darkArmor));
    this.bodyHitbox.position.set(0, 1.98, 0);
    this.group.add(this.bodyHitbox);

    // Hydraulic ribbed chest plates + pectoral armor + glowing crimson reactor core
    const chestPlate = registerBodyHit(new THREE.Mesh(new THREE.BoxGeometry(1.28, 0.74, 0.26), this.chestPlateMat));
    chestPlate.position.set(0, 2.06, 0.46);
    this.group.add(chestPlate);

    for (const sx of [-0.36, 0.36]) {
      const pecPlate = registerBodyHit(new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.36, 0.16), gunmetal));
      pecPlate.position.set(sx, 2.26, 0.56);
      pecPlate.rotation.y = sx > 0 ? -0.16 : 0.16;
      this.group.add(pecPlate);

      const chestPiston = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.64, 8), gunmetal);
      chestPiston.position.set(sx * 1.65, 1.96, 0.48);
      this.group.add(chestPiston);
    }

    const reactorRing = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.18, 14), gunmetal);
    reactorRing.rotation.x = Math.PI / 2;
    reactorRing.position.set(0, 2.02, 0.54);
    this.group.add(reactorRing);

    const reactorCore = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.21, 0.26, 14), this.coreMat);
    reactorCore.rotation.x = Math.PI / 2;
    reactorCore.position.set(0, 2.02, 0.56);
    this.group.add(reactorCore);

    // Armored neck collar
    const collar = registerBodyHit(new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.24, 0.78), gunmetal));
    collar.position.set(0, 2.66, -0.02);
    this.group.add(collar);

    // 3. Dorsal armored spine & glowing crimson spine power tubes (iconic Sandevistan cyber-spine!)
    const spineHousing = registerBodyHit(new THREE.Mesh(new THREE.BoxGeometry(0.46, 1.18, 0.34), gunmetal));
    spineHousing.position.set(0, 2.02, -0.56);
    this.group.add(spineHousing);

    for (let i = 0; i < 4; i++) {
      const vy = 1.6 + i * 0.26;
      const vertebra = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.12, 0.24), darkArmor);
      vertebra.position.set(0, vy, -0.66);
      this.group.add(vertebra);

      for (const sx of [-0.28, 0.28]) {
        const spineTube = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.048, 0.22, 8), this.coreMat);
        spineTube.position.set(sx, vy, -0.62);
        this.group.add(spineTube);
      }
    }

    // 4. Heavy angled shoulder pauldrons & multi-tube shoulder rocket pod
    for (const sx of [-1.06, 1.06]) {
      const pauldron = registerBodyHit(new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.58, 0.96), gunmetal));
      pauldron.position.set(sx, 2.52, 0);
      pauldron.rotation.z = sx < 0 ? 0.18 : -0.18;
      this.group.add(pauldron);

      const trim = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.1, 0.98), crimsonAccent);
      trim.position.set(sx, 2.74, 0);
      trim.rotation.z = sx < 0 ? 0.18 : -0.18;
      this.group.add(trim);
    }

    // Left shoulder heavy rocket pod with 6 glowing crimson missile tubes
    const missilePod = registerBodyHit(new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.56, 0.86), crimsonAccent));
    missilePod.position.set(-1.02, 2.98, -0.05);
    this.group.add(missilePod);

    const podFrame = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.6, 0.14), darkArmor);
    podFrame.position.set(-1.02, 2.98, 0.36);
    this.group.add(podFrame);

    for (const mx of [-0.18, 0, 0.18]) {
      for (const my of [-0.12, 0.12]) {
        const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.072, 0.072, 0.2, 8), this.coreMat);
        tube.rotation.x = Math.PI / 2;
        tube.position.set(-1.02 + mx, 2.98 + my, 0.42);
        this.group.add(tube);
      }
    }

    // 5. Armored cyber-skull head with glowing red optic slit & jaw grille
    this.headHitbox = registerHeadHit(new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.58, 0.58), gunmetal));
    this.headHitbox.position.set(0, 2.9, 0.14);
    this.group.add(this.headHitbox);

    const brow = registerHeadHit(new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.09, 0.16), crimsonAccent));
    brow.position.set(0, 0.17, 0.27);

    const opticSlit = registerHeadHit(new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.09, 0.1), this.coreMat));
    opticSlit.position.set(0, 0.06, 0.28);

    const jawGrille = registerHeadHit(new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.17, 0.14), darkArmor));
    jawGrille.position.set(0, -0.14, 0.26);

    const crest = registerHeadHit(new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.1, 0.54), darkArmor));
    crest.position.set(0, 0.31, -0.02);

    this.headHitbox.add(brow, opticSlit, jawGrille, crest);

    // 6. Right arm: multi-barrel rotary autocannon
    this.rightCannon = new THREE.Group();
    this.rightCannon.position.set(1.14, 2.26, 0.1);

    const armR = registerBodyHit(new THREE.Mesh(new THREE.BoxGeometry(0.38, 1.05, 0.42), darkArmor));
    armR.position.set(0, -0.35, 0.2);
    armR.rotation.x = -0.62;
    this.rightCannon.add(armR);

    const cannonShroud = registerBodyHit(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.25, 0.68, 10), gunmetal));
    cannonShroud.rotation.x = Math.PI / 2;
    cannonShroud.position.set(0, -0.58, 0.72);
    this.rightCannon.add(cannonShroud);

    // 6-barrel spinning rotary cluster
    this.rotaryBarrels = new THREE.Group();
    this.rotaryBarrels.position.set(0, -0.58, 1.32);
    for (let b = 0; b < 6; b++) {
      const ang = (b / 6) * Math.PI * 2;
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 1.08, 6), gunmetal);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(Math.cos(ang) * 0.11, Math.sin(ang) * 0.11, 0);
      this.rotaryBarrels.add(barrel);
    }
    const barrelClamp = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.1, 10), crimsonAccent);
    barrelClamp.rotation.x = Math.PI / 2;
    barrelClamp.position.set(0, 0, 0.32);
    this.rotaryBarrels.add(barrelClamp);
    this.rightCannon.add(this.rotaryBarrels);

    this.muzzleGlow = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.12, 10), this.coreMat);
    this.muzzleGlow.rotation.x = Math.PI / 2;
    this.muzzleGlow.position.set(0, -0.58, 1.86);
    this.rightCannon.add(this.muzzleGlow);
    this.group.add(this.rightCannon);

    // 7. Left arm: massive hydraulic cyber-claw
    this.leftClaw = new THREE.Group();
    this.leftClaw.position.set(-1.14, 2.26, 0.1);

    const armL = registerBodyHit(new THREE.Mesh(new THREE.BoxGeometry(0.42, 1.12, 0.44), darkArmor));
    armL.position.set(0, -0.42, 0.16);
    armL.rotation.x = -0.35;
    this.leftClaw.add(armL);

    const armLPiston = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.72, 8), gunmetal);
    armLPiston.position.set(-0.24, -0.46, 0.24);
    armLPiston.rotation.x = -0.35;
    this.leftClaw.add(armLPiston);

    const clawHousing = registerBodyHit(new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.46, 0.56), crimsonAccent));
    clawHousing.position.set(0, -0.92, 0.44);
    this.leftClaw.add(clawHousing);

    // 3 heavy hydraulic cyber-claw pincers
    for (const cx of [-0.18, 0, 0.18]) {
      const pincer = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.13, 0.52), gunmetal);
      pincer.position.set(cx, -0.96, 0.84);
      pincer.rotation.x = 0.22;
      pincer.rotation.y = cx * -0.45;
      this.leftClaw.add(pincer);
    }
    const thumbClaw = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.42), gunmetal);
    thumbClaw.position.set(0.24, -0.78, 0.72);
    thumbClaw.rotation.x = -0.25;
    thumbClaw.rotation.y = -0.35;
    this.leftClaw.add(thumbClaw);

    this.group.add(this.leftClaw);

    // Menacing crimson aura light mounted directly on scene (never toggled via group.visible -> 0 shader recompiles)
    this.auraLight = new THREE.PointLight(0xff1a48, 0, 16, 1.5);
    this.auraLight.position.set(0, -88, -70);
    this.scene.add(this.auraLight);

    this.hitMeshes = hitList;
  }

  /**
   * Weakens Rikhard Smasher's armor via Netrunner breach (up to 20% starting HP reduction)
   * and triggers visible electrical armor sparking on his chest/shoulders.
   */
  setArmorWeakened(percent: number): number {
    const applied = this.state.setArmorWeakened(percent);
    if (applied > 0) {
      this.chestPlateMat.emissive.setHex(0x00d8ff);
      this.chestPlateMat.emissiveIntensity = 0.45;
      if (this.group.visible) {
        this.spawnArmorSparks(10);
      }
    } else {
      this.chestPlateMat.emissive.setHex(0x000000);
      this.chestPlateMat.emissiveIntensity = 0;
    }
    return applied;
  }

  activateAt(x: number, y: number, z: number): void {
    this.arenaFloorY = y;
    this.state.startFight();
    this.clearEffects();
    this.group.position.set(x, y, z);
    this.auraLight.position.set(x, y + 2.35, z + 0.85);
    this.auraLight.intensity = 8.5;
    this.group.rotation.set(0, 0, 0);
    this.leftLegPivot.rotation.set(0, 0, 0);
    this.rightLegPivot.rotation.set(0, 0, 0);
    this.rightCannon.rotation.set(0, 0, 0);
    this.leftClaw.rotation.set(0, 0, 0);
    this.group.visible = true;
    this.burstTimer = 1.4;
    this.missileTimer = 3.8;
    this.dashTimer = 5.0;
    this.shockwaveTimer = 6.8;
    this.walkCycle = 0;
    this.rotarySpinSpeed = 0;
    this.sparkTimer = 0.08;
    if (this.state.armorWeakenedPercent > 0) {
      this.chestPlateMat.emissive.setHex(0x00d8ff);
      this.chestPlateMat.emissiveIntensity = 0.45;
      this.spawnArmorSparks(12);
    } else {
      this.chestPlateMat.emissive.setHex(0x000000);
      this.chestPlateMat.emissiveIntensity = 0;
    }
    this.group.updateMatrixWorld(true);
  }

  deactivate(): void {
    this.state.reset();
    this.clearEffects();
    this.chestPlateMat.emissive.setHex(0x000000);
    this.chestPlateMat.emissiveIntensity = 0;
    this.auraLight.intensity = 0;
    this.group.visible = false;
  }

  private clearEffects(): void {
    for (const p of this.projectiles) this.scene.remove(p.mesh);
    this.projectiles = [];
    for (const m of this.missiles) {
      this.scene.remove(m.ring);
      this.scene.remove(m.missile);
    }
    this.missiles = [];
    for (const sw of this.shockwaves) this.scene.remove(sw.mesh);
    this.shockwaves = [];
    for (const g of this.ghosts) this.scene.remove(g.mesh);
    this.ghosts = [];
    for (const s of this.sparks) this.scene.remove(s.mesh);
    this.sparks = [];
  }

  getPosition(): THREE.Vector3 {
    return this.group.position;
  }

  /**
   * Returns Rikhard Smasher's cyber-skull head position in world space
   * for interactive Malorian execution framing and camera targeting.
   */
  getHeadWorldPosition(): THREE.Vector3 {
    this.group.updateMatrixWorld(true);
    return this.headHitbox.getWorldPosition(new THREE.Vector3());
  }

  /**
   * Positions staggered Rikhard Smasher kneeling directly in front of the player
   * for the cinematic Bolt-1-style interactive Malorian execution cutscene.
   */
  positionForExecution(playerPos: Vec3): Vec3 {
    this.clearEffects();
    this.group.visible = true;

    let dirX = this.group.position.x - playerPos.x;
    let dirZ = this.group.position.z - playerPos.z;
    const len = Math.hypot(dirX, dirZ);
    if (len < 0.01) {
      dirX = 0;
      dirZ = -1;
    } else {
      dirX /= len;
      dirZ /= len;
    }

    const execDist = 2.35;
    const tx = playerPos.x + dirX * execDist;
    const tz = playerPos.z + dirZ * execDist;
    const ty = this.arenaFloorY - 0.58;

    this.group.position.set(tx, ty, tz);
    this.group.rotation.set(0.28, Math.atan2(playerPos.x - tx, playerPos.z - tz), 0);
    this.leftLegPivot.rotation.x = 0.72;
    this.rightLegPivot.rotation.x = -0.35;
    this.rightCannon.rotation.x = 0.45;
    this.leftClaw.rotation.x = 0.55;
    this.coreMat.color.setHex(0xfcee0a);
    this.coreMat.emissive.setHex(0xfcee0a);
    this.group.updateMatrixWorld(true);
    this.spawnArmorSparks(10);

    return { x: tx, y: ty, z: tz };
  }

  checkBulletHit(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    maxDist: number,
    baseDamage: number,
    headshotMult: number,
  ): SmasherHitResult {
    const empty: SmasherHitResult = {
      hit: false,
      headshot: false,
      damage: 0,
      enteredPhase2: false,
      enteredPhase3: false,
      enteredStaggered: false,
      point: origin.clone().addScaledVector(dir, maxDist),
    };
    if (!this.group.visible || this.state.phase === 'DORMANT' || this.state.phase === 'EXECUTED') {
      return empty;
    }

    this.raycaster.set(origin, dir);
    this.raycaster.near = 0.05;
    this.raycaster.far = maxDist;
    const hits = this.raycaster.intersectObjects(this.hitMeshes, false);
    if (hits.length === 0) return empty;

    const first = hits[0];
    const headshot = Boolean(first.object.userData?.isHead) || first.object === this.headHitbox;
    const dmg = Math.round(baseDamage * (headshot ? headshotMult : 1));
    const res = this.state.applyDamage(dmg);
    this.flashTimer = 0.1;

    return {
      hit: true,
      headshot,
      damage: res.actualDamage,
      enteredPhase2: res.enteredPhase2,
      enteredPhase3: res.enteredPhase3,
      enteredStaggered: res.enteredStaggered,
      point: first.point,
    };
  }

  applyMeleeDamage(origin: THREE.Vector3, range: number, damage: number): SmasherHitResult {
    const dist = origin.distanceTo(this.group.position.clone().add(new THREE.Vector3(0, 1.5, 0)));
    if (dist > range + 1.2 || !this.group.visible) {
      return {
        hit: false,
        headshot: false,
        damage: 0,
        enteredPhase2: false,
        enteredPhase3: false,
        enteredStaggered: false,
        point: this.group.position.clone(),
      };
    }
    const res = this.state.applyDamage(damage);
    this.flashTimer = 0.12;
    return {
      hit: true,
      headshot: false,
      damage: res.actualDamage,
      enteredPhase2: res.enteredPhase2,
      enteredPhase3: res.enteredPhase3,
      enteredStaggered: res.enteredStaggered,
      point: this.group.position.clone().add(new THREE.Vector3(0, 1.8, 0)),
    };
  }

  finishExecutionAnimation(): void {
    this.state.executeWithMalorian();
    this.clearEffects();
    this.group.rotation.x = -Math.PI / 2;
    this.group.position.y = this.arenaFloorY + 0.45;
    this.coreMat.color.setHex(0x2a0810);
    this.coreMat.emissive.setHex(0x000000);
    this.auraLight.intensity = 0.4;
    this.group.updateMatrixWorld(true);
  }

  private spawnArmorSparks(count: number): void {
    for (let i = 0; i < count; i++) {
      const color = i % 2 === 0 ? 0x00f0ff : 0xfcee0a;
      const spark = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 0.06, 0.14),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 }),
      );
      spark.position.set(
        this.group.position.x + (Math.random() - 0.5) * 1.4,
        this.group.position.y + 1.5 + Math.random() * 1.2,
        this.group.position.z + (Math.random() - 0.5) * 1.1,
      );
      const velocity = new THREE.Vector3(
        (Math.random() - 0.5) * 4.5,
        1.2 + Math.random() * 2.8,
        (Math.random() - 0.5) * 4.5,
      );
      this.scene.add(spark);
      this.sparks.push({ mesh: spark, velocity, life: 0.36 + Math.random() * 0.25, maxLife: 0.61 });
    }
  }

  private spawnAfterimage(pos: THREE.Vector3): void {
    const ghost = new THREE.Mesh(
      new THREE.BoxGeometry(1.5, 2.9, 1.0),
      new THREE.MeshBasicMaterial({
        color: 0x00f0ff,
        transparent: true,
        opacity: 0.48,
        wireframe: true,
      }),
    );
    ghost.position.set(pos.x, pos.y + 1.45, pos.z);
    this.scene.add(ghost);
    this.ghosts.push({ mesh: ghost, life: 0.48, maxLife: 0.48 });
  }

  private spawnShockwave(): void {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.0, 1.75, 28),
      new THREE.MeshBasicMaterial({
        color: 0xff003c,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.9,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(this.group.position.x, this.arenaFloorY + 0.15, this.group.position.z);
    this.scene.add(ring);
    this.shockwaves.push({ mesh: ring, radius: 1.4, maxRadius: 24, damagedPlayer: false });
  }

  update(
    dt: number,
    playerPos: Vec3,
    playerEye: Vec3,
    physics: PhysicsWorld,
    callbacks: SmasherCallbacks,
  ): void {
    if (!this.group.visible) return;

    if (this.state.phase === 'STAGGERED') {
      // Kneeling damaged animation awaiting Malorian execution!
      this.group.position.y = this.arenaFloorY - 0.58;
      this.group.rotation.x = 0.28;
      this.leftLegPivot.rotation.x = 0.72;
      this.rightLegPivot.rotation.x = -0.35;
      this.rightCannon.rotation.x = 0.45;
      this.leftClaw.rotation.x = 0.55;
      const pulseColor = Math.sin(performance.now() * 0.025) > 0 ? 0xfcee0a : 0xff003c;
      this.coreMat.color.setHex(pulseColor);
      this.coreMat.emissive.setHex(pulseColor);
      this.sparkTimer -= dt;
      if (this.sparkTimer <= 0) {
        this.sparkTimer = 0.35;
        this.spawnArmorSparks(3);
      }
      this.updateEffects(dt, playerPos, physics, callbacks);
      return;
    }

    if (this.state.phase !== 'PHASE_1' && this.state.phase !== 'PHASE_2' && this.state.phase !== 'PHASE_3') {
      return;
    }

    const p2 = this.state.phase === 'PHASE_2';
    const p3 = this.state.phase === 'PHASE_3';
    const activeCoreHex = p3 ? 0x00f0ff : 0xff003c;
    this.coreMat.color.setHex(activeCoreHex);
    this.coreMat.emissive.setHex(activeCoreHex);
    this.auraLight.color.setHex(p3 ? 0x00e5ff : 0xff1a48);
    this.auraLight.intensity = p3 ? 11.5 : 8.5;
    this.auraLight.position.set(this.group.position.x, this.group.position.y + 2.35, this.group.position.z + 0.85);

    // Continuous armor sparks if weakened by Netrunner breach
    if (this.state.armorWeakenedPercent > 0) {
      this.sparkTimer -= dt;
      if (this.sparkTimer <= 0) {
        this.sparkTimer = 0.28 + Math.random() * 0.24;
        this.spawnArmorSparks(2);
      }
      this.chestPlateMat.emissiveIntensity = 0.25 + Math.abs(Math.sin(performance.now() * 0.015)) * 0.55;
    }

    if (this.flashTimer > 0) {
      this.flashTimer = Math.max(0, this.flashTimer - dt);
      (this.bodyHitbox.material as THREE.MeshStandardMaterial).emissive.setHex(
        this.flashTimer > 0 ? 0xff2244 : 0x000000,
      );
    }

    const dx = playerPos.x - this.group.position.x;
    const dz = playerPos.z - this.group.position.z;
    const dist = Math.hypot(dx, dz);
    this.group.rotation.y = Math.atan2(dx, dz);

    // Relentless pursuit with heavy hydraulic stomp cycle
    const speed = p3 ? 6.4 : p2 ? 5.2 : 3.8;
    if (dist > 5.5) {
      const res = physics.resolveCylinderMove(
        this.group.position,
        this.group.position.x + (dx / dist) * speed * dt,
        this.group.position.z + (dz / dist) * speed * dt,
        1.1,
        this.arenaFloorY,
        3.0,
      );
      this.group.position.x = res.x;
      this.group.position.z = res.z;
      this.walkCycle += dt * speed * 1.45;
      this.leftLegPivot.rotation.x = Math.sin(this.walkCycle) * 0.34;
      this.rightLegPivot.rotation.x = -Math.sin(this.walkCycle) * 0.34;
      this.leftClaw.rotation.x = -0.15 + Math.cos(this.walkCycle) * 0.24;
    } else {
      this.leftLegPivot.rotation.x *= 0.85;
      this.rightLegPivot.rotation.x *= 0.85;
      this.leftClaw.rotation.x = -0.45 + Math.sin(performance.now() * 0.008) * 0.18;
    }

    // Spin rotary barrels when firing
    this.rotaryBarrels.rotation.z += this.rotarySpinSpeed * dt;
    this.rotarySpinSpeed = Math.max(0, this.rotarySpinSpeed - dt * 10);

    // 1. Autocannon bursts
    this.burstTimer -= dt;
    if (this.burstTimer <= 0) {
      this.burstTimer = p3 ? 0.55 : p2 ? 0.85 : 1.25;
      this.rotarySpinSpeed = 24;
      callbacks.onAutocannonShot();
      const start = this.muzzleGlow.getWorldPosition(new THREE.Vector3());
      const dir = new THREE.Vector3(
        playerEye.x - start.x + (Math.random() - 0.5) * 0.8,
        playerEye.y - 0.2 - start.y,
        playerEye.z - start.z + (Math.random() - 0.5) * 0.8,
      ).normalize();

      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.16, 6, 6),
        new THREE.MeshBasicMaterial({ color: p3 ? 0x00f0ff : 0xff4400 }),
      );
      mesh.position.copy(start);
      this.scene.add(mesh);
      this.projectiles.push({ mesh, velocity: dir.multiplyScalar(36), damage: p3 ? 16 : 13, life: 2.5 });
    }

    // 2. Telegraphed micro-missiles
    this.missileTimer -= dt;
    if (this.missileTimer <= 0) {
      this.missileTimer = p3 ? 3.2 : p2 ? 4.4 : 5.6;
      const count = p3 ? 3 : 2;
      for (let i = 0; i < count; i++) {
        const tx = playerPos.x + (Math.random() - 0.5) * 6;
        const tz = playerPos.z + (Math.random() - 0.5) * 6;
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(1.6, 2.2, 20),
          new THREE.MeshBasicMaterial({ color: 0xff003c, side: THREE.DoubleSide, transparent: true, opacity: 0.78 }),
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(tx, this.arenaFloorY + 0.08, tz);
        this.scene.add(ring);

        const missile = new THREE.Mesh(
          new THREE.ConeGeometry(0.18, 0.7, 6),
          new THREE.MeshBasicMaterial({ color: 0xfcee0a }),
        );
        const startPos = this.group.position.clone().add(new THREE.Vector3(-0.9, 3.1, 0));
        missile.position.copy(startPos);
        this.scene.add(missile);

        this.missiles.push({
          ring,
          missile,
          startPos,
          targetPos: new THREE.Vector3(tx, this.arenaFloorY + 0.1, tz),
          timer: 1.35 + i * 0.25,
          maxTimer: 1.35 + i * 0.25,
        });
      }
    }

    // 3. Phase 2 & 3 Sandevistan-Dash with cyan afterimages!
    if (p2 || p3) {
      this.dashTimer -= dt;
      if (this.dashTimer <= 0) {
        this.dashTimer = p3 ? 3.6 : 5.2;
        callbacks.onRoar();
        for (let step = 0; step < 3; step++) {
          this.spawnAfterimage(this.group.position.clone());
          const angle = Math.atan2(dx, dz) + (step - 1) * 0.45;
          const res = physics.resolveCylinderMove(
            this.group.position,
            this.group.position.x + Math.sin(angle) * 4.5,
            this.group.position.z + Math.cos(angle) * 4.5,
            1.1,
            this.arenaFloorY,
            3.0,
          );
          this.group.position.x = res.x;
          this.group.position.z = res.z;
        }
        this.spawnShockwave();
      }
    }

    // 4. Jumpable ground shockwaves
    this.shockwaveTimer -= dt;
    if (this.shockwaveTimer <= 0) {
      this.shockwaveTimer = p3 ? 4.2 : 6.4;
      this.spawnShockwave();
    }

    this.updateEffects(dt, playerPos, physics, callbacks);
  }

  private updateEffects(
    dt: number,
    playerPos: Vec3,
    physics: PhysicsWorld,
    callbacks: SmasherCallbacks,
  ): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      if (i >= this.projectiles.length) {
        i = this.projectiles.length;
        continue;
      }
      const p = this.projectiles[i];
      if (!p) continue;

      p.life -= dt;
      const next = p.mesh.position.clone().addScaledVector(p.velocity, dt);
      const wall = physics.raycastBullets(p.mesh.position, p.velocity.clone().normalize(), p.mesh.position.distanceTo(next));
      const hitP =
        Math.hypot(next.x - playerPos.x, next.z - playerPos.z) < 0.78 &&
        next.y >= playerPos.y &&
        next.y <= playerPos.y + 2.0;

      if (hitP) {
        const dmg = p.damage;
        this.scene.remove(p.mesh);
        this.projectiles.splice(i, 1);
        callbacks.onPlayerDamaged(dmg, 0.14);
      } else if (wall.hit || p.life <= 0) {
        this.scene.remove(p.mesh);
        this.projectiles.splice(i, 1);
      } else {
        p.mesh.position.copy(next);
      }
    }

    for (let i = this.missiles.length - 1; i >= 0; i--) {
      if (i >= this.missiles.length) {
        i = this.missiles.length;
        continue;
      }
      const m = this.missiles[i];
      if (!m) continue;

      m.timer -= dt;
      const t = 1 - Math.max(0, m.timer / m.maxTimer);
      m.missile.position.lerpVectors(m.startPos, m.targetPos, t);
      m.missile.position.y += Math.sin(t * Math.PI) * 6.5;

      if (m.timer <= 0) {
        const hitDist = Math.hypot(playerPos.x - m.targetPos.x, playerPos.z - m.targetPos.z);
        this.scene.remove(m.ring);
        this.scene.remove(m.missile);
        this.missiles.splice(i, 1);
        callbacks.onMissileExplode();
        if (hitDist < 3.4) {
          callbacks.onPlayerDamaged(24, 0.28);
        }
      }
    }

    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      if (i >= this.shockwaves.length) {
        i = this.shockwaves.length;
        continue;
      }
      const sw = this.shockwaves[i];
      if (!sw) continue;

      const prevR = sw.radius;
      sw.radius += dt * 13.5;
      sw.mesh.scale.setScalar(sw.radius / 1.4);
      (sw.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - sw.radius / sw.maxRadius);

      let hitShockwave = false;
      if (!sw.damagedPlayer) {
        const d = Math.hypot(playerPos.x - sw.mesh.position.x, playerPos.z - sw.mesh.position.z);
        const groundedNear = playerPos.y - this.arenaFloorY < 0.95;
        if (d >= prevR - 0.8 && d <= sw.radius + 0.8 && groundedNear) {
          sw.damagedPlayer = true;
          hitShockwave = true;
        }
      }

      if (sw.radius >= sw.maxRadius) {
        this.scene.remove(sw.mesh);
        this.shockwaves.splice(i, 1);
      }

      if (hitShockwave) {
        callbacks.onPlayerDamaged(18, 0.22);
      }
    }

    for (let i = this.ghosts.length - 1; i >= 0; i--) {
      const g = this.ghosts[i];
      g.life -= dt;
      (g.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, (g.life / g.maxLife) * 0.48);
      if (g.life <= 0) {
        this.scene.remove(g.mesh);
        this.ghosts.splice(i, 1);
      }
    }

    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.life -= dt;
      s.velocity.y -= 9.8 * dt;
      s.mesh.position.addScaledVector(s.velocity, dt);
      (s.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, s.life / s.maxLife);
      if (s.life <= 0) {
        this.scene.remove(s.mesh);
        this.sparks.splice(i, 1);
      }
    }
  }
}

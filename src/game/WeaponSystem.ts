import * as THREE from 'three';
import type { WeaponId } from '../types/game';

export interface WeaponSpec {
  id: WeaponId;
  slot: number;
  name: string;
  shortName: string;
  isMelee: boolean;
  automatic: boolean;
  magSize: number;
  fireInterval: number;
  reloadDuration: number;
  damage: number;
  headshotMult: number;
  pellets: number;
  spreadRad: number;
  range: number;
  recoilPitch: number;
  accentHex: number;
}

export const WEAPON_SPECS: Record<WeaponId, WeaponSpec> = {
  mantis_blades: {
    id: 'mantis_blades',
    slot: 1,
    name: 'КЛИНКИ БОГОМОЛА',
    shortName: 'БОГОМОЛ',
    isMelee: true,
    automatic: false,
    magSize: 0,
    fireInterval: 0.28,
    reloadDuration: 0,
    damage: 72,
    headshotMult: 1.5,
    pellets: 1,
    spreadRad: 0,
    range: 4.4,
    recoilPitch: 0.02,
    accentHex: 0x00f0ff,
  },
  alatau_pistol: {
    id: 'alatau_pistol',
    slot: 2,
    name: 'АЛАТАУ-19',
    shortName: 'АЛАТАУ-19',
    isMelee: false,
    automatic: false,
    magSize: 12,
    fireInterval: 0.22,
    reloadDuration: 1.1,
    damage: 34,
    headshotMult: 2.0,
    pellets: 1,
    spreadRad: 0.008,
    range: 110,
    recoilPitch: 0.032,
    accentHex: 0xfcee0a,
  },
  steppe_smg: {
    id: 'steppe_smg',
    slot: 3,
    name: 'СТЕПЬ-9 ПП',
    shortName: 'СТЕПЬ-9',
    isMelee: false,
    automatic: true,
    magSize: 32,
    fireInterval: 0.085,
    reloadDuration: 1.45,
    damage: 20,
    headshotMult: 1.75,
    pellets: 1,
    spreadRad: 0.024,
    range: 85,
    recoilPitch: 0.017,
    accentHex: 0x00ffaa,
  },
  buran_shotgun: {
    id: 'buran_shotgun',
    slot: 4,
    name: 'БУРАН-12',
    shortName: 'БУРАН-12',
    isMelee: false,
    automatic: false,
    magSize: 6,
    fireInterval: 0.68,
    reloadDuration: 1.8,
    damage: 22,
    headshotMult: 1.5,
    pellets: 7,
    spreadRad: 0.068,
    range: 42,
    recoilPitch: 0.085,
    accentHex: 0xff6600,
  },
  malorian: {
    id: 'malorian',
    slot: 5,
    name: 'MALORIAN S-3516',
    shortName: 'MALORIAN',
    isMelee: false,
    automatic: false,
    magSize: 8,
    fireInterval: 0.26,
    reloadDuration: 1.32,
    damage: 58,
    headshotMult: 2.35,
    pellets: 1,
    spreadRad: 0.005,
    range: 135,
    recoilPitch: 0.056,
    accentHex: 0xff003c,
  },
};

export const WEAPON_ORDER: WeaponId[] = [
  'mantis_blades',
  'alatau_pistol',
  'steppe_smg',
  'buran_shotgun',
  'malorian',
];

/**
 * Pure multi-weapon arsenal state for Bolt 2 (unit-testable without Three.js).
 */
export class ArsenalState {
  activeWeapon: WeaponId = 'alatau_pistol';
  unlocked = new Set<WeaponId>(['mantis_blades', 'alatau_pistol']);
  ammoByWeapon: Record<WeaponId, number> = {
    mantis_blades: 0,
    alatau_pistol: 12,
    steppe_smg: 32,
    buran_shotgun: 6,
    malorian: 8,
  };

  fireCooldown = 0;
  meleeCooldown = 0;
  lungeCooldown = 0;
  reloading = false;
  reloadTimer = 0;
  comboIndex = 0;

  reset(unlockedList: WeaponId[] = ['mantis_blades', 'alatau_pistol'], active: WeaponId = 'alatau_pistol'): void {
    this.unlocked = new Set(unlockedList);
    this.activeWeapon = this.unlocked.has(active) ? active : unlockedList[0];
    for (const id of WEAPON_ORDER) {
      this.ammoByWeapon[id] = WEAPON_SPECS[id].magSize;
    }
    this.fireCooldown = 0;
    this.meleeCooldown = 0;
    this.lungeCooldown = 0;
    this.reloading = false;
    this.reloadTimer = 0;
    this.comboIndex = 0;
  }

  unlockWeapon(id: WeaponId, autoEquip = false): boolean {
    const added = !this.unlocked.has(id);
    this.unlocked.add(id);
    this.ammoByWeapon[id] = WEAPON_SPECS[id].magSize;
    if (autoEquip) {
      this.equip(id);
    }
    return added;
  }

  equip(id: WeaponId): boolean {
    if (!this.unlocked.has(id) || this.activeWeapon === id) return false;
    this.activeWeapon = id;
    this.reloading = false;
    this.reloadTimer = 0;
    this.fireCooldown = Math.min(this.fireCooldown, 0.1);
    return true;
  }

  equipBySlot(slot: number): boolean {
    const found = WEAPON_ORDER.find((id) => WEAPON_SPECS[id].slot === slot);
    return found ? this.equip(found) : false;
  }

  cycle(delta: number): boolean {
    const owned = WEAPON_ORDER.filter((id) => this.unlocked.has(id));
    if (owned.length <= 1) return false;
    const idx = owned.indexOf(this.activeWeapon);
    const nextIdx = (idx + (delta > 0 ? 1 : -1) + owned.length) % owned.length;
    return this.equip(owned[nextIdx]);
  }

  getSpec(): WeaponSpec {
    return WEAPON_SPECS[this.activeWeapon];
  }

  getAmmo(): number {
    return this.ammoByWeapon[this.activeWeapon];
  }

  tryFire(): { fired: boolean; needReload: boolean; comboStep: number } {
    const spec = this.getSpec();
    if (this.fireCooldown > 0 || this.reloading) {
      return { fired: false, needReload: false, comboStep: this.comboIndex };
    }

    if (spec.isMelee) {
      this.fireCooldown = spec.fireInterval;
      const step = this.comboIndex;
      this.comboIndex = (this.comboIndex + 1) % 3;
      return { fired: true, needReload: false, comboStep: step };
    }

    const ammo = this.ammoByWeapon[this.activeWeapon];
    if (ammo <= 0) {
      this.startReload();
      return { fired: false, needReload: true, comboStep: 0 };
    }

    this.ammoByWeapon[this.activeWeapon] = ammo - 1;
    this.fireCooldown = spec.fireInterval;
    return { fired: true, needReload: false, comboStep: 0 };
  }

  tryMantisLunge(): boolean {
    if (this.activeWeapon !== 'mantis_blades' || this.lungeCooldown > 0) return false;
    this.lungeCooldown = 1.6;
    this.fireCooldown = 0.32;
    return true;
  }

  tryFlameOrQuickMelee(): boolean {
    if (this.meleeCooldown > 0) return false;
    this.meleeCooldown = 1.25;
    return true;
  }

  startReload(): boolean {
    const spec = this.getSpec();
    if (spec.isMelee || this.reloading) return false;
    if (this.ammoByWeapon[this.activeWeapon] >= spec.magSize) return false;
    this.reloading = true;
    this.reloadTimer = spec.reloadDuration;
    return true;
  }

  update(dt: number): { reloadCompleted: boolean } {
    let reloadCompleted = false;
    if (this.fireCooldown > 0) this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    if (this.meleeCooldown > 0) this.meleeCooldown = Math.max(0, this.meleeCooldown - dt);
    if (this.lungeCooldown > 0) this.lungeCooldown = Math.max(0, this.lungeCooldown - dt);

    if (this.reloading) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) {
        this.reloading = false;
        this.reloadTimer = 0;
        this.ammoByWeapon[this.activeWeapon] = this.getSpec().magSize;
        reloadCompleted = true;
      }
    }
    return { reloadCompleted };
  }
}

interface Tracer {
  line: THREE.Mesh;
  life: number;
  maxLife: number;
}

interface FlameBurst {
  group: THREE.Group;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
}

/**
 * 3D First-Person Viewmodel System:
 * Includes Bolt 1's signature Malorian S-3516 + dual glowing Mantis Blades + Alatau-19 + Steppe-9 SMG + Buran-12 Shotgun.
 */
export class WeaponSystem {
  readonly state = new ArsenalState();
  readonly viewModel = new THREE.Group();

  private gunPivot = new THREE.Group();
  private weaponMeshes: Record<WeaponId, THREE.Group>;
  private mantisLeft!: THREE.Group;
  private mantisRight!: THREE.Group;
  private ammoStripMat!: THREE.MeshStandardMaterial;
  private muzzleLight!: THREE.PointLight;
  private muzzleFlashMesh!: THREE.Mesh;
  private muzzleFlashTimer = 0;
  private recoilKick = 0;
  private recoilPitch = 0;
  private swayTime = 0;
  private spinTimer = 0;
  private slashAnimTimer = 0;
  private slashComboStep = 0;
  private flameMeleeTimer = 0;

  private tracers: Tracer[] = [];
  private flames: FlameBurst[] = [];
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;

  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.scene = scene;
    this.camera = camera;

    this.viewModel.position.set(0.24, -0.22, -0.44);
    this.viewModel.add(this.gunPivot);

    this.ammoStripMat = new THREE.MeshStandardMaterial({
      color: 0x00f0ff,
      emissive: 0x00f0ff,
      emissiveIntensity: 2.0,
    });

    this.weaponMeshes = {
      mantis_blades: this.buildMantisBladesMesh(),
      alatau_pistol: this.buildAlatauPistolMesh(),
      steppe_smg: this.buildSteppeSmgMesh(),
      buran_shotgun: this.buildBuranShotgunMesh(),
      malorian: this.buildMalorianMesh(),
    };

    for (const id of WEAPON_ORDER) {
      this.gunPivot.add(this.weaponMeshes[id]);
    }

    // Muzzle flash light mounted directly on camera so toggling viewModel.visible never recompiles shaders
    this.muzzleLight = new THREE.PointLight(0xffaa33, 0, 7);
    this.muzzleLight.position.set(0.22, -0.15, -0.92);
    this.camera.add(this.muzzleLight);

    this.muzzleFlashMesh = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.085, 0),
      new THREE.MeshBasicMaterial({
        color: 0xffee88,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
    );
    this.muzzleFlashMesh.position.set(0, 0.05, -0.48);
    this.gunPivot.add(this.muzzleFlashMesh);

    this.camera.add(this.viewModel);
    this.syncActiveWeaponMesh();
  }

  private buildMantisBladesMesh(): THREE.Group {
    const group = new THREE.Group();
    const chromeMat = new THREE.MeshStandardMaterial({ color: 0xb6c4db, metalness: 0.92, roughness: 0.16 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x181f2c, metalness: 0.7, roughness: 0.35 });
    const edgeMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff });

    const makeBlade = (side: -1 | 1): THREE.Group => {
      const arm = new THREE.Group();
      arm.position.set(side === -1 ? -0.52 : 0.04, -0.02, 0.05);
      const housing = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.08, 0.28), darkMat);
      housing.position.set(0, -0.04, 0.08);
      arm.add(housing);

      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.065, 0.54), chromeMat);
      blade.position.set(0, 0.01, -0.26);
      arm.add(blade);

      const edge = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.014, 0.56), edgeMat);
      edge.position.set(0, 0.045, -0.26);
      arm.add(edge);

      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.036, 0.14, 4), edgeMat);
      tip.rotation.x = -Math.PI / 2;
      tip.position.set(0, 0.01, -0.58);
      arm.add(tip);

      return arm;
    };

    this.mantisLeft = makeBlade(-1);
    this.mantisRight = makeBlade(1);
    group.add(this.mantisLeft, this.mantisRight);
    return group;
  }

  private buildAlatauPistolMesh(): THREE.Group {
    const g = new THREE.Group();
    const dark = new THREE.MeshStandardMaterial({ color: 0x1b2232, metalness: 0.75, roughness: 0.3 });
    const accent = new THREE.MeshBasicMaterial({ color: 0xfcee0a });

    const slide = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.065, 0.28), dark);
    slide.position.set(0, 0.03, -0.08);
    g.add(slide);

    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.15, 0.075), dark);
    grip.position.set(0, -0.06, 0.02);
    grip.rotation.x = 0.22;
    g.add(grip);

    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.012, 0.22), accent);
    rail.position.set(0, 0.05, -0.08);
    g.add(rail);
    return g;
  }

  private buildSteppeSmgMesh(): THREE.Group {
    const g = new THREE.Group();
    const dark = new THREE.MeshStandardMaterial({ color: 0x141b28, metalness: 0.78, roughness: 0.28 });
    const accent = new THREE.MeshBasicMaterial({ color: 0x00ffaa });

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.095, 0.42), dark);
    body.position.set(0, 0.03, -0.14);
    g.add(body);

    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.19, 0.055), dark);
    mag.position.set(0, -0.09, -0.14);
    mag.rotation.x = -0.15;
    g.add(mag);

    const holoSight = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.045, 0.09), accent);
    holoSight.position.set(0, 0.095, -0.08);
    g.add(holoSight);
    return g;
  }

  private buildBuranShotgunMesh(): THREE.Group {
    const g = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({ color: 0x262b36, metalness: 0.85, roughness: 0.25 });
    const orange = new THREE.MeshBasicMaterial({ color: 0xff6600 });

    const barrel1 = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.56, 8), metal);
    barrel1.rotation.x = Math.PI / 2;
    barrel1.position.set(-0.024, 0.05, -0.22);
    g.add(barrel1);

    const barrel2 = barrel1.clone();
    barrel2.position.x = 0.024;
    g.add(barrel2);

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.34), metal);
    body.position.set(0, 0.01, -0.02);
    g.add(body);

    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.018, 0.26), orange);
    strip.position.set(0, 0.04, -0.1);
    g.add(strip);
    return g;
  }

  /**
   * Iconic Malorian S-3516 faithfully transferred from Bolt 1!
   */
  private buildMalorianMesh(): THREE.Group {
    const g = new THREE.Group();
    const gunmetal = new THREE.MeshStandardMaterial({ color: 0x262d3d, metalness: 0.88, roughness: 0.22 });
    const chrome = new THREE.MeshStandardMaterial({ color: 0xc2d0e6, metalness: 0.94, roughness: 0.14 });
    const gripMat = new THREE.MeshStandardMaterial({ color: 0x141720, roughness: 0.85, metalness: 0.15 });

    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.058, 0.075, 0.42), gunmetal);
    barrel.position.set(0, 0.045, -0.17);
    g.add(barrel);

    const upperChrome = new THREE.Mesh(new THREE.BoxGeometry(0.046, 0.022, 0.38), chrome);
    upperChrome.position.set(0, 0.088, -0.16);
    g.add(upperChrome);

    const underLug = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.04, 0.26), chrome);
    underLug.position.set(0, -0.005, -0.19);
    g.add(underLug);

    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.17, 0.085), gripMat);
    grip.position.set(0, -0.075, 0.04);
    grip.rotation.x = 0.24;
    g.add(grip);

    const ammoStrip = new THREE.Mesh(new THREE.BoxGeometry(0.062, 0.014, 0.24), this.ammoStripMat);
    ammoStrip.position.set(0, 0.052, -0.15);
    g.add(ammoStrip);

    const sight = new THREE.Mesh(
      new THREE.BoxGeometry(0.014, 0.018, 0.02),
      new THREE.MeshBasicMaterial({ color: 0xff003c }),
    );
    sight.position.set(0, 0.105, -0.35);
    g.add(sight);

    return g;
  }

  syncActiveWeaponMesh(): void {
    for (const id of WEAPON_ORDER) {
      this.weaponMeshes[id].visible = id === this.state.activeWeapon;
    }
  }

  setVisible(visible: boolean): void {
    this.viewModel.visible = visible;
  }

  triggerSpin(): void {
    this.spinTimer = 1.05;
  }

  triggerMantisSlashVisual(comboStep: number): void {
    this.slashAnimTimer = 0.26;
    this.slashComboStep = comboStep;
    this.recoilKick = -0.12;
  }

  triggerShotVisual(): void {
    const spec = this.state.getSpec();
    this.recoilKick = 0.065 + spec.recoilPitch * 0.9;
    this.recoilPitch = 0.14 + spec.recoilPitch * 2.2;
    this.muzzleFlashTimer = 0.05;
    this.muzzleLight.intensity = 6.5;
    (this.muzzleFlashMesh.material as THREE.MeshBasicMaterial).opacity = 1;
    this.muzzleFlashMesh.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
  }

  getMuzzleWorldPosition(): THREE.Vector3 {
    const p = new THREE.Vector3(0, 0.05, -0.5);
    this.gunPivot.localToWorld(p);
    return p;
  }

  spawnTracer(start: THREE.Vector3, end: THREE.Vector3, colorHex = 0xffee77): void {
    const dir = new THREE.Vector3().subVectors(end, start);
    const len = Math.max(0.2, dir.length());
    const geo = new THREE.CylinderGeometry(0.013, 0.013, len, 5);
    geo.rotateX(Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(start).addScaledVector(dir, 0.5);
    mesh.lookAt(end);
    this.scene.add(mesh);
    this.tracers.push({ line: mesh, life: 0.075, maxLife: 0.075 });
  }

  triggerFlameMeleeVisual(origin: THREE.Vector3, forward: THREE.Vector3): void {
    this.flameMeleeTimer = 0.4;
    this.recoilKick = -0.14;

    const group = new THREE.Group();
    const colors = [0xff4400, 0xff9900, 0xffee55];
    for (let i = 0; i < 9; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: colors[i % colors.length],
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
      });
      const orb = new THREE.Mesh(new THREE.DodecahedronGeometry(0.18 + (i % 3) * 0.09, 0), mat);
      orb.position.set((Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.35, (Math.random() - 0.5) * 0.5);
      group.add(orb);
    }
    group.position.copy(origin).addScaledVector(forward, 0.85);
    this.scene.add(group);
    this.flames.push({ group, velocity: forward.clone().multiplyScalar(13), life: 0.32, maxLife: 0.32 });
  }

  update(dt: number, isMoving: boolean, aimBlend = 0): { reloadCompleted: boolean } {
    const res = this.state.update(dt);
    this.syncActiveWeaponMesh();

    // Malorian glow bar
    if (this.state.reloading) {
      this.ammoStripMat.color.setHex(0xfcee0a);
      this.ammoStripMat.emissive.setHex(0xfcee0a);
    } else if (this.state.ammoByWeapon.malorian <= 2) {
      this.ammoStripMat.color.setHex(0xff003c);
      this.ammoStripMat.emissive.setHex(0xff003c);
    } else {
      this.ammoStripMat.color.setHex(0x00f0ff);
      this.ammoStripMat.emissive.setHex(0x00f0ff);
    }

    if (this.muzzleFlashTimer > 0) {
      this.muzzleFlashTimer = Math.max(0, this.muzzleFlashTimer - dt);
      const t = this.muzzleFlashTimer / 0.05;
      this.muzzleLight.intensity = 6.5 * t;
      (this.muzzleFlashMesh.material as THREE.MeshBasicMaterial).opacity = t;
    } else {
      this.muzzleLight.intensity = 0;
      (this.muzzleFlashMesh.material as THREE.MeshBasicMaterial).opacity = 0;
    }

    this.recoilKick += (0 - this.recoilKick) * Math.min(1, dt * 15);
    this.recoilPitch += (0 - this.recoilPitch) * Math.min(1, dt * 13);

    const isMelee = this.state.getSpec().isMelee;
    const effectiveAim = isMelee || this.state.reloading || this.flameMeleeTimer > 0 ? 0 : aimBlend;

    this.viewModel.position.set(
      THREE.MathUtils.lerp(0.24, 0.0, effectiveAim),
      THREE.MathUtils.lerp(-0.22, -0.096, effectiveAim),
      THREE.MathUtils.lerp(-0.44, -0.32, effectiveAim),
    );

    const swayScale = THREE.MathUtils.lerp(1.0, 0.22, effectiveAim);
    this.swayTime += dt * (isMoving ? 9.5 : 2.2);
    const swayX = Math.cos(this.swayTime) * (isMoving ? 0.012 : 0.0025) * swayScale;
    const swayY = Math.abs(Math.sin(this.swayTime)) * (isMoving ? 0.012 : 0.002) * swayScale;

    if (this.spinTimer > 0) this.spinTimer = Math.max(0, this.spinTimer - dt);
    if (this.slashAnimTimer > 0) this.slashAnimTimer = Math.max(0, this.slashAnimTimer - dt);
    if (this.flameMeleeTimer > 0) this.flameMeleeTimer = Math.max(0, this.flameMeleeTimer - dt);

    let rotX = this.recoilPitch;
    let rotY = 0;
    let rotZ = 0;
    let offsetY = 0;
    let offsetZ = this.recoilKick;

    if (this.spinTimer > 0) {
      const p = 1 - this.spinTimer / 1.05;
      rotX += Math.PI * 2 * (1 - Math.pow(1 - p, 2));
      offsetY += Math.sin(p * Math.PI) * 0.08;
    } else if (this.flameMeleeTimer > 0) {
      const p = 1 - this.flameMeleeTimer / 0.4;
      const swing = Math.sin(p * Math.PI);
      rotY += swing * 0.72;
      rotZ -= swing * 0.45;
      offsetZ -= swing * 0.18;
    } else if (this.state.reloading) {
      const p = 1 - this.state.reloadTimer / Math.max(0.1, this.state.getSpec().reloadDuration);
      rotX += Math.sin(p * Math.PI) * -0.95;
      rotZ += Math.sin(p * Math.PI * 2) * 0.45;
      offsetY -= Math.sin(p * Math.PI) * 0.14;
    }

    // Dual Mantis Blades slash animation
    if (this.slashAnimTimer > 0) {
      const p = 1 - this.slashAnimTimer / 0.26;
      const swing = Math.sin(p * Math.PI);
      if (this.slashComboStep === 0) {
        this.mantisRight.rotation.set(-swing * 0.65, swing * 0.9, -swing * 0.5);
        this.mantisRight.position.z = 0.05 - swing * 0.22;
        this.mantisLeft.rotation.set(0, 0, 0);
      } else if (this.slashComboStep === 1) {
        this.mantisLeft.rotation.set(-swing * 0.65, -swing * 0.9, swing * 0.5);
        this.mantisLeft.position.z = 0.05 - swing * 0.22;
        this.mantisRight.rotation.set(0, 0, 0);
      } else {
        // Cross X-slash!
        this.mantisLeft.rotation.set(-swing * 0.8, -swing * 0.85, swing * 0.65);
        this.mantisRight.rotation.set(-swing * 0.8, swing * 0.85, -swing * 0.65);
        this.mantisLeft.position.z = 0.05 - swing * 0.28;
        this.mantisRight.position.z = 0.05 - swing * 0.28;
      }
    } else {
      this.mantisLeft.rotation.set(0, 0, 0);
      this.mantisRight.rotation.set(0, 0, 0);
      this.mantisLeft.position.z = 0.05;
      this.mantisRight.position.z = 0.05;
    }

    this.gunPivot.position.set(swayX, -swayY + offsetY, offsetZ);
    this.gunPivot.rotation.set(rotX, rotY, rotZ);

    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tr = this.tracers[i];
      tr.life -= dt;
      if (tr.life <= 0) {
        this.scene.remove(tr.line);
        tr.line.geometry.dispose();
        (tr.line.material as THREE.Material).dispose();
        this.tracers.splice(i, 1);
      } else {
        (tr.line.material as THREE.MeshBasicMaterial).opacity = tr.life / tr.maxLife;
      }
    }

    for (let i = this.flames.length - 1; i >= 0; i--) {
      const fl = this.flames[i];
      fl.life -= dt;
      fl.group.position.addScaledVector(fl.velocity, dt);
      fl.group.scale.addScalar(dt * 3.8);
      if (fl.life <= 0) {
        this.scene.remove(fl.group);
        this.flames.splice(i, 1);
      }
    }

    return res;
  }

  dispose(): void {
    this.camera.remove(this.viewModel);
  }
}

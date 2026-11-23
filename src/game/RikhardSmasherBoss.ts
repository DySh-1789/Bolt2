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

  reset(): void {
    this.hp = this.maxHp;
    this.phase = 'DORMANT';
  }

  getHpRatio(): number {
    return this.hp / this.maxHp;
  }

  startFight(): void {
    this.hp = this.maxHp;
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
 * 3-meter Cyborg Boss — Rikhard Smasher (borrowed & enhanced from Bolt 1!).
 */
export class RikhardSmasherBoss {
  readonly state = new RikhardSmasherState();
  readonly group = new THREE.Group();

  private bodyHitbox!: THREE.Mesh;
  private headHitbox!: THREE.Mesh;
  private rightCannon!: THREE.Group;
  private leftClaw!: THREE.Group;
  private visorMat!: THREE.MeshBasicMaterial;

  private projectiles: BossProjectile[] = [];
  private missiles: TelegraphMissile[] = [];
  private shockwaves: ShockwaveRing[] = [];
  private ghosts: AfterimageGhost[] = [];

  private scene: THREE.Scene;
  private raycaster = new THREE.Raycaster();
  private arenaFloorY = -90;
  private burstTimer = 1.6;
  private missileTimer = 4.2;
  private dashTimer = 5.5;
  private shockwaveTimer = 7.0;
  private flashTimer = 0;

  constructor(scene: THREE.Scene, arenaFloorY: number) {
    this.scene = scene;
    this.arenaFloorY = arenaFloorY;
    this.buildModel();
    this.group.visible = false;
    scene.add(this.group);
  }

  private buildModel(): void {
    const obsidian = new THREE.MeshStandardMaterial({ color: 0x141722, metalness: 0.88, roughness: 0.24 });
    const chrome = new THREE.MeshStandardMaterial({ color: 0x627394, metalness: 0.92, roughness: 0.18 });
    this.visorMat = new THREE.MeshBasicMaterial({ color: 0xff003c });

    // Massive armored cyber-legs (3m tall!)
    for (const sx of [-0.52, 0.52]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.55, 1.35, 0.62), obsidian);
      leg.position.set(sx, 0.68, 0);
      this.group.add(leg);
      const knee = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.24, 0.68), chrome);
      knee.position.set(sx, 0.85, 0.05);
      this.group.add(knee);
    }

    // Hulking exo-torso
    this.bodyHitbox = new THREE.Mesh(new THREE.BoxGeometry(1.65, 1.38, 1.05), obsidian);
    this.bodyHitbox.position.set(0, 1.98, 0);
    this.group.add(this.bodyHitbox);

    // Shoulder pauldrons & missile pod
    for (const sx of [-1.05, 1.05]) {
      const pauldron = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.65, 0.95), chrome);
      pauldron.position.set(sx, 2.52, 0);
      this.group.add(pauldron);
    }

    const pod = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.45, 0.65), obsidian);
    pod.position.set(-1.12, 2.95, -0.1);
    this.group.add(pod);

    const reactor = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.16, 12), this.visorMat);
    reactor.rotation.x = Math.PI / 2;
    reactor.position.set(0, 2.08, 0.52);
    this.group.add(reactor);

    // Cyber-skull head
    this.headHitbox = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.54, 0.54), chrome);
    this.headHitbox.position.set(0, 2.92, 0.08);
    this.group.add(this.headHitbox);

    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.14, 0.12), this.visorMat);
    visor.position.set(0, 2.94, 0.36);
    this.group.add(visor);

    // Right arm heavy autocannon
    this.rightCannon = new THREE.Group();
    this.rightCannon.position.set(1.18, 2.05, 0.2);
    const armR = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.95, 0.38), obsidian);
    armR.position.y = -0.35;
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 1.35, 10), chrome);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, -0.55, 0.65);
    this.rightCannon.add(armR, barrel);
    this.group.add(this.rightCannon);

    // Left arm hydraulic claw
    this.leftClaw = new THREE.Group();
    this.leftClaw.position.set(-1.18, 2.05, 0.2);
    const armL = new THREE.Mesh(new THREE.BoxGeometry(0.42, 1.05, 0.42), obsidian);
    armL.position.y = -0.4;
    this.leftClaw.add(armL);
    this.group.add(this.leftClaw);

    const auraLight = new THREE.PointLight(0xff003c, 4.5, 16);
    auraLight.position.set(0, 2.5, 0.8);
    this.group.add(auraLight);
  }

  activateAt(x: number, y: number, z: number): void {
    this.arenaFloorY = y;
    this.state.startFight();
    this.clearEffects();
    this.group.position.set(x, y, z);
    this.group.rotation.set(0, 0, 0);
    this.group.visible = true;
    this.burstTimer = 1.4;
    this.missileTimer = 3.8;
    this.dashTimer = 5.0;
    this.shockwaveTimer = 6.8;
  }

  deactivate(): void {
    this.state.reset();
    this.clearEffects();
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
  }

  getPosition(): THREE.Vector3 {
    return this.group.position;
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
    const hits = this.raycaster.intersectObjects([this.headHitbox, this.bodyHitbox], false);
    if (hits.length === 0) return empty;

    const first = hits[0];
    const headshot = first.object === this.headHitbox;
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
      this.group.position.y = this.arenaFloorY - 0.55;
      this.group.rotation.x = 0.25;
      this.visorMat.color.setHex(Math.sin(performance.now() * 0.025) > 0 ? 0xfcee0a : 0xff003c);
      this.updateEffects(dt, playerPos, physics, callbacks);
      return;
    }

    if (this.state.phase !== 'PHASE_1' && this.state.phase !== 'PHASE_2' && this.state.phase !== 'PHASE_3') {
      return;
    }

    const p2 = this.state.phase === 'PHASE_2';
    const p3 = this.state.phase === 'PHASE_3';
    this.visorMat.color.setHex(p3 ? 0x00f0ff : 0xff003c);

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

    // Relentless pursuit
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
    }

    // 1. Autocannon bursts
    this.burstTimer -= dt;
    if (this.burstTimer <= 0) {
      this.burstTimer = p3 ? 0.55 : p2 ? 0.85 : 1.25;
      callbacks.onAutocannonShot();
      const start = this.group.position.clone().add(new THREE.Vector3(0, 2.0, 0));
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
        const startPos = this.group.position.clone().add(new THREE.Vector3(0, 3.1, 0));
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
      const p = this.projectiles[i];
      p.life -= dt;
      const next = p.mesh.position.clone().addScaledVector(p.velocity, dt);
      const wall = physics.raycastBullets(p.mesh.position, p.velocity.clone().normalize(), p.mesh.position.distanceTo(next));
      const hitP =
        Math.hypot(next.x - playerPos.x, next.z - playerPos.z) < 0.78 &&
        next.y >= playerPos.y &&
        next.y <= playerPos.y + 2.0;

      if (hitP) {
        callbacks.onPlayerDamaged(p.damage, 0.14);
        this.scene.remove(p.mesh);
        this.projectiles.splice(i, 1);
      } else if (wall.hit || p.life <= 0) {
        this.scene.remove(p.mesh);
        this.projectiles.splice(i, 1);
      } else {
        p.mesh.position.copy(next);
      }
    }

    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i];
      m.timer -= dt;
      const t = 1 - Math.max(0, m.timer / m.maxTimer);
      m.missile.position.lerpVectors(m.startPos, m.targetPos, t);
      m.missile.position.y += Math.sin(t * Math.PI) * 6.5;

      if (m.timer <= 0) {
        callbacks.onMissileExplode();
        if (Math.hypot(playerPos.x - m.targetPos.x, playerPos.z - m.targetPos.z) < 3.4) {
          callbacks.onPlayerDamaged(24, 0.28);
        }
        this.scene.remove(m.ring);
        this.scene.remove(m.missile);
        this.missiles.splice(i, 1);
      }
    }

    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const sw = this.shockwaves[i];
      const prevR = sw.radius;
      sw.radius += dt * 13.5;
      sw.mesh.scale.setScalar(sw.radius / 1.4);
      (sw.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - sw.radius / sw.maxRadius);

      if (!sw.damagedPlayer) {
        const d = Math.hypot(playerPos.x - sw.mesh.position.x, playerPos.z - sw.mesh.position.z);
        const groundedNear = playerPos.y - this.arenaFloorY < 0.95;
        if (d >= prevR - 0.8 && d <= sw.radius + 0.8 && groundedNear) {
          sw.damagedPlayer = true;
          callbacks.onPlayerDamaged(18, 0.22);
        }
      }

      if (sw.radius >= sw.maxRadius) {
        this.scene.remove(sw.mesh);
        this.shockwaves.splice(i, 1);
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
  }
}

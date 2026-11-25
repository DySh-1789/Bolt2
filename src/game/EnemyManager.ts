import * as THREE from 'three';
import type { EnemyArchetype, Vec3 } from '../types/game';
import type { PhysicsWorld } from '../engine/Physics';

export interface EnemySpawnConfig {
  id: string;
  archetype: EnemyArchetype;
  zoneId: string;
  x: number;
  y: number;
  z: number;
  hp?: number;
  rewardTenge?: number;
}

export interface EnemyInstance {
  id: string;
  archetype: EnemyArchetype;
  zoneId: string;
  hp: number;
  maxHp: number;
  rewardTenge: number;
  alive: boolean;
  position: THREE.Vector3;
  baseY: number;
  group: THREE.Group;
  bodyHitbox: THREE.Mesh;
  headHitbox: THREE.Mesh;
  shootCooldown: number;
  strafeDir: number;
  strafeTimer: number;
  flashTimer: number;
  deathTimer: number;
}

export interface EnemyHitResult {
  hit: boolean;
  enemyId: string | null;
  archetype: EnemyArchetype | null;
  zoneId: string | null;
  headshot: boolean;
  killed: boolean;
  rewardTenge: number;
  damage: number;
  point: THREE.Vector3;
}

interface EnemyBullet {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  damage: number;
  life: number;
}

interface Spark {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
}

const ARCHETYPE_STATS: Record<
  EnemyArchetype,
  { hp: number; speed: number; fireRate: number; damage: number; tenge: number; color: number; accent: number; scale: number }
> = {
  guard: { hp: 85, speed: 3.6, fireRate: 1.45, damage: 11, tenge: 180, color: 0x1c2436, accent: 0xff003c, scale: 1.0 },
  drone: { hp: 65, speed: 5.5, fireRate: 1.15, damage: 9, tenge: 150, color: 0x222c40, accent: 0x00f0ff, scale: 0.9 },
  turret: { hp: 110, speed: 0, fireRate: 0.9, damage: 10, tenge: 200, color: 0x1e2536, accent: 0xff5500, scale: 1.0 },
  netrunner: { hp: 75, speed: 3.2, fireRate: 1.6, damage: 13, tenge: 240, color: 0x1d122e, accent: 0xb537f2, scale: 0.98 },
  heavy: { hp: 195, speed: 2.3, fireRate: 0.72, damage: 15, tenge: 380, color: 0x20151b, accent: 0xff003c, scale: 1.24 },
  scav: { hp: 70, speed: 4.1, fireRate: 1.4, damage: 9, tenge: 140, color: 0x33271e, accent: 0xfcee0a, scale: 0.98 },
  ganger: { hp: 80, speed: 4.4, fireRate: 1.25, damage: 10, tenge: 170, color: 0x28132c, accent: 0xff2a6d, scale: 1.0 },
  bodyguard: { hp: 120, speed: 4.9, fireRate: 1.1, damage: 12, tenge: 250, color: 0x1a1d28, accent: 0xffaa00, scale: 1.15 },
  artem: { hp: 130, speed: 3.5, fireRate: 1.05, damage: 14, tenge: 400, color: 0x2b102d, accent: 0xffb800, scale: 1.08 },
  cyberpsycho: { hp: 460, speed: 6.4, fireRate: 0.75, damage: 18, tenge: 1200, color: 0x140d1e, accent: 0x00ffaa, scale: 1.28 },
};

export class EnemyManager {
  private static readonly MAX_SPARKS = 60;
  private static readonly MAX_BULLETS = 45;

  private enemies: EnemyInstance[] = [];
  private bullets: EnemyBullet[] = [];
  private sparks: Spark[] = [];
  private scene: THREE.Scene;
  private raycaster = new THREE.Raycaster();

  // Shared geometries & cached materials to eliminate per-shot / per-spark GPU & GC leaks
  private bulletGeo = new THREE.SphereGeometry(0.09, 6, 6);
  private heavyBulletGeo = new THREE.SphereGeometry(0.14, 6, 6);
  private sparkGeo = new THREE.BoxGeometry(0.08, 0.08, 0.08);
  private basicMatCache = new Map<number, THREE.MeshBasicMaterial>();
  private tmpNextPos = new THREE.Vector3();
  private tmpStepDir = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  private getCachedBasicMaterial(colorHex: number): THREE.MeshBasicMaterial {
    let mat = this.basicMatCache.get(colorHex);
    if (!mat) {
      mat = new THREE.MeshBasicMaterial({ color: colorHex });
      this.basicMatCache.set(colorHex, mat);
    }
    return mat;
  }

  private disposeEnemy(enemy: EnemyInstance): void {
    this.scene.remove(enemy.group);
    enemy.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
      }
    });
    const bodyMat = enemy.bodyHitbox.material;
    if (bodyMat instanceof THREE.MeshStandardMaterial) {
      bodyMat.dispose();
    }
  }

  spawnWave(configs: EnemySpawnConfig[]): void {
    for (const cfg of configs) {
      if (this.enemies.some((e) => e.id === cfg.id && e.alive)) continue;
      this.spawnOne(cfg);
    }
  }

  private spawnOne(cfg: EnemySpawnConfig): void {
    const spec = ARCHETYPE_STATS[cfg.archetype];
    const group = new THREE.Group();
    group.position.set(cfg.x, cfg.y, cfg.z);

    const armorMat = new THREE.MeshStandardMaterial({
      color: spec.color,
      roughness: 0.45,
      metalness: 0.6,
    });
    const accentMat = this.getCachedBasicMaterial(spec.accent);

    let bodyHitbox: THREE.Mesh;
    let headHitbox: THREE.Mesh;

    if (cfg.archetype === 'drone') {
      // Generous OctahedronGeometry(0.75, 1) hull + prominent glowing eye so taxi-chase hits feel snappy & fair
      const hull = new THREE.Mesh(new THREE.OctahedronGeometry(0.75, 1), armorMat);
      hull.position.y = 2.4;
      group.add(hull);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 8), accentMat);
      eye.position.set(0, 2.4, 0.65);
      group.add(eye);
      const rotor = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.06, 6, 16), accentMat);
      rotor.rotation.x = Math.PI / 2;
      rotor.position.y = 2.85;
      group.add(rotor);

      bodyHitbox = hull;
      headHitbox = eye;
    } else if (cfg.archetype === 'turret') {
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, 1.4, 8), armorMat);
      base.position.y = 0.7;
      group.add(base);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.8), armorMat);
      head.position.y = 1.6;
      group.add(head);
      const lens = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.16, 0.2), accentMat);
      lens.position.set(0, 1.6, 0.42);
      group.add(lens);
      bodyHitbox = base;
      headHitbox = head;
    } else {
      // Humanoid cyberpunk combatant
      const s = spec.scale;
      const legs = new THREE.Mesh(new THREE.BoxGeometry(0.5 * s, 0.85 * s, 0.34 * s), armorMat);
      legs.position.y = 0.42 * s;
      group.add(legs);

      const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62 * s, 0.74 * s, 0.38 * s), armorMat);
      torso.position.y = 1.18 * s;
      group.add(torso);

      const chestStrip = new THREE.Mesh(new THREE.BoxGeometry(0.42 * s, 0.12 * s, 0.41 * s), accentMat);
      chestStrip.position.y = 1.24 * s;
      group.add(chestStrip);

      const head = new THREE.Mesh(new THREE.BoxGeometry(0.32 * s, 0.34 * s, 0.32 * s), armorMat);
      head.position.y = 1.72 * s;
      group.add(head);

      const visor = new THREE.Mesh(new THREE.BoxGeometry(0.28 * s, 0.1 * s, 0.08 * s), accentMat);
      visor.position.set(0, 1.74 * s, 0.16 * s);
      group.add(visor);

      const gun = new THREE.Mesh(new THREE.BoxGeometry(0.12 * s, 0.14 * s, 0.62 * s), armorMat);
      gun.position.set(0.36 * s, 1.18 * s, 0.34 * s);
      group.add(gun);

      bodyHitbox = torso;
      headHitbox = head;
    }

    bodyHitbox.userData.enemyId = cfg.id;
    bodyHitbox.userData.isHead = false;
    headHitbox.userData.enemyId = cfg.id;
    headHitbox.userData.isHead = true;

    this.scene.add(group);
    const maxHp = cfg.hp ?? spec.hp;

    this.enemies.push({
      id: cfg.id,
      archetype: cfg.archetype,
      zoneId: cfg.zoneId,
      hp: maxHp,
      maxHp,
      rewardTenge: cfg.rewardTenge ?? spec.tenge,
      alive: true,
      position: new THREE.Vector3(cfg.x, cfg.y, cfg.z),
      baseY: cfg.y,
      group,
      bodyHitbox,
      headHitbox,
      shootCooldown: 0.7 + Math.random() * 0.9,
      strafeDir: Math.random() > 0.5 ? 1 : -1,
      strafeTimer: 1.5 + Math.random() * 2,
      flashTimer: 0,
      deathTimer: 0,
    });
  }

  getAliveCount(zoneId?: string): number {
    return this.enemies.filter((e) => e.alive && (!zoneId || e.zoneId === zoneId)).length;
  }

  getAlivePositions(): Array<{ x: number; y: number; z: number; archetype: EnemyArchetype }> {
    return this.enemies
      .filter((e) => e.alive)
      .map((e) => ({ x: e.position.x, y: e.position.y, z: e.position.z, archetype: e.archetype }));
  }

  clearZone(zoneId?: string): void {
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (!zoneId || e.zoneId === zoneId) {
        this.disposeEnemy(e);
        this.enemies.splice(i, 1);
      }
    }
    if (!zoneId) {
      for (const b of this.bullets) {
        this.scene.remove(b.mesh);
      }
      this.bullets = [];
      for (const s of this.sparks) {
        this.scene.remove(s.mesh);
      }
      this.sparks = [];
    }
  }

  /**
   * Raycast hitscan shot against all living enemies (limited by wall hit distance).
   */
  checkBulletHit(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    maxDist: number,
    baseDamage: number,
    headshotMult: number,
  ): EnemyHitResult {
    const targets: THREE.Object3D[] = [];
    for (const e of this.enemies) {
      if (!e.alive) continue;
      targets.push(e.headHitbox, e.bodyHitbox);
    }

    if (targets.length === 0) {
      return {
        hit: false,
        enemyId: null,
        archetype: null,
        zoneId: null,
        headshot: false,
        killed: false,
        rewardTenge: 0,
        damage: 0,
        point: origin.clone().addScaledVector(dir, maxDist),
      };
    }

    this.raycaster.set(origin, dir);
    this.raycaster.near = 0.05;
    this.raycaster.far = maxDist;

    const hits = this.raycaster.intersectObjects(targets, false);
    if (hits.length === 0) {
      return {
        hit: false,
        enemyId: null,
        archetype: null,
        zoneId: null,
        headshot: false,
        killed: false,
        rewardTenge: 0,
        damage: 0,
        point: origin.clone().addScaledVector(dir, maxDist),
      };
    }

    const first = hits[0];
    const enemyId = first.object.userData.enemyId as string;
    const headshot = Boolean(first.object.userData.isHead);
    const enemy = this.enemies.find((e) => e.id === enemyId && e.alive);
    if (!enemy) {
      return {
        hit: false,
        enemyId: null,
        archetype: null,
        zoneId: null,
        headshot: false,
        killed: false,
        rewardTenge: 0,
        damage: 0,
        point: first.point,
      };
    }

    const dmg = Math.round(baseDamage * (headshot ? headshotMult : 1));
    const killed = this.applyDamageToEnemy(enemy, dmg, first.point);

    return {
      hit: true,
      enemyId: enemy.id,
      archetype: enemy.archetype,
      zoneId: enemy.zoneId,
      headshot,
      killed,
      rewardTenge: killed ? enemy.rewardTenge : 0,
      damage: dmg,
      point: first.point,
    };
  }

  /**
   * Cone melee sweep for Mantis Blades and Malorian Flame Melee!
   */
  applyMeleeArc(
    origin: THREE.Vector3,
    forward: THREE.Vector3,
    range: number,
    damage: number,
  ): Array<{ enemyId: string; zoneId: string; killed: boolean; rewardTenge: number; point: THREE.Vector3 }> {
    const results: Array<{ enemyId: string; zoneId: string; killed: boolean; rewardTenge: number; point: THREE.Vector3 }> = [];
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const center = e.position.clone().add(new THREE.Vector3(0, e.archetype === 'drone' ? 2.2 : 1.2, 0));
      const toEnemy = center.clone().sub(origin);
      const dist = toEnemy.length();
      if (dist > range) continue;
      toEnemy.normalize();
      if (toEnemy.dot(forward) < 0.35 && dist > 1.8) continue;

      const killed = this.applyDamageToEnemy(e, damage, center);
      results.push({
        enemyId: e.id,
        zoneId: e.zoneId,
        killed,
        rewardTenge: killed ? e.rewardTenge : 0,
        point: center,
      });
    }
    return results;
  }

  /**
   * Finds nearest enemy within forward cone for Mantis Blade Leap Attack!
   */
  findNearestEnemyInCone(origin: THREE.Vector3, forward: THREE.Vector3, maxRange: number): THREE.Vector3 | null {
    let best: THREE.Vector3 | null = null;
    let bestDist = maxRange;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const to = e.position.clone().sub(origin);
      const dist = to.length();
      if (dist > bestDist || dist < 1.2) continue;
      if (to.clone().normalize().dot(forward) > 0.65) {
        bestDist = dist;
        best = e.position.clone();
      }
    }
    return best;
  }

  private applyDamageToEnemy(enemy: EnemyInstance, damage: number, hitPoint: THREE.Vector3): boolean {
    enemy.hp = Math.max(0, enemy.hp - damage);
    enemy.flashTimer = 0.12;
    this.spawnSparks(hitPoint, 6, ARCHETYPE_STATS[enemy.archetype].accent);

    if (enemy.hp <= 0) {
      enemy.alive = false;
      enemy.deathTimer = 1.6;
      this.spawnSparks(hitPoint, 14, 0xff5500);
      return true;
    }
    return false;
  }

  spawnSparks(point: THREE.Vector3, count: number, colorHex: number): void {
    const mat = this.getCachedBasicMaterial(colorHex);
    for (let i = 0; i < count; i++) {
      if (this.sparks.length >= EnemyManager.MAX_SPARKS) {
        const recycled = this.sparks.shift();
        if (recycled) {
          recycled.mesh.material = mat;
          recycled.mesh.position.copy(point);
          recycled.velocity.set(
            (Math.random() - 0.5) * 8,
            2 + Math.random() * 5,
            (Math.random() - 0.5) * 8,
          );
          recycled.life = 0.35 + Math.random() * 0.2;
          this.sparks.push(recycled);
          continue;
        }
      }

      const m = new THREE.Mesh(this.sparkGeo, mat);
      m.position.copy(point);
      this.scene.add(m);
      this.sparks.push({
        mesh: m,
        velocity: new THREE.Vector3(
          (Math.random() - 0.5) * 8,
          2 + Math.random() * 5,
          (Math.random() - 0.5) * 8,
        ),
        life: 0.35 + Math.random() * 0.2,
      });
    }
  }

  update(
    dt: number,
    playerPos: Vec3,
    playerEye: Vec3,
    physics: PhysicsWorld,
    callbacks: {
      onEnemyShot: (heavy: boolean) => void;
      onPlayerHit: (damage: number) => void;
      damageScale?: number;
      chaseDamageScale?: number;
    },
    chaseDamageScale?: number,
  ): void {
    const effectiveDamageScale = Math.max(
      0,
      chaseDamageScale ?? callbacks.damageScale ?? callbacks.chaseDamageScale ?? 1,
    );

    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (!e.alive) {
        e.deathTimer -= dt;
        e.group.rotation.x = Math.min(Math.PI / 2, e.group.rotation.x + dt * 5.2);
        e.group.position.y -= dt * 0.45;
        if (e.deathTimer <= 0) {
          this.disposeEnemy(e);
          this.enemies.splice(i, 1);
        }
        continue;
      }

      // Skip AI processing for enemies far away in another vertical story layer or >78m away
      if (Math.abs(e.position.y - playerPos.y) > 22) continue;
      const dx = playerPos.x - e.position.x;
      const dz = playerPos.z - e.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 78) continue;

      const spec = ARCHETYPE_STATS[e.archetype];
      const angleToPlayer = Math.atan2(dx, dz);
      e.group.rotation.y = angleToPlayer;

      // Hit flash visual feedback
      if (e.flashTimer > 0) {
        e.flashTimer = Math.max(0, e.flashTimer - dt);
        const bodyMat = e.bodyHitbox.material;
        if (bodyMat instanceof THREE.MeshStandardMaterial) {
          bodyMat.emissive.setHex(e.flashTimer > 0 ? 0xff3355 : 0x000000);
          bodyMat.emissiveIntensity = e.flashTimer > 0 ? 1.2 : 0;
        }
      }

      // Movement & strafing
      if (spec.speed > 0 && dist > 1.8) {
        e.strafeTimer -= dt;
        if (e.strafeTimer <= 0) {
          e.strafeTimer = 1.4 + Math.random() * 1.8;
          e.strafeDir *= -1;
        }
        const preferredDist = e.archetype === 'bodyguard' || e.archetype === 'cyberpsycho' ? 2.5 : 14;
        const moveToward = dist > preferredDist ? 1 : dist < preferredDist * 0.55 ? -0.5 : 0;
        const dirX = dx / Math.max(0.01, dist);
        const dirZ = dz / Math.max(0.01, dist);
        const perpX = -dirZ * e.strafeDir;
        const perpZ = dirX * e.strafeDir;

        const vx = (dirX * moveToward + perpX * 0.55) * spec.speed;
        const vz = (dirZ * moveToward + perpZ * 0.55) * spec.speed;

        if (e.archetype === 'drone') {
          e.position.x += vx * dt;
          e.position.z += vz * dt;
          e.position.y = e.baseY + Math.sin(performance.now() * 0.004 + i) * 0.35;
        } else {
          const res = physics.resolveCylinderMove(
            e.position,
            e.position.x + vx * dt,
            e.position.z + vz * dt,
            0.48,
            e.position.y,
            1.8,
          );
          e.position.x = res.x;
          e.position.z = res.z;
        }
        e.group.position.copy(e.position);
      }

      // Combat shooting / melee
      e.shootCooldown -= dt;
      if (e.shootCooldown <= 0 && dist < 56) {
        const muzzle: Vec3 = {
          x: e.position.x,
          y: e.position.y + (e.archetype === 'drone' ? 2.3 : 1.4),
          z: e.position.z,
        };
        if (physics.hasLineOfSight(muzzle, playerEye)) {
          e.shootCooldown = spec.fireRate * (0.85 + Math.random() * 0.3);
          callbacks.onEnemyShot(e.archetype === 'heavy' || e.archetype === 'cyberpsycho');

          const shotDir = new THREE.Vector3(
            playerEye.x - muzzle.x + (Math.random() - 0.5) * 0.9,
            playerEye.y - 0.25 - muzzle.y + (Math.random() - 0.5) * 0.45,
            playerEye.z - muzzle.z + (Math.random() - 0.5) * 0.9,
          ).normalize();

          const bulletGeo = e.archetype === 'heavy' ? this.heavyBulletGeo : this.bulletGeo;
          const bulletMat = this.getCachedBasicMaterial(spec.accent);

          while (this.bullets.length >= EnemyManager.MAX_BULLETS) {
            const oldest = this.bullets.shift();
            if (oldest) {
              this.scene.remove(oldest.mesh);
            }
          }

          const bulletMesh = new THREE.Mesh(bulletGeo, bulletMat);
          bulletMesh.position.set(muzzle.x, muzzle.y, muzzle.z);
          this.scene.add(bulletMesh);

          this.bullets.push({
            mesh: bulletMesh,
            velocity: shotDir.multiplyScalar(e.archetype === 'cyberpsycho' ? 42 : 31),
            damage: spec.damage,
            life: 2.2,
          });
        } else {
          e.shootCooldown = 0.4;
        }
      }
    }

    // Update enemy projectiles (remove bullet before callback & guard bounds against re-entrant clearZone)
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      if (i >= this.bullets.length) {
        i = this.bullets.length;
        continue;
      }
      const b = this.bullets[i];
      if (!b) continue;

      b.life -= dt;
      this.tmpNextPos.copy(b.mesh.position).addScaledVector(b.velocity, dt);
      const stepDist = b.mesh.position.distanceTo(this.tmpNextPos);
      this.tmpStepDir.copy(this.tmpNextPos).sub(b.mesh.position);
      if (stepDist > 1e-6) {
        this.tmpStepDir.divideScalar(stepDist);
      } else {
        this.tmpStepDir.set(0, 0, -1);
      }

      const wallHit = physics.raycastBullets(b.mesh.position, this.tmpStepDir, stepDist);
      const hitPlayer =
        Math.hypot(this.tmpNextPos.x - playerPos.x, this.tmpNextPos.z - playerPos.z) < 0.72 &&
        this.tmpNextPos.y >= playerPos.y &&
        this.tmpNextPos.y <= playerPos.y + 1.95;

      if (hitPlayer) {
        const scaledDamage =
          effectiveDamageScale <= 0 ? 0 : Math.max(1, Math.round(b.damage * effectiveDamageScale));
        this.scene.remove(b.mesh);
        this.bullets.splice(i, 1);
        callbacks.onPlayerHit(scaledDamage);
      } else if (wallHit.hit || b.life <= 0) {
        this.scene.remove(b.mesh);
        this.bullets.splice(i, 1);
      } else {
        b.mesh.position.copy(this.tmpNextPos);
      }
    }

    // Update sparks
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      if (!s) continue;
      s.life -= dt;
      s.velocity.y -= 15 * dt;
      s.mesh.position.addScaledVector(s.velocity, dt);
      if (s.life <= 0) {
        this.scene.remove(s.mesh);
        this.sparks.splice(i, 1);
      }
    }
  }
}

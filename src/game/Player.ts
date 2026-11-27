import * as THREE from 'three';
import {
  createInitialUpgrades,
  type CameraMode,
  type UpgradeState,
  type Vec3,
} from '../types/game';
import type { InputSnapshot } from '../engine/InputManager';
import type { PhysicsWorld } from '../engine/Physics';

/**
 * Pure player state evolved from Bolt 1 with double jump, Ripperdoc upgrades, and Cyber-Tenge economy.
 */
export class PlayerState {
  hp = 100;
  maxHp = 100;
  armor = 50;
  maxArmor = 50;
  maxDocCharges = 3;
  maxMaxDoc = 4;

  sandevistanEnergy = 100;
  sandevistanActive = false;
  dashCooldown = 0;

  tenge = 1500;
  streetCred = 1;
  upgrades: UpgradeState = createInitialUpgrades();

  private sandevistanDrainPerSec = 24;
  private sandevistanRechargePerSec = 11;

  resetFull(keepEconomy = false): void {
    this.recomputeStatsFromUpgrades();
    this.hp = this.maxHp;
    this.armor = this.maxArmor;
    this.maxDocCharges = Math.min(this.maxMaxDoc, 3);
    this.sandevistanEnergy = 100;
    this.sandevistanActive = false;
    this.dashCooldown = 0;
    if (!keepEconomy) {
      this.tenge = 1500;
      this.streetCred = 1;
      this.upgrades = createInitialUpgrades();
      this.recomputeStatsFromUpgrades();
      this.hp = this.maxHp;
      this.armor = this.maxArmor;
    }
  }

  restoreForCheckpoint(): void {
    this.recomputeStatsFromUpgrades();
    this.hp = this.maxHp;
    this.armor = this.maxArmor;
    this.maxDocCharges = Math.max(this.maxDocCharges, Math.min(this.maxMaxDoc, 3));
    this.sandevistanEnergy = 100;
    this.sandevistanActive = false;
    this.dashCooldown = 0;
  }

  recomputeStatsFromUpgrades(): void {
    this.maxHp = this.upgrades.reinforcedPlating ? 150 : 100;
    this.maxArmor = this.upgrades.reinforcedPlating ? 100 : 50;
    this.maxMaxDoc = this.upgrades.maxDocCapacity ? 6 : 4;
    this.sandevistanDrainPerSec = this.upgrades.sandevistanMk2 ? 15 : 24;
    this.sandevistanRechargePerSec = this.upgrades.sandevistanMk2 ? 16 : 11;
  }

  applyUpgrade(key: keyof UpgradeState): boolean {
    if (this.upgrades[key]) return false;
    this.upgrades[key] = true;
    this.recomputeStatsFromUpgrades();
    if (key === 'reinforcedPlating') {
      this.hp = this.maxHp;
      this.armor = this.maxArmor;
    } else if (key === 'maxDocCapacity') {
      this.maxDocCharges = this.maxMaxDoc;
    }
    return true;
  }

  addTenge(amount: number): void {
    this.tenge = Math.max(0, Math.round(this.tenge + amount));
  }

  spendTenge(cost: number): boolean {
    if (cost < 0 || this.tenge < cost) return false;
    this.tenge -= cost;
    return true;
  }

  takeDamage(amount: number, allowLethal = true): { applied: number; died: boolean } {
    if (amount <= 0) return { applied: 0, died: false };
    let remaining = amount;

    if (this.armor > 0) {
      const armorAbsorb = Math.min(this.armor, remaining * 0.55);
      this.armor = Math.max(0, this.armor - armorAbsorb);
      remaining -= armorAbsorb;
    }

    const minHp = allowLethal ? 0 : 1;
    const prevHp = this.hp;
    this.hp = Math.max(minHp, this.hp - remaining);

    return {
      applied: prevHp - this.hp,
      died: allowLethal && this.hp <= 0,
    };
  }

  useMaxDoc(): boolean {
    if (this.maxDocCharges <= 0 || (this.hp >= this.maxHp && this.armor >= this.maxArmor)) {
      return false;
    }
    this.maxDocCharges--;
    this.hp = Math.min(this.maxHp, this.hp + 60);
    this.armor = Math.min(this.maxArmor, this.armor + 25);
    return true;
  }

  refillSupplies(): void {
    this.maxDocCharges = Math.min(this.maxMaxDoc, this.maxDocCharges + 1);
    this.armor = Math.min(this.maxArmor, this.armor + 30);
  }

  toggleSandevistan(): { changed: boolean; active: boolean } {
    if (this.sandevistanActive) {
      this.sandevistanActive = false;
      return { changed: true, active: false };
    }
    if (this.sandevistanEnergy >= 22) {
      this.sandevistanActive = true;
      return { changed: true, active: true };
    }
    return { changed: false, active: false };
  }

  updateTimers(dt: number): { sandevistanEnded: boolean } {
    let sandevistanEnded = false;
    if (this.dashCooldown > 0) {
      this.dashCooldown = Math.max(0, this.dashCooldown - dt);
    }

    if (this.sandevistanActive) {
      this.sandevistanEnergy = Math.max(0, this.sandevistanEnergy - this.sandevistanDrainPerSec * dt);
      if (this.sandevistanEnergy <= 0) {
        this.sandevistanActive = false;
        sandevistanEnded = true;
      }
    } else {
      this.sandevistanEnergy = Math.min(100, this.sandevistanEnergy + this.sandevistanRechargePerSec * dt);
    }

    return { sandevistanEnded };
  }

  getWorldTimeScale(): number {
    return this.sandevistanActive ? 0.28 : 1.0;
  }
}

export class PlayerController {
  readonly state = new PlayerState();
  readonly position = new THREE.Vector3(0, 0, 24);
  readonly velocity = new THREE.Vector3();

  yaw = 0;
  pitch = 0;
  roll = 0;
  mode: CameraMode = 'FREE';

  readonly eyeHeight = 1.68;
  readonly radius = 0.45;
  readonly height = 1.8;
  groundY = 0;

  private grounded = true;
  private airJumpsUsed = 0;
  private headBobPhase = 0;
  private shakeIntensity = 0;
  private dashTimer = 0;
  private dashSpeed = 23.5;
  private dashDir = new THREE.Vector3();
  private aimBlend = 0;

  // Bolt-1-style interactive cinematic camera parameters
  private cinematicAnchor = new THREE.Vector3();
  private cinematicTarget = new THREE.Vector3();
  private cinematicFov = 62;
  private lookOffsetYaw = 0;
  private lookOffsetPitch = 0;
  private modeTime = 0;

  private camera: THREE.PerspectiveCamera;
  private baseFov = 75;

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
    this.camera.rotation.order = 'YXZ';
  }

  teleport(x: number, y: number, z: number, yaw = 0, pitch = 0): void {
    this.groundY = y;
    this.position.set(x, y, z);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = pitch;
    this.roll = 0;
    this.grounded = true;
    this.airJumpsUsed = 0;
    this.dashTimer = 0;
    this.dashSpeed = 23.5;
    this.aimBlend = 0;
    this.shakeIntensity = 0;
    this.headBobPhase = 0;
    this.lookOffsetYaw = 0;
    this.lookOffsetPitch = 0;
    this.camera.fov = this.baseFov;
    this.camera.updateProjectionMatrix();
    this.syncCamera(0);
  }

  syncElevatorY(floorY: number): void {
    this.groundY = floorY;
    this.position.y = floorY;
    this.velocity.y = 0;
    this.grounded = true;
    this.airJumpsUsed = 0;
    if (this.mode === 'FREE') {
      this.syncCamera(0);
    }
  }

  setMode(mode: CameraMode): void {
    this.mode = mode;
    this.modeTime = 0;
    this.lookOffsetYaw = 0;
    this.lookOffsetPitch = 0;
    if (mode !== 'FREE') {
      this.aimBlend = 0;
    }
  }

  /**
   * Configures interactive first-person seated/execution/chair camera rig (like Bolt 1 Operating Table & Fallen modes).
   */
  configureInteractiveCutscene(anchor: Vec3, lookTarget: Vec3, fov = 58): void {
    this.cinematicAnchor.set(anchor.x, anchor.y, anchor.z);
    this.cinematicTarget.set(lookTarget.x, lookTarget.y, lookTarget.z);
    this.cinematicFov = fov;
    this.lookOffsetYaw = 0;
    this.lookOffsetPitch = 0;
    this.modeTime = 0;
    this.applyInteractiveCutsceneCamera(0);
  }

  addScreenShake(intensity: number): void {
    this.shakeIntensity = Math.min(0.55, Math.max(this.shakeIntensity, intensity));
  }

  addRecoilKick(pitchRad: number, yawRad: number): void {
    this.pitch = Math.max(-1.42, Math.min(1.42, this.pitch + pitchRad));
    this.yaw += yawRad;
  }

  applyLungeImpulse(dir: THREE.Vector3, speed: number, duration = 0.16): void {
    this.dashDir.copy(dir).setY(0);
    if (this.dashDir.lengthSq() > 1e-6) {
      this.dashDir.normalize();
    } else {
      this.dashDir.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    }
    this.dashSpeed = Math.max(8, speed);
    this.dashTimer = Math.max(0.08, duration);
    this.velocity.x = this.dashDir.x * this.dashSpeed;
    this.velocity.z = this.dashDir.z * this.dashSpeed;
    if (this.grounded) {
      this.velocity.y = 3.2;
      this.grounded = false;
    }
  }

  getEyePosition(): THREE.Vector3 {
    return new THREE.Vector3(this.position.x, this.position.y + this.eyeHeight, this.position.z);
  }

  getForwardDirection(): THREE.Vector3 {
    const dir = new THREE.Vector3(0, 0, -1);
    dir.applyEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    return dir.normalize();
  }

  isGrounded(): boolean {
    return this.grounded;
  }

  getAimBlend(): number {
    return this.aimBlend;
  }

  update(
    dt: number,
    input: InputSnapshot,
    physics: PhysicsWorld,
    allowMovement = true,
    allowJump = true,
  ): { isMoving: boolean; dashed: boolean; jumped: boolean; doubleJumped: boolean } {
    let isMoving = false;
    let dashed = false;
    let jumped = false;
    let doubleJumped = false;
    this.modeTime += dt;

    // Interactive cutscene modes with Bolt-1-style subtle constrained head-look!
    if (
      this.mode === 'ROOFTOP_SIT' ||
      this.mode === 'EXECUTION' ||
      this.mode === 'HUYESHI_CHAIR' ||
      this.mode === 'CHOKED' ||
      this.mode === 'FALLEN'
    ) {
      const limitYaw = this.mode === 'ROOFTOP_SIT' ? 0.34 : this.mode === 'HUYESHI_CHAIR' ? 0.45 : 0.22;
      const limitPitch = this.mode === 'HUYESHI_CHAIR' ? 0.38 : 0.2;
      this.lookOffsetYaw = Math.max(
        -limitYaw,
        Math.min(limitYaw, this.lookOffsetYaw - input.mouseDeltaX * 0.45),
      );
      this.lookOffsetPitch = Math.max(
        -limitPitch,
        Math.min(limitPitch, this.lookOffsetPitch - input.mouseDeltaY * 0.45),
      );
      this.applyInteractiveCutsceneCamera(dt);
      return { isMoving: false, dashed: false, jumped: false, doubleJumped: false };
    }

    if (this.mode === 'FREE' || this.mode === 'CLOSET' || this.mode === 'CHASE_PASSENGER') {
      const aimSensScale = this.mode === 'FREE' ? THREE.MathUtils.lerp(1.0, 0.58, this.aimBlend) : 0.75;
      if (this.mode === 'CLOSET') {
        this.yaw = Math.max(-Math.PI * 0.72, Math.min(-Math.PI * 0.16, this.yaw - input.mouseDeltaX * 0.5));
        this.pitch = Math.max(-0.28, Math.min(0.28, this.pitch - input.mouseDeltaY * 0.5));
      } else {
        this.yaw -= input.mouseDeltaX * aimSensScale;
        this.pitch = Math.max(-1.42, Math.min(1.42, this.pitch - input.mouseDeltaY * aimSensScale));
      }
    }

    if (this.mode === 'FREE' && allowMovement) {
      const targetAim = input.aimHeld ? 1 : 0;
      this.aimBlend += (targetAim - this.aimBlend) * Math.min(1, dt * 14);

      const forwardX = -Math.sin(this.yaw);
      const forwardZ = -Math.cos(this.yaw);
      const rightX = Math.cos(this.yaw);
      const rightZ = -Math.sin(this.yaw);

      let wishX = forwardX * input.moveForward + rightX * input.moveRight;
      let wishZ = forwardZ * input.moveForward + rightZ * input.moveRight;
      const wishLen = Math.hypot(wishX, wishZ);
      if (wishLen > 1e-4) {
        wishX /= wishLen;
        wishZ /= wishLen;
        isMoving = true;
      }

      const canDash = this.grounded || this.state.upgrades.airDash;
      if (input.dashPressed && this.state.dashCooldown <= 0 && canDash) {
        this.state.dashCooldown = 1.15;
        this.dashTimer = 0.18;
        this.dashSpeed = 23.5;
        this.dashDir.set(wishLen > 0.01 ? wishX : forwardX, 0, wishLen > 0.01 ? wishZ : forwardZ).normalize();
        dashed = true;
        this.addScreenShake(0.05);
      }

      if (allowJump && input.jumpPressed) {
        if (this.grounded) {
          this.velocity.y = 8.4;
          this.grounded = false;
          this.airJumpsUsed = 0;
          jumped = true;
        } else if (this.state.upgrades.doubleJump && this.airJumpsUsed === 0) {
          this.velocity.y = 8.2;
          this.airJumpsUsed = 1;
          doubleJumped = true;
          this.addScreenShake(0.03);
        }
      }

      const baseSpeed = this.state.sandevistanActive ? 10.6 : 8.2;
      const moveSpeed = baseSpeed * THREE.MathUtils.lerp(1.0, 0.65, this.aimBlend);
      let vx = wishX * moveSpeed;
      let vz = wishZ * moveSpeed;

      if (this.dashTimer > 0) {
        this.dashTimer = Math.max(0, this.dashTimer - dt);
        vx = this.dashDir.x * this.dashSpeed;
        vz = this.dashDir.z * this.dashSpeed;
      }

      const targetX = this.position.x + vx * dt;
      const targetZ = this.position.z + vz * dt;
      const resolved = physics.resolveCylinderMove(
        this.position,
        targetX,
        targetZ,
        this.radius,
        this.position.y,
        this.height,
      );
      this.position.x = resolved.x;
      this.position.z = resolved.z;

      const supportY = physics.getSupportY(
        this.position.x,
        this.position.z,
        this.radius,
        this.position.y,
        this.groundY,
      );

      const ceilingY =
        this.velocity.y > 0
          ? physics.getCeilingY(this.position.x, this.position.z, this.radius, this.position.y, this.height)
          : Number.POSITIVE_INFINITY;

      this.velocity.y -= 21.5 * dt;
      this.position.y += this.velocity.y * dt;

      if (Number.isFinite(ceilingY) && this.position.y + this.height > ceilingY) {
        this.position.y = Math.max(supportY, ceilingY - this.height);
        this.velocity.y = Math.min(0, this.velocity.y);
      }

      if (this.position.y <= supportY) {
        this.position.y = supportY;
        this.velocity.y = 0;
        this.grounded = true;
        this.airJumpsUsed = 0;
      } else if (this.position.y > supportY + 0.08) {
        this.grounded = false;
      }

      const targetRoll = -input.moveRight * 0.022;
      this.roll += (targetRoll - this.roll) * Math.min(1, dt * 11);

      if (isMoving && this.grounded) {
        this.headBobPhase += dt * (this.state.sandevistanActive ? 13 : 10.5);
      }

      const targetFov =
        (this.state.sandevistanActive ? 84 : this.dashTimer > 0 ? 86 : this.baseFov) -
        this.aimBlend * 15;
      if (Math.abs(this.camera.fov - targetFov) > 0.05) {
        this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 12);
        this.camera.updateProjectionMatrix();
      }
    }

    if (this.mode === 'FREE' || this.mode === 'CLOSET' || this.mode === 'CHASE_PASSENGER') {
      this.syncCamera(dt, isMoving && this.mode === 'FREE');
    }

    return { isMoving, dashed, jumped, doubleJumped };
  }

  private applyInteractiveCutsceneCamera(dt: number): void {
    if (this.shakeIntensity > 0) {
      this.shakeIntensity = Math.max(0, this.shakeIntensity - dt * 1.4);
    }
    const sx = (Math.random() - 0.5) * this.shakeIntensity;
    const sy = (Math.random() - 0.5) * this.shakeIntensity;

    const breathe = Math.sin(this.modeTime * 1.7) * 0.025;
    let extraRoll = 0;
    let extraY = breathe;

    if (this.mode === 'CHOKED') {
      extraRoll = Math.sin(this.modeTime * 8.5) * 0.14;
      extraY = 0.16 + Math.sin(this.modeTime * 11) * 0.04;
    } else if (this.mode === 'FALLEN') {
      extraRoll = 0.42 + Math.sin(this.modeTime * 0.9) * 0.04;
      extraY = -Math.min(0.85, this.modeTime * 0.9);
    } else if (this.mode === 'HUYESHI_CHAIR') {
      extraRoll = Math.sin(this.modeTime * 0.6) * 0.03;
    }

    this.camera.position.set(
      this.cinematicAnchor.x + sx,
      this.cinematicAnchor.y + extraY + sy,
      this.cinematicAnchor.z,
    );

    const lookDir = this.cinematicTarget.clone().sub(this.camera.position);
    const baseYaw = Math.atan2(-lookDir.x, -lookDir.z);
    const horiz = Math.hypot(lookDir.x, lookDir.z);
    const basePitch = Math.atan2(lookDir.y, Math.max(0.01, horiz));

    this.camera.rotation.set(
      basePitch + this.lookOffsetPitch + sy * 0.25,
      baseYaw + this.lookOffsetYaw + sx * 0.25,
      extraRoll,
      'YXZ',
    );

    if (Math.abs(this.camera.fov - this.cinematicFov) > 0.1) {
      this.camera.fov += (this.cinematicFov - this.camera.fov) * Math.min(1, dt * 8 + 0.15);
      this.camera.updateProjectionMatrix();
    }
  }

  /**
   * Positions camera during vehicle driving or pure scripted pans.
   */
  setExternalCamera(pos: Vec3, lookAt: Vec3, fov = 76, roll = 0): void {
    this.camera.position.set(pos.x, pos.y, pos.z);
    this.camera.lookAt(lookAt.x, lookAt.y, lookAt.z);
    if (roll !== 0) {
      this.camera.rotation.z += roll;
    }
    if (Math.abs(this.camera.fov - fov) > 0.1) {
      this.camera.fov += (fov - this.camera.fov) * 0.18;
      this.camera.updateProjectionMatrix();
    }
  }

  syncCamera(dt: number, isMoving = false): void {
    if (this.shakeIntensity > 0) {
      this.shakeIntensity = Math.max(0, this.shakeIntensity - dt * 1.4);
    }
    const shakeX = (Math.random() - 0.5) * this.shakeIntensity;
    const shakeY = (Math.random() - 0.5) * this.shakeIntensity;

    const bobScale = THREE.MathUtils.lerp(1.0, 0.2, this.aimBlend);
    const bobY = isMoving && this.grounded ? Math.sin(this.headBobPhase) * 0.045 * bobScale : 0;
    const bobLat = isMoving && this.grounded ? Math.cos(this.headBobPhase * 0.5) * 0.025 * bobScale : 0;
    const rightX = Math.cos(this.yaw);
    const rightZ = -Math.sin(this.yaw);
    const latOffset = bobLat + shakeX;

    this.camera.position.set(
      this.position.x + rightX * latOffset,
      this.position.y + this.eyeHeight + bobY + shakeY,
      this.position.z + rightZ * latOffset,
    );
    this.camera.rotation.set(this.pitch + shakeY * 0.25, this.yaw + shakeX * 0.25, this.roll, 'YXZ');
  }
}

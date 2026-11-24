import * as THREE from 'three';
import { WORLD_HALF, type Vec3 } from '../types/game';
import type { InputSnapshot } from '../engine/InputManager';
import type { PhysicsWorld } from '../engine/Physics';
import type { ProceduralTextures } from '../engine/ProceduralTextures';

/**
 * Pure vehicle physics state for Cyber-Akhmed (autonomous Delamain-style Almaty cyber-taxi).
 * Unit-testable without Three.js.
 */
export class CyberAkhmedState {
  x = -46;
  y = 0;
  z = -10;
  yaw = -Math.PI / 2; // facing East down Prospekt Abaya
  speed = 0; // m/s
  nitroEnergy = 100;
  occupied = false;
  autopilotActive = false;
  autopilotTarget: Vec3 | null = null;
  thirdPersonCamera = true;

  readonly maxSpeed = 34; // ~122 km/h
  readonly maxNitroSpeed = 48; // ~172 km/h
  readonly maxReverseSpeed = -12;
  readonly radius = 2.05;

  setPose(x: number, y: number, z: number, yaw: number): void {
    this.x = x;
    this.y = y;
    this.z = z;
    this.yaw = yaw;
    this.speed = 0;
    this.autopilotActive = false;
  }

  startAutopilot(target: Vec3): void {
    this.autopilotTarget = { ...target };
    this.autopilotActive = true;
  }

  stopAutopilot(): void {
    this.autopilotActive = false;
    this.autopilotTarget = null;
  }

  getSpeedKmh(): number {
    return Math.round(Math.abs(this.speed) * 3.6);
  }

  /**
   * Steps vehicle physics for either manual driving or Cyber-Akhmed Autopilot.
   */
  step(
    dt: number,
    throttle: number,
    steer: number,
    handbrake: boolean,
    nitroHeld: boolean,
    physics: PhysicsWorld,
  ): { movedMeters: number; arrivedAutopilot: boolean; nitroActive: boolean; collided: boolean } {
    let effThrottle = throttle;
    let effSteer = steer;
    let arrivedAutopilot = false;

    // Cancel autopilot if player grabs steering or brakes
    if (this.autopilotActive && (Math.abs(throttle) > 0.1 || Math.abs(steer) > 0.1 || handbrake)) {
      this.stopAutopilot();
    }

    if (this.autopilotActive && this.autopilotTarget) {
      const dx = this.autopilotTarget.x - this.x;
      const dz = this.autopilotTarget.z - this.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 10) {
        this.stopAutopilot();
        this.speed *= 0.4;
        arrivedAutopilot = true;
      } else {
        const desiredYaw = Math.atan2(-dx, -dz);
        let diff = desiredYaw - this.yaw;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        effSteer = Math.max(-1, Math.min(1, -diff * 2.2));
        effThrottle = dist > 22 ? 0.85 : 0.45;
      }
    }

    const nitroActive = nitroHeld && effThrottle > 0.2 && this.nitroEnergy > 4 && !handbrake;
    if (nitroActive) {
      this.nitroEnergy = Math.max(0, this.nitroEnergy - 32 * dt);
    } else {
      this.nitroEnergy = Math.min(100, this.nitroEnergy + 14 * dt);
    }

    const topSpeed = nitroActive ? this.maxNitroSpeed : this.maxSpeed;
    const accel = nitroActive ? 34 : 21;

    if (handbrake) {
      this.speed += (0 - this.speed) * Math.min(1, dt * 6.5);
    } else if (effThrottle > 0) {
      this.speed = Math.min(topSpeed, this.speed + effThrottle * accel * dt);
    } else if (effThrottle < 0) {
      if (this.speed > 1.5) {
        this.speed = Math.max(0, this.speed + effThrottle * 32 * dt);
      } else {
        this.speed = Math.max(this.maxReverseSpeed, this.speed + effThrottle * 14 * dt);
      }
    } else {
      this.speed += (0 - this.speed) * Math.min(1, dt * 2.4);
      if (Math.abs(this.speed) < 0.08) this.speed = 0;
    }

    const speedFactor = Math.min(1, Math.abs(this.speed) / 4.5);
    const turnDir = this.speed >= -0.1 ? 1 : -1;
    const turnRate = handbrake ? 2.85 : 2.15;
    this.yaw -= effSteer * turnRate * speedFactor * turnDir * dt;

    const fwdX = -Math.sin(this.yaw);
    const fwdZ = -Math.cos(this.yaw);
    const targetX = Math.max(-WORLD_HALF + 6, Math.min(WORLD_HALF - 6, this.x + fwdX * this.speed * dt));
    const targetZ = Math.max(-WORLD_HALF + 6, Math.min(WORLD_HALF - 6, this.z + fwdZ * this.speed * dt));

    const prevX = this.x;
    const prevZ = this.z;
    const res = physics.resolveVehicleMove(
      { x: this.x, y: this.y, z: this.z },
      targetX,
      targetZ,
      this.radius,
      this.y,
    );
    this.x = res.x;
    this.z = res.z;
    if (res.collided) {
      this.speed *= 0.45;
    }

    const movedMeters = Math.hypot(this.x - prevX, this.z - prevZ);
    return { movedMeters, arrivedAutopilot, nitroActive, collided: res.collided };
  }
}

/**
 * 3D Cyber-Akhmed Taxi Controller (drivable in 500x500m Cyber-Almaty + summonable with [C]).
 */
export class VehicleSystem {
  readonly state = new CyberAkhmedState();
  readonly group = new THREE.Group();
  private wheels: THREE.Mesh[] = [];
  private nitroFlames: THREE.Mesh[] = [];
  private cameraLookSmooth = new THREE.Vector3();

  constructor(scene: THREE.Scene, textures: ProceduralTextures) {
    this.buildTaxiMesh(textures);
    scene.add(this.group);
    this.syncMesh();
  }

  private buildTaxiMesh(textures: ProceduralTextures): void {
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x161b29,
      metalness: 0.78,
      roughness: 0.25,
    });
    const taxiYellowMat = new THREE.MeshStandardMaterial({
      color: 0xfcee0a,
      emissive: 0xfcee0a,
      emissiveIntensity: 0.42,
      metalness: 0.4,
      roughness: 0.35,
    });
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x0a1c2e,
      emissive: 0x00aacc,
      emissiveIntensity: 0.25,
      metalness: 0.9,
      roughness: 0.1,
    });
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x0c0e14, roughness: 0.7, metalness: 0.3 });

    // Sleek cyber-sedan chassis (faces -Z)
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(2.15, 0.78, 4.7), bodyMat);
    chassis.position.set(0, 0.72, 0);
    this.group.add(chassis);

    // Iconic yellow taxi stripe along sides & hood
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.22, 0.18, 4.75), taxiYellowMat);
    stripe.position.set(0, 0.78, 0);
    this.group.add(stripe);

    // Cabin / greenhouse
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.65, 2.3), glassMat);
    cabin.position.set(0, 1.38, 0.15);
    this.group.add(cabin);

    // Roof TAXI neon sign
    const roofSign = new THREE.Mesh(
      new THREE.BoxGeometry(0.95, 0.26, 0.32),
      new THREE.MeshBasicMaterial({
        map: textures.getNeonSign('КИБЕР-АХМЕД', 'TAXI AI', '#fcee0a', '#00f0ff'),
      }),
    );
    roofSign.position.set(0, 1.82, 0.15);
    this.group.add(roofSign);

    // Cyan headlights & red taillights
    const headMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff });
    const tailMat = new THREE.MeshBasicMaterial({ color: 0xff003c });
    for (const sx of [-0.75, 0.75]) {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.1), headMat);
      hl.position.set(sx, 0.72, -2.36);
      this.group.add(hl);

      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.14, 0.1), tailMat);
      tl.position.set(sx, 0.78, 2.36);
      this.group.add(tl);

      const flame = new THREE.Mesh(
        new THREE.ConeGeometry(0.16, 0.9, 6),
        new THREE.MeshBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0 }),
      );
      flame.rotation.x = Math.PI / 2;
      flame.position.set(sx * 0.55, 0.45, 2.75);
      this.group.add(flame);
      this.nitroFlames.push(flame);
    }

    // Neon cyan underglow plate (zero PointLight shader churn)
    const underglow = new THREE.Mesh(
      new THREE.PlaneGeometry(2.35, 4.9),
      new THREE.MeshBasicMaterial({
        color: 0x00f0ff,
        transparent: true,
        opacity: 0.42,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    underglow.rotation.x = -Math.PI / 2;
    underglow.position.set(0, 0.08, 0);
    this.group.add(underglow);

    // 4 wheels
    const wheelGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.28, 12);
    wheelGeo.rotateZ(Math.PI / 2);
    for (const [wx, wz] of [
      [-1.08, -1.45],
      [1.08, -1.45],
      [-1.08, 1.45],
      [1.08, 1.45],
    ]) {
      const w = new THREE.Mesh(wheelGeo, wheelMat);
      w.position.set(wx, 0.38, wz);
      this.group.add(w);
      this.wheels.push(w);
    }
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  /**
   * Summons Cyber-Akhmed to the nearest clear road offset near the player!
   */
  summonNear(playerX: number, playerZ: number, playerYaw: number): void {
    const fwdX = -Math.sin(playerYaw);
    const fwdZ = -Math.cos(playerYaw);
    const targetX = Math.max(-WORLD_HALF + 14, Math.min(WORLD_HALF - 14, playerX + fwdX * 8));
    const targetZ = Math.max(-WORLD_HALF + 14, Math.min(WORLD_HALF - 14, playerZ + fwdZ * 8));
    this.state.setPose(targetX, 0, targetZ, playerYaw + Math.PI * 0.5);
    this.syncMesh();
  }

  isPlayerNear(px: number, py: number, pz: number): boolean {
    if (Math.abs(py - this.state.y) > 3.5) return false;
    return Math.hypot(px - this.state.x, pz - this.state.z) < 5.2;
  }

  getExitPosition(): Vec3 {
    const rightX = Math.cos(this.state.yaw);
    const rightZ = -Math.sin(this.state.yaw);
    return {
      x: this.state.x - rightX * 2.8,
      y: this.state.y,
      z: this.state.z - rightZ * 2.8,
    };
  }

  getCameraRig(): { pos: Vec3; lookAt: Vec3; fov: number } {
    const fwdX = -Math.sin(this.state.yaw);
    const fwdZ = -Math.cos(this.state.yaw);
    const speedNorm = Math.min(1, Math.abs(this.state.speed) / this.state.maxNitroSpeed);

    if (this.state.thirdPersonCamera) {
      const dist = 7.4 + speedNorm * 1.4;
      return {
        pos: {
          x: this.state.x - fwdX * dist,
          y: this.state.y + 3.25 + speedNorm * 0.25,
          z: this.state.z - fwdZ * dist,
        },
        lookAt: {
          x: this.state.x + fwdX * 10,
          y: this.state.y + 1.3,
          z: this.state.z + fwdZ * 10,
        },
        fov: 76 + speedNorm * 16,
      };
    }

    // First-person cyber-taxi cockpit view
    return {
      pos: {
        x: this.state.x + fwdX * 0.35,
        y: this.state.y + 1.48,
        z: this.state.z + fwdZ * 0.35,
      },
      lookAt: {
        x: this.state.x + fwdX * 18,
        y: this.state.y + 1.35,
        z: this.state.z + fwdZ * 18,
      },
      fov: 80 + speedNorm * 12,
    };
  }

  update(
    dt: number,
    input: InputSnapshot,
    physics: PhysicsWorld,
  ): { movedMeters: number; arrivedAutopilot: boolean; nitroActive: boolean; collided: boolean } {
    if (input.cameraTogglePressed) {
      this.state.thirdPersonCamera = !this.state.thirdPersonCamera;
    }

    const res = this.state.step(
      dt,
      this.state.occupied ? input.moveForward : 0,
      this.state.occupied ? input.moveRight : 0,
      this.state.occupied ? input.spaceHeld : false,
      this.state.occupied ? input.shiftHeld : false,
      physics,
    );

    for (const w of this.wheels) {
      w.rotation.x -= this.state.speed * dt * 2.2;
    }

    for (const f of this.nitroFlames) {
      const mat = f.material as THREE.MeshBasicMaterial;
      mat.opacity = res.nitroActive ? 0.78 + Math.random() * 0.2 : 0;
      f.scale.setScalar(res.nitroActive ? 0.9 + Math.random() * 0.35 : 0.1);
    }

    this.syncMesh();
    this.cameraLookSmooth.set(this.state.x, this.state.y + 1.3, this.state.z);
    return res;
  }

  syncMesh(): void {
    this.group.position.set(this.state.x, this.state.y, this.state.z);
    this.group.rotation.y = this.state.yaw;
  }
}

import * as THREE from 'three';

export interface CharacterRig {
  group: THREE.Group;
  head: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  holoMaterials?: THREE.MeshStandardMaterial[];
  /** Optional articulated sub-parts & props for cutscenes and dialogue animation */
  torso?: THREE.Group;
  leftForearm?: THREE.Group;
  rightForearm?: THREE.Group;
  cyberArmGroup?: THREE.Group;
  cyberShimmerMats?: THREE.MeshStandardMaterial[];
  auraRings?: THREE.Object3D[];
  biochipProp?: THREE.Object3D;
  weaponProp?: THREE.Object3D;
  setBiochipVisible?: (visible: boolean) => void;
}

interface CyberHumanoidSpec {
  coat: number;
  coatEmissive?: number;
  shirt: number;
  pants: number;
  skin: number;
  accent: number;
  hair: number;
  hairStyle: 'slick' | 'long' | 'short' | 'fade' | 'silver_swept' | 'spiky' | 'flowing_glow';
  eyewear?: 'none' | 'aviators' | 'visor_blue' | 'visor_red' | 'shades_gold' | 'ripper_loupes' | 'rodion_ocular';
  beard?: 'none' | 'goatee' | 'trimmed' | 'stubble';
  cyberSeamsColor?: number;
  hologram?: boolean;
  scale?: number;
  shoulderWidth?: number;
  bulk?: number;
  coatTails?: boolean;
  highCollar?: boolean;
  tacticalVest?: boolean;
  goldChain?: boolean;
  chromeLeftArm?: boolean;
}

function makeStandardMat(
  color: number,
  roughness = 0.55,
  metalness = 0.2,
  emissive = 0x000000,
  emissiveIntensity = 0,
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness,
    emissive,
    emissiveIntensity,
  });
}

function makeHoloMat(
  accent: number,
  opacity = 0.58,
  emissiveIntensity = 1.2,
  holoList?: THREE.MeshStandardMaterial[],
): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    color: accent,
    emissive: accent,
    emissiveIntensity,
    transparent: true,
    opacity,
    roughness: 0.2,
    metalness: 0.38,
  });
  if (holoList) holoList.push(m);
  return m;
}

/**
 * Builds a glowing Relic / Soulkiller Biochip prop (Bolt 1 OperatingTableScene lineage).
 */
function createBiochipProp(accentHex = 0x00f0ff): THREE.Group {
  const chip = new THREE.Group();
  const casing = new THREE.Mesh(
    new THREE.BoxGeometry(0.085, 0.145, 0.022),
    makeStandardMat(0x101826, 0.25, 0.85),
  );
  chip.add(casing);

  const core = new THREE.Mesh(
    new THREE.BoxGeometry(0.068, 0.125, 0.026),
    makeStandardMat(accentHex, 0.18, 0.4, accentHex, 3.2),
  );
  chip.add(core);

  const goldContacts = new THREE.Mesh(
    new THREE.BoxGeometry(0.072, 0.028, 0.028),
    makeStandardMat(0xfcee0a, 0.22, 0.9, 0xffaa00, 1.3),
  );
  goldContacts.position.y = -0.056;
  chip.add(goldContacts);
  return chip;
}

/**
 * Builds a gleaming chrome semi-auto pistol prop for Artem and fixer NPCs.
 */
function createChromePistolProp(): THREE.Group {
  const gun = new THREE.Group();
  const chromeMat = makeStandardMat(0xdbe6f2, 0.16, 0.94);
  const darkGripMat = makeStandardMat(0x12151e, 0.72, 0.3);
  const goldTrimMat = makeStandardMat(0xffb800, 0.22, 0.9, 0xff8800, 0.45);
  const sightGlow = makeStandardMat(0xff2a6d, 0.2, 0.3, 0xff2a6d, 2.4);

  // Slide & barrel extending forward (+Z in local weapon space)
  const slide = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.062, 0.24), chromeMat);
  slide.position.set(0, 0.045, 0.08);
  gun.add(slide);

  const underBarrel = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.03, 0.19), darkGripMat);
  underBarrel.position.set(0, 0.008, 0.07);
  gun.add(underBarrel);

  const goldPort = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.022, 0.065), goldTrimMat);
  goldPort.position.set(0, 0.05, 0.04);
  gun.add(goldPort);

  // Grip
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.125, 0.058), darkGripMat);
  grip.position.set(0, -0.045, -0.01);
  grip.rotation.x = 0.22;
  gun.add(grip);

  // Glowing iron sights
  const frontSight = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.014, 0.014), sightGlow);
  frontSight.position.set(0, 0.082, 0.185);
  gun.add(frontSight);

  // Trigger guard
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.036, 0.055), chromeMat);
  guard.position.set(0, -0.015, 0.04);
  gun.add(guard);

  return gun;
}

/**
 * Builds a high-detail articulated chrome cybernetic left arm (Samir Silverhand tribute)
 * with titanium mechanical joints and subtle cyan-magenta holographic shimmer veins.
 */
function buildChromeCyberArm(
  shimmerMats: THREE.MeshStandardMaterial[],
  holoList?: THREE.MeshStandardMaterial[],
  isHologram = false,
): { armGroup: THREE.Group; forearmGroup: THREE.Group } {
  const armGroup = new THREE.Group();

  const chromeMat = isHologram
    ? makeHoloMat(0x88f4ff, 0.72, 1.35, holoList)
    : makeStandardMat(0xd4e0ee, 0.16, 0.94, 0x162436, 0.18);
  const darkMetalMat = isHologram
    ? makeHoloMat(0x285478, 0.65, 0.9, holoList)
    : makeStandardMat(0x161b24, 0.35, 0.85);
  const shimmerCyan = new THREE.MeshStandardMaterial({
    color: 0x00f0ff,
    emissive: 0x00f0ff,
    emissiveIntensity: isHologram ? 1.85 : 1.15,
    transparent: true,
    opacity: isHologram ? 0.78 : 0.72,
    roughness: 0.15,
    metalness: 0.7,
  });
  const shimmerMagenta = new THREE.MeshStandardMaterial({
    color: 0xff2a6d,
    emissive: 0xff2a6d,
    emissiveIntensity: isHologram ? 1.7 : 0.95,
    transparent: true,
    opacity: isHologram ? 0.72 : 0.62,
    roughness: 0.18,
    metalness: 0.7,
  });
  shimmerMats.push(shimmerCyan, shimmerMagenta);

  // Cybernetic shoulder socket + layered chrome deltoid plates
  const socket = new THREE.Mesh(new THREE.CylinderGeometry(0.088, 0.078, 0.11, 10), darkMetalMat);
  socket.position.set(0, -0.02, 0);
  armGroup.add(socket);

  const deltoidPlate = new THREE.Mesh(new THREE.BoxGeometry(0.145, 0.16, 0.155), chromeMat);
  deltoidPlate.position.set(0.02, -0.05, 0);
  deltoidPlate.rotation.z = -0.14;
  armGroup.add(deltoidPlate);

  // Upper arm hydraulic core + outer chrome shell
  const upperCore = new THREE.Mesh(new THREE.CylinderGeometry(0.056, 0.05, 0.28, 8), darkMetalMat);
  upperCore.position.set(0.01, -0.19, 0);
  armGroup.add(upperCore);

  const bicepPlate = new THREE.Mesh(new THREE.BoxGeometry(0.115, 0.22, 0.125), chromeMat);
  bicepPlate.position.set(0.015, -0.19, 0.008);
  armGroup.add(bicepPlate);

  // Subtle holographic cyan-magenta accent line on upper arm
  const upperVein = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.21, 0.132), shimmerCyan);
  upperVein.position.set(0.032, -0.19, 0.01);
  armGroup.add(upperVein);

  // Elbow mechanical servo hinge
  const elbowJoint = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.062, 0.13, 10), darkMetalMat);
  elbowJoint.rotation.z = Math.PI / 2;
  elbowJoint.position.set(0.01, -0.34, 0);
  armGroup.add(elbowJoint);

  // Articulated Forearm group pivoting at elbow
  const forearmGroup = new THREE.Group();
  forearmGroup.position.set(0.01, -0.34, 0);

  const forearmCore = new THREE.Mesh(new THREE.CylinderGeometry(0.054, 0.044, 0.28, 8), darkMetalMat);
  forearmCore.position.set(0, -0.15, 0);
  forearmGroup.add(forearmCore);

  const forearmArmor = new THREE.Mesh(new THREE.BoxGeometry(0.108, 0.24, 0.115), chromeMat);
  forearmArmor.position.set(0.006, -0.15, 0.006);
  forearmGroup.add(forearmArmor);

  // Dual holographic shimmer veins along forearm
  const vein1 = new THREE.Mesh(new THREE.BoxGeometry(0.114, 0.18, 0.022), shimmerMagenta);
  vein1.position.set(0.006, -0.14, 0.032);
  forearmGroup.add(vein1);

  const vein2 = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.2, 0.12), shimmerCyan);
  vein2.position.set(0.035, -0.15, 0.006);
  forearmGroup.add(vein2);

  // Wrist servo cuff
  const wristCuff = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.046, 0.055, 8), darkMetalMat);
  wristCuff.position.set(0, -0.29, 0);
  forearmGroup.add(wristCuff);

  // Articulated chrome palm + fingers
  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.088, 0.095, 0.058), chromeMat);
  palm.position.set(0, -0.345, 0.012);
  forearmGroup.add(palm);

  for (let f = -1.5; f <= 1.5; f += 1) {
    const finger = new THREE.Mesh(new THREE.BoxGeometry(0.017, 0.068, 0.02), chromeMat);
    finger.position.set(f * 0.021, -0.41, 0.024);
    finger.rotation.x = 0.25;
    forearmGroup.add(finger);
  }

  armGroup.add(forearmGroup);
  return { armGroup, forearmGroup };
}

/**
 * Adds sculpted facial structure, cybernetic seams, eyewear, beard, and multi-layered hair to a head group.
 */
function decorateHead(
  head: THREE.Group,
  spec: CyberHumanoidSpec,
  skinMat: THREE.MeshStandardMaterial,
  hairMat: THREE.MeshStandardMaterial,
  accentMat: THREE.MeshStandardMaterial,
  darkMat: THREE.MeshStandardMaterial,
): void {
  // Sculpted cranium + lower jaw taper + nose bridge + brow ridge
  const cranium = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.24, 0.255), skinMat);
  cranium.position.set(0, 0.04, 0);
  head.add(cranium);

  const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.205, 0.115, 0.22), skinMat);
  jaw.position.set(0, -0.095, 0.015);
  head.add(jaw);

  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.075, 0.055), skinMat);
  nose.position.set(0, -0.005, 0.14);
  head.add(nose);

  const brow = new THREE.Mesh(new THREE.BoxGeometry(0.23, 0.036, 0.045), skinMat);
  brow.position.set(0, 0.06, 0.125);
  head.add(brow);

  // Ears
  for (const sx of [-0.132, 0.132]) {
    const ear = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.075, 0.05), skinMat);
    ear.position.set(sx, 0.01, -0.01);
    head.add(ear);
  }

  // Beard / goatee / stubble
  if (spec.beard === 'goatee') {
    const goateeMat = spec.hologram ? hairMat : makeStandardMat(0x151114, 0.85, 0.08);
    const mustache = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.024, 0.032), goateeMat);
    mustache.position.set(0, -0.056, 0.126);
    head.add(mustache);

    const chinBeard = new THREE.Mesh(new THREE.BoxGeometry(0.115, 0.075, 0.068), goateeMat);
    chinBeard.position.set(0, -0.115, 0.105);
    head.add(chinBeard);

    const jawShadow = new THREE.Mesh(new THREE.BoxGeometry(0.214, 0.065, 0.19), goateeMat);
    jawShadow.position.set(0, -0.105, 0.022);
    head.add(jawShadow);
  } else if (spec.beard === 'trimmed') {
    const beard = new THREE.Mesh(new THREE.BoxGeometry(0.215, 0.095, 0.185), hairMat);
    beard.position.set(0, -0.102, 0.042);
    head.add(beard);
  } else if (spec.beard === 'stubble') {
    const stubMat = makeStandardMat(0x3a2c26, 0.85, 0.05);
    const stub = new THREE.Mesh(new THREE.BoxGeometry(0.212, 0.072, 0.18), stubMat);
    stub.position.set(0, -0.104, 0.035);
    head.add(stub);
  }

  // Cybernetic facial seams
  if (spec.cyberSeamsColor !== undefined) {
    const seamMat = makeStandardMat(
      spec.cyberSeamsColor,
      0.22,
      0.9,
      spec.cyberSeamsColor,
      spec.hologram ? 1.5 : 1.15,
    );
    // Right cheek/temple seam (-X)
    const seamR = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.185, 0.028), seamMat);
    seamR.position.set(-0.108, -0.01, 0.122);
    head.add(seamR);
    // Jawline cyber-trace
    const jawSeam = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.014, 0.024), seamMat);
    jawSeam.position.set(-0.072, -0.092, 0.124);
    jawSeam.rotation.z = 0.24;
    head.add(jawSeam);
    // Subtle left cheek trace
    const seamL = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.135, 0.024), seamMat);
    seamL.position.set(0.108, -0.025, 0.12);
    head.add(seamL);
  }

  // Eyes / Eyewear
  const eyewear = spec.eyewear ?? 'none';
  if (eyewear === 'rodion_ocular') {
    // Bolt 1 Rodion exact crimson right ocular implant (-X) + natural left eye (+X)
    const orbitalRing = new THREE.Mesh(new THREE.TorusGeometry(0.044, 0.01, 6, 12), darkMat);
    orbitalRing.position.set(-0.062, 0.024, 0.134);
    head.add(orbitalRing);

    const cyberEye = new THREE.Mesh(
      new THREE.SphereGeometry(0.038, 10, 10),
      makeStandardMat(0xff003c, 0.15, 0.5, 0xff003c, 3.5),
    );
    cyberEye.position.set(-0.062, 0.024, 0.134);
    head.add(cyberEye);

    const naturalEye = new THREE.Mesh(
      new THREE.SphereGeometry(0.026, 8, 8),
      makeStandardMat(0x161a24, 0.2, 0.3),
    );
    naturalEye.position.set(0.062, 0.024, 0.132);
    head.add(naturalEye);
  } else if (eyewear === 'aviators') {
    const frameMat = makeStandardMat(0xc8d4e0, 0.2, 0.9);
    const lensMat = makeStandardMat(0x0b1622, 0.08, 0.85, spec.accent, spec.hologram ? 1.4 : 0.45);
    for (const ex of [-0.062, 0.062]) {
      const lens = new THREE.Mesh(new THREE.BoxGeometry(0.092, 0.068, 0.026), lensMat);
      lens.position.set(ex, 0.02, 0.142);
      head.add(lens);
      const rim = new THREE.Mesh(new THREE.BoxGeometry(0.102, 0.076, 0.018), frameMat);
      rim.position.set(ex, 0.02, 0.136);
      head.add(rim);
    }
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.014, 0.024), frameMat);
    bridge.position.set(0, 0.044, 0.144);
    head.add(bridge);
  } else if (eyewear === 'visor_blue' || eyewear === 'visor_red') {
    const visorHex = eyewear === 'visor_blue' ? 0x00f0ff : 0xff2244;
    const visorMat = new THREE.MeshStandardMaterial({
      color: visorHex,
      emissive: visorHex,
      emissiveIntensity: 1.9,
      roughness: 0.12,
      metalness: 0.75,
      transparent: true,
      opacity: 0.86,
    });
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.265, 0.072, 0.085), visorMat);
    visor.position.set(0, 0.028, 0.118);
    head.add(visor);
    const visorMount = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.026, 0.15), darkMat);
    visorMount.position.set(0, 0.058, 0.08);
    head.add(visorMount);
  } else if (eyewear === 'shades_gold') {
    const goldFrame = makeStandardMat(0xffb800, 0.2, 0.92, 0xffaa00, 0.5);
    const amberLens = makeStandardMat(0x552200, 0.1, 0.85, 0xff9900, 0.9);
    const shades = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.058, 0.04), amberLens);
    shades.position.set(0, 0.026, 0.138);
    head.add(shades);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.255, 0.016, 0.044), goldFrame);
    bar.position.set(0, 0.054, 0.14);
    head.add(bar);
  } else if (eyewear === 'ripper_loupes') {
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.275, 0.045, 0.275), darkMat);
    band.position.set(0, 0.072, 0.005);
    head.add(band);
    for (const ex of [-0.06, 0.06]) {
      const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.028, 0.085, 10), darkMat);
      scope.rotation.x = Math.PI / 2;
      scope.position.set(ex, 0.026, 0.158);
      head.add(scope);
      const lens = new THREE.Mesh(
        new THREE.CylinderGeometry(0.024, 0.024, 0.016, 10),
        makeStandardMat(0x00ffaa, 0.1, 0.4, 0x00ffaa, 2.6),
      );
      lens.rotation.x = Math.PI / 2;
      lens.position.set(ex, 0.026, 0.202);
      head.add(lens);
    }
  } else {
    // Natural eyes with subtle cybernetic glint
    for (const ex of [-0.062, 0.062]) {
      const sclera = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.026, 0.02), makeStandardMat(0xdce4ee, 0.3, 0.1));
      sclera.position.set(ex, 0.024, 0.125);
      head.add(sclera);
      const iris = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.024, 0.024), accentMat);
      iris.position.set(ex, 0.024, 0.128);
      head.add(iris);
    }
  }

  // Multi-layered Hair silhouettes
  if (spec.hairStyle === 'slick') {
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.275, 0.11, 0.295), hairMat);
    top.position.set(0, 0.165, -0.015);
    head.add(top);
    const sweep = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.065, 0.25), hairMat);
    sweep.position.set(0, 0.21, -0.04);
    sweep.rotation.x = -0.15;
    head.add(sweep);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.17, 0.08), hairMat);
    back.position.set(0, 0.06, -0.125);
    head.add(back);
  } else if (spec.hairStyle === 'long' || spec.hairStyle === 'flowing_glow') {
    const hMat =
      spec.hairStyle === 'flowing_glow'
        ? makeStandardMat(spec.hair, 0.25, 0.3, spec.hair, 1.8)
        : hairMat;
    // Center-parted crown
    for (const sx of [-0.072, 0.072]) {
      const crown = new THREE.Mesh(new THREE.BoxGeometry(0.145, 0.105, 0.29), hMat);
      crown.position.set(sx, 0.165, -0.01);
      crown.rotation.z = -Math.sign(sx) * 0.12;
      head.add(crown);
    }
    // Long shoulder-length side curtains framing face
    for (const sx of [-0.148, 0.148]) {
      const frontLock = new THREE.Mesh(new THREE.BoxGeometry(0.068, 0.34, 0.14), hMat);
      frontLock.position.set(sx, -0.01, 0.025);
      frontLock.rotation.z = Math.sign(sx) * 0.09;
      head.add(frontLock);

      const lowerLock = new THREE.Mesh(new THREE.BoxGeometry(0.074, 0.22, 0.13), hMat);
      lowerLock.position.set(sx * 1.06, -0.21, -0.02);
      lowerLock.rotation.z = Math.sign(sx) * 0.14;
      head.add(lowerLock);
    }
    // Flowing back hair cascading past neck onto shoulders
    const backHair = new THREE.Mesh(new THREE.BoxGeometry(0.31, 0.42, 0.11), hMat);
    backHair.position.set(0, -0.04, -0.135);
    backHair.rotation.x = 0.08;
    head.add(backHair);
  } else if (spec.hairStyle === 'silver_swept') {
    const crown = new THREE.Mesh(new THREE.BoxGeometry(0.268, 0.1, 0.285), hairMat);
    crown.position.set(0, 0.165, -0.015);
    head.add(crown);
    for (const sx of [-0.135, 0.135]) {
      const temple = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.12, 0.22), hairMat);
      temple.position.set(sx, 0.095, -0.03);
      head.add(temple);
    }
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.18, 0.075), hairMat);
    back.position.set(0, 0.05, -0.125);
    head.add(back);
  } else if (spec.hairStyle === 'spiky') {
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.265, 0.11, 0.28), hairMat);
    base.position.set(0, 0.16, -0.01);
    head.add(base);
    for (let i = -2; i <= 2; i++) {
      const spike = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.11, 0.16), hairMat);
      spike.position.set(i * 0.052, 0.22, 0.02 - Math.abs(i) * 0.02);
      spike.rotation.x = -0.28;
      head.add(spike);
    }
  } else if (spec.hairStyle === 'fade') {
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.095, 0.265), hairMat);
    top.position.set(0, 0.168, 0.0);
    head.add(top);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.255, 0.13, 0.065), hairMat);
    back.position.set(0, 0.08, -0.125);
    head.add(back);
  } else {
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.115, 0.28), hairMat);
    top.position.set(0, 0.162, -0.01);
    head.add(top);
  }
}

/**
 * Multi-layered procedural cyberpunk humanoid builder with articulated arms/forearms,
 * sculpted coats/vests, collars, belts, kneepads, and detailed heads.
 */
function createCyberHumanoid(spec: CyberHumanoidSpec): CharacterRig {
  const group = new THREE.Group();
  const holoMaterials: THREE.MeshStandardMaterial[] = [];
  const cyberShimmerMats: THREE.MeshStandardMaterial[] = [];
  const bulk = spec.bulk ?? 1.0;
  const shoulderW = (spec.shoulderWidth ?? 0.56) * bulk;

  const mat = (color: number, roughness = 0.52, metalness = 0.28, emissive = 0x000000, emissiveIntensity = 0) =>
    spec.hologram
      ? makeHoloMat(spec.accent, 0.56, 1.25, holoMaterials)
      : makeStandardMat(color, roughness, metalness, emissive, emissiveIntensity);

  const coatMat = mat(spec.coat, 0.42, 0.44, spec.coatEmissive ?? 0x000000, spec.coatEmissive ? 0.5 : 0);
  const shirtMat = mat(spec.shirt, 0.6, 0.22);
  const pantsMat = mat(spec.pants, 0.65, 0.2);
  const skinMat = mat(spec.skin, 0.62, 0.06);
  const accentMat = spec.hologram
    ? makeHoloMat(spec.accent, 0.85, 1.85, holoMaterials)
    : makeStandardMat(spec.accent, 0.22, 0.5, spec.accent, 1.45);
  const hairMat = mat(spec.hair, 0.72, 0.12);
  const darkMetalMat = mat(0x131722, 0.34, 0.78);

  // Legs with sculpted thighs, kneepads, shins, and heavy combat boots
  for (const sx of [-0.14 * bulk, 0.14 * bulk]) {
    const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.185 * bulk, 0.44, 0.21 * bulk), pantsMat);
    thigh.position.set(sx, 0.64, 0);
    group.add(thigh);

    const kneePad = new THREE.Mesh(new THREE.BoxGeometry(0.16 * bulk, 0.12, 0.235 * bulk), darkMetalMat);
    kneePad.position.set(sx, 0.46, 0.02);
    group.add(kneePad);

    const shin = new THREE.Mesh(new THREE.BoxGeometry(0.165 * bulk, 0.38, 0.185 * bulk), pantsMat);
    shin.position.set(sx, 0.26, -0.005);
    group.add(shin);

    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.195 * bulk, 0.15, 0.3), darkMetalMat);
    boot.position.set(sx, 0.075, 0.045);
    group.add(boot);

    const bootTrim = new THREE.Mesh(new THREE.BoxGeometry(0.2 * bulk, 0.032, 0.305), accentMat);
    bootTrim.position.set(sx, 0.02, 0.045);
    group.add(bootTrim);
  }

  // Pelvis & tactical utility belt
  const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.46 * bulk, 0.18, 0.26 * bulk), pantsMat);
  pelvis.position.set(0, 0.88, 0);
  group.add(pelvis);

  const belt = new THREE.Mesh(new THREE.BoxGeometry(0.5 * bulk, 0.075, 0.295 * bulk), darkMetalMat);
  belt.position.set(0, 0.94, 0);
  group.add(belt);

  const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.085, 0.05), accentMat);
  buckle.position.set(0, 0.94, 0.145 * bulk);
  group.add(buckle);

  // Articulated Torso group
  const torso = new THREE.Group();
  torso.position.set(0, 0.96, 0);

  // Tapered chest + waist
  const waistMesh = new THREE.Mesh(new THREE.BoxGeometry(0.45 * bulk, 0.24, 0.25 * bulk), coatMat);
  waistMesh.position.set(0, 0.12, 0);
  torso.add(waistMesh);

  const chestMesh = new THREE.Mesh(new THREE.BoxGeometry(shoulderW, 0.4, 0.29 * bulk), coatMat);
  chestMesh.position.set(0, 0.38, 0);
  torso.add(chestMesh);

  // Inner shirt / vest panel
  const innerShirt = new THREE.Mesh(new THREE.BoxGeometry(0.22 * bulk, 0.56, 0.305 * bulk), shirtMat);
  innerShirt.position.set(0, 0.3, 0.012);
  torso.add(innerShirt);

  // Tailored coat tails / trench skirt
  if (spec.coatTails) {
    const backTail = new THREE.Mesh(new THREE.BoxGeometry(0.52 * bulk, 0.44, 0.1), coatMat);
    backTail.position.set(0, -0.2, -0.11 * bulk);
    torso.add(backTail);
    for (const sx of [-0.21 * bulk, 0.21 * bulk]) {
      const sideTail = new THREE.Mesh(new THREE.BoxGeometry(0.15 * bulk, 0.4, 0.24 * bulk), coatMat);
      sideTail.position.set(sx, -0.18, -0.01);
      torso.add(sideTail);
    }
  }

  // Tactical armored chest vest plates
  if (spec.tacticalVest) {
    const plateF = new THREE.Mesh(new THREE.BoxGeometry(0.42 * bulk, 0.34, 0.33 * bulk), darkMetalMat);
    plateF.position.set(0, 0.36, 0.015);
    torso.add(plateF);
    for (const sx of [-0.15 * bulk, 0.15 * bulk]) {
      const strap = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.18, 0.32 * bulk), darkMetalMat);
      strap.position.set(sx, 0.54, 0.005);
      torso.add(strap);
    }
  }

  // Lapels & neo-cyber collar
  for (const sx of [-0.135 * bulk, 0.135 * bulk]) {
    const lapel = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.44, 0.045), accentMat);
    lapel.position.set(sx, 0.37, 0.15 * bulk);
    lapel.rotation.z = sx > 0 ? 0.12 : -0.12;
    torso.add(lapel);
  }

  const collarH = spec.highCollar ? 0.17 : 0.1;
  const collarBack = new THREE.Mesh(new THREE.BoxGeometry(0.44 * bulk, collarH, 0.07), accentMat);
  collarBack.position.set(0, 0.58 + collarH * 0.25, -0.12 * bulk);
  torso.add(collarBack);
  for (const sx of [-0.2 * bulk, 0.2 * bulk]) {
    const collarSide = new THREE.Mesh(new THREE.BoxGeometry(0.065, collarH, 0.25 * bulk), coatMat);
    collarSide.position.set(sx, 0.58 + collarH * 0.25, -0.01);
    torso.add(collarSide);
  }

  // Structured shoulder pauldrons
  for (const sx of [-shoulderW * 0.52, shoulderW * 0.52]) {
    const pad = new THREE.Mesh(new THREE.BoxGeometry(0.13 * bulk, 0.12, 0.3 * bulk), coatMat);
    pad.position.set(sx, 0.53, 0);
    pad.rotation.z = sx > 0 ? -0.18 : 0.18;
    torso.add(pad);
  }

  if (spec.goldChain) {
    const goldMat = makeStandardMat(0xffc433, 0.18, 0.94, 0xffaa00, 0.55);
    const chain = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.016, 6, 16, Math.PI), goldMat);
    chain.position.set(0, 0.54, 0.155 * bulk);
    chain.rotation.z = Math.PI;
    torso.add(chain);
  }

  // Neck
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.082, 0.14, 10), skinMat);
  neck.position.set(0, 0.64, 0.005);
  torso.add(neck);

  // Head
  const head = new THREE.Group();
  head.position.set(0, 0.82, 0.015);
  decorateHead(head, spec, skinMat, hairMat, accentMat, darkMetalMat);
  torso.add(head);

  // Articulated Anatomical LEFT Arm (+X = viewer's right when facing viewer)
  let leftArm: THREE.Group;
  let leftForearm: THREE.Group;
  let cyberArmGroup: THREE.Group | undefined;

  if (spec.chromeLeftArm) {
    const cyber = buildChromeCyberArm(cyberShimmerMats, holoMaterials, !!spec.hologram);
    leftArm = cyber.armGroup;
    leftForearm = cyber.forearmGroup;
    leftArm.position.set(shoulderW * 0.58, 0.5, 0);
    cyberArmGroup = leftArm;
  } else {
    leftArm = new THREE.Group();
    leftArm.position.set(shoulderW * 0.58, 0.5, 0);
    const lUpper = new THREE.Mesh(new THREE.BoxGeometry(0.14 * bulk, 0.31, 0.155 * bulk), coatMat);
    lUpper.position.y = -0.15;
    leftArm.add(lUpper);

    leftForearm = new THREE.Group();
    leftForearm.position.set(0, -0.31, 0);
    const lLower = new THREE.Mesh(new THREE.BoxGeometry(0.122 * bulk, 0.28, 0.135 * bulk), coatMat);
    lLower.position.y = -0.14;
    leftForearm.add(lLower);
    const lCuff = new THREE.Mesh(new THREE.BoxGeometry(0.13 * bulk, 0.04, 0.14 * bulk), accentMat);
    lCuff.position.y = -0.27;
    leftForearm.add(lCuff);
    const lHand = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.115, 0.075), skinMat);
    lHand.position.set(0, -0.34, 0.01);
    leftForearm.add(lHand);
    leftArm.add(leftForearm);
  }
  torso.add(leftArm);

  // Articulated Anatomical RIGHT Arm (-X = viewer's left when facing viewer)
  const rightArm = new THREE.Group();
  rightArm.position.set(-shoulderW * 0.58, 0.5, 0);
  const rUpper = new THREE.Mesh(new THREE.BoxGeometry(0.14 * bulk, 0.31, 0.155 * bulk), coatMat);
  rUpper.position.y = -0.15;
  rightArm.add(rUpper);

  const rightForearm = new THREE.Group();
  rightForearm.position.set(0, -0.31, 0);
  const rLower = new THREE.Mesh(new THREE.BoxGeometry(0.122 * bulk, 0.28, 0.135 * bulk), coatMat);
  rLower.position.y = -0.14;
  rightForearm.add(rLower);
  const rCuff = new THREE.Mesh(new THREE.BoxGeometry(0.13 * bulk, 0.04, 0.14 * bulk), accentMat);
  rCuff.position.y = -0.27;
  rightForearm.add(rCuff);
  const rHand = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.115, 0.075), skinMat);
  rHand.position.set(0, -0.34, 0.01);
  rightForearm.add(rHand);
  rightArm.add(rightForearm);
  torso.add(rightArm);

  group.add(torso);

  // Subtle holographic scan aura for hologram characters
  const auraRings: THREE.Object3D[] = [];
  if (spec.hologram) {
    const aura = new THREE.Mesh(
      new THREE.CylinderGeometry(0.46, 0.46, 1.92, 14, 1, true),
      new THREE.MeshBasicMaterial({
        color: spec.accent,
        transparent: true,
        opacity: 0.12,
        wireframe: true,
      }),
    );
    aura.position.y = 0.98;
    group.add(aura);

    const floorRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.48, 0.016, 8, 32),
      makeStandardMat(spec.accent, 0.2, 0.3, spec.accent, 2.0),
    );
    floorRing.rotation.x = Math.PI / 2;
    floorRing.position.y = 0.04;
    group.add(floorRing);
    auraRings.push(floorRing);
  }

  if (spec.scale) {
    group.scale.setScalar(spec.scale);
  }

  return {
    group,
    head,
    leftArm,
    rightArm,
    torso,
    leftForearm,
    rightForearm,
    cyberArmGroup,
    holoMaterials,
    cyberShimmerMats,
    auraRings,
  };
}

/**
 * Seated Samir on the Kok-Tobe Overlook concrete parapet — directly reconstructed from
 * IMG-20261123-WA0011.jpg (Silverhand rooftop pose).
 * Origin (0, 0, 0) rests flush on top of the concrete parapet ledge; character faces +Z.
 */
export function buildSeatedSamirRooftop(): CharacterRig {
  const group = new THREE.Group();
  const holoMaterials: THREE.MeshStandardMaterial[] = [];
  const cyberShimmerMats: THREE.MeshStandardMaterial[] = [];

  const skinMat = makeStandardMat(0xcfa080, 0.58, 0.06);
  const vestMat = makeStandardMat(0x13161f, 0.52, 0.32);
  const vestPlateMat = makeStandardMat(0x1b202d, 0.42, 0.48);
  const pantsMat = makeStandardMat(0x11131a, 0.58, 0.28);
  const bootMat = makeStandardMat(0x0c0e14, 0.45, 0.45);
  const beltMat = makeStandardMat(0x1d1a1c, 0.4, 0.55);
  const silverMat = makeStandardMat(0xdce6f2, 0.18, 0.94);
  const tattooMat = makeStandardMat(0x2d323b, 0.65, 0.12);
  const hairMat = makeStandardMat(0x0d0c12, 0.68, 0.14);
  const eyeAccentMat = makeStandardMat(0x1e2530, 0.2, 0.3);

  // Pelvis seated squarely on top of parapet (y = 0)
  const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.18, 0.34), pantsMat);
  pelvis.position.set(0, 0.09, 0.04);
  group.add(pelvis);

  // Studded rockstar leather belt + silver buckle
  const belt = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.068, 0.35), beltMat);
  belt.position.set(0, 0.18, 0.05);
  group.add(belt);
  const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.088, 0.064, 0.036), silverMat);
  buckle.position.set(0, 0.18, 0.228);
  group.add(buckle);
  for (let s = -3; s <= 3; s++) {
    if (s === 0) continue;
    const stud = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.02), silverMat);
    stud.position.set(s * 0.062, 0.18, 0.226);
    group.add(stud);
  }

  // Seated legs: thighs angled forward & apart over the parapet edge, knees bent down
  for (const side of [-1, 1]) {
    const hipGroup = new THREE.Group();
    hipGroup.position.set(side * 0.155, 0.09, 0.12);
    hipGroup.rotation.y = side * 0.22; // relaxed open knee stance

    const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.19, 0.46), pantsMat);
    thigh.position.set(0, -0.02, 0.22);
    thigh.rotation.x = 0.12;
    hipGroup.add(thigh);

    // Knee cap & strap
    const knee = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.17, 0.17), vestPlateMat);
    knee.position.set(0, -0.05, 0.44);
    hipGroup.add(knee);

    // Lower leg dropping straight down along the front face of the parapet
    const shin = new THREE.Mesh(new THREE.BoxGeometry(0.155, 0.48, 0.17), pantsMat);
    shin.position.set(0, -0.32, 0.46);
    shin.rotation.x = -0.06;
    hipGroup.add(shin);

    // Heavy laced combat boot
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.175, 0.16, 0.3), bootMat);
    boot.position.set(0, -0.58, 0.51);
    hipGroup.add(boot);

    const bootBuckle = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.03, 0.08), silverMat);
    bootBuckle.position.set(0, -0.51, 0.48);
    hipGroup.add(bootBuckle);

    group.add(hipGroup);
  }

  // Forward-leaning Torso (elbows resting near knees, intense eye contact with Ai)
  const torso = new THREE.Group();
  torso.position.set(0, 0.2, 0.04);
  torso.rotation.x = 0.2; // leaning forward!

  // Bare muscular upper chest & shoulders base
  const upperBodyBase = new THREE.Mesh(new THREE.BoxGeometry(0.47, 0.56, 0.25), skinMat);
  upperBodyBase.position.set(0, 0.3, 0);
  torso.add(upperBodyBase);

  // Black tactical ribbed tank / bulletproof vest over torso
  const vestCore = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.52, 0.285), vestMat);
  vestCore.position.set(0, 0.27, 0.005);
  torso.add(vestCore);

  // Ribbed Kevlar front plates & tactical utility straps
  for (let row = 0; row < 3; row++) {
    const rib = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.075, 0.302), vestPlateMat);
    rib.position.set(0, 0.14 + row * 0.105, 0.008);
    torso.add(rib);
  }
  for (const sx of [-0.155, 0.155]) {
    const shoulderStrap = new THREE.Mesh(new THREE.BoxGeometry(0.082, 0.15, 0.295), vestMat);
    shoulderStrap.position.set(sx, 0.52, 0.005);
    torso.add(shoulderStrap);
    const clip = new THREE.Mesh(new THREE.BoxGeometry(0.058, 0.04, 0.032), silverMat);
    clip.position.set(sx, 0.48, 0.155);
    torso.add(clip);
  }

  // Silver dog-tags hanging down Samir's chest
  const chainL = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.19, 0.01), silverMat);
  chainL.position.set(-0.045, 0.45, 0.16);
  chainL.rotation.z = 0.22;
  torso.add(chainL);
  const chainR = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.19, 0.01), silverMat);
  chainR.position.set(0.045, 0.45, 0.16);
  chainR.rotation.z = -0.22;
  torso.add(chainR);

  const tag1 = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.074, 0.01), silverMat);
  tag1.position.set(-0.01, 0.34, 0.168);
  tag1.rotation.z = 0.14;
  torso.add(tag1);
  const tag2 = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.074, 0.01), silverMat);
  tag2.position.set(0.018, 0.315, 0.172);
  tag2.rotation.z = -0.18;
  torso.add(tag2);

  // Muscular neck
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.082, 0.15, 10), skinMat);
  neck.position.set(0, 0.62, 0.01);
  torso.add(neck);

  // Sculpted Head counter-pitched so Samir gazes straight at Ai!
  const head = new THREE.Group();
  head.position.set(0, 0.79, 0.025);
  head.rotation.x = -0.16;
  decorateHead(
    head,
    {
      coat: 0x13161f,
      shirt: 0x13161f,
      pants: 0x11131a,
      skin: 0xcfa080,
      accent: 0x1e2530,
      hair: 0x0d0c12,
      hairStyle: 'long',
      eyewear: 'none',
      beard: 'goatee',
    },
    skinMat,
    hairMat,
    eyeAccentMat,
    vestPlateMat,
  );
  torso.add(head);

  // Bare muscular RIGHT Arm (-X = viewer's left) resting elbow near right knee
  const rightArm = new THREE.Group();
  rightArm.position.set(-0.29, 0.51, 0.01);
  rightArm.rotation.set(-0.42, 0.14, -0.12);

  const rDeltoid = new THREE.Mesh(new THREE.SphereGeometry(0.088, 10, 8), skinMat);
  rDeltoid.position.set(0, -0.02, 0);
  rightArm.add(rDeltoid);

  const rUpper = new THREE.Mesh(new THREE.CylinderGeometry(0.072, 0.062, 0.28, 10), skinMat);
  rUpper.position.set(0, -0.17, 0);
  rightArm.add(rUpper);

  // Upper arm tattoo band
  const rTat1 = new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.065, 0.06, 10), tattooMat);
  rTat1.position.set(0, -0.19, 0);
  rightArm.add(rTat1);

  const rightForearm = new THREE.Group();
  rightForearm.position.set(0, -0.31, 0);
  rightForearm.rotation.set(-0.78, 0, 0.42); // forearm angled inward across right thigh toward center

  const rLower = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.048, 0.27, 10), skinMat);
  rLower.position.set(0, -0.14, 0);
  rightForearm.add(rLower);

  // Forearm ink & leather wrist strap
  const rTat2 = new THREE.Mesh(new THREE.CylinderGeometry(0.056, 0.052, 0.09, 10), tattooMat);
  rTat2.position.set(0, -0.12, 0);
  rightForearm.add(rTat2);

  const rWristBand = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.05, 0.05, 10), beltMat);
  rWristBand.position.set(0, -0.255, 0);
  rightForearm.add(rWristBand);

  const rHand = new THREE.Mesh(new THREE.BoxGeometry(0.082, 0.105, 0.056), skinMat);
  rHand.position.set(0, -0.32, 0.01);
  rightForearm.add(rHand);

  rightArm.add(rightForearm);
  torso.add(rightArm);

  // Gleaming Chrome LEFT Cyber-Arm (+X = viewer's right, matching IMG-20261123-WA0011.jpg!)
  const cyber = buildChromeCyberArm(cyberShimmerMats, undefined, false);
  const leftArm = cyber.armGroup;
  const leftForearm = cyber.forearmGroup;
  leftArm.position.set(0.29, 0.51, 0.01);
  leftArm.rotation.set(-0.46, -0.12, 0.12);
  leftForearm.rotation.set(-0.72, 0, -0.38); // chrome elbow on left knee, chrome hand gesturing
  torso.add(leftArm);

  group.add(torso);

  return {
    group,
    head,
    torso,
    leftArm,
    rightArm,
    leftForearm,
    rightForearm,
    cyberArmGroup: leftArm,
    holoMaterials,
    cyberShimmerMats,
  };
}

/**
 * Standing Hologram Samir (Junkyard, Underground, Open World projections) —
 * rockstar tactical vest, aviators, shoulder-length hair, gleaming chrome left cyber-arm & scan aura.
 */
export function buildSamirHologram(): CharacterRig {
  const rig = createCyberHumanoid({
    coat: 0x0c1b29,
    shirt: 0x00f0ff,
    pants: 0x101826,
    skin: 0x62f4ff,
    accent: 0x00f0ff,
    hair: 0x08131d,
    hairStyle: 'long',
    eyewear: 'aviators',
    beard: 'goatee',
    tacticalVest: true,
    chromeLeftArm: true,
    hologram: true,
    scale: 1.02,
  });

  // Holographic dog-tags on chest
  if (rig.torso) {
    const tagMat = makeHoloMat(0x88ffff, 0.85, 2.0, rig.holoMaterials);
    const tag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, 0.015), tagMat);
    tag.position.set(0, 0.36, 0.185);
    rig.torso.add(tag);
  }

  return rig;
}

/**
 * Wounded Sanzhar sitting in the right passenger seat of Cyber-Akhmed during the chase / heist getaway,
 * holding a toggleable glowing Relic Biochip in his extended hand.
 * Origin (0, 0, 0) rests at seat cushion surface; character faces +Z (forward in cabin).
 */
export function buildSeatedSanzharTaxi(): CharacterRig {
  const group = new THREE.Group();
  const coatMat = makeStandardMat(0x2c1b13, 0.52, 0.32);
  const shirtMat = makeStandardMat(0x181c28, 0.65, 0.18);
  const pantsMat = makeStandardMat(0x1a1e2a, 0.7, 0.15);
  const skinMat = makeStandardMat(0xd4a27d, 0.62, 0.06);
  const accentMat = makeStandardMat(0xfcee0a, 0.25, 0.45, 0xfcee0a, 1.3);
  const hairMat = makeStandardMat(0x121218, 0.78, 0.1);
  const darkMetal = makeStandardMat(0x161b26, 0.38, 0.72);
  const bloodMat = makeStandardMat(0x8c0818, 0.35, 0.15, 0x3a0208, 0.35);

  // Seated hips & thighs
  const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.18, 0.34), pantsMat);
  pelvis.position.set(0, 0.09, 0.02);
  group.add(pelvis);

  for (const sx of [-0.145, 0.145]) {
    const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.185, 0.19, 0.44), pantsMat);
    thigh.position.set(sx, 0.07, 0.25);
    group.add(thigh);

    const shin = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.44, 0.175), pantsMat);
    shin.position.set(sx, -0.17, 0.44);
    shin.rotation.x = 0.12;
    group.add(shin);

    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.14, 0.28), darkMetal);
    boot.position.set(sx, -0.4, 0.5);
    group.add(boot);
  }

  // Slumped wounded torso leaning slightly toward the driver/player
  const torso = new THREE.Group();
  torso.position.set(0, 0.18, 0.0);
  torso.rotation.set(-0.14, -0.25, -0.09);

  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.58, 0.29), coatMat);
  chest.position.set(0, 0.3, 0);
  torso.add(chest);

  const innerShirt = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.52, 0.305), shirtMat);
  innerShirt.position.set(0, 0.3, 0.012);
  torso.add(innerShirt);

  // Visible crimson wound stain across lower jacket/shirt
  const bloodPatch = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.22, 0.02), bloodMat);
  bloodPatch.position.set(-0.07, 0.19, 0.16);
  torso.add(bloodPatch);

  // Iconic bright yellow street-merc collar
  const collar = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.13, 0.31), accentMat);
  collar.position.set(0, 0.59, -0.02);
  torso.add(collar);

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.072, 0.085, 0.13, 8), skinMat);
  neck.position.set(0, 0.65, 0.01);
  torso.add(neck);

  // Weary tilted head with cheek cyber-seam
  const head = new THREE.Group();
  head.position.set(0, 0.81, 0.03);
  head.rotation.set(0.18, -0.22, -0.12);
  decorateHead(
    head,
    {
      coat: 0x2c1b13,
      shirt: 0x181c28,
      pants: 0x1a1e2a,
      skin: 0xd4a27d,
      accent: 0xfcee0a,
      hair: 0x121218,
      hairStyle: 'fade',
      beard: 'stubble',
      cyberSeamsColor: 0xfcee0a,
    },
    skinMat,
    hairMat,
    accentMat,
    darkMetal,
  );
  torso.add(head);

  // Right arm (-X) clutching bleeding side
  const rightArm = new THREE.Group();
  rightArm.position.set(-0.31, 0.5, 0.02);
  rightArm.rotation.set(-0.48, 0.2, 0.24);
  const rUpper = new THREE.Mesh(new THREE.BoxGeometry(0.145, 0.3, 0.155), coatMat);
  rUpper.position.y = -0.14;
  rightArm.add(rUpper);
  const rightForearm = new THREE.Group();
  rightForearm.position.set(0, -0.29, 0);
  rightForearm.rotation.set(-0.95, 0, 0.68);
  const rLower = new THREE.Mesh(new THREE.BoxGeometry(0.125, 0.26, 0.135), coatMat);
  rLower.position.y = -0.13;
  rightForearm.add(rLower);
  const rHand = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.11, 0.07), bloodMat);
  rHand.position.set(0, -0.3, 0.01);
  rightForearm.add(rHand);
  rightArm.add(rightForearm);
  torso.add(rightArm);

  // Extended LEFT arm (+X) handing over the glowing Relic Biochip!
  const leftArm = new THREE.Group();
  leftArm.position.set(0.31, 0.5, 0.02);
  leftArm.rotation.set(-1.05, -0.35, -0.12);
  const lUpper = new THREE.Mesh(new THREE.BoxGeometry(0.145, 0.3, 0.155), coatMat);
  lUpper.position.y = -0.14;
  leftArm.add(lUpper);
  const leftForearm = new THREE.Group();
  leftForearm.position.set(0, -0.29, 0);
  leftForearm.rotation.set(-0.35, 0, -0.1);
  const lLower = new THREE.Mesh(new THREE.BoxGeometry(0.125, 0.26, 0.135), coatMat);
  lLower.position.y = -0.13;
  leftForearm.add(lLower);
  const lHand = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.11, 0.07), skinMat);
  lHand.position.set(0, -0.3, 0.015);
  leftForearm.add(lHand);

  const biochipProp = createBiochipProp(0x00f0ff);
  biochipProp.position.set(0, -0.36, 0.075);
  biochipProp.rotation.set(0.55, 0.25, 0.15);
  leftForearm.add(biochipProp);

  leftArm.add(leftForearm);
  torso.add(leftArm);
  group.add(torso);

  return {
    group,
    head,
    torso,
    leftArm,
    rightArm,
    leftForearm,
    rightForearm,
    biochipProp,
    setBiochipVisible: (visible: boolean) => {
      biochipProp.visible = visible;
    },
  };
}

/**
 * Standing Sanzhar — loyal heavy-built street-merc choomba in leather jacket & glowing yellow collar.
 */
export function buildSanzharModel(): CharacterRig {
  return createCyberHumanoid({
    coat: 0x2c1c14,
    shirt: 0x181c28,
    pants: 0x1a1e2a,
    skin: 0xd9a882,
    accent: 0xfcee0a,
    hair: 0x111116,
    hairStyle: 'fade',
    eyewear: 'none',
    beard: 'stubble',
    cyberSeamsColor: 0xfcee0a,
    tacticalVest: true,
    highCollar: true,
    bulk: 1.08,
    scale: 1.04,
  });
}

/**
 * Rodion Marakulin — exact port & upgrade of Bolt 1's OperatingTableScene rig:
 * tailored dark double-breasted corporate coat, crimson neo-corpo collar & lapel,
 * gold cybernetic facial seams, glowing crimson right ocular implant, slicked-back hair,
 * articulated hands capable of holding a toggleable glowing Soulkiller Biochip or choking!
 */
export function buildRodionModel(): CharacterRig {
  const rig = createCyberHumanoid({
    coat: 0x0d1018,
    shirt: 0x240710,
    pants: 0x0c0e16,
    skin: 0xc8a998,
    accent: 0x7c0a20,
    hair: 0x090a10,
    hairStyle: 'slick',
    eyewear: 'rodion_ocular',
    beard: 'none',
    cyberSeamsColor: 0xfcee0a,
    coatTails: true,
    highCollar: true,
    shoulderWidth: 0.6,
    scale: 1.06,
  });

  // Bolt 1 exact crimson neo-corpo lapel/tie & double-breasted gold buttons
  if (rig.torso) {
    const crimsonLapel = makeStandardMat(0x7c0a20, 0.3, 0.55, 0x440310, 0.85);
    const goldChrome = makeStandardMat(0xfcee0a, 0.2, 0.9, 0xffaa00, 1.5);

    const tiePanel = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.52, 0.04), crimsonLapel);
    tiePanel.position.set(0, 0.34, 0.152);
    rig.torso.add(tiePanel);

    const highCollar = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.2, 0.34), crimsonLapel);
    highCollar.position.set(0, 0.62, -0.015);
    rig.torso.add(highCollar);

    // Double-breasted gold buttons
    for (const bx of [-0.1, 0.1]) {
      for (const by of [0.16, 0.28, 0.4]) {
        const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.018, 8), goldChrome);
        btn.rotation.x = Math.PI / 2;
        btn.position.set(bx, by, 0.155);
        rig.torso.add(btn);
      }
    }
  }

  // Toggleable glowing Soulkiller Biochip prop mounted in Rodion's right hand (hidden by default for choking pose)
  const biochipProp = createBiochipProp(0x00f0ff);
  biochipProp.position.set(0, -0.4, 0.08);
  biochipProp.rotation.set(0.35, 0, 0);
  biochipProp.visible = false;
  if (rig.rightForearm) {
    rig.rightForearm.add(biochipProp);
  } else {
    rig.rightArm.add(biochipProp);
  }
  rig.biochipProp = biochipProp;
  rig.setBiochipVisible = (visible: boolean) => {
    biochipProp.visible = visible;
  };

  return rig;
}

/**
 * Lev Marakulin — elderly megacorp patriarch in ceremonial charcoal & gold-embroidered coat.
 */
export function buildLevMarakulinModel(): CharacterRig {
  const rig = createCyberHumanoid({
    coat: 0x161b2a,
    shirt: 0x3b2d18,
    pants: 0x111420,
    skin: 0xcab09c,
    accent: 0xffc44d,
    hair: 0xc8d0dc,
    hairStyle: 'silver_swept',
    eyewear: 'none',
    beard: 'trimmed',
    cyberSeamsColor: 0xffc44d,
    coatTails: true,
    highCollar: true,
    scale: 0.96,
  });
  // Slight aristocratic elderly forward tilt
  if (rig.torso) {
    rig.torso.rotation.x = 0.06;
  }
  return rig;
}

/**
 * Artem — flashy Cyber-Tastak fixer in plum synth-leather coat, gold chain, amber shades,
 * and a visible gleaming chrome pistol held in his right hand!
 */
export function buildArtemModel(): CharacterRig {
  const rig = createCyberHumanoid({
    coat: 0x2a0f2f,
    shirt: 0x48123b,
    pants: 0x161220,
    skin: 0xd7a88a,
    accent: 0xffb800,
    hair: 0x140e12,
    hairStyle: 'slick',
    eyewear: 'shades_gold',
    beard: 'stubble',
    cyberSeamsColor: 0xffb800,
    coatTails: true,
    highCollar: true,
    goldChain: true,
    bulk: 1.12,
    scale: 1.08,
  });

  // Visible gleaming chrome pistol in Artem's right hand
  const pistol = createChromePistolProp();
  pistol.position.set(0, -0.35, 0.075);
  pistol.rotation.set(0.25, 0, 0);
  if (rig.rightForearm) {
    rig.rightForearm.add(pistol);
    rig.rightForearm.rotation.x = -0.52;
  } else {
    rig.rightArm.add(pistol);
  }
  rig.rightArm.rotation.x = -0.32;
  rig.weaponProp = pistol;

  return rig;
}

/**
 * Heavy Bodyguard / Enforcer — imposing armored fixer/corpo muscle with glowing red tactical visor.
 */
export function buildBodyguardModel(): CharacterRig {
  const rig = createCyberHumanoid({
    coat: 0x141824,
    shirt: 0x0d1018,
    pants: 0x111520,
    skin: 0xc79b7e,
    accent: 0xff2a44,
    hair: 0x101218,
    hairStyle: 'short',
    eyewear: 'visor_red',
    beard: 'none',
    cyberSeamsColor: 0x6f7e99,
    tacticalVest: true,
    highCollar: true,
    bulk: 1.24,
    shoulderWidth: 0.64,
    scale: 1.12,
  });

  // Heavy armored shoulder pauldrons & forearm bracers
  const armorMat = makeStandardMat(0x1f2636, 0.32, 0.82);
  if (rig.leftForearm) {
    const bracerL = new THREE.Mesh(new THREE.BoxGeometry(0.165, 0.22, 0.175), armorMat);
    bracerL.position.y = -0.14;
    rig.leftForearm.add(bracerL);
  }
  if (rig.rightForearm) {
    const bracerR = new THREE.Mesh(new THREE.BoxGeometry(0.165, 0.22, 0.175), armorMat);
    bracerR.position.y = -0.14;
    rig.rightForearm.add(bracerR);
  }

  return rig;
}

/**
 * Taisiya Cyberspace Avatar — ethereal netrunner entity with glowing cyan flowing hair
 * and concentric animated neon rings orbiting her silhouette.
 */
export function buildTaisiyaCyberspaceModel(): CharacterRig {
  const rig = createCyberHumanoid({
    coat: 0x240b36,
    shirt: 0xff2a88,
    pants: 0x180828,
    skin: 0xffa6d8,
    accent: 0xff2a88,
    hair: 0x00f0ff,
    hairStyle: 'flowing_glow',
    eyewear: 'none',
    beard: 'none',
    cyberSeamsColor: 0x00f0ff,
    coatTails: true,
    hologram: true,
    shoulderWidth: 0.46,
    bulk: 0.9,
    scale: 1.05,
  });

  const cyanRingMat = makeStandardMat(0x00f0ff, 0.15, 0.4, 0x00f0ff, 2.4);
  const magRingMat = makeStandardMat(0xff2a88, 0.15, 0.4, 0xff2a88, 2.2);

  // Crown halo above head
  const crownHalo = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.022, 10, 32), cyanRingMat);
  crownHalo.position.set(0, 1.98, 0);
  crownHalo.rotation.x = Math.PI / 2;
  rig.group.add(crownHalo);

  // Orbiting oblique cyberspace rings around torso
  const midRing = new THREE.Mesh(new THREE.TorusGeometry(0.68, 0.018, 10, 36), magRingMat);
  midRing.position.set(0, 1.25, 0);
  midRing.rotation.set(1.15, 0.4, 0.25);
  rig.group.add(midRing);

  const outerRing = new THREE.Mesh(new THREE.TorusGeometry(0.84, 0.015, 10, 40), cyanRingMat);
  outerRing.position.set(0, 1.15, 0);
  outerRing.rotation.set(1.25, -0.55, -0.35);
  rig.group.add(outerRing);

  rig.auraRings = [...(rig.auraRings ?? []), crownHalo, midRing, outerRing];
  return rig;
}

/**
 * Egor — sharp sleek fixer/netrunner from Anti-cafe «Марум» in midnight trenchcoat & glowing blue visor.
 */
export function buildEgorModel(): CharacterRig {
  return createCyberHumanoid({
    coat: 0x0b1624,
    shirt: 0x11253a,
    pants: 0x0b1019,
    skin: 0xd7baa4,
    accent: 0x00f0ff,
    hair: 0x161d29,
    hairStyle: 'spiky',
    eyewear: 'visor_blue',
    beard: 'none',
    cyberSeamsColor: 0x00f0ff,
    coatTails: true,
    highCollar: true,
    shoulderWidth: 0.54,
    scale: 1.05,
  });
}

/**
 * Ripperdoc of «Марум» — cyberware surgeon with emerald multi-lens loupes & prosthetic surgical forearm.
 */
export function buildRipperdocModel(): CharacterRig {
  const rig = createCyberHumanoid({
    coat: 0x192c38,
    shirt: 0x0f1a24,
    pants: 0x141b26,
    skin: 0xd8ae8e,
    accent: 0x00ffaa,
    hair: 0x2a2f3a,
    hairStyle: 'short',
    eyewear: 'ripper_loupes',
    beard: 'trimmed',
    cyberSeamsColor: 0x00ffaa,
    coatTails: true,
    scale: 1.0,
  });

  // Surgical cyber-laser emitter on right forearm
  if (rig.rightForearm) {
    const toolHousing = new THREE.Mesh(
      new THREE.BoxGeometry(0.085, 0.16, 0.095),
      makeStandardMat(0x1f2e3a, 0.25, 0.85),
    );
    toolHousing.position.set(-0.04, -0.24, 0.04);
    rig.rightForearm.add(toolHousing);

    const laserTip = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, 0.09, 8),
      makeStandardMat(0x00ffaa, 0.15, 0.4, 0x00ffaa, 2.8),
    );
    laserTip.position.set(-0.04, -0.35, 0.05);
    rig.rightForearm.add(laserTip);
  }

  return rig;
}

/**
 * Animates holographic opacity flicker, chrome cyber-arm cyan-magenta shimmer, and ethereal cyberspace rings.
 */
export function animateHologramRig(rig: CharacterRig, elapsed: number): void {
  if (rig.holoMaterials && rig.holoMaterials.length > 0) {
    const pulse = 0.48 + Math.sin(elapsed * 7.5) * 0.1 + (Math.sin(elapsed * 37) > 0.92 ? -0.18 : 0);
    const clamped = Math.max(0.22, Math.min(0.78, pulse));
    for (const m of rig.holoMaterials) {
      m.opacity = clamped;
    }
  }

  if (rig.cyberShimmerMats && rig.cyberShimmerMats.length > 0) {
    rig.cyberShimmerMats.forEach((m, idx) => {
      const wave = 0.72 + Math.sin(elapsed * 4.2 + idx * Math.PI) * 0.35;
      m.emissiveIntensity = wave;
      m.opacity = 0.55 + Math.sin(elapsed * 5.8 + idx * 1.7) * 0.22;
    });
  }

  if (rig.auraRings && rig.auraRings.length > 0) {
    rig.auraRings.forEach((ring, i) => {
      ring.rotation.z = elapsed * (i % 2 === 0 ? 0.85 : -0.65);
      if (i > 0) {
        ring.rotation.y = elapsed * (0.45 + i * 0.2);
      }
    });
  }
}

/**
 * Animates seated rooftop Samir with lifelike breathing, attentive head nods,
 * chrome cyber-arm gestures, and subtle holographic shimmer.
 */
export function animateSeatedSamir(rig: CharacterRig, elapsed: number, intensity = 1.0): void {
  animateHologramRig(rig, elapsed);

  if (rig.torso) {
    rig.torso.rotation.x = 0.2 + Math.sin(elapsed * 1.45) * 0.025 * intensity;
    rig.torso.rotation.z = Math.sin(elapsed * 0.7) * 0.018 * intensity;
  }

  // Expressive conversational head motion
  rig.head.rotation.y = Math.sin(elapsed * 0.95) * 0.11 * intensity;
  rig.head.rotation.x = -0.16 + Math.sin(elapsed * 1.8) * 0.045 * intensity;
  rig.head.rotation.z = Math.cos(elapsed * 0.65) * 0.03 * intensity;

  // Expressive left chrome cyber-arm gesture while speaking
  rig.leftArm.rotation.x = -0.46 + Math.sin(elapsed * 1.65) * 0.08 * intensity;
  if (rig.leftForearm) {
    rig.leftForearm.rotation.x = -0.72 + Math.sin(elapsed * 2.2 + 0.5) * 0.12 * intensity;
  }

  // Subtle right arm weight shift
  rig.rightArm.rotation.x = -0.42 + Math.cos(elapsed * 1.2) * 0.04 * intensity;
}

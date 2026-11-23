import * as THREE from 'three';

export interface CharacterRig {
  group: THREE.Group;
  head: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  holoMaterials?: THREE.MeshStandardMaterial[];
}

interface HumanoidPalette {
  coat: number;
  shirt: number;
  pants: number;
  skin: number;
  accent: number;
  hair: number;
  glasses?: boolean;
  hologram?: boolean;
  scale?: number;
}

function createHumanoid(palette: HumanoidPalette): CharacterRig {
  const group = new THREE.Group();
  const holoMaterials: THREE.MeshStandardMaterial[] = [];

  const makeMat = (color: number, roughness = 0.55, metalness = 0.2, emissive = 0x000000, emissiveIntensity = 0) => {
    if (palette.hologram) {
      const m = new THREE.MeshStandardMaterial({
        color: palette.accent,
        emissive: palette.accent,
        emissiveIntensity: 1.25,
        transparent: true,
        opacity: 0.58,
        roughness: 0.2,
        metalness: 0.3,
        wireframe: false,
      });
      holoMaterials.push(m);
      return m;
    }
    return new THREE.MeshStandardMaterial({
      color,
      roughness,
      metalness,
      emissive,
      emissiveIntensity,
    });
  };

  const coatMat = makeMat(palette.coat, 0.5, 0.35);
  const shirtMat = makeMat(palette.shirt, 0.65, 0.15);
  const pantsMat = makeMat(palette.pants, 0.7, 0.15);
  const skinMat = makeMat(palette.skin, 0.6, 0.05);
  const accentMat = makeMat(palette.accent, 0.25, 0.4, palette.accent, palette.hologram ? 1.8 : 1.3);
  const hairMat = makeMat(palette.hair, 0.8, 0.1);

  // Legs
  for (const sx of [-0.13, 0.13]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.84, 0.2), pantsMat);
    leg.position.set(sx, 0.42, 0);
    group.add(leg);
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.14, 0.28), coatMat);
    boot.position.set(sx, 0.07, 0.04);
    group.add(boot);
  }

  // Torso & cyber-jacket
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.66, 0.28), coatMat);
  torso.position.set(0, 1.15, 0);
  group.add(torso);

  const innerShirt = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.56, 0.3), shirtMat);
  innerShirt.position.set(0, 1.15, 0.01);
  group.add(innerShirt);

  // Glowing cyberpunk collar
  const collar = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.11, 0.32), accentMat);
  collar.position.set(0, 1.46, -0.02);
  group.add(collar);

  // Arms
  const leftArm = new THREE.Group();
  leftArm.position.set(-0.33, 1.4, 0);
  const lMesh = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.62, 0.16), coatMat);
  lMesh.position.y = -0.28;
  leftArm.add(lMesh);
  const lHand = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.12), skinMat);
  lHand.position.y = -0.62;
  leftArm.add(lHand);
  group.add(leftArm);

  const rightArm = new THREE.Group();
  rightArm.position.set(0.33, 1.4, 0);
  const rMesh = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.62, 0.16), coatMat);
  rMesh.position.y = -0.28;
  rightArm.add(rMesh);
  const rHand = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.12), skinMat);
  rHand.position.y = -0.62;
  rightArm.add(rHand);
  group.add(rightArm);

  // Head
  const head = new THREE.Group();
  head.position.set(0, 1.66, 0);
  const skull = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.32, 0.28), skinMat);
  head.add(skull);

  const hair = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 0.3), hairMat);
  hair.position.set(0, 0.15, -0.01);
  head.add(hair);

  if (palette.glasses) {
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.08, 0.06), accentMat);
    visor.position.set(0, 0.03, 0.14);
    head.add(visor);
  } else {
    for (const ex of [-0.07, 0.07]) {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.04), accentMat);
      eye.position.set(ex, 0.03, 0.14);
      head.add(eye);
    }
  }
  group.add(head);

  if (palette.hologram) {
    // Wireframe hologram outer aura for Samir / Taisiya
    const aura = new THREE.Mesh(
      new THREE.CylinderGeometry(0.45, 0.45, 1.85, 12, 1, true),
      new THREE.MeshBasicMaterial({
        color: palette.accent,
        transparent: true,
        opacity: 0.16,
        wireframe: true,
      }),
    );
    aura.position.y = 0.95;
    group.add(aura);
  }

  if (palette.scale) {
    group.scale.setScalar(palette.scale);
  }

  return { group, head, leftArm, rightArm, holoMaterials };
}

export function buildSamirHologram(): CharacterRig {
  const rig = createHumanoid({
    coat: 0x0c1b29,
    shirt: 0x00f0ff,
    pants: 0x101826,
    skin: 0x62f4ff,
    accent: 0x00f0ff,
    hair: 0x08131d,
    glasses: true,
    hologram: true,
  });
  // Cyber-arm chrome glint (homage to Silverhand / Samir from Bolt 1)
  const cyberArm = new THREE.Mesh(
    new THREE.BoxGeometry(0.17, 0.64, 0.18),
    new THREE.MeshStandardMaterial({
      color: 0xff2a6d,
      emissive: 0xff2a6d,
      emissiveIntensity: 1.4,
      transparent: true,
      opacity: 0.65,
    }),
  );
  cyberArm.position.y = -0.28;
  rig.leftArm.add(cyberArm);
  return rig;
}

export function buildSanzharModel(): CharacterRig {
  return createHumanoid({
    coat: 0x2a1c14,
    shirt: 0x181c28,
    pants: 0x1a1e2a,
    skin: 0xd9a882,
    accent: 0xfcee0a,
    hair: 0x111116,
    glasses: false,
    scale: 1.04,
  });
}

/**
 * Rodion Marakulin — directly evolved from Bolt 1's OperatingTableScene rig.
 */
export function buildRodionModel(): CharacterRig {
  return createHumanoid({
    coat: 0x180b12,
    shirt: 0x260912,
    pants: 0x100b14,
    skin: 0xdec0a8,
    accent: 0xff003c,
    hair: 0x18141c,
    glasses: true,
    scale: 1.06,
  });
}

export function buildLevMarakulinModel(): CharacterRig {
  return createHumanoid({
    coat: 0x1a1e2c,
    shirt: 0x3b2f1c,
    pants: 0x12151f,
    skin: 0xcab09c,
    accent: 0xffc44d,
    hair: 0xc5ccd8,
    glasses: false,
    scale: 0.96,
  });
}

export function buildArtemModel(): CharacterRig {
  return createHumanoid({
    coat: 0x28102b,
    shirt: 0x451238,
    pants: 0x161220,
    skin: 0xd7a88a,
    accent: 0xffb800,
    hair: 0x140e12,
    glasses: true,
    scale: 1.08,
  });
}

export function buildTaisiyaCyberspaceModel(): CharacterRig {
  const rig = createHumanoid({
    coat: 0x240b36,
    shirt: 0xff2a88,
    pants: 0x180828,
    skin: 0xffa6d8,
    accent: 0xff2a88,
    hair: 0x00f0ff,
    glasses: false,
    hologram: true,
    scale: 1.05,
  });
  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(0.45, 0.03, 10, 28),
    new THREE.MeshBasicMaterial({ color: 0x00f0ff }),
  );
  halo.position.set(0, 1.98, 0);
  halo.rotation.x = Math.PI / 2;
  rig.group.add(halo);
  return rig;
}

export function buildEgorModel(): CharacterRig {
  return createHumanoid({
    coat: 0x0b1624,
    shirt: 0x11253a,
    pants: 0x0b1019,
    skin: 0xd7baa4,
    accent: 0x00f0ff,
    hair: 0x1c222e,
    glasses: true,
    scale: 1.05,
  });
}

export function buildRipperdocModel(): CharacterRig {
  return createHumanoid({
    coat: 0x192c38,
    shirt: 0x0f1a24,
    pants: 0x141b26,
    skin: 0xd8ae8e,
    accent: 0x00ffaa,
    hair: 0x2a2f3a,
    glasses: true,
    scale: 1.0,
  });
}

export function animateHologramRig(rig: CharacterRig, elapsed: number): void {
  if (!rig.holoMaterials) return;
  const pulse = 0.48 + Math.sin(elapsed * 7.5) * 0.1 + (Math.sin(elapsed * 37) > 0.92 ? -0.18 : 0);
  for (const m of rig.holoMaterials) {
    m.opacity = Math.max(0.2, Math.min(0.75, pulse));
  }
}

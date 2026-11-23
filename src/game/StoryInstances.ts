import * as THREE from 'three';
import type { InteractablePoint } from '../types/game';
import type { PhysicsWorld } from '../engine/Physics';
import type { ProceduralTextures } from '../engine/ProceduralTextures';
import {
  animateHologramRig,
  buildLevMarakulinModel,
  buildRodionModel,
  buildSamirHologram,
  buildSanzharModel,
  buildTaisiyaCyberspaceModel,
  type CharacterRig,
} from './CharacterModels';
import { ElevatorRig } from './ElevatorSystem';

export const INSTANCE_Y = {
  PENTHOUSE: 120,
  CHASE: 220,
  UNDERGROUND: -90,
  CYBERSPACE: 320,
  TALDYKORGAN: 420,
} as const;

/**
 * Isolated vertical story instances so all scripted set-pieces from Сценарий.odt
 * load instantaneously without conflicting with the 500x500m Cyber-Almaty chunk grid.
 */
export class StoryInstances {
  readonly interactables: InteractablePoint[] = [];

  // Penthouse (Act 2: 2 weeks ago)
  readonly penthouseGroup = new THREE.Group();
  readonly penthouseSanzhar: CharacterRig;
  readonly penthouseRodion: CharacterRig;
  readonly penthouseLev: CharacterRig;
  readonly penthouseSmasherProp = new THREE.Group();
  readonly biochipCase = new THREE.Group();
  readonly penthouseElevator: ElevatorRig;

  // Taxi Chase Highway (Act 3)
  readonly chaseGroup = new THREE.Group();
  private chaseArches: THREE.Mesh[] = [];

  // Marakulin Tower Assault & Underground Huyeshi (Acts 7-8)
  readonly undergroundGroup = new THREE.Group();
  readonly undergroundSamir: CharacterRig;
  readonly undergroundElevator: ElevatorRig;

  // Cyberspace & Taisiya (Act 9)
  readonly cyberspaceGroup = new THREE.Group();
  readonly taisiyaRig: CharacterRig;
  private cyberParticles!: THREE.Points;

  // Taldykorgan Road Epilogue (Act 10B)
  readonly taldykorganGroup = new THREE.Group();
  private taldyRoadPosts: THREE.Mesh[] = [];

  private physics: PhysicsWorld;
  private textures: ProceduralTextures;

  constructor(scene: THREE.Scene, physics: PhysicsWorld, textures: ProceduralTextures) {
    this.physics = physics;
    this.textures = textures;

    // Build Penthouse (Y = 120)
    this.penthouseSanzhar = buildSanzharModel();
    this.penthouseRodion = buildRodionModel();
    this.penthouseLev = buildLevMarakulinModel();
    this.penthouseElevator = new ElevatorRig(
      {
        id: 'penthouse_escape_elev',
        centerX: 0,
        centerZ: -38,
        startY: INSTANCE_Y.PENTHOUSE,
        endY: INSTANCE_Y.PENTHOUSE - 18,
        startFloorLabel: 92,
        endFloorLabel: 1,
        travelDuration: 3.4,
        doorFacingZ: 1,
      },
      this.penthouseGroup,
      physics,
      textures,
    );
    this.buildPenthouse();
    scene.add(this.penthouseGroup);

    // Build Chase Track (Y = 220)
    this.buildChaseTrack();
    scene.add(this.chaseGroup);

    // Build Marakulin Underground & Huyeshi (Y = -90)
    this.undergroundSamir = buildSamirHologram();
    this.undergroundElevator = new ElevatorRig(
      {
        id: 'tower_descent_elev',
        centerX: 0,
        centerZ: -30,
        startY: INSTANCE_Y.UNDERGROUND + 24,
        endY: INSTANCE_Y.UNDERGROUND,
        startFloorLabel: 1,
        endFloorLabel: -12,
        travelDuration: 3.6,
        doorFacingZ: 1,
      },
      this.undergroundGroup,
      physics,
      textures,
    );
    this.buildMarakulinUnderground();
    scene.add(this.undergroundGroup);

    // Build Cyberspace (Y = 320)
    this.taisiyaRig = buildTaisiyaCyberspaceModel();
    this.buildCyberspace();
    scene.add(this.cyberspaceGroup);

    // Build Taldykorgan Highway (Y = 420)
    this.buildTaldykorganRoad();
    scene.add(this.taldykorganGroup);

    this.setActiveInstance('NONE');
  }

  setActiveInstance(name: 'NONE' | 'PENTHOUSE' | 'CHASE' | 'UNDERGROUND' | 'CYBERSPACE' | 'TALDYKORGAN'): void {
    this.penthouseGroup.visible = name === 'PENTHOUSE';
    this.chaseGroup.visible = name === 'CHASE';
    this.undergroundGroup.visible = name === 'UNDERGROUND';
    this.cyberspaceGroup.visible = name === 'CYBERSPACE';
    this.taldykorganGroup.visible = name === 'TALDYKORGAN';
  }

  private buildPenthouse(): void {
    const y = INSTANCE_Y.PENTHOUSE;
    const floorMat = new THREE.MeshStandardMaterial({
      map: this.textures.getFloorTile('#fcee0a', 6, 8),
      roughness: 0.25,
      metalness: 0.5,
    });
    const wallMat = new THREE.MeshStandardMaterial({
      map: this.textures.getWallPanel('#fcee0a', 3, 1),
      roughness: 0.35,
      metalness: 0.55,
    });
    const darkGoldMat = new THREE.MeshStandardMaterial({
      color: 0x261d12,
      roughness: 0.35,
      metalness: 0.7,
    });

    // Main suite + escape corridor floor
    const floor = new THREE.Mesh(new THREE.BoxGeometry(26, 0.4, 56), floorMat);
    floor.position.set(0, y - 0.2, -10);
    this.penthouseGroup.add(floor);

    const ceil = new THREE.Mesh(new THREE.BoxGeometry(26, 0.4, 56), wallMat);
    ceil.position.set(0, y + 6.2, -10);
    this.penthouseGroup.add(ceil);

    // Perimeter walls
    const addW = (id: string, cx: number, cz: number, sx: number, sz: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, 6, sz), wallMat);
      m.position.set(cx, y + 3, cz);
      this.penthouseGroup.add(m);
      this.physics.addBox(id, cx, y + 3, cz, sx, 6, sz);
    };
    addW('ph_left', -12.6, -10, 0.8, 56);
    addW('ph_right', 12.6, -10, 0.8, 56);
    addW('ph_back', 0, 17.6, 26, 0.8);
    addW('ph_front_l', -7.5, -36, 10, 0.8);
    addW('ph_front_r', 7.5, -36, 10, 0.8);

    // Divider wall between Rodion's suite (Z: 0..17) and Escape Corridor (Z: -36..0)
    addW('ph_div_l', -7.5, -1.5, 10, 0.8);
    addW('ph_div_r', 7.5, -1.5, 10, 0.8);

    // Closet hideout on West side of suite
    const closet = new THREE.Mesh(new THREE.BoxGeometry(2.6, 3.2, 3.2), darkGoldMat);
    closet.position.set(-10.5, y + 1.6, 7);
    this.penthouseGroup.add(closet);

    // Pedestal & glowing Biochip Relic case
    const pedestal = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.1, 1.6), darkGoldMat);
    pedestal.position.set(0, y + 0.55, 6);
    this.penthouseGroup.add(pedestal);

    const caseMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.65, 0.25, 0.45),
      new THREE.MeshStandardMaterial({
        color: 0x00f0ff,
        emissive: 0x00f0ff,
        emissiveIntensity: 1.5,
      }),
    );
    caseMesh.position.set(0, y + 1.25, 6);
    this.biochipCase.add(caseMesh);
    this.penthouseGroup.add(this.biochipCase);

    // Cover blocks in escape corridor
    for (const [cx, cz, idx] of [
      [-4.2, -12, 1],
      [4.2, -18, 2],
      [-3.5, -26, 3],
      [3.5, -26, 4],
    ]) {
      const cov = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.35, 1.2), darkGoldMat);
      cov.position.set(cx, y + 0.68, cz);
      this.penthouseGroup.add(cov);
      this.physics.addBox(`ph_cov_${idx}`, cx, y + 0.68, cz, 3.4, 1.35, 1.2);
    }

    // Characters for Heist cutscene
    this.penthouseSanzhar.group.position.set(3.2, y, 10);
    this.penthouseSanzhar.group.rotation.y = Math.PI;
    this.penthouseGroup.add(this.penthouseSanzhar.group);

    this.penthouseRodion.group.position.set(0.8, y, 4.2);
    this.penthouseRodion.group.rotation.y = Math.PI * 0.8;
    this.penthouseRodion.group.visible = false;
    this.penthouseGroup.add(this.penthouseRodion.group);

    this.penthouseLev.group.position.set(-0.6, y, 4.2);
    this.penthouseLev.group.rotation.y = -Math.PI * 0.2;
    this.penthouseLev.group.visible = false;
    this.penthouseGroup.add(this.penthouseLev.group);

    // Imposing Smasher silhouette behind Rodion & Lev
    const smBody = new THREE.Mesh(
      new THREE.BoxGeometry(1.5, 2.8, 1.0),
      new THREE.MeshStandardMaterial({ color: 0x161922, metalness: 0.85, roughness: 0.25 }),
    );
    smBody.position.y = 1.4;
    const smVisor = new THREE.Mesh(
      new THREE.BoxGeometry(0.65, 0.16, 0.2),
      new THREE.MeshBasicMaterial({ color: 0xff003c }),
    );
    smVisor.position.set(0, 2.55, 0.45);
    this.penthouseSmasherProp.add(smBody, smVisor);
    this.penthouseSmasherProp.position.set(2.4, y, 2.0);
    this.penthouseSmasherProp.visible = false;
    this.penthouseGroup.add(this.penthouseSmasherProp);

    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(10, 2.6),
      new THREE.MeshBasicMaterial({
        map: this.textures.getNeonSign('ПЕНТХАУС РОДИОНА', 'МАРАКУЛИН ТАУЭР // 92 ЭТАЖ', '#fcee0a', '#ff003c'),
      }),
    );
    sign.position.set(0, y + 4.4, 17.1);
    sign.rotation.y = Math.PI;
    this.penthouseGroup.add(sign);

    const l1 = new THREE.PointLight(0xffdd88, 5, 30);
    l1.position.set(0, y + 5, 8);
    this.penthouseGroup.add(l1);
    const l2 = new THREE.PointLight(0xff2244, 5, 36);
    l2.position.set(0, y + 5, -20);
    this.penthouseGroup.add(l2);

    this.interactables.push(
      {
        id: 'heist_steal_biochip',
        label: '[E] УКРАСТЬ БИОЧИП ИЗ КЕЙСА РОДИОНА',
        x: 0,
        y: y + 1.2,
        z: 6,
        radius: 3.4,
        enabled: false,
        category: 'story',
      },
      {
        id: 'heist_hide_closet',
        label: '[E] СПРЯТАТЬСЯ В ШКАФ С САНЖАРОМ',
        x: -9.5,
        y: y + 1.2,
        z: 7,
        radius: 3.6,
        enabled: false,
        category: 'story',
      },
      {
        id: 'heist_elevator_btn',
        label: '[E] ВЫЗВАТЬ ЛИФТ В ГАРАЖ КИБЕР-АХМЕДА',
        x: 0,
        y: y + 1.2,
        z: -37.5,
        radius: 3.5,
        enabled: false,
        category: 'elevator',
      },
    );
  }

  private buildChaseTrack(): void {
    const y = INSTANCE_Y.CHASE;
    const roadMat = new THREE.MeshStandardMaterial({
      map: this.textures.getRoadSurface(1, 30),
      roughness: 0.4,
      metalness: 0.35,
    });
    const road = new THREE.Mesh(new THREE.PlaneGeometry(34, 380), roadMat);
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, y, -120);
    this.chaseGroup.add(road);

    const archMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff });
    for (let i = 0; i < 16; i++) {
      const arch = new THREE.Mesh(new THREE.TorusGeometry(16, 0.38, 6, 16, Math.PI), archMat);
      arch.position.set(0, y, 40 - i * 24);
      this.chaseGroup.add(arch);
      this.chaseArches.push(arch);
    }

    const l = new THREE.HemisphereLight(0x4488ff, 0x220a20, 1.4);
    this.chaseGroup.add(l);
  }

  private buildMarakulinUnderground(): void {
    const yLobby = INSTANCE_Y.UNDERGROUND + 24;
    const yCore = INSTANCE_Y.UNDERGROUND;

    const floorMat = new THREE.MeshStandardMaterial({
      map: this.textures.getFloorTile('#ff003c', 8, 12),
      roughness: 0.3,
      metalness: 0.55,
    });
    const wallMat = new THREE.MeshStandardMaterial({
      map: this.textures.getWallPanel('#ff003c', 4, 2),
      roughness: 0.4,
      metalness: 0.6,
    });
    const rackMat = new THREE.MeshStandardMaterial({
      map: this.textures.getServerRack(),
      roughness: 0.4,
      metalness: 0.65,
    });

    // --- UPPER LEVEL: Main Entrance Assault Hall (Y = -66) ---
    const lobbyFloor = new THREE.Mesh(new THREE.BoxGeometry(30, 0.4, 52), floorMat);
    lobbyFloor.position.set(0, yLobby - 0.2, -8);
    this.undergroundGroup.add(lobbyFloor);
    const lobbyCeil = new THREE.Mesh(new THREE.BoxGeometry(30, 0.4, 52), wallMat);
    lobbyCeil.position.set(0, yLobby + 7.2, -8);
    this.undergroundGroup.add(lobbyCeil);

    const addBox = (id: string, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, mat = wallMat) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
      m.position.set(cx, cy, cz);
      this.undergroundGroup.add(m);
      this.physics.addBox(id, cx, cy, cz, sx, sy, sz);
    };

    addBox('ug_l_w', -14.6, yLobby + 3.5, -8, 0.8, 7, 52);
    addBox('ug_l_e', 14.6, yLobby + 3.5, -8, 0.8, 7, 52);
    addBox('ug_l_s', 0, yLobby + 3.5, 17.6, 30, 7, 0.8);
    addBox('ug_l_nl', -8.8, yLobby + 3.5, -28.2, 12, 7, 0.8);
    addBox('ug_l_nr', 8.8, yLobby + 3.5, -28.2, 12, 7, 0.8);

    // Tactical pillars in lobby
    for (const [px, pz, idx] of [
      [-6, 4, 1],
      [6, 4, 2],
      [-6, -12, 3],
      [6, -12, 4],
    ]) {
      addBox(`ug_pil_${idx}`, px, yLobby + 3.5, pz, 2.2, 7, 2.2, rackMat);
    }

    const lobbySign = new THREE.Mesh(
      new THREE.PlaneGeometry(14, 3.2),
      new THREE.MeshBasicMaterial({
        map: this.textures.getNeonSign('МАРАКУЛИН ТАУЭР', 'ГЛАВНЫЙ ХОЛЛ // ОХРАНА КЛАССА А', '#ff003c', '#00f0ff'),
      }),
    );
    lobbySign.position.set(0, yLobby + 5.2, -27.5);
    this.undergroundGroup.add(lobbySign);

    const lobbyLight = new THREE.PointLight(0xff2244, 6, 45);
    lobbyLight.position.set(0, yLobby + 6, -4);
    this.undergroundGroup.add(lobbyLight);

    // Samir Hologram standing beside Ai at assault entrance
    this.undergroundSamir.group.position.set(2.4, yLobby, 10);
    this.undergroundSamir.group.rotation.y = Math.PI;
    this.undergroundGroup.add(this.undergroundSamir.group);

    // --- LOWER LEVEL: Smasher Boss Arena + Huyeshi Chamber (Y = -90) ---
    const arenaFloor = new THREE.Mesh(new THREE.BoxGeometry(44, 0.4, 72), floorMat);
    arenaFloor.position.set(0, yCore - 0.2, -62);
    this.undergroundGroup.add(arenaFloor);
    const arenaCeil = new THREE.Mesh(new THREE.BoxGeometry(44, 0.4, 72), wallMat);
    arenaCeil.position.set(0, yCore + 10.5, -62);
    this.undergroundGroup.add(arenaCeil);

    addBox('boss_w', -21.6, yCore + 5, -62, 0.8, 10, 72);
    addBox('boss_e', 21.6, yCore + 5, -62, 0.8, 10, 72);
    addBox('boss_n', 0, yCore + 5, -97.6, 44, 10, 0.8);
    addBox('boss_sl', -12.5, yCore + 5, -26.6, 19, 10, 0.8);
    addBox('boss_sr', 12.5, yCore + 5, -26.6, 19, 10, 0.8);

    // 4 massive server pillars for tactical cover during Rikhard Smasher boss fight
    for (const [px, pz, idx] of [
      [-10, -48, 1],
      [10, -48, 2],
      [-10, -72, 3],
      [10, -72, 4],
    ]) {
      addBox(`boss_col_${idx}`, px, yCore + 4, pz, 3.2, 8, 3.2, rackMat);
    }

    // HUYESHI (Mikoshi) Core Apparatus at North end of arena (Z = -90)
    const huyeshiBase = new THREE.Mesh(
      new THREE.CylinderGeometry(4.5, 5.2, 0.8, 16),
      new THREE.MeshStandardMaterial({
        color: 0x0b1526,
        emissive: 0x00f0ff,
        emissiveIntensity: 0.9,
      }),
    );
    huyeshiBase.position.set(0, yCore + 0.4, -90);
    this.undergroundGroup.add(huyeshiBase);

    const huyeshiRing = new THREE.Mesh(
      new THREE.TorusGeometry(3.8, 0.22, 12, 32),
      new THREE.MeshBasicMaterial({ color: 0x00f0ff }),
    );
    huyeshiRing.position.set(0, yCore + 3.6, -90);
    this.undergroundGroup.add(huyeshiRing);

    const huyeshiMonitor = new THREE.Mesh(
      new THREE.PlaneGeometry(6.4, 3.2),
      new THREE.MeshBasicMaterial({ map: this.textures.getHuyeshiMonitor() }),
    );
    huyeshiMonitor.position.set(0, yCore + 6.5, -96.8);
    this.undergroundGroup.add(huyeshiMonitor);

    const bossLight1 = new THREE.PointLight(0xff003c, 7, 55);
    bossLight1.position.set(0, yCore + 8.5, -58);
    this.undergroundGroup.add(bossLight1);

    const huyeshiLight = new THREE.PointLight(0x00f0ff, 6, 35);
    huyeshiLight.position.set(0, yCore + 5, -90);
    this.undergroundGroup.add(huyeshiLight);

    this.interactables.push(
      {
        id: 'tower_elevator_down',
        label: '[E] СПУСТИТЬСЯ НА ЛИФТЕ К КОМПЛЕКСУ «ХУЕШИ»',
        x: 0,
        y: yLobby + 1.2,
        z: -29.5,
        radius: 3.6,
        enabled: false,
        category: 'elevator',
      },
      {
        id: 'smasher_execute',
        label: '[E] ДОБИТЬ РИХАРДА СМЭШЕРА ИЗ MALORIAN S-3516',
        x: 0,
        y: yCore + 1.2,
        z: -62,
        radius: 5.5,
        enabled: false,
        category: 'story',
      },
      {
        id: 'huyeshi_jack_in',
        label: '[E] ПОДКЛЮЧИТЬСЯ К АППАРАТУ «ХУЕШИ»',
        x: 0,
        y: yCore + 1.5,
        z: -90,
        radius: 4.5,
        enabled: false,
        category: 'story',
      },
    );
  }

  private buildCyberspace(): void {
    const y = INSTANCE_Y.CYBERSPACE;

    // Glowing digital bridge
    const bridge = new THREE.Mesh(
      new THREE.BoxGeometry(8, 0.3, 46),
      new THREE.MeshStandardMaterial({
        color: 0x091628,
        emissive: 0x00f0ff,
        emissiveIntensity: 0.75,
      }),
    );
    bridge.position.set(0, y - 0.15, -12);
    this.cyberspaceGroup.add(bridge);

    // Floating wireframe grid & data monoliths
    const grid = new THREE.GridHelper(160, 40, 0xff0055, 0x00f0ff);
    grid.position.set(0, y - 4, -12);
    this.cyberspaceGroup.add(grid);

    const monoMat = new THREE.MeshBasicMaterial({ color: 0xff004c, wireframe: true });
    for (let i = 0; i < 16; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const mono = new THREE.Mesh(new THREE.BoxGeometry(3.2, 18 + (i % 4) * 6, 3.2), monoMat);
      mono.position.set(side * (12 + (i % 3) * 7), y + 4, 8 - i * 4.5);
      this.cyberspaceGroup.add(mono);
    }

    // Floating digital particles
    const count = 420;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 60;
      pos[i * 3 + 1] = y + Math.random() * 24 - 2;
      pos[i * 3 + 2] = -40 + Math.random() * 60;
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.cyberParticles = new THREE.Points(
      pGeo,
      new THREE.PointsMaterial({ color: 0x00f0ff, size: 0.25, transparent: true, opacity: 0.85 }),
    );
    this.cyberspaceGroup.add(this.cyberParticles);

    // Taisiya waiting at end of the bridge
    this.taisiyaRig.group.position.set(0, y, -26);
    this.cyberspaceGroup.add(this.taisiyaRig.group);

    // Two choice portals behind Taisiya
    const portalAi = new THREE.Mesh(
      new THREE.TorusGeometry(2.2, 0.15, 10, 28),
      new THREE.MeshBasicMaterial({ color: 0x00f0ff }),
    );
    portalAi.position.set(-4.5, y + 2.4, -32);
    this.cyberspaceGroup.add(portalAi);

    const portalSamir = new THREE.Mesh(
      new THREE.TorusGeometry(2.2, 0.15, 10, 28),
      new THREE.MeshBasicMaterial({ color: 0xff2a6d }),
    );
    portalSamir.position.set(4.5, y + 2.4, -32);
    this.cyberspaceGroup.add(portalSamir);
  }

  private buildTaldykorganRoad(): void {
    const y = INSTANCE_Y.TALDYKORGAN;
    const steppe = new THREE.Mesh(
      new THREE.PlaneGeometry(360, 360),
      new THREE.MeshStandardMaterial({ color: 0x2a1810, roughness: 0.95 }),
    );
    steppe.rotation.x = -Math.PI / 2;
    steppe.position.set(0, y - 0.05, -80);
    this.taldykorganGroup.add(steppe);

    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(16, 360),
      new THREE.MeshStandardMaterial({ map: this.textures.getRoadSurface(1, 24), roughness: 0.6 }),
    );
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, y, -80);
    this.taldykorganGroup.add(road);

    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(12, 3.2),
      new THREE.MeshBasicMaterial({
        map: this.textures.getNeonSign('ТАЛДЫКОРГАН → 280 КМ', 'ДОБРО ПОЖАЛОВАТЬ В ГОРОД-АД', '#ff6600', '#fcee0a'),
      }),
    );
    sign.position.set(11, y + 4.5, -26);
    this.taldykorganGroup.add(sign);

    const postMat = new THREE.MeshBasicMaterial({ color: 0xff6600 });
    for (let i = 0; i < 14; i++) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, 3.5, 0.4), postMat);
      post.position.set(i % 2 === 0 ? -9.5 : 9.5, y + 1.75, 20 - i * 18);
      this.taldykorganGroup.add(post);
      this.taldyRoadPosts.push(post);
    }

    const sun = new THREE.Mesh(
      new THREE.CircleGeometry(28, 32),
      new THREE.MeshBasicMaterial({ color: 0xff4500 }),
    );
    sun.position.set(0, y + 32, -210);
    this.taldykorganGroup.add(sun);
  }

  setInteractableEnabled(id: string, enabled: boolean): void {
    const it = this.interactables.find((i) => i.id === id);
    if (it) it.enabled = enabled;
  }

  updateInteractablePos(id: string, x: number, y: number, z: number): void {
    const it = this.interactables.find((i) => i.id === id);
    if (it) {
      it.x = x;
      it.y = y;
      it.z = z;
    }
  }

  update(dt: number, elapsed: number): void {
    if (this.chaseGroup.visible) {
      for (const arch of this.chaseArches) {
        arch.position.z += dt * 58;
        if (arch.position.z > 50) arch.position.z -= 16 * 24;
      }
    }
    if (this.undergroundGroup.visible) {
      animateHologramRig(this.undergroundSamir, elapsed);
    }
    if (this.cyberspaceGroup.visible) {
      animateHologramRig(this.taisiyaRig, elapsed);
      this.cyberParticles.rotation.y = elapsed * 0.08;
    }
    if (this.taldykorganGroup.visible) {
      for (const p of this.taldyRoadPosts) {
        p.position.z += dt * 32;
        if (p.position.z > 30) p.position.z -= 14 * 18;
      }
    }
  }
}

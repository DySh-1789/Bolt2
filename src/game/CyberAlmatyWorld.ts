import * as THREE from 'three';
import { WORLD_HALF, WORLD_SIZE, type InteractablePoint, type Vec3 } from '../types/game';
import type { ChunkManager } from '../engine/ChunkManager';
import type { PhysicsWorld } from '../engine/Physics';
import type { ProceduralTextures } from '../engine/ProceduralTextures';
import {
  animateHologramRig,
  buildArtemModel,
  buildEgorModel,
  buildRipperdocModel,
  buildSamirHologram,
  type CharacterRig,
} from './CharacterModels';

export interface CityBlockRect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  color: string;
}

/**
 * Builds the 500x500m semi-open world of Cyber-Almaty streamed via ChunkManager (10x10 chunks of 50x50m):
 * - 5 distinct districts: Cyber-Tastak, Prospekt Abaya / Eblanhana (Anti-cafe Marum), Junkyard,
 *   Marakulin Tower Plaza, Lower Quarter & Kok-Tobe Overlook Rooftop.
 * - Always-visible landmark layer: Marakulin Tower upper spire, Kok-Tobe TV Tower, Zailiyskiy Alatau mountains.
 */
export class CyberAlmatyWorld {
  readonly interactables: InteractablePoint[] = [];
  readonly minimapBuildings: CityBlockRect[] = [];
  readonly rooftopPos: Vec3 = { x: 165, y: 36, z: 165 };
  readonly marumPos: Vec3 = { x: -46, y: 0, z: -40 };
  readonly junkyardWakePos: Vec3 = { x: -165, y: 0, z: 165 };
  readonly motelRoomPos: Vec3 = { x: -165, y: 0, z: -162 };
  readonly motelSinkPos: Vec3 = { x: -172, y: 0, z: -170 };
  readonly towerEntrancePos: Vec3 = { x: 170, y: 0, z: -136 };

  private samirRooftopRig!: CharacterRig;
  private samirJunkyardRig!: CharacterRig;
  private egorMarumRig!: CharacterRig;
  private artemCorpseGroup = new THREE.Group();
  private hologramSigns: THREE.Mesh[] = [];

  private chunks: ChunkManager;
  private physics: PhysicsWorld;
  private textures: ProceduralTextures;

  constructor(chunks: ChunkManager, physics: PhysicsWorld, textures: ProceduralTextures) {
    this.chunks = chunks;
    this.physics = physics;
    this.textures = textures;

    this.buildGlobalGroundAndRoads();
    this.buildSkylineLandmarks();
    this.buildMarumAntiCafe();
    this.buildArtemMotel();
    this.buildJunkyardDistrict();
    this.buildMarakulinTowerPlaza();
    this.buildKokTobeOverlookBuilding();
    this.buildProceduralCityBlocks();
    this.buildStreetFurniture();
    this.registerInteractables();
  }

  private buildGlobalGroundAndRoads(): void {
    // Base 500x500 asphalt ground plane in landmark layer so horizon never shows holes
    const groundMat = new THREE.MeshStandardMaterial({
      map: this.textures.getCyberAsphalt(36, 36),
      roughness: 0.72,
      metalness: 0.25,
    });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(WORLD_SIZE + 40, WORLD_SIZE + 40), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    this.chunks.addLandmark(ground);

    // Outer world boundary colliders (always active so player/taxi stays in 500x500m city)
    const wallH = 26;
    this.physics.addBox('city_bound_n', 0, wallH / 2, -WORLD_HALF, WORLD_SIZE + 4, wallH, 4, {
      blocksSight: false,
    });
    this.physics.addBox('city_bound_s', 0, wallH / 2, WORLD_HALF, WORLD_SIZE + 4, wallH, 4, {
      blocksSight: false,
    });
    this.physics.addBox('city_bound_w', -WORLD_HALF, wallH / 2, 0, 4, wallH, WORLD_SIZE + 4, {
      blocksSight: false,
    });
    this.physics.addBox('city_bound_e', WORLD_HALF, wallH / 2, 0, 4, wallH, WORLD_SIZE + 4, {
      blocksSight: false,
    });

    // Global ambient lighting for night-neon Cyber-Almaty
    const hemi = new THREE.HemisphereLight(0x5278b8, 0x1c1028, 1.05);
    this.chunks.addLandmark(hemi);
    const moonDir = new THREE.DirectionalLight(0x88b8ff, 0.75);
    moonDir.position.set(120, 220, 180);
    this.chunks.addLandmark(moonDir);

    // Road strips (Prospekt Abaya Z=0, Seifullin Ave X=0, Secondary X=±120, Z=±120, Outer Ring ±215)
    const roadMatEW = new THREE.MeshStandardMaterial({
      map: this.textures.getRoadSurface(1, 22),
      roughness: 0.48,
      metalness: 0.35,
    });
    const roadMatNS = new THREE.MeshStandardMaterial({
      map: this.textures.getRoadSurface(1, 22),
      roughness: 0.48,
      metalness: 0.35,
    });

    const addRoadNS = (x: number, width: number, len = 460) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(width, len), roadMatNS);
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, 0.02, 0);
      this.chunks.addLandmark(m);
    };
    const addRoadEW = (z: number, width: number, len = 460) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(width, len), roadMatEW);
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = Math.PI / 2;
      m.position.set(0, 0.03, z);
      this.chunks.addLandmark(m);
    };

    // Primary cross boulevards
    addRoadEW(0, 24, 460); // Prospekt Abaya
    addRoadNS(0, 24, 460); // Prospekt Dostyk / Seifullin
    // Secondary avenues
    addRoadEW(-115, 16, 440);
    addRoadEW(115, 16, 440);
    addRoadNS(-115, 16, 440);
    addRoadNS(115, 16, 440);
    // Outer ring boulevard
    addRoadEW(-220, 18, 460);
    addRoadEW(220, 18, 460);
    addRoadNS(-220, 18, 460);
    addRoadNS(220, 18, 460);
  }

  private buildSkylineLandmarks(): void {
    // 1. Zailiyskiy Alatau snowy mountain ridge on South horizon (Z = +360)
    const mtnMat = new THREE.MeshBasicMaterial({
      map: this.textures.getAlmatyMountainSkyline(),
      transparent: true,
      opacity: 0.96,
      side: THREE.DoubleSide,
      fog: false,
    });
    const mtnWall = new THREE.Mesh(new THREE.PlaneGeometry(1100, 340), mtnMat);
    mtnWall.position.set(0, 130, 390);
    mtnWall.rotation.y = Math.PI;
    this.chunks.addLandmark(mtnWall);

    // 3D stylized low-poly Alatau peaks in front of backdrop for real parallax!
    const peakMat = new THREE.MeshStandardMaterial({
      color: 0x131d38,
      emissive: 0x0a1c3b,
      emissiveIntensity: 0.35,
      roughness: 0.85,
      metalness: 0.15,
    });
    const peakCoords: Array<[number, number, number, number]> = [
      [-260, 340, 135, 145],
      [-110, 355, 160, 185],
      [60, 365, 175, 210],
      [230, 345, 145, 165],
    ];
    for (const [px, pz, r, h] of peakCoords) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(r, h, 5), peakMat);
      cone.position.set(px, h * 0.45, pz);
      this.chunks.addLandmark(cone);
    }

    // 2. Iconic glowing Kok-Tobe TV Tower (South-East hill behind the city)
    const kokTobe = new THREE.Group();
    kokTobe.position.set(95, 0, 305);
    const towerBase = new THREE.Mesh(
      new THREE.CylinderGeometry(3.2, 8.5, 120, 8),
      new THREE.MeshStandardMaterial({ color: 0x1c2742, metalness: 0.7, roughness: 0.35 }),
    );
    towerBase.position.y = 60;
    kokTobe.add(towerBase);

    const obsDeck = new THREE.Mesh(
      new THREE.CylinderGeometry(11, 9, 14, 10),
      new THREE.MeshStandardMaterial({
        color: 0x00f0ff,
        emissive: 0x00f0ff,
        emissiveIntensity: 1.5,
      }),
    );
    obsDeck.position.y = 122;
    kokTobe.add(obsDeck);

    const spire = new THREE.Mesh(
      new THREE.CylinderGeometry(0.6, 3, 95, 8),
      new THREE.MeshBasicMaterial({ color: 0xff2a6d }),
    );
    spire.position.y = 175;
    kokTobe.add(spire);
    this.chunks.addLandmark(kokTobe);

    // 3. Distant horizon ring wall of mega-city silhouettes on N/W/E
    const skyMat = new THREE.MeshBasicMaterial({
      map: this.textures.getAlmatyMountainSkyline(),
      opacity: 0.5,
      transparent: true,
      side: THREE.DoubleSide,
      fog: false,
    });
    const northHorizon = new THREE.Mesh(new THREE.PlaneGeometry(1100, 260), skyMat);
    northHorizon.position.set(0, 100, -390);
    this.chunks.addLandmark(northHorizon);
  }

  /**
   * Anti-cafe "Marum" — legendary hub of Eblanhana on Prospekt Abaya (X=-46, Z=-40).
   */
  private buildMarumAntiCafe(): void {
    const cx = -46;
    const cz = -40;
    const group = new THREE.Group();

    const wallMat = new THREE.MeshStandardMaterial({
      map: this.textures.getWallPanel('#00f0ff', 2, 1),
      roughness: 0.45,
      metalness: 0.5,
    });
    const floorMat = new THREE.MeshStandardMaterial({
      map: this.textures.getFloorTile('#fcee0a', 4, 4),
      roughness: 0.3,
      metalness: 0.4,
    });

    // Floor & roof
    const floor = new THREE.Mesh(new THREE.BoxGeometry(24, 0.3, 22), floorMat);
    floor.position.set(cx, 0.12, cz);
    group.add(floor);

    const roof = new THREE.Mesh(new THREE.BoxGeometry(25, 1.2, 23), wallMat);
    roof.position.set(cx, 7.2, cz);
    group.add(roof);

    // Back, left, right walls (open front facing +Z toward Prospekt Abaya!)
    const addWall = (id: string, wx: number, wz: number, sx: number, sz: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, 7, sz), wallMat);
      m.position.set(wx, 3.5, wz);
      group.add(m);
      this.chunks.addChunkCollider(this.physics, id, wx, 3.5, wz, sx, 7, sz);
    };
    addWall('marum_back', cx, cz - 10.6, 24, 0.8);
    addWall('marum_left', cx - 11.6, cz, 0.8, 22);
    addWall('marum_right', cx + 11.6, cz, 0.8, 22);
    // Front pillars flanking wide entrance
    addWall('marum_front_l', cx - 8.2, cz + 10.6, 7, 0.8);
    addWall('marum_front_r', cx + 8.2, cz + 10.6, 7, 0.8);

    // Giant neon sign above entrance
    const signMat = new THREE.MeshBasicMaterial({
      map: this.textures.getNeonSign(
        'АНТИКАФЕ «МАРУМ»',
        'ЛЕГЕНДЫ ЕБЛАНХАНЫ // РИПЕРДОК & ЗАКАЗЫ',
        '#00f0ff',
        '#fcee0a',
      ),
    });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(18, 4.2), signMat);
    sign.position.set(cx, 9.8, cz + 11.2);
    group.add(sign);
    this.hologramSigns.push(sign);

    // Interior: bar counter, cozy neon sofas, Ripperdoc station, Gig terminal
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(8, 1.1, 1.8),
      new THREE.MeshStandardMaterial({ color: 0x1c253d, metalness: 0.6, roughness: 0.35 }),
    );
    bar.position.set(cx, 0.65, cz - 7.2);
    group.add(bar);
    this.chunks.addChunkCollider(this.physics, 'marum_bar', cx, 0.65, cz - 7.2, 8, 1.1, 1.8);

    const ripperChair = new THREE.Mesh(
      new THREE.BoxGeometry(2.2, 1.2, 2.8),
      new THREE.MeshStandardMaterial({
        color: 0x112b38,
        emissive: 0x00ffaa,
        emissiveIntensity: 0.45,
      }),
    );
    ripperChair.position.set(cx - 7.5, 0.7, cz - 4);
    group.add(ripperChair);

    const ripperNpc = buildRipperdocModel();
    ripperNpc.group.position.set(cx - 5.8, 0.25, cz - 4);
    ripperNpc.group.rotation.y = Math.PI * 0.5;
    group.add(ripperNpc.group);

    // Gig terminal
    const gigTerm = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 2.1, 0.8),
      new THREE.MeshStandardMaterial({
        color: 0x101828,
        emissive: 0xfcee0a,
        emissiveIntensity: 0.7,
      }),
    );
    gigTerm.position.set(cx + 7.2, 1.15, cz - 3);
    group.add(gigTerm);

    // Egor model (hidden until Marum epilogue!)
    this.egorMarumRig = buildEgorModel();
    this.egorMarumRig.group.position.set(cx, 0.25, cz + 1.5);
    this.egorMarumRig.group.rotation.y = Math.PI;
    this.egorMarumRig.group.visible = false;
    group.add(this.egorMarumRig.group);

    // Warm cyberpunk lounge light
    const light = new THREE.PointLight(0x00e5ff, 4.5, 28);
    light.position.set(cx, 5.5, cz);
    this.chunks.addToChunk(cx, cz, light);

    this.chunks.addToChunk(cx, cz, group);
    this.minimapBuildings.push({
      minX: cx - 12,
      maxX: cx + 12,
      minZ: cz - 11,
      maxZ: cz + 11,
      color: '#00f0ff',
    });
  }

  /**
   * Artem's Motel in Cyber-Tastak (X=-165, Z=-165) — used in Act 4 (TASTAK_BETRAYAL) & explorable in Open World.
   */
  private buildArtemMotel(): void {
    const cx = -165;
    const cz = -165;
    const group = new THREE.Group();

    const wallMat = new THREE.MeshStandardMaterial({
      map: this.textures.getWallPanel('#ff2a6d', 2, 1),
      roughness: 0.55,
      metalness: 0.45,
    });
    const floorMat = new THREE.MeshStandardMaterial({
      map: this.textures.getFloorTile('#ff2a6d', 3, 3),
      roughness: 0.45,
    });

    const floor = new THREE.Mesh(new THREE.BoxGeometry(24, 0.25, 22), floorMat);
    floor.position.set(cx, 0.1, cz);
    group.add(floor);

    const roof = new THREE.Mesh(new THREE.BoxGeometry(25, 1, 23), wallMat);
    roof.position.set(cx, 6.2, cz);
    group.add(roof);

    const addWall = (id: string, wx: number, wz: number, sx: number, sz: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, 6, sz), wallMat);
      m.position.set(wx, 3, wz);
      group.add(m);
      this.chunks.addChunkCollider(this.physics, id, wx, 3, wz, sx, 6, sz);
    };
    addWall('motel_back', cx, cz - 10.6, 24, 0.8);
    addWall('motel_left', cx - 11.6, cz, 0.8, 22);
    addWall('motel_right', cx + 11.6, cz, 0.8, 22);
    addWall('motel_front_l', cx - 8, cz + 10.6, 7.5, 0.8);
    addWall('motel_front_r', cx + 8, cz + 10.6, 7.5, 0.8);
    // Bathroom divider inside motel
    addWall('motel_bath_wall', cx - 3.5, cz - 4.5, 0.6, 8);

    // Sink & glowing mirror in bathroom (Act 4 wash-up scene!)
    const sink = new THREE.Mesh(
      new THREE.BoxGeometry(1.5, 0.95, 1.0),
      new THREE.MeshStandardMaterial({ color: 0x9fb4c7, roughness: 0.25, metalness: 0.6 }),
    );
    sink.position.set(cx - 7.5, 0.55, cz - 9.4);
    group.add(sink);

    const mirror = new THREE.Mesh(
      new THREE.PlaneGeometry(1.8, 1.3),
      new THREE.MeshStandardMaterial({
        color: 0x77ccff,
        emissive: 0x164466,
        emissiveIntensity: 0.8,
        metalness: 0.95,
        roughness: 0.08,
      }),
    );
    mirror.position.set(cx - 7.5, 1.75, cz - 10.1);
    group.add(mirror);

    // Motel neon sign
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(16, 3.6),
      new THREE.MeshBasicMaterial({
        map: this.textures.getNeonSign('МОТЕЛЬ «ТАСТАК»', 'НОМЕРА ПОЧАСОВО // ОФИС АРТЁМА', '#ff2a6d', '#fcee0a'),
      }),
    );
    sign.position.set(cx, 8.2, cz + 11.2);
    group.add(sign);

    const light = new THREE.PointLight(0xff3366, 4.2, 26);
    light.position.set(cx, 4.8, cz);
    this.chunks.addToChunk(cx, cz, light);

    this.chunks.addToChunk(cx, cz, group);
    this.minimapBuildings.push({
      minX: cx - 12,
      maxX: cx + 12,
      minZ: cz - 11,
      maxZ: cz + 11,
      color: '#ff2a6d',
    });
  }

  /**
   * Junkyard / Industrial Outskirts (SW, X=-165, Z=165) — Act 5 Awakening + Samir meeting.
   */
  private buildJunkyardDistrict(): void {
    const cx = -165;
    const cz = 165;
    const group = new THREE.Group();

    const rustMat = new THREE.MeshStandardMaterial({
      color: 0x3b2c25,
      roughness: 0.88,
      metalness: 0.42,
    });
    const containerMat = new THREE.MeshStandardMaterial({
      color: 0x1d293b,
      roughness: 0.7,
      metalness: 0.5,
    });

    // Scrap hills & rusted shipping containers framing the awakening pit
    const piles: Array<[number, number, number, number, number]> = [
      [cx - 18, cz - 12, 10, 6, 8],
      [cx + 16, cz - 14, 12, 5, 7],
      [cx - 14, cz + 18, 9, 4.5, 11],
      [cx + 18, cz + 14, 11, 6.5, 9],
      [cx - 26, cz + 2, 8, 7, 14],
    ];
    piles.forEach(([px, pz, sx, sy, sz], i) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), i % 2 === 0 ? rustMat : containerMat);
      m.position.set(px, sy * 0.5, pz);
      group.add(m);
      this.chunks.addChunkCollider(this.physics, `junk_pile_${i}`, px, sy * 0.5, pz, sx, sy, sz);
    });

    // Burning oil barrel near wake spot
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 1.3, 10), rustMat);
    barrel.position.set(cx + 4.5, 0.65, cz - 4);
    group.add(barrel);
    const fire = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.5, 0),
      new THREE.MeshBasicMaterial({ color: 0xff6a00 }),
    );
    fire.position.set(cx + 4.5, 1.45, cz - 4);
    group.add(fire);

    // Artem's body lying on the junkyard beside Ai (per scenario!)
    const artemRig = buildArtemModel();
    artemRig.group.rotation.x = -Math.PI / 2;
    artemRig.group.rotation.z = 0.6;
    artemRig.group.position.set(cx - 2.6, 0.25, cz - 2.2);
    this.artemCorpseGroup.add(artemRig.group);
    group.add(this.artemCorpseGroup);

    // Samir Hologram standing over Ai in Act 5
    this.samirJunkyardRig = buildSamirHologram();
    this.samirJunkyardRig.group.position.set(cx + 1.2, 0, cz - 3.6);
    this.samirJunkyardRig.group.rotation.y = 0;
    this.samirJunkyardRig.group.visible = false;
    group.add(this.samirJunkyardRig.group);

    // Junkyard sign
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(15, 3.6),
      new THREE.MeshBasicMaterial({
        map: this.textures.getNeonSign('СВАЛКА // СЕКТОР 09', 'УТИЛИЗАЦИЯ КИБЕРХЛАМА', '#fcee0a', '#ff5500'),
      }),
    );
    sign.position.set(cx, 7.5, cz - 24);
    group.add(sign);

    const fireLight = new THREE.PointLight(0xff7722, 4.0, 26);
    fireLight.position.set(cx + 4.5, 2.5, cz - 4);
    this.chunks.addToChunk(cx, cz, fireLight);

    this.chunks.addToChunk(cx, cz, group);
  }

  /**
   * Monumental Marakulin Tower skyscraper (NE, X=170, Z=-170).
   * Upper spire sits in landmarkGroup so it dominates Cyber-Almaty's skyline from anywhere!
   */
  private buildMarakulinTowerPlaza(): void {
    const cx = 170;
    const cz = -170;

    const towerMat = new THREE.MeshStandardMaterial({
      map: this.textures.getBuildingFacade('#ff003c', '#0b0e1a', 3, 10),
      roughness: 0.28,
      metalness: 0.72,
    });
    const accentMat = new THREE.MeshBasicMaterial({ color: 0xff003c });

    // Giant tower in landmarkGroup (always visible across 500x500m)
    const towerGroup = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(52, 165, 52), towerMat);
    base.position.set(cx, 82.5, cz);
    towerGroup.add(base);

    const crown = new THREE.Mesh(new THREE.BoxGeometry(36, 35, 36), towerMat);
    crown.position.set(cx, 180, cz);
    towerGroup.add(crown);

    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 2.2, 45, 8), accentMat);
    antenna.position.set(cx, 218, cz);
    towerGroup.add(antenna);

    // Corner red neon ribs
    for (const sx of [-26.2, 26.2]) {
      for (const sz of [-26.2, 26.2]) {
        const rib = new THREE.Mesh(new THREE.BoxGeometry(0.8, 165, 0.8), accentMat);
        rib.position.set(cx + sx, 82.5, cz + sz);
        towerGroup.add(rib);
      }
    }

    // Giant billboard readable from Rooftop & Prospekt Abaya
    const giantSign = new THREE.Mesh(
      new THREE.PlaneGeometry(46, 11.5),
      new THREE.MeshBasicMaterial({
        map: this.textures.getNeonSign('МАРАКУЛИН ТАУЭР', 'МЕГАКОРПОРАЦИЯ // СЕКТОР 01', '#ff003c', '#ffffff'),
      }),
    );
    giantSign.position.set(cx, 95, cz + 26.5);
    towerGroup.add(giantSign);

    const giantSignWest = giantSign.clone();
    giantSignWest.position.set(cx - 26.5, 95, cz);
    giantSignWest.rotation.y = -Math.PI / 2;
    towerGroup.add(giantSignWest);

    // Entrance archway on South face (+Z)
    const arch = new THREE.Mesh(
      new THREE.BoxGeometry(14, 7.5, 4),
      new THREE.MeshStandardMaterial({
        color: 0x1a0810,
        emissive: 0xff003c,
        emissiveIntensity: 0.65,
      }),
    );
    arch.position.set(cx, 3.75, cz + 27);
    towerGroup.add(arch);

    this.chunks.addLandmark(towerGroup);
    this.physics.addBox('marakulin_tower_body', cx, 82.5, cz, 52, 165, 52);

    this.minimapBuildings.push({
      minX: cx - 26,
      maxX: cx + 26,
      minZ: cz - 26,
      maxZ: cz + 26,
      color: '#ff003c',
    });
  }

  /**
   * Kok-Tobe Overlook Rooftop Building (SE, X=165, Z=165) — Prologue & Point of No Return rooftop terrace (Y=36).
   */
  private buildKokTobeOverlookBuilding(): void {
    const cx = 165;
    const cz = 165;
    const h = 36;
    const group = new THREE.Group();

    const bodyMat = new THREE.MeshStandardMaterial({
      map: this.textures.getBuildingFacade('#b537f2', '#121528', 2, 4),
      roughness: 0.4,
      metalness: 0.55,
    });
    const body = new THREE.Mesh(new THREE.BoxGeometry(28, h, 28), bodyMat);
    body.position.set(cx, h * 0.5, cz);
    group.add(body);

    // Rooftop terrace floor & safety neon railings
    const railMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff });
    for (const side of [
      [cx, cz - 13.8, 28, 0.3],
      [cx, cz + 13.8, 28, 0.3],
      [cx - 13.8, cz, 0.3, 28],
      [cx + 13.8, cz, 0.3, 28],
    ]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(side[2], 1.1, side[3]), railMat);
      rail.position.set(side[0], h + 0.55, side[1]);
      group.add(rail);
    }

    // Two rooftop chairs facing each other (opening scene from Сценарий.odt!)
    const chairMat = new THREE.MeshStandardMaterial({ color: 0x1c2538, metalness: 0.5, roughness: 0.4 });
    const aiChair = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.9, 1.1), chairMat);
    aiChair.position.set(cx + 2, h + 0.45, cz + 2);
    group.add(aiChair);

    const samirChair = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.9, 1.1), chairMat);
    samirChair.position.set(cx - 2, h + 0.45, cz - 2);
    group.add(samirChair);

    // Samir Hologram seated/standing on rooftop looking at Ai
    this.samirRooftopRig = buildSamirHologram();
    this.samirRooftopRig.group.position.set(cx - 2, h, cz - 2);
    this.samirRooftopRig.group.rotation.y = Math.PI * 0.25;
    group.add(this.samirRooftopRig.group);

    // Street-level glowing elevator pad to reach rooftop
    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(2.2, 2.5, 0.35, 16),
      new THREE.MeshBasicMaterial({ color: 0xb537f2 }),
    );
    pad.position.set(cx - 16.5, 0.18, cz - 8);
    group.add(pad);

    const padSign = new THREE.Mesh(
      new THREE.PlaneGeometry(8, 2.1),
      new THREE.MeshBasicMaterial({
        map: this.textures.getNeonSign('ЛИФТ НА КРЫШУ', 'СМОТРОВАЯ // ТОЧКА НЕВОЗВРАТА', '#b537f2', '#00f0ff'),
      }),
    );
    padSign.position.set(cx - 14.3, 4.2, cz - 8);
    padSign.rotation.y = -Math.PI / 2;
    group.add(padSign);

    this.chunks.addLandmark(group);
    // Solid body collider + walkable rooftop surface
    this.physics.addBox('overlook_body', cx, h * 0.5, cz, 28, h, 28);

    this.minimapBuildings.push({
      minX: cx - 14,
      maxX: cx + 14,
      minZ: cz - 14,
      maxZ: cz + 14,
      color: '#b537f2',
    });
  }

  /**
   * Populates the 500x500m grid blocks with rich cyberpunk architecture streamed per 50x50m chunk!
   */
  private buildProceduralCityBlocks(): void {
    const accents = ['#00f0ff', '#ff2a6d', '#fcee0a', '#b537f2', '#00ffaa'];
    const facades = accents.map(
      (hex, i) =>
        new THREE.MeshStandardMaterial({
          map: this.textures.getBuildingFacade(hex, i % 2 === 0 ? '#0d1324' : '#131628', 2, 4),
          roughness: 0.45,
          metalness: 0.52,
        }),
    );
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x0a0f1c, roughness: 0.7, metalness: 0.4 });

    // Reserved centers where special landmarks, quests, or roads exist
    const isReserved = (x: number, z: number): boolean => {
      // Road lanes
      if (Math.abs(x) < 22 || Math.abs(z) < 22) return true;
      if (Math.abs(Math.abs(x) - 115) < 16 || Math.abs(Math.abs(z) - 115) < 16) return true;
      if (Math.abs(x) > 202 || Math.abs(z) > 202) return true;
      // Marum hub
      if (Math.hypot(x - -46, z - -40) < 28) return true;
      // Artem motel
      if (Math.hypot(x - -165, z - -165) < 30) return true;
      // Junkyard awakening pit
      if (Math.hypot(x - -165, z - 165) < 36) return true;
      // Marakulin tower plaza
      if (Math.hypot(x - 170, z - -170) < 48) return true;
      // Kok-Tobe Overlook building + pad
      if (Math.hypot(x - 165, z - 165) < 32) return true;
      // Gig arenas
      if (Math.hypot(x - -165, z - -78) < 22) return true; // Samir stash
      if (Math.hypot(x - -158, z - 82) < 22) return true; // Junkyard scavs
      if (Math.hypot(x - 165, z - 75) < 24) return true; // Cyberpsycho arena
      if (Math.hypot(x - -82, z - -162) < 22) return true; // Tastak relays
      return false;
    };

    let idx = 0;
    for (let gx = -188; gx <= 188; gx += 34) {
      for (let gz = -188; gz <= 188; gz += 34) {
        if (isReserved(gx, gz)) continue;

        const seed = Math.abs(Math.sin(gx * 12.9898 + gz * 78.233) * 43758.5453) % 1;
        const w = 16 + Math.floor(seed * 10);
        const d = 16 + Math.floor(((seed * 17) % 1) * 10);
        // Taller near Marakulin Plaza / Abay, lower in Tastak & Junkyard
        const isCorpo = gx > 35 && gz < 35;
        const isJunk = gx < -35 && gz > 35;
        const h = isCorpo
          ? 34 + Math.floor(((seed * 31) % 1) * 44)
          : isJunk
            ? 8 + Math.floor(((seed * 23) % 1) * 14)
            : 16 + Math.floor(((seed * 29) % 1) * 26);

        const accentIdx = idx % facades.length;
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), facades[accentIdx]);
        mesh.position.set(gx, h * 0.5, gz);
        this.chunks.addToChunk(gx, gz, mesh);

        // Rooftop AC/neon cap
        const cap = new THREE.Mesh(new THREE.BoxGeometry(w * 0.65, 1.4, d * 0.65), roofMat);
        cap.position.set(gx, h + 0.7, gz);
        this.chunks.addToChunk(gx, gz, cap);

        // Neon roof rim on every 2nd building
        if (idx % 2 === 0) {
          const rim = new THREE.Mesh(
            new THREE.BoxGeometry(w + 0.4, 0.55, d + 0.4),
            new THREE.MeshBasicMaterial({ color: accents[accentIdx] }),
          );
          rim.position.set(gx, h - 0.5, gz);
          this.chunks.addToChunk(gx, gz, rim);
        }

        // Occasional Cyrillic cyber-Almaty district billboard
        if (idx % 7 === 0) {
          const labels: Array<[string, string]> = [
            ['КИБЕР-АЛМАТЫ 2077', 'НЕОН // ХРОМ // ЕБЛАНХАНА'],
            ['КИБЕР-АХМЕД ТАКСИ', 'ВЫЗОВ [C] // БЕЗ ПРОБОК'],
            ['МАРАКУЛИН КОРП', 'БУДУЩЕЕ ПРИНАДЛЕЖИТ НАМ'],
            ['КИБЕР-ТАСТАК', 'ИМПЛАНТЫ СО СКИДКОЙ 40%'],
            ['ПЕСНИ МИНТИМЕРА', 'ТУР ПО ЕБЛАНХАНЕ // LIVE'],
          ];
          const [t, s] = labels[idx % labels.length];
          const sign = new THREE.Mesh(
            new THREE.PlaneGeometry(11, 2.8),
            new THREE.MeshBasicMaterial({
              map: this.textures.getNeonSign(t, s, accents[accentIdx], '#ffffff'),
            }),
          );
          sign.position.set(gx, Math.min(h - 3, 12), gz + d * 0.5 + 0.25);
          this.chunks.addToChunk(gx, gz, sign);
        }

        this.chunks.addChunkCollider(this.physics, `bldg_${idx}`, gx, h * 0.5, gz, w, h, d);
        this.minimapBuildings.push({
          minX: gx - w * 0.5,
          maxX: gx + w * 0.5,
          minZ: gz - d * 0.5,
          maxZ: gz + d * 0.5,
          color: isCorpo ? '#3a1b2b' : isJunk ? '#352b18' : '#1b2640',
        });
        idx++;
      }
    }
  }

  private buildStreetFurniture(): void {
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x1e283b, metalness: 0.8, roughness: 0.3 });
    const cyanBulb = new THREE.MeshBasicMaterial({ color: 0x00f0ff });
    const pinkBulb = new THREE.MeshBasicMaterial({ color: 0xff2a6d });

    // Streetlights along Prospekt Abaya (Z=±14) and Seifullin Ave (X=±14) streamed into chunks
    for (let pos = -200; pos <= 200; pos += 40) {
      if (Math.abs(pos) < 20) continue;
      for (const side of [-14, 14]) {
        const lamp1 = new THREE.Group();
        const p1 = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 7.5, 6), poleMat);
        p1.position.y = 3.75;
        lamp1.add(p1);
        const head1 = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.22, 0.4), side > 0 ? cyanBulb : pinkBulb);
        head1.position.set(0, 7.5, -Math.sign(side) * 0.6);
        lamp1.add(head1);
        lamp1.position.set(pos, 0, side);
        this.chunks.addToChunk(pos, side, lamp1);

        if (Math.abs(pos) % 80 === 0) {
          const pt = new THREE.PointLight(side > 0 ? 0x00e5ff : 0xff2a6d, 2.2, 24);
          pt.position.set(pos, 7.1, side);
          this.chunks.addToChunk(pos, side, pt);
        }

        // Cross boulevard lamp
        const lamp2 = lamp1.clone();
        lamp2.position.set(side, 0, pos);
        lamp2.rotation.y = Math.PI / 2;
        this.chunks.addToChunk(side, pos, lamp2);
      }
    }
  }

  private registerInteractables(): void {
    this.interactables.push(
      {
        id: 'ripperdoc_marum',
        label: '[E] РИПЕРДОК «МАРУМА» — ИМПЛАНТЫ И ОРУЖИЕ',
        x: -53.5,
        y: 1.2,
        z: -44,
        radius: 3.6,
        enabled: true,
        category: 'ripperdoc',
      },
      {
        id: 'gig_board_marum',
        label: '[E] ТЕРМИНАЛ ЗАКАЗОВ ЕБЛАНХАНЫ',
        x: -38.8,
        y: 1.4,
        z: -43,
        radius: 3.4,
        enabled: true,
        category: 'gig',
      },
      {
        id: 'rooftop_elevator_up',
        label: '[E] ПОДНЯТЬСЯ НА СМОТРОВУЮ КРЫШУ (ТОЧКА НЕВОЗВРАТА)',
        x: 148.5,
        y: 1.2,
        z: 157,
        radius: 3.8,
        enabled: true,
        category: 'elevator',
      },
      {
        id: 'rooftop_start_assault',
        label: '[E] ПОГОВОРИТЬ С САМИРОМ И НАЧАТЬ ШТУРМ МАРАКУЛИН ТАУЭР',
        x: 163,
        y: 37.2,
        z: 163,
        radius: 4.0,
        enabled: true,
        category: 'story',
      },
      {
        id: 'rooftop_elevator_down',
        label: '[E] СПУСТИТЬСЯ ОБРАТНО В КИБЕР-АЛМАТЫ',
        x: 154,
        y: 37.2,
        z: 155,
        radius: 3.6,
        enabled: true,
        category: 'elevator',
      },
      {
        id: 'motel_sink',
        label: '[E] УМЫТЬСЯ В ВАННОЙ',
        x: -172.5,
        y: 1.2,
        z: -173.5,
        radius: 3.2,
        enabled: false,
        category: 'story',
      },
      {
        id: 'marakulin_front_doors',
        label: '[E] ВОЙТИ В МАРАКУЛИН ТАУЭР (ШТУРМ)',
        x: 170,
        y: 1.5,
        z: -140,
        radius: 5.5,
        enabled: false,
        category: 'story',
      },
      {
        id: 'gig_malorian_stash',
        label: '[E] ЗАБРАТЬ MALORIAN S-3516 САМИРА',
        x: -165,
        y: 1.0,
        z: -78,
        radius: 3.5,
        enabled: false,
        category: 'loot',
      },
      {
        id: 'gig_tastak_terminal',
        label: '[E] ВЗЛОМАТЬ КОРПО-РЕТРАНСЛЯТОР ТАСТАКА',
        x: -82,
        y: 1.4,
        z: -162,
        radius: 3.6,
        enabled: false,
        category: 'gig',
      },
    );
  }

  setInteractableEnabled(id: string, enabled: boolean): void {
    const it = this.interactables.find((i) => i.id === id);
    if (it) it.enabled = enabled;
  }

  setStoryProps(opts: {
    samirRooftop?: boolean;
    samirJunkyard?: boolean;
    artemCorpse?: boolean;
    egorMarum?: boolean;
  }): void {
    if (opts.samirRooftop !== undefined) this.samirRooftopRig.group.visible = opts.samirRooftop;
    if (opts.samirJunkyard !== undefined) this.samirJunkyardRig.group.visible = opts.samirJunkyard;
    if (opts.artemCorpse !== undefined) this.artemCorpseGroup.visible = opts.artemCorpse;
    if (opts.egorMarum !== undefined) this.egorMarumRig.group.visible = opts.egorMarum;
  }

  update(elapsed: number): void {
    if (this.samirRooftopRig.group.visible) {
      animateHologramRig(this.samirRooftopRig, elapsed);
    }
    if (this.samirJunkyardRig.group.visible) {
      animateHologramRig(this.samirJunkyardRig, elapsed);
    }
    for (const s of this.hologramSigns) {
      s.position.y = 9.8 + Math.sin(elapsed * 2.1) * 0.08;
    }
  }
}

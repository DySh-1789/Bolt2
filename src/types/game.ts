export type GameAct =
  | 'TITLE'
  | 'PROLOGUE_ROOFTOP'
  | 'FLASHBACK_HEIST'
  | 'FLASHBACK_CHASE'
  | 'TASTAK_BETRAYAL'
  | 'JUNKYARD_AWAKENING'
  | 'OPEN_WORLD'
  | 'TOWER_ASSAULT'
  | 'SMASHER_BOSS'
  | 'HUYESHI_CYBERSPACE'
  | 'EPILOGUE_MARUM'
  | 'EPILOGUE_TALDYKORGAN'
  | 'CREDITS';

export type DistrictId =
  | 'cyber_tastak'
  | 'abay_eblanhana'
  | 'junkyard'
  | 'marakulin_plaza'
  | 'koktobe_overlook';

export type WeaponId =
  | 'mantis_blades'
  | 'alatau_pistol'
  | 'steppe_smg'
  | 'buran_shotgun'
  | 'malorian';

export type SpeakerId =
  | 'ai'
  | 'samir'
  | 'sanzhar'
  | 'rodion'
  | 'lev'
  | 'artem'
  | 'akhmed'
  | 'smasher'
  | 'taisiya'
  | 'egor'
  | 'ripperdoc'
  | 'system';

export type EnemyArchetype =
  | 'guard'
  | 'drone'
  | 'turret'
  | 'netrunner'
  | 'heavy'
  | 'scav'
  | 'ganger'
  | 'bodyguard'
  | 'artem'
  | 'cyberpsycho';

export type BossPhase =
  | 'DORMANT'
  | 'PHASE_1'
  | 'PHASE_2'
  | 'PHASE_3'
  | 'STAGGERED'
  | 'EXECUTED';

export type CameraMode =
  | 'FREE'
  | 'CINEMATIC'
  | 'CLOSET'
  | 'CHASE_PASSENGER'
  | 'VEHICLE_FIRST'
  | 'VEHICLE_THIRD'
  | 'FALLEN';

export type MusicIntensity =
  | 'silent'
  | 'title'
  | 'almaty_night'
  | 'marum_lounge'
  | 'combat'
  | 'chase'
  | 'boss'
  | 'cyberspace'
  | 'taldykorgan';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface AABB {
  id: string;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  active: boolean;
  blocksSight?: boolean;
  blocksBullets?: boolean;
  isFloor?: boolean;
  chunkKey?: string;
}

export interface InteractablePoint {
  id: string;
  label: string;
  x: number;
  y: number;
  z: number;
  radius: number;
  enabled: boolean;
  category?: 'story' | 'vehicle' | 'ripperdoc' | 'gig' | 'loot' | 'elevator';
}

export interface SubtitleEvent {
  speaker: SpeakerId;
  speakerName: string;
  role: string;
  text: string;
  duration: number;
}

export interface DialogueChoice {
  id: string;
  key: '1' | '2';
  text: string;
  subtext?: string;
}

export interface UpgradeState {
  doubleJump: boolean;
  airDash: boolean;
  reinforcedPlating: boolean;
  mantisOverclock: boolean;
  sandevistanMk2: boolean;
  maxDocCapacity: boolean;
}

export interface GigDefinition {
  id: string;
  title: string;
  district: DistrictId;
  description: string;
  rewardTenge: number;
  rewardCred: number;
  targetPos: Vec3;
  type: 'combat' | 'hack' | 'stash' | 'boss';
  unlocksWeapon?: WeaponId;
}

export interface GigRuntimeState {
  id: string;
  status: 'available' | 'active' | 'completed';
  progress: number;
  goal: number;
}

export interface DistrictInfo {
  id: DistrictId;
  name: string;
  subtitle: string;
  color: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  fastTravelPos: Vec3;
  fastTravelYaw: number;
}

export interface RunStats {
  elapsedSec: number;
  enemiesEliminated: number;
  shotsFired: number;
  shotsHit: number;
  headshots: number;
  meleeKills: number;
  gigsCompleted: number;
  tengeEarned: number;
  distanceDrivenMeters: number;
  deaths: number;
  endingId: 'marum' | 'taldykorgan' | '';
}

export interface PostFxState {
  glitch: number;
  relicGlitch: number;
  damageVignette: number;
  sandevistan: number;
  cyberspace: number;
  speedLines: number;
  blackout: number;
  eyelids: number;
  chromaticBoost: number;
}

export interface CheckpointData {
  act: GameAct;
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export const WORLD_SIZE = 500;
export const WORLD_HALF = WORLD_SIZE / 2; // 250m -> [-250, 250]
export const CHUNK_SIZE = 50; // 10 x 10 = 100 chunks

export const DISTRICTS: DistrictInfo[] = [
  {
    id: 'cyber_tastak',
    name: 'КИБЕР-ТАСТАК',
    subtitle: 'НЕОНОВЫЕ ТРУЩОБЫ // МОТЕЛЬ АРТЁМА',
    color: '#ff2a6d',
    minX: -250,
    maxX: -55,
    minZ: -250,
    maxZ: -45,
    fastTravelPos: { x: -135, y: 0, z: -120 },
    fastTravelYaw: 0,
  },
  {
    id: 'marakulin_plaza',
    name: 'ПЛОЩАДЬ МАРАКУЛИН ТАУЭР',
    subtitle: 'КОРПО-ЦЕНТР // МЕГАКОРПОРАЦИЯ',
    color: '#ff003c',
    minX: 55,
    maxX: 250,
    minZ: -250,
    maxZ: -45,
    fastTravelPos: { x: 135, y: 0, z: -95 },
    fastTravelYaw: Math.PI,
  },
  {
    id: 'abay_eblanhana',
    name: 'ПРОСПЕКТ АБАЯ // ЕБЛАНХАНА',
    subtitle: 'ЦЕНТРАЛЬНЫЙ ХАБ // АНТИКАФЕ «МАРУМ»',
    color: '#00f0ff',
    minX: -120,
    maxX: 120,
    minZ: -65,
    maxZ: 65,
    fastTravelPos: { x: 0, y: 0, z: 24 },
    fastTravelYaw: 0,
  },
  {
    id: 'junkyard',
    name: 'СВАЛКА // ПРОМЗОНА',
    subtitle: 'ОКРАИНА АЛМАТЫ // ТОЧКА ПРОБУЖДЕНИЯ',
    color: '#fcee0a',
    minX: -250,
    maxX: -55,
    minZ: 45,
    maxZ: 250,
    fastTravelPos: { x: -140, y: 0, z: 135 },
    fastTravelYaw: -Math.PI * 0.5,
  },
  {
    id: 'koktobe_overlook',
    name: 'КРЫША КОК-ТОБЕ // НИЖНИЙ КВАРТАЛ',
    subtitle: 'СМОТРОВАЯ ТЕРРАСА // ТОЧКА НЕВОЗВРАТА',
    color: '#b537f2',
    minX: 55,
    maxX: 250,
    minZ: 45,
    maxZ: 250,
    fastTravelPos: { x: 140, y: 0, z: 120 },
    fastTravelYaw: Math.PI * 0.75,
  },
];

export function getDistrictAt(x: number, z: number): DistrictInfo {
  // Check center hub first if inside central Abay rectangle
  const center = DISTRICTS.find((d) => d.id === 'abay_eblanhana')!;
  if (x >= -85 && x <= 85 && z >= -55 && z <= 55) {
    return center;
  }
  for (const d of DISTRICTS) {
    if (d.id === 'abay_eblanhana') continue;
    if (x >= d.minX && x <= d.maxX && z >= d.minZ && z <= d.maxZ) {
      return d;
    }
  }
  return center;
}

export function createInitialUpgrades(): UpgradeState {
  return {
    doubleJump: true, // Available in open world for fluid parkour, can be upgraded further
    airDash: false,
    reinforcedPlating: false,
    mantisOverclock: false,
    sandevistanMk2: false,
    maxDocCapacity: false,
  };
}

export function createInitialRunStats(): RunStats {
  return {
    elapsedSec: 0,
    enemiesEliminated: 0,
    shotsFired: 0,
    shotsHit: 0,
    headshots: 0,
    meleeKills: 0,
    gigsCompleted: 0,
    tengeEarned: 0,
    distanceDrivenMeters: 0,
    deaths: 0,
    endingId: '',
  };
}

export function createDefaultPostFx(): PostFxState {
  return {
    glitch: 0,
    relicGlitch: 0,
    damageVignette: 0,
    sandevistan: 0,
    cyberspace: 0,
    speedLines: 0,
    blackout: 0,
    eyelids: 0,
    chromaticBoost: 0,
  };
}

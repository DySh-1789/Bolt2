import type {
  DistrictId,
  GigDefinition,
  GigRuntimeState,
  UpgradeState,
  WeaponId,
} from '../types/game';
import type { EnemySpawnConfig } from './EnemyManager';

export interface RipperdocItem {
  id: string;
  name: string;
  description: string;
  cost: number;
  category: 'weapon' | 'implant' | 'consumable';
  weaponId?: WeaponId;
  upgradeKey?: keyof UpgradeState;
}

export const RIPPERDOC_CATALOG: RipperdocItem[] = [
  {
    id: 'wpn_steppe_smg',
    name: 'КИБЕР-ПП «СТЕПЬ-9»',
    description: 'Скорострельный ПП на 32 патрона для уличных перестрелок Кибер-Алматы.',
    cost: 1200,
    category: 'weapon',
    weaponId: 'steppe_smg',
  },
  {
    id: 'wpn_buran_shotgun',
    name: 'ДРОБОВИК «БУРАН-12»',
    description: 'Двухствольный тактический дробовик — разносит корпо-броню в упор.',
    cost: 1800,
    category: 'weapon',
    weaponId: 'buran_shotgun',
  },
  {
    id: 'imp_mantis_overclock',
    name: 'РАЗГОН КЛИНКОВ БОГОМОЛА',
    description: '+45% к урону Клинков Богомола и ускоренный выпад.',
    cost: 1600,
    category: 'implant',
    upgradeKey: 'mantisOverclock',
  },
  {
    id: 'imp_plating',
    name: 'ПОДКОЖНАЯ БРОНЯ «АЛАТАУ»',
    description: 'Увеличивает макс. HP до 150 и броню до 100.',
    cost: 2000,
    category: 'implant',
    upgradeKey: 'reinforcedPlating',
  },
  {
    id: 'imp_sandevistan_mk2',
    name: 'САНДЕВИСТАН MK.II',
    description: 'Почти вдвое увеличивает длительность и зарядку замедления времени.',
    cost: 2200,
    category: 'implant',
    upgradeKey: 'sandevistanMk2',
  },
  {
    id: 'imp_air_dash',
    name: 'ВОЗДУШНЫЙ РЫВОК',
    description: 'Позволяет делать рывок на Shift прямо в прыжке.',
    cost: 1400,
    category: 'implant',
    upgradeKey: 'airDash',
  },
  {
    id: 'imp_maxdoc_pack',
    name: 'ИНЖЕКТОР MAXDOC+',
    description: 'Расширяет запас ингаляторов MaxDoc до 6 зарядов и пополняет их.',
    cost: 1100,
    category: 'implant',
    upgradeKey: 'maxDocCapacity',
  },
  {
    id: 'cons_maxdoc',
    name: 'ПОПОЛНИТЬ MAXDOC + БРОНЮ',
    description: '+1 заряд MaxDoc и +30 брони прямо сейчас.',
    cost: 400,
    category: 'consumable',
  },
];

export const OPEN_WORLD_GIGS: GigDefinition[] = [
  {
    id: 'gig_malorian',
    title: 'НАСЛЕДИЕ САМИРА',
    district: 'cyber_tastak',
    description: 'В переулке Кибер-Тастака спрятан легендарный Malorian S-3516 Самира. Зачисти банду и забери ствол.',
    rewardTenge: 1500,
    rewardCred: 2,
    targetPos: { x: -165, y: 0, z: -78 },
    type: 'stash',
    unlocksWeapon: 'malorian',
  },
  {
    id: 'gig_junkyard',
    title: 'ЗАЧИСТКА СВАЛКИ',
    district: 'junkyard',
    description: 'Мусорщики окопались у обломков корпо-ави. Разгони их и забери кибер-тенге.',
    rewardTenge: 1400,
    rewardCred: 2,
    targetPos: { x: -158, y: 0, z: 82 },
    type: 'combat',
  },
  {
    id: 'gig_convoy',
    title: 'КОРПО-КОНВОЙ НА АБАЯ',
    district: 'abay_eblanhana',
    description: 'Отряд Маракулин Корп перекрыл восточную часть проспекта Абая. Устрой им тёплый приём.',
    rewardTenge: 1800,
    rewardCred: 3,
    targetPos: { x: 75, y: 0, z: 0 },
    type: 'combat',
  },
  {
    id: 'gig_cyberpsycho',
    title: 'КИБЕРПСИХ КОК-ТОБЕ',
    district: 'koktobe_overlook',
    description: 'Обезумевший элитный киборг терроризирует Нижний квартал. Обезвредь его.',
    rewardTenge: 2600,
    rewardCred: 4,
    targetPos: { x: 165, y: 0, z: 75 },
    type: 'boss',
  },
  {
    id: 'gig_tastak_hack',
    title: 'РЕТРАНСЛЯТОР ТАСТАКА',
    district: 'cyber_tastak',
    description: 'Взломай ретранслятор слежки Маракулин Корп на рынке Кибер-Тастака.',
    rewardTenge: 1600,
    rewardCred: 2,
    targetPos: { x: -82, y: 0, z: -162 },
    type: 'hack',
  },
];

export function getGigEnemyWave(gigId: string): EnemySpawnConfig[] {
  switch (gigId) {
    case 'gig_malorian':
      return [
        { id: 'gm_1', archetype: 'ganger', zoneId: gigId, x: -161, y: 0, z: -74 },
        { id: 'gm_2', archetype: 'ganger', zoneId: gigId, x: -169, y: 0, z: -82 },
        { id: 'gm_3', archetype: 'netrunner', zoneId: gigId, x: -165, y: 0, z: -85 },
      ];
    case 'gig_junkyard':
      return [
        { id: 'gj_1', archetype: 'scav', zoneId: gigId, x: -154, y: 0, z: 78 },
        { id: 'gj_2', archetype: 'scav', zoneId: gigId, x: -162, y: 0, z: 86 },
        { id: 'gj_3', archetype: 'scav', zoneId: gigId, x: -152, y: 0, z: 88 },
        { id: 'gj_4', archetype: 'drone', zoneId: gigId, x: -158, y: 0, z: 82 },
      ];
    case 'gig_convoy':
      return [
        { id: 'gc_1', archetype: 'guard', zoneId: gigId, x: 70, y: 0, z: -4 },
        { id: 'gc_2', archetype: 'guard', zoneId: gigId, x: 80, y: 0, z: 4 },
        { id: 'gc_3', archetype: 'heavy', zoneId: gigId, x: 76, y: 0, z: 0 },
        { id: 'gc_4', archetype: 'drone', zoneId: gigId, x: 74, y: 0, z: -5 },
      ];
    case 'gig_cyberpsycho':
      return [
        { id: 'gp_1', archetype: 'cyberpsycho', zoneId: gigId, x: 165, y: 0, z: 75 },
        { id: 'gp_2', archetype: 'drone', zoneId: gigId, x: 160, y: 0, z: 72 },
      ];
    case 'gig_tastak_hack':
      return [
        { id: 'gt_1', archetype: 'netrunner', zoneId: gigId, x: -78, y: 0, z: -158 },
        { id: 'gt_2', archetype: 'guard', zoneId: gigId, x: -86, y: 0, z: -165 },
        { id: 'gt_3', archetype: 'turret', zoneId: gigId, x: -82, y: 0, z: -156 },
      ];
    default:
      return [];
  }
}

/**
 * Pure Open-World quest & district state tracker (unit-testable).
 */
export class OpenWorldState {
  gigs = new Map<string, GigRuntimeState>();
  trackedGigId: string | null = 'gig_malorian';
  visitedDistricts = new Set<DistrictId>();

  constructor() {
    this.reset();
  }

  reset(): void {
    this.gigs.clear();
    for (const def of OPEN_WORLD_GIGS) {
      this.gigs.set(def.id, {
        id: def.id,
        status: 'available',
        progress: 0,
        goal: 1,
      });
    }
    this.trackedGigId = 'gig_malorian';
    this.visitedDistricts.clear();
  }

  activateGig(gigId: string): boolean {
    const g = this.gigs.get(gigId);
    if (!g || g.status === 'completed') return false;
    g.status = 'active';
    this.trackedGigId = gigId;
    return true;
  }

  completeGig(gigId: string): GigDefinition | null {
    const g = this.gigs.get(gigId);
    const def = OPEN_WORLD_GIGS.find((d) => d.id === gigId);
    if (!g || !def || g.status === 'completed') return null;
    g.status = 'completed';
    g.progress = g.goal;
    if (this.trackedGigId === gigId) {
      const next = OPEN_WORLD_GIGS.find((d) => this.gigs.get(d.id)?.status !== 'completed');
      this.trackedGigId = next?.id ?? null;
    }
    return def;
  }

  getCompletedCount(): number {
    let count = 0;
    for (const g of this.gigs.values()) {
      if (g.status === 'completed') count++;
    }
    return count;
  }

  markDistrictVisited(id: DistrictId): boolean {
    if (this.visitedDistricts.has(id)) return false;
    this.visitedDistricts.add(id);
    return true;
  }
}

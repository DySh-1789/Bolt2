import {
  DISTRICTS,
  WORLD_HALF,
  WORLD_SIZE,
  type DialogueChoice,
  type DistrictId,
  type GameAct,
  type RunStats,
  type SubtitleEvent,
  type Vec3,
  type WeaponId,
} from '../types/game';
import type { ChunkStats } from '../engine/ChunkManager';
import type { CityBlockRect } from '../game/CyberAlmatyWorld';
import { OPEN_WORLD_GIGS, RIPPERDOC_CATALOG, type OpenWorldState, type RipperdocItem } from '../game/OpenWorldSystem';
import { formatDialogueText } from '../game/DialogueLibrary';
import { WEAPON_ORDER, WEAPON_SPECS, type ArsenalState } from '../game/WeaponSystem';
import type { PlayerState } from '../game/Player';

export interface HudCallbacks {
  onStartCampaign: () => void;
  onStartFreeRoam: () => void;
  onContinuePostgame: () => void;
  onJumpToAct: (act: GameAct) => void;
  onResume: () => void;
  onRestartCheckpoint: () => void;
  onReturnTitle: () => void;
  onSensitivityChange: (val: number) => void;
  onVolumeChange: (val: number) => void;
  onCensorToggle: (censored: boolean) => void;
  onChoiceSelect: (choiceId: string) => void;
  onFastTravel: (districtId: DistrictId) => void;
  onTrackGig: (gigId: string) => void;
  onCloseMap: () => void;
  onCloseRipperdoc: () => void;
  onBuyRipperItem: (item: RipperdocItem) => void;
}

const CHAPTER_LIST: Array<{ act: GameAct; label: string }> = [
  { act: 'PROLOGUE_ROOFTOP', label: '1. Крыша (Пролог)' },
  { act: 'FLASHBACK_HEIST', label: '2. Пентхаус (2 нед. назад)' },
  { act: 'FLASHBACK_CHASE', label: '3. Погоня Кибер-Ахмед' },
  { act: 'TASTAK_BETRAYAL', label: '4. Отель Кибер-Тастак' },
  { act: 'JUNKYARD_AWAKENING', label: '5. Свалка и Самир' },
  { act: 'OPEN_WORLD', label: '6. Открытый Кибер-Алматы' },
  { act: 'TOWER_ASSAULT', label: '7. Штурм Маракулин Тауэр' },
  { act: 'SMASHER_BOSS', label: '8. Босс: Рихард Смэшер' },
  { act: 'HUYESHI_CYBERSPACE', label: '9. Хуеши и Таисия' },
];

export class HUD {
  private callbacks: HudCallbacks;
  private censored = false;

  private intertitleOverlay = document.getElementById('intertitle-overlay')!;
  private intertitleTag = document.getElementById('intertitle-tag')!;
  private intertitleTitle = document.getElementById('intertitle-title')!;
  private intertitleSub = document.getElementById('intertitle-sub')!;

  private hudLayer = document.getElementById('hud-layer')!;
  private titleScreen = document.getElementById('title-screen')!;
  private mapScreen = document.getElementById('map-screen')!;
  private ripperScreen = document.getElementById('ripperdoc-screen')!;
  private pauseScreen = document.getElementById('pause-screen')!;
  private creditsScreen = document.getElementById('credits-screen')!;
  private chapterPicker = document.getElementById('chapter-picker')!;

  private minimapCanvas = document.getElementById('minimap-canvas') as HTMLCanvasElement;
  private minimapCtx = this.minimapCanvas.getContext('2d')!;
  private fullmapCanvas = document.getElementById('fullmap-canvas') as HTMLCanvasElement;
  private fullmapCtx = this.fullmapCanvas.getContext('2d')!;

  private chunkBadge = document.getElementById('chunk-badge')!;
  private districtName = document.getElementById('district-name')!;
  private districtSub = document.getElementById('district-sub')!;
  private actBanner = document.getElementById('act-banner')!;
  private objectiveText = document.getElementById('objective-text')!;

  private bossBar = document.getElementById('boss-bar')!;
  private bossName = document.getElementById('boss-name')!;
  private bossPhase = document.getElementById('boss-phase')!;
  private bossFill = document.getElementById('boss-fill')!;

  private huyeshiBar = document.getElementById('huyeshi-bar')!;
  private huyeshiLabel = document.getElementById('huyeshi-label')!;
  private huyeshiPct = document.getElementById('huyeshi-pct')!;
  private huyeshiFill = document.getElementById('huyeshi-fill')!;

  private tengeVal = document.getElementById('tenge-val')!;
  private credVal = document.getElementById('cred-val')!;
  private syncVal = document.getElementById('sync-val')!;
  private ripperTenge = document.getElementById('ripper-tenge')!;
  private ripperItemsEl = document.getElementById('ripper-items')!;

  private crosshair = document.getElementById('crosshair')!;
  private hitmarker = document.getElementById('hitmarker')!;
  private interactPrompt = document.getElementById('interact-prompt')!;
  private relicWarning = document.getElementById('relic-warning')!;

  private vehicleHud = document.getElementById('vehicle-hud')!;
  private vehTitle = this.vehicleHud.querySelector('.veh-title') as HTMLElement | null;
  private vehSpeedVal = document.getElementById('veh-speed-val')!;
  private vehNitroFill = document.getElementById('veh-nitro-fill')!;

  private subtitleBox = document.getElementById('subtitle-box')!;
  private subSpeaker = document.getElementById('sub-speaker')!;
  private subRole = document.getElementById('sub-role')!;
  private subText = document.getElementById('sub-text')!;

  private choiceOverlay = document.getElementById('choice-overlay')!;
  private choiceTitle = document.getElementById('choice-title')!;
  private choiceList = document.getElementById('choice-list')!;

  private hpFill = document.getElementById('hp-fill')!;
  private hpVal = document.getElementById('hp-val')!;
  private armorFill = document.getElementById('armor-fill')!;
  private armorVal = document.getElementById('armor-val')!;
  private sandyFill = document.getElementById('sandy-fill')!;
  private sandyVal = document.getElementById('sandy-val')!;
  private maxDocVal = document.getElementById('maxdoc-val')!;

  private weaponName = document.getElementById('weapon-name')!;
  private ammoDisplay = document.getElementById('ammo-display')!;
  private weaponSlots = document.getElementById('weapon-slots')!;

  private fastTravelList = document.getElementById('fast-travel-list')!;
  private gigListEl = document.getElementById('gig-list')!;

  private endingTitle = document.getElementById('ending-title')!;
  private endingSummary = document.getElementById('ending-summary')!;
  private statsGrid = document.getElementById('stats-grid')!;

  private hitmarkerTimer = 0;
  private subtitleTimer = 0;
  private actBannerTimer = 0;
  private intertitleTimer = 0;

  // Zero-thrash dirty-checking caches
  private lastWeaponSlotsKey = '';
  private lastVitalsKey = '';
  private lastChunkKey = '';
  private lastPromptLabel: string | null = null;
  private lastVehicleKey = '0';
  private lastObjectiveText = '';
  private lastDistrictKey = '';
  private lastSamirSync = -1;
  private lastCrosshairVisible = true;
  private lastRelicKey = '0';
  private lastBossKey = '0';
  private lastHuyeshiKey = '0';

  // Minimap throttling (~16.7 FPS)
  private static readonly MINIMAP_INTERVAL_SEC = 0.06;
  private minimapAccum = HUD.MINIMAP_INTERVAL_SEC;
  private lastMinimapOpenWorld: boolean | null = null;
  private lastMinimapX = Number.NaN;
  private lastMinimapZ = Number.NaN;

  constructor(callbacks: HudCallbacks) {
    this.callbacks = callbacks;
    this.bindUI();
    this.populateChapters();
    this.populateFastTravel();
  }

  private fmt(text: string): string {
    return formatDialogueText(text, this.censored);
  }

  setCensored(censored: boolean): void {
    this.censored = censored;
    this.lastObjectiveText = '';
    this.lastDistrictKey = '';
    this.lastPromptLabel = null;
    this.lastRelicKey = '0';
    this.lastHuyeshiKey = '0';
    this.populateChapters();
    this.populateFastTravel();
    const titleSub = this.titleScreen.querySelector('.title-sub');
    if (titleSub) {
      titleSub.textContent = this.fmt('ЛЕГЕНДЫ ЕБЛАНХАНЫ // 2077 • ALMATY OPEN-WORLD FPS');
    }
    const mapHeading = this.mapScreen.querySelector('h2');
    if (mapHeading) {
      mapHeading.textContent = this.fmt('КАРТА КИБЕР-АЛМАТЫ // ЕБЛАНХАНА');
    }
  }

  private bindUI(): void {
    document.getElementById('btn-start-campaign')?.addEventListener('click', () => this.callbacks.onStartCampaign());
    document.getElementById('btn-start-freeroam')?.addEventListener('click', () => this.callbacks.onStartFreeRoam());
    document.getElementById('btn-open-chapters')?.addEventListener('click', () => {
      this.chapterPicker.classList.toggle('hidden');
    });
    document.getElementById('btn-resume')?.addEventListener('click', () => this.callbacks.onResume());
    document.getElementById('btn-checkpoint')?.addEventListener('click', () => this.callbacks.onRestartCheckpoint());
    document.getElementById('btn-to-title')?.addEventListener('click', () => this.callbacks.onReturnTitle());
    document.getElementById('btn-close-map')?.addEventListener('click', () => this.callbacks.onCloseMap());
    document.getElementById('btn-close-ripper')?.addEventListener('click', () => this.callbacks.onCloseRipperdoc());
    document.getElementById('btn-postgame-freeroam')?.addEventListener('click', () => this.callbacks.onContinuePostgame());
    document.getElementById('btn-credits-title')?.addEventListener('click', () => this.callbacks.onReturnTitle());

    const sensInput = document.getElementById('opt-sens') as HTMLInputElement | null;
    sensInput?.addEventListener('input', () => this.callbacks.onSensitivityChange(Number(sensInput.value)));

    const volInput = document.getElementById('opt-vol') as HTMLInputElement | null;
    volInput?.addEventListener('input', () => this.callbacks.onVolumeChange(Number(volInput.value)));

    const censorInput = document.getElementById('opt-censor') as HTMLInputElement | null;
    censorInput?.addEventListener('change', () => this.callbacks.onCensorToggle(censorInput.checked));
  }

  private populateChapters(): void {
    this.chapterPicker.innerHTML = '';
    for (const ch of CHAPTER_LIST) {
      const btn = document.createElement('button');
      btn.className = 'cyber-btn ghost small';
      btn.textContent = this.fmt(ch.label);
      btn.addEventListener('click', () => this.callbacks.onJumpToAct(ch.act));
      this.chapterPicker.appendChild(btn);
    }
  }

  private populateFastTravel(): void {
    this.fastTravelList.innerHTML = '';
    for (const d of DISTRICTS) {
      const btn = document.createElement('button');
      btn.className = 'cyber-btn secondary small';
      btn.textContent = `🚕 ${this.fmt(d.name)}`;
      btn.addEventListener('click', () => this.callbacks.onFastTravel(d.id));
      this.fastTravelList.appendChild(btn);
    }
  }

  showScreen(screen: 'TITLE' | 'HUD' | 'PAUSE' | 'MAP' | 'RIPPERDOC' | 'CREDITS'): void {
    this.titleScreen.classList.toggle('hidden', screen !== 'TITLE');
    this.hudLayer.classList.toggle('hidden', screen === 'TITLE' || screen === 'CREDITS');
    this.pauseScreen.classList.toggle('hidden', screen !== 'PAUSE');
    this.mapScreen.classList.toggle('hidden', screen !== 'MAP');
    this.ripperScreen.classList.toggle('hidden', screen !== 'RIPPERDOC');
    this.creditsScreen.classList.toggle('hidden', screen !== 'CREDITS');
    if (screen === 'TITLE') {
      this.hideIntertitle();
    }
  }

  showIntertitle(title: string, subtitle = '', tag = '', durationSec = 3.2): void {
    this.intertitleTag.textContent = this.fmt(tag);
    this.intertitleTitle.textContent = this.fmt(title);
    this.intertitleSub.textContent = this.fmt(subtitle);
    this.intertitleOverlay.classList.add('visible');
    this.intertitleOverlay.setAttribute('aria-hidden', 'false');
    this.intertitleTimer = durationSec;
  }

  hideIntertitle(): void {
    this.intertitleTimer = 0;
    this.intertitleOverlay.classList.remove('visible');
    this.intertitleOverlay.setAttribute('aria-hidden', 'true');
  }

  setObjective(text: string): void {
    const formatted = this.fmt(text);
    if (formatted === this.lastObjectiveText) return;
    this.lastObjectiveText = formatted;
    this.objectiveText.textContent = formatted;
  }

  showActBanner(text: string, duration = 4.0): void {
    this.actBanner.textContent = this.fmt(text);
    this.actBanner.classList.remove('hidden');
    this.actBannerTimer = duration;
  }

  setDistrict(name: string, subtitle: string): void {
    const fn = this.fmt(name);
    const fs = this.fmt(subtitle);
    const key = `${fn}|${fs}`;
    if (key === this.lastDistrictKey) return;
    this.lastDistrictKey = key;
    this.districtName.textContent = fn;
    this.districtSub.textContent = fs;
  }

  setChunkStats(stats: ChunkStats, inOpenWorld: boolean): void {
    const key = inOpenWorld
      ? `${stats.currentCx},${stats.currentCz},${stats.visibleChunks},${stats.totalChunks}`
      : 'INSTANCE';
    if (key === this.lastChunkKey) return;
    this.lastChunkKey = key;
    this.chunkBadge.textContent = inOpenWorld
      ? `ЧАНК ${stats.currentCx},${stats.currentCz} • ${stats.visibleChunks}/${stats.totalChunks}`
      : 'ИНСТАНС // ЗАКРЫТАЯ ЗОНА';
  }

  showSubtitle(ev: SubtitleEvent): void {
    this.subSpeaker.textContent = this.fmt(ev.speakerName);
    this.subRole.textContent = this.fmt(ev.role);
    this.subText.textContent = this.fmt(ev.text);
    this.subtitleBox.classList.remove('hidden');
    this.subtitleTimer = ev.duration;
  }

  clearSubtitle(): void {
    this.subtitleBox.classList.add('hidden');
    this.subtitleTimer = 0;
  }

  setCombatHudVisible(visible: boolean): void {
    this.hudLayer.classList.toggle('cinematic-mode', !visible);
  }

  setSamirSync(percent: number): void {
    const rounded = Math.round(percent);
    if (rounded === this.lastSamirSync) return;
    this.lastSamirSync = rounded;
    this.syncVal.textContent = `${rounded}%`;
  }

  setHuyeshiProgress(visible: boolean, ratio = 0, label = 'ХУЕШИ // РАЗДЕЛЕНИЕ СОЗНАНИЯ'): void {
    if (!visible) {
      if (this.lastHuyeshiKey === '0') return;
      this.lastHuyeshiKey = '0';
      this.huyeshiBar.classList.add('hidden');
      return;
    }
    const clamped = Math.max(0, Math.min(1, ratio));
    const pctStr = (clamped * 100).toFixed(1);
    const fl = this.fmt(label);
    const key = `1|${pctStr}|${fl}`;
    if (key === this.lastHuyeshiKey) return;
    this.lastHuyeshiKey = key;
    this.huyeshiBar.classList.remove('hidden');
    this.huyeshiLabel.textContent = fl;
    this.huyeshiPct.textContent = `${Math.round(clamped * 100)}%`;
    this.huyeshiFill.style.width = `${pctStr}%`;
  }

  showChoices(title: string, choices: DialogueChoice[]): void {
    this.choiceTitle.textContent = this.fmt(title);
    this.choiceList.innerHTML = '';
    for (const c of choices) {
      const btn = document.createElement('button');
      btn.className = 'choice-btn';
      btn.disabled = Boolean(c.disabled);
      const cText = this.fmt(c.text);
      const cSub = c.subtext ? this.fmt(c.subtext) : '';
      btn.innerHTML = `<strong>[${c.key}]</strong> ${cText}${cSub ? `<small>${cSub}</small>` : ''}`;
      if (!c.disabled) {
        btn.addEventListener('click', () => this.callbacks.onChoiceSelect(c.id));
      }
      this.choiceList.appendChild(btn);
    }
    this.choiceOverlay.classList.remove('hidden');
  }

  hideChoices(): void {
    this.choiceOverlay.classList.add('hidden');
  }

  setInteractPrompt(label: string | null): void {
    const formatted = label ? this.fmt(label) : null;
    if (formatted === this.lastPromptLabel) return;
    this.lastPromptLabel = formatted;
    if (formatted) {
      this.interactPrompt.textContent = formatted;
      this.interactPrompt.classList.remove('hidden');
    } else {
      this.interactPrompt.classList.add('hidden');
    }
  }

  setRelicWarning(visible: boolean, text = 'СБОЙ БИОЧИПА // КОНСТРУКТ: САМИР'): void {
    const ft = this.fmt(text);
    const key = visible ? `1|${ft}` : '0';
    if (key === this.lastRelicKey) return;
    this.lastRelicKey = key;
    if (visible) {
      this.relicWarning.textContent = ft;
      this.relicWarning.classList.remove('hidden');
    } else {
      this.relicWarning.classList.add('hidden');
    }
  }

  setCrosshairVisible(visible: boolean): void {
    if (visible === this.lastCrosshairVisible) return;
    this.lastCrosshairVisible = visible;
    this.crosshair.classList.toggle('hidden', !visible);
  }

  triggerHitmarker(headshot: boolean): void {
    this.hitmarker.classList.remove('hidden');
    this.hitmarker.classList.toggle('headshot', headshot);
    this.hitmarkerTimer = 0.14;
  }

  setBossBar(visible: boolean, name = '', phaseLabel = '', ratio = 1): void {
    if (!visible) {
      if (this.lastBossKey === '0') return;
      this.lastBossKey = '0';
      this.bossBar.classList.add('hidden');
      return;
    }
    const pctStr = Math.max(0, Math.min(100, ratio * 100)).toFixed(1);
    const key = `1|${name}|${phaseLabel}|${pctStr}`;
    if (key === this.lastBossKey) return;
    this.lastBossKey = key;
    this.bossBar.classList.remove('hidden');
    this.bossName.textContent = name;
    this.bossPhase.textContent = phaseLabel;
    this.bossFill.style.width = `${pctStr}%`;
  }

  updateVitals(player: PlayerState, arsenal: ArsenalState): void {
    const hpPct = player.maxHp > 0 ? Math.max(0, Math.min(100, (player.hp / player.maxHp) * 100)) : 0;
    const hpPctStr = hpPct.toFixed(1);
    const hpNum = Math.ceil(player.hp);
    const armorPct = player.maxArmor > 0 ? Math.max(0, Math.min(100, (player.armor / player.maxArmor) * 100)) : 0;
    const armorPctStr = armorPct.toFixed(1);
    const armorNum = Math.ceil(player.armor);
    const sandyPct = Math.max(0, Math.min(100, player.sandevistanEnergy));
    const sandyPctStr = sandyPct.toFixed(1);
    const sandyNum = Math.round(sandyPct);

    const spec = arsenal.getSpec();
    const ammoText = spec.isMelee
      ? '∞ КЛИНКИ'
      : arsenal.reloading
        ? 'ПЕРЕЗАРЯДКА...'
        : `${arsenal.getAmmo()} / ${spec.magSize}`;

    const vitalsKey = `${hpPctStr}|${hpNum}|${armorPctStr}|${armorNum}|${sandyPctStr}|${sandyNum}|${player.maxDocCharges}|${player.tenge}|${player.streetCred}|${spec.name}|${ammoText}`;
    if (vitalsKey !== this.lastVitalsKey) {
      this.lastVitalsKey = vitalsKey;
      this.hpFill.style.width = `${hpPctStr}%`;
      this.hpVal.textContent = `${hpNum}`;
      this.armorFill.style.width = `${armorPctStr}%`;
      this.armorVal.textContent = `${armorNum}`;
      this.sandyFill.style.width = `${sandyPctStr}%`;
      this.sandyVal.textContent = `${sandyNum}%`;
      this.maxDocVal.textContent = `${player.maxDocCharges}`;
      this.tengeVal.textContent = `${player.tenge}`;
      this.credVal.textContent = `${player.streetCred}`;
      this.weaponName.textContent = spec.name;
      this.ammoDisplay.textContent = ammoText;
    }

    let unlockedMask = 0;
    for (let i = 0; i < WEAPON_ORDER.length; i++) {
      if (arsenal.unlocked.has(WEAPON_ORDER[i])) {
        unlockedMask |= 1 << i;
      }
    }
    const slotsKey = `${arsenal.activeWeapon}|${unlockedMask}`;
    if (slotsKey !== this.lastWeaponSlotsKey) {
      this.lastWeaponSlotsKey = slotsKey;
      this.weaponSlots.innerHTML = WEAPON_ORDER.map((id) => {
        const s = WEAPON_SPECS[id];
        const owned = arsenal.unlocked.has(id);
        const active = arsenal.activeWeapon === id;
        return `<span class="wpn-slot ${owned ? 'owned' : ''} ${active ? 'active' : ''}">${s.slot}:${s.shortName}</span>`;
      }).join('');
    }
  }

  updateVehicleHud(inCar: boolean, speedKmh: number, nitro: number, autopilot: boolean): void {
    if (!inCar) {
      if (this.lastVehicleKey === '0') return;
      this.lastVehicleKey = '0';
      this.vehicleHud.classList.add('hidden');
      return;
    }
    const nitroClamped = Math.max(0, Math.min(100, nitro)).toFixed(1);
    const key = `1|${speedKmh}|${nitroClamped}|${autopilot ? 1 : 0}`;
    if (key === this.lastVehicleKey) return;
    this.lastVehicleKey = key;
    this.vehicleHud.classList.remove('hidden');
    this.vehSpeedVal.textContent = `${speedKmh}`;
    this.vehNitroFill.style.width = `${nitroClamped}%`;
    if (this.vehTitle) {
      this.vehTitle.textContent = autopilot
        ? 'КИБЕР-АХМЕД AI // АВТОПИЛОТ АКТИВЕН'
        : 'КИБЕР-АХМЕД AI // РУЧНОЕ УПРАВЛЕНИЕ';
    }
  }

  renderRipperdoc(player: PlayerState, unlockedWeapons: Set<WeaponId>): void {
    this.ripperTenge.textContent = `${player.tenge}`;
    this.ripperItemsEl.innerHTML = '';

    for (const item of RIPPERDOC_CATALOG) {
      const owned =
        (item.weaponId && unlockedWeapons.has(item.weaponId)) ||
        (item.upgradeKey && player.upgrades[item.upgradeKey]);
      const isFullConsumable =
        item.id === 'cons_maxdoc' &&
        player.maxDocCharges >= player.maxMaxDoc &&
        player.armor >= player.maxArmor;

      const card = document.createElement('div');
      card.className = 'ripper-item';
      card.innerHTML = `
        <div>
          <h4>${this.fmt(item.name)}</h4>
          <p>${this.fmt(item.description)}</p>
        </div>
      `;
      const btn = document.createElement('button');
      btn.className = owned || isFullConsumable ? 'cyber-btn ghost small' : 'cyber-btn secondary small';
      btn.disabled = Boolean(owned) || isFullConsumable || player.tenge < item.cost;
      btn.textContent = owned
        ? 'УСТАНОВЛЕНО'
        : isFullConsumable
          ? 'ЗАПАС ПОЛОН'
          : `КУПИТЬ ЗА ${item.cost} ₸`;
      btn.addEventListener('click', () => this.callbacks.onBuyRipperItem(item));
      card.appendChild(btn);
      this.ripperItemsEl.appendChild(card);
    }
  }

  renderGigList(openWorld: OpenWorldState): void {
    this.gigListEl.innerHTML = '';
    for (const def of OPEN_WORLD_GIGS) {
      const rt = openWorld.gigs.get(def.id);
      const card = document.createElement('div');
      card.className = `gig-card ${openWorld.trackedGigId === def.id ? 'tracked' : ''} ${rt?.status === 'completed' ? 'completed' : ''}`;
      card.innerHTML = `
        <div class="gig-card-title">
          <span>${rt?.status === 'completed' ? '✓ ' : ''}${this.fmt(def.title)}</span>
          <span>${def.rewardTenge} ₸</span>
        </div>
        <div class="gig-card-desc">${this.fmt(def.description)}</div>
      `;
      if (rt?.status !== 'completed') {
        card.addEventListener('click', () => this.callbacks.onTrackGig(def.id));
      }
      this.gigListEl.appendChild(card);
    }
  }

  renderMinimap(
    playerPos: Vec3,
    playerYaw: number,
    carPos: Vec3,
    enemies: Array<{ x: number; y: number; z: number }>,
    objectivePos: Vec3 | null,
    buildings: CityBlockRect[],
    inOpenWorld: boolean,
  ): void {
    const modeChanged = this.lastMinimapOpenWorld !== inOpenWorld;
    if (!inOpenWorld && !modeChanged) {
      return;
    }

    const dx = playerPos.x - this.lastMinimapX;
    const dz = playerPos.z - this.lastMinimapZ;
    const teleported = Number.isNaN(dx) || dx * dx + dz * dz > 25;

    if (!modeChanged && !teleported && this.minimapAccum < HUD.MINIMAP_INTERVAL_SEC) {
      return;
    }

    this.minimapAccum = 0;
    this.lastMinimapOpenWorld = inOpenWorld;
    this.lastMinimapX = playerPos.x;
    this.lastMinimapZ = playerPos.z;

    const ctx = this.minimapCtx;
    const w = this.minimapCanvas.width;
    const h = this.minimapCanvas.height;
    ctx.fillStyle = '#060a14';
    ctx.fillRect(0, 0, w, h);

    if (!inOpenWorld) {
      ctx.strokeStyle = 'rgba(0, 240, 255, 0.25)';
      ctx.strokeRect(8, 8, w - 16, h - 16);
      ctx.fillStyle = '#00f0ff';
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('ЗАКРЫТЫЙ СЕКТОР', w / 2, h / 2);
      return;
    }

    const scale = 0.85; // ~190m visible window around player
    const toMap = (wx: number, wz: number) => ({
      x: w / 2 + (wx - playerPos.x) * scale,
      y: h / 2 + (wz - playerPos.z) * scale,
    });

    // Roads
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.28)';
    ctx.lineWidth = 6;
    for (const r of [-220, -115, 0, 115, 220]) {
      const a = toMap(-240, r);
      const b = toMap(240, r);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();

      const c = toMap(r, -240);
      const d = toMap(r, 240);
      ctx.beginPath();
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(d.x, d.y);
      ctx.stroke();
    }

    // Nearby buildings
    for (const b of buildings) {
      const p1 = toMap(b.minX, b.minZ);
      const bw = (b.maxX - b.minX) * scale;
      const bh = (b.maxZ - b.minZ) * scale;
      if (p1.x + bw < 0 || p1.x > w || p1.y + bh < 0 || p1.y > h) continue;
      ctx.fillStyle = b.color;
      ctx.fillRect(p1.x, p1.y, bw, bh);
    }

    // Cyber-Akhmed marker
    const car = toMap(carPos.x, carPos.z);
    ctx.fillStyle = '#fcee0a';
    ctx.fillRect(car.x - 3, car.y - 3, 6, 6);

    // Enemies
    ctx.fillStyle = '#ff3344';
    for (const e of enemies) {
      if (Math.abs(e.y - playerPos.y) > 15) continue;
      const ep = toMap(e.x, e.z);
      ctx.beginPath();
      ctx.arc(ep.x, ep.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Objective diamond
    if (objectivePos) {
      const op = toMap(objectivePos.x, objectivePos.z);
      const clampedX = Math.max(8, Math.min(w - 8, op.x));
      const clampedY = Math.max(8, Math.min(h - 8, op.y));
      ctx.fillStyle = '#ff003c';
      ctx.beginPath();
      ctx.moveTo(clampedX, clampedY - 5);
      ctx.lineTo(clampedX + 5, clampedY);
      ctx.lineTo(clampedX, clampedY + 5);
      ctx.lineTo(clampedX - 5, clampedY);
      ctx.closePath();
      ctx.fill();
    }

    // Player arrow
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(-playerYaw);
    ctx.fillStyle = '#00f0ff';
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(4.5, 5);
    ctx.lineTo(-4.5, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  renderFullMap(
    playerPos: Vec3,
    carPos: Vec3,
    buildings: CityBlockRect[],
    openWorld: OpenWorldState,
    objectivePos: Vec3 | null,
    enemies: Array<{ x: number; y: number; z: number }> = [],
  ): void {
    const ctx = this.fullmapCtx;
    const w = this.fullmapCanvas.width;
    const h = this.fullmapCanvas.height;
    ctx.fillStyle = '#050912';
    ctx.fillRect(0, 0, w, h);

    const toPx = (wx: number, wz: number) => ({
      x: ((wx + WORLD_HALF) / WORLD_SIZE) * w,
      y: ((wz + WORLD_HALF) / WORLD_SIZE) * h,
    });

    // 10x10 chunk grid lines
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.1)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 10; i++) {
      const p = (i / 10) * w;
      ctx.beginPath();
      ctx.moveTo(p, 0);
      ctx.lineTo(p, h);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, p);
      ctx.lineTo(w, p);
      ctx.stroke();
    }

    // Roads
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.35)';
    ctx.lineWidth = 4;
    for (const r of [-220, -115, 0, 115, 220]) {
      const a = toPx(-240, r);
      const b = toPx(240, r);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      const c = toPx(r, -240);
      const d = toPx(r, 240);
      ctx.beginPath();
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(d.x, d.y);
      ctx.stroke();
    }

    // Buildings
    for (const b of buildings) {
      const p1 = toPx(b.minX, b.minZ);
      const p2 = toPx(b.maxX, b.maxZ);
      ctx.fillStyle = b.color;
      ctx.fillRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
    }

    // District names
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    for (const d of DISTRICTS) {
      const p = toPx(d.fastTravelPos.x, d.fastTravelPos.z);
      ctx.fillStyle = d.color;
      ctx.fillText(this.fmt(d.name), p.x, p.y - 10);
    }

    // Active enemies matching map legend
    ctx.fillStyle = '#ff3344';
    for (const e of enemies) {
      if (Math.abs(e.y - playerPos.y) > 40) continue;
      const ep = toPx(e.x, e.z);
      ctx.beginPath();
      ctx.arc(ep.x, ep.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Gigs
    for (const g of OPEN_WORLD_GIGS) {
      const rt = openWorld.gigs.get(g.id);
      if (rt?.status === 'completed') continue;
      const gp = toPx(g.targetPos.x, g.targetPos.z);
      ctx.fillStyle = openWorld.trackedGigId === g.id ? '#fcee0a' : '#ff2a6d';
      ctx.beginPath();
      ctx.arc(gp.x, gp.y, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Objective
    if (objectivePos) {
      const op = toPx(objectivePos.x, objectivePos.z);
      ctx.strokeStyle = '#ff003c';
      ctx.lineWidth = 2;
      ctx.strokeRect(op.x - 7, op.y - 7, 14, 14);
    }

    // Cyber-Akhmed
    const cp = toPx(carPos.x, carPos.z);
    ctx.fillStyle = '#fcee0a';
    ctx.fillRect(cp.x - 4, cp.y - 4, 8, 8);

    // Player
    const pp = toPx(playerPos.x, playerPos.z);
    ctx.fillStyle = '#00f0ff';
    ctx.beginPath();
    ctx.arc(pp.x, pp.y, 5.5, 0, Math.PI * 2);
    ctx.fill();

    this.renderGigList(openWorld);
  }

  showCredits(stats: RunStats): void {
    if (stats.endingId === 'taldykorgan') {
      this.endingTitle.textContent = this.fmt('КОНЦОВКА II: ДОРОГА В ТАЛДЫКОРГАН');
      this.endingSummary.textContent = this.fmt(
        'Аи отдал своё тело Самиру. Получив второй шанс на полноценную жизнь, Самир прощается с Кибер-Алматы и уезжает навстречу рассвету в город-ад Талдыкорган.',
      );
    } else {
      this.endingTitle.textContent = this.fmt('КОНЦОВКА I: ЛЕГЕНДА ЕБЛАНХАНЫ');
      this.endingSummary.textContent = this.fmt(
        'Аи вернулся в своё тело и стал живой легендой Ебланханы — владельцем антикафе «Марум». Приняв контракт Егора на Вечную войну, он встречает последние полгода так, как подобает легенде.',
      );
    }

    const mins = Math.floor(stats.elapsedSec / 60);
    const secs = Math.floor(stats.elapsedSec % 60);
    const accuracy = stats.shotsFired > 0 ? Math.round((stats.shotsHit / stats.shotsFired) * 100) : 0;
    const approachLabel = this.fmt(
      stats.assaultApproach === 'netrunner'
        ? 'НЕТРАННЕР'
        : stats.assaultApproach === 'eblanhana'
          ? 'ЕБЛАНХАНА'
          : 'ПРОРЫВ 2026',
    );

    this.statsGrid.innerHTML = `
      <div class="stat-card"><span>ВРЕМЯ В ИГРЕ</span><strong>${mins}м ${secs}с</strong></div>
      <div class="stat-card"><span>СИНХР. С САМИРОМ</span><strong>${stats.samirAffinity}%</strong></div>
      <div class="stat-card"><span>ПЛАН ШТУРМА</span><strong>${approachLabel}</strong></div>
      <div class="stat-card"><span>ВРАГОВ УСТРАНЕНО</span><strong>${stats.enemiesEliminated}</strong></div>
      <div class="stat-card"><span>УБИЙСТВ КЛИНКАМИ</span><strong>${stats.meleeKills}</strong></div>
      <div class="stat-card"><span>ТОЧНОСТЬ / ХЕДШОТЫ</span><strong>${accuracy}% / ${stats.headshots}</strong></div>
      <div class="stat-card"><span>${this.fmt('ЗАКАЗОВ ЕБЛАНХАНЫ')}</span><strong>${stats.gigsCompleted} / 5</strong></div>
      <div class="stat-card"><span>ПРОЕХАНО НА КИБЕР-АХМЕДЕ</span><strong>${Math.round(stats.distanceDrivenMeters)} м</strong></div>
    `;
    this.showScreen('CREDITS');
  }

  update(dt: number): void {
    this.minimapAccum = Math.min(this.minimapAccum + dt, 0.25);

    if (this.hitmarkerTimer > 0) {
      this.hitmarkerTimer -= dt;
      if (this.hitmarkerTimer <= 0) this.hitmarker.classList.add('hidden');
    }
    if (this.subtitleTimer > 0) {
      this.subtitleTimer -= dt;
      if (this.subtitleTimer <= 0) this.subtitleBox.classList.add('hidden');
    }
    if (this.actBannerTimer > 0) {
      this.actBannerTimer -= dt;
      if (this.actBannerTimer <= 0) this.actBanner.classList.add('hidden');
    }
    if (this.intertitleTimer > 0) {
      this.intertitleTimer -= dt;
      if (this.intertitleTimer <= 0) this.hideIntertitle();
    }
  }
}

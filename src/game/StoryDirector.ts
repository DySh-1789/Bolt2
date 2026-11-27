import * as THREE from 'three';
import {
  createDefaultPostFx,
  createInitialRunStats,
  DISTRICTS,
  getDistrictAt,
  type AssaultApproach,
  type CheckpointData,
  type DialogueChoice,
  type DistrictId,
  type GameAct,
  type InteractablePoint,
  type PostFxState,
  type RunStats,
  type SpeakerId,
  type Vec3,
} from '../types/game';
import type { Engine } from '../engine/Engine';
import { PhysicsWorld } from '../engine/Physics';
import { ChunkManager } from '../engine/ChunkManager';
import { InputManager, type InputSnapshot } from '../engine/InputManager';
import { ProceduralTextures } from '../engine/ProceduralTextures';
import { AudioEngine } from '../engine/AudioEngine';
import { PlayerController } from './Player';
import { WeaponSystem } from './WeaponSystem';
import { VehicleSystem } from './VehicleSystem';
import { EnemyManager } from './EnemyManager';
import { RikhardSmasherBoss } from './RikhardSmasherBoss';
import { CyberAlmatyWorld } from './CyberAlmatyWorld';
import { INSTANCE_Y, StoryInstances } from './StoryInstances';
import {
  getGigEnemyWave,
  OPEN_WORLD_GIGS,
  OpenWorldState,
  type RipperdocItem,
} from './OpenWorldSystem';
import {
  AKHMED_DRIVING_LINES,
  BRANCH_RESPONSES,
  BRANCHING_CHOICES,
  clampAffinity,
  DISTRICT_SAMIR_BANTER,
  formatDialogueText,
  getAssaultPlanChoices,
  getBranchChoices,
  getBranchResponseLines,
  getCyberspaceFarewellLines,
  SPEAKER_META,
} from './DialogueLibrary';
import { HUD } from '../ui/HUD';

interface QueuedLine {
  speaker: SpeakerId;
  text: string;
  duration: number;
}

/**
 * Pure story act progression state machine (unit-testable without WebGL).
 */
export class StoryStateMachine {
  act: GameAct = 'TITLE';
  subStep = 0;
  actTimer = 0;
  endingChoice: 'marum' | 'taldykorgan' | null = null;

  transition(next: GameAct): void {
    this.act = next;
    this.subStep = 0;
    this.actTimer = 0;
  }

  isOpenWorldLike(): boolean {
    return (
      this.act === 'OPEN_WORLD' ||
      this.act === 'PROLOGUE_ROOFTOP' ||
      this.act === 'TASTAK_BETRAYAL' ||
      this.act === 'JUNKYARD_AWAKENING' ||
      this.act === 'EPILOGUE_MARUM'
    );
  }

  selectFinaleEnding(choice: 'marum' | 'taldykorgan'): GameAct {
    this.endingChoice = choice;
    const next: GameAct = choice === 'marum' ? 'EPILOGUE_MARUM' : 'EPILOGUE_TALDYKORGAN';
    this.transition(next);
    return next;
  }
}

export class StoryDirector {
  readonly stateMachine = new StoryStateMachine();
  readonly physics = new PhysicsWorld();
  readonly chunks: ChunkManager;
  readonly textures = new ProceduralTextures();
  readonly audio = new AudioEngine();
  readonly input: InputManager;
  readonly player: PlayerController;
  readonly weapons: WeaponSystem;
  readonly vehicle: VehicleSystem;
  readonly enemies: EnemyManager;
  readonly smasher: RikhardSmasherBoss;
  readonly city: CyberAlmatyWorld;
  readonly instances: StoryInstances;
  readonly openWorld = new OpenWorldState();
  readonly hud: HUD;

  private engine: Engine;
  private stats: RunStats = createInitialRunStats();
  private fx: PostFxState = createDefaultPostFx();
  private checkpoint: CheckpointData = { act: 'OPEN_WORLD', x: 0, y: 0, z: 24, yaw: 0 };

  private paused = false;
  private modalOpen: 'NONE' | 'MAP' | 'RIPPERDOC' = 'NONE';
  private censoredDialogue = false;
  private awaitingChoice = false;
  private activeChoices: DialogueChoice[] = [];
  private activeChoiceContext:
    | 'NONE'
    | 'ROOFTOP_PROLOGUE'
    | 'MOTEL_ARTEM'
    | 'ASSAULT_PLAN'
    | 'SMASHER_EXECUTION'
    | 'CYBERSPACE_ENDING'
    | 'EGOR_CONTRACT' = 'NONE';

  private dialogueQueue: QueuedLine[] = [];
  private currentLineTimer = 0;

  private elapsedTotal = 0;
  private lastDistrictId: DistrictId | null = null;
  private wasNearMarum = false;
  private wasCarNitroActive = false;
  private activeObjectivePos: Vec3 | null = null;
  private chaseDronesRemaining = 0;
  private chaseWaveSpawned = false;
  private akhmedLineIdx = 0;
  private towerSecurityHacked = false;
  private ecgBeatTimer = 0;
  private chokeBeatTimer = 0;
  private targetLetterbox = 0;
  private pendingDeathRespawn = false;

  // Deterministic one-shot cutscene & lunge state (no frame-rate-dependent time windows)
  private penthouseChokeSfxFired = false;
  private smasherExecShot1Fired = false;
  private smasherExecShot2Fired = false;
  private smasherExecShotTimer = 0;
  private pendingAssaultTransition = false;
  private assaultTransitionTimer = 0;
  private assaultFadeTimer = 0;
  private pendingCyberspaceEnding: 'marum' | 'taldykorgan' | null = null;
  private cyberspaceFadeTimer = 0;
  private pendingLungeHit: { timer: number; damage: number; range: number } | null = null;

  constructor(engine: Engine, viewport: HTMLElement) {
    this.engine = engine;
    this.chunks = new ChunkManager(engine.scene);
    this.player = new PlayerController(engine.camera);
    this.weapons = new WeaponSystem(engine.scene, engine.camera);
    this.vehicle = new VehicleSystem(engine.scene, this.textures);
    this.enemies = new EnemyManager(engine.scene);
    this.smasher = new RikhardSmasherBoss(engine.scene, INSTANCE_Y.UNDERGROUND);
    this.city = new CyberAlmatyWorld(this.chunks, this.physics, this.textures);
    this.instances = new StoryInstances(engine.scene, this.physics, this.textures);

    this.input = new InputManager(viewport, {
      onLockChange: (locked) => this.handlePointerLockChange(locked),
      onEscapePressed: () => this.handleEscape(),
      onViewportClick: () => this.handleViewportClick(),
      onMapKey: () => this.toggleMapModal(),
    });

    this.hud = new HUD({
      onStartCampaign: () => this.startCampaign(),
      onStartFreeRoam: () => this.startFreeRoam(),
      onContinuePostgame: () => this.continuePostgameFreeRoam(),
      onJumpToAct: (act) => this.jumpToAct(act),
      onResume: () => this.resumeGame(),
      onRestartCheckpoint: () => this.restartFromCheckpoint(),
      onReturnTitle: () => this.returnToTitle(),
      onSensitivityChange: (v) => this.input.setSensitivity(v),
      onVolumeChange: (v) => this.audio.setMasterVolume(v),
      onCensorToggle: (c) => {
        this.censoredDialogue = c;
        this.hud.setCensored(c);
      },
      onChoiceSelect: (id) => this.handleChoiceSelection(id),
      onFastTravel: (dId) => this.fastTravelToDistrict(dId),
      onTrackGig: (gId) => this.trackGig(gId),
      onCloseMap: () => this.closeModals(),
      onCloseRipperdoc: () => this.closeModals(),
      onBuyRipperItem: (item) => this.buyRipperdocItem(item),
    });

    this.enterTitleScene();
  }

  /**
   * Bolt-1-style dialogue queue so cinematic multi-line exchanges play smoothly without colliding.
   */
  private queueLine(speaker: SpeakerId, rawText: string, duration = 4.4, interrupt = false): void {
    const formatted = formatDialogueText(rawText, this.censoredDialogue);
    if (interrupt) {
      this.dialogueQueue = [];
      this.currentLineTimer = 0;
    }
    this.dialogueQueue.push({ speaker, text: formatted, duration });
    if (this.currentLineTimer <= 0) {
      this.popNextDialogueLine();
    }
  }

  private isDialogueBusy(): boolean {
    return this.currentLineTimer > 0.05 || this.dialogueQueue.length > 0;
  }

  private popNextDialogueLine(): void {
    const next = this.dialogueQueue.shift();
    if (!next) return;
    const meta = SPEAKER_META[next.speaker];
    this.hud.showSubtitle({
      speaker: next.speaker,
      speakerName: meta.name,
      role: meta.role,
      text: next.text,
      duration: next.duration,
    });
    this.currentLineTimer = next.duration + 0.18;
    if (next.speaker === 'samir' || next.speaker === 'akhmed' || next.speaker === 'taisiya') {
      this.audio.playHoloChime();
    }
  }

  private updateDialogueQueue(dt: number): void {
    if (this.currentLineTimer > 0) {
      this.currentLineTimer -= dt;
      if (this.currentLineTimer <= 0 && this.dialogueQueue.length > 0) {
        this.popNextDialogueLine();
      }
    } else if (this.dialogueQueue.length > 0) {
      this.popNextDialogueLine();
    }
  }

  private clearDialogueQueue(): void {
    this.dialogueQueue = [];
    this.currentLineTimer = 0;
    this.hud.clearSubtitle();
  }

  private presentChoices(
    context: typeof this.activeChoiceContext,
    title: string,
    choices: DialogueChoice[],
  ): void {
    this.activeChoiceContext = context;
    this.activeChoices = choices;
    this.awaitingChoice = true;
    this.input.clearTransient();
    this.input.exitPointerLock();
    this.hud.showChoices(title, choices);
  }

  private adjustSamirAffinity(delta: number): void {
    if (delta === 0) return;
    this.stats.samirAffinity = clampAffinity(this.stats.samirAffinity + delta);
    this.hud.setSamirSync(this.stats.samirAffinity);
  }

  private enterTitleScene(): void {
    this.stateMachine.transition('TITLE');
    this.paused = false;
    this.modalOpen = 'NONE';
    this.awaitingChoice = false;
    this.activeChoiceContext = 'NONE';
    this.targetLetterbox = 0;
    this.pendingAssaultTransition = false;
    this.pendingCyberspaceEnding = null;
    this.pendingLungeHit = null;
    this.clearDialogueQueue();
    this.input.clearTransient();
    this.input.exitPointerLock();
    this.weapons.setVisible(false);
    this.vehicle.setVisible(true);
    this.instances.setActiveInstance('NONE');
    this.city.setMotelLocked(false);
    this.city.setStoryProps({
      samirRooftop: true,
      samirJunkyard: false,
      artemCorpse: false,
      egorMarum: false,
      motelArtem: false,
      motelBodyguard: false,
    });
    this.engine.setAtmosphere(0x060a18, 0x090f24, 0.0032);
    this.chunks.forceRefresh(0, 0, true, this.physics);
    this.audio.setPaused(false);
    this.audio.setSandevistanMode(false);
    this.audio.setMusicIntensity('title');
    this.hud.showScreen('TITLE');
  }

  startCampaign(): void {
    this.audio.ensureStarted();
    this.stats = createInitialRunStats();
    this.player.state.resetFull(false);
    this.weapons.state.reset(['mantis_blades', 'alatau_pistol'], 'alatau_pistol');
    this.openWorld.reset();
    this.towerSecurityHacked = false;
    this.enterAct('PROLOGUE_ROOFTOP');
  }

  startFreeRoam(): void {
    this.audio.ensureStarted();
    this.stats = createInitialRunStats();
    this.player.state.resetFull(false);
    this.player.state.addTenge(1500);
    this.weapons.state.reset(['mantis_blades', 'alatau_pistol', 'steppe_smg'], 'mantis_blades');
    this.openWorld.reset();
    this.towerSecurityHacked = false;
    this.enterAct('OPEN_WORLD');
  }

  /**
   * Continues exploring Cyber-Almaty after the credits while preserving all player upgrades,
   * unlocked weapons, tenge, street cred, completed gigs, and run stats.
   */
  continuePostgameFreeRoam(): void {
    this.audio.ensureStarted();
    this.player.state.restoreForCheckpoint();
    this.weapons.state.refillAllMagazines();
    this.enterAct('OPEN_WORLD');
  }

  jumpToAct(act: GameAct): void {
    this.audio.ensureStarted();
    this.stats = createInitialRunStats();
    this.player.state.resetFull(false);
    this.openWorld.reset();
    this.towerSecurityHacked = false;
    if (act === 'TOWER_ASSAULT' || act === 'SMASHER_BOSS' || act === 'HUYESHI_CYBERSPACE') {
      this.weapons.state.reset(
        ['mantis_blades', 'alatau_pistol', 'steppe_smg', 'buran_shotgun', 'malorian'],
        'malorian',
      );
      this.player.state.applyUpgrade('reinforcedPlating');
    } else if (act === 'OPEN_WORLD') {
      this.weapons.state.reset(['mantis_blades', 'alatau_pistol', 'steppe_smg'], 'mantis_blades');
    } else {
      this.weapons.state.reset(['mantis_blades', 'alatau_pistol'], 'alatau_pistol');
    }
    this.enterAct(act);
  }

  private enterAct(act: GameAct): void {
    this.stateMachine.transition(act);
    this.paused = false;
    this.modalOpen = 'NONE';
    this.awaitingChoice = false;
    this.activeChoiceContext = 'NONE';
    this.activeChoices = [];
    this.targetLetterbox = 0;
    this.penthouseChokeSfxFired = false;
    this.smasherExecShot1Fired = false;
    this.smasherExecShot2Fired = false;
    this.smasherExecShotTimer = 0;
    this.pendingAssaultTransition = false;
    this.assaultTransitionTimer = 0;
    this.assaultFadeTimer = 0;
    this.pendingCyberspaceEnding = null;
    this.cyberspaceFadeTimer = 0;
    this.pendingLungeHit = null;
    this.lastDistrictId = null;
    this.wasNearMarum = false;
    this.wasCarNitroActive = false;
    this.input.clearTransient();
    this.clearDialogueQueue();
    this.audio.setPaused(false);
    this.audio.setSandevistanMode(false);
    this.player.state.sandevistanActive = false;

    this.hud.hideChoices();
    this.hud.setBossBar(false);
    this.hud.setHuyeshiProgress(false);
    this.hud.setRelicWarning(false);
    this.hud.setInteractPrompt(null);
    this.hud.setCombatHudVisible(true);
    this.hud.setSamirSync(this.stats.samirAffinity);
    this.hud.showScreen('HUD');

    this.enemies.clearZone();
    this.smasher.deactivate();
    this.vehicle.state.occupied = false;
    this.vehicle.state.stopAutopilot();
    this.fx = createDefaultPostFx();

    // Gate city open-world interactables exclusively to OPEN_WORLD and reset story interactables
    const enableCityHub = act === 'OPEN_WORLD';
    this.city.setInteractableEnabled('ripperdoc_marum', enableCityHub);
    this.city.setInteractableEnabled('gig_board_marum', enableCityHub);
    this.city.setInteractableEnabled('rooftop_elevator_up', enableCityHub);
    this.city.setInteractableEnabled('rooftop_elevator_down', enableCityHub);
    this.city.setInteractableEnabled('rooftop_start_assault', enableCityHub);
    this.city.setInteractableEnabled('motel_sink', false);
    this.city.setInteractableEnabled('gig_malorian_stash', false);
    this.city.setInteractableEnabled('gig_tastak_terminal', false);
    this.city.setMotelLocked(act === 'TASTAK_BETRAYAL');

    this.instances.setInteractableEnabled('heist_steal_biochip', false);
    this.instances.setInteractableEnabled('heist_hide_closet', false);
    this.instances.setInteractableEnabled('heist_elevator_btn', false);
    this.instances.setInteractableEnabled('tower_elevator_down', false);
    this.instances.setInteractableEnabled('tower_hack_security', false);
    this.instances.setInteractableEnabled('smasher_execute', false);
    this.instances.setInteractableEnabled('huyeshi_jack_in', false);
    this.instances.setSupplyCrateUsed('tower_supply_lobby', false);
    this.instances.setSupplyCrateUsed('tower_supply_arena', false);

    // =========================================================================
    // ACT 1: PROLOGUE ROOFTOP (Exact reconstruction of IMG-20261123-WA0011.jpg!)
    // =========================================================================
    if (act === 'PROLOGUE_ROOFTOP') {
      this.instances.setActiveInstance('NONE');
      this.city.setStoryProps({
        samirRooftop: true,
        samirJunkyard: false,
        artemCorpse: false,
        egorMarum: false,
        motelArtem: false,
        motelBodyguard: false,
      });
      this.engine.setAtmosphere(0x060a18, 0x0a1124, 0.0028);
      this.chunks.forceRefresh(165, 165, true, this.physics);

      const pose = this.city.getRooftopCameraPose();
      this.player.teleport(pose.position.x, 36, pose.position.z, Math.PI * 0.25, -0.05);
      this.player.setMode('ROOFTOP_SIT');
      this.player.configureInteractiveCutscene(pose.position, pose.lookAt, pose.fov);

      this.weapons.setVisible(false);
      this.hud.setCrosshairVisible(false);
      this.hud.setCombatHudVisible(false);
      this.targetLetterbox = 0.55;

      this.hud.showActBanner('АКТ I // КРЫША КОК-ТОБЕ — ПРОЛОГ', 4.5);
      this.audio.setMusicIntensity('almaty_night');
      this.queueLine(
        'samir',
        'Не знаешь какого друга послать насмерть? Благо у тебя есть один кент который уже мертв.',
        4.6,
        true,
      );
      this.setCheckpoint(act, pose.position.x, 36, pose.position.z, Math.PI * 0.25);
      return;
    }

    // =========================================================================
    // ACT 2: FLASHBACK HEIST (2 weeks ago — Rodion's 92nd-floor Penthouse 9201)
    // =========================================================================
    if (act === 'FLASHBACK_HEIST') {
      this.instances.setPenthouseCorridorLocked(true);
      this.instances.setActiveInstance('PENTHOUSE');
      this.instances.penthouseElevator.reset();
      this.instances.penthouseRodion.group.visible = false;
      this.instances.penthouseLev.group.visible = false;
      this.instances.penthouseSmasherProp.visible = false;
      this.instances.biochipCase.visible = true;
      this.instances.penthouseSanzhar.group.visible = true;
      this.instances.setPenthouseSanzharState('room');
      this.chunks.forceRefresh(0, 0, false, this.physics);
      this.engine.setAtmosphere(0x080714, 0x110c1e, 0.0075);
      this.player.teleport(0, INSTANCE_Y.PENTHOUSE, 13, 0, 0);
      this.player.setMode('FREE');
      this.weapons.state.reset(['mantis_blades', 'alatau_pistol'], 'alatau_pistol');
      this.weapons.setVisible(true);
      this.hud.setCrosshairVisible(true);
      this.instances.setInteractableEnabled('heist_steal_biochip', true);
      this.hud.showIntertitle(
        '2 НЕДЕЛИ НАЗАД',
        'ПЕНТХАУС МАРАКУЛИН ТАУЭР // НОМЕР РОДИОНА 9201',
        'ФЛЭШБЕК // КИБЕР-АЛМАТЫ',
        3.4,
      );
      this.hud.showActBanner('2 НЕДЕЛИ НАЗАД // ЛЮКС РОДИОНА 9201', 5.5);
      this.hud.setObjective('УКРАДИТЕ БИОЧИП ИЗ НОМЕРА РОДИОНА МАРАКУЛИНА [E]');
      this.audio.setMusicIntensity('ambient');
      this.queueLine(
        'sanzhar',
        'Аи, мы в элитном номере 9201 Родиона Маракулина! Артём ждёт биочип — бери кейс на столе и валим.',
        5.2,
        true,
      );
      this.setCheckpoint(act, 0, INSTANCE_Y.PENTHOUSE, 13, 0);
      this.input.requestPointerLock();
      return;
    }

    // =========================================================================
    // ACT 3: FLASHBACK CHASE (Inside 3D Cyber-Akhmed cabin with Sanzhar — 2 fair waves!)
    // =========================================================================
    if (act === 'FLASHBACK_CHASE') {
      this.instances.setActiveInstance('CHASE');
      this.instances.setChaseSanzharWounded(false);
      this.instances.setChaseBiochipVisible(false);
      this.chunks.forceRefresh(0, 0, false, this.physics);
      this.engine.setAtmosphere(0x050918, 0x0a1024, 0.0045);
      this.player.state.hp = this.player.state.maxHp;
      this.player.state.armor = this.player.state.maxArmor;
      this.player.teleport(0, INSTANCE_Y.CHASE + 0.5, 4, 0, 0);
      this.player.setMode('CHASE_PASSENGER');
      // Give Ai rapid-fire Steppe-9 SMG for a thrilling, fair chase!
      this.weapons.state.unlockWeapon('steppe_smg', true);
      this.weapons.setVisible(true);
      this.hud.setCrosshairVisible(true);
      this.chaseWaveSpawned = false;
      this.chaseDronesRemaining = 4;
      this.hud.showActBanner('АКТ III // ПОГОНЯ В ТАКСИ «КИБЕР-АХМЕД»', 4.5);
      this.hud.setObjective('ОТСТРЕЛИВАЙТЕСЬ ОТ КОРПО-ДРОНОВ ИЗ ПП «СТЕПЬ-9» (ВОЛНА 1/2)');
      this.audio.setMusicIntensity('chase');
      this.queueLine(
        'akhmed',
        'Кибер-Ахмед на связи! Броня такси держит удар! Аи, бери ПП из бардачка и сними дроны с хвоста!',
        5.0,
        true,
      );
      // Wave 1: 2 drones right in front of the unobstructed windshield
      this.enemies.spawnWave([
        { id: 'chase_d1', archetype: 'drone', zoneId: 'chase', x: -5.2, y: INSTANCE_Y.CHASE + 1.4, z: -16, hp: 38 },
        { id: 'chase_d2', archetype: 'drone', zoneId: 'chase', x: 5.2, y: INSTANCE_Y.CHASE + 1.6, z: -19, hp: 38 },
      ]);
      this.chaseWaveSpawned = true;
      this.setCheckpoint(act, 0, INSTANCE_Y.CHASE + 0.5, 4, 0);
      this.input.requestPointerLock();
      return;
    }

    // =========================================================================
    // ACT 4: TASTAK BETRAYAL (Artem's Motel Room 204 with visible Bodyguard!)
    // =========================================================================
    if (act === 'TASTAK_BETRAYAL') {
      this.instances.setActiveInstance('NONE');
      this.city.setMotelBodyguardChokePose(false);
      this.city.setStoryProps({
        samirRooftop: false,
        samirJunkyard: false,
        artemCorpse: false,
        egorMarum: false,
        motelArtem: true,
        motelBodyguard: true,
      });
      this.engine.setAtmosphere(0x090612, 0x130a1d, 0.0048);
      this.chunks.forceRefresh(-165, -165, true, this.physics);
      this.player.teleport(-165, 0.25, -158, 0, 0);
      this.player.setMode('FREE');
      this.weapons.state.reset(['mantis_blades', 'alatau_pistol'], 'mantis_blades');
      this.weapons.setVisible(true);
      this.hud.setCrosshairVisible(true);
      this.city.setInteractableEnabled('motel_sink', false);
      this.hud.showActBanner('АКТ IV // МОТЕЛЬ «ТАСТАК» — НОМЕР 204', 4.5);
      this.hud.setObjective('ПОГОВОРИТЕ С АРТЁМОМ В НОМЕРЕ 204');
      this.audio.setMusicIntensity('ambient');
      this.queueLine(
        'artem',
        'Аи... Вы с Санжаром облажались по полной. На весь город повесили убийство Льва Маракулина! Где биочип?',
        5.0,
        true,
      );
      this.setCheckpoint(act, -165, 0.25, -158, 0);
      this.input.requestPointerLock();
      return;
    }

    // =========================================================================
    // ACT 5: JUNKYARD AWAKENING (Bolt-1-style eyelids, ECG, Trauma & Samir!)
    // =========================================================================
    if (act === 'JUNKYARD_AWAKENING') {
      this.instances.setActiveInstance('NONE');
      this.city.setStoryProps({
        samirRooftop: false,
        samirJunkyard: true,
        artemCorpse: true,
        egorMarum: false,
        motelArtem: false,
        motelBodyguard: false,
      });
      this.engine.setAtmosphere(0x0b0a16, 0x151222, 0.0042);
      this.chunks.forceRefresh(-165, 165, true, this.physics);
      this.player.teleport(-165, 0, 165, 0, -0.1);
      this.player.setMode('FALLEN');
      this.player.configureInteractiveCutscene(
        { x: -165, y: 1.55, z: 165 },
        { x: -163.8, y: 1.48, z: 161.4 },
        66,
      );
      this.weapons.setVisible(false);
      this.hud.setCrosshairVisible(false);
      this.hud.setCombatHudVisible(false);
      this.targetLetterbox = 0.72;
      this.fx.eyelids = 0.96;
      this.fx.relicGlitch = 0.8;
      this.hud.setRelicWarning(true, 'БИОМОНИТОР // КРИТИЧЕСКИЙ СБОЙ — РЕАНИМАЦИЯ БИОЧИПОМ');
      this.hud.showActBanner('АКТ V // СВАЛКА — ПРОБУЖДЕНИЕ', 4.5);
      this.audio.playRelicGlitch();
      this.audio.playTinnitus(2.8);
      this.audio.setMusicIntensity('operating');
      this.ecgBeatTimer = 0.6;
      this.setCheckpoint(act, -165, 0, 165, 0);
      return;
    }

    // =========================================================================
    // ACT 6: OPEN WORLD CYBER-ALMATY (500x500m + Chunks + Rain + AVs + Taxi)
    // =========================================================================
    if (act === 'OPEN_WORLD') {
      this.instances.setActiveInstance('NONE');
      this.city.setStoryProps({
        samirRooftop: true,
        samirJunkyard: false,
        artemCorpse: true,
        egorMarum: false,
        motelArtem: false,
        motelBodyguard: false,
      });
      this.engine.setAtmosphere(0x060a18, 0x090f24, 0.0032);
      this.vehicle.setVisible(true);
      this.vehicle.state.setPose(-46, 0, -10, -Math.PI / 2);
      this.vehicle.syncMesh();
      this.player.teleport(-46, 0.25, -24, Math.PI, 0);
      this.player.setMode('FREE');
      this.chunks.forceRefresh(-46, -24, true, this.physics);
      this.weapons.setVisible(true);
      this.hud.setCrosshairVisible(true);
      this.hud.showActBanner('КИБЕР-АЛМАТЫ 500×500М // ПОЛУОТКРЫТЫЙ МИР', 5.0);
      this.audio.setMusicIntensity('almaty_night');
      this.spawnOpenWorldEncounters();
      this.updateOpenWorldObjective();
      this.queueLine(
        'samir',
        'Весь Кибер-Алматы перед нами. Вызови Кибер-Ахмеда [C], загляни в «Марум» к рипердоку, забери мой Malorian на Тастаке и взломай ретрансляторы — это даст козыри перед штурмом на смотровой крыше!',
        7.5,
        true,
      );
      this.setCheckpoint(act, -46, 0.25, -24, Math.PI);
      this.input.requestPointerLock();
      return;
    }

    // =========================================================================
    // ACT 7: TOWER ASSAULT (Bolt 1 Marakulin Tower Lighting + Nonlinear Approaches!)
    // =========================================================================
    if (act === 'TOWER_ASSAULT') {
      const hadMalorian = this.weapons.state.unlocked.has('malorian');
      this.weapons.state.unlockWeapon('malorian', true);
      this.weapons.triggerSpin();
      this.instances.setActiveInstance('UNDERGROUND');
      this.instances.undergroundElevator.reset();
      this.instances.setTowerSecurityHacked(false);
      this.instances.setSupplyCrateUsed('tower_supply_lobby', false);
      this.instances.setSupplyCrateUsed('tower_supply_arena', false);
      this.chunks.forceRefresh(0, 0, false, this.physics);
      this.engine.setAtmosphere(0x090612, 0x110818, 0.0085);

      const yLobby = INSTANCE_Y.UNDERGROUND + 24;
      this.player.teleport(0, yLobby, 13, 0, 0);
      this.player.setMode('FREE');
      this.weapons.setVisible(true);
      this.hud.setCrosshairVisible(true);

      // Apply linear-nonlinear assault approach bonuses strictly matching the chosen plan!
      const bonuses = this.openWorld.getAssaultBonuses(this.player.state.streetCred);
      const approach = this.stats.assaultApproach;
      if (approach === 'eblanhana' && bonuses.hasEblanhanaSupport) {
        this.player.state.armor = this.player.state.maxArmor;
        this.player.state.maxDocCharges = Math.min(
          this.player.state.maxMaxDoc,
          this.player.state.maxDocCharges + 2,
        );
      } else if (approach === 'eblanhana') {
        this.player.state.maxDocCharges = Math.min(
          this.player.state.maxMaxDoc,
          this.player.state.maxDocCharges + 1,
        );
      }

      const preHacked = approach === 'netrunner' && bonuses.hasNetrunnerIntel;
      this.towerSecurityHacked = preHacked;
      this.instances.setTowerSecurityHacked(preHacked);
      this.instances.setInteractableEnabled('tower_hack_security', !preHacked);

      this.hud.showIntertitle(
        'НАСТОЯЩЕЕ ВРЕМЯ',
        'ШТУРМ МАРАКУЛИН ТАУЭР // ГЛАВНЫЙ ХОЛЛ',
        'ПОРА РАЗВЛЕЧЬСЯ КАК В 2026',
        3.0,
      );
      this.hud.showActBanner(
        approach === 'netrunner'
          ? 'АКТ VII // ШТУРМ МАРАКУЛИН ТАУЭР (НЕТРАННЕР)'
          : approach === 'eblanhana'
            ? 'АКТ VII // ШТУРМ МАРАКУЛИН ТАУЭР (ЛЕГЕНДА ЕБЛАНХАНЫ)'
            : 'АКТ VII // ШТУРМ МАРАКУЛИН ТАУЭР (КАК В 2026)',
        5.0,
      );
      this.hud.setObjective(
        preHacked
          ? 'ТУРЕЛИ ОТКЛЮЧЕНЫ! ЗАЧИСТИТЕ АТРИУМ И СПУСТИТЕСЬ К «ХУЕШИ»'
          : 'ЗАЧИСТИТЕ ГЛАВНЫЙ ХОЛЛ (ИЛИ ВЗЛОМАЙТЕ ТЕРМИНАЛ СПРАВА) И СПУСТИТЕСЬ К «ХУЕШИ»',
      );
      this.audio.setMusicIntensity('combat');

      this.queueLine(
        'samir',
        hadMalorian
          ? 'Мой Malorian в деле, как в старые добрые... Пора развлечься как в 2026!'
          : 'Пора развлечься как в 2026! Забирай мой Malorian S-3516 — и разнесём Маракулин Тауэр до основания!',
        5.5,
        true,
      );

      const lobbyWave: Parameters<EnemyManager['spawnWave']>[0] = [
        { id: 'ta_1', archetype: 'guard', zoneId: 'tower_lobby', x: -7, y: yLobby, z: -2 },
        { id: 'ta_2', archetype: 'guard', zoneId: 'tower_lobby', x: 7, y: yLobby, z: -2 },
        { id: 'ta_3', archetype: 'netrunner', zoneId: 'tower_lobby', x: -5, y: yLobby, z: -15 },
        { id: 'ta_4', archetype: 'heavy', zoneId: 'tower_lobby', x: 4, y: yLobby, z: -16 },
      ];
      if (!preHacked) {
        lobbyWave.push(
          { id: 'ta_5', archetype: 'drone', zoneId: 'tower_lobby', x: 0, y: yLobby, z: -10 },
          { id: 'ta_6', archetype: 'turret', zoneId: 'tower_lobby', x: -9, y: yLobby, z: -19 },
        );
      } else {
        this.queueLine(
          'system',
          'НЕТРАННЕРСКИЙ ПРОТОКОЛ ТАСТАКА: Потолочные турели отключены, щит Рихарда Смэшера ослаблен на 20%!',
          4.6,
        );
      }
      this.enemies.spawnWave(lobbyWave);
      this.setCheckpoint(act, 0, yLobby, 13, 0);
      this.input.requestPointerLock();
      return;
    }

    // =========================================================================
    // ACT 8: SMASHER BOSS (3-Phase Detailed 3.1m Rikhard Smasher + Malorian Finisher!)
    // =========================================================================
    if (act === 'SMASHER_BOSS') {
      this.weapons.state.unlockWeapon('malorian', false);
      this.instances.undergroundElevator.snapToArrived();
      this.instances.setActiveInstance('UNDERGROUND');
      this.instances.setSupplyCrateUsed('tower_supply_arena', false);
      this.chunks.forceRefresh(0, 0, false, this.physics);
      this.engine.setAtmosphere(0x0b040c, 0x1a0612, 0.0072);
      const yCore = INSTANCE_Y.UNDERGROUND;
      this.player.teleport(0, yCore, -34, 0, 0);
      this.player.setMode('FREE');
      this.weapons.setVisible(true);
      this.hud.setCrosshairVisible(true);

      this.smasher.activateAt(0, yCore, -70);
      const netrunnerWeakened =
        this.towerSecurityHacked ||
        (this.stats.assaultApproach === 'netrunner' && this.openWorld.hasNetrunnerIntel());
      if (netrunnerWeakened) {
        this.smasher.setArmorWeakened(20);
      }

      this.audio.playSmasherRoar();
      this.audio.setMusicIntensity('boss');
      this.player.addScreenShake(0.32);
      this.fx.glitch = 0.7;
      this.hud.showActBanner('АКТ VIII // БОСС: РИХАРД СМЭШЕР', 5.0);
      this.hud.setObjective('ПОБЕДИТЕ РИХАРДА СМЭШЕРА И ДОБЕЙТЕ ЕГО ИЗ MALORIAN S-3516');
      this.queueLine(
        'smasher',
        'Опять ты, кусок мяса?! Самир в твоей башке мне надоел ещё в 2026 — раздавлю вас обоих перед Хуеши!',
        5.2,
        true,
      );
      if (netrunnerWeakened) {
        this.queueLine('samir', 'Отличный взлом, Аи — его энергощит искрит! Бей по голове и не стой на красных кругах!', 4.2);
      }
      this.setCheckpoint(act, 0, yCore, -34, 0);
      this.input.requestPointerLock();
      return;
    }

    // =========================================================================
    // ACT 9: HUYESHI CHAIR EXTRACTION -> CYBERSPACE & TAISIYA!
    // =========================================================================
    if (act === 'HUYESHI_CYBERSPACE') {
      // Phase 0: Seated in Bolt-1-style Huyeshi Chair under descending Neural Crown & lasers!
      this.instances.undergroundElevator.snapToArrived();
      this.instances.setActiveInstance('UNDERGROUND');
      this.instances.setHuyeshiExtraction(0);
      this.chunks.forceRefresh(0, 0, false, this.physics);
      this.engine.setAtmosphere(0x060918, 0x0b1228, 0.008);
      const yCore = INSTANCE_Y.UNDERGROUND;
      this.player.teleport(0, yCore, -90, 0, 0.45);
      this.player.setMode('HUYESHI_CHAIR');
      this.player.configureInteractiveCutscene(
        { x: 0, y: yCore + 1.55, z: -89.4 },
        { x: 0, y: yCore + 4.3, z: -90.2 },
        68,
      );
      this.weapons.setVisible(false);
      this.hud.setCrosshairVisible(false);
      this.hud.setCombatHudVisible(false);
      this.targetLetterbox = 0.65;
      this.hud.setHuyeshiProgress(true, 0, 'ХУЕШИ // ПОДКЛЮЧЕНИЕ К ЧЁРНОМУ ЗАСЛОНУ');
      this.hud.showActBanner('АКТ IX // ЗАПУСК «ХУЕШИ»', 4.5);
      this.audio.setMusicIntensity('soulkiller');
      this.audio.playSoulkillerSurge(4.6);
      this.queueLine('system', 'ХУЕШИ АКТИВИРОВАН. ЗАПУСК ПРОТОКОЛА РАЗДЕЛЕНИЯ СОЗНАНИЯ...', 4.2, true);
      this.setCheckpoint(act, 0, yCore, -90, 0);
      return;
    }

    // =========================================================================
    // ACT 10A: EPILOGUE MARUM (Legend of Eblanhana + Egor Eternal War contract)
    // =========================================================================
    if (act === 'EPILOGUE_MARUM') {
      this.stats.endingId = 'marum';
      this.instances.setActiveInstance('NONE');
      this.city.setStoryProps({
        samirRooftop: false,
        samirJunkyard: false,
        artemCorpse: false,
        egorMarum: true,
        motelArtem: false,
        motelBodyguard: false,
      });
      this.engine.setAtmosphere(0x070c1a, 0x0b1428, 0.0038);
      this.chunks.forceRefresh(-46, -40, true, this.physics);
      this.player.teleport(-46, 0.25, -45, Math.PI, 0);
      this.player.setMode('ROOFTOP_SIT');
      this.player.configureInteractiveCutscene(
        { x: -46, y: 1.78, z: -44.2 },
        { x: -46, y: 1.58, z: -38.5 },
        60,
      );
      this.weapons.setVisible(false);
      this.hud.setCrosshairVisible(false);
      this.hud.setCombatHudVisible(false);
      this.targetLetterbox = 0.68;
      this.hud.showIntertitle(
        'СПУСТЯ 2 МЕСЯЦА',
        'АНТИКАФЕ «МАРУМ» // ЛЕГЕНДА ЕБЛАНХАНЫ',
        'ЭПИЛОГ I // КИБЕР-АЛМАТЫ',
        3.2,
      );
      this.hud.showActBanner('ЭПИЛОГ I // ЛЕГЕНДА ЕБЛАНХАНЫ — АНТИКАФЕ «МАРУМ»', 5.5);
      this.audio.setMusicIntensity('marum_lounge');
      this.queueLine(
        'system',
        'Спустя 2 месяца. Аи вернулся в своё тело и стал живой легендой Ебланханы — владельцем антикафе «Марум».',
        5.2,
        true,
      );
      return;
    }

    // =========================================================================
    // ACT 10B: EPILOGUE TALDYKORGAN (Samir in Ai's body leaving for Taldykorgan!)
    // =========================================================================
    if (act === 'EPILOGUE_TALDYKORGAN') {
      this.stats.endingId = 'taldykorgan';
      this.instances.setActiveInstance('TALDYKORGAN');
      this.chunks.forceRefresh(0, 0, false, this.physics);
      this.engine.setAtmosphere(0x2a100c, 0x3b1810, 0.0048);
      this.player.teleport(0, INSTANCE_Y.TALDYKORGAN + 1.1, 8, 0, 0);
      this.player.setMode('ROOFTOP_SIT');
      this.player.configureInteractiveCutscene(
        { x: 0, y: INSTANCE_Y.TALDYKORGAN + 1.55, z: 8.2 },
        { x: 0, y: INSTANCE_Y.TALDYKORGAN + 2.2, z: -45 },
        70,
      );
      this.weapons.setVisible(false);
      this.hud.setCrosshairVisible(false);
      this.hud.setCombatHudVisible(false);
      this.targetLetterbox = 0.72;
      this.hud.showIntertitle(
        'ДОРОГА В ТАЛДЫКОРГАН',
        'САМИР В ТЕЛЕ АИ // ГОРОД-АД',
        'ЭПИЛОГ II // ПРОЩАЙ, АЛМАТЫ',
        3.2,
      );
      this.hud.showActBanner('ЭПИЛОГ II // ДОРОГА В ГОРОД-АД ТАЛДЫКОРГАН', 5.5);
      this.audio.setMusicIntensity('taldykorgan');
      this.queueLine(
        'system',
        'Самир в теле Аи покидает неоновый Кибер-Алматы навстречу рассвету.',
        4.6,
        true,
      );
      this.queueLine(
        'samir',
        'Кибер-Алматы остаётся позади. Впереди — город-ад Талдыкорган. Я не подведу тебя, Аи. Прощай, брат.',
        5.8,
      );
    }
  }

  private spawnOpenWorldEncounters(): void {
    for (const gig of OPEN_WORLD_GIGS) {
      const rt = this.openWorld.gigs.get(gig.id);
      const completed = rt?.status === 'completed';
      this.city.setGigPropCompleted(gig.id, completed);
      if (completed) continue;
      this.enemies.spawnWave(getGigEnemyWave(gig.id));
      if (gig.id === 'gig_malorian') {
        this.city.setInteractableEnabled('gig_malorian_stash', true);
      }
      if (gig.id === 'gig_tastak_hack') {
        this.city.setInteractableEnabled('gig_tastak_terminal', true);
      }
    }
  }

  private updateOpenWorldObjective(): void {
    const trackedId = this.openWorld.trackedGigId;
    const tracked = OPEN_WORLD_GIGS.find((g) => g.id === trackedId);
    if (tracked && this.openWorld.gigs.get(tracked.id)?.status !== 'completed') {
      this.activeObjectivePos = tracked.targetPos;
      this.hud.setObjective(
        `ЗАКАЗ: ${tracked.title} (${tracked.rewardTenge} ₸) — ИЛИ КРЫША КОК-ТОБЕ ДЛЯ ШТУРМА`,
      );
    } else {
      this.activeObjectivePos = { x: 148.5, y: 0, z: 157 };
      this.hud.setObjective('ПОДНИМИТЕСЬ НА СМОТРОВУЮ КРЫШУ КОК-ТОБЕ (ЮВ) ДЛЯ ВЫБОРА ПЛАНА ШТУРМА');
    }
  }

  private setCheckpoint(act: GameAct, x: number, y: number, z: number, yaw: number): void {
    this.checkpoint = { act, x, y, z, yaw };
  }

  private handleViewportClick(): void {
    if (this.stateMachine.act === 'TITLE' || this.stateMachine.act === 'CREDITS') return;
    if (this.paused || this.modalOpen !== 'NONE' || this.awaitingChoice) return;
    this.audio.ensureStarted();
    this.input.requestPointerLock();
  }

  private handlePointerLockChange(locked: boolean): void {
    const isCinematicMode =
      this.player.mode === 'CINEMATIC' ||
      this.player.mode === 'ROOFTOP_SIT' ||
      this.player.mode === 'FALLEN' ||
      this.player.mode === 'EXECUTION' ||
      this.player.mode === 'HUYESHI_CHAIR' ||
      this.player.mode === 'CHOKED';

    if (
      !locked &&
      this.stateMachine.act !== 'TITLE' &&
      this.stateMachine.act !== 'CREDITS' &&
      this.modalOpen === 'NONE' &&
      !this.awaitingChoice &&
      !isCinematicMode
    ) {
      this.paused = true;
      this.audio.setPaused(true);
      this.hud.showScreen('PAUSE');
    }
  }

  private handleEscape(): void {
    if (this.stateMachine.act === 'TITLE' || this.stateMachine.act === 'CREDITS') return;
    if (this.modalOpen !== 'NONE') {
      this.closeModals();
      return;
    }
    if (this.paused) {
      this.resumeGame();
    } else {
      this.paused = true;
      this.audio.setPaused(true);
      this.input.exitPointerLock();
      this.hud.showScreen('PAUSE');
    }
  }

  private resumeGame(): void {
    this.paused = false;
    this.modalOpen = 'NONE';
    this.input.clearTransient();
    this.audio.setPaused(false);
    this.hud.showScreen('HUD');
    const wantsLock =
      this.player.mode === 'FREE' ||
      this.player.mode === 'CHASE_PASSENGER' ||
      this.player.mode === 'CLOSET' ||
      this.player.mode === 'CHOKED' ||
      this.player.mode === 'VEHICLE_THIRD';
    if (wantsLock && !this.awaitingChoice) {
      this.input.requestPointerLock();
    }
  }

  private restartFromCheckpoint(): void {
    this.player.state.restoreForCheckpoint();
    this.weapons.state.refillAllMagazines();
    this.input.clearTransient();
    this.enterAct(this.checkpoint.act);
  }

  private returnToTitle(): void {
    this.enterTitleScene();
  }

  private toggleMapModal(): void {
    if (this.stateMachine.act !== 'OPEN_WORLD' || this.awaitingChoice || this.pendingAssaultTransition) return;
    if (this.modalOpen === 'MAP') {
      this.closeModals();
      return;
    }
    this.modalOpen = 'MAP';
    this.paused = true;
    this.audio.setPaused(true);
    this.input.clearTransient();
    this.input.exitPointerLock();
    this.hud.renderFullMap(
      this.player.position,
      { x: this.vehicle.state.x, y: this.vehicle.state.y, z: this.vehicle.state.z },
      this.city.minimapBuildings,
      this.openWorld,
      this.activeObjectivePos,
      this.enemies.getAlivePositions(),
    );
    this.hud.showScreen('MAP');
  }

  private openRipperdocModal(): void {
    this.modalOpen = 'RIPPERDOC';
    this.paused = true;
    this.audio.setPaused(true);
    this.input.clearTransient();
    this.input.exitPointerLock();
    this.hud.renderRipperdoc(this.player.state, this.weapons.state.unlocked);
    this.hud.showScreen('RIPPERDOC');
  }

  private closeModals(): void {
    this.modalOpen = 'NONE';
    this.paused = false;
    this.input.clearTransient();
    this.audio.setPaused(false);
    this.hud.showScreen('HUD');
    if (!this.awaitingChoice) {
      this.input.requestPointerLock();
    }
  }

  private buyRipperdocItem(item: RipperdocItem): void {
    const alreadyOwned =
      (item.weaponId && this.weapons.state.unlocked.has(item.weaponId)) ||
      (item.upgradeKey && this.player.state.upgrades[item.upgradeKey]);
    const alreadyFull =
      item.category === 'consumable' &&
      this.player.state.maxDocCharges >= this.player.state.maxMaxDoc &&
      this.player.state.armor >= this.player.state.maxArmor;
    if (alreadyOwned || alreadyFull) return;

    if (!this.player.state.spendTenge(item.cost)) return;
    if (item.category === 'weapon' && item.weaponId) {
      this.weapons.state.unlockWeapon(item.weaponId, true);
    } else if (item.category === 'implant' && item.upgradeKey) {
      this.player.state.applyUpgrade(item.upgradeKey);
    } else if (item.category === 'consumable') {
      this.player.state.refillSupplies();
    }
    this.audio.playPurchase();
    this.hud.renderRipperdoc(this.player.state, this.weapons.state.unlocked);
    this.hud.updateVitals(this.player.state, this.weapons.state);
    this.queueLine('ripperdoc', `Отличный выбор, Аи! «${item.name}» откалиброван и готов к работе.`, 3.8, true);
  }

  private fastTravelToDistrict(districtId: DistrictId): void {
    const dist = DISTRICTS.find((d) => d.id === districtId);
    if (!dist) return;
    this.vehicle.state.occupied = false;
    this.vehicle.state.stopAutopilot();
    this.chunks.forceRefresh(dist.fastTravelPos.x, dist.fastTravelPos.z, true, this.physics);
    this.player.teleport(dist.fastTravelPos.x, 0.25, dist.fastTravelPos.z, dist.fastTravelYaw, 0);
    this.player.setMode('FREE');
    this.weapons.setVisible(true);
    this.vehicle.summonNear(dist.fastTravelPos.x, dist.fastTravelPos.z, dist.fastTravelYaw, this.physics);
    this.audio.playCarHornOrSummon();
    this.closeModals();
    this.queueLine('akhmed', `Прибыли в район «${dist.name}», брат! Если понадоблюсь — зови на [C].`, 4.0, true);
  }

  private trackGig(gigId: string): void {
    this.openWorld.activateGig(gigId);
    this.updateOpenWorldObjective();
    this.hud.renderFullMap(
      this.player.position,
      { x: this.vehicle.state.x, y: this.vehicle.state.y, z: this.vehicle.state.z },
      this.city.minimapBuildings,
      this.openWorld,
      this.activeObjectivePos,
      this.enemies.getAlivePositions(),
    );
  }

  private handleChoiceSelection(choiceId: string): void {
    if (!this.awaitingChoice) return;
    const ctx = this.activeChoiceContext;
    this.awaitingChoice = false;
    this.activeChoiceContext = 'NONE';
    this.activeChoices = [];
    this.input.clearTransient();
    this.hud.hideChoices();

    // Apply affinity & queue branching response lines if defined
    const branchResp = BRANCH_RESPONSES[choiceId];
    if (branchResp) {
      this.adjustSamirAffinity(branchResp.affinityDelta);
      const lines = getBranchResponseLines(choiceId, this.censoredDialogue);
      lines.forEach((l, idx) => this.queueLine(l.speaker, l.text, l.duration, idx === 0));
    }

    if (ctx === 'ROOFTOP_PROLOGUE') {
      this.stateMachine.subStep = 2;
      this.stateMachine.actTimer = 0;
      return;
    }

    if (ctx === 'MOTEL_ARTEM') {
      this.stateMachine.subStep = 1;
      this.city.setInteractableEnabled('motel_sink', true);
      this.hud.setObjective('ЗАЙДИТЕ В ВАННУЮ МОТЕЛЯ И УМОЙТЕСЬ [E]');
      this.input.requestPointerLock();
      return;
    }

    if (ctx === 'ASSAULT_PLAN') {
      const approach: AssaultApproach =
        choiceId === 'assault_netrunner'
          ? 'netrunner'
          : choiceId === 'assault_eblanhana'
            ? 'eblanhana'
            : 'frontal';
      this.stats.assaultApproach = approach;
      this.audio.playHoloChime();
      // Let queued rooftop plan dialogue play out cleanly before transitioning into Tower Assault
      this.pendingAssaultTransition = true;
      this.assaultTransitionTimer = 0;
      this.assaultFadeTimer = 0;
      return;
    }

    if (ctx === 'SMASHER_EXECUTION') {
      // Let all 3 last-words dialogue lines play before pulling the Malorian trigger!
      this.stateMachine.subStep = 2;
      this.stateMachine.actTimer = 0;
      this.smasherExecShot1Fired = false;
      this.smasherExecShot2Fired = false;
      this.smasherExecShotTimer = 0;
      this.weapons.state.unlockWeapon('malorian', true);
      this.weapons.setVisible(true);
      return;
    }

    if (ctx === 'CYBERSPACE_ENDING') {
      const choice: 'marum' | 'taldykorgan' = choiceId === 'ending_taldykorgan' ? 'taldykorgan' : 'marum';
      // Append affinity-reactive Taisiya + Samir farewell lines right inside Cyberspace!
      const farewell = getCyberspaceFarewellLines(choice, this.stats.samirAffinity, this.censoredDialogue);
      for (const l of farewell) {
        this.queueLine(l.speaker, l.text, l.duration, false);
      }
      this.pendingCyberspaceEnding = choice;
      this.cyberspaceFadeTimer = 0;
      this.stateMachine.subStep = 3;
      this.stateMachine.actTimer = 0;
      return;
    }

    if (ctx === 'EGOR_CONTRACT') {
      this.queueLine('ai', 'Вечная война? Звучит достойно легенды Ебланханы. Я в деле, Егор.', 4.6, true);
      this.stateMachine.subStep = 3;
      this.stateMachine.actTimer = 0;
    }
  }

  private findNearestInteractable(): InteractablePoint | null {
    const px = this.player.position.x;
    const py = this.player.position.y + 1.0;
    const pz = this.player.position.z;

    const list = this.stateMachine.isOpenWorldLike()
      ? this.city.interactables
      : this.instances.interactables;

    let best: InteractablePoint | null = null;
    let bestDist = Infinity;
    for (const it of list) {
      if (!it.enabled) continue;
      if (Math.abs(it.y - py) > 3.2) continue;
      const d = Math.hypot(it.x - px, it.z - pz);
      if (d <= it.radius && d < bestDist) {
        best = it;
        bestDist = d;
      }
    }
    return best;
  }

  private handleInteract(target: InteractablePoint | null): void {
    if (this.stateMachine.act === 'OPEN_WORLD') {
      if (this.vehicle.state.occupied) {
        this.vehicle.state.occupied = false;
        this.vehicle.state.stopAutopilot();
        const exit = this.vehicle.getExitPosition(this.physics);
        this.player.teleport(exit.x, 0.25, exit.z, this.vehicle.state.yaw, 0);
        this.player.setMode('FREE');
        this.weapons.setVisible(true);
        this.hud.setCrosshairVisible(true);
        return;
      }
      if (
        !target &&
        this.vehicle.isPlayerNear(this.player.position.x, this.player.position.y, this.player.position.z)
      ) {
        this.vehicle.state.occupied = true;
        this.player.setMode('VEHICLE_THIRD');
        this.weapons.setVisible(false);
        this.hud.setCrosshairVisible(false);
        this.audio.playCarHornOrSummon();
        this.queueLine('akhmed', AKHMED_DRIVING_LINES[this.akhmedLineIdx++ % AKHMED_DRIVING_LINES.length], 4.2, true);
        return;
      }
    }

    if (!target) return;

    switch (target.id) {
      case 'ripperdoc_marum':
        this.openRipperdocModal();
        break;
      case 'gig_board_marum':
        this.toggleMapModal();
        break;
      case 'rooftop_elevator_up':
        this.audio.playElevatorDing();
        this.player.teleport(162, 36, 160, Math.PI * 0.25, 0);
        this.queueLine(
          'samir',
          'Вот мы и на крыше. Подойди ко мне [E] — выберем тактику штурма Маракулин Тауэр.',
          5.0,
          true,
        );
        break;
      case 'rooftop_elevator_down':
        this.audio.playElevatorDing();
        this.player.teleport(148, 0.25, 152, Math.PI, 0);
        break;
      case 'rooftop_start_assault': {
        // Linear-Nonlinear 3-way Assault Plan choice right on the Rooftop (matching IMG-20261123-WA0011.jpg)!
        const pose = this.city.getRooftopCameraPose();
        this.player.setMode('ROOFTOP_SIT');
        this.player.configureInteractiveCutscene(pose.position, pose.lookAt, pose.fov);
        this.weapons.setVisible(false);
        this.hud.setCombatHudVisible(false);
        this.targetLetterbox = 0.55;
        const planChoices = getAssaultPlanChoices({
          hasNetrunnerIntel: this.openWorld.hasNetrunnerIntel(),
          hasEblanhanaSupport: this.openWorld.hasEblanhanaSupport(this.player.state.streetCred),
          censored: this.censoredDialogue,
        });
        this.queueLine(
          'samir',
          'Точка невозврата, Аи. Как берём Маракулин Тауэр? Всё, что ты сделал в Кибер-Алматы, сейчас сыграет свою роль.',
          5.8,
          true,
        );
        this.presentChoices('ASSAULT_PLAN', BRANCHING_CHOICES.tower_assault_plan.title, planChoices);
        break;
      }
      case 'gig_malorian_stash': {
        this.city.setInteractableEnabled('gig_malorian_stash', false);
        this.weapons.state.unlockWeapon('malorian', true);
        this.weapons.triggerSpin();
        this.audio.playPurchase();
        this.adjustSamirAffinity(15);
        this.completeGig('gig_malorian');
        this.queueLine(
          'samir',
          'Мой Malorian S-3516! Чёрт возьми, как же приятно снова видеть его в деле. Синхронизация растёт!',
          5.5,
          true,
        );
        break;
      }
      case 'gig_tastak_terminal': {
        this.city.setInteractableEnabled('gig_tastak_terminal', false);
        this.audio.playTerminalHack();
        this.completeGig('gig_tastak_hack');
        this.queueLine(
          'samir',
          'Отлично! Коды безопасности Маракулин Тауэр у нас — теперь на крыше откроется нетраннерский план штурма!',
          5.2,
          true,
        );
        break;
      }
      case 'heist_steal_biochip': {
        this.instances.setInteractableEnabled('heist_steal_biochip', false);
        this.instances.biochipCase.visible = false;
        this.audio.playTerminalHack();
        this.instances.setPenthouseSanzharState('approaching_closet');
        this.instances.setInteractableEnabled('heist_hide_closet', true);
        this.hud.setObjective('РОДИОН ЗАХОДИТ! СПРЯЧЬТЕСЬ В ШКАФ СЛЕВА С САНЖАРОМ [E]');
        this.queueLine('sanzhar', 'Твою мать, Родион вернулся раньше! Я уже у шкафа слева — залезай внутрь, Аи!', 4.5, true);
        this.stateMachine.subStep = 1;
        break;
      }
      case 'heist_hide_closet': {
        this.instances.setInteractableEnabled('heist_hide_closet', false);
        // BOTH Ai and Sanzhar climb right inside the 2-person 3D slatted closet!
        this.instances.setPenthouseSanzharState('inside_closet');
        this.player.teleport(-10.1, INSTANCE_Y.PENTHOUSE, 6.7, -Math.PI * 0.44, -0.02);
        this.player.setMode('CLOSET');
        this.weapons.setVisible(false);
        this.hud.setCrosshairVisible(false);
        this.hud.setCombatHudVisible(false);
        this.targetLetterbox = 0.62;
        this.instances.penthouseRodion.group.visible = true;
        this.instances.penthouseLev.group.visible = true;
        this.instances.penthouseSmasherProp.visible = true;
        this.instances.animatePenthouseMurder(0);
        this.stateMachine.subStep = 2;
        this.stateMachine.actTimer = 0;
        this.penthouseChokeSfxFired = false;
        this.queueLine('lev', 'Родион, ты позоришь империю Маракулиных! Я отстраняю тебя от совета директоров!', 3.6, true);
        this.queueLine('rodion', 'Хватит, отец... Твоё время вышло. Вся мегакорпорация теперь принадлежит МНЕ!', 3.6);
        break;
      }
      case 'heist_elevator_btn': {
        this.instances.setInteractableEnabled('heist_elevator_btn', false);
        // Guide player cleanly inside the elevator cabin center so moving doors never clip
        this.player.teleport(0, INSTANCE_Y.PENTHOUSE, -38.0, Math.PI, 0);
        this.audio.playElevatorDing();
        this.audio.playElevatorRide(3.4);
        this.instances.penthouseElevator.state.startRide();
        this.hud.setObjective('СПУСК НА ЛИФТЕ В ГАРАЖ К ТАКСИ «КИБЕР-АХМЕД»');
        break;
      }
      case 'motel_sink': {
        this.city.setInteractableEnabled('motel_sink', false);
        // KEEP BOTH Bodyguard & Artem visible! Position Bodyguard right in front of Ai's face choking him!
        this.city.setStoryProps({ motelArtem: true, motelBodyguard: true });
        this.city.setMotelBodyguardChokePose(true);
        this.stateMachine.subStep = 2;
        this.stateMachine.actTimer = 0;
        this.chokeBeatTimer = 0.1;
        this.fx.damageVignette = 0.85;
        this.player.setMode('CHOKED');
        this.player.configureInteractiveCutscene(
          { x: -171.65, y: 1.58, z: -172.7 },
          { x: -170.2, y: 1.76, z: -171.6 },
          60,
        );
        this.weapons.state.equip('mantis_blades');
        this.weapons.setVisible(true);
        this.audio.playChokeHeartbeat();
        this.hud.setRelicWarning(true, 'ТЕЛОХРАНИТЕЛЬ ДУШИТ ВАС! НАЖМИТЕ [ЛКМ] ИЛИ [F] — КЛИНКИ БОГОМОЛА!');
        this.hud.setObjective('НАЖМИТЕ [ЛКМ] ИЛИ [F], ЧТОБЫ ВЫРВАТЬСЯ КЛИНКАМИ БОГОМОЛА!');
        this.queueLine('artem', 'Хватай его! Нам не нужны свидетели убийства Льва Маракулина!', 4.2, true);
        break;
      }
      case 'tower_supply_lobby':
      case 'tower_supply_arena': {
        if (
          this.player.state.maxDocCharges >= this.player.state.maxMaxDoc &&
          this.player.state.armor >= this.player.state.maxArmor
        ) {
          this.queueLine('system', 'ЗАПАС MAXDOC И ТАКТИЧЕСКАЯ БРОНЯ УЖЕ ПОЛНЫ.', 2.4, true);
          break;
        }
        this.instances.setSupplyCrateUsed(target.id, true);
        this.player.state.refillSupplies();
        this.audio.playMaxDoc();
        this.queueLine('system', 'ПОПОЛНЕНЫ ЗАРЯДЫ MAXDOC И ТАКТИЧЕСКАЯ БРОНЯ.', 2.8, true);
        break;
      }
      case 'tower_hack_security': {
        this.towerSecurityHacked = true;
        this.instances.setTowerSecurityHacked(true);
        this.audio.playTerminalHack();
        this.enemies.clearZone('tower_lobby'); // Hack fries remaining lobby drones/turrets & clears hack path!
        this.queueLine(
          'system',
          'УЗЕЛ БЕЗОПАСНОСТИ ВЗЛОМАН! Защита холла отключена, броня Рихарда Смэшера ослабленa на 20%!',
          4.8,
          true,
        );
        break;
      }
      case 'tower_elevator_down': {
        this.instances.setInteractableEnabled('tower_elevator_down', false);
        // Step cleanly inside pass-through cabin facing North (exit door opens straight into Boss Arena!)
        this.player.teleport(0, INSTANCE_Y.UNDERGROUND + 24, -30.5, 0, 0);
        this.audio.playElevatorDing();
        this.audio.playElevatorRide(3.6);
        this.instances.undergroundElevator.state.startRide();
        this.hud.setObjective('СПУСК В ПОДЗЕМНЫЙ КОМПЛЕКС «ХУЕШИ»...');
        break;
      }
      case 'smasher_execute': {
        // Bolt-1-caliber interactive Malorian S-3516 execution cutscene!
        this.instances.setInteractableEnabled('smasher_execute', false);
        this.stateMachine.subStep = 1;
        this.stateMachine.actTimer = 0;
        this.weapons.state.unlockWeapon('malorian', true);
        this.weapons.setVisible(true);
        this.hud.setCrosshairVisible(false);
        this.hud.setCombatHudVisible(false);
        this.targetLetterbox = 0.65;

        this.smasher.positionForExecution(this.player.position, this.physics);
        const headTarget = this.smasher.getHeadWorldPosition();
        this.player.setMode('EXECUTION');
        this.player.configureInteractiveCutscene(
          { x: this.player.position.x, y: this.player.position.y + 1.52, z: this.player.position.z },
          headTarget,
          56,
        );
        this.audio.playSmasherRoar();
        this.queueLine('smasher', 'Кхх... невозможно... жалкий кусок мяса... Самир... это ты?..', 4.2, true);
        this.presentChoices(
          'SMASHER_EXECUTION',
          BRANCHING_CHOICES.smasher_execution.title,
          getBranchChoices('smasher_execution', this.censoredDialogue),
        );
        break;
      }
      case 'huyeshi_jack_in': {
        this.instances.setInteractableEnabled('huyeshi_jack_in', false);
        this.audio.playRelicGlitch();
        this.enterAct('HUYESHI_CYBERSPACE');
        break;
      }
    }
  }

  private completeGig(gigId: string): void {
    const def = this.openWorld.completeGig(gigId);
    if (!def) return;
    this.city.setGigPropCompleted(gigId, true);
    this.player.state.addTenge(def.rewardTenge);
    this.player.state.streetCred += def.rewardCred;
    this.stats.gigsCompleted++;
    this.stats.tengeEarned += def.rewardTenge;
    this.hud.showActBanner(`ЗАКАЗ ВЫПОЛНЕН: ${def.title} (+${def.rewardTenge} ₸)`, 4.2);
    this.audio.playPurchase();
    this.updateOpenWorldObjective();
  }

  private handleCombatInput(input: InputSnapshot): void {
    if (this.awaitingChoice) return;

    // Allow breaking out of Motel Bodyguard Choke with LMB or F!
    if (this.stateMachine.act === 'TASTAK_BETRAYAL' && this.stateMachine.subStep === 2) {
      if (input.firePressed || input.meleePressed) {
        this.stateMachine.subStep = 3;
        this.city.setMotelBodyguardChokePose(false);
        this.city.setStoryProps({ motelArtem: false, motelBodyguard: false });
        this.hud.setRelicWarning(false);
        this.player.setMode('FREE');
        this.player.teleport(-170.8, 0.25, -170.4, -Math.PI * 0.68, 0);
        this.weapons.state.equip('mantis_blades');
        this.weapons.triggerMantisSlashVisual(2);
        this.audio.playMantisSlash(true);
        this.player.addScreenShake(0.28);
        this.audio.setMusicIntensity('combat');
        this.hud.setObjective('УБЕЙТЕ ТЕЛОХРАНИТЕЛЯ И АРТЁМА КЛИНКАМИ БОГОМОЛА!');
        this.queueLine('ai', 'Отвали от меня! *ВЫДВИГАЕТ КЛИНКИ БОГОМОЛА*', 3.2, true);
        this.enemies.spawnWave([
          { id: 'motel_bg', archetype: 'bodyguard', zoneId: 'motel', x: -166.0, y: 0.25, z: -169.8, hp: 90 },
          { id: 'motel_artem', archetype: 'artem', zoneId: 'motel', x: -160.2, y: 0.25, z: -167.2, hp: 120 },
        ]);
      }
      return;
    }

    if (
      this.player.mode !== 'FREE' &&
      this.player.mode !== 'CHASE_PASSENGER'
    ) {
      return;
    }
    if (this.vehicle.state.occupied) return;

    if (input.weaponSlotKey !== null) {
      if (this.weapons.state.equipBySlot(input.weaponSlotKey)) {
        this.audio.playReload();
      }
    } else if (input.wheelDelta !== 0) {
      if (this.weapons.state.cycle(input.wheelDelta)) {
        this.audio.playReload();
      }
    }

    if (input.reloadPressed) {
      if (this.weapons.state.startReload()) {
        this.audio.playReload();
      }
    }

    // Mantis Blade Leap Attack on Right Click (supports Boss lock-on & resolves strike on impact!)
    if (input.aimPressed && this.weapons.state.activeWeapon === 'mantis_blades') {
      const overclock = this.player.state.upgrades.mantisOverclock;
      if (this.weapons.state.tryMantisLunge(overclock)) {
        const eye = this.player.getEyePosition();
        const fwd = this.player.getForwardDirection();
        let target = this.enemies.findNearestEnemyInCone(eye, fwd, 9.5);
        if (!target && this.stateMachine.act === 'SMASHER_BOSS') {
          const phase = this.smasher.state.phase;
          if (phase === 'PHASE_1' || phase === 'PHASE_2' || phase === 'PHASE_3') {
            const bossPos = this.smasher.getPosition().clone();
            bossPos.y += 1.4;
            const toBoss = bossPos.clone().sub(eye);
            const dist = toBoss.length();
            if (dist <= 10.5 && dist > 0.1 && toBoss.normalize().dot(fwd) > 0.55) {
              target = bossPos;
            }
          }
        }
        const lungeDir = target ? target.clone().sub(this.player.position).normalize() : fwd;
        this.player.applyLungeImpulse(lungeDir, overclock ? 28 : 22, 0.16);
        this.weapons.triggerMantisSlashVisual(2);
        this.audio.playMantisSlash(true);
        const dmg = overclock ? 135 : 98;
        this.pendingLungeHit = { timer: 0.14, damage: dmg, range: 5.4 };
      }
    }

    // Quick Melee / Malorian Flame Melee on F
    if (input.meleePressed && this.weapons.state.tryFlameOrQuickMelee()) {
      const eye = this.player.getEyePosition();
      const fwd = this.player.getForwardDirection();
      if (this.weapons.state.activeWeapon === 'malorian') {
        this.weapons.triggerFlameMeleeVisual(eye, fwd);
        this.audio.playFlameMelee();
        this.resolveMeleeDamage(eye, fwd, 4.6, 88);
      } else if (this.weapons.state.activeWeapon === 'mantis_blades') {
        this.weapons.triggerMantisSlashVisual(2);
        this.audio.playMantisSlash(true);
        const dmg = this.player.state.upgrades.mantisOverclock ? 98 : 68;
        this.resolveMeleeDamage(eye, fwd, 4.2, dmg);
      } else {
        this.weapons.triggerQuickMeleeVisual();
        this.audio.playMantisSlash(false);
        this.resolveMeleeDamage(eye, fwd, 3.8, 68);
      }
    }

    const spec = this.weapons.state.getSpec();
    const wantsFire = spec.automatic ? input.fireHeld : input.firePressed;
    if (!wantsFire) return;

    const fireRes = this.weapons.state.tryFire();
    if (fireRes.needReload) {
      this.audio.playReload();
      return;
    }
    if (!fireRes.fired) return;

    const eye = this.player.getEyePosition();
    const fwd = this.player.getForwardDirection();

    if (spec.isMelee) {
      this.weapons.triggerMantisSlashVisual(fireRes.comboStep);
      this.audio.playMantisSlash(fireRes.comboStep === 2);
      const dmg = Math.round(
        spec.damage *
          (fireRes.comboStep === 2 ? 1.35 : 1.0) *
          (this.player.state.upgrades.mantisOverclock ? 1.45 : 1.0),
      );
      this.resolveMeleeDamage(eye, fwd, spec.range, dmg);
      return;
    }

    this.weapons.triggerShotVisual();
    this.player.addRecoilKick(
      spec.recoilPitch * (1 - this.player.getAimBlend() * 0.45),
      (Math.random() - 0.5) * 0.01,
    );
    if (spec.id === 'malorian') this.audio.playMalorianShot();
    else if (spec.id === 'steppe_smg') this.audio.playSmgShot();
    else if (spec.id === 'buran_shotgun') this.audio.playShotgunShot();
    else this.audio.playPistolShot();

    const muzzlePos = this.weapons.getMuzzleWorldPosition();
    const spreadScale = 1 - this.player.getAimBlend() * 0.55;

    for (let p = 0; p < spec.pellets; p++) {
      this.stats.shotsFired++;
      const dir = fwd.clone();
      if (spec.spreadRad > 0) {
        dir.x += (Math.random() - 0.5) * spec.spreadRad * spreadScale;
        dir.y += (Math.random() - 0.5) * spec.spreadRad * spreadScale;
        dir.z += (Math.random() - 0.5) * spec.spreadRad * spreadScale;
        dir.normalize();
      }

      const wallHit = this.physics.raycastBullets(eye, dir, spec.range);
      const maxDist = wallHit.hit ? wallHit.distance : spec.range;
      let endPoint = new THREE.Vector3(wallHit.point.x, wallHit.point.y, wallHit.point.z);

      if (this.stateMachine.act === 'SMASHER_BOSS') {
        const bHit = this.smasher.checkBulletHit(eye, dir, maxDist, spec.damage, spec.headshotMult);
        if (bHit.hit) {
          endPoint = bHit.point;
          this.stats.shotsHit++;
          if (bHit.headshot) this.stats.headshots++;
          this.hud.triggerHitmarker(bHit.headshot);
          this.audio.playHitMarker(bHit.headshot);
          this.enemies.spawnSparks(bHit.point, 7, 0xff003c);
          this.handleSmasherPhaseEvents(bHit.enteredPhase2, bHit.enteredPhase3, bHit.enteredStaggered);
          this.weapons.spawnTracer(muzzlePos, endPoint, spec.accentHex);
          continue;
        }
      }

      const eHit = this.enemies.checkBulletHit(eye, dir, maxDist, spec.damage, spec.headshotMult);
      if (eHit.hit) {
        endPoint = eHit.point;
        this.stats.shotsHit++;
        if (eHit.headshot) this.stats.headshots++;
        this.hud.triggerHitmarker(eHit.headshot);
        this.audio.playHitMarker(eHit.headshot);
        if (eHit.killed) {
          this.handleEnemyKilled(eHit.zoneId, eHit.rewardTenge, false);
        }
      } else if (wallHit.hit) {
        this.enemies.spawnSparks(endPoint, 3, 0x00f0ff);
      }

      this.weapons.spawnTracer(muzzlePos, endPoint, spec.accentHex);
    }
  }

  private resolveMeleeDamage(eye: THREE.Vector3, fwd: THREE.Vector3, range: number, damage: number): void {
    const hits = this.enemies.applyMeleeArc(eye, fwd, range, damage, this.physics);
    for (const h of hits) {
      this.hud.triggerHitmarker(false);
      this.audio.playHitMarker(false);
      if (h.killed) {
        this.handleEnemyKilled(h.zoneId, h.rewardTenge, true);
      }
    }

    if (this.stateMachine.act === 'SMASHER_BOSS') {
      const bHit = this.smasher.applyMeleeDamage(eye, range, damage, fwd, this.physics);
      if (bHit.hit) {
        this.hud.triggerHitmarker(false);
        this.audio.playHitMarker(false);
        this.enemies.spawnSparks(bHit.point, 8, 0x00f0ff);
        this.handleSmasherPhaseEvents(bHit.enteredPhase2, bHit.enteredPhase3, bHit.enteredStaggered);
      }
    }
  }

  private handleSmasherPhaseEvents(p2: boolean, p3: boolean, staggered: boolean): void {
    if (p2) {
      this.audio.playSmasherRoar();
      this.queueLine('smasher', 'САНДЕВИСТАН АКТИВИРОВАН! ПОПРОБУЙ ПОПАСТЬ, ЩЕНОК!', 4.2, true);
    }
    if (p3) {
      this.audio.playSmasherRoar();
      this.queueLine('samir', 'У него перегрев брони! Дожимай Смэшера, Аи!', 4.0, true);
    }
    if (staggered) {
      this.audio.playExplosion(true);
      const pos = this.smasher.getPosition();
      this.instances.updateInteractablePos('smasher_execute', pos.x, pos.y + 1.2, pos.z);
      this.instances.setInteractableEnabled('smasher_execute', true);
      this.hud.setObjective('ПОДОЙДИТЕ К СМЭШЕРУ И ДОБЕЙТЕ ЕГО ИЗ MALORIAN S-3516 [E]');
      this.queueLine('samir', 'ОН НА КОЛЕНЯХ! Подойди с моим Malorian и покончи с Рихардом Смэшером [E]!', 6.0, true);
    }
  }

  private handleEnemyKilled(zoneId: string | null, rewardTenge: number, melee: boolean): void {
    this.stats.enemiesEliminated++;
    if (melee) this.stats.meleeKills++;
    if (rewardTenge > 0) {
      this.player.state.addTenge(rewardTenge);
      this.stats.tengeEarned += rewardTenge;
    }

    if (zoneId && (zoneId === 'gig_junkyard' || zoneId === 'gig_convoy' || zoneId === 'gig_cyberpsycho')) {
      if (this.enemies.getAliveCount(zoneId) === 0) {
        this.completeGig(zoneId);
      }
    }

    if (this.stateMachine.act === 'FLASHBACK_CHASE' && zoneId === 'chase') {
      this.chaseDronesRemaining = this.enemies.getAliveCount('chase');
      if (this.chaseDronesRemaining > 0) {
        this.hud.setObjective(`ОТСТРЕЛИВАЙТЕСЬ ОТ КОРПО-ДРОНОВ (ОСТАЛОСЬ: ${this.chaseDronesRemaining})`);
      }
    }
  }

  private handlePlayerDamaged(amount: number, shake = 0.1): void {
    if (this.pendingDeathRespawn) return;
    // Cyber-Akhmed's armored chassis and motel betrayal sequence prevent unfair mid-cutscene softlocks
    const allowLethal =
      this.stateMachine.act !== 'TASTAK_BETRAYAL' && this.stateMachine.act !== 'FLASHBACK_CHASE';
    const res = this.player.state.takeDamage(amount, allowLethal);
    if (res.applied > 0) {
      this.fx.damageVignette = Math.min(1, this.fx.damageVignette + 0.55);
      this.player.addScreenShake(shake);
      this.audio.playPlayerHurt(amount >= 18);
    }
    if (res.died) {
      this.stats.deaths++;
      this.pendingDeathRespawn = true;
      this.hud.showActBanner('КРИТИЧЕСКИЙ СБОЙ // ОТКАТ К ЧЕКПОИНТУ', 3.0);
    }
  }

  private updateActLogic(dt: number, worldDt: number, input: InputSnapshot): void {
    const act = this.stateMachine.act;
    this.stateMachine.actTimer += dt;

    // 1. PROLOGUE ROOFTOP (Exact photo framing + interactive Cyberpunk 2077 choice!)
    if (act === 'PROLOGUE_ROOFTOP') {
      if (this.stateMachine.subStep === 0 && this.stateMachine.actTimer > 3.6) {
        this.stateMachine.subStep = 1;
        this.presentChoices(
          'ROOFTOP_PROLOGUE',
          BRANCHING_CHOICES.rooftop_prologue.title,
          getBranchChoices('rooftop_prologue', this.censoredDialogue),
        );
      } else if (this.stateMachine.subStep === 2) {
        if ((!this.isDialogueBusy() && this.stateMachine.actTimer > 2.0) || this.stateMachine.actTimer > 16.5) {
          this.stateMachine.subStep = 3;
          this.stateMachine.actTimer = 0;
        }
      } else if (this.stateMachine.subStep === 3) {
        this.fx.glitch = Math.min(0.7, this.stateMachine.actTimer * 0.7);
        this.fx.blackout = Math.min(1, this.stateMachine.actTimer / 1.4);
        if (this.stateMachine.actTimer > 1.5) {
          this.enterAct('FLASHBACK_HEIST');
        }
      }
      return;
    }

    // 2. FLASHBACK HEIST (3D Slatted Closet + Choreographed Rodion/Lev murder + Bolt 1 Elevator!)
    if (act === 'FLASHBACK_HEIST') {
      if (this.stateMachine.subStep === 2) {
        this.instances.animatePenthouseMurder(this.stateMachine.actTimer);
        if (!this.penthouseChokeSfxFired && this.stateMachine.actTimer >= 4.2) {
          this.penthouseChokeSfxFired = true;
          this.player.addScreenShake(0.14);
          this.audio.playPlayerHurt(true);
        }
        if (this.stateMachine.actTimer > 8.6) {
          this.instances.penthouseRodion.group.visible = false;
          this.instances.penthouseSmasherProp.visible = false;
          this.instances.setPenthouseCorridorLocked(false);
          this.instances.setPenthouseSanzharState('corridor');
          this.targetLetterbox = 0;
          this.hud.setCombatHudVisible(true);
          this.hud.setCrosshairVisible(true);
          this.player.teleport(-7.5, INSTANCE_Y.PENTHOUSE, 7, 0, 0);
          this.player.setMode('FREE');
          this.weapons.setVisible(true);
          this.stateMachine.subStep = 3;
          this.audio.setMusicIntensity('combat');
          this.hud.setObjective('ПРОРВИТЕСЬ С БОЕМ ПО ГОСТИНИЧНОМУ КОРИДОРУ К ЛИФТУ');
          this.queueLine(
            'sanzhar',
            'Он реально задушил собственного отца! Охуев от этого дерьма, прорываемся к лифту!',
            5.0,
            true,
          );
          this.enemies.spawnWave([
            { id: 'ph_g1', archetype: 'guard', zoneId: 'penthouse', x: -5, y: INSTANCE_Y.PENTHOUSE, z: -12 },
            { id: 'ph_g2', archetype: 'guard', zoneId: 'penthouse', x: 5, y: INSTANCE_Y.PENTHOUSE, z: -18 },
            { id: 'ph_g3', archetype: 'drone', zoneId: 'penthouse', x: 0, y: INSTANCE_Y.PENTHOUSE, z: -26 },
          ]);
        }
      } else if (this.stateMachine.subStep === 3 && this.enemies.getAliveCount('penthouse') === 0) {
        this.stateMachine.subStep = 4;
        this.instances.setInteractableEnabled('heist_elevator_btn', true);
        this.hud.setObjective('ЗАЙДИТЕ В ЛИФТ И НАЖМИТЕ [E], ЧТОБЫ СПУСТИТЬСЯ К КИБЕР-АХМЕДУ');
        this.queueLine('sanzhar', 'Путь к лифту чист! Жми кнопку [E] — Кибер-Ахмед ждёт внизу!', 4.5, true);
      }

      const elevRes = this.instances.penthouseElevator.update(worldDt);
      if (elevRes.floorChanged) this.audio.playElevatorFloorTick();
      if (this.instances.penthouseElevator.state.isRideActive()) {
        this.player.syncElevatorY(this.instances.penthouseElevator.state.currentY);
      }
      if (elevRes.arrived) {
        this.enterAct('FLASHBACK_CHASE');
      }
      return;
    }

    // 3. FLASHBACK CHASE (Inside Cyber-Akhmed Cabin — 2 fair waves + Dying Sanzhar Biochip Insertion!)
    if (act === 'FLASHBACK_CHASE') {
      this.fx.speedLines = 0.52;
      if (this.chaseWaveSpawned && this.enemies.getAliveCount('chase') === 0 && this.stateMachine.subStep === 0) {
        // Spawn Wave 2 (2 more drones) before escaping!
        this.stateMachine.subStep = 10;
        this.hud.setObjective('ОТСТРЕЛИВАЙТЕСЬ ОТ КОРПО-ДРОНОВ (ВОЛНА 2/2 — ПОСЛЕДНИЕ 2 ДРОНА)');
        this.queueLine(
          'akhmed',
          'Отлично сработал, брат! Остались ещё два дрона — сними их, и мы уходим в отрыв!',
          4.0,
          true,
        );
        this.enemies.spawnWave([
          { id: 'chase_d3', archetype: 'drone', zoneId: 'chase', x: -4.6, y: INSTANCE_Y.CHASE + 1.8, z: -17, hp: 38 },
          { id: 'chase_d4', archetype: 'drone', zoneId: 'chase', x: 4.8, y: INSTANCE_Y.CHASE + 1.5, z: -21, hp: 38 },
        ]);
      } else if (this.stateMachine.subStep === 10 && this.enemies.getAliveCount('chase') === 0) {
        this.stateMachine.subStep = 1;
        this.stateMachine.actTimer = 0;
        this.instances.setChaseSanzharWounded(true);
        this.weapons.setVisible(false);
        this.hud.setCrosshairVisible(false);
        this.hud.setCombatHudVisible(false);
        this.targetLetterbox = 0.6;
        this.audio.setMusicIntensity('ambient');
        this.queueLine(
          'ai',
          'ДААА! Мы сделали это, Санжар! Оторвались от корпов! Санжар?.. Эй, ты чего молчишь?!',
          4.5,
          true,
        );
      } else if (this.stateMachine.subStep === 1 && this.stateMachine.actTimer > 4.6) {
        this.stateMachine.subStep = 2;
        this.stateMachine.actTimer = 0;
        this.instances.setChaseBiochipVisible(true);
        this.queueLine(
          'sanzhar',
          'Меня... зацепило в лифте, брат. Держи биочип... не отдавай его Артёму, забери и продай... Я вставляю его тебе в слот...',
          6.0,
          true,
        );
        this.fx.relicGlitch = 0.78;
        this.audio.playRelicGlitch();
        this.audio.playTinnitus(2.2);
      } else if (this.stateMachine.subStep === 2 && this.stateMachine.actTimer > 6.2) {
        this.fx.blackout = Math.min(1, (this.stateMachine.actTimer - 6.2) / 1.5);
        if (this.stateMachine.actTimer > 7.8) {
          this.enterAct('TASTAK_BETRAYAL');
        }
      }
      return;
    }

    // 4. TASTAK BETRAYAL (Motel dialogue choice -> Sink -> Choke Struggle -> Point-blank shot!)
    if (act === 'TASTAK_BETRAYAL') {
      if (this.stateMachine.subStep === 0 && this.stateMachine.actTimer > 3.2 && !this.awaitingChoice) {
        this.presentChoices(
          'MOTEL_ARTEM',
          BRANCHING_CHOICES.motel_artem.title,
          getBranchChoices('motel_artem', this.censoredDialogue),
        );
      } else if (this.stateMachine.subStep === 2) {
        // Choke heartbeat pulse until player breaks free with Mantis Blades!
        this.chokeBeatTimer -= dt;
        this.fx.damageVignette = 0.72 + Math.sin(this.elapsedTotal * 7) * 0.16;
        if (this.chokeBeatTimer <= 0) {
          this.chokeBeatTimer = 0.85;
          this.audio.playChokeHeartbeat();
        }
      } else if (this.stateMachine.subStep === 3 && this.enemies.getAliveCount('motel') === 0) {
        this.stateMachine.subStep = 4;
        this.stateMachine.actTimer = 0;
        this.audio.playMalorianShot();
        this.audio.playPlayerHurt(true);
        this.audio.playTinnitus(3.2);
        this.player.addScreenShake(0.5);
        this.fx.damageVignette = 1.0;
        this.fx.glitch = 1.0;
        this.weapons.setVisible(false);
        this.hud.setCombatHudVisible(false);
        this.targetLetterbox = 0.75;
        this.player.setMode('FALLEN');
        this.player.configureInteractiveCutscene(
          { x: this.player.position.x, y: this.player.position.y + 1.5, z: this.player.position.z },
          { x: -161, y: 1.5, z: -161 },
          72,
        );
        this.queueLine(
          'artem',
          'Думал уйдёшь живым?! Перед смертью я заберу тебя с собой, Аи! *ВЫСТРЕЛ В ГОЛОВУ*',
          4.2,
          true,
        );
      } else if (this.stateMachine.subStep === 4) {
        this.fx.blackout = Math.min(1, this.stateMachine.actTimer / 2.4);
        if (this.stateMachine.actTimer > 3.8) {
          this.enterAct('JUNKYARD_AWAKENING');
        }
      }
      return;
    }

    // 5. JUNKYARD AWAKENING (Bolt 1 Operating Table eyelids blink + ECG + Samir!)
    if (act === 'JUNKYARD_AWAKENING') {
      const t = this.stateMachine.actTimer;
      // Double realistic blink just like Bolt 1 Operating Table!
      const blink = t < 1.6 ? 0.96 - t * 0.45 : t < 2.2 ? 0.25 + (t - 1.6) * 0.85 : Math.max(0, 0.76 - (t - 2.2) * 0.45);
      this.fx.eyelids = Math.max(0, Math.min(1, blink));
      this.fx.relicGlitch = Math.max(0.1, 0.85 - t * 0.11);

      this.ecgBeatTimer -= dt;
      if (this.ecgBeatTimer <= 0 && t < 5.0) {
        this.ecgBeatTimer = 0.95;
        this.audio.playEcgBeep(860, 0.12, false);
      }

      if (this.stateMachine.subStep === 0 && t > 2.6) {
        this.stateMachine.subStep = 1;
        this.audio.playRelicGlitch();
        this.hud.setRelicWarning(true, 'БИОЧИП АКТИВЕН // КОНСТРУКТ: САМИР');
        this.queueLine('samir', 'Вставай ебанат блять, у нас Кибер-Алматы на сожжение.', 5.6, true);
      }
      if (t > 8.6) {
        this.enterAct('OPEN_WORLD');
      }
      return;
    }

    // 6. OPEN WORLD CYBER-ALMATY (500x500m + Chunks + Cyber-Akhmed)
    if (act === 'OPEN_WORLD') {
      if (this.pendingAssaultTransition) {
        this.assaultTransitionTimer += dt;
        if ((!this.isDialogueBusy() && this.assaultTransitionTimer > 1.8) || this.assaultTransitionTimer > 15.0) {
          this.assaultFadeTimer += dt;
          this.fx.glitch = Math.min(0.65, this.assaultFadeTimer * 0.65);
          this.fx.blackout = Math.min(1, this.assaultFadeTimer / 1.2);
          if (this.assaultFadeTimer >= 1.25) {
            this.pendingAssaultTransition = false;
            this.enterAct('TOWER_ASSAULT');
          }
        }
        return;
      }

      if (input.summonCarPressed && !this.vehicle.state.occupied && this.player.position.y < 5 && !this.awaitingChoice) {
        this.vehicle.summonNear(this.player.position.x, this.player.position.z, this.player.yaw, this.physics);
        this.audio.playCarHornOrSummon();
        this.queueLine('akhmed', 'Кибер-Ахмед подан прямо к бордюру! Садись на [E].', 3.4, true);
      }

      if (input.autopilotPressed && this.vehicle.state.occupied && this.activeObjectivePos) {
        if (this.vehicle.state.autopilotActive) {
          this.vehicle.state.stopAutopilot();
        } else {
          this.vehicle.state.startAutopilot(this.activeObjectivePos);
          this.queueLine('akhmed', 'Автопилот включён! Едем к активной цели, можешь отдохнуть.', 3.6, true);
        }
      }

      if (this.vehicle.state.occupied) {
        const vRes = this.vehicle.update(dt, input, this.physics);
        this.stats.distanceDrivenMeters += vRes.movedMeters;
        if (vRes.nitroActive) {
          if (!this.wasCarNitroActive) {
            this.audio.playCarNitro();
          }
          this.fx.speedLines = Math.min(0.85, this.fx.speedLines + dt * 2.5);
        }
        this.wasCarNitroActive = vRes.nitroActive;
        if (vRes.arrivedAutopilot) {
          this.audio.playCarHornOrSummon();
          this.queueLine('akhmed', 'Мы на месте, брат! Выходи на [E].', 3.4, true);
        }
        this.player.position.set(this.vehicle.state.x, this.vehicle.state.y, this.vehicle.state.z);
        this.player.yaw = this.vehicle.state.yaw;
        const rig = this.vehicle.getCameraRig();
        this.player.setExternalCamera(rig.pos, rig.lookAt, rig.fov);
      } else if (Math.abs(this.vehicle.state.speed) > 0.05 || this.wasCarNitroActive) {
        // Coast Cyber-Akhmed smoothly to a stop and extinguish nitro flames after player exits
        this.vehicle.update(dt, input, this.physics);
        this.wasCarNitroActive = false;
      }

      const district = getDistrictAt(this.player.position.x, this.player.position.z);
      if (district.id !== this.lastDistrictId) {
        this.lastDistrictId = district.id;
        this.hud.setDistrict(district.name, district.subtitle);
        if (this.openWorld.markDistrictVisited(district.id)) {
          const lines = DISTRICT_SAMIR_BANTER[district.id];
          this.queueLine('samir', lines[0], 5.0);
        }
      }
      const nearMarum =
        this.player.position.y < 7 &&
        Math.hypot(this.player.position.x - -46, this.player.position.z - -40) < 15;
      if (nearMarum !== this.wasNearMarum) {
        this.wasNearMarum = nearMarum;
        this.audio.setMusicIntensity(nearMarum ? 'marum_lounge' : 'almaty_night');
      }
      return;
    }

    // 7. TOWER ASSAULT
    if (act === 'TOWER_ASSAULT') {
      if (this.stateMachine.subStep === 0 && this.enemies.getAliveCount('tower_lobby') === 0) {
        this.stateMachine.subStep = 1;
        this.instances.setInteractableEnabled('tower_elevator_down', true);
        this.hud.setObjective('ЗАЙДИТЕ В ЛИФТ И СПУСТИТЕСЬ К «ХУЕШИ» [E]');
        this.queueLine('samir', 'Холл чист! Жми кнопку лифта [E] — Хуеши и последняя преграда ждут внизу.', 4.8, true);
      }
      const elevRes = this.instances.undergroundElevator.update(worldDt);
      if (elevRes.floorChanged) this.audio.playElevatorFloorTick();
      if (this.instances.undergroundElevator.state.isRideActive()) {
        this.player.syncElevatorY(this.instances.undergroundElevator.state.currentY);
      }
      if (elevRes.arrived) {
        this.enterAct('SMASHER_BOSS');
      }
      return;
    }

    // 8. SMASHER BOSS + INTERACTIVE EXECUTION CUTSCENE
    if (act === 'SMASHER_BOSS') {
      if (this.stateMachine.subStep === 2) {
        // Wait for the 3 last-words dialogue lines, then fire deterministic 2-shot Malorian execution burst
        if (!this.smasherExecShot1Fired) {
          if ((!this.isDialogueBusy() && this.stateMachine.actTimer > 1.2) || this.stateMachine.actTimer > 11.5) {
            this.smasherExecShot1Fired = true;
            this.smasherExecShotTimer = 0;
            this.weapons.triggerShotVisual();
            this.audio.playMalorianShot();
            this.audio.playExplosion(true);
            this.audio.playTinnitus(2.0);
            this.player.addScreenShake(0.45);
            this.fx.chromaticBoost = 0.85;
            this.fx.glitch = 0.6;
            this.smasher.finishExecutionAnimation();
            this.hud.setBossBar(false);
          }
          return;
        }

        this.smasherExecShotTimer += dt;
        if (!this.smasherExecShot2Fired && this.smasherExecShotTimer >= 0.42) {
          this.smasherExecShot2Fired = true;
          this.weapons.triggerShotVisual();
          this.audio.playMalorianShot();
          this.player.addScreenShake(0.28);
        }
        if (this.smasherExecShotTimer >= 2.2) {
          this.stateMachine.subStep = 3;
          this.targetLetterbox = 0;
          this.hud.setCombatHudVisible(true);
          this.hud.setCrosshairVisible(true);
          this.player.setMode('FREE');
          this.instances.setInteractableEnabled('huyeshi_jack_in', true);
          this.hud.setObjective('ПОДКЛЮЧИТЕСЬ К АППАРАТУ «ХУЕШИ» [E]');
          this.audio.setMusicIntensity('ambient');
          this.queueLine('samir', 'Рихард Смэшер мёртв! Подходим к креслу Хуеши [E] — пора разделить наши сознания.', 5.5, true);
          this.input.requestPointerLock();
        }
        return;
      }

      if (this.stateMachine.subStep === 0) {
        this.smasher.update(worldDt, this.player.position, this.player.getEyePosition(), this.physics, {
          onAutocannonShot: () => this.audio.playEnemyShot(true),
          onMissileExplode: () => this.audio.playExplosion(true),
          onRoar: () => this.audio.playSmasherRoar(),
          onPlayerDamaged: (dmg, shake) => this.handlePlayerDamaged(dmg, shake),
        });

        const phaseLabel =
          this.smasher.state.phase === 'STAGGERED'
            ? 'ОГЛУШЁН — ДОБИТЬ [E]'
            : this.smasher.state.phase === 'PHASE_3'
              ? 'ФАЗА III // БЕРСЕРК'
              : this.smasher.state.phase === 'PHASE_2'
                ? 'ФАЗА II // САНДЕВИСТАН'
                : 'ФАЗА I';

        this.hud.setBossBar(
          this.smasher.state.phase !== 'EXECUTED' && this.smasher.state.phase !== 'DORMANT',
          'РИХАРД СМЭШЕР // ОМЕГА-КИБОРГ',
          phaseLabel,
          this.smasher.state.getHpRatio(),
        );
      }
      return;
    }

    // 9. HUYESHI EXTRACTION (Bolt 1 Soulkiller sequence!) -> CYBERSPACE & TAISIYA!
    if (act === 'HUYESHI_CYBERSPACE') {
      if (this.stateMachine.subStep === 0) {
        const progress = Math.min(1, this.stateMachine.actTimer / 4.8);
        this.instances.setHuyeshiExtraction(progress);
        this.hud.setHuyeshiProgress(true, progress, 'ХУЕШИ // РАЗДЕЛЕНИЕ СОЗНАНИЯ');
        this.fx.soulkiller = progress;
        this.fx.glitch = progress * 0.45;
        if (progress >= 1) {
          // Dissolve into Cyberspace bridge before Taisiya!
          this.stateMachine.subStep = 1;
          this.stateMachine.actTimer = 0;
          this.fx.soulkiller = 0;
          this.fx.cyberspace = 0.72;
          this.targetLetterbox = 0;
          this.hud.setHuyeshiProgress(false);
          this.hud.setCombatHudVisible(true);
          this.instances.setActiveInstance('CYBERSPACE');
          this.engine.setAtmosphere(0x030916, 0x06152c, 0.0085);
          this.player.teleport(0, INSTANCE_Y.CYBERSPACE, 4, 0, 0);
          this.player.setMode('FREE');
          this.audio.setMusicIntensity('cyberspace');
          this.hud.setObjective('ПОДОЙДИТЕ К ТАИСИИ ПО ЦИФРОВОМУ МОСТУ');
          this.queueLine(
            'taisiya',
            'Добро пожаловать за Чёрный Заслон, Аи. Подойди ближе — я уже разделила вас с Самиром.',
            5.5,
            true,
          );
          this.input.requestPointerLock();
        }
        return;
      }

      this.fx.cyberspace = 0.72;
      if (this.stateMachine.subStep === 1 && this.player.position.z < -17) {
        this.stateMachine.subStep = 2;
        this.hud.setCombatHudVisible(false);
        this.targetLetterbox = 0.58;
        this.queueLine(
          'taisiya',
          'Твоё тело повреждено биочипом: если вернёшься сам — проживёшь лишь полгода. Если отдашь тело Самиру — он проживёт полноценную жизнь. Решай.',
          9.0,
          true,
        );
        this.presentChoices(
          'CYBERSPACE_ENDING',
          BRANCHING_CHOICES.cyberspace_ending.title,
          getBranchChoices('cyberspace_ending', this.censoredDialogue),
        );
      } else if (this.stateMachine.subStep === 3 && this.pendingCyberspaceEnding) {
        if ((!this.isDialogueBusy() && this.stateMachine.actTimer > 2.0) || this.stateMachine.actTimer > 24.0) {
          this.cyberspaceFadeTimer += dt;
          this.fx.blackout = Math.min(1, this.cyberspaceFadeTimer / 1.4);
          if (this.cyberspaceFadeTimer >= 1.5) {
            const choice = this.pendingCyberspaceEnding;
            this.pendingCyberspaceEnding = null;
            const next = this.stateMachine.selectFinaleEnding(choice);
            this.enterAct(next);
          }
        }
      }
      return;
    }

    // 10A. EPILOGUE MARUM + EGOR
    if (act === 'EPILOGUE_MARUM') {
      if (this.stateMachine.subStep === 0 && this.stateMachine.actTimer > 5.4) {
        this.stateMachine.subStep = 1;
        this.stateMachine.actTimer = 0;
        const syncNote =
          this.stats.samirAffinity >= 70
            ? ' Самир ушёл за Чёрный Заслон как твой настоящий брат.'
            : '';
        this.queueLine(
          'egor',
          `Поздравляю с новым «Марумом», легенда Ебланханы.${syncNote} Меня зовут Егор. У меня есть для тебя контракт на Вечную войну. Согласен?`,
          6.8,
          true,
        );
      } else if (this.stateMachine.subStep === 1 && this.stateMachine.actTimer > 6.4) {
        this.stateMachine.subStep = 2;
        this.presentChoices('EGOR_CONTRACT', 'КОНТРАКТ ЕГОРА', [
          {
            id: 'egor_accept',
            key: '1',
            text: 'Принять контракт на Вечную войну',
            subtext: 'Завершить историю Аи как легенды Ебланханы.',
          },
        ]);
      } else if (this.stateMachine.subStep === 3 && this.stateMachine.actTimer > 4.8) {
        this.stateMachine.transition('CREDITS');
        this.targetLetterbox = 0;
        this.input.exitPointerLock();
        this.hud.showCredits(this.stats);
      }
      return;
    }

    // 10B. EPILOGUE TALDYKORGAN
    if (act === 'EPILOGUE_TALDYKORGAN') {
      if ((!this.isDialogueBusy() && this.stateMachine.actTimer > 6.5) || this.stateMachine.actTimer > 14.0) {
        this.stateMachine.transition('CREDITS');
        this.targetLetterbox = 0;
        this.input.exitPointerLock();
        this.hud.showCredits(this.stats);
      }
    }
  }

  update(rawDt: number): void {
    const dt = Math.min(rawDt, 0.05);
    this.elapsedTotal += dt;

    // Title screen slow cinematic flyover of 500x500m Cyber-Almaty with rain & AVs!
    if (this.stateMachine.act === 'TITLE') {
      const a = this.elapsedTotal * 0.14;
      const camPos = { x: Math.cos(a) * 115, y: 58, z: Math.sin(a) * 115 };
      this.player.setExternalCamera(camPos, { x: 40, y: 24, z: -40 }, 72);
      this.city.update(this.elapsedTotal, camPos);
      this.engine.render(dt, this.fx);
      return;
    }

    if (this.stateMachine.act === 'CREDITS' || this.paused) {
      this.engine.render(dt, this.fx);
      return;
    }

    this.stats.elapsedSec += dt;
    this.updateDialogueQueue(dt);
    const input = this.input.consumeSnapshot();

    // Keyboard choice shortcuts [1]/[2]/[3]
    if (this.awaitingChoice && input.choiceKey) {
      const picked = this.activeChoices.find((c) => c.key === input.choiceKey && !c.disabled);
      if (picked) {
        this.handleChoiceSelection(picked.id);
      }
    }

    const controlsLockedByChoice = this.awaitingChoice || this.pendingAssaultTransition;

    // Cyberware abilities (with Bolt 1 Sandevistan pitch scaling!)
    if (!controlsLockedByChoice && input.sandevistanPressed && this.player.mode === 'FREE') {
      const tRes = this.player.state.toggleSandevistan();
      if (tRes.changed) {
        this.audio.playSandevistan(tRes.active);
        this.audio.setSandevistanMode(tRes.active);
      }
    }
    if (
      !controlsLockedByChoice &&
      input.healPressed &&
      (this.player.mode === 'FREE' || this.player.mode === 'CHASE_PASSENGER') &&
      this.player.state.useMaxDoc()
    ) {
      this.audio.playMaxDoc();
    }

    const timerRes = this.player.state.updateTimers(dt);
    if (timerRes.sandevistanEnded) {
      this.audio.playSandevistan(false);
      this.audio.setSandevistanMode(false);
    }

    const worldDt = dt * this.player.state.getWorldTimeScale();

    const act = this.stateMachine.act;
    const isRidingElevator =
      (act === 'FLASHBACK_HEIST' && this.instances.penthouseElevator.state.isRideActive()) ||
      (act === 'TOWER_ASSAULT' && this.instances.undergroundElevator.state.isRideActive());

    // Player movement & chunk streaming
    const moveRes = this.player.update(
      dt,
      input,
      this.physics,
      !this.vehicle.state.occupied && !controlsLockedByChoice,
      !isRidingElevator,
    );
    if (moveRes.dashed || moveRes.doubleJumped) {
      this.audio.playDash();
    }

    // Resolve delayed Mantis Blade lunge impact after player lunges forward into range
    if (this.pendingLungeHit) {
      this.pendingLungeHit.timer -= dt;
      const eye = this.player.getEyePosition();
      const fwd = this.player.getForwardDirection();
      const closeTarget = this.enemies.findNearestEnemyInCone(eye, fwd, 2.7);
      let closeBoss = false;
      if (this.stateMachine.act === 'SMASHER_BOSS') {
        const bp = this.smasher.getPosition();
        closeBoss = Math.hypot(bp.x - this.player.position.x, bp.z - this.player.position.z) <= 3.1;
      }
      if (this.pendingLungeHit.timer <= 0 || closeTarget !== null || closeBoss) {
        const hit = this.pendingLungeHit;
        this.pendingLungeHit = null;
        this.resolveMeleeDamage(eye, fwd, hit.range, hit.damage);
      }
    }

    const inOpenWorld = this.stateMachine.isOpenWorldLike();
    this.chunks.update(this.player.position.x, this.player.position.z, inOpenWorld, this.physics);

    // Interactions
    const nearest = !controlsLockedByChoice && this.player.mode === 'FREE' ? this.findNearestInteractable() : null;
    let promptLabel: string | null = nearest?.label ?? null;
    if (
      !controlsLockedByChoice &&
      !promptLabel &&
      this.stateMachine.act === 'OPEN_WORLD' &&
      !this.vehicle.state.occupied &&
      this.player.mode === 'FREE' &&
      this.vehicle.isPlayerNear(this.player.position.x, this.player.position.y, this.player.position.z)
    ) {
      promptLabel = '[E] СЕСТЬ В ТАКСИ «КИБЕР-АХМЕД»';
    }
    this.hud.setInteractPrompt(promptLabel);
    if (
      !controlsLockedByChoice &&
      input.interactPressed &&
      (this.player.mode === 'FREE' || this.vehicle.state.occupied)
    ) {
      this.handleInteract(nearest);
    }

    // Combat & weapons
    this.handleCombatInput(input);
    this.weapons.update(dt, moveRes.isMoving, this.player.getAimBlend());

    // Enemies AI (Cyber-Akhmed armored hull reduces chase drone damage by 65%)
    this.enemies.update(worldDt, this.player.position, this.player.getEyePosition(), this.physics, {
      onEnemyShot: (heavy) => this.audio.playEnemyShot(heavy),
      onPlayerHit: (dmg) => this.handlePlayerDamaged(dmg, 0.1),
      damageScale: this.stateMachine.act === 'FLASHBACK_CHASE' ? 0.35 : 1.0,
    });

    // Story & world tick (pass player.position for 3D Cyber-Rain!)
    if (!this.pendingDeathRespawn) {
      this.updateActLogic(dt, worldDt, input);
    }

    // Execute deferred respawn cleanly outside all projectile/enemy iteration loops
    if (this.pendingDeathRespawn) {
      this.pendingDeathRespawn = false;
      this.input.clearTransient();
      this.restartFromCheckpoint();
      this.engine.render(dt, this.fx);
      return;
    }

    if (inOpenWorld) {
      this.city.update(this.elapsedTotal, this.player.position);
    }
    this.instances.update(worldDt, this.elapsedTotal);

    // Smooth Post-FX decay & cinema letterbox transition
    this.fx.damageVignette = Math.max(0, this.fx.damageVignette - dt * 1.4);
    this.fx.glitch = Math.max(0, this.fx.glitch - dt * 0.9);
    this.fx.chromaticBoost = Math.max(0, this.fx.chromaticBoost - dt * 1.1);
    this.fx.relicGlitch = Math.max(0, this.fx.relicGlitch - dt * 0.45);
    this.fx.speedLines = Math.max(0, this.fx.speedLines - dt * 1.8);
    const targetSandy = this.player.state.sandevistanActive ? 1 : 0;
    this.fx.sandevistan += (targetSandy - this.fx.sandevistan) * Math.min(1, dt * 8);
    this.fx.letterbox += (this.targetLetterbox - this.fx.letterbox) * Math.min(1, dt * 5);

    // HUD updates
    this.hud.update(dt);
    this.hud.updateVitals(this.player.state, this.weapons.state);
    this.hud.setSamirSync(this.stats.samirAffinity);
    this.hud.updateVehicleHud(
      this.vehicle.state.occupied,
      this.vehicle.state.getSpeedKmh(),
      this.vehicle.state.nitroEnergy,
      this.vehicle.state.autopilotActive,
    );
    this.hud.setChunkStats(this.chunks.getStats(), inOpenWorld);
    this.hud.renderMinimap(
      this.player.position,
      this.player.yaw,
      { x: this.vehicle.state.x, y: this.vehicle.state.y, z: this.vehicle.state.z },
      this.enemies.getAlivePositions(),
      this.activeObjectivePos,
      this.city.minimapBuildings,
      inOpenWorld,
    );

    this.engine.render(dt, this.fx);
  }

  dispose(): void {
    this.input.dispose();
    this.weapons.dispose();
    this.instances.dispose();
    this.city.dispose();
    this.textures.dispose();
    this.audio.dispose();
  }
}

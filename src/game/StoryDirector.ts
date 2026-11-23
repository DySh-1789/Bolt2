import * as THREE from 'three';
import {
  createDefaultPostFx,
  createInitialRunStats,
  DISTRICTS,
  getDistrictAt,
  type CheckpointData,
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
  DISTRICT_SAMIR_BANTER,
  formatDialogueText,
  SPEAKER_META,
} from './DialogueLibrary';
import { HUD } from '../ui/HUD';

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
  private elapsedTotal = 0;
  private lastDistrictId: DistrictId | null = null;
  private activeObjectivePos: Vec3 | null = null;
  private chaseDronesRemaining = 0;
  private chaseWaveSpawned = false;
  private akhmedLineIdx = 0;

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
      onJumpToAct: (act) => this.jumpToAct(act),
      onResume: () => this.resumeGame(),
      onRestartCheckpoint: () => this.restartFromCheckpoint(),
      onReturnTitle: () => this.returnToTitle(),
      onSensitivityChange: (v) => this.input.setSensitivity(v),
      onVolumeChange: (v) => this.audio.setMasterVolume(v),
      onCensorToggle: (c) => {
        this.censoredDialogue = c;
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

  private say(speaker: SpeakerId, rawText: string, duration = 4.6): void {
    const meta = SPEAKER_META[speaker];
    this.hud.showSubtitle({
      speaker,
      speakerName: meta.name,
      role: meta.role,
      text: formatDialogueText(rawText, this.censoredDialogue),
      duration,
    });
    if (speaker === 'samir' || speaker === 'akhmed' || speaker === 'taisiya') {
      this.audio.playHoloChime();
    }
  }

  private enterTitleScene(): void {
    this.stateMachine.transition('TITLE');
    this.paused = false;
    this.modalOpen = 'NONE';
    this.awaitingChoice = false;
    this.input.exitPointerLock();
    this.weapons.setVisible(false);
    this.vehicle.setVisible(true);
    this.instances.setActiveInstance('NONE');
    this.city.setStoryProps({ samirRooftop: true, samirJunkyard: false, artemCorpse: false, egorMarum: false });
    this.engine.setAtmosphere(0x060a18, 0x090f24, 0.0036);
    this.chunks.forceRefresh(0, 0, true, this.physics);
    this.audio.setMusicIntensity('title');
    this.hud.showScreen('TITLE');
  }

  startCampaign(): void {
    this.audio.ensureStarted();
    this.stats = createInitialRunStats();
    this.player.state.resetFull(false);
    this.weapons.state.reset(['mantis_blades', 'alatau_pistol'], 'alatau_pistol');
    this.openWorld.reset();
    this.enterAct('PROLOGUE_ROOFTOP');
  }

  startFreeRoam(): void {
    this.audio.ensureStarted();
    this.stats = createInitialRunStats();
    this.player.state.resetFull(false);
    this.player.state.addTenge(1500); // Starter 3000 ₸ for open world fun
    this.weapons.state.reset(['mantis_blades', 'alatau_pistol', 'steppe_smg'], 'mantis_blades');
    this.openWorld.reset();
    this.enterAct('OPEN_WORLD');
  }

  jumpToAct(act: GameAct): void {
    this.audio.ensureStarted();
    this.stats = createInitialRunStats();
    this.player.state.resetFull(false);
    this.openWorld.reset();
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
    this.hud.hideChoices();
    this.hud.setBossBar(false);
    this.hud.setRelicWarning(false);
    this.hud.setInteractPrompt(null);
    this.hud.showScreen('HUD');

    this.enemies.clearZone();
    this.smasher.deactivate();
    this.vehicle.state.occupied = false;
    this.vehicle.state.stopAutopilot();
    this.fx = createDefaultPostFx();

    // Reset story interactables
    this.city.setInteractableEnabled('motel_sink', false);
    this.city.setInteractableEnabled('marakulin_front_doors', false);
    this.city.setInteractableEnabled('gig_malorian_stash', false);
    this.city.setInteractableEnabled('gig_tastak_terminal', false);
    this.instances.setInteractableEnabled('heist_steal_biochip', false);
    this.instances.setInteractableEnabled('heist_hide_closet', false);
    this.instances.setInteractableEnabled('heist_elevator_btn', false);
    this.instances.setInteractableEnabled('tower_elevator_down', false);
    this.instances.setInteractableEnabled('smasher_execute', false);
    this.instances.setInteractableEnabled('huyeshi_jack_in', false);

    if (act === 'PROLOGUE_ROOFTOP') {
      this.instances.setActiveInstance('NONE');
      this.city.setStoryProps({ samirRooftop: true, samirJunkyard: false, artemCorpse: false, egorMarum: false });
      this.engine.setAtmosphere(0x070a18, 0x0b1024, 0.0032);
      this.chunks.forceRefresh(165, 165, true, this.physics);
      this.player.teleport(167, 36, 167, Math.PI * 0.25, -0.05);
      this.player.setMode('CINEMATIC');
      this.weapons.setVisible(false);
      this.hud.setCrosshairVisible(false);
      this.hud.showActBanner('АКТ I // КРЫША КОК-ТОБЕ — ПРОЛОГ', 4.5);
      this.hud.setObjective('ПОГОВОРИТЕ С САМИРОМ НА КРЫШЕ');
      this.audio.setMusicIntensity('almaty_night');
      this.say(
        'ai',
        'Не знаешь какого друга послать насмерть? Благо у тебя есть один кент который уже мертв. Ты, я и Маракуя Тауэр — звучит как припевы в песнях Минтимера. Но оно того стоит.',
        7.5,
      );
      this.setCheckpoint(act, 167, 36, 167, Math.PI * 0.25);
      return;
    }

    if (act === 'FLASHBACK_HEIST') {
      this.instances.setActiveInstance('PENTHOUSE');
      this.instances.penthouseElevator.reset();
      this.instances.penthouseRodion.group.visible = false;
      this.instances.penthouseLev.group.visible = false;
      this.instances.penthouseSmasherProp.visible = false;
      this.instances.biochipCase.visible = true;
      this.instances.penthouseSanzhar.group.visible = true;
      this.chunks.forceRefresh(0, 0, false, this.physics);
      this.engine.setAtmosphere(0x090814, 0x120c1e, 0.009);
      this.player.teleport(0, INSTANCE_Y.PENTHOUSE, 13, 0, 0);
      this.player.setMode('FREE');
      this.weapons.state.reset(['mantis_blades', 'alatau_pistol'], 'alatau_pistol');
      this.weapons.setVisible(true);
      this.hud.setCrosshairVisible(true);
      this.instances.setInteractableEnabled('heist_steal_biochip', true);
      this.hud.showActBanner('2 НЕДЕЛИ НАЗАД // ПЕНТХАУС МАРАКУЛИН ТАУЭР', 5.0);
      this.hud.setObjective('УКРАДИТЕ БИОЧИП ИЗ НОМЕРА РОДИОНА МАРАКУЛИНА [E]');
      this.audio.setMusicIntensity('almaty_night');
      this.say('sanzhar', 'Аи, мы внутри номера Родиона! Артём ждёт биочип — хватай кейс на столе и валим!', 5.2);
      this.setCheckpoint(act, 0, INSTANCE_Y.PENTHOUSE, 13, 0);
      this.input.requestPointerLock();
      return;
    }

    if (act === 'FLASHBACK_CHASE') {
      this.instances.setActiveInstance('CHASE');
      this.chunks.forceRefresh(0, 0, false, this.physics);
      this.engine.setAtmosphere(0x060918, 0x0b1024, 0.0055);
      this.player.teleport(0, INSTANCE_Y.CHASE + 0.5, 4, 0, 0);
      this.player.setMode('CHASE_PASSENGER');
      this.weapons.state.equip('alatau_pistol');
      this.weapons.setVisible(true);
      this.hud.setCrosshairVisible(true);
      this.chaseWaveSpawned = false;
      this.chaseDronesRemaining = 4;
      this.hud.showActBanner('АКТ III // ПОГОНЯ В ТАКСИ «КИБЕР-АХМЕД»', 4.5);
      this.hud.setObjective('ОТСТРЕЛИВАЙТЕСЬ ОТ КОРПО-ДРОНОВ ИЗ ОКНА ТАКСИ (4 ДРОНА)');
      this.audio.setMusicIntensity('chase');
      this.say(
        'akhmed',
        'Кибер-Ахмед на связи! Врубаю боевой режим! Аи, сними дроны с хвоста, пока я вывожу нас на проспект Абая!',
        5.0,
      );
      this.enemies.spawnWave([
        { id: 'chase_d1', archetype: 'drone', zoneId: 'chase', x: -7, y: INSTANCE_Y.CHASE + 1.5, z: -18, hp: 55 },
        { id: 'chase_d2', archetype: 'drone', zoneId: 'chase', x: 7, y: INSTANCE_Y.CHASE + 1.8, z: -22, hp: 55 },
        { id: 'chase_d3', archetype: 'drone', zoneId: 'chase', x: -4, y: INSTANCE_Y.CHASE + 2.2, z: -28, hp: 55 },
        { id: 'chase_d4', archetype: 'drone', zoneId: 'chase', x: 5, y: INSTANCE_Y.CHASE + 1.6, z: -32, hp: 55 },
      ]);
      this.chaseWaveSpawned = true;
      this.setCheckpoint(act, 0, INSTANCE_Y.CHASE + 0.5, 4, 0);
      this.input.requestPointerLock();
      return;
    }

    if (act === 'TASTAK_BETRAYAL') {
      this.instances.setActiveInstance('NONE');
      this.city.setStoryProps({ samirRooftop: false, samirJunkyard: false, artemCorpse: false, egorMarum: false });
      this.engine.setAtmosphere(0x0a0714, 0x140a1d, 0.005);
      this.chunks.forceRefresh(-165, -165, true, this.physics);
      this.player.teleport(-165, 0.25, -158, 0, 0);
      this.player.setMode('FREE');
      this.weapons.state.reset(['mantis_blades', 'alatau_pistol'], 'mantis_blades');
      this.weapons.setVisible(true);
      this.hud.setCrosshairVisible(true);
      this.city.setInteractableEnabled('motel_sink', true);
      this.hud.showActBanner('АКТ IV // МОТЕЛЬ НА КИБЕР-ТАСТАКЕ', 4.5);
      this.hud.setObjective('ЗАЙДИТЕ В ВАННУЮ МОТЕЛЯ И УМОЙТЕСЬ [E]');
      this.audio.setMusicIntensity('almaty_night');
      this.say(
        'artem',
        'Аи... Вы с Санжаром облажались по полной. На нас повесили убийство Льва Маракулина! Иди умойся в ванной, с лица на тебе крови больше чем хрома.',
        6.0,
      );
      this.setCheckpoint(act, -165, 0.25, -158, 0);
      this.input.requestPointerLock();
      return;
    }

    if (act === 'JUNKYARD_AWAKENING') {
      this.instances.setActiveInstance('NONE');
      this.city.setStoryProps({ samirRooftop: false, samirJunkyard: true, artemCorpse: true, egorMarum: false });
      this.engine.setAtmosphere(0x0c0b16, 0x161421, 0.0045);
      this.chunks.forceRefresh(-165, 165, true, this.physics);
      this.player.teleport(-165, 0, 165, 0, -0.1);
      this.player.setMode('CINEMATIC');
      this.weapons.setVisible(false);
      this.hud.setCrosshairVisible(false);
      this.fx.eyelids = 0.95;
      this.fx.relicGlitch = 0.65;
      this.hud.setRelicWarning(true);
      this.hud.showActBanner('АКТ V // СВАЛКА — ПРОБУЖДЕНИЕ', 4.5);
      this.hud.setObjective('ОЧНИТЕСЬ НА СВАЛКЕ');
      this.audio.playRelicGlitch();
      this.audio.setMusicIntensity('almaty_night');
      this.setCheckpoint(act, -165, 0, 165, 0);
      return;
    }

    if (act === 'OPEN_WORLD') {
      this.instances.setActiveInstance('NONE');
      this.city.setStoryProps({ samirRooftop: true, samirJunkyard: false, artemCorpse: true, egorMarum: false });
      this.engine.setAtmosphere(0x060a18, 0x090f24, 0.0036);
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
      this.say(
        'samir',
        'Весь Кибер-Алматы перед нами. Вызови Кибер-Ахмеда на [C], загляни в «Марум» к рипердоку, забери мой Malorian на Тастаке — и поднимись на смотровую крышу, когда будешь готов к штурму!',
        7.0,
      );
      this.setCheckpoint(act, -46, 0.25, -24, Math.PI);
      this.input.requestPointerLock();
      return;
    }

    if (act === 'TOWER_ASSAULT') {
      // Ensure Samir gives Malorian S-3516 for the assault & Smasher finisher!
      this.weapons.state.unlockWeapon('malorian', true);
      this.weapons.triggerSpin();
      this.instances.setActiveInstance('UNDERGROUND');
      this.instances.undergroundElevator.reset();
      this.chunks.forceRefresh(0, 0, false, this.physics);
      this.engine.setAtmosphere(0x0b0510, 0x160818, 0.01);
      const yLobby = INSTANCE_Y.UNDERGROUND + 24;
      this.player.teleport(0, yLobby, 13, 0, 0);
      this.player.setMode('FREE');
      this.weapons.setVisible(true);
      this.hud.setCrosshairVisible(true);
      this.hud.showActBanner('АКТ VII // ШТУРМ МАРАКУЛИН ТАУЭР', 5.0);
      this.hud.setObjective('ЗАЧИСТИТЕ ГЛАВНЫЙ ХОЛЛ И СПУСТИТЕСЬ НА ЛИФТЕ К «ХУЕШИ»');
      this.audio.setMusicIntensity('combat');
      this.say('samir', 'Пора развлечься как в 2026! Вали корпо-охрану и прорываемся вниз, к Хуеши!', 5.5);
      this.enemies.spawnWave([
        { id: 'ta_1', archetype: 'guard', zoneId: 'tower_lobby', x: -7, y: yLobby, z: -2 },
        { id: 'ta_2', archetype: 'guard', zoneId: 'tower_lobby', x: 7, y: yLobby, z: -2 },
        { id: 'ta_3', archetype: 'netrunner', zoneId: 'tower_lobby', x: -5, y: yLobby, z: -15 },
        { id: 'ta_4', archetype: 'heavy', zoneId: 'tower_lobby', x: 4, y: yLobby, z: -16 },
        { id: 'ta_5', archetype: 'drone', zoneId: 'tower_lobby', x: 0, y: yLobby, z: -10 },
      ]);
      this.setCheckpoint(act, 0, yLobby, 13, 0);
      this.input.requestPointerLock();
      return;
    }

    if (act === 'SMASHER_BOSS') {
      this.weapons.state.unlockWeapon('malorian', false);
      this.instances.setActiveInstance('UNDERGROUND');
      this.chunks.forceRefresh(0, 0, false, this.physics);
      this.engine.setAtmosphere(0x0d040c, 0x1c0612, 0.0085);
      const yCore = INSTANCE_Y.UNDERGROUND;
      this.player.teleport(0, yCore, -34, 0, 0);
      this.player.setMode('FREE');
      this.weapons.setVisible(true);
      this.hud.setCrosshairVisible(true);
      this.smasher.activateAt(0, yCore, -70);
      this.audio.playSmasherRoar();
      this.audio.setMusicIntensity('boss');
      this.hud.showActBanner('АКТ VIII // БОСС: РИХАРД СМЭШЕР', 5.0);
      this.hud.setObjective('ПОБЕДИТЕ РИХАРДА СМЭШЕРА И ДОБЕЙТЕ ЕГО ИЗ MALORIAN S-3516');
      this.say(
        'smasher',
        'Опять ты, кусок мяса?! Самир в твоей башке мне уже надоел — раздавлю вас обоих здесь, перед Хуеши!',
        5.5,
      );
      this.setCheckpoint(act, 0, yCore, -34, 0);
      this.input.requestPointerLock();
      return;
    }

    if (act === 'HUYESHI_CYBERSPACE') {
      this.instances.setActiveInstance('CYBERSPACE');
      this.chunks.forceRefresh(0, 0, false, this.physics);
      this.engine.setAtmosphere(0x030916, 0x06152c, 0.009);
      this.player.teleport(0, INSTANCE_Y.CYBERSPACE, 4, 0, 0);
      this.player.setMode('FREE');
      this.weapons.setVisible(false);
      this.hud.setCrosshairVisible(false);
      this.fx.cyberspace = 0.72;
      this.hud.showActBanner('АКТ IX // ХУЕШИ — КИБЕРПРОСТРАНСТВО', 5.0);
      this.hud.setObjective('ПОДОЙДИТЕ К ТАИСИИ ПО ЦИФРОВОМУ МОСТУ');
      this.audio.setMusicIntensity('cyberspace');
      this.say(
        'taisiya',
        'Добро пожаловать в Хуеши, Аи. Я разделила ваши сознания... Подойди ближе, нам нужно решить твою судьбу.',
        6.0,
      );
      this.setCheckpoint(act, 0, INSTANCE_Y.CYBERSPACE, 4, 0);
      this.input.requestPointerLock();
      return;
    }

    if (act === 'EPILOGUE_MARUM') {
      this.stats.endingId = 'marum';
      this.instances.setActiveInstance('NONE');
      this.city.setStoryProps({ samirRooftop: false, samirJunkyard: false, artemCorpse: false, egorMarum: true });
      this.engine.setAtmosphere(0x070c1a, 0x0b1428, 0.004);
      this.chunks.forceRefresh(-46, -40, true, this.physics);
      this.player.teleport(-46, 0.25, -45, Math.PI, 0);
      this.player.setMode('CINEMATIC');
      this.weapons.setVisible(false);
      this.hud.setCrosshairVisible(false);
      this.hud.showActBanner('ЭПИЛОГ I // ЛЕГЕНДА ЕБЛАНХАНЫ — АНТИКАФЕ «МАРУМ»', 5.5);
      this.hud.setObjective('ВЫСЛУШАЙТЕ ПРЕДЛОЖЕНИЕ ЕГОРА');
      this.audio.setMusicIntensity('marum_lounge');
      this.say(
        'system',
        'Спустя 2 месяца. Аи вернулся в своё тело и стал живой легендой Ебланханы — владельцем антикафе «Марум».',
        5.5,
      );
      return;
    }

    if (act === 'EPILOGUE_TALDYKORGAN') {
      this.stats.endingId = 'taldykorgan';
      this.instances.setActiveInstance('TALDYKORGAN');
      this.chunks.forceRefresh(0, 0, false, this.physics);
      this.engine.setAtmosphere(0x2a100c, 0x3b1810, 0.0055);
      this.player.teleport(0, INSTANCE_Y.TALDYKORGAN + 1.1, 8, 0, 0);
      this.player.setMode('CINEMATIC');
      this.weapons.setVisible(false);
      this.hud.setCrosshairVisible(false);
      this.hud.showActBanner('ЭПИЛОГ II // ДОРОГА В ГОРОД-АД ТАЛДЫКОРГАН', 5.5);
      this.hud.setObjective('ПРОЩАНИЕ С КИБЕР-АЛМАТЫ');
      this.audio.setMusicIntensity('taldykorgan');
      this.say(
        'samir',
        'Спасибо за второй шанс, брат... Аи, я не забуду тебя. Кибер-Алматы остаётся позади. Впереди — город-ад Талдыкорган.',
        7.5,
      );
    }
  }

  private spawnOpenWorldEncounters(): void {
    for (const gig of OPEN_WORLD_GIGS) {
      const rt = this.openWorld.gigs.get(gig.id);
      if (rt?.status === 'completed') continue;
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
      this.hud.setObjective('ПОДНИМИТЕСЬ НА СМОТРОВУЮ КРЫШУ КОК-ТОБЕ (ЮВ) ДЛЯ ШТУРМА МАРАКУЛИН ТАУЭР');
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
    if (
      !locked &&
      this.stateMachine.act !== 'TITLE' &&
      this.stateMachine.act !== 'CREDITS' &&
      this.modalOpen === 'NONE' &&
      !this.awaitingChoice &&
      this.player.mode !== 'CINEMATIC'
    ) {
      this.paused = true;
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
      this.input.exitPointerLock();
      this.hud.showScreen('PAUSE');
    }
  }

  private resumeGame(): void {
    this.paused = false;
    this.modalOpen = 'NONE';
    this.hud.showScreen('HUD');
    if (this.player.mode !== 'CINEMATIC' && !this.awaitingChoice) {
      this.input.requestPointerLock();
    }
  }

  private restartFromCheckpoint(): void {
    this.player.state.hp = this.player.state.maxHp;
    this.player.state.armor = this.player.state.maxArmor;
    this.enterAct(this.checkpoint.act);
  }

  private returnToTitle(): void {
    this.enterTitleScene();
  }

  private toggleMapModal(): void {
    if (this.stateMachine.act !== 'OPEN_WORLD') return;
    if (this.modalOpen === 'MAP') {
      this.closeModals();
      return;
    }
    this.modalOpen = 'MAP';
    this.paused = true;
    this.input.exitPointerLock();
    this.hud.renderFullMap(
      this.player.position,
      { x: this.vehicle.state.x, y: this.vehicle.state.y, z: this.vehicle.state.z },
      this.city.minimapBuildings,
      this.openWorld,
      this.activeObjectivePos,
    );
    this.hud.showScreen('MAP');
  }

  private openRipperdocModal(): void {
    this.modalOpen = 'RIPPERDOC';
    this.paused = true;
    this.input.exitPointerLock();
    this.hud.renderRipperdoc(this.player.state, this.weapons.state.unlocked);
    this.hud.showScreen('RIPPERDOC');
  }

  private closeModals(): void {
    this.modalOpen = 'NONE';
    this.paused = false;
    this.hud.showScreen('HUD');
    this.input.requestPointerLock();
  }

  private buyRipperdocItem(item: RipperdocItem): void {
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
    this.say('ripperdoc', `Отличный выбор, Аи! «${item.name}» откалиброван и готов к работе.`, 3.8);
  }

  private fastTravelToDistrict(districtId: DistrictId): void {
    const dist = DISTRICTS.find((d) => d.id === districtId);
    if (!dist) return;
    this.vehicle.state.occupied = false;
    this.vehicle.state.setPose(dist.fastTravelPos.x + 6, 0, dist.fastTravelPos.z, dist.fastTravelYaw);
    this.vehicle.syncMesh();
    this.player.teleport(dist.fastTravelPos.x, 0.25, dist.fastTravelPos.z, dist.fastTravelYaw, 0);
    this.player.setMode('FREE');
    this.weapons.setVisible(true);
    this.chunks.forceRefresh(dist.fastTravelPos.x, dist.fastTravelPos.z, true, this.physics);
    this.audio.playCarHornOrSummon();
    this.closeModals();
    this.say('akhmed', `Прибыли в район «${dist.name}», брат! Если понадоблюсь — зови на [C].`, 4.0);
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
    );
  }

  private handleChoiceSelection(choiceId: string): void {
    if (!this.awaitingChoice) return;
    this.awaitingChoice = false;
    this.hud.hideChoices();

    if (choiceId === 'ending_marum') {
      const next = this.stateMachine.selectFinaleEnding('marum');
      this.enterAct(next);
    } else if (choiceId === 'ending_taldykorgan') {
      const next = this.stateMachine.selectFinaleEnding('taldykorgan');
      this.enterAct(next);
    } else if (choiceId === 'egor_accept') {
      this.say('ai', 'Вечная война? Звучит достойно легенды Ебланханы. Я в деле, Егор.', 4.5);
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
    // Check Cyber-Akhmed boarding/exiting first in Open World!
    if (this.stateMachine.act === 'OPEN_WORLD') {
      if (this.vehicle.state.occupied) {
        this.vehicle.state.occupied = false;
        this.vehicle.state.stopAutopilot();
        const exit = this.vehicle.getExitPosition();
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
        this.say('akhmed', AKHMED_DRIVING_LINES[this.akhmedLineIdx++ % AKHMED_DRIVING_LINES.length], 4.2);
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
        this.say('samir', 'Вот мы и на крыше. Готов устроить штурм Маракулин Тауэр? Подойди ко мне и нажми [E].', 5.5);
        break;
      case 'rooftop_elevator_down':
        this.audio.playElevatorDing();
        this.player.teleport(148, 0.25, 152, Math.PI, 0);
        break;
      case 'rooftop_start_assault':
        this.audio.playHoloChime();
        this.say('ai', 'Решено, Самир. Идём в Маракулин Тауэр через парадный вход.', 3.2);
        this.enterAct('TOWER_ASSAULT');
        break;
      case 'gig_malorian_stash': {
        this.city.setInteractableEnabled('gig_malorian_stash', false);
        this.weapons.state.unlockWeapon('malorian', true);
        this.weapons.triggerSpin();
        this.audio.playPurchase();
        this.completeGig('gig_malorian');
        this.say('samir', 'Мой Malorian S-3516! Чёрт возьми, как же приятно снова видеть его в деле. Береги пушку, Аи.', 5.5);
        break;
      }
      case 'gig_tastak_terminal': {
        this.city.setInteractableEnabled('gig_tastak_terminal', false);
        this.audio.playTerminalHack();
        this.completeGig('gig_tastak_hack');
        break;
      }
      case 'heist_steal_biochip': {
        this.instances.setInteractableEnabled('heist_steal_biochip', false);
        this.instances.biochipCase.visible = false;
        this.audio.playTerminalHack();
        this.instances.setInteractableEnabled('heist_hide_closet', true);
        this.hud.setObjective('РОДИОН ЗАХОДИТ! СПРЯЧЬТЕСЬ В ШКАФ [E]');
        this.say('sanzhar', 'Твою мать, Родион вернулся раньше! Быстро в шкаф слева, Аи!', 4.5);
        this.stateMachine.subStep = 1;
        break;
      }
      case 'heist_hide_closet': {
        this.instances.setInteractableEnabled('heist_hide_closet', false);
        this.player.teleport(-9.8, INSTANCE_Y.PENTHOUSE, 7, -Math.PI * 0.42, 0);
        this.player.setMode('CLOSET');
        this.weapons.setVisible(false);
        this.instances.penthouseRodion.group.visible = true;
        this.instances.penthouseLev.group.visible = true;
        this.instances.penthouseSmasherProp.visible = true;
        this.stateMachine.subStep = 2;
        this.stateMachine.actTimer = 0;
        this.hud.setObjective('НАБЛЮДАЙТЕ ИЗ ШКАФА');
        this.say('lev', 'Родион, ты позоришь империю Маракулиных! Я отстраняю тебя от совета директоров!', 4.2);
        break;
      }
      case 'heist_elevator_btn': {
        this.instances.setInteractableEnabled('heist_elevator_btn', false);
        this.audio.playElevatorDing();
        this.instances.penthouseElevator.state.startRide();
        this.hud.setObjective('СПУСК В ГАРАЖ К ТАКСИ «КИБЕР-АХМЕД»');
        break;
      }
      case 'motel_sink': {
        this.city.setInteractableEnabled('motel_sink', false);
        this.stateMachine.subStep = 1;
        this.stateMachine.actTimer = 0;
        this.fx.damageVignette = 0.7;
        this.player.addScreenShake(0.22);
        this.weapons.state.equip('mantis_blades');
        this.audio.playMantisSlash(true);
        this.hud.setObjective('ТЕЛОХРАНИТЕЛЬ ДУШИТ ВАС! РАЗРУБИТЕ ЕГО И АРТЁМА КЛИНКАМИ БОГОМОЛА!');
        this.say(
          'system',
          'Телохранитель Артёма схватил вас за горло! Выпустите Клинки Богомола (ЛКМ / ПКМ) и пробейтесь к Артёму!',
          5.2,
        );
        this.enemies.spawnWave([
          { id: 'motel_bg', archetype: 'bodyguard', zoneId: 'motel', x: -167, y: 0.25, z: -168, hp: 110 },
          { id: 'motel_artem', archetype: 'artem', zoneId: 'motel', x: -161, y: 0.25, z: -161, hp: 135 },
        ]);
        this.audio.setMusicIntensity('combat');
        break;
      }
      case 'tower_elevator_down': {
        this.instances.setInteractableEnabled('tower_elevator_down', false);
        this.audio.playElevatorDing();
        this.instances.undergroundElevator.state.startRide();
        this.hud.setObjective('СПУСК К ЯДРУ «ХУЕШИ»...');
        break;
      }
      case 'smasher_execute': {
        this.instances.setInteractableEnabled('smasher_execute', false);
        this.weapons.state.unlockWeapon('malorian', true);
        this.weapons.triggerShotVisual();
        this.audio.playMalorianShot();
        this.audio.playExplosion(true);
        this.player.addScreenShake(0.32);
        this.smasher.finishExecutionAnimation();
        this.hud.setBossBar(false);
        this.instances.setInteractableEnabled('huyeshi_jack_in', true);
        this.hud.setObjective('ПОДКЛЮЧИТЕСЬ К АППАРАТУ «ХУЕШИ» [E]');
        this.audio.setMusicIntensity('almaty_night');
        this.say(
          'samir',
          'Это тебе за 2026 год, консервная банка! Рихард Смэшер мёртв. Пошли к Хуеши, Аи — время разделить наши мозги.',
          6.0,
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
    this.player.state.addTenge(def.rewardTenge);
    this.player.state.streetCred += def.rewardCred;
    this.stats.gigsCompleted++;
    this.stats.tengeEarned += def.rewardTenge;
    this.hud.showActBanner(`ЗАКАЗ ВЫПОЛНЕН: ${def.title} (+${def.rewardTenge} ₸)`, 4.2);
    this.audio.playPurchase();
    this.updateOpenWorldObjective();
  }

  private handleCombatInput(input: InputSnapshot): void {
    if (this.player.mode === 'CINEMATIC' || this.player.mode === 'CLOSET' || this.vehicle.state.occupied) {
      return;
    }

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

    // Mantis Blade Leap Attack on Right Click!
    if (input.aimPressed && this.weapons.state.activeWeapon === 'mantis_blades') {
      if (this.weapons.state.tryMantisLunge()) {
        const eye = this.player.getEyePosition();
        const fwd = this.player.getForwardDirection();
        const target = this.enemies.findNearestEnemyInCone(eye, fwd, 9.5);
        const lungeDir = target ? target.sub(this.player.position).normalize() : fwd;
        this.player.applyLungeImpulse(lungeDir, 22);
        this.weapons.triggerMantisSlashVisual(2);
        this.audio.playMantisSlash(true);
        const dmg = this.player.state.upgrades.mantisOverclock ? 135 : 98;
        this.resolveMeleeDamage(eye, fwd, 5.2, dmg);
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
      } else {
        this.weapons.triggerMantisSlashVisual(2);
        this.audio.playMantisSlash(false);
        this.resolveMeleeDamage(eye, fwd, 4.2, 68);
      }
    }

    // Primary attack (LMB)
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

    // Firearm shot(s)
    this.weapons.triggerShotVisual();
    this.player.addRecoilKick(spec.recoilPitch * (1 - this.player.getAimBlend() * 0.45), (Math.random() - 0.5) * 0.01);
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

      // Check Smasher boss first if active
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
    const hits = this.enemies.applyMeleeArc(eye, fwd, range, damage);
    for (const h of hits) {
      this.hud.triggerHitmarker(false);
      this.audio.playHitMarker(false);
      if (h.killed) {
        this.handleEnemyKilled(h.zoneId, h.rewardTenge, true);
      }
    }

    if (this.stateMachine.act === 'SMASHER_BOSS') {
      const bHit = this.smasher.applyMeleeDamage(eye, range, damage);
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
      this.say('smasher', 'САНДЕВИСТАН АКТИВИРОВАН! ПОПРОБУЙ ПОПАСТЬ, ЩЕНОК!', 4.5);
    }
    if (p3) {
      this.audio.playSmasherRoar();
      this.say('samir', 'У него перегрев брони! Дожимай Смэшера, Аи!', 4.2);
    }
    if (staggered) {
      this.audio.playExplosion(true);
      const pos = this.smasher.getPosition();
      this.instances.updateInteractablePos('smasher_execute', pos.x, pos.y + 1.2, pos.z);
      this.instances.setInteractableEnabled('smasher_execute', true);
      this.hud.setObjective('ПОДОЙДИТЕ К СМЭШЕРУ И ДОБЕЙТЕ ЕГО ИЗ MALORIAN S-3516 [E]');
      this.say('samir', 'ОН НА КОЛЕНЯХ! Доставай мой Malorian и покончи с Рихардом Смэшером [E]!', 6.0);
    }
  }

  private handleEnemyKilled(zoneId: string | null, rewardTenge: number, melee: boolean): void {
    this.stats.enemiesEliminated++;
    if (melee) this.stats.meleeKills++;
    if (rewardTenge > 0) {
      this.player.state.addTenge(rewardTenge);
      this.stats.tengeEarned += rewardTenge;
    }

    // Check Open World combat gigs
    if (zoneId && (zoneId === 'gig_junkyard' || zoneId === 'gig_convoy' || zoneId === 'gig_cyberpsycho')) {
      if (this.enemies.getAliveCount(zoneId) === 0) {
        this.completeGig(zoneId);
      }
    }

    // Check Act 3 Chase drones
    if (this.stateMachine.act === 'FLASHBACK_CHASE' && zoneId === 'chase') {
      this.chaseDronesRemaining = this.enemies.getAliveCount('chase');
      if (this.chaseDronesRemaining > 0) {
        this.hud.setObjective(`ОТСТРЕЛИВАЙТЕСЬ ОТ КОРПО-ДРОНОВ (ОСТАЛОСЬ: ${this.chaseDronesRemaining})`);
      }
    }
  }

  private handlePlayerDamaged(amount: number, shake = 0.1): void {
    const allowLethal = this.stateMachine.act !== 'TASTAK_BETRAYAL';
    const res = this.player.state.takeDamage(amount, allowLethal);
    if (res.applied > 0) {
      this.fx.damageVignette = Math.min(1, this.fx.damageVignette + 0.55);
      this.player.addScreenShake(shake);
      this.audio.playPlayerHurt(amount >= 18);
    }
    if (res.died) {
      this.stats.deaths++;
      this.hud.showActBanner('КРИТИЧЕСКИЙ СБОЙ // ОТКАТ К ЧЕКПОИНТУ', 3.0);
      this.restartFromCheckpoint();
    }
  }

  private updateActLogic(dt: number, worldDt: number, input: InputSnapshot): void {
    const act = this.stateMachine.act;
    this.stateMachine.actTimer += dt;

    // 1. PROLOGUE ROOFTOP
    if (act === 'PROLOGUE_ROOFTOP') {
      this.player.setExternalCamera(
        { x: 168.5, y: 37.8, z: 168.5 },
        { x: 163.0, y: 37.3, z: 163.0 },
        70,
      );
      if (this.stateMachine.actTimer > 7.8) {
        this.fx.blackout = Math.min(1, (this.stateMachine.actTimer - 7.8) / 1.4);
      }
      if (this.stateMachine.actTimer > 9.3) {
        this.enterAct('FLASHBACK_HEIST');
      }
      return;
    }

    // 2. FLASHBACK HEIST (PENTHOUSE)
    if (act === 'FLASHBACK_HEIST') {
      if (this.stateMachine.subStep === 2) {
        // Watching Rodion strangle Lev Marakulin from inside the closet
        if (this.stateMachine.actTimer > 2.2 && this.stateMachine.actTimer < 6.0) {
          this.instances.penthouseRodion.group.position.x = THREE.MathUtils.lerp(0.8, -0.1, Math.min(1, (this.stateMachine.actTimer - 2.2) / 1.4));
          this.instances.penthouseRodion.rightArm.rotation.x = -1.4;
          this.instances.penthouseRodion.leftArm.rotation.x = -1.4;
        }
        if (this.stateMachine.actTimer > 4.2 && this.stateMachine.actTimer < 4.35) {
          this.say('rodion', 'Теперь вся мегакорпорация Маракулин принадлежит мне, отец. Рихард, перекрой башню!', 4.2);
          this.instances.penthouseLev.group.rotation.x = -Math.PI / 2;
          this.instances.penthouseLev.group.position.y = INSTANCE_Y.PENTHOUSE + 0.25;
        }
        if (this.stateMachine.actTimer > 8.2) {
          this.instances.penthouseRodion.group.visible = false;
          this.instances.penthouseSmasherProp.visible = false;
          this.player.teleport(-7.5, INSTANCE_Y.PENTHOUSE, 7, 0, 0);
          this.player.setMode('FREE');
          this.weapons.setVisible(true);
          this.stateMachine.subStep = 3;
          this.audio.setMusicIntensity('combat');
          this.hud.setObjective('ПРОРВИТЕСЬ С БОЕМ К ЛИФТУ В ГАРАЖ КИБЕР-АХМЕДА');
          this.say('sanzhar', 'Он реально задушил собственного отца! Охуев от этого дерьма, валим к лифту!', 5.0);
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
        this.say('sanzhar', 'Путь к лифту чист! Жми кнопку [E] — Кибер-Ахмед уже ждёт внизу!', 4.5);
      }

      const elevRes = this.instances.penthouseElevator.update(worldDt);
      if (this.instances.penthouseElevator.state.isRideActive()) {
        this.player.syncElevatorY(this.instances.penthouseElevator.state.currentY);
      }
      if (elevRes.arrived) {
        this.enterAct('FLASHBACK_CHASE');
      }
      return;
    }

    // 3. FLASHBACK CHASE (CYBER-AKHMED TAXI)
    if (act === 'FLASHBACK_CHASE') {
      this.fx.speedLines = 0.55;
      if (this.chaseWaveSpawned && this.enemies.getAliveCount('chase') === 0 && this.stateMachine.subStep === 0) {
        this.stateMachine.subStep = 1;
        this.stateMachine.actTimer = 0;
        this.audio.setMusicIntensity('almaty_night');
        this.hud.setObjective('ВЫ ОТОРВАЛИСЬ ОТ ПОГОНИ...');
        this.say('ai', 'ДААА! Мы сделали это, Санжар! Оторвались от корпов! Санжар?.. Эй, ты чего молчишь?!', 4.6);
      } else if (this.stateMachine.subStep === 1 && this.stateMachine.actTimer > 4.8) {
        this.stateMachine.subStep = 2;
        this.stateMachine.actTimer = 0;
        this.say(
          'sanzhar',
          'Меня... зацепило в лифте, брат. Держи биочип... не отдавай его Артёму, забери и продай... Я вставлю его тебе в слот...',
          6.2,
        );
        this.fx.relicGlitch = 0.6;
        this.audio.playRelicGlitch();
      } else if (this.stateMachine.subStep === 2 && this.stateMachine.actTimer > 6.5) {
        this.fx.blackout = Math.min(1, (this.stateMachine.actTimer - 6.5) / 1.5);
        if (this.stateMachine.actTimer > 8.1) {
          this.enterAct('TASTAK_BETRAYAL');
        }
      }
      return;
    }

    // 4. TASTAK BETRAYAL (ARTEM'S MOTEL)
    if (act === 'TASTAK_BETRAYAL') {
      if (this.stateMachine.subStep === 1 && this.enemies.getAliveCount('motel') === 0) {
        this.stateMachine.subStep = 2;
        this.stateMachine.actTimer = 0;
        this.audio.playMalorianShot();
        this.audio.playPlayerHurt(true);
        this.player.addScreenShake(0.45);
        this.fx.damageVignette = 1.0;
        this.player.setMode('CINEMATIC');
        this.say('artem', 'Ты думал, выйдешь отсюда живым?! Перед смертью я заберу тебя с собой, Аи! *ВЫСТРЕЛ В ГОЛОВУ*', 4.5);
      } else if (this.stateMachine.subStep === 2) {
        this.fx.blackout = Math.min(1, this.stateMachine.actTimer / 2.2);
        if (this.stateMachine.actTimer > 3.6) {
          this.enterAct('JUNKYARD_AWAKENING');
        }
      }
      return;
    }

    // 5. JUNKYARD AWAKENING & SAMIR'S ICONIC LINE
    if (act === 'JUNKYARD_AWAKENING') {
      this.fx.eyelids = Math.max(0, 0.95 - this.stateMachine.actTimer * 0.25);
      this.fx.relicGlitch = Math.max(0.12, 0.7 - this.stateMachine.actTimer * 0.1);
      this.player.setExternalCamera(
        { x: -165, y: 1.2 + Math.min(0.5, this.stateMachine.actTimer * 0.15), z: 165 },
        { x: -163.8, y: 1.45, z: 161.4 },
        72,
      );
      if (this.stateMachine.subStep === 0 && this.stateMachine.actTimer > 2.2) {
        this.stateMachine.subStep = 1;
        this.audio.playRelicGlitch();
        this.say('samir', 'Вставай ебанат блять, у нас Кибер-Алматы на сожжение.', 5.8);
      }
      if (this.stateMachine.actTimer > 8.4) {
        this.enterAct('OPEN_WORLD');
      }
      return;
    }

    // 6. OPEN WORLD CYBER-ALMATY (500x500m + CHUNKS + CYBER-AKHMED)
    if (act === 'OPEN_WORLD') {
      // Summon Cyber-Akhmed with [C]
      if (input.summonCarPressed && !this.vehicle.state.occupied && this.player.position.y < 5) {
        this.vehicle.summonNear(this.player.position.x, this.player.position.z, this.player.yaw);
        this.audio.playCarHornOrSummon();
        this.say('akhmed', 'Кибер-Ахмед подан прямо к бордюру! Садись на [E].', 3.4);
      }

      // Autopilot toggle [G] while driving
      if (input.autopilotPressed && this.vehicle.state.occupied && this.activeObjectivePos) {
        if (this.vehicle.state.autopilotActive) {
          this.vehicle.state.stopAutopilot();
        } else {
          this.vehicle.state.startAutopilot(this.activeObjectivePos);
          this.say('akhmed', 'Автопилот включён! Едем к активной цели, можешь отдохнуть.', 3.6);
        }
      }

      if (this.vehicle.state.occupied) {
        const vRes = this.vehicle.update(dt, input, this.physics);
        this.stats.distanceDrivenMeters += vRes.movedMeters;
        if (vRes.nitroActive) {
          this.fx.speedLines = Math.min(0.85, this.fx.speedLines + dt * 2.5);
        }
        if (vRes.arrivedAutopilot) {
          this.audio.playCarHornOrSummon();
          this.say('akhmed', 'Мы на месте, брат! Выходи на [E].', 3.4);
        }
        this.player.position.set(this.vehicle.state.x, this.vehicle.state.y, this.vehicle.state.z);
        this.player.yaw = this.vehicle.state.yaw;
        const rig = this.vehicle.getCameraRig();
        this.player.setExternalCamera(rig.pos, rig.lookAt, rig.fov);
      }

      // District discovery & Samir commentary
      const district = getDistrictAt(this.player.position.x, this.player.position.z);
      if (district.id !== this.lastDistrictId) {
        this.lastDistrictId = district.id;
        this.hud.setDistrict(district.name, district.subtitle);
        if (this.openWorld.markDistrictVisited(district.id)) {
          const lines = DISTRICT_SAMIR_BANTER[district.id];
          this.say('samir', lines[0], 5.0);
        }
        // Subtle music shift inside Marum Anti-cafe
        const nearMarum = Math.hypot(this.player.position.x - -46, this.player.position.z - -40) < 16;
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
        this.say('samir', 'Холл чист! Жми кнопку лифта [E] — Хуеши и последняя преграда ждут внизу.', 4.8);
      }
      const elevRes = this.instances.undergroundElevator.update(worldDt);
      if (this.instances.undergroundElevator.state.isRideActive()) {
        this.player.syncElevatorY(this.instances.undergroundElevator.state.currentY);
      }
      if (elevRes.arrived) {
        this.enterAct('SMASHER_BOSS');
      }
      return;
    }

    // 8. SMASHER BOSS
    if (act === 'SMASHER_BOSS') {
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
      return;
    }

    // 9. HUYESHI CYBERSPACE & TAISIYA CHOICE
    if (act === 'HUYESHI_CYBERSPACE') {
      this.fx.cyberspace = 0.72;
      if (this.stateMachine.subStep === 0 && this.player.position.z < -18) {
        this.stateMachine.subStep = 1;
        this.awaitingChoice = true;
        this.input.exitPointerLock();
        this.say(
          'taisiya',
          'Я разделила ваши сознания, Аи. Но твоё тело повреждено биочипом — если вернёшься сам, проживёшь лишь полгода. Если отдашь тело Самиру, он проживёт полноценную жизнь. Решай.',
          9.0,
        );
        this.hud.showChoices('ВЫБОР В ХУЕШИ — РЕШЕНИЕ ТАИСИИ', [
          {
            id: 'ending_marum',
            key: '1',
            text: 'Вернуться в своё тело (прожить полгода легендой Ебланханы)',
            subtext: 'Аи становится владельцем антикафе «Марум» и встречает Егора.',
          },
          {
            id: 'ending_taldykorgan',
            key: '2',
            text: 'Отдать тело Самиру (дать ему полноценную жизнь)',
            subtext: 'Самир в теле Аи прощается с Кибер-Алматы и уезжает в Талдыкорган.',
          },
        ]);
      }
      return;
    }

    // 10A. EPILOGUE MARUM + EGOR
    if (act === 'EPILOGUE_MARUM') {
      this.player.setExternalCamera({ x: -46, y: 1.8, z: -44.5 }, { x: -46, y: 1.5, z: -38.5 }, 68);
      if (this.stateMachine.subStep === 0 && this.stateMachine.actTimer > 5.6) {
        this.stateMachine.subStep = 1;
        this.stateMachine.actTimer = 0;
        this.say(
          'egor',
          'Поздравляю с новым «Марумом», легенда Ебланханы. Меня зовут Егор. У меня есть для тебя последний, самый громкий контракт — на Вечную войну. Согласен?',
          6.5,
        );
      } else if (this.stateMachine.subStep === 1 && this.stateMachine.actTimer > 6.2) {
        this.stateMachine.subStep = 2;
        this.awaitingChoice = true;
        this.input.exitPointerLock();
        this.hud.showChoices('КОНТРАКТ ЕГОРА', [
          {
            id: 'egor_accept',
            key: '1',
            text: 'Принять контракт на Вечную войну',
            subtext: 'Завершить историю Аи как легенды Ебланханы.',
          },
        ]);
      } else if (this.stateMachine.subStep === 3 && this.stateMachine.actTimer > 4.6) {
        this.stateMachine.transition('CREDITS');
        this.input.exitPointerLock();
        this.hud.showCredits(this.stats);
      }
      return;
    }

    // 10B. EPILOGUE TALDYKORGAN
    if (act === 'EPILOGUE_TALDYKORGAN') {
      this.player.setExternalCamera(
        { x: Math.sin(this.elapsedTotal * 0.4) * 0.4, y: INSTANCE_Y.TALDYKORGAN + 1.6, z: 8 },
        { x: 0, y: INSTANCE_Y.TALDYKORGAN + 2.5, z: -40 },
        74,
      );
      if (this.stateMachine.actTimer > 8.0) {
        this.stateMachine.transition('CREDITS');
        this.input.exitPointerLock();
        this.hud.showCredits(this.stats);
      }
    }
  }

  update(rawDt: number): void {
    const dt = Math.min(rawDt, 0.05);
    this.elapsedTotal += dt;

    // Title screen slow cinematic flyover of 500x500m Cyber-Almaty!
    if (this.stateMachine.act === 'TITLE') {
      const a = this.elapsedTotal * 0.14;
      this.player.setExternalCamera(
        { x: Math.cos(a) * 115, y: 58, z: Math.sin(a) * 115 },
        { x: 40, y: 24, z: -40 },
        72,
      );
      this.city.update(this.elapsedTotal);
      this.engine.render(dt, this.fx);
      return;
    }

    if (this.stateMachine.act === 'CREDITS' || this.paused) {
      this.engine.render(dt, this.fx);
      return;
    }

    this.stats.elapsedSec += dt;
    const input = this.input.consumeSnapshot();

    // Keyboard choice shortcuts [1]/[2]
    if (this.awaitingChoice && input.choiceKey) {
      if (this.stateMachine.act === 'HUYESHI_CYBERSPACE') {
        this.handleChoiceSelection(input.choiceKey === '1' ? 'ending_marum' : 'ending_taldykorgan');
      } else if (this.stateMachine.act === 'EPILOGUE_MARUM' && input.choiceKey === '1') {
        this.handleChoiceSelection('egor_accept');
      }
    }

    // Cyberware abilities
    if (input.sandevistanPressed && this.player.mode === 'FREE') {
      const tRes = this.player.state.toggleSandevistan();
      if (tRes.changed) this.audio.playSandevistan(tRes.active);
    }
    if (input.healPressed && this.player.state.useMaxDoc()) {
      this.audio.playMaxDoc();
    }

    const timerRes = this.player.state.updateTimers(dt);
    if (timerRes.sandevistanEnded) {
      this.audio.playSandevistan(false);
    }

    const worldDt = dt * this.player.state.getWorldTimeScale();

    // Player movement & chunk streaming
    const moveRes = this.player.update(dt, input, this.physics, !this.vehicle.state.occupied);
    if (moveRes.dashed || moveRes.doubleJumped) {
      this.audio.playDash();
    }

    const inOpenWorld = this.stateMachine.isOpenWorldLike();
    this.chunks.update(this.player.position.x, this.player.position.z, inOpenWorld, this.physics);

    // Interactions
    const nearest = this.findNearestInteractable();
    let promptLabel: string | null = nearest?.label ?? null;
    if (
      !promptLabel &&
      this.stateMachine.act === 'OPEN_WORLD' &&
      !this.vehicle.state.occupied &&
      this.vehicle.isPlayerNear(this.player.position.x, this.player.position.y, this.player.position.z)
    ) {
      promptLabel = '[E] СЕСТЬ В ТАКСИ «КИБЕР-АХМЕД»';
    }
    this.hud.setInteractPrompt(promptLabel);
    if (input.interactPressed) {
      this.handleInteract(nearest);
    }

    // Combat & weapons
    this.handleCombatInput(input);
    this.weapons.update(dt, moveRes.isMoving, this.player.getAimBlend());

    // Enemies AI
    this.enemies.update(worldDt, this.player.position, this.player.getEyePosition(), this.physics, {
      onEnemyShot: (heavy) => this.audio.playEnemyShot(heavy),
      onPlayerHit: (dmg) => this.handlePlayerDamaged(dmg, 0.1),
    });

    // Story & world tick
    this.updateActLogic(dt, worldDt, input);
    this.city.update(this.elapsedTotal);
    this.instances.update(worldDt, this.elapsedTotal);

    // Post-FX decay
    this.fx.damageVignette = Math.max(0, this.fx.damageVignette - dt * 1.4);
    this.fx.relicGlitch = Math.max(0, this.fx.relicGlitch - dt * 0.45);
    this.fx.speedLines = Math.max(0, this.fx.speedLines - dt * 1.8);
    const targetSandy = this.player.state.sandevistanActive ? 1 : 0;
    this.fx.sandevistan += (targetSandy - this.fx.sandevistan) * Math.min(1, dt * 8);

    // HUD updates
    this.hud.update(dt);
    this.hud.updateVitals(this.player.state, this.weapons.state);
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
    this.textures.dispose();
    this.audio.dispose();
  }
}

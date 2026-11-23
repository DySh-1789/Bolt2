import type { MusicIntensity } from '../types/game';

/**
 * Supports all Bolt 2 adaptive Cyber-Almaty music states plus Bolt 1 legacy states
 * ('ambient', 'operating', 'soulkiller') without requiring callers to widen MusicIntensity.
 */
export type ExtendedMusicMode =
  | MusicIntensity
  | 'ambient'
  | 'operating'
  | 'soulkiller';

/**
 * Procedural Web Audio synthesizer fusing Bolt 1's 124 BPM Rebel Path dark synthwave
 * sequencer and cinematic SFX with Bolt 2's Cyber-Almaty weapon arsenal, vehicle audio,
 * Relic biochip glitches, and 10+ adaptive music states.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  private masterVolume = 0.68;
  private intensity: ExtendedMusicMode = 'silent';
  private stepTimer: number | null = null;
  private stepIndex = 0;
  private sandevistanPitchScale = 1.0;
  private paused = false;

  // Bolt 1 D minor cyberpunk basslines & arpeggio (Hz)
  private readonly bassPatternCombat = [
    73.42, 73.42, 87.31, 73.42, 65.41, 73.42, 110.0, 98.0,
    73.42, 73.42, 87.31, 73.42, 116.54, 110.0, 98.0, 87.31,
  ];
  private readonly bassPatternBoss = [
    55.0, 55.0, 65.41, 55.0, 73.42, 55.0, 82.41, 77.78,
    55.0, 55.0, 65.41, 55.0, 98.0, 87.31, 82.41, 65.41,
  ];
  private readonly leadArp = [
    293.66, 0, 349.23, 440.0, 0, 392.0, 349.23, 329.63,
    293.66, 0, 440.0, 523.25, 0, 466.16, 440.0, 349.23,
  ];

  // Bolt 2 Cyber-Almaty highway chase & district patterns (Hz)
  private readonly bassPatternChase = [
    73.42, 73.42, 98.0, 73.42, 110.0, 73.42, 116.54, 110.0,
    65.41, 65.41, 87.31, 65.41, 98.0, 87.31, 82.41, 73.42,
  ];
  private readonly chaseLead = [
    587.33, 0, 523.25, 440.0, 0, 523.25, 587.33, 0,
    659.25, 0, 587.33, 523.25, 440.0, 0, 392.0, 440.0,
  ];
  private readonly loungeChords = [110.0, 130.81, 164.81, 146.83];
  private readonly cyberspaceScale = [130.81, 164.81, 196.0, 246.94, 293.66, 392.0];
  private readonly steppeNotes = [146.83, 164.81, 174.61, 220.0, 196.0, 164.81, 146.83, 130.81];

  unlock(): void {
    this.paused = false;
    if (typeof window === 'undefined') return;
    if (this.ctx) {
      if (this.ctx.state === 'suspended') {
        void this.ctx.resume();
      }
      this.startSequencer();
      return;
    }

    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    this.ctx = ctx;

    const master = ctx.createGain();
    master.gain.value = this.masterVolume;
    master.connect(ctx.destination);
    this.masterGain = master;

    const music = ctx.createGain();
    music.gain.value = 0.36;
    music.connect(master);
    this.musicGain = music;

    const sfx = ctx.createGain();
    sfx.gain.value = 0.85;
    sfx.connect(master);
    this.sfxGain = sfx;

    this.noiseBuffer = this.createNoiseBuffer(ctx, 1.5);
    this.startSequencer();
  }

  /** Bolt 2 compatibility alias for unlock(). */
  ensureStarted(): void {
    this.unlock();
  }

  private ensureSfxReady(): boolean {
    if (this.paused) return false;
    if (!this.ctx) {
      this.unlock();
    } else if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return Boolean(this.ctx && this.sfxGain);
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (!this.ctx) return;
    if (paused && this.ctx.state === 'running') {
      void this.ctx.suspend();
    } else if (!paused && this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
  }

  private createNoiseBuffer(ctx: AudioContext, durationSec: number): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * durationSec);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  setVolume(value: number): void {
    this.masterVolume = Math.max(0, Math.min(1, value));
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.masterVolume, this.ctx.currentTime, 0.04);
    }
  }

  /** Bolt 2 compatibility alias for setVolume(). */
  setMasterVolume(vol: number): void {
    this.setVolume(vol);
  }

  setSandevistanMode(active: boolean): void {
    this.sandevistanPitchScale = active ? 0.68 : 1.0;
  }

  setMusicIntensity(mode: ExtendedMusicMode): void {
    this.intensity = mode;
  }

  private startSequencer(): void {
    if (this.stepTimer !== null || typeof window === 'undefined') return;
    // 16th-note pulse (~124 BPM -> ~122ms)
    this.stepTimer = window.setInterval(() => {
      this.tickMusic();
    }, 122);
  }

  private tickMusic(): void {
    if (this.paused || !this.ctx || !this.musicGain || this.ctx.state !== 'running') return;
    if (this.intensity === 'silent') return;

    const now = this.ctx.currentTime;
    const step = this.stepIndex % 16;
    const bar = (this.stepIndex >> 4) % 4;
    this.stepIndex++;

    if (this.intensity === 'operating') {
      // Sparse sterile heartbeat & eerie dark drone (Bolt 1)
      if (step === 0 || step === 8) {
        this.playEcgBeep(step === 0 ? 880 : 840, 0.14, true);
      }
      if (step === 0) {
        this.playDrone(55, 1.8, 0.14);
      }
      return;
    }

    if (this.intensity === 'soulkiller') {
      // Escalating dissonant harmonic swarm (Bolt 1)
      if (step % 2 === 0) {
        const freq = 110 + ((this.stepIndex * 19) % 240);
        this.playSynthNote(freq, 'sawtooth', 0.22, 0.14, 1400);
      }
      if (step % 4 === 0) {
        this.playKick(now, 0.35);
      }
      return;
    }

    const pitch = this.sandevistanPitchScale;

    if (this.intensity === 'title' || this.intensity === 'ambient') {
      // Bolt 1 brooding dark synthwave intro
      const bassFreq = this.bassPatternCombat[step] * pitch;
      if (step % 2 === 0) {
        this.playSynthNote(bassFreq, 'sawtooth', 0.22, 0.16, 420);
      }
      if (step === 0) {
        this.playDrone(73.42 * pitch, 1.9, 0.13);
      }
      return;
    }

    if (this.intensity === 'almaty_night') {
      // Nocturnal Cyber-Almaty neon streets: half-time Rebel Path bass, moody pad & sparse pulse
      const bassFreq = this.bassPatternCombat[step] * pitch;
      if (step % 2 === 0) {
        this.playSynthNote(bassFreq, 'sawtooth', 0.21, 0.15, 480);
      }
      if (step === 0) {
        this.playDrone((bar % 2 === 0 ? 73.42 : 65.41) * pitch, 1.85, 0.12);
        this.playKick(now, 0.24);
      }
      if (step === 10 && bar % 2 === 1) {
        this.playKick(now, 0.18);
      }
      if (step === 4 || step === 12) {
        const chime = (step === 4 ? 293.66 : 349.23) * pitch;
        this.playSynthNote(chime, 'triangle', 0.28, 0.06, 1300);
      }
      if (step % 4 === 2) {
        this.playHat(now, 0.03);
      }
      return;
    }

    if (this.intensity === 'marum_lounge') {
      // Warm neon anticafe «Марум» chillout synth-lounge
      const root = this.loungeChords[bar % this.loungeChords.length] * pitch;
      if (step === 0) {
        this.playDrone(root, 1.8, 0.11);
        this.playSynthNote(root * 1.5, 'triangle', 0.55, 0.07, 920);
      }
      if (step === 4 || step === 12) {
        this.playSynthNote(root * 2, 'sine', 0.32, 0.055, 1600);
      }
      if (step === 8) {
        this.playSynthNote(root * 1.2, 'triangle', 0.4, 0.06, 850);
      }
      if (step === 6 || step === 14) {
        this.playHat(now, 0.025);
      }
      return;
    }

    if (this.intensity === 'cyberspace') {
      // Blackwall / Huyeshi ethereal digital matrix soundscape
      const idx = (bar * 2 + Math.floor(step / 4)) % this.cyberspaceScale.length;
      const root = this.cyberspaceScale[idx] * pitch;
      if (step === 0) {
        this.playDrone(root * 0.5, 1.9, 0.14);
      }
      if (step % 4 === 0) {
        this.playSynthNote(root, 'sine', 0.42, 0.1, 1400);
      }
      if (step % 3 === 0) {
        const shimmer = this.cyberspaceScale[(this.stepIndex + step) % this.cyberspaceScale.length] * 2 * pitch;
        this.playSynthNote(shimmer, 'triangle', 0.18, 0.055, 2600);
      }
      return;
    }

    if (this.intensity === 'taldykorgan') {
      // Sun-scorched Kazakh steppe horizon epilogue
      const note = this.steppeNotes[(bar * 2 + Math.floor(step / 8)) % this.steppeNotes.length] * pitch;
      if (step === 0) {
        this.playDrone(73.42 * pitch, 1.95, 0.12);
        this.playSynthNote(note, 'triangle', 0.45, 0.11, 780);
      }
      if (step === 6 || step === 12) {
        this.playSynthNote(note * 2, 'sine', 0.36, 0.055, 1100);
      }
      return;
    }

    if (this.intensity === 'chase') {
      // High-octane night highway pursuit
      const bassFreq = this.bassPatternChase[step] * pitch;
      this.playSynthNote(bassFreq, 'sawtooth', 0.12, 0.25, 1050);
      if (step % 4 === 0 || step === 14) {
        this.playKick(now, 0.44);
      }
      if (step % 8 === 4) {
        this.playSnare(now, 0.26);
      }
      if (step % 2 === 1) {
        this.playHat(now, 0.07);
      }
      const lead = this.chaseLead[step];
      if (lead > 0) {
        this.playSynthNote(lead * pitch, 'square', 0.1, 0.085, 2200);
      }
      return;
    }

    // Combat & Boss (100% authentic Bolt 1 Rebel Path industrial synthwave)
    const isBoss = this.intensity === 'boss';
    const isCombat = this.intensity === 'combat' || isBoss;
    if (isCombat) {
      const pattern = isBoss ? this.bassPatternBoss : this.bassPatternCombat;
      const bassFreq = pattern[step] * pitch;
      this.playSynthNote(bassFreq, 'sawtooth', 0.13, isBoss ? 0.30 : 0.24, isBoss ? 1200 : 880);
      if (step % 4 === 0) {
        this.playKick(now, isBoss ? 0.52 : 0.4);
      }
      if (step % 8 === 4) {
        this.playSnare(now, isBoss ? 0.30 : 0.22);
      }
      if (step % 2 === 1) {
        this.playHat(now, 0.06);
      }
      const lead = this.leadArp[step];
      if (lead > 0 && (isBoss || (this.stepIndex >> 4) % 2 === 1)) {
        this.playSynthNote(lead * pitch, 'square', 0.11, isBoss ? 0.11 : 0.08, 1900);
      }
    }
  }

  private playSynthNote(
    freq: number,
    type: OscillatorType,
    duration: number,
    gainVal: number,
    cutoff: number,
  ): void {
    if (!this.ctx || !this.musicGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(cutoff, now);
    filter.frequency.exponentialRampToValueAtTime(Math.max(120, cutoff * 0.25), now + duration);
    filter.Q.value = 3.5;

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(gainVal, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.musicGain);

    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  private playDrone(freq: number, duration: number, gainVal: number): void {
    if (!this.ctx || !this.musicGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, now);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(gainVal, now + 0.35);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.connect(gain);
    gain.connect(this.musicGain);
    osc.start(now);
    osc.stop(now + duration + 0.05);
  }

  private playKick(now: number, volume: number, toSfx = false): void {
    const dest = toSfx ? this.sfxGain : this.musicGain;
    if (!this.ctx || !dest) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(145, now);
    osc.frequency.exponentialRampToValueAtTime(34, now + 0.11);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
    osc.connect(gain);
    gain.connect(dest);
    osc.start(now);
    osc.stop(now + 0.15);
  }

  private playSnare(now: number, volume: number): void {
    if (!this.ctx || !this.musicGain || !this.noiseBuffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1600;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.musicGain);
    src.start(now);
    src.stop(now + 0.13);
  }

  private playHat(now: number, volume: number): void {
    if (!this.ctx || !this.musicGain || !this.noiseBuffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 6500;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.045);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.musicGain);
    src.start(now);
    src.stop(now + 0.05);
  }

  private playSfxNoise(
    now: number,
    duration: number,
    filterFreq: number,
    volume: number,
    filterType: BiquadFilterType = 'bandpass',
    q = 1.0,
  ): void {
    if (!this.ctx || !this.sfxGain || !this.noiseBuffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(filterFreq, now);
    filter.Q.value = q;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);
    src.start(now);
    src.stop(now + duration + 0.02);
  }

  // --- Gameplay SFX (Bolt 1 + Bolt 2 Full Suite) ---

  playMalorianShot(): void {
    if (!this.ensureSfxReady() || !this.ctx || !this.sfxGain || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;

    // Heavy low-end cannon punch
    const sub = this.ctx.createOscillator();
    const subGain = this.ctx.createGain();
    sub.type = 'triangle';
    sub.frequency.setValueAtTime(210 * this.sandevistanPitchScale, now);
    sub.frequency.exponentialRampToValueAtTime(38, now + 0.14);
    subGain.gain.setValueAtTime(0.75, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    sub.connect(subGain);
    subGain.connect(this.sfxGain);
    sub.start(now);
    sub.stop(now + 0.17);

    // Metallic gunshot crack
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1400, now);
    bp.Q.value = 0.8;
    const nGain = this.ctx.createGain();
    nGain.gain.setValueAtTime(0.55, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.19);
    noise.connect(bp);
    bp.connect(nGain);
    nGain.connect(this.sfxGain);
    noise.start(now);
    noise.stop(now + 0.2);

    // Cyberpunk high-tech transient ping
    const ping = this.ctx.createOscillator();
    const pGain = this.ctx.createGain();
    ping.type = 'sawtooth';
    ping.frequency.setValueAtTime(920 * this.sandevistanPitchScale, now);
    ping.frequency.exponentialRampToValueAtTime(260, now + 0.08);
    pGain.gain.setValueAtTime(0.18, now);
    pGain.gain.exponentialRampToValueAtTime(0.001, now + 0.085);
    ping.connect(pGain);
    pGain.connect(this.sfxGain);
    ping.start(now);
    ping.stop(now + 0.09);
  }

  playPistolShot(): void {
    if (!this.ensureSfxReady() || !this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(295 * this.sandevistanPitchScale, now);
    osc.frequency.exponentialRampToValueAtTime(62, now + 0.1);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1150;
    gain.gain.setValueAtTime(0.42, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
    osc.connect(lp);
    lp.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.12);

    this.playSfxNoise(now, 0.095, 2100, 0.38, 'bandpass', 0.9);
  }

  playSmgShot(): void {
    if (!this.ensureSfxReady() || !this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(380 * this.sandevistanPitchScale, now);
    osc.frequency.exponentialRampToValueAtTime(110, now + 0.055);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1500;
    gain.gain.setValueAtTime(0.24, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
    osc.connect(lp);
    lp.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.065);

    this.playSfxNoise(now, 0.055, 2600, 0.26, 'bandpass', 1.1);
  }

  playShotgunShot(): void {
    if (!this.ensureSfxReady() || !this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;

    this.playKick(now, 0.78, true);
    this.playSfxNoise(now, 0.28, 980, 0.68, 'lowpass', 0.7);

    const body = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    body.type = 'sawtooth';
    body.frequency.setValueAtTime(155 * this.sandevistanPitchScale, now);
    body.frequency.exponentialRampToValueAtTime(36, now + 0.22);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 540;
    gain.gain.setValueAtTime(0.45, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
    body.connect(lp);
    lp.connect(gain);
    gain.connect(this.sfxGain);
    body.start(now);
    body.stop(now + 0.26);
  }

  playMantisSlash(heavy = false): void {
    if (!this.ensureSfxReady() || !this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    const dur = heavy ? 0.24 : 0.15;

    for (const detune of [-10, 14]) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.detune.value = detune;
      osc.frequency.setValueAtTime((heavy ? 1950 : 1480) * this.sandevistanPitchScale, now);
      osc.frequency.exponentialRampToValueAtTime(heavy ? 220 : 360, now + dur);
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(heavy ? 2200 : 1800, now);
      bp.Q.value = 1.6;
      gain.gain.setValueAtTime(heavy ? 0.24 : 0.17, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + dur + 0.02);
      osc.connect(bp);
      bp.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(now);
      osc.stop(now + dur + 0.03);
    }

    this.playSfxNoise(now, heavy ? 0.2 : 0.12, 3400, heavy ? 0.38 : 0.24, 'highpass', 0.9);
  }

  playFlameMelee(): void {
    if (!this.ensureSfxReady() || !this.ctx || !this.sfxGain || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'bandpass';
    lp.frequency.setValueAtTime(420, now);
    lp.frequency.exponentialRampToValueAtTime(1800, now + 0.12);
    lp.frequency.exponentialRampToValueAtTime(260, now + 0.42);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.01, now);
    gain.gain.linearRampToValueAtTime(0.65, now + 0.06);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    src.connect(lp);
    lp.connect(gain);
    gain.connect(this.sfxGain);
    src.start(now);
    src.stop(now + 0.46);
  }

  playReload(): void {
    if (!this.ensureSfxReady() || !this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    const clicks = [0, 0.22, 0.56];
    const freqs = [520, 740, 1080];
    clicks.forEach((offset, idx) => {
      if (!this.ctx || !this.sfxGain) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(freqs[idx], now + offset);
      osc.frequency.exponentialRampToValueAtTime(freqs[idx] * 0.5, now + offset + 0.05);
      gain.gain.setValueAtTime(0.22, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.06);
      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(now + offset);
      osc.stop(now + offset + 0.065);
    });
  }

  playHitMarker(headshot: boolean): void {
    if (!this.ensureSfxReady() || !this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = headshot ? 'triangle' : 'sine';
    osc.frequency.setValueAtTime(headshot ? 1750 : 980, now);
    osc.frequency.exponentialRampToValueAtTime(headshot ? 2450 : 620, now + 0.06);
    gain.gain.setValueAtTime(headshot ? 0.34 : 0.22, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.075);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.08);
  }

  playSandevistan(activate: boolean): void {
    this.setSandevistanMode(activate);
    if (!this.ensureSfxReady() || !this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    if (activate) {
      osc.frequency.setValueAtTime(640, now);
      osc.frequency.exponentialRampToValueAtTime(75, now + 0.42);
    } else {
      osc.frequency.setValueAtTime(95, now);
      osc.frequency.exponentialRampToValueAtTime(520, now + 0.28);
    }
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1400;
    gain.gain.setValueAtTime(0.32, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.44);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.46);
  }

  playDash(): void {
    if (!this.ensureSfxReady() || !this.ctx || !this.sfxGain || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(900, now);
    filter.frequency.exponentialRampToValueAtTime(220, now + 0.18);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.28, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.19);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);
    src.start(now);
    src.stop(now + 0.2);
  }

  playMaxDoc(): void {
    if (!this.ensureSfxReady() || !this.ctx || !this.sfxGain || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;
    // Pressurized hiss
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2600;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.26, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.26);
    src.connect(hp);
    hp.connect(gain);
    gain.connect(this.sfxGain);
    src.start(now);
    src.stop(now + 0.28);

    // Chime
    const osc = this.ctx.createOscillator();
    const g2 = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(520, now + 0.08);
    osc.frequency.exponentialRampToValueAtTime(1040, now + 0.25);
    g2.gain.setValueAtTime(0.18, now + 0.08);
    g2.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    osc.connect(g2);
    g2.connect(this.sfxGain);
    osc.start(now + 0.08);
    osc.stop(now + 0.32);
  }

  playCarHornOrSummon(): void {
    if (!this.ensureSfxReady() || !this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    const tones = [
      { freq: 440, delay: 0, dur: 0.12 },
      { freq: 659.25, delay: 0.11, dur: 0.19 },
    ];
    for (const t of tones) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(t.freq, now + t.delay);
      gain.gain.setValueAtTime(0.001, now + t.delay);
      gain.gain.linearRampToValueAtTime(0.2, now + t.delay + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, now + t.delay + t.dur);
      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(now + t.delay);
      osc.stop(now + t.delay + t.dur + 0.02);
    }
  }

  playCarNitro(): void {
    if (!this.ensureSfxReady() || !this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    this.playSfxNoise(now, 0.38, 860, 0.34, 'bandpass', 0.8);

    const turbine = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    turbine.type = 'sawtooth';
    turbine.frequency.setValueAtTime(115, now);
    turbine.frequency.exponentialRampToValueAtTime(420, now + 0.26);
    turbine.frequency.exponentialRampToValueAtTime(210, now + 0.42);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 920;
    gain.gain.setValueAtTime(0.01, now);
    gain.gain.linearRampToValueAtTime(0.24, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.44);
    turbine.connect(lp);
    lp.connect(gain);
    gain.connect(this.sfxGain);
    turbine.start(now);
    turbine.stop(now + 0.46);
  }

  playRelicGlitch(): void {
    if (!this.ensureSfxReady() || !this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    this.playSfxNoise(now, 0.22, 2600, 0.28, 'bandpass', 1.8);

    const steps = [
      { freq: 210, delay: 0, dur: 0.09, type: 'square' as OscillatorType },
      { freq: 92, delay: 0.07, dur: 0.16, type: 'sawtooth' as OscillatorType },
      { freq: 1420, delay: 0.11, dur: 0.06, type: 'square' as OscillatorType },
    ];
    for (const s of steps) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = s.type;
      osc.frequency.setValueAtTime(s.freq, now + s.delay);
      osc.frequency.exponentialRampToValueAtTime(Math.max(40, s.freq * 0.45), now + s.delay + s.dur);
      gain.gain.setValueAtTime(0.18, now + s.delay);
      gain.gain.exponentialRampToValueAtTime(0.001, now + s.delay + s.dur);
      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(now + s.delay);
      osc.stop(now + s.delay + s.dur + 0.02);
    }
  }

  playPurchase(): void {
    if (!this.ensureSfxReady() || !this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    const notes = [740, 1108.73, 1480];
    notes.forEach((f, idx) => {
      if (!this.ctx || !this.sfxGain) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(f, now + idx * 0.065);
      gain.gain.setValueAtTime(0.18, now + idx * 0.065);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.065 + 0.14);
      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(now + idx * 0.065);
      osc.stop(now + idx * 0.065 + 0.16);
    });
  }

  playChokeHeartbeat(): void {
    if (!this.ensureSfxReady() || !this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    // Double low-end lub-dub heartbeat under suffocation pressure
    const beats = [
      { delay: 0, startFreq: 86, endFreq: 32, vol: 0.62, dur: 0.18 },
      { delay: 0.24, startFreq: 72, endFreq: 28, vol: 0.46, dur: 0.22 },
    ];
    for (const b of beats) {
      const osc = this.ctx.createOscillator();
      const lp = this.ctx.createBiquadFilter();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(b.startFreq, now + b.delay);
      osc.frequency.exponentialRampToValueAtTime(b.endFreq, now + b.delay + b.dur);
      lp.type = 'lowpass';
      lp.frequency.value = 180;
      gain.gain.setValueAtTime(0.001, now + b.delay);
      gain.gain.linearRampToValueAtTime(b.vol, now + b.delay + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + b.delay + b.dur);
      osc.connect(lp);
      lp.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(now + b.delay);
      osc.stop(now + b.delay + b.dur + 0.03);
    }
    this.playSfxNoise(now, 0.36, 320, 0.14, 'lowpass', 0.7);
  }

  playEnemyShot(heavy = false): void {
    if (!this.ensureSfxReady() || !this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = heavy ? 'sawtooth' : 'square';
    osc.frequency.setValueAtTime((heavy ? 240 : 480) * this.sandevistanPitchScale, now);
    osc.frequency.exponentialRampToValueAtTime(heavy ? 65 : 140, now + 0.09);
    gain.gain.setValueAtTime(heavy ? 0.22 : 0.14, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.11);
  }

  playPlayerHurt(heavy = false): void {
    if (!this.ensureSfxReady() || !this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(heavy ? 115 : 165, now);
    osc.frequency.exponentialRampToValueAtTime(42, now + (heavy ? 0.35 : 0.16));
    gain.gain.setValueAtTime(heavy ? 0.55 : 0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + (heavy ? 0.38 : 0.18));
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + (heavy ? 0.4 : 0.2));
  }

  playExplosion(big = false): void {
    if (!this.ensureSfxReady() || !this.ctx || !this.sfxGain || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;
    const dur = big ? 0.85 : 0.42;

    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(big ? 750 : 950, now);
    lp.frequency.exponentialRampToValueAtTime(65, now + dur);
    const nGain = this.ctx.createGain();
    nGain.gain.setValueAtTime(big ? 0.72 : 0.45, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    src.connect(lp);
    lp.connect(nGain);
    nGain.connect(this.sfxGain);
    src.start(now);
    src.stop(now + dur + 0.05);

    const sub = this.ctx.createOscillator();
    const sGain = this.ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(big ? 110 : 140, now);
    sub.frequency.exponentialRampToValueAtTime(24, now + dur * 0.8);
    sGain.gain.setValueAtTime(big ? 0.8 : 0.5, now);
    sGain.gain.exponentialRampToValueAtTime(0.001, now + dur * 0.85);
    sub.connect(sGain);
    sGain.connect(this.sfxGain);
    sub.start(now);
    sub.stop(now + dur);
  }

  playSmasherRoar(): void {
    if (!this.ensureSfxReady() || !this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    for (const detune of [-12, 0, 15]) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(92, now);
      osc.detune.value = detune;
      osc.frequency.linearRampToValueAtTime(58, now + 0.75);
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 460;
      gain.gain.setValueAtTime(0.24, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.82);
      osc.connect(lp);
      lp.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(now);
      osc.stop(now + 0.85);
    }
  }

  playTinnitus(durationSec = 2.6): void {
    if (!this.ensureSfxReady() || !this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(3420, now);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.14, now + 0.15);
    gain.gain.exponentialRampToValueAtTime(0.001, now + durationSec);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + durationSec + 0.05);
  }

  playHoloChime(): void {
    if (!this.ensureSfxReady() || !this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    const notes = [660, 880, 1320];
    notes.forEach((f, i) => {
      if (!this.ctx || !this.sfxGain) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, now + i * 0.065);
      gain.gain.setValueAtTime(0.13, now + i * 0.065);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.065 + 0.18);
      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(now + i * 0.065);
      osc.stop(now + i * 0.065 + 0.2);
    });
  }

  playTerminalHack(): void {
    if (!this.ensureSfxReady() || !this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    const notes = [440, 587.33, 880, 1174.66];
    notes.forEach((f, i) => {
      if (!this.ctx || !this.sfxGain) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(f, now + i * 0.075);
      gain.gain.setValueAtTime(0.2, now + i * 0.075);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.075 + 0.14);
      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(now + i * 0.075);
      osc.stop(now + i * 0.075 + 0.16);
    });
  }

  playEcgBeep(freq = 880, volume = 0.09, toMusic = false): void {
    if (!toSfxOrMusicReady(this.ctx, toMusic ? this.musicGain : this.sfxGain)) {
      if (!toMusic && !this.ensureSfxReady()) return;
    }
    const dest = toMusic ? this.musicGain : this.sfxGain;
    if (!this.ctx || !dest) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
    osc.connect(gain);
    gain.connect(dest);
    osc.start(now);
    osc.stop(now + 0.1);
  }

  playSoulkillerSurge(durationSec = 4.5): void {
    if (!this.ensureSfxReady() || !this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc1.type = 'sawtooth';
    osc2.type = 'square';
    osc1.frequency.setValueAtTime(75, now);
    osc1.frequency.exponentialRampToValueAtTime(980, now + durationSec);
    osc2.frequency.setValueAtTime(112, now);
    osc2.frequency.exponentialRampToValueAtTime(1520, now + durationSec);

    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(300, now);
    bp.frequency.exponentialRampToValueAtTime(3200, now + durationSec);
    bp.Q.value = 2.4;

    gain.gain.setValueAtTime(0.01, now);
    gain.gain.linearRampToValueAtTime(0.32, now + durationSec * 0.75);
    gain.gain.exponentialRampToValueAtTime(0.001, now + durationSec + 0.4);

    osc1.connect(bp);
    osc2.connect(bp);
    bp.connect(gain);
    gain.connect(this.sfxGain);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + durationSec + 0.45);
    osc2.stop(now + durationSec + 0.45);
  }

  playElevatorDing(): void {
    if (!this.ensureSfxReady() || !this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    const tones = [
      { freq: 1046.5, delay: 0, dur: 0.55 },
      { freq: 1318.5, delay: 0.14, dur: 0.72 },
    ];
    for (const t of tones) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(t.freq, now + t.delay);
      gain.gain.setValueAtTime(0.001, now + t.delay);
      gain.gain.linearRampToValueAtTime(0.24, now + t.delay + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, now + t.delay + t.dur);
      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(now + t.delay);
      osc.stop(now + t.delay + t.dur + 0.04);
    }
  }

  playElevatorFloorTick(): void {
    if (!this.ensureSfxReady() || !this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(1480, now);
    gain.gain.setValueAtTime(0.045, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.032);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.04);
  }

  playElevatorRide(durationSec = 4.2): void {
    if (!this.ensureSfxReady() || !this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    const dur = Math.max(1.0, durationSec);

    // Low mechanical maglev hum with smooth acceleration and deceleration pitch curve
    const hum = this.ctx.createOscillator();
    const whine = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();

    hum.type = 'sawtooth';
    hum.frequency.setValueAtTime(48, now);
    hum.frequency.linearRampToValueAtTime(74, now + dur * 0.28);
    hum.frequency.setValueAtTime(74, now + dur * 0.72);
    hum.frequency.linearRampToValueAtTime(44, now + dur);

    whine.type = 'sine';
    whine.frequency.setValueAtTime(160, now);
    whine.frequency.linearRampToValueAtTime(340, now + dur * 0.3);
    whine.frequency.setValueAtTime(340, now + dur * 0.72);
    whine.frequency.linearRampToValueAtTime(140, now + dur);

    filter.type = 'lowpass';
    filter.frequency.value = 460;

    const fadeInEnd = Math.min(0.35, dur * 0.25);
    const fadeOutStart = Math.max(fadeInEnd + 0.05, dur - 0.55);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.16, now + fadeInEnd);
    gain.gain.setValueAtTime(0.15, now + fadeOutStart);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    hum.connect(filter);
    whine.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);

    hum.start(now);
    whine.start(now);
    hum.stop(now + dur + 0.05);
    whine.stop(now + dur + 0.05);
  }

  dispose(): void {
    if (this.stepTimer !== null) {
      window.clearInterval(this.stepTimer);
      this.stepTimer = null;
    }
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
  }
}

function toSfxOrMusicReady(ctx: AudioContext | null, dest: GainNode | null): boolean {
  return Boolean(ctx && dest);
}

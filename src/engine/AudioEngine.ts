import type { MusicIntensity } from '../types/game';

/**
 * Procedural WebAudio synthesizer evolved from Bolt 1:
 * Guns (Malorian, Alatau, Steppe SMG, Buran Shotgun), Mantis Blades, Cyber-Akhmed engine/turbo,
 * Sandevistan, Relic biochip glitch, Smasher roar, and 8 adaptive cyber-Almaty music loops.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private volume = 0.72;
  private musicMode: MusicIntensity = 'silent';
  private musicTimer: number | null = null;
  private musicStep = 0;

  ensureStarted(): void {
    if (typeof window === 'undefined') return;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;

      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.volume;
      this.masterGain.connect(this.ctx.destination);

      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = 0.9;
      this.sfxGain.connect(this.masterGain);

      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.32;
      this.musicGain.connect(this.masterGain);

      this.noiseBuffer = this.createNoiseBuffer(this.ctx);
    }

    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  private createNoiseBuffer(ctx: AudioContext): AudioBuffer {
    const length = ctx.sampleRate * 1.4;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  setMasterVolume(vol: number): void {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.03);
    }
  }

  setMusicIntensity(mode: MusicIntensity): void {
    if (this.musicMode === mode) return;
    this.musicMode = mode;

    if (this.musicTimer !== null) {
      window.clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
    if (mode === 'silent' || typeof window === 'undefined') return;

    this.musicStep = 0;
    const stepMs =
      mode === 'boss'
        ? 145
        : mode === 'chase'
          ? 150
          : mode === 'combat'
            ? 170
            : mode === 'cyberspace'
              ? 340
              : mode === 'marum_lounge'
                ? 280
                : mode === 'taldykorgan'
                  ? 320
                  : 230;

    this.musicTimer = window.setInterval(() => {
      this.tickMusic();
    }, stepMs);
  }

  private tickMusic(): void {
    if (!this.ctx || !this.musicGain || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    const step = this.musicStep++;

    if (this.musicMode === 'title' || this.musicMode === 'almaty_night') {
      const notes = [55, 55, 65.41, 55, 49, 49, 61.74, 49];
      const f = notes[step % notes.length];
      this.playSynthTone(f, 'sawtooth', 0.2, 0.14, now, 360, true);
      if (step % 4 === 0) {
        this.playSynthTone(f * 4, 'triangle', 0.25, 0.06, now, 1100, true);
      }
      if (step % 8 === 4) {
        this.playKick(now, 0.2, true);
      }
      return;
    }

    if (this.musicMode === 'marum_lounge') {
      const chords = [110, 130.81, 164.81, 146.83];
      const root = chords[Math.floor(step / 4) % chords.length];
      if (step % 2 === 0) {
        this.playSynthTone(root, 'triangle', 0.35, 0.1, now, 650, true);
      }
      if (step % 4 === 2) {
        this.playSynthTone(root * 2, 'sine', 0.22, 0.05, now, 1400, true);
      }
      return;
    }

    if (this.musicMode === 'combat' || this.musicMode === 'chase') {
      const bass =
        this.musicMode === 'chase'
          ? [55, 55, 65.41, 73.42, 55, 55, 82.41, 73.42]
          : [55, 55, 61.74, 55, 65.41, 55, 49, 55];
      this.playSynthTone(bass[step % bass.length], 'sawtooth', 0.14, 0.2, now, 640, true);
      if (step % 2 === 0) this.playKick(now, 0.36, true);
      if (step % 4 === 2) this.playNoiseBurst(now, 0.08, 2200, 0.14, true);
      return;
    }

    if (this.musicMode === 'boss') {
      const riff = [41.2, 41.2, 49, 41.2, 55, 49, 46.25, 41.2];
      this.playSynthTone(riff[step % riff.length], 'sawtooth', 0.13, 0.28, now, 780, true);
      if (step % 2 === 0) this.playKick(now, 0.45, true);
      if (step % 4 === 2) this.playNoiseBurst(now, 0.1, 1500, 0.22, true);
      if (step % 8 === 6) this.playSynthTone(164.81, 'square', 0.14, 0.1, now, 1400, true);
      return;
    }

    if (this.musicMode === 'cyberspace') {
      const drone = [65.41, 82.41, 98, 123.47];
      this.playSynthTone(drone[step % drone.length], 'sine', 0.5, 0.12, now, 1100, true);
      if (step % 3 === 0) {
        this.playSynthTone(drone[step % drone.length] * 4, 'triangle', 0.22, 0.05, now, 2200, true);
      }
      return;
    }

    if (this.musicMode === 'taldykorgan') {
      const desert = [73.42, 82.41, 87.31, 73.42];
      this.playSynthTone(desert[step % desert.length], 'triangle', 0.4, 0.13, now, 520, true);
      if (step % 4 === 0) this.playSynthTone(293.66, 'sine', 0.35, 0.05, now, 900, true);
    }
  }

  private playSynthTone(
    freq: number,
    type: OscillatorType,
    duration: number,
    gainLevel: number,
    startTime: number,
    cutoff = 1200,
    toMusic = false,
  ): void {
    if (!this.ctx || !this.sfxGain || !this.musicGain) return;
    const osc = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, startTime);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(cutoff, startTime);
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(gainLevel, startTime + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(toMusic ? this.musicGain : this.sfxGain);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.02);
  }

  private playKick(startTime: number, volume = 0.4, toMusic = false): void {
    if (!this.ctx || !this.sfxGain || !this.musicGain) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(140, startTime);
    osc.frequency.exponentialRampToValueAtTime(36, startTime + 0.11);
    gain.gain.setValueAtTime(volume, startTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.14);
    osc.connect(gain);
    gain.connect(toMusic ? this.musicGain : this.sfxGain);
    osc.start(startTime);
    osc.stop(startTime + 0.16);
  }

  private playNoiseBurst(
    startTime: number,
    duration: number,
    filterFreq: number,
    volume: number,
    toMusic = false,
    filterType: BiquadFilterType = 'bandpass',
  ): void {
    if (!this.ctx || !this.noiseBuffer || !this.sfxGain || !this.musicGain) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(filterFreq, startTime);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, startTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(toMusic ? this.musicGain : this.sfxGain);
    src.start(startTime);
    src.stop(startTime + duration + 0.02);
  }

  playMalorianShot(): void {
    this.ensureStarted();
    if (!this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(38, now + 0.18);
    gain.gain.setValueAtTime(0.62, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.21);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.23);
    this.playNoiseBurst(now, 0.15, 1650, 0.52, false, 'lowpass');
    this.playSynthTone(1920, 'triangle', 0.06, 0.18, now, 3200);
  }

  playPistolShot(): void {
    this.ensureStarted();
    if (!this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    this.playSynthTone(290, 'sawtooth', 0.11, 0.34, now, 900);
    this.playNoiseBurst(now, 0.09, 2100, 0.35, false, 'bandpass');
  }

  playSmgShot(): void {
    this.ensureStarted();
    if (!this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    this.playSynthTone(360, 'square', 0.06, 0.2, now, 1200);
    this.playNoiseBurst(now, 0.05, 2500, 0.24, false, 'bandpass');
  }

  playShotgunShot(): void {
    this.ensureStarted();
    if (!this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    this.playKick(now, 0.72, false);
    this.playNoiseBurst(now, 0.24, 1100, 0.65, false, 'lowpass');
    this.playSynthTone(130, 'sawtooth', 0.2, 0.4, now, 500);
  }

  playMantisSlash(heavy = false): void {
    this.ensureStarted();
    if (!this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(heavy ? 1850 : 1400, now);
    osc.frequency.exponentialRampToValueAtTime(heavy ? 240 : 380, now + (heavy ? 0.22 : 0.14));
    gain.gain.setValueAtTime(heavy ? 0.32 : 0.22, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + (heavy ? 0.24 : 0.16));
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.26);
    this.playNoiseBurst(now, heavy ? 0.18 : 0.11, 3400, heavy ? 0.35 : 0.22, false, 'highpass');
  }

  playFlameMelee(): void {
    this.ensureStarted();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.playNoiseBurst(now, 0.34, 720, 0.52, false, 'bandpass');
    this.playSynthTone(115, 'sawtooth', 0.28, 0.28, now, 420);
  }

  playReload(): void {
    this.ensureStarted();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.playSynthTone(620, 'square', 0.05, 0.14, now, 1800);
    this.playSynthTone(980, 'square', 0.06, 0.15, now + 0.2, 2200);
    this.playSynthTone(1440, 'triangle', 0.07, 0.17, now + 0.44, 3000);
  }

  playHitMarker(headshot: boolean): void {
    this.ensureStarted();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (headshot) {
      this.playSynthTone(1650, 'triangle', 0.06, 0.26, now, 4000);
      this.playSynthTone(2480, 'sine', 0.08, 0.22, now + 0.03, 5000);
    } else {
      this.playSynthTone(960, 'triangle', 0.045, 0.16, now, 2500);
    }
  }

  playSandevistan(activate: boolean): void {
    this.ensureStarted();
    if (!this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    if (activate) {
      osc.frequency.setValueAtTime(760, now);
      osc.frequency.exponentialRampToValueAtTime(92, now + 0.42);
    } else {
      osc.frequency.setValueAtTime(110, now);
      osc.frequency.exponentialRampToValueAtTime(640, now + 0.28);
    }
    gain.gain.setValueAtTime(0.32, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.46);
  }

  playDash(): void {
    this.ensureStarted();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.playNoiseBurst(now, 0.13, 1800, 0.26, false, 'highpass');
    this.playSynthTone(260, 'sine', 0.11, 0.18, now, 900);
  }

  playMaxDoc(): void {
    this.ensureStarted();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.playNoiseBurst(now, 0.2, 3200, 0.22, false, 'highpass');
    this.playSynthTone(520, 'sine', 0.16, 0.18, now + 0.08, 2200);
    this.playSynthTone(780, 'sine', 0.18, 0.18, now + 0.18, 2600);
  }

  playCarHornOrSummon(): void {
    this.ensureStarted();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.playSynthTone(440, 'triangle', 0.11, 0.16, now, 1800);
    this.playSynthTone(660, 'triangle', 0.15, 0.18, now + 0.12, 2200);
  }

  playCarNitro(): void {
    this.ensureStarted();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.playNoiseBurst(now, 0.35, 900, 0.28, false, 'bandpass');
    this.playSynthTone(120, 'sawtooth', 0.35, 0.22, now, 700);
  }

  playRelicGlitch(): void {
    this.ensureStarted();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.playNoiseBurst(now, 0.18, 2600, 0.25, false, 'bandpass');
    this.playSynthTone(190, 'square', 0.14, 0.18, now, 1100);
    this.playSynthTone(95, 'sawtooth', 0.2, 0.16, now + 0.08, 600);
  }

  playEnemyShot(heavy = false): void {
    this.ensureStarted();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (heavy) {
      this.playSynthTone(150, 'sawtooth', 0.12, 0.24, now, 700);
      this.playNoiseBurst(now, 0.1, 900, 0.22, false, 'lowpass');
    } else {
      this.playSynthTone(420, 'square', 0.06, 0.12, now, 1500);
      this.playNoiseBurst(now, 0.05, 1900, 0.12, false, 'bandpass');
    }
  }

  playPlayerHurt(heavy = false): void {
    this.ensureStarted();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.playKick(now, heavy ? 0.65 : 0.42, false);
    this.playNoiseBurst(now, heavy ? 0.22 : 0.1, 600, heavy ? 0.35 : 0.2, false, 'lowpass');
  }

  playExplosion(big = false): void {
    this.ensureStarted();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.playKick(now, big ? 0.8 : 0.55, false);
    this.playNoiseBurst(now, big ? 0.58 : 0.34, big ? 440 : 660, big ? 0.62 : 0.42, false, 'lowpass');
  }

  playSmasherRoar(): void {
    this.ensureStarted();
    if (!this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(118, now);
    osc.frequency.exponentialRampToValueAtTime(38, now + 0.8);
    gain.gain.setValueAtTime(0.45, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.85);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.88);
    this.playNoiseBurst(now, 0.45, 500, 0.3, false, 'lowpass');
  }

  playHoloChime(): void {
    this.ensureStarted();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.playSynthTone(880, 'sine', 0.1, 0.15, now, 3000);
    this.playSynthTone(1318, 'sine', 0.14, 0.14, now + 0.08, 3500);
  }

  playTerminalHack(): void {
    this.ensureStarted();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    [660, 880, 1100, 1480].forEach((f, idx) => {
      this.playSynthTone(f, 'square', 0.06, 0.13, now + idx * 0.07, 3000);
    });
  }

  playElevatorDing(): void {
    this.ensureStarted();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.playSynthTone(1046, 'sine', 0.25, 0.18, now, 4000);
    this.playSynthTone(1318, 'sine', 0.35, 0.16, now + 0.14, 4000);
  }

  playPurchase(): void {
    this.ensureStarted();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.playSynthTone(740, 'triangle', 0.08, 0.18, now, 2800);
    this.playSynthTone(1110, 'triangle', 0.14, 0.2, now + 0.08, 3200);
  }

  dispose(): void {
    if (this.musicTimer !== null) {
      window.clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
  }
}

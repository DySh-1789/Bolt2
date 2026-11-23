import * as THREE from 'three';

function createCanvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not initialize 2D canvas context');
  }
  return [canvas, ctx];
}

/**
 * Procedural texture generator evolved from Bolt 1,
 * expanded for Cyber-Almaty (neon asphalt, panel buildings, billboards, mountains, Marum, Huyeshi).
 */
export class ProceduralTextures {
  private cache = new Map<string, THREE.CanvasTexture>();

  private register(
    key: string,
    canvas: HTMLCanvasElement,
    repeatX = 1,
    repeatY = 1,
  ): THREE.CanvasTexture {
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeatX, repeatY);
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    this.cache.set(key, tex);
    return tex;
  }

  getFloorTile(accentColor = '#00f0ff', repeatX = 8, repeatY = 8): THREE.CanvasTexture {
    const key = `floor_${accentColor}_${repeatX}_${repeatY}`;
    const existing = this.cache.get(key);
    if (existing) return existing;

    const [canvas, ctx] = createCanvas(512, 512);
    ctx.fillStyle = '#121828';
    ctx.fillRect(0, 0, 512, 512);

    ctx.strokeStyle = '#25314d';
    ctx.lineWidth = 4;
    for (let i = 0; i <= 512; i += 128) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, 512);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(512, i);
      ctx.stroke();
    }

    ctx.fillStyle = accentColor;
    ctx.globalAlpha = 0.22;
    ctx.fillRect(0, 250, 512, 10);
    ctx.fillRect(250, 0, 10, 512);
    ctx.globalAlpha = 1;

    return this.register(key, canvas, repeatX, repeatY);
  }

  getCyberAsphalt(repeatX = 24, repeatY = 24): THREE.CanvasTexture {
    const key = `asphalt_${repeatX}_${repeatY}`;
    const existing = this.cache.get(key);
    if (existing) return existing;

    const [canvas, ctx] = createCanvas(512, 512);
    ctx.fillStyle = '#101421';
    ctx.fillRect(0, 0, 512, 512);

    // Subtle rain-slick noise specks
    for (let i = 0; i < 650; i++) {
      const x = (i * 97) % 512;
      const y = (i * 193) % 512;
      ctx.fillStyle = i % 5 === 0 ? 'rgba(0, 240, 255, 0.08)' : 'rgba(255, 255, 255, 0.04)';
      ctx.fillRect(x, y, 3, 3);
    }

    // Subtle hex / asphalt seam grid
    ctx.strokeStyle = '#192136';
    ctx.lineWidth = 2;
    for (let i = 0; i <= 512; i += 128) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, 512);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(512, i);
      ctx.stroke();
    }

    return this.register(key, canvas, repeatX, repeatY);
  }

  getRoadSurface(repeatX = 1, repeatY = 20): THREE.CanvasTexture {
    const key = `road_${repeatX}_${repeatY}`;
    const existing = this.cache.get(key);
    if (existing) return existing;

    const [canvas, ctx] = createCanvas(256, 512);
    ctx.fillStyle = '#0d111d';
    ctx.fillRect(0, 0, 256, 512);

    // Curb neon edges
    ctx.fillStyle = '#00f0ff';
    ctx.fillRect(8, 0, 5, 512);
    ctx.fillRect(243, 0, 5, 512);

    // Dashed yellow cyber lane divider
    ctx.fillStyle = '#fcee0a';
    for (let y = 16; y < 512; y += 64) {
      ctx.fillRect(124, y, 8, 34);
    }

    // Subtle tire wear sheen
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    ctx.fillRect(46, 0, 48, 512);
    ctx.fillRect(162, 0, 48, 512);

    return this.register(key, canvas, repeatX, repeatY);
  }

  getBuildingFacade(accentHex = '#00f0ff', darkHex = '#101627', repeatX = 2, repeatY = 4): THREE.CanvasTexture {
    const key = `facade_${accentHex}_${darkHex}_${repeatX}_${repeatY}`;
    const existing = this.cache.get(key);
    if (existing) return existing;

    const [canvas, ctx] = createCanvas(256, 512);
    ctx.fillStyle = darkHex;
    ctx.fillRect(0, 0, 256, 512);

    // Architectural concrete/metal ribs
    ctx.strokeStyle = '#25324f';
    ctx.lineWidth = 4;
    ctx.strokeRect(4, 4, 248, 504);

    // Windows grid
    for (let row = 0; row < 12; row++) {
      const y = 20 + row * 40;
      for (let col = 0; col < 5; col++) {
        const x = 18 + col * 46;
        const hash = (row * 17 + col * 29 + accentHex.charCodeAt(1)) % 13;
        if (hash < 3) {
          ctx.fillStyle = accentHex;
          ctx.globalAlpha = 0.85;
        } else if (hash < 6) {
          ctx.fillStyle = '#d8efff';
          ctx.globalAlpha = 0.45;
        } else if (hash === 6) {
          ctx.fillStyle = '#fcee0a';
          ctx.globalAlpha = 0.65;
        } else {
          ctx.fillStyle = '#070a12';
          ctx.globalAlpha = 0.95;
        }
        ctx.fillRect(x, y, 32, 22);
        ctx.globalAlpha = 1;
      }
    }

    // Vertical neon accent bar
    ctx.fillStyle = accentHex;
    ctx.fillRect(6, 0, 5, 512);

    return this.register(key, canvas, repeatX, repeatY);
  }

  getWallPanel(stripeColor = '#ff003c', repeatX = 4, repeatY = 2): THREE.CanvasTexture {
    const key = `wall_${stripeColor}_${repeatX}_${repeatY}`;
    const existing = this.cache.get(key);
    if (existing) return existing;

    const [canvas, ctx] = createCanvas(512, 512);
    const grad = ctx.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, '#1e273c');
    grad.addColorStop(0.5, '#2a3652');
    grad.addColorStop(1, '#1a2235');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 512);

    ctx.strokeStyle = '#435275';
    ctx.lineWidth = 5;
    ctx.strokeRect(12, 12, 488, 488);
    ctx.strokeStyle = '#121826';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(256, 12);
    ctx.lineTo(256, 500);
    ctx.moveTo(12, 370);
    ctx.lineTo(500, 370);
    ctx.stroke();

    ctx.fillStyle = stripeColor;
    ctx.fillRect(16, 420, 480, 12);
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillRect(16, 420, 480, 4);

    return this.register(key, canvas, repeatX, repeatY);
  }

  getServerRack(): THREE.CanvasTexture {
    const key = 'server_rack';
    const existing = this.cache.get(key);
    if (existing) return existing;

    const [canvas, ctx] = createCanvas(256, 512);
    ctx.fillStyle = '#0a0d16';
    ctx.fillRect(0, 0, 256, 512);
    ctx.strokeStyle = '#252f45';
    ctx.lineWidth = 6;
    ctx.strokeRect(4, 4, 248, 504);

    for (let row = 0; row < 16; row++) {
      const y = 18 + row * 30;
      ctx.fillStyle = '#121826';
      ctx.fillRect(16, y, 224, 22);
      for (let led = 0; led < 4; led++) {
        const hash = (row * 13 + led * 7) % 11;
        if (hash < 4) ctx.fillStyle = '#00f0ff';
        else if (hash < 7) ctx.fillStyle = '#ff003c';
        else if (hash === 7) ctx.fillStyle = '#fcee0a';
        else ctx.fillStyle = '#1e283b';
        ctx.fillRect(168 + led * 16, y + 7, 9, 8);
      }
    }

    return this.register(key, canvas, 1, 1);
  }

  getNeonSign(
    title: string,
    subtitle: string,
    primaryColor = '#ff003c',
    secondaryColor = '#00f0ff',
    bg = '#070810',
  ): THREE.CanvasTexture {
    const key = `sign_${title}_${subtitle}_${primaryColor}_${secondaryColor}_${bg}`;
    const existing = this.cache.get(key);
    if (existing) return existing;

    const [canvas, ctx] = createCanvas(1024, 256);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 1024, 256);

    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    for (let y = 0; y < 256; y += 6) {
      ctx.fillRect(0, y, 1024, 2);
    }

    ctx.strokeStyle = primaryColor;
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(28, 16);
    ctx.lineTo(1008, 16);
    ctx.lineTo(1008, 212);
    ctx.lineTo(976, 240);
    ctx.lineTo(16, 240);
    ctx.lineTo(16, 44);
    ctx.closePath();
    ctx.stroke();

    ctx.fillStyle = primaryColor;
    ctx.fillRect(42, 42, 14, 170);

    ctx.save();
    ctx.shadowColor = primaryColor;
    ctx.shadowBlur = 24;
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 64px "Segoe UI", Impact, "Arial Black", sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(title, 82, 102);
    ctx.restore();

    ctx.save();
    ctx.shadowColor = secondaryColor;
    ctx.shadowBlur = 14;
    ctx.fillStyle = secondaryColor;
    ctx.font = '700 30px "Consolas", "Courier New", monospace';
    ctx.fillText(subtitle, 84, 184);
    ctx.restore();

    ctx.fillStyle = primaryColor;
    for (let i = 0; i < 12; i++) {
      const w = i % 3 === 0 ? 8 : 4;
      ctx.fillRect(880 + i * 9, 44, w, 46);
    }

    return this.register(key, canvas, 1, 1);
  }

  getAlmatyMountainSkyline(): THREE.CanvasTexture {
    const key = 'almaty_mountains';
    const existing = this.cache.get(key);
    if (existing) return existing;

    const [canvas, ctx] = createCanvas(1024, 512);
    const sky = ctx.createLinearGradient(0, 0, 0, 512);
    sky.addColorStop(0, '#040612');
    sky.addColorStop(0.5, '#120a28');
    sky.addColorStop(0.85, '#290d2f');
    sky.addColorStop(1, '#3d0d2e');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, 1024, 512);

    // Stars
    ctx.fillStyle = 'rgba(220,245,255,0.75)';
    for (let i = 0; i < 90; i++) {
      const sx = (i * 173) % 1024;
      const sy = (i * 67) % 210;
      ctx.fillRect(sx, sy, 2, 2);
    }

    // Zailiyskiy Alatau jagged snowy silhouettes with neon rim
    ctx.beginPath();
    ctx.moveTo(0, 512);
    const peaks = [
      [0, 350], [95, 250], [180, 310], [285, 195], [390, 275],
      [510, 165], [620, 260], [740, 185], [855, 270], [950, 220], [1024, 310],
    ];
    for (const [px, py] of peaks) {
      ctx.lineTo(px, py);
    }
    ctx.lineTo(1024, 512);
    ctx.closePath();
    const mGrad = ctx.createLinearGradient(0, 160, 0, 512);
    mGrad.addColorStop(0, '#1e2c52');
    mGrad.addColorStop(0.45, '#10162c');
    mGrad.addColorStop(1, '#080b18');
    ctx.fillStyle = mGrad;
    ctx.fill();

    // Glowing snow ridge line
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.55)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let i = 0; i < peaks.length; i++) {
      const [px, py] = peaks[i];
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();

    return this.register(key, canvas, 1, 1);
  }

  getHuyeshiMonitor(): THREE.CanvasTexture {
    const key = 'monitor_huyeshi';
    const existing = this.cache.get(key);
    if (existing) return existing;

    const [canvas, ctx] = createCanvas(512, 256);
    ctx.fillStyle = '#040911';
    ctx.fillRect(0, 0, 512, 256);
    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 4;
    ctx.strokeRect(6, 6, 500, 244);

    ctx.fillStyle = '#ff003c';
    ctx.font = '900 30px monospace';
    ctx.fillText('ХУЕШИ // CORE v2.077', 24, 48);
    ctx.fillStyle = '#00f0ff';
    ctx.font = '700 18px monospace';
    ctx.fillText('HOST: АИ (АМИР)  |  ENGRAM: САМИР', 24, 92);
    ctx.fillText('PROTOCOL: NEURAL CONSCIOUSNESS SPLIT', 24, 126);
    ctx.fillStyle = '#fcee0a';
    ctx.fillText('STATUS: READY FOR JACK-IN', 24, 168);
    ctx.fillStyle = '#00f0ff';
    ctx.fillRect(24, 196, 464, 26);
    ctx.fillStyle = '#040911';
    ctx.font = '900 18px monospace';
    ctx.fillText('>>> CONNECT TO BLACKWALL <<<', 96, 215);

    return this.register(key, canvas, 1, 1);
  }

  dispose(): void {
    for (const tex of this.cache.values()) {
      tex.dispose();
    }
    this.cache.clear();
  }
}

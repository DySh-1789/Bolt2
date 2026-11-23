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

/** Deterministic PRNG so procedural grime, puddles, and windows remain consistent across sessions. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Draws a sleek geometric Kazakh-cyber ornament band (modernized oyu-ornek angular motif).
 */
function drawKazakhCyberTrim(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  color: string,
  alpha = 0.55,
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = alpha;
  ctx.lineWidth = Math.max(1.5, height * 0.14);
  const step = Math.max(18, height * 2.1);
  const midY = y + height * 0.5;

  ctx.beginPath();
  for (let cx = x; cx < x + width; cx += step) {
    const half = step * 0.5;
    const q = step * 0.25;
    // Angular double-diamond cyber fretwork
    ctx.moveTo(cx, midY);
    ctx.lineTo(cx + q, y + height * 0.14);
    ctx.lineTo(cx + half, midY);
    ctx.lineTo(cx + half + q, y + height * 0.86);
    ctx.lineTo(cx + step, midY);
    // Inner micro-diamond
    ctx.moveTo(cx + q * 0.65, midY);
    ctx.lineTo(cx + half, y + height * 0.26);
    ctx.lineTo(cx + step - q * 0.65, midY);
    ctx.lineTo(cx + half, y + height * 0.74);
    ctx.closePath();
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * High-detail procedural texture generator for BOLT 2 // CYBER-ALMATY.
 * Combines Bolt 1's corporate marble, armor panels, server racks, medical monitors & skyline
 * with Bolt 2's rain-slick asphalt, wetness roughness maps, detailed skyscrapers,
 * Zailiyskiy Alatau alpine panorama, Kazakh-cyber trim, and the SECURE YOUR SOUL monolith banner.
 */
export class ProceduralTextures {
  private cache = new Map<string, THREE.CanvasTexture>();

  private register(
    key: string,
    canvas: HTMLCanvasElement,
    repeatX = 1,
    repeatY = 1,
    colorSpace: THREE.ColorSpace = THREE.SRGBColorSpace,
  ): THREE.CanvasTexture {
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = colorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeatX, repeatY);
    tex.anisotropy = 8;
    tex.needsUpdate = true;
    this.cache.set(key, tex);
    return tex;
  }

  getFloorTile(accentColor = '#00f0ff', repeatX = 8, repeatY = 8): THREE.CanvasTexture {
    const key = `floor_${accentColor}_${repeatX}_${repeatY}`;
    const existing = this.cache.get(key);
    if (existing) return existing;

    const [canvas, ctx] = createCanvas(512, 512);
    const rng = mulberry32(hashString(key));

    // Brushed corporate dark slate/marble base
    const baseGrad = ctx.createLinearGradient(0, 0, 512, 512);
    baseGrad.addColorStop(0, '#141c2e');
    baseGrad.addColorStop(0.5, '#192338');
    baseGrad.addColorStop(1, '#111827');
    ctx.fillStyle = baseGrad;
    ctx.fillRect(0, 0, 512, 512);

    // Subtle corporate marble veins (evolved from Bolt 1)
    for (let i = 0; i < 72; i++) {
      ctx.strokeStyle = `rgba(170, 205, 248, ${0.035 + (i % 4) * 0.018})`;
      ctx.lineWidth = 1 + (i % 3);
      ctx.beginPath();
      const x = (i * 73) % 512;
      ctx.moveTo(x, 0);
      ctx.bezierCurveTo(x + 42, 165, x - 38, 345, (x + 28) % 512, 512);
      ctx.stroke();
    }

    // Fine surface wear & dust specks
    for (let i = 0; i < 480; i++) {
      const px = rng() * 512;
      const py = rng() * 512;
      ctx.fillStyle = rng() > 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(4,7,14,0.16)';
      ctx.fillRect(px, py, 2, 2);
    }

    // Tile bevels & sub-grid seams
    ctx.strokeStyle = '#334263';
    ctx.lineWidth = 5;
    ctx.strokeRect(2, 2, 508, 508);

    ctx.strokeStyle = '#24304a';
    ctx.lineWidth = 3;
    for (let i = 128; i < 512; i += 128) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, 512);
      ctx.moveTo(0, i);
      ctx.lineTo(512, i);
      ctx.stroke();
    }

    // Recessed dark inner groove
    ctx.strokeStyle = '#0b101c';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(256, 0);
    ctx.lineTo(256, 512);
    ctx.moveTo(0, 256);
    ctx.lineTo(512, 256);
    ctx.stroke();

    // Kazakh-cyber geometric inlay strip along the central seam
    drawKazakhCyberTrim(ctx, 16, 244, 480, 24, accentColor, 0.34);

    // Glowing architectural conduit lines + central power node
    ctx.save();
    ctx.fillStyle = accentColor;
    ctx.globalAlpha = 0.24;
    ctx.fillRect(0, 253, 512, 6);
    ctx.fillRect(253, 0, 6, 512);
    ctx.globalAlpha = 0.85;
    ctx.shadowColor = accentColor;
    ctx.shadowBlur = 10;
    ctx.fillRect(247, 247, 18, 18);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(252, 252, 8, 8);
    ctx.restore();

    return this.register(key, canvas, repeatX, repeatY);
  }

  getCyberAsphalt(repeatX = 24, repeatY = 24): THREE.CanvasTexture {
    const key = `asphalt_${repeatX}_${repeatY}`;
    const existing = this.cache.get(key);
    if (existing) return existing;

    const [canvas, ctx] = createCanvas(512, 512);
    const rng = mulberry32(0x2077a1);

    // Deep damp basalt-charcoal asphalt base
    ctx.fillStyle = '#0e121e';
    ctx.fillRect(0, 0, 512, 512);

    // Broad grime / moisture variation blotches
    for (let i = 0; i < 24; i++) {
      const gx = rng() * 512;
      const gy = rng() * 512;
      const r = 40 + rng() * 95;
      const g = ctx.createRadialGradient(gx, gy, 4, gx, gy, r);
      const dark = i % 2 === 0;
      g.addColorStop(0, dark ? 'rgba(5, 7, 13, 0.42)' : 'rgba(28, 38, 62, 0.22)');
      g.addColorStop(1, 'rgba(14, 18, 30, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(gx, gy, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Multi-scale mineral aggregate grain
    for (let i = 0; i < 3600; i++) {
      const x = rng() * 512;
      const y = rng() * 512;
      const s = rng() > 0.82 ? 3 : 2;
      const pick = rng();
      if (pick < 0.08) {
        ctx.fillStyle = 'rgba(0, 240, 255, 0.08)';
      } else if (pick < 0.14) {
        ctx.fillStyle = 'rgba(255, 0, 90, 0.05)';
      } else if (pick < 0.55) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.045)';
      } else {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
      }
      ctx.fillRect(x, y, s, s);
    }

    // Specular rain puddles with subtle neon reflection tint
    const puddles = [
      { x: 138, y: 152, rx: 68, ry: 42, tint: 'rgba(0, 225, 255, 0.14)' },
      { x: 372, y: 348, rx: 78, ry: 48, tint: 'rgba(255, 20, 95, 0.12)' },
      { x: 392, y: 112, rx: 46, ry: 30, tint: 'rgba(120, 180, 255, 0.11)' },
      { x: 96, y: 404, rx: 54, ry: 34, tint: 'rgba(0, 240, 255, 0.10)' },
    ];
    for (const p of puddles) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.scale(1, p.ry / p.rx);
      const pg = ctx.createRadialGradient(0, 0, 4, 0, 0, p.rx);
      pg.addColorStop(0, 'rgba(6, 10, 20, 0.72)');
      pg.addColorStop(0.55, p.tint);
      pg.addColorStop(0.85, 'rgba(18, 28, 48, 0.35)');
      pg.addColorStop(1, 'rgba(14, 18, 30, 0)');
      ctx.fillStyle = pg;
      ctx.beginPath();
      ctx.arc(0, 0, p.rx, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Subtle expansion joints & asphalt micro-cracks
    ctx.strokeStyle = 'rgba(24, 33, 54, 0.72)';
    ctx.lineWidth = 2;
    for (let i = 0; i <= 512; i += 128) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, 512);
      ctx.moveTo(0, i);
      ctx.lineTo(512, i);
      ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(4, 6, 12, 0.75)';
    ctx.lineWidth = 1.5;
    for (let c = 0; c < 7; c++) {
      let cx = rng() * 512;
      let cy = rng() * 512;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      for (let s = 0; s < 6; s++) {
        cx += (rng() - 0.5) * 44;
        cy += (rng() - 0.5) * 44;
        ctx.lineTo(cx, cy);
      }
      ctx.stroke();
    }

    return this.register(key, canvas, repeatX, repeatY);
  }

  /**
   * Linear roughness map matching Cyber-Almaty's wet rain-slick asphalt:
   * Dark glossy puddles (roughness ~0.12) contrasted against gritty damp asphalt (~0.78).
   */
  getWetAsphaltRoughness(repeatX = 24, repeatY = 24): THREE.CanvasTexture {
    const key = `asphalt_roughness_${repeatX}_${repeatY}`;
    const existing = this.cache.get(key);
    if (existing) return existing;

    const [canvas, ctx] = createCanvas(512, 512);
    const rng = mulberry32(0x2077a2);

    // Base damp asphalt roughness (~0.76 -> rgb 194)
    ctx.fillStyle = 'rgb(194, 194, 194)';
    ctx.fillRect(0, 0, 512, 512);

    // Mineral aggregate micro-roughness noise
    for (let i = 0; i < 3200; i++) {
      const x = rng() * 512;
      const y = rng() * 512;
      const v = Math.floor(155 + rng() * 75);
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(x, y, 2, 2);
    }

    // Mirror-like dark puddles (low roughness ~0.10..0.22 -> rgb 26..56)
    const puddles = [
      { x: 138, y: 152, rx: 72, ry: 44 },
      { x: 372, y: 348, rx: 82, ry: 50 },
      { x: 392, y: 112, rx: 50, ry: 32 },
      { x: 96, y: 404, rx: 58, ry: 36 },
    ];
    for (const p of puddles) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.scale(1, p.ry / p.rx);
      const pg = ctx.createRadialGradient(0, 0, 6, 0, 0, p.rx);
      pg.addColorStop(0, 'rgb(24, 24, 24)');
      pg.addColorStop(0.62, 'rgb(42, 42, 42)');
      pg.addColorStop(0.86, 'rgb(120, 120, 120)');
      pg.addColorStop(1, 'rgba(194, 194, 194, 0)');
      ctx.fillStyle = pg;
      ctx.beginPath();
      ctx.arc(0, 0, p.rx, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Damp seams retain a thin film of water (slightly glossier)
    ctx.strokeStyle = 'rgb(92, 92, 92)';
    ctx.lineWidth = 3;
    for (let i = 0; i <= 512; i += 128) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, 512);
      ctx.moveTo(0, i);
      ctx.lineTo(512, i);
      ctx.stroke();
    }

    return this.register(key, canvas, repeatX, repeatY, THREE.NoColorSpace);
  }

  getRoadSurface(repeatX = 1, repeatY = 20): THREE.CanvasTexture {
    const key = `road_${repeatX}_${repeatY}`;
    const existing = this.cache.get(key);
    if (existing) return existing;

    const [canvas, ctx] = createCanvas(512, 512);
    const rng = mulberry32(0xab0a2077);

    ctx.fillStyle = '#0c101b';
    ctx.fillRect(0, 0, 512, 512);

    // Asphalt grain
    for (let i = 0; i < 2400; i++) {
      const x = rng() * 512;
      const y = rng() * 512;
      ctx.fillStyle = rng() > 0.5 ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.22)';
      ctx.fillRect(x, y, 2, 2);
    }

    // Tire wear polish tracks + rain-slick reflection bands
    const laneGlow = ctx.createLinearGradient(0, 0, 512, 0);
    laneGlow.addColorStop(0, 'rgba(0,240,255,0.09)');
    laneGlow.addColorStop(0.18, 'rgba(255,255,255,0.045)');
    laneGlow.addColorStop(0.35, 'rgba(0,0,0,0.14)');
    laneGlow.addColorStop(0.5, 'rgba(252,238,10,0.03)');
    laneGlow.addColorStop(0.65, 'rgba(0,0,0,0.14)');
    laneGlow.addColorStop(0.82, 'rgba(255,255,255,0.045)');
    laneGlow.addColorStop(1, 'rgba(0,240,255,0.09)');
    ctx.fillStyle = laneGlow;
    ctx.fillRect(0, 0, 512, 512);

    // Specular wet patches across road lanes
    for (let i = 0; i < 5; i++) {
      const px = 80 + rng() * 352;
      const py = rng() * 512;
      const g = ctx.createRadialGradient(px, py, 6, px, py, 56);
      g.addColorStop(0, 'rgba(0, 210, 255, 0.11)');
      g.addColorStop(1, 'rgba(12, 16, 27, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(px, py, 56, 0, Math.PI * 2);
      ctx.fill();
    }

    // Curb metallic shoulder + glowing cyber-cyan guide strips
    ctx.fillStyle = '#182236';
    ctx.fillRect(0, 0, 28, 512);
    ctx.fillRect(484, 0, 28, 512);

    ctx.save();
    ctx.shadowColor = '#00f0ff';
    ctx.shadowBlur = 12;
    ctx.fillStyle = '#00f0ff';
    ctx.fillRect(14, 0, 8, 512);
    ctx.fillRect(490, 0, 8, 512);
    ctx.fillStyle = '#d8ffff';
    ctx.fillRect(16, 0, 3, 512);
    ctx.fillRect(492, 0, 3, 512);
    ctx.restore();

    // Dashed yellow cyber-Almaty center divider with double-line glow
    ctx.save();
    ctx.shadowColor = '#fcee0a';
    ctx.shadowBlur = 8;
    ctx.fillStyle = '#fcee0a';
    for (let y = 16; y < 512; y += 64) {
      ctx.fillRect(247, y, 7, 36);
      ctx.fillRect(258, y, 7, 36);
    }
    ctx.restore();

    // Subtle transverse tar seams
    ctx.strokeStyle = 'rgba(4, 6, 12, 0.6)';
    ctx.lineWidth = 2;
    for (let y = 128; y < 512; y += 256) {
      ctx.beginPath();
      ctx.moveTo(28, y);
      ctx.lineTo(484, y);
      ctx.stroke();
    }

    return this.register(key, canvas, repeatX, repeatY);
  }

  getBuildingFacade(
    accentHex = '#00f0ff',
    darkHex = '#101627',
    repeatX = 2,
    repeatY = 4,
  ): THREE.CanvasTexture {
    const key = `facade_${accentHex}_${darkHex}_${repeatX}_${repeatY}`;
    const existing = this.cache.get(key);
    if (existing) return existing;

    const [canvas, ctx] = createCanvas(512, 512);
    const seed = hashString(key);
    const rng = mulberry32(seed);

    // Dark composite architectural cladding
    const wallGrad = ctx.createLinearGradient(0, 0, 512, 0);
    wallGrad.addColorStop(0, '#0a0f1c');
    wallGrad.addColorStop(0.5, darkHex);
    wallGrad.addColorStop(1, '#090d18');
    ctx.fillStyle = wallGrad;
    ctx.fillRect(0, 0, 512, 512);

    // Subtle vertical concrete/metal cladding panels
    ctx.strokeStyle = 'rgba(54, 72, 108, 0.35)';
    ctx.lineWidth = 2;
    for (let x = 0; x <= 512; x += 64) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 512);
      ctx.stroke();
    }

    // Horizontal floor ledges + weathered rain-grime streaks
    for (let row = 0; row < 8; row++) {
      const floorY = row * 64;
      ctx.fillStyle = '#1b2640';
      ctx.fillRect(0, floorY, 512, 6);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.fillRect(0, floorY + 6, 512, 4);

      // Subtle rain grime beneath ledge
      for (let g = 0; g < 6; g++) {
        const gx = 20 + rng() * 472;
        const gh = 10 + rng() * 28;
        ctx.fillStyle = 'rgba(4, 6, 12, 0.28)';
        ctx.fillRect(gx, floorY + 8, 3, gh);
      }

      // Detailed glowing & reflective multi-pane windows
      for (let col = 0; col < 6; col++) {
        const wx = 26 + col * 78;
        const wy = floorY + 14;
        const ww = 60;
        const wh = 40;

        // Outer window recess frame
        ctx.fillStyle = '#060911';
        ctx.fillRect(wx - 2, wy - 2, ww + 4, wh + 4);

        const state = rng();
        if (state < 0.22) {
          // Accent neon interior glow
          const wg = ctx.createLinearGradient(wx, wy, wx, wy + wh);
          wg.addColorStop(0, accentHex);
          wg.addColorStop(1, '#122238');
          ctx.save();
          ctx.globalAlpha = 0.88;
          ctx.fillStyle = wg;
          ctx.fillRect(wx, wy, ww, wh);
          ctx.restore();
        } else if (state < 0.48) {
          // Cool office white-cyan light
          const wg = ctx.createLinearGradient(wx, wy, wx, wy + wh);
          wg.addColorStop(0, '#dff5ff');
          wg.addColorStop(0.65, '#86bce0');
          wg.addColorStop(1, '#2a4766');
          ctx.save();
          ctx.globalAlpha = 0.62 + rng() * 0.22;
          ctx.fillStyle = wg;
          ctx.fillRect(wx, wy, ww, wh);
          ctx.restore();
        } else if (state < 0.60) {
          // Warm apartment amber-gold light
          const wg = ctx.createLinearGradient(wx, wy, wx, wy + wh);
          wg.addColorStop(0, '#ffe896');
          wg.addColorStop(0.7, '#d9912b');
          wg.addColorStop(1, '#42250e');
          ctx.save();
          ctx.globalAlpha = 0.72;
          ctx.fillStyle = wg;
          ctx.fillRect(wx, wy, ww, wh);
          ctx.restore();
        } else {
          // Dark reflective obsidian glass with faint diagonal night reflection
          const dg = ctx.createLinearGradient(wx, wy, wx + ww, wy + wh);
          dg.addColorStop(0, '#0c1628');
          dg.addColorStop(0.5, '#070b14');
          dg.addColorStop(1, '#132038');
          ctx.fillStyle = dg;
          ctx.fillRect(wx, wy, ww, wh);
        }

        // Venetian blinds or interior partition silhouette on lit windows
        if (state < 0.60) {
          ctx.fillStyle = 'rgba(6, 10, 18, 0.34)';
          const blindRows = Math.floor(rng() * 4);
          for (let b = 0; b < blindRows; b++) {
            ctx.fillRect(wx, wy + b * 6, ww, 3);
          }
          // Vertical window mullion
          ctx.fillStyle = 'rgba(8, 12, 22, 0.65)';
          ctx.fillRect(wx + ww * 0.5 - 1, wy, 2, wh);
        }
      }
    }

    // Kazakh-cyber architectural cornice accent band across middle floor
    drawKazakhCyberTrim(ctx, 20, 248, 472, 16, accentHex, 0.42);

    // Structural vertical steel ribs + neon light bar
    ctx.fillStyle = '#253352';
    ctx.fillRect(0, 0, 14, 512);
    ctx.fillRect(498, 0, 14, 512);

    ctx.save();
    ctx.shadowColor = accentHex;
    ctx.shadowBlur = 14;
    ctx.fillStyle = accentHex;
    ctx.fillRect(8, 0, 6, 512);
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = 0.65;
    ctx.fillRect(10, 0, 2, 512);
    ctx.restore();

    return this.register(key, canvas, repeatX, repeatY);
  }

  getWallPanel(stripeColor = '#ff003c', repeatX = 4, repeatY = 2): THREE.CanvasTexture {
    const key = `wall_${stripeColor}_${repeatX}_${repeatY}`;
    const existing = this.cache.get(key);
    if (existing) return existing;

    const [canvas, ctx] = createCanvas(512, 512);
    const rng = mulberry32(hashString(key));

    // Metallic armored wall base gradient
    const grad = ctx.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, '#1e273d');
    grad.addColorStop(0.45, '#2b3754');
    grad.addColorStop(0.85, '#1b2438');
    grad.addColorStop(1, '#121827');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 512);

    // Subtle brushed metal horizontal grain
    for (let i = 0; i < 420; i++) {
      const y = rng() * 512;
      ctx.fillStyle = rng() > 0.5 ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.05)';
      ctx.fillRect(0, y, 512, 1.5);
    }

    // Metallic armor seams & bevels (evolved from Bolt 1)
    ctx.strokeStyle = '#475980';
    ctx.lineWidth = 5;
    ctx.strokeRect(12, 12, 488, 488);
    ctx.strokeStyle = '#101624';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(256, 12);
    ctx.lineTo(256, 500);
    ctx.moveTo(12, 366);
    ctx.lineTo(500, 366);
    ctx.stroke();

    // Recessed ventilation louver block on upper panel
    ctx.fillStyle = '#0d1320';
    ctx.fillRect(36, 46, 194, 48);
    ctx.fillStyle = '#24314c';
    for (let v = 0; v < 6; v++) {
      ctx.fillRect(44, 52 + v * 7, 178, 3);
    }

    // Subtle Kazakh-cyber geometric inlay strip above LED trim
    drawKazakhCyberTrim(ctx, 20, 382, 472, 24, stripeColor, 0.36);

    // Glowing architectural stripe near bottom
    ctx.save();
    ctx.shadowColor = stripeColor;
    ctx.shadowBlur = 14;
    ctx.fillStyle = stripeColor;
    ctx.fillRect(16, 420, 480, 12);
    ctx.fillStyle = 'rgba(255,255,255,0.58)';
    ctx.fillRect(16, 420, 480, 4);
    ctx.restore();

    // Kickplate weathering / dark grime at bottom edge
    const grime = ctx.createLinearGradient(0, 456, 0, 512);
    grime.addColorStop(0, 'rgba(6, 9, 16, 0)');
    grime.addColorStop(1, 'rgba(6, 9, 16, 0.62)');
    ctx.fillStyle = grime;
    ctx.fillRect(0, 456, 512, 56);

    // Micro-bolts
    ctx.fillStyle = '#6074a1';
    for (const bx of [28, 240, 272, 484]) {
      for (const by of [28, 350, 484]) {
        ctx.fillRect(bx - 3, by - 3, 6, 6);
        ctx.fillStyle = '#121826';
        ctx.fillRect(bx - 1, by - 1, 2, 2);
        ctx.fillStyle = '#6074a1';
      }
    }

    return this.register(key, canvas, repeatX, repeatY);
  }

  getServerRack(): THREE.CanvasTexture {
    const key = 'server_rack';
    const existing = this.cache.get(key);
    if (existing) return existing;

    const [canvas, ctx] = createCanvas(512, 512);
    ctx.fillStyle = '#080b14';
    ctx.fillRect(0, 0, 512, 512);

    // Heavy anodized chassis frame
    ctx.strokeStyle = '#2a3754';
    ctx.lineWidth = 8;
    ctx.strokeRect(4, 4, 504, 504);

    // Left fiber-optic cable management spine
    ctx.fillStyle = '#0d1322';
    ctx.fillRect(14, 14, 34, 484);
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(26, 20);
    ctx.lineTo(26, 492);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255, 0, 60, 0.28)';
    ctx.beginPath();
    ctx.moveTo(36, 20);
    ctx.lineTo(36, 492);
    ctx.stroke();

    // 16 high-density mainframe blades
    for (let row = 0; row < 16; row++) {
      const y = 16 + row * 30;
      ctx.fillStyle = '#131a2b';
      ctx.fillRect(58, y, 434, 24);
      ctx.strokeStyle = '#1f2b45';
      ctx.lineWidth = 1;
      ctx.strokeRect(58, y, 434, 24);

      // Airflow vent louvers
      ctx.fillStyle = '#060911';
      for (let v = 0; v < 14; v++) {
        ctx.fillRect(70 + v * 18, y + 6, 11, 12);
      }

      // Telemetry activity LEDs with soft glow
      for (let led = 0; led < 6; led++) {
        const hash = (row * 13 + led * 7) % 11;
        let color = '#1e283b';
        if (hash < 4) color = '#00f0ff';
        else if (hash < 7) color = '#ff003c';
        else if (hash === 7) color = '#fcee0a';

        ctx.save();
        if (color !== '#1e283b') {
          ctx.shadowColor = color;
          ctx.shadowBlur = 8;
        }
        ctx.fillStyle = color;
        ctx.fillRect(352 + led * 22, y + 7, 12, 10);
        ctx.restore();
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
    const bgGrad = ctx.createLinearGradient(0, 0, 1024, 256);
    bgGrad.addColorStop(0, bg);
    bgGrad.addColorStop(0.5, '#0c1122');
    bgGrad.addColorStop(1, bg);
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, 1024, 256);

    // Subtle holographic scanlines
    ctx.fillStyle = 'rgba(255,255,255,0.032)';
    for (let y = 0; y < 256; y += 5) {
      ctx.fillRect(0, y, 1024, 2);
    }

    // Subtle Kazakh-cyber top/bottom micro-trim
    drawKazakhCyberTrim(ctx, 84, 22, 760, 14, secondaryColor, 0.25);

    // Angled cyberpunk neon frame
    ctx.save();
    ctx.shadowColor = primaryColor;
    ctx.shadowBlur = 16;
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
    ctx.restore();

    // Vertical glowing accent bar
    ctx.save();
    ctx.shadowColor = primaryColor;
    ctx.shadowBlur = 14;
    ctx.fillStyle = primaryColor;
    ctx.fillRect(42, 42, 14, 170);
    ctx.restore();

    // Main title (double-pass neon halo + crisp core)
    ctx.save();
    ctx.shadowColor = primaryColor;
    ctx.shadowBlur = 26;
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 66px "Segoe UI", Impact, "Arial Black", sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(title, 82, 104);
    ctx.restore();

    // Subtitle
    ctx.save();
    ctx.shadowColor = secondaryColor;
    ctx.shadowBlur = 14;
    ctx.fillStyle = secondaryColor;
    ctx.font = '700 30px "Consolas", "Courier New", monospace';
    ctx.fillText(subtitle, 84, 186);
    ctx.restore();

    // Tech barcode + telemetry block on right
    ctx.fillStyle = primaryColor;
    for (let i = 0; i < 12; i++) {
      const w = i % 3 === 0 ? 8 : 4;
      ctx.fillRect(876 + i * 9, 44, w, 46);
    }
    ctx.fillStyle = secondaryColor;
    ctx.globalAlpha = 0.7;
    ctx.fillRect(876, 104, 104, 5);
    ctx.fillRect(876, 118, 68, 5);
    ctx.globalAlpha = 1;

    return this.register(key, canvas, 1, 1);
  }

  getAlmatyMountainSkyline(): THREE.CanvasTexture {
    const key = 'almaty_mountains';
    const existing = this.cache.get(key);
    if (existing) return existing;

    const [canvas, ctx] = createCanvas(1024, 512);
    const rng = mulberry32(0x0727a1);

    // Cyberpunk alpine night gradient (deep space indigo -> ultraviolet -> crimson-violet city bounce)
    const sky = ctx.createLinearGradient(0, 0, 0, 512);
    sky.addColorStop(0, '#030510');
    sky.addColorStop(0.42, '#0d0924');
    sky.addColorStop(0.76, '#230d32');
    sky.addColorStop(1, '#3d0e30');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, 1024, 512);

    // Crisp alpine stars
    for (let i = 0; i < 130; i++) {
      const sx = rng() * 1024;
      const sy = rng() * 215;
      const alpha = 0.35 + rng() * 0.65;
      ctx.fillStyle = `rgba(215, 242, 255, ${alpha.toFixed(2)})`;
      ctx.fillRect(sx, sy, rng() > 0.8 ? 2.5 : 1.5, rng() > 0.8 ? 2.5 : 1.5);
    }

    // Far Zailiyskiy Alatau high glacial peaks
    const farPeaks: [number, number][] = [
      [0, 320], [82, 224], [156, 268], [248, 162], [336, 232],
      [448, 134], [546, 212], [652, 148], [768, 226], [872, 174], [964, 242], [1024, 286],
    ];
    ctx.beginPath();
    ctx.moveTo(0, 512);
    for (const [px, py] of farPeaks) ctx.lineTo(px, py);
    ctx.lineTo(1024, 512);
    ctx.closePath();
    const farGrad = ctx.createLinearGradient(0, 130, 0, 460);
    farGrad.addColorStop(0, '#2c4275');
    farGrad.addColorStop(0.35, '#172344');
    farGrad.addColorStop(1, '#090d1c');
    ctx.fillStyle = farGrad;
    ctx.fill();

    // Moonlit snow cap facets on far peaks
    ctx.strokeStyle = 'rgba(130, 238, 255, 0.52)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    farPeaks.forEach(([px, py], idx) => {
      if (idx === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();

    // Near dark rocky foothills & Kok-Tobe ridge
    const nearPeaks: [number, number][] = [
      [0, 382], [120, 314], [240, 344], [385, 276], [510, 326],
      [645, 284], [790, 296], [890, 252], [978, 304], [1024, 340],
    ];
    ctx.beginPath();
    ctx.moveTo(0, 512);
    for (const [px, py] of nearPeaks) ctx.lineTo(px, py);
    ctx.lineTo(1024, 512);
    ctx.closePath();
    const nearGrad = ctx.createLinearGradient(0, 250, 0, 512);
    nearGrad.addColorStop(0, '#121a33');
    nearGrad.addColorStop(1, '#060914');
    ctx.fillStyle = nearGrad;
    ctx.fill();

    // Iconic Kok-Tobe TV Tower silhouette on the right ridge
    const tx = 890;
    const baseY = 256;
    ctx.fillStyle = '#0c1324';
    ctx.fillRect(tx - 4, baseY - 94, 8, 94);
    ctx.fillRect(tx - 12, baseY - 62, 24, 14);
    ctx.fillRect(tx - 8, baseY - 40, 16, 9);
    ctx.fillStyle = '#00f0ff';
    ctx.fillRect(tx - 10, baseY - 58, 20, 3);
    ctx.save();
    ctx.shadowColor = '#ff003c';
    ctx.shadowBlur = 12;
    ctx.fillStyle = '#ff003c';
    ctx.fillRect(tx - 2, baseY - 102, 4, 10);
    ctx.restore();

    // Distant Cyber-Almaty skyline belt & neon haze along the valley floor
    for (let i = 0; i < 42; i++) {
      const bx = i * 25 + (i % 3) * 3;
      const bw = 14 + (i % 4) * 5;
      const bh = 38 + ((i * 29) % 72);
      const by = 512 - bh;
      ctx.fillStyle = '#060812';
      ctx.fillRect(bx, by, bw, bh);
      // Tiny glowing windows
      ctx.fillStyle = i % 5 === 0 ? '#ff003c' : i % 3 === 0 ? '#00f0ff' : 'rgba(252,238,10,0.65)';
      ctx.fillRect(bx + 3, by + 6, bw - 6, 3);
      for (let wy = by + 16; wy < 504; wy += 10) {
        if ((bx + wy) % 3 === 0) {
          ctx.fillStyle = 'rgba(180, 230, 255, 0.45)';
          ctx.fillRect(bx + 3, wy, 4, 4);
        }
      }
    }

    // Warm magenta-cyan metropolitan glow at the base
    const haze = ctx.createLinearGradient(0, 390, 0, 512);
    haze.addColorStop(0, 'rgba(255, 0, 80, 0)');
    haze.addColorStop(1, 'rgba(255, 0, 80, 0.28)');
    ctx.fillStyle = haze;
    ctx.fillRect(0, 390, 1024, 122);

    return this.register(key, canvas, 1, 1);
  }

  /** Bolt 1 cyberpunk megastructure city skyline (upgraded with layered depth & beacons). */
  getCitySkyline(): THREE.CanvasTexture {
    const key = 'city_skyline';
    const existing = this.cache.get(key);
    if (existing) return existing;

    const [canvas, ctx] = createCanvas(1024, 512);
    const sky = ctx.createLinearGradient(0, 0, 0, 512);
    sky.addColorStop(0, '#040610');
    sky.addColorStop(0.55, '#120821');
    sky.addColorStop(0.85, '#2b0922');
    sky.addColorStop(1, '#4a0c26');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, 1024, 512);

    // Distant background haze megablocks
    ctx.fillStyle = '#0e1124';
    for (let i = 0; i < 14; i++) {
      const bx = i * 76 + 8;
      const bh = 180 + ((i * 61) % 210);
      ctx.fillRect(bx, 512 - bh, 58, bh);
    }

    // Foreground megastructures (evolved from Bolt 1)
    const buildings = [
      { x: 20, w: 90, h: 310, color: '#090b16', neon: '#ff003c' },
      { x: 120, w: 70, h: 250, color: '#0b0e1c', neon: '#00f0ff' },
      { x: 200, w: 125, h: 390, color: '#070912', neon: '#fcee0a' },
      { x: 340, w: 85, h: 290, color: '#0a0d1a', neon: '#ff003c' },
      { x: 440, w: 150, h: 430, color: '#060811', neon: '#00f0ff' },
      { x: 605, w: 100, h: 320, color: '#090c17', neon: '#ff003c' },
      { x: 720, w: 130, h: 380, color: '#080b14', neon: '#fcee0a' },
      { x: 865, w: 135, h: 350, color: '#070a13', neon: '#00f0ff' },
    ];

    for (const b of buildings) {
      const y = 512 - b.h;
      ctx.fillStyle = b.color;
      ctx.fillRect(b.x, y, b.w, b.h);

      // Rooftop antenna & warning beacon
      ctx.fillStyle = '#182238';
      ctx.fillRect(b.x + b.w * 0.5 - 2, y - 24, 4, 24);
      ctx.fillStyle = '#ff003c';
      ctx.fillRect(b.x + b.w * 0.5 - 3, y - 28, 6, 6);

      // Vertical neon strip
      ctx.save();
      ctx.shadowColor = b.neon;
      ctx.shadowBlur = 10;
      ctx.fillStyle = b.neon;
      ctx.fillRect(b.x + 6, y + 12, 4, b.h - 40);
      ctx.fillRect(b.x + b.w - 10, y + 12, 4, 62);
      ctx.restore();

      // Lit windows
      for (let wy = y + 26; wy < 490; wy += 16) {
        for (let wx = b.x + 18; wx < b.x + b.w - 18; wx += 14) {
          const hash = (wx * 17 + wy * 31) % 19;
          if (hash < 4) {
            ctx.fillStyle = hash === 0 ? b.neon : 'rgba(200, 230, 255, 0.52)';
            ctx.fillRect(wx, wy, 7, 6);
          }
        }
      }
    }

    // Horizon crimson smog haze
    const haze = ctx.createLinearGradient(0, 360, 0, 512);
    haze.addColorStop(0, 'rgba(255,0,60,0)');
    haze.addColorStop(1, 'rgba(255,0,60,0.36)');
    ctx.fillStyle = haze;
    ctx.fillRect(0, 360, 1024, 152);

    return this.register(key, canvas, 1, 1);
  }

  /**
   * Dark vertical skyscraper monolith sign "SECURE YOUR SOUL // ХУЕШИ"
   * modeled after the rooftop reference monolith overlooking the cyberpunk skyline.
   */
  getSecureYourSoulBanner(): THREE.CanvasTexture {
    const key = 'banner_secure_your_soul';
    const existing = this.cache.get(key);
    if (existing) return existing;

    const [canvas, ctx] = createCanvas(512, 1024);

    // Deep obsidian-teal monolith glass facade gradient
    const bg = ctx.createLinearGradient(0, 0, 512, 1024);
    bg.addColorStop(0, '#060c13');
    bg.addColorStop(0.35, '#0b1924');
    bg.addColorStop(0.7, '#08131d');
    bg.addColorStop(1, '#04090f');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 512, 1024);

    // Subtle glass curtain-wall seams
    ctx.strokeStyle = 'rgba(72, 150, 180, 0.14)';
    ctx.lineWidth = 2;
    for (let y = 64; y < 1024; y += 64) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(512, y);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(42, 0);
    ctx.lineTo(42, 1024);
    ctx.moveTo(470, 0);
    ctx.lineTo(470, 1024);
    ctx.stroke();

    // Diagonal atmospheric specular sheen across the obsidian monolith
    const sheen = ctx.createLinearGradient(0, 120, 512, 680);
    sheen.addColorStop(0, 'rgba(130, 225, 255, 0)');
    sheen.addColorStop(0.45, 'rgba(110, 215, 240, 0.075)');
    sheen.addColorStop(0.55, 'rgba(160, 238, 255, 0.03)');
    sheen.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = sheen;
    ctx.fillRect(0, 0, 512, 1024);

    // Subtle glowing cyan-teal monolith vertical edge trim
    ctx.save();
    ctx.shadowColor = '#00d8ff';
    ctx.shadowBlur = 16;
    ctx.fillStyle = 'rgba(0, 216, 255, 0.55)';
    ctx.fillRect(10, 18, 5, 988);
    ctx.fillRect(497, 18, 5, 988);
    ctx.restore();

    // Minimalist white corporate biochip sigil at top center (matching reference monolith)
    ctx.save();
    ctx.translate(256, 178);
    ctx.shadowColor = '#8ceeff';
    ctx.shadowBlur = 18;
    ctx.strokeStyle = '#e8f7ff';
    ctx.lineWidth = 6;
    ctx.strokeRect(-26, -34, 52, 68);
    ctx.fillStyle = '#e8f7ff';
    ctx.fillRect(-10, -18, 20, 12);
    ctx.fillRect(-10, 2, 20, 22);
    ctx.fillStyle = '#ff003c';
    ctx.fillRect(-4, 8, 8, 10);
    ctx.restore();

    // Centerpiece typography: SECURE / YOUR SOUL
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = '#7ae8ff';
    ctx.shadowBlur = 22;
    ctx.fillStyle = '#eef9ff';
    ctx.font = '800 74px "Segoe UI", "Helvetica Neue", Arial, sans-serif';
    ctx.fillText('SECURE', 256, 368);
    ctx.font = '700 62px "Segoe UI", "Helvetica Neue", Arial, sans-serif';
    ctx.fillText('YOUR SOUL', 256, 444);
    ctx.restore();

    // Razor-thin divider line
    ctx.fillStyle = 'rgba(140, 235, 255, 0.55)';
    ctx.fillRect(72, 510, 368, 3);

    // Sub-brand: ХУЕШИ // MARAKULIN CORP
    ctx.save();
    ctx.textAlign = 'center';
    ctx.shadowColor = '#ff003c';
    ctx.shadowBlur = 18;
    ctx.fillStyle = '#ff2454';
    ctx.font = '900 54px "Segoe UI", Impact, "Arial Black", sans-serif';
    ctx.fillText('ХУЕШИ', 256, 588);
    ctx.restore();

    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#8ec8dd';
    ctx.font = '700 22px "Consolas", "Courier New", monospace';
    ctx.fillText('MARAKULIN CORP // RELIC PROGRAM', 256, 650);
    ctx.fillStyle = 'rgba(190, 230, 245, 0.65)';
    ctx.font = '600 18px "Consolas", "Courier New", monospace';
    ctx.fillText('DIGITAL IMMORTALITY // ALMATY 2077', 256, 686);
    ctx.restore();

    // Subtle Kazakh-cyber geometric ornament band + telemetry block near base
    drawKazakhCyberTrim(ctx, 56, 764, 400, 26, '#00e5ff', 0.42);

    ctx.fillStyle = 'rgba(255, 0, 60, 0.72)';
    ctx.fillRect(76, 836, 360, 8);
    ctx.fillStyle = 'rgba(210, 245, 255, 0.35)';
    for (let i = 0; i < 22; i++) {
      const w = i % 4 === 0 ? 10 : 4;
      ctx.fillRect(88 + i * 15, 868, w, 34);
    }

    // Subtle dark fog fade at very bottom for skyscraper base blending
    const baseFade = ctx.createLinearGradient(0, 910, 0, 1024);
    baseFade.addColorStop(0, 'rgba(4, 9, 15, 0)');
    baseFade.addColorStop(1, 'rgba(4, 9, 15, 0.85)');
    ctx.fillStyle = baseFade;
    ctx.fillRect(0, 910, 512, 114);

    return this.register(key, canvas, 1, 1);
  }

  /** Bolt 1 medical ECG & Soulkiller v4.2 console monitor textures. */
  getMedicalMonitor(mode: 'ecg' | 'soulkiller'): THREE.CanvasTexture {
    const key = `monitor_${mode}`;
    const existing = this.cache.get(key);
    if (existing) return existing;

    const [canvas, ctx] = createCanvas(512, 256);
    ctx.fillStyle = '#040a10';
    ctx.fillRect(0, 0, 512, 256);

    const frameColor = mode === 'ecg' ? '#00f0ff' : '#ff003c';
    ctx.strokeStyle = frameColor;
    ctx.lineWidth = 4;
    ctx.strokeRect(6, 6, 500, 244);

    // Telemetry grid
    ctx.strokeStyle = mode === 'ecg' ? 'rgba(0, 240, 255, 0.14)' : 'rgba(255, 0, 60, 0.18)';
    ctx.lineWidth = 1;
    for (let x = 24; x < 512; x += 24) {
      ctx.beginPath();
      ctx.moveTo(x, 8);
      ctx.lineTo(x, 248);
      ctx.stroke();
    }
    for (let y = 24; y < 256; y += 24) {
      ctx.beginPath();
      ctx.moveTo(8, y);
      ctx.lineTo(504, y);
      ctx.stroke();
    }

    if (mode === 'ecg') {
      ctx.fillStyle = '#00f0ff';
      ctx.font = '700 22px monospace';
      ctx.fillText('SUBJECT: SAMIR // TRAUMA LEVEL: CRITICAL', 20, 36);
      ctx.fillStyle = '#ff003c';
      ctx.fillText('HR: 48 BPM   NEURAL SYNC: LOCKED', 20, 232);

      // Glowing heartbeat trace
      ctx.save();
      ctx.shadowColor = '#00f0ff';
      ctx.shadowBlur = 12;
      ctx.strokeStyle = '#00f0ff';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(20, 140);
      ctx.lineTo(130, 140);
      ctx.lineTo(148, 120);
      ctx.lineTo(164, 155);
      ctx.lineTo(182, 58);
      ctx.lineTo(198, 195);
      ctx.lineTo(216, 140);
      ctx.lineTo(350, 140);
      ctx.lineTo(368, 120);
      ctx.lineTo(384, 155);
      ctx.lineTo(402, 58);
      ctx.lineTo(418, 195);
      ctx.lineTo(436, 140);
      ctx.lineTo(492, 140);
      ctx.stroke();
      ctx.restore();
    } else {
      ctx.save();
      ctx.shadowColor = '#ff003c';
      ctx.shadowBlur = 12;
      ctx.fillStyle = '#ff003c';
      ctx.font = '900 32px monospace';
      ctx.fillText('SOULKILLER v4.2', 24, 48);
      ctx.restore();

      ctx.fillStyle = '#fcee0a';
      ctx.font = '700 20px monospace';
      ctx.fillText('OPERATOR: RODION // MARAKULIN CORP', 24, 84);
      ctx.fillStyle = '#00f0ff';
      ctx.font = '700 18px monospace';
      ctx.fillText('TARGET ENGRAM: SAMIR', 24, 122);
      ctx.fillText('PROTOCOL: FULL CONSCIOUSNESS EXTRACTION', 24, 152);
      ctx.fillStyle = '#ff003c';
      ctx.fillRect(24, 182, 464, 28);
      ctx.fillStyle = '#040a10';
      ctx.font = '900 18px monospace';
      ctx.fillText('>>> READY TO INITIATE NEURAL RIP <<<', 52, 202);
    }

    // Subtle CRT scanlines
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    for (let y = 0; y < 256; y += 4) {
      ctx.fillRect(0, y, 512, 1);
    }

    return this.register(key, canvas, 1, 1);
  }

  getHuyeshiMonitor(): THREE.CanvasTexture {
    const key = 'monitor_huyeshi';
    const existing = this.cache.get(key);
    if (existing) return existing;

    const [canvas, ctx] = createCanvas(512, 256);
    ctx.fillStyle = '#040911';
    ctx.fillRect(0, 0, 512, 256);

    // Background telemetry grid
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.12)';
    ctx.lineWidth = 1;
    for (let x = 24; x < 512; x += 24) {
      ctx.beginPath();
      ctx.moveTo(x, 8);
      ctx.lineTo(x, 248);
      ctx.stroke();
    }
    for (let y = 24; y < 256; y += 24) {
      ctx.beginPath();
      ctx.moveTo(8, y);
      ctx.lineTo(504, y);
      ctx.stroke();
    }

    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 4;
    ctx.strokeRect(6, 6, 500, 244);

    ctx.save();
    ctx.shadowColor = '#ff003c';
    ctx.shadowBlur = 12;
    ctx.fillStyle = '#ff003c';
    ctx.font = '900 30px monospace';
    ctx.fillText('ХУЕШИ // CORE v2.077', 24, 48);
    ctx.restore();

    ctx.fillStyle = '#00f0ff';
    ctx.font = '700 18px monospace';
    ctx.fillText('HOST: АИ (АМИР)  |  ENGRAM: САМИР', 24, 92);
    ctx.fillText('PROTOCOL: NEURAL CONSCIOUSNESS SPLIT', 24, 126);
    ctx.fillStyle = '#fcee0a';
    ctx.fillText('STATUS: READY FOR JACK-IN', 24, 168);

    // Neural waveform accent on right
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < 12; i++) {
      const wx = 344 + i * 12;
      const wy = 160 + Math.sin(i * 1.4) * 14;
      if (i === 0) ctx.moveTo(wx, wy);
      else ctx.lineTo(wx, wy);
    }
    ctx.stroke();

    ctx.save();
    ctx.shadowColor = '#00f0ff';
    ctx.shadowBlur = 12;
    ctx.fillStyle = '#00f0ff';
    ctx.fillRect(24, 196, 464, 26);
    ctx.restore();

    ctx.fillStyle = '#040911';
    ctx.font = '900 18px monospace';
    ctx.fillText('>>> CONNECT TO BLACKWALL <<<', 96, 215);

    // CRT scanlines
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    for (let y = 0; y < 256; y += 4) {
      ctx.fillRect(0, y, 512, 1);
    }

    return this.register(key, canvas, 1, 1);
  }

  dispose(): void {
    for (const tex of this.cache.values()) {
      tex.dispose();
    }
    this.cache.clear();
  }
}

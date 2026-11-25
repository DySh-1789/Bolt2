import './ui/styles.css';
import { Engine } from './engine/Engine';
import { StoryDirector } from './game/StoryDirector';

function bootstrap(): void {
  const viewport = document.getElementById('game-viewport');
  if (!viewport) {
    throw new Error('Missing #game-viewport mount container');
  }

  const engine = new Engine(viewport);
  const director = new StoryDirector(engine, viewport);

  let lastTime: number | null = null;
  let rafId = 0;

  let disposed = false;

  const frame = (now: number): void => {
    if (disposed) return;
    rafId = window.requestAnimationFrame(frame);
    const dt = lastTime === null ? 0 : Math.max(0, (now - lastTime) / 1000);
    lastTime = now;
    try {
      director.update(dt);
    } catch (err) {
      console.error('[BOLT 2] Frame update error recovered:', err);
    }
  };

  rafId = window.requestAnimationFrame(frame);

  window.addEventListener('beforeunload', () => {
    disposed = true;
    window.cancelAnimationFrame(rafId);
    director.dispose();
    engine.dispose();
  });
}

bootstrap();

export interface InputSnapshot {
  moveForward: number;
  moveRight: number;
  jumpPressed: boolean;
  spaceHeld: boolean;
  dashPressed: boolean;
  shiftHeld: boolean;
  fireHeld: boolean;
  firePressed: boolean;
  aimHeld: boolean;
  aimPressed: boolean;
  reloadPressed: boolean;
  sandevistanPressed: boolean;
  meleePressed: boolean;
  interactPressed: boolean;
  healPressed: boolean;
  summonCarPressed: boolean;
  autopilotPressed: boolean;
  cameraTogglePressed: boolean;
  mapTogglePressed: boolean;
  weaponSlotKey: number | null; // 1..5
  wheelDelta: number;
  choiceKey: '1' | '2' | '3' | null;
  mouseDeltaX: number;
  mouseDeltaY: number;
}

export class InputManager {
  private keys = new Set<string>();
  private justPressed = new Set<string>();
  private mouseDown = false;
  private mouseJustPressed = false;
  private rightMouseDown = false;
  private rightMouseJustPressed = false;
  private accumMouseX = 0;
  private accumMouseY = 0;
  private accumWheel = 0;
  private locked = false;
  private sensitivity = 0.0021;
  private targetEl: HTMLElement;
  private onLockChange?: (locked: boolean) => void;
  private onEscapePressed?: () => void;
  private onViewportClick?: () => void;
  private onMapKey?: () => void;
  private lastUnlockTime = -1000;

  constructor(
    targetEl: HTMLElement,
    callbacks?: {
      onLockChange?: (locked: boolean) => void;
      onEscapePressed?: () => void;
      onViewportClick?: () => void;
      onMapKey?: () => void;
    },
  ) {
    this.targetEl = targetEl;
    this.onLockChange = callbacks?.onLockChange;
    this.onEscapePressed = callbacks?.onEscapePressed;
    this.onViewportClick = callbacks?.onViewportClick;
    this.onMapKey = callbacks?.onMapKey;
    this.bindEvents();
  }

  private bindEvents(): void {
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('mousemove', this.handleMouseMove);
    window.addEventListener('mousedown', this.handleMouseDown);
    window.addEventListener('mouseup', this.handleMouseUp);
    window.addEventListener('wheel', this.handleWheel, { passive: true });
    window.addEventListener('contextmenu', this.handleContextMenu);
    window.addEventListener('blur', this.handleBlur);
    document.addEventListener('pointerlockchange', this.handlePointerLockChange);
    this.targetEl.addEventListener('click', this.handleViewportClick);
  }

  private handleViewportClick = (): void => {
    if (!this.locked) {
      this.onViewportClick?.();
    }
  };

  private handleContextMenu = (e: MouseEvent): void => {
    if (this.locked || e.target === this.targetEl || this.targetEl.contains(e.target as Node)) {
      e.preventDefault();
    }
  };

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'Escape') {
      if (!this.locked && performance.now() - this.lastUnlockTime > 150) {
        this.onEscapePressed?.();
      }
      return;
    }

    if (e.code === 'KeyM' || e.code === 'Tab') {
      e.preventDefault();
      if (!e.repeat) {
        this.onMapKey?.();
      }
      return;
    }

    if (!this.keys.has(e.code)) {
      this.justPressed.add(e.code);
    }
    this.keys.add(e.code);

    if (this.locked && ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
      e.preventDefault();
    }
  };

  private handleKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private handleMouseMove = (e: MouseEvent): void => {
    if (!this.locked) return;
    const dx = Math.max(-180, Math.min(180, e.movementX));
    const dy = Math.max(-180, Math.min(180, e.movementY));
    this.accumMouseX += dx * this.sensitivity;
    this.accumMouseY += dy * this.sensitivity;
  };

  private handleMouseDown = (e: MouseEvent): void => {
    if (!this.locked) return;
    if (e.button === 0) {
      this.mouseDown = true;
      this.mouseJustPressed = true;
    } else if (e.button === 2) {
      this.rightMouseDown = true;
      this.rightMouseJustPressed = true;
    }
  };

  private handleMouseUp = (e: MouseEvent): void => {
    if (e.button === 0) {
      this.mouseDown = false;
    } else if (e.button === 2) {
      this.rightMouseDown = false;
    }
  };

  private handleWheel = (e: WheelEvent): void => {
    if (!this.locked) return;
    this.accumWheel += Math.sign(e.deltaY);
  };

  private handleBlur = (): void => {
    this.clearAll();
  };

  private clearAll(): void {
    this.keys.clear();
    this.justPressed.clear();
    this.mouseDown = false;
    this.mouseJustPressed = false;
    this.rightMouseDown = false;
    this.rightMouseJustPressed = false;
    this.accumMouseX = 0;
    this.accumMouseY = 0;
    this.accumWheel = 0;
  }

  private handlePointerLockChange = (): void => {
    const wasLocked = this.locked;
    this.locked = document.pointerLockElement === this.targetEl;
    if (!this.locked) {
      if (wasLocked) {
        this.lastUnlockTime = performance.now();
      }
      this.clearAll();
    }
    this.onLockChange?.(this.locked);
  };

  requestPointerLock(): void {
    try {
      if (document.pointerLockElement !== this.targetEl) {
        const res = this.targetEl.requestPointerLock() as unknown as Promise<void> | undefined;
        if (res && typeof res.catch === 'function') {
          res.catch(() => {
            // Safe to ignore if browser blocks outside gesture
          });
        }
      }
    } catch {
      // Ignore in unsupported environments
    }
  }

  exitPointerLock(): void {
    try {
      if (document.pointerLockElement) {
        document.exitPointerLock();
      }
    } catch {
      // Ignore
    }
  }

  isPointerLocked(): boolean {
    return this.locked;
  }

  setSensitivity(multiplier: number): void {
    this.sensitivity = 0.0021 * Math.max(0.25, Math.min(3.0, multiplier));
  }

  consumeSnapshot(): InputSnapshot {
    const moveForward =
      (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0) -
      (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0);
    const moveRight =
      (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0) -
      (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0);

    let choiceKey: '1' | '2' | '3' | null = null;
    if (this.justPressed.has('Digit1') || this.justPressed.has('Numpad1')) choiceKey = '1';
    else if (this.justPressed.has('Digit2') || this.justPressed.has('Numpad2')) choiceKey = '2';
    else if (this.justPressed.has('Digit3') || this.justPressed.has('Numpad3')) choiceKey = '3';

    let weaponSlotKey: number | null = null;
    if (this.justPressed.has('Digit1')) weaponSlotKey = 1;
    else if (this.justPressed.has('Digit2')) weaponSlotKey = 2;
    else if (this.justPressed.has('Digit3')) weaponSlotKey = 3;
    else if (this.justPressed.has('Digit4')) weaponSlotKey = 4;
    else if (this.justPressed.has('Digit5')) weaponSlotKey = 5;

    const snapshot: InputSnapshot = {
      moveForward,
      moveRight,
      jumpPressed: this.justPressed.has('Space'),
      spaceHeld: this.keys.has('Space'),
      dashPressed: this.justPressed.has('ShiftLeft') || this.justPressed.has('ShiftRight'),
      shiftHeld: this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'),
      fireHeld: this.mouseDown,
      firePressed: this.mouseJustPressed,
      aimHeld: this.rightMouseDown,
      aimPressed: this.rightMouseJustPressed,
      reloadPressed: this.justPressed.has('KeyR'),
      sandevistanPressed: this.justPressed.has('KeyQ'),
      meleePressed: this.justPressed.has('KeyF'),
      interactPressed: this.justPressed.has('KeyE'),
      healPressed: this.justPressed.has('KeyX') || this.justPressed.has('KeyH'),
      summonCarPressed: this.justPressed.has('KeyC'),
      autopilotPressed: this.justPressed.has('KeyG'),
      cameraTogglePressed: this.justPressed.has('KeyV'),
      mapTogglePressed: this.justPressed.has('KeyM') || this.justPressed.has('Tab'),
      weaponSlotKey,
      wheelDelta: this.accumWheel,
      choiceKey,
      mouseDeltaX: this.accumMouseX,
      mouseDeltaY: this.accumMouseY,
    };

    this.justPressed.clear();
    this.mouseJustPressed = false;
    this.rightMouseJustPressed = false;
    this.accumMouseX = 0;
    this.accumMouseY = 0;
    this.accumWheel = 0;

    return snapshot;
  }

  clearTransient(): void {
    this.justPressed.clear();
    this.mouseJustPressed = false;
    this.rightMouseJustPressed = false;
    this.rightMouseDown = false;
    this.accumMouseX = 0;
    this.accumMouseY = 0;
    this.accumWheel = 0;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('mousemove', this.handleMouseMove);
    window.removeEventListener('mousedown', this.handleMouseDown);
    window.removeEventListener('mouseup', this.handleMouseUp);
    window.removeEventListener('wheel', this.handleWheel);
    window.removeEventListener('contextmenu', this.handleContextMenu);
    window.removeEventListener('blur', this.handleBlur);
    document.removeEventListener('pointerlockchange', this.handlePointerLockChange);
    this.targetEl.removeEventListener('click', this.handleViewportClick);
  }
}

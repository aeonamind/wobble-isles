// Keyboard + mouse + gamepad → device-independent intents (DESIGN.md §3.1).
// Button presses are latched until the next simulation tick consumes them, so a quick tap is never lost.

export interface Intents {
  moveX: number; // right
  moveY: number; // forward
  lookX: number; // radians this frame
  lookY: number;
  jump: boolean; // pressed since last consume
  dive: boolean;
  grab: boolean; // held
}

const DEADZONE = 0.18;

export class Input {
  private keys = new Set<string>();
  private mouseGrab = false;
  private jumpLatch = false;
  private diveLatch = false;
  private look = { x: 0, y: 0 };
  private padPrev: boolean[] = [];
  sensitivity = 0.0025;
  padLookSpeed = 3.2;
  onKey: (code: string) => void = () => {};

  constructor(private canvas: HTMLCanvasElement) {
    addEventListener("keydown", (e) => {
      if (isTyping()) return;
      if (["Space", "ShiftLeft", "ShiftRight", "ArrowUp", "ArrowDown"].includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === "Space") this.jumpLatch = true;
      if (e.code === "ShiftLeft" || e.code === "ShiftRight" || e.code === "ControlLeft") this.diveLatch = true;
      this.onKey(e.code);
    });
    addEventListener("keyup", (e) => this.keys.delete(e.code));
    addEventListener("blur", () => {
      this.keys.clear();
      this.mouseGrab = false;
    });
    canvas.addEventListener("mousedown", (e) => {
      if (document.pointerLockElement !== canvas) {
        void canvas.requestPointerLock?.();
        return;
      }
      if (e.button === 0) this.mouseGrab = true;
      if (e.button === 2) this.diveLatch = true;
    });
    addEventListener("mouseup", (e) => {
      if (e.button === 0) this.mouseGrab = false;
    });
    addEventListener("mousemove", (e) => {
      if (document.pointerLockElement !== canvas) return;
      this.look.x += e.movementX * this.sensitivity;
      this.look.y += e.movementY * this.sensitivity;
    });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  get pointerLocked() {
    return document.pointerLockElement === this.canvas;
  }

  /** Read look deltas for this render frame (mouse + right stick). */
  readLook(dt: number) {
    const out = { ...this.look };
    this.look.x = this.look.y = 0;
    const pad = activePad();
    if (pad) {
      out.x += dz(pad.axes[2] ?? 0) * this.padLookSpeed * dt;
      out.y += dz(pad.axes[3] ?? 0) * this.padLookSpeed * dt;
    }
    return out;
  }

  /** Called once per simulation tick: movement + latched buttons. */
  consume(): Omit<Intents, "lookX" | "lookY"> {
    const k = (c: string) => this.keys.has(c);
    let moveX = (k("KeyD") || k("ArrowRight") ? 1 : 0) - (k("KeyA") || k("ArrowLeft") ? 1 : 0);
    let moveY = (k("KeyW") || k("ArrowUp") ? 1 : 0) - (k("KeyS") || k("ArrowDown") ? 1 : 0);
    let jump = this.jumpLatch;
    let dive = this.diveLatch;
    let grab = this.mouseGrab || k("KeyE");

    const pad = activePad();
    if (pad) {
      const sx = dz(pad.axes[0] ?? 0);
      const sy = -dz(pad.axes[1] ?? 0);
      if (Math.abs(sx) + Math.abs(sy) > 0) {
        moveX = sx;
        moveY = sy;
      }
      const pressed = (i: number) => !!pad.buttons[i]?.pressed;
      const edge = (i: number) => pressed(i) && !this.padPrev[i];
      jump ||= edge(0); // A / Cross
      dive ||= edge(2) || edge(1); // X / Square, or B / Circle
      grab ||= (pad.buttons[7]?.value ?? 0) > 0.3 || pressed(5); // RT / R2 or RB / R1
      this.padPrev = pad.buttons.map((b) => b.pressed);
    }

    this.jumpLatch = false;
    this.diveLatch = false;
    const len = Math.hypot(moveX, moveY);
    if (len > 1) {
      moveX /= len;
      moveY /= len;
    }
    return { moveX, moveY, jump, dive, grab };
  }
}

function dz(v: number) {
  return Math.abs(v) < DEADZONE ? 0 : (v - Math.sign(v) * DEADZONE) / (1 - DEADZONE);
}

function activePad(): Gamepad | null {
  const pads = navigator.getGamepads?.() ?? [];
  for (const p of pads) if (p?.connected) return p;
  return null;
}

function isTyping() {
  const a = document.activeElement;
  return a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement || a instanceof HTMLSelectElement;
}

// Touch controls (phones and tablets): a floating joystick on the left half, drag to look on the right,
// and big Jump / Dive / Grab buttons. Feeds the same intents as keyboard and gamepad.

export interface TouchState {
  moveX: number;
  moveY: number;
  lookX: number;
  lookY: number;
  jump: boolean;
  dive: boolean;
  grab: boolean;
}

export const isTouchDevice = () => matchMedia("(pointer: coarse)").matches || "ontouchstart" in window;

export class TouchControls {
  readonly state: TouchState = { moveX: 0, moveY: 0, lookX: 0, lookY: 0, jump: false, dive: false, grab: false };
  /** Extra buttons (Gremlin) call back here. */
  onAction: (a: "gremlin" | "settings") => void = () => {};
  private root = document.getElementById("touch")!;
  private stick = document.getElementById("touch-stick")!;
  private knob = document.getElementById("touch-knob")!;
  private stickId: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private lookId: number | null = null;
  private lookLast = { x: 0, y: 0 };
  lookSpeed = 0.006;

  constructor() {
    this.root.hidden = false;
    document.body.classList.add("touch");
    const zone = document.getElementById("touch-zone")!;
    zone.addEventListener("touchstart", (e) => this.start(e), { passive: false });
    zone.addEventListener("touchmove", (e) => this.move(e), { passive: false });
    zone.addEventListener("touchend", (e) => this.end(e));
    zone.addEventListener("touchcancel", (e) => this.end(e));
    const hold = (id: string, on: () => void, off?: () => void) => {
      const b = document.getElementById(id)!;
      b.addEventListener("touchstart", (e) => {
        e.preventDefault();
        b.classList.add("down");
        on();
      });
      const up = (e: Event) => {
        e.preventDefault();
        b.classList.remove("down");
        off?.();
      };
      b.addEventListener("touchend", up);
      b.addEventListener("touchcancel", up);
    };
    hold("touch-jump", () => (this.state.jump = true));
    hold("touch-dive", () => (this.state.dive = true));
    hold(
      "touch-grab",
      () => (this.state.grab = true),
      () => (this.state.grab = false),
    );
    hold("touch-gremlin", () => this.onAction("gremlin"));
  }

  setGremlin(visible: boolean) {
    document.getElementById("touch-gremlin")!.hidden = !visible;
  }

  private start(e: TouchEvent) {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      if (t.clientX < innerWidth * 0.45 && this.stickId == null) {
        this.stickId = t.identifier;
        this.stickOrigin = { x: t.clientX, y: t.clientY };
        this.stick.hidden = false;
        this.stick.style.left = `${t.clientX}px`;
        this.stick.style.top = `${t.clientY}px`;
        this.knob.style.transform = "translate(-50%, -50%)";
      } else if (this.lookId == null) {
        this.lookId = t.identifier;
        this.lookLast = { x: t.clientX, y: t.clientY };
      }
    }
  }

  private move(e: TouchEvent) {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.stickId) {
        const R = 56;
        let dx = t.clientX - this.stickOrigin.x;
        let dy = t.clientY - this.stickOrigin.y;
        const len = Math.hypot(dx, dy);
        if (len > R) {
          dx = (dx / len) * R;
          dy = (dy / len) * R;
        }
        this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
        const k = Math.min(1, len / R);
        const dead = 0.15;
        const mag = k < dead ? 0 : (k - dead) / (1 - dead);
        this.state.moveX = len ? (dx / Math.max(len, 1e-3)) * mag : 0;
        this.state.moveY = len ? (-dy / Math.max(len, 1e-3)) * mag : 0;
      } else if (t.identifier === this.lookId) {
        this.state.lookX += (t.clientX - this.lookLast.x) * this.lookSpeed;
        this.state.lookY += (t.clientY - this.lookLast.y) * this.lookSpeed;
        this.lookLast = { x: t.clientX, y: t.clientY };
      }
    }
  }

  private end(e: TouchEvent) {
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.stickId) {
        this.stickId = null;
        this.stick.hidden = true;
        this.state.moveX = this.state.moveY = 0;
      }
      if (t.identifier === this.lookId) this.lookId = null;
    }
  }
}

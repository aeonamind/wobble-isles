// Movement & interaction tuning. Values are the M1 starting point from docs/DESIGN.md §3.2.
// The object is intentionally mutable: the in-game tuning panel edits it live.
// Units: metres, seconds, m/s, m/s².

export const TUNING = {
  move: {
    runSpeed: 6.0,
    groundAccel: 40,
    groundDecel: 50,
    airControl: 0.35,
    turnRate: 14, // rad/s the facing direction turns toward movement
  },
  jump: {
    height: 1.3,
    gravity: 26,
    fallGravityMul: 1.4,
    maxFallSpeed: 30,
    coyoteTime: 0.1,
    bufferTime: 0.12,
  },
  dive: {
    speed: 7.5,
    hop: 4.5,
    slideFriction: 9,
    slideTime: 0.45,
    getUpTime: 0.25,
    cooldown: 0.5,
  },
  grab: {
    range: 1.1,
    coneDeg: 60,
    holdSlowdown: 0.7,
    maxHold: 3.0,
    regrabCooldown: 1.0,
    mashBreak: 0.4, // each jump press by the held player shortens the hold by this much
    throwSpeed: 6,
    throwUp: 4,
  },
  ragdoll: {
    minTime: 0.8,
    maxTime: 1.4,
    friction: 7,
    hardLandingSpeed: 16, // fall speed that knocks you over on landing
    knockbackThreshold: 5.5, // impulse magnitude that triggers a ragdoll
  },
  stomp: {
    height: 2.0, // landing on someone's head bounces you this high (m)
    boostHeight: 3.2, // ...or this high if you press jump as you land
    squashTime: 0.7, // the stomped Wobbler is flattened for this long (s)
    squashSlow: 0.45, // and moves at this fraction of run speed
    slideOff: 2.5, // sideways push off the head so nobody can be pinned by endless bounces (m/s)
    minNormalY: 0.55, // how "on top" the contact must be (1 = straight down)
  },
  bump: {
    shove: 1.6, // walking into someone nudges them
    tackleMul: 0.8, // dive tackle transfers this fraction of the diver's velocity
    tackleUp: 3,
  },
  hazard: {
    knockbackMul: 1.15,
    minKnockback: 6,
    upKick: 3.5,
  },
  surface: {
    iceAccelMul: 0.25,
    iceDecelMul: 0.1,
    stickySpeedMul: 0.6,
    bounceMul: 2.0, // bouncer launch = bounceMul × jump height
  },
  respawn: {
    killY: -15,
    delay: 1.5,
    invulnerable: 1.0,
  },
};

export type Tuning = typeof TUNING;

/** Deep copy of the defaults, captured before anyone mutates TUNING. */
export const TUNING_DEFAULTS: Tuning = structuredClone(TUNING);

export function resetTuning() {
  applyTuning(TUNING_DEFAULTS);
}

/** Copy values from a (possibly partial / stale) object into TUNING, ignoring unknown keys. */
export function applyTuning(src: unknown) {
  if (!src || typeof src !== "object") return;
  for (const [group, values] of Object.entries(TUNING) as [keyof Tuning, Record<string, number>][]) {
    const from = (src as Record<string, unknown>)[group];
    if (!from || typeof from !== "object") continue;
    for (const key of Object.keys(values)) {
      const v = (from as Record<string, unknown>)[key];
      if (typeof v === "number" && Number.isFinite(v)) values[key] = v;
    }
  }
}

export const jumpVelocity = () => Math.sqrt(2 * TUNING.jump.gravity * TUNING.jump.height);

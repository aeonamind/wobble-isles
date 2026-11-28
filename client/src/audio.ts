// Procedural audio (ART.md §6): every sound effect and the music are synthesised with Web Audio,
// so there are no audio files to download and everything matches the toy-like, bouncy tone.

export type Sfx =
  | "jump"
  | "land"
  | "bounce"
  | "stomp"
  | "dive"
  | "hit"
  | "grab"
  | "throw"
  | "fall"
  | "respawn"
  | "clang"
  | "ball"
  | "beep"
  | "go"
  | "toast"
  | "fanfare"
  | "champion"
  | "crown"
  | "goal"
  | "out"
  | "click"
  | "avalanche"
  | "clump";

export type Mood = "off" | "lobby" | "round" | "final";

export interface Volumes {
  master: number;
  music: number;
  sfx: number;
}

interface PlayOpts {
  /** 0..1 loudness before distance falloff. */
  vol?: number;
  /** Pitch multiplier. */
  pitch?: number;
  /** World position for distance falloff / panning. */
  pos?: { x: number; y: number; z: number };
}

const NOTE = (n: number) => 440 * Math.pow(2, (n - 69) / 12); // MIDI → Hz

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private sfxBus!: GainNode;
  private noise!: AudioBuffer;
  private volumes: Volumes = { master: 0.8, music: 0.5, sfx: 0.8 };
  private listener = { x: 0, y: 0, z: 0, rx: 1, rz: 0 };
  private mood: Mood = "off";
  private music: Sequencer | null = null;
  private lastPlayed = new Map<string, number>();

  constructor() {
    // Browsers only allow audio after a user gesture.
    const unlock = () => {
      this.ensure();
      void this.ctx?.resume();
    };
    addEventListener("pointerdown", unlock);
    addEventListener("keydown", unlock);
    addEventListener("touchstart", unlock);
  }

  private ensure() {
    if (this.ctx) return this.ctx;
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    const ctx = new Ctx();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master = ctx.createGain();
    this.musicBus = ctx.createGain();
    this.sfxBus = ctx.createGain();
    this.musicBus.connect(this.master);
    this.sfxBus.connect(this.master);
    this.master.connect(comp).connect(ctx.destination);
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.applyVolumes();
    if (this.mood !== "off") this.startMusic(this.mood);
    return ctx;
  }

  setVolumes(v: Volumes) {
    this.volumes = { ...v };
    this.applyVolumes();
  }

  private applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.volumes.master, t, 0.05);
    this.musicBus.gain.setTargetAtTime(this.volumes.music * 0.55, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(this.volumes.sfx, t, 0.05);
  }

  /** Camera position and its right vector (for panning). */
  setListener(x: number, y: number, z: number, rx: number, rz: number) {
    Object.assign(this.listener, { x, y, z, rx, rz });
  }

  setMood(m: Mood) {
    if (m === this.mood) return;
    this.mood = m;
    if (!this.ctx) return;
    this.startMusic(m);
  }

  /** Briefly lower the music (fanfares, the countdown). */
  duck(seconds: number, level = 0.35) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const g = this.musicBus.gain;
    const full = this.volumes.music * 0.55;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(full * level, t, 0.05);
    g.setTargetAtTime(full, t + seconds, 0.4);
  }

  private startMusic(m: Mood) {
    this.music?.stop();
    this.music = null;
    if (m === "off" || !this.ctx) return;
    this.music = new Sequencer(this.ctx, this.musicBus, this.noise, SONGS[m]);
    this.music.start();
  }

  play(name: Sfx, o: PlayOpts = {}) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running") return;
    // Don't machine-gun the same sound: tiny per-sound cooldown.
    const now = ctx.currentTime;
    const key = name + (o.pos ? `${Math.round(o.pos.x)},${Math.round(o.pos.z)}` : "");
    if ((this.lastPlayed.get(key) ?? -1) > now - 0.035) return;
    this.lastPlayed.set(key, now);

    let vol = o.vol ?? 1;
    let pan = 0;
    if (o.pos) {
      const L = this.listener;
      const dx = o.pos.x - L.x;
      const dz = o.pos.z - L.z;
      const dist = Math.hypot(dx, o.pos.y - L.y, dz);
      vol *= 1 / (1 + Math.max(0, dist - 4) * 0.12);
      if (vol < 0.03) return;
      pan = Math.max(-0.8, Math.min(0.8, (dx * L.rx + dz * L.rz) / Math.max(4, dist)));
    }
    const out = ctx.createGain();
    out.gain.value = vol;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    out.connect(p).connect(this.sfxBus);
    const k = o.pitch ?? 1;
    const S = new Synth(ctx, out, this.noise, now);
    switch (name) {
      case "jump":
        S.tone("sine", 320 * k, 640 * k, 0.16, 0.35, { vibrato: 18 });
        break;
      case "land":
        S.noise(500, 120, 0.1, 0.3 * vol);
        S.tone("sine", 110 * k, 60 * k, 0.12, 0.5);
        break;
      case "bounce":
        S.tone("sine", 180 * k, 820 * k, 0.32, 0.45, { vibrato: 26, vibratoRate: 22 });
        S.tone("triangle", 90 * k, 300 * k, 0.2, 0.25);
        break;
      case "stomp":
        S.noise(2200, 300, 0.12, 0.35, "bandpass");
        S.tone("sine", 260 * k, 900 * k, 0.22, 0.4, { vibrato: 30, vibratoRate: 25, delay: 0.03 });
        break;
      case "dive":
        S.noise(400, 2600, 0.22, 0.3, "bandpass");
        break;
      case "hit":
        S.tone("triangle", 220 * k, 70 * k, 0.18, 0.6);
        S.noise(3000, 600, 0.06, 0.35);
        S.tone("square", 520 * k, 330 * k, 0.12, 0.08, { delay: 0.02 });
        break;
      case "grab":
        S.tone("sine", 900 * k, 420 * k, 0.07, 0.35);
        break;
      case "throw":
        S.noise(300, 1800, 0.25, 0.3, "bandpass");
        S.tone("triangle", 300 * k, 520 * k, 0.1, 0.2);
        break;
      case "fall":
        // Slide whistle
        S.tone("sine", 1300 * k, 180 * k, 0.9, 0.3, { vibrato: 12, vibratoRate: 7, curve: "lin" });
        break;
      case "respawn":
        [0, 4, 7, 12].forEach((n, i) => S.tone("triangle", NOTE(72 + n) * k, NOTE(72 + n) * k, 0.14, 0.25, { delay: i * 0.06 }));
        break;
      case "clang":
        S.tone("square", 620 * k, 600 * k, 0.25, 0.12);
        S.tone("square", 931 * k, 900 * k, 0.2, 0.08);
        S.tone("triangle", 180 * k, 60 * k, 0.2, 0.5);
        break;
      case "ball":
        S.tone("sine", 140 * k, 70 * k, 0.18, 0.6);
        S.noise(900, 200, 0.08, 0.2);
        break;
      case "beep":
        S.tone("square", 660, 660, 0.14, 0.18);
        S.tone("sine", 660, 660, 0.2, 0.3);
        break;
      case "go":
        [0, 4, 7].forEach((n) => S.tone("square", NOTE(81 + n), NOTE(81 + n), 0.5, 0.1));
        S.tone("sine", NOTE(69), NOTE(69), 0.5, 0.35);
        break;
      case "toast":
        S.tone("sine", 1200, 1200, 0.06, 0.15);
        S.tone("sine", 1600, 1600, 0.08, 0.15, { delay: 0.06 });
        break;
      case "fanfare":
        [[60, 0], [64, 0.12], [67, 0.24], [72, 0.36], [72, 0.6]].forEach(([n, d], i) => {
          S.tone("square", NOTE(n), NOTE(n), i === 4 ? 0.6 : 0.14, 0.09, { delay: d });
          S.tone("triangle", NOTE(n - 12), NOTE(n - 12), i === 4 ? 0.6 : 0.14, 0.25, { delay: d });
        });
        break;
      case "champion":
        [[60, 0], [64, 0.15], [67, 0.3], [72, 0.45], [67, 0.65], [72, 0.8], [76, 1.0], [79, 1.2]].forEach(([n, d], i, a) => {
          const len = i === a.length - 1 ? 1.2 : 0.18;
          S.tone("square", NOTE(n), NOTE(n), len, 0.09, { delay: d, vibrato: i === a.length - 1 ? 8 : 0 });
          S.tone("triangle", NOTE(n - 12), NOTE(n - 12), len, 0.22, { delay: d });
        });
        S.noise(8000, 4000, 1.6, 0.08, "highpass", 1.0);
        break;
      case "crown":
        [0, 7, 12, 19].forEach((n, i) => S.tone("sine", NOTE(84 + n), NOTE(84 + n), 0.18, 0.2, { delay: i * 0.05 }));
        break;
      case "goal":
        [55, 59, 62].forEach((n) => S.tone("sawtooth", NOTE(n), NOTE(n), 0.9, 0.07, { vibrato: 6, vibratoRate: 6, lowpass: 1800 }));
        S.noise(4000, 2000, 1.2, 0.12, "bandpass");
        break;
      case "out":
        // Sad trombone
        [[58, 0], [57, 0.32], [56, 0.64]].forEach(([n, d]) => S.tone("sawtooth", NOTE(n), NOTE(n), 0.3, 0.1, { delay: d, lowpass: 900 }));
        S.tone("sawtooth", NOTE(55), NOTE(54), 0.9, 0.1, { delay: 0.96, vibrato: 10, vibratoRate: 6, lowpass: 900 });
        break;
      case "click":
        S.tone("sine", 1000, 700, 0.04, 0.2);
        break;
      case "clump":
        S.noise(900, 180, 0.3, 0.45, "bandpass");
        S.tone("sine", 240 * k, 110 * k, 0.35, 0.45, { vibrato: 30, vibratoRate: 18 });
        S.tone("triangle", 480 * k, 220 * k, 0.2, 0.15, { delay: 0.05 });
        break;
      case "avalanche":
        S.noise(200, 80, 1.4, 0.6, "lowpass");
        S.tone("sine", 70, 40, 1.2, 0.5);
        break;
    }
  }
}

// ───────────────────────── One-shot synth helper ─────────────────────────

class Synth {
  constructor(
    private ctx: AudioContext,
    private out: AudioNode,
    private noiseBuf: AudioBuffer,
    private t0: number,
  ) {}

  tone(
    type: OscillatorType,
    from: number,
    to: number,
    dur: number,
    vol: number,
    o: { delay?: number; vibrato?: number; vibratoRate?: number; curve?: "exp" | "lin"; lowpass?: number } = {},
  ) {
    const ctx = this.ctx;
    const t = this.t0 + (o.delay ?? 0);
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    if (o.curve === "lin") osc.frequency.linearRampToValueAtTime(to, t + dur);
    else osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + dur);
    if (o.vibrato) {
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.frequency.value = o.vibratoRate ?? 14;
      depth.gain.value = o.vibrato;
      lfo.connect(depth).connect(osc.frequency);
      lfo.start(t);
      lfo.stop(t + dur + 0.05);
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node: AudioNode = osc;
    if (o.lowpass) {
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = o.lowpass;
      node = osc.connect(f);
    }
    node.connect(g).connect(this.out);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  noise(from: number, to: number, dur: number, vol: number, type: BiquadFilterType = "lowpass", delay = 0) {
    const ctx = this.ctx;
    const t = this.t0 + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = type === "bandpass" ? 1.4 : 0.7;
    f.frequency.setValueAtTime(from, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }
}

// ───────────────────────── Music ─────────────────────────

interface Song {
  bpm: number;
  /** Root notes (MIDI) of the chord per bar; chords are built from `quality`. */
  bars: { root: number; minor: boolean }[];
  /** Scale (semitones from the key) used for the lead melody. */
  scale: number[];
  key: number;
  seed: number;
  /** Drum pattern per 16th: k = kick, s = snare, h = hat, - = rest. */
  drums: string;
  lead: number; // lead loudness
  swing: number;
}

const SONGS: Record<Exclude<Mood, "off">, Song> = {
  // Lazy carnival bop for the lobby (F major, I–vi–IV–V)
  lobby: {
    bpm: 100,
    bars: [
      { root: 53, minor: false },
      { root: 50, minor: true },
      { root: 46, minor: false },
      { root: 48, minor: false },
    ],
    scale: [0, 2, 4, 7, 9],
    key: 65,
    seed: 3,
    drums: "k---h-s-k-h-s-h-",
    lead: 0.07,
    swing: 0.12,
  },
  // Upbeat round theme (C major, I–V–vi–IV)
  round: {
    bpm: 132,
    bars: [
      { root: 48, minor: false },
      { root: 55, minor: false },
      { root: 57, minor: true },
      { root: 53, minor: false },
    ],
    scale: [0, 2, 4, 7, 9],
    key: 72,
    seed: 11,
    drums: "k-h-s-h-k-k-s-hh",
    lead: 0.08,
    swing: 0,
  },
  // Tense Final (A minor, i–VI–III–VII)
  final: {
    bpm: 144,
    bars: [
      { root: 57, minor: true },
      { root: 53, minor: false },
      { root: 48, minor: false },
      { root: 55, minor: false },
    ],
    scale: [0, 3, 5, 7, 10],
    key: 69,
    seed: 29,
    drums: "k-hkshh-k-hks-hs",
    lead: 0.085,
    swing: 0,
  },
};

/** Look-ahead step sequencer: bass, chord plucks, drums and a seeded pentatonic lead. */
class Sequencer {
  private timer: ReturnType<typeof setInterval> | null = null;
  private next = 0;
  private step = 0;
  private out: GainNode;
  private melody: (number | null)[];

  constructor(
    private ctx: AudioContext,
    bus: AudioNode,
    private noise: AudioBuffer,
    private song: Song,
  ) {
    this.out = ctx.createGain();
    this.out.gain.value = 0.0001;
    this.out.connect(bus);
    this.melody = this.writeMelody();
  }

  /** Two 2-bar phrases (A A' B A) from a seeded walk on the scale. */
  private writeMelody() {
    let s = this.song.seed;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const phrase = () => {
      const notes: (number | null)[] = [];
      let deg = 2;
      for (let i = 0; i < 32; i++) {
        const onBeat = i % 2 === 0;
        if (rnd() < (onBeat ? 0.72 : 0.28)) {
          deg = Math.max(0, Math.min(9, deg + Math.round((rnd() - 0.5) * 4)));
          notes.push(deg);
        } else notes.push(null);
      }
      return notes;
    };
    const a = phrase();
    const b = phrase();
    const a2 = a.map((n, i) => (i >= 24 && n != null ? Math.max(0, n - 1) : n));
    return [...a, ...a2, ...b, ...a].map((d) => (d == null ? null : this.song.key + Math.floor(d / 5) * 12 + this.song.scale[d % 5] - 12));
  }

  start() {
    this.next = this.ctx.currentTime + 0.1;
    this.out.gain.setTargetAtTime(1, this.ctx.currentTime, 0.4);
    this.timer = setInterval(() => this.schedule(), 25);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    const t = this.ctx.currentTime;
    this.out.gain.setTargetAtTime(0.0001, t, 0.25);
    setTimeout(() => this.out.disconnect(), 1500);
  }

  private schedule() {
    const sixteenth = 60 / this.song.bpm / 4;
    while (this.next < this.ctx.currentTime + 0.12) {
      const swing = this.step % 2 === 1 ? this.song.swing * sixteenth : 0;
      this.play16(this.step, this.next + swing);
      this.next += sixteenth;
      this.step = (this.step + 1) % (16 * 16);
    }
  }

  private play16(step: number, t: number) {
    const song = this.song;
    const bar = song.bars[Math.floor(step / 16) % song.bars.length];
    const i = step % 16;
    const sixteenth = 60 / song.bpm / 4;
    // Bass: root on 1 and 3, fifth on the "and" of 2 and 4
    if (i === 0 || i === 8) this.note("triangle", bar.root - 12, sixteenth * 3, 0.32);
    if (i === 6 || i === 14) this.note("triangle", bar.root - 5, sixteenth * 1.5, 0.22);
    // Chord plucks on the off-beats
    if (i % 4 === 2) {
      const third = bar.minor ? 3 : 4;
      for (const n of [0, third, 7]) this.note("sawtooth", bar.root + 12 + n, sixteenth * 1.2, 0.028, 2200);
    }
    // Drums
    const d = song.drums[i];
    if (d === "k") this.kick(t);
    if (d === "s") this.snare(t);
    if (d === "h" || d === "s") this.hat(t, d === "s" ? 0.03 : 0.05);
    // Lead (every other 8-bar section, so the tune breathes)
    const section = Math.floor(step / 128);
    const m = this.melody[(step / 2) % 64 | 0];
    if (section % 2 === 0 && step % 2 === 0 && m != null) this.note("square", m, sixteenth * 1.8, song.lead, 3000, t);
  }

  private note(type: OscillatorType, midi: number, dur: number, vol: number, lowpass?: number, at?: number) {
    const ctx = this.ctx;
    const t = at ?? this.next;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = NOTE(midi);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node: AudioNode = osc;
    if (lowpass) {
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = lowpass;
      node = osc.connect(f);
    }
    node.connect(g).connect(this.out);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  private kick(t: number) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.55, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    osc.connect(g).connect(this.out);
    osc.start(t);
    osc.stop(t + 0.2);
  }

  private snare(t: number) {
    this.burst(t, "bandpass", 1800, 0.12, 0.22);
  }

  private hat(t: number, vol: number) {
    this.burst(t, "highpass", 7000, 0.04, vol);
  }

  private burst(t: number, type: BiquadFilterType, freq: number, dur: number, vol: number) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }
}

// Party mode rules (DESIGN.md §2.1, §2.3) as pure functions, shared by the server and tests.

import type { HazardDef } from "./hazards";
import type { LevelDef } from "./level";
import { ROUNDS, type Category, type RoundDef } from "./rounds";

export type Phase = "lobby" | "intro" | "countdown" | "play" | "results" | "podium";

/** Seconds per timed phase. */
export const PHASE_TIME = { intro: 5, countdown: 3, results: 8, podium: 14 } as const;
/** Rounds before the Final. */
export const SHOW_ROUNDS = 5;
export const FINALISTS = 3;
/** A Bounty is claimed if the leader falls within this many seconds of your hit. */
export const BOUNTY_WINDOW = 3;
export const GREMLIN_COOLDOWN = 6;

// ───────────────────────── House Rules ─────────────────────────

export type HouseRuleId = "moon-bounce" | "ice-age" | "turbo-traps" | "caramel-floors";

/** One modifier for everybody, spun by the player in last place (DESIGN.md §3.6). */
export const HOUSE_RULES: { id: HouseRuleId; name: string; text: string; fits(level: LevelDef): boolean }[] = [
  { id: "moon-bounce", name: "Moon Bounce", text: "Low gravity: jumps go sky high.", fits: () => true },
  { id: "ice-age", name: "Ice Age", text: "Every floor is ice.", fits: (l) => l.water == null },
  { id: "turbo-traps", name: "Turbo Traps", text: "Hazards move 35% faster.", fits: (l) => l.hazards.length > 0 },
  { id: "caramel-floors", name: "Caramel Floors", text: "Sticky feet: everyone runs slower.", fits: (l) => l.water == null },
];

export const houseRule = (id: string | null | undefined) => HOUSE_RULES.find((r) => r.id === id);

/** House Rules start from this round (1-based), never in the Final. */
export const HOUSE_RULES_FROM = 2;

// ───────────────────────── Show Director ─────────────────────────

/** Pick the rounds before the Final for `n` players: no repeats, no category twice in a row, ≥1 race, ≥1 team if n ≥ 4. */
export function planShow(n: number, random: () => number, count = SHOW_ROUNDS): RoundDef[] {
  const eligible = ROUNDS.filter((r) => r.category !== "final" && r.players.min <= n && n <= r.players.max);
  const want = Math.min(count, eligible.length);
  let best: RoundDef[] = [];
  for (let attempt = 0; attempt < 200; attempt++) {
    const pool = [...eligible];
    const picked: RoundDef[] = [];
    while (picked.length < want && pool.length) {
      const options = pool.filter((r) => r.category !== picked[picked.length - 1]?.category);
      const from = options.length ? options : pool;
      const r = from[Math.floor(random() * from.length)];
      picked.push(r);
      pool.splice(pool.indexOf(r), 1);
    }
    const has = (c: Category) => picked.some((r) => r.category === c);
    const okTeam = n < 4 || !eligible.some((r) => r.category === "team") || has("team");
    const okRace = has("race") || !eligible.some((r) => r.category === "race");
    const okOrder = picked.every((r, i) => i === 0 || r.category !== picked[i - 1].category);
    if (okTeam && okRace && okOrder) return picked;
    if (!best.length) best = picked;
  }
  return best;
}

export function pickFinal(n: number, random: () => number): RoundDef {
  const finals = ROUNDS.filter((r) => r.category === "final" && r.players.min <= n);
  return finals[Math.floor(random() * finals.length)] ?? ROUNDS.find((r) => r.category === "final")!;
}

// ───────────────────────── Ranking & stars ─────────────────────────

/** Competition ranking ("1224"): ties share the better rank. `score` higher is better. */
export function rankBy<K>(score: Map<K, number>): Map<K, number> {
  const ranks = new Map<K, number>();
  for (const [id, s] of score) {
    let better = 0;
    for (const t of score.values()) if (t > s) better++;
    ranks.set(id, better + 1);
  }
  return ranks;
}

/** Rank r of n earns n − r + 1 stars (ties share the higher value). */
export function starsFor(rank: number, n: number) {
  return Math.max(1, n - rank + 1);
}

/** Team rounds: winners get the top value, losers ceil(n/2). A draw gives everyone the losing value. */
export function teamStars(n: number, won: boolean | null) {
  return won ? n : Math.ceil(n / 2);
}

/** Current star leader: a unique top score above zero, else nobody. */
export function leaderOf(stars: Map<number, number>): number | null {
  let best = 0;
  let who: number | null = null;
  let tie = false;
  for (const [id, s] of stars) {
    if (s > best) {
      best = s;
      who = id;
      tie = false;
    } else if (s === best && s > 0) tie = true;
  }
  return tie ? null : who;
}

/** Top `count` by stars; ties broken by best single-round rank, then randomly. */
export function pickFinalists(stars: Map<number, number>, bestRank: Map<number, number>, random: () => number, count = FINALISTS): number[] {
  const tiebreak = new Map([...stars.keys()].map((id) => [id, random()]));
  return [...stars.keys()]
    .sort((a, b) => (stars.get(b)! - stars.get(a)!) || (bestRank.get(a) ?? 99) - (bestRank.get(b) ?? 99) || tiebreak.get(a)! - tiebreak.get(b)!)
    .slice(0, count);
}

/** Balanced teams: snake draft by stars (1st→A, 2nd→B, 3rd→B, 4th→A, …). */
export function splitTeams(ids: number[], stars: Map<number, number>): Map<number, number> {
  const order = [...ids].sort((a, b) => (stars.get(b) ?? 0) - (stars.get(a) ?? 0) || a - b);
  const teams = new Map<number, number>();
  order.forEach((id, i) => teams.set(id, [0, 1, 1, 0][i % 4]));
  return teams;
}

// ───────────────────────── Wire format ─────────────────────────

export interface RoundInfo {
  index: number; // 1-based
  total: number; // including the Final
  id: string;
  seed: number;
  /** Server tick when play starts; hazards run on (time − epoch). */
  epochTick: number;
  double: boolean;
  final: boolean;
  /** House Rule for this round and who spun it. */
  rule: HouseRuleId | null;
  ruleBy: number | null;
}

export interface ResultRow {
  id: number;
  rank: number;
  gained: number;
  bonus: number;
  total: number;
}

/** Server → everyone whenever the show state changes (and a few times a second during play). */
export interface ShowMsg {
  phase: Phase;
  /** Server tick the current phase ends (timer), or null. */
  endsAt: number | null;
  round: RoundInfo | null;
  /** Wobbler id → spawn index for this round. */
  spawns: Record<number, number>;
  participants: number[];
  teams: Record<number, number> | null;
  stars: Record<number, number>;
  leader: number | null;
  finished: number[];
  out: number[];
  /** Hunt: points per player. */
  points: Record<number, number>;
  /** Team: goals per team. */
  goals: number[] | null;
  results: ResultRow[] | null;
  champion: number | null;
  podium: number[] | null;
  /** Hazards added mid-round (Gremlin avalanches). */
  extra: HazardDef[];
  /** Latest announcements, newest last. */
  toasts: { seq: number; text: string }[];
}

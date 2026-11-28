// Party show overlays: lobby, round intro, 3-2-1, round HUD, toasts, results and podium.

import type { RosterEntry } from "../../../shared/protocol";
import { roundById, type Category } from "../../../shared/rounds";
import { houseRule, type ShowMsg } from "../../../shared/show";
import { TICK_RATE } from "../../../shared/sim";
import { TEAM_COLORS, TEAM_NAMES } from "../render/level";
import { PLAYER_COLORS } from "../render/wobbler";

const $ = (id: string) => document.getElementById(id)!;
const hex = (c: number) => "#" + c.toString(16).padStart(6, "0");

const CATEGORY: Record<Category, { label: string; color: string }> = {
  race: { label: "Race", color: "#ff7eb6" },
  survival: { label: "Survival", color: "#57d9b7" },
  hunt: { label: "Hunt", color: "#ffc93c" },
  team: { label: "Team", color: "#7aa7ff" },
  final: { label: "Final", color: "#ff4f5e" },
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export interface ShowView {
  me: number;
  roster: RosterEntry[];
  /** Server tick right now. */
  tick: number;
  host: boolean;
  /** Who the camera follows while we are out of the round (null = us). */
  spectating: number | null;
}

export class ShowUi {
  private lastKey = "";
  private toastSeq = 0;
  private goShown = 0;
  private lastCount = "";
  onStart: () => void = () => {};

  constructor() {
    $("show-start").onclick = () => this.onStart();
  }

  private name(v: ShowView, id: number) {
    return v.roster.find((r) => r.id === id)?.name ?? "Someone";
  }

  private dot(v: ShowView, id: number) {
    const i = el("i", "dot");
    const c = v.roster.find((r) => r.id === id)?.color ?? id;
    i.style.background = hex(PLAYER_COLORS[c % PLAYER_COLORS.length]);
    return i;
  }

  update(m: ShowMsg | null, v: ShowView) {
    const phase = m?.phase ?? "lobby";
    const round = m?.round ? roundById(m.round.id) : undefined;
    const left = m?.endsAt != null ? Math.max(0, (m.endsAt - v.tick) / TICK_RATE) : null;
    const playing = !!m && m.participants.includes(v.me);

    // Lobby panel
    const lobby = phase === "lobby";
    $("show-lobby").hidden = !lobby;
    if (lobby) {
      const n = v.roster.length;
      ($("show-start") as HTMLButtonElement).hidden = !v.host;
      ($("show-start") as HTMLButtonElement).disabled = n < 1;
      $("show-lobby-sub").textContent = v.host
        ? n < 2
          ? "Invite friends with the room code, or start a practice show alone. (Enter)"
          : `${n} players ready. Press Enter or click to start.`
        : `Waiting for the host to start the show… (${n} in the room)`;
    }

    // Intro card
    const showIntro = phase === "intro" && !!round && !!m?.round;
    $("show-intro").hidden = !showIntro;
    const key = `${phase}:${m?.round?.id}:${m?.round?.seed}`;
    if (showIntro && key !== this.lastKey) {
      const cat = CATEGORY[round.category];
      $("intro-index").textContent = m.round!.final ? "The Final" : `Round ${m.round!.index} of ${m.round!.total}`;
      $("intro-name").textContent = round.name;
      const tag = $("intro-cat");
      tag.textContent = cat.label;
      tag.style.background = cat.color;
      $("intro-blurb").textContent = round.blurb;
      const extra = $("intro-extra");
      extra.replaceChildren();
      if (m.round!.double) extra.append(el("span", "pill gold", "Double Down ×2 stars"));
      const rule = houseRule(m.round!.rule);
      if (rule) {
        const by = m.round!.ruleBy != null ? this.name(v, m.round!.ruleBy) : "Last place";
        extra.append(el("span", "pill rule", `House Rule by ${by}: ${rule.name}. ${rule.text}`));
      }
      if (m.round!.final) {
        extra.append(el("span", "pill", `Finalists: ${m.participants.map((id) => this.name(v, id)).join(", ")}`));
        if (!playing) extra.append(el("span", "pill gremlin", "You're a Gremlin: press F to start avalanches!"));
      }
      if (m.teams && m.teams[v.me] != null) {
        const t = m.teams[v.me];
        const p = el("span", "pill", `You're on ${TEAM_NAMES[t]}`);
        p.style.background = hex(TEAM_COLORS[t]);
        p.style.color = "#fff";
        extra.append(p);
      }
    }

    // Countdown
    const count = $("show-count");
    let countText = "";
    if (phase === "countdown" && left != null) countText = String(Math.max(1, Math.ceil(left)));
    if (phase === "play") {
      if (this.lastCount && this.lastCount !== "GO!") this.goShown = performance.now();
      if (performance.now() - this.goShown < 800) countText = "GO!";
    }
    if (countText !== this.lastCount) {
      count.textContent = countText;
      count.hidden = !countText;
      count.classList.remove("pop");
      void count.offsetWidth;
      if (countText) count.classList.add("pop");
      this.lastCount = countText;
    }

    // Round HUD
    const inRound = (phase === "countdown" || phase === "play") && !!round && !!m;
    $("show-top").hidden = !inRound;
    if (inRound) {
      const rule = houseRule(m.round?.rule);
      $("top-name").textContent = round.name + (rule ? ` · ${rule.name}` : "");
      $("top-timer").textContent = phase === "play" && left != null ? `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, "0")}` : "";
      $("top-timer").classList.toggle("low", phase === "play" && left != null && left < 10);
      $("top-status").textContent = this.status(m, v, round.category, playing);
      const sub = $("top-sub");
      sub.textContent = this.subStatus(m, v, round.category, playing);
      sub.hidden = !sub.textContent;
    }

    // Toasts
    for (const t of m?.toasts ?? []) {
      if (t.seq <= this.toastSeq) continue;
      this.toastSeq = t.seq;
      const node = el("div", "toast", t.text);
      $("show-toasts").append(node);
      setTimeout(() => node.classList.add("out"), 3200);
      setTimeout(() => node.remove(), 3700);
    }

    // Results
    const results = phase === "results" && !!m?.results && !!round;
    $("show-results").hidden = !results;
    if (results && key !== this.lastKey) {
      $("results-title").textContent = m.round!.final ? "Final results" : `${round.name}: results`;
      const sub = $("results-sub");
      sub.textContent = m.round!.final
        ? m.champion != null
          ? `${this.name(v, m.champion)} wins the show!`
          : ""
        : m.round!.index < m.round!.total - 1
          ? "Next round coming up…"
          : "Top 3 go to the Final!";
      const list = $("results-list");
      list.replaceChildren(
        ...m.results!.map((r) => {
          const row = el("li", r.id === v.me ? "me" : "");
          row.append(el("b", "rank", `#${r.rank}`), this.dot(v, r.id), el("span", "who", this.name(v, r.id)));
          if (!m.round!.final) {
            row.append(el("span", "gain", `+${r.gained}★` + (r.bonus ? ` +${r.bonus} bounty` : "")), el("span", "total", `${r.total}★`));
          } else if (r.id === m.champion) row.append(el("span", "gain", "Champion"));
          return row;
        }),
      );
    }

    // Podium
    const podium = phase === "podium" && !!m?.podium;
    $("show-podium").hidden = !podium;
    if (podium && key !== this.lastKey) {
      const champ = m.champion ?? m.podium![0];
      $("podium-champ").textContent = this.name(v, champ);
      const list = $("podium-list");
      list.replaceChildren(
        ...m.podium!.map((id, i) => {
          const row = el("li", id === v.me ? "me" : "");
          row.append(el("b", "rank", i === 0 ? "♛" : `#${i + 1}`), this.dot(v, id), el("span", "who", this.name(v, id)), el("span", "total", `${m.stars[id] ?? 0}★`));
          return row;
        }),
      );
    }

    // Spectating banner
    const spec = phase === "play" && v.spectating != null;
    $("show-spectate").hidden = !spec;
    if (spec) {
      const gremlin = !!m?.round?.final && !playing;
      $("show-spectate").textContent = gremlin
        ? `Gremlin · F: avalanche · Watching ${this.name(v, v.spectating!)} (Space: next)`
        : `Watching ${this.name(v, v.spectating!)} · Space to switch`;
    }

    this.lastKey = key;
  }

  private status(m: ShowMsg, v: ShowView, cat: Category, playing: boolean) {
    const total = m.participants.length;
    switch (cat) {
      case "race": {
        const i = m.finished.indexOf(v.me);
        return i >= 0 ? `Finished #${i + 1}!` : `Finished ${m.finished.length}/${total}`;
      }
      case "survival":
        return m.out.includes(v.me) ? "You're out!" : `Still standing ${total - m.out.length}/${total}`;
      case "hunt": {
        const mine = m.points[v.me] ?? 0;
        return `Your crown time ${mine.toFixed(1)} s`;
      }
      case "team": {
        const g = m.goals ?? [0, 0];
        return `${TEAM_NAMES[0]} ${g[0]} – ${g[1]} ${TEAM_NAMES[1]}`;
      }
      case "final":
        return playing ? "Touch the summit crown!" : "You're a Gremlin";
    }
  }

  private subStatus(m: ShowMsg, v: ShowView, cat: Category, playing: boolean) {
    if (cat === "hunt") {
      let best: number | null = null;
      for (const [id, p] of Object.entries(m.points)) if (best == null || p > (m.points[best] ?? 0)) best = Number(id);
      if (best != null && (m.points[best] ?? 0) > 0) return `Leader: ${this.name(v, best)} ${(m.points[best] ?? 0).toFixed(1)} s`;
      return "Grab the crown in the middle!";
    }
    if (cat === "team" && m.teams && m.teams[v.me] != null) return `You're on ${TEAM_NAMES[m.teams[v.me]]}: first to 3 goals`;
    if (cat === "final" && !playing) return "Press F to send an avalanche down the mountain";
    return "";
  }
}

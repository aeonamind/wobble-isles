// Load test (DESIGN.md §8 budget): N bot clients in one Party room for D seconds.
// Bots upload moving states at SEND_RATE and tackle a neighbour now and then.
// Usage: npm run loadtest -- [players=32] [seconds=20]

import { boot } from "@colyseus/testing";
import type { Room } from "@colyseus/sdk";
import { app } from "../server/app";
import type { PartyRoom } from "../server/PartyRoom";
import { PROTOCOL_VERSION, SEND_RATE, packNet, type WelcomeMsg } from "../shared/protocol";

const players = Number(process.argv[2] ?? 32);
const seconds = Number(process.argv[3] ?? 20);

const colyseus = await boot(app);
const bots: { room: Room; id: number; bytes: number }[] = [];
let code = "";
for (let i = 0; i < players; i++) {
  const room = i === 0 ? await colyseus.sdk.create("party", { name: `Bot ${i}`, v: PROTOCOL_VERSION }) : await colyseus.sdk.joinById(code, { name: `Bot ${i}`, v: PROTOCOL_VERSION });
  const welcome = await new Promise<WelcomeMsg>((r) => room.onMessage("welcome", r));
  if (i === 0) code = welcome.code;
  const bot = { room, id: welcome.you, bytes: 0 };
  room.onMessage("snap", () => {});
  room.onMessage("roster", () => {});
  room.onMessage("i", () => {});
  room.onMessage("pong", () => {});
  bots.push(bot);
}
const server = colyseus.getRoomById(code) as unknown as PartyRoom;
// Reset stats after everyone joined.
Object.assign(server.stats, { ticks: 0, tickMsTotal: 0, tickMsMax: 0, snapshots: 0, snapshotBytesTotal: 0, snapshotBytesMax: 0, messagesIn: 0, routed: 0, rejected: 0 });

const cpu0 = process.cpuUsage();
const t0 = performance.now();
let n = 0;
const timer = setInterval(() => {
  const t = (performance.now() - t0) / 1000;
  n++;
  bots.forEach((b, i) => {
    const a = t * 0.8 + (i / players) * Math.PI * 2;
    const r = 4 + (i % 4);
    const out =
      n % 60 === i % 60
        ? [{ k: "knock", from: b.id, target: bots[(i + 1) % players].id, imp: { x: 0, y: 3, z: 6 }, rag: true }]
        : [];
    b.room.send("s", {
      t: n,
      w: packNet(b.id, {
        pos: { x: Math.cos(a) * r, y: 0.5, z: Math.sin(a) * r },
        vel: { x: -Math.sin(a) * r * 0.8, y: 0, z: Math.cos(a) * r * 0.8 },
        facing: a,
        state: "normal",
        grounded: true,
        grabbing: false,
        squashed: false,
        invulnerable: false,
        holding: null,
        heldBy: null,
      clumped: false,
      }),
      ev: n % 20 === i % 20 ? [{ type: "jump", id: b.id }] : [],
      out,
    });
  });
}, 1000 / SEND_RATE);

await new Promise((r) => setTimeout(r, seconds * 1000));
clearInterval(timer);
const cpu = process.cpuUsage(cpu0);
const wall = (performance.now() - t0) / 1000;
const s = server.stats.report();
const result = {
  players,
  seconds: +wall.toFixed(1),
  serverTickMsAvg: +s.tickMsAvg.toFixed(3),
  serverTickMsMax: +s.tickMsMax.toFixed(2),
  tickBudgetUsedPct: +((s.tickMsAvg / (1000 / 60)) * 100).toFixed(1),
  snapshotBytesAvg: Math.round(s.snapshotBytesAvg),
  downKBpsPerClient: +((s.snapshotBytesAvg * SEND_RATE) / 1024).toFixed(1),
  upKBpsPerClient: "≈1.5",
  stateMsgsPerSec: Math.round(s.messagesIn / wall),
  interactionsRouted: s.routed,
  rejected: s.rejected,
  processCpuPct: +(((cpu.user + cpu.system) / 1e6 / wall) * 100).toFixed(1),
};
console.log(JSON.stringify(result, null, 2));
await colyseus.shutdown();
process.exit(0);

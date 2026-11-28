import { boot, type ColyseusTestServer } from "@colyseus/testing";
import type { Room } from "@colyseus/sdk";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { packNet, unpackNet, type PongMsg, type RosterMsg, type SnapMsg, type WelcomeMsg } from "../../shared/protocol";
import type { NetMsg } from "../../shared/sim";
import { app } from "../app";
import type { PartyRoom } from "../PartyRoom";
import { CODE_ALPHABET, CODE_LENGTH, generateRoomCode, releaseRoomCode } from "../roomCode";

function waitFor<T>(room: Room, type: string, pred: (m: T) => boolean = () => true, ms = 4000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no "${type}" matching`)), ms);
    const off = room.onMessage(type, (m: T) => {
      if (!pred(m)) return;
      clearTimeout(timer);
      off();
      resolve(m);
    });
  });
}

const netOf = (id: number, x: number, z: number, state: "normal" | "ragdoll" = "normal") =>
  packNet(id, {
    pos: { x, y: 0.5, z },
    vel: { x: 0, y: 0, z: 0 },
    facing: 0,
    state,
    grounded: true,
    grabbing: false,
    squashed: false,
    invulnerable: false,
    holding: null,
    heldBy: null,
  });

describe("room codes", () => {
  it("are 4 unambiguous characters and unique", () => {
    const codes = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const c = generateRoomCode();
      expect(c).toHaveLength(CODE_LENGTH);
      expect([...c].every((ch) => CODE_ALPHABET.includes(ch))).toBe(true);
      codes.add(c);
    }
    expect(codes.size).toBe(300);
    for (const c of codes) releaseRoomCode(c);
  });
});

describe("PartyRoom (real server, simulated clients)", () => {
  let colyseus: ColyseusTestServer;
  beforeAll(async () => {
    colyseus = await boot(app);
  });
  afterAll(async () => {
    await colyseus.shutdown();
  });
  afterEach(async () => {
    await colyseus.cleanup();
  });

  async function pair() {
    const host = await colyseus.sdk.create("party", { name: "Mai" });
    const hw = await waitFor<WelcomeMsg>(host, "welcome");
    const friend = await colyseus.sdk.joinById(hw.code, { name: "Long" });
    const fw = await waitFor<WelcomeMsg>(friend, "welcome");
    const room = colyseus.getRoomById(hw.code) as unknown as PartyRoom;
    return { host, friend, hw, fw, room };
  }

  it("create a room, join by code, everyone gets the roster", async () => {
    const host = await colyseus.sdk.create("party", { name: "Mai" });
    const hw = await waitFor<WelcomeMsg>(host, "welcome");
    expect(hw.code).toMatch(/^[A-Z2-9]{4}$/);
    const rosterP = waitFor<RosterMsg>(host, "roster", (r) => r.players.length === 2);
    const friend = await colyseus.sdk.joinById(hw.code, { name: "Long" });
    const fw = await waitFor<WelcomeMsg>(friend, "welcome");
    expect(fw.you).not.toBe(hw.you);
    expect(fw.color).not.toBe(hw.color);
    const roster = await rosterP;
    expect(roster.players.map((p) => p.name).sort()).toEqual(["Long", "Mai"]);
    expect(roster.players.find((p) => p.id === hw.you)?.host).toBe(true);
  });

  it("relays a player's uploaded state to the others in snapshots", async () => {
    const { host, friend, hw } = await pair();
    host.send("s", { t: 1, w: netOf(hw.you, 3.5, -2), ev: [{ type: "jump", id: hw.you }], out: [] });
    const snap = await waitFor<SnapMsg>(friend, "snap", (s) => s.w.some((p) => p[0] === hw.you && p[1] === 350));
    const me = unpackNet(snap.w.find((p) => p[0] === hw.you)!)!;
    expect(me.net.pos.z).toBeCloseTo(-2, 2);
    // Includes server NPC dummies and balls too.
    expect(snap.w.length).toBeGreaterThan(2);
    expect(snap.b.length).toBeGreaterThan(0);
  });

  it("routes a tackle to the target's owner only", async () => {
    const { host, friend, hw, fw } = await pair();
    host.send("s", { t: 1, w: netOf(hw.you, 0, 0), ev: [], out: [] });
    friend.send("s", { t: 1, w: netOf(fw.you, 0, 1), ev: [], out: [] });
    await waitFor<SnapMsg>(friend, "snap", (s) => s.w.some((p) => p[0] === fw.you && p[3] === 100));
    const knock: NetMsg = { k: "knock", from: hw.you, target: fw.you, imp: { x: 0, y: 3, z: 6 }, rag: true };
    host.send("s", { t: 2, w: netOf(hw.you, 0, 0), ev: [], out: [knock] });
    const got = await waitFor<NetMsg>(friend, "i");
    expect(got).toMatchObject({ k: "knock", target: fw.you, rag: true });
  });

  it("rejects interactions between Wobblers far apart, and spoofed senders", async () => {
    const { host, friend, hw, fw, room } = await pair();
    host.send("s", { t: 1, w: netOf(hw.you, 0, 0), ev: [], out: [] });
    friend.send("s", { t: 1, w: netOf(fw.you, 0, 20), ev: [], out: [] });
    await waitFor<SnapMsg>(host, "snap", (s) => s.w.some((p) => p[0] === fw.you && p[3] === 2000));
    let received = 0;
    friend.onMessage("i", () => received++);
    host.send("s", { t: 2, w: netOf(hw.you, 0, 0), ev: [], out: [{ k: "knock", from: hw.you, target: fw.you, imp: { x: 0, y: 3, z: 6 }, rag: true }] });
    // Pretending to be the friend knocking themselves.
    host.send("s", { t: 3, w: netOf(hw.you, 0, 0), ev: [], out: [{ k: "knock", from: fw.you, target: fw.you, imp: { x: 0, y: 3, z: 6 }, rag: true }] });
    await waitFor<SnapMsg>(friend, "snap");
    await waitFor<SnapMsg>(friend, "snap");
    expect(received).toBe(0);
    expect(room.stats.rejected).toBe(1);
  });

  it("a tackle on a server dummy ragdolls it for everyone", async () => {
    const { host, hw, room } = await pair();
    const dummy = room.sim.wobblers.find((w) => w.behaviour === "idle")!;
    host.send("s", { t: 1, w: netOf(hw.you, dummy.pos.x, dummy.pos.z - 1), ev: [], out: [] });
    await waitFor<SnapMsg>(host, "snap");
    host.send("s", { t: 2, w: netOf(hw.you, dummy.pos.x, dummy.pos.z - 1), ev: [], out: [{ k: "knock", from: hw.you, target: dummy.id, imp: { x: 0, y: 3, z: 6 }, rag: true }] });
    const snap = await waitFor<SnapMsg>(host, "snap", (s) => s.ev.some((e) => e.type === "ragdoll" && e.id === dummy.id));
    expect(unpackNet(snap.w.find((p) => p[0] === dummy.id)!)!.net.state).toBe("ragdoll");
  });

  it("answers pings with the server tick", async () => {
    const { host } = await pair();
    host.send("ping", { c: 123 });
    const pong = await waitFor<PongMsg>(host, "pong");
    expect(pong.c).toBe(123);
    expect(pong.t).toBeGreaterThanOrEqual(0);
  });

  it("leaving removes the Wobbler and passes host on", async () => {
    const { host, friend, hw, fw } = await pair();
    const rosterP = waitFor<RosterMsg>(friend, "roster", (r) => r.players.length === 1);
    await host.leave();
    const roster = await rosterP;
    expect(roster.players[0]).toMatchObject({ id: fw.you, host: true });
    const snap = await waitFor<SnapMsg>(friend, "snap");
    expect(snap.w.some((p) => p[0] === hw.you)).toBe(false);
  });
});

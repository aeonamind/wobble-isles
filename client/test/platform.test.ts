import { describe, expect, it } from "vitest";
import { normalizeServer } from "../src/platform";

describe("desktop app server address", () => {
  it.each([
    ["192.168.1.20", "ws://192.168.1.20:2567"],
    ["192.168.1.20:3000", "ws://192.168.1.20:3000"],
    ["localhost", "ws://localhost:2567"],
    ["localhost:2567", "ws://localhost:2567"],
    ["play.example.com", "wss://play.example.com"],
    ["https://play.example.com/", "wss://play.example.com"],
    ["http://10.0.0.5:2567", "ws://10.0.0.5:2567"],
    ["  wss://play.example.com  ", "wss://play.example.com"],
  ])("%s → %s", (input, out) => {
    expect(normalizeServer(input)).toBe(out);
  });

  it("rejects empty input", () => {
    expect(normalizeServer("   ")).toBeNull();
  });
});

import { initPhysics } from "../../shared/sim";
import { Game, QUALITY_ORDER, type Quality } from "./game";
import { NetClient } from "./net";
import { showMenu } from "./ui/menu";
import "./style.css";

const QUALITY_KEY = "wobble-isles.quality";
const params = new URLSearchParams(location.search);
const bench = params.has("bench");
const isQuality = (v: string | null): v is Quality => QUALITY_ORDER.includes(v as Quality);
const fromUrl = params.get("q");
const saved = localStorage.getItem(QUALITY_KEY);
const quality: Quality = isQuality(fromUrl) ? fromUrl : isQuality(saved) ? saved : "auto";
const lag = Math.max(0, Math.min(1000, Number(params.get("lag")) || 0));

// G cycles graphics quality. MSAA can only be chosen when the WebGL context is created, so reload
// (online, the ?room= in the URL brings you straight back into the room).
addEventListener("keydown", (e) => {
  if (e.code !== "KeyG" || e.repeat || document.activeElement instanceof HTMLInputElement) return;
  const next = QUALITY_ORDER[(QUALITY_ORDER.indexOf(quality) + 1) % QUALITY_ORDER.length];
  localStorage.setItem(QUALITY_KEY, next);
  const p = new URLSearchParams(location.search);
  p.delete("q");
  location.search = p.toString();
});

await initPhysics();
document.getElementById("loading")?.remove();
const container = document.getElementById("game")!;

if (bench || params.has("solo")) {
  new Game(container, { quality, bench });
} else {
  const choice = await showMenu(params.get("room") ?? "", async (how, name) => NetClient.connect(how, { name }, lag));
  if (choice === "solo") {
    new Game(container, { quality, bench: false });
  } else {
    const net = choice;
    const p = new URLSearchParams(location.search);
    p.set("room", net.code);
    history.replaceState(null, "", `?${p}`);
    document.getElementById("ctp-sub")!.textContent = `Room ${net.code}`;
    const game = new Game(container, { quality, bench: false, net });
    net.onDisconnect = () => game.disconnected();
    addEventListener("beforeunload", () => net.leave());
  }
}

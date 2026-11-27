import { initPhysics } from "../../shared/sim";
import { Game, QUALITY_ORDER, type Quality } from "./game";
import "./style.css";

const QUALITY_KEY = "wobble-isles.quality";
const params = new URLSearchParams(location.search);
const bench = params.has("bench");
const isQuality = (v: string | null): v is Quality => QUALITY_ORDER.includes(v as Quality);
const fromUrl = params.get("q");
const saved = localStorage.getItem(QUALITY_KEY);
const quality: Quality = isQuality(fromUrl) ? fromUrl : isQuality(saved) ? saved : "auto";

// G cycles graphics quality. MSAA can only be chosen when the WebGL context is created, so reload.
addEventListener("keydown", (e) => {
  if (e.code !== "KeyG" || e.repeat) return;
  const next = QUALITY_ORDER[(QUALITY_ORDER.indexOf(quality) + 1) % QUALITY_ORDER.length];
  localStorage.setItem(QUALITY_KEY, next);
  params.delete("q");
  location.search = params.toString();
});

await initPhysics();
document.getElementById("loading")?.remove();
new Game(document.getElementById("game")!, { quality, bench });

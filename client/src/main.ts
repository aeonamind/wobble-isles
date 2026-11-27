import { initPhysics } from "../../shared/sim";
import { Game, type Quality } from "./game";
import "./style.css";

const params = new URLSearchParams(location.search);
const bench = params.has("bench");
const isMobile = matchMedia("(pointer: coarse)").matches;
const q = params.get("q");
const quality: Quality = q === "low" || q === "medium" || q === "high" ? q : isMobile ? "medium" : "high";

await initPhysics();
document.getElementById("loading")?.remove();
new Game(document.getElementById("game")!, { quality, bench });

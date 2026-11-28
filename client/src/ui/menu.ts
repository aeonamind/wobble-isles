// Title menu: name, create a room, join by code, or practise alone.

import { cleanName } from "../../../shared/protocol";
import type { NetClient } from "../net";

const NAME_KEY = "wobble-isles.name";
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

type Connect = (how: { create: true } | { code: string }, name: string) => Promise<NetClient>;

/** Resolves with a connected room, or "solo". */
export function showMenu(prefillCode: string, connect: Connect): Promise<NetClient | "solo"> {
  const form = $<HTMLFormElement>("menu");
  const nameIn = $<HTMLInputElement>("menu-name");
  const codeIn = $<HTMLInputElement>("menu-code");
  const error = $("menu-error");
  const buttons = [...form.querySelectorAll("button")];
  form.hidden = false;
  nameIn.value = localStorage.getItem(NAME_KEY) ?? "";
  codeIn.value = prefillCode.toUpperCase();
  (prefillCode ? codeIn : nameIn).focus();
  codeIn.addEventListener("input", () => (codeIn.value = codeIn.value.toUpperCase().replace(/[^A-Z0-9]/g, "")));

  return new Promise((resolve) => {
    const name = () => {
      const n = cleanName(nameIn.value, "");
      if (n) localStorage.setItem(NAME_KEY, n);
      return n || `Wobbler ${Math.floor(Math.random() * 90 + 10)}`;
    };
    const attempt = async (how: { create: true } | { code: string }) => {
      error.hidden = true;
      buttons.forEach((b) => (b.disabled = true));
      try {
        const net = await connect(how, name());
        form.hidden = true;
        resolve(net);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        error.textContent = /not found|invalid|locked|full/i.test(msg)
          ? "That room doesn't exist or is full. Check the code."
          : "Can't reach the game server. Is it running?";
        error.hidden = false;
        buttons.forEach((b) => (b.disabled = false));
      }
    };
    $("menu-create").onclick = () => void attempt({ create: true });
    form.onsubmit = (e) => {
      e.preventDefault();
      if (codeIn.value.length === 4) void attempt({ code: codeIn.value });
      else {
        error.textContent = "Room codes have 4 characters.";
        error.hidden = false;
        codeIn.focus();
      }
    };
    $("menu-solo").onclick = () => {
      name();
      form.hidden = true;
      resolve("solo");
    };
  });
}

// 4-character room codes that are easy to read out loud: no I/O/0/1.
export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 4;

const active = new Set<string>();

export function generateRoomCode(random: () => number = Math.random): string {
  for (let attempt = 0; attempt < 1000; attempt++) {
    let code = "";
    for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
    if (!active.has(code)) {
      active.add(code);
      return code;
    }
  }
  throw new Error("No free room codes");
}

export function releaseRoomCode(code: string) {
  active.delete(code);
}

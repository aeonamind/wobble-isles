// Desktop app self-update. Releases on GitHub carry a signed latest.json; the app checks it when
// the menu opens and offers the new version. The web game never needs this: the server always
// serves the matching page.

import { isApp } from "./platform";

export interface UpdateOffer {
  version: string;
  notes?: string;
  /** Downloads, installs and restarts. Reports progress 0..1 (or null if the size is unknown). */
  install(onProgress: (p: number | null) => void): Promise<void>;
}

/** Resolves with an available update, or null (also when offline or not in the app). */
export async function checkForUpdate(): Promise<UpdateOffer | null> {
  if (!isApp) return null;
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check({ timeout: 8000 });
    if (!update) return null;
    return {
      version: update.version,
      notes: update.body,
      async install(onProgress) {
        let total = 0;
        let done = 0;
        await update.downloadAndInstall((e) => {
          if (e.event === "Started") total = e.data.contentLength ?? 0;
          else if (e.event === "Progress") {
            done += e.data.chunkLength;
            onProgress(total ? done / total : null);
          }
        });
        const { relaunch } = await import("@tauri-apps/plugin-process");
        await relaunch();
      },
    };
  } catch (e) {
    console.warn("Update check failed:", e);
    return null;
  }
}

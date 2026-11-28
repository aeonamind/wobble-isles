// Wobble Isles desktop app: a native window around the web game. The game itself (rendering,
// physics, netcode) is the same TypeScript client that runs in the browser.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running Wobble Isles");
}

// Wobble Isles desktop app: a native window around the web game. The game itself (rendering,
// physics, netcode) is the same TypeScript client that runs in the browser. The app adds
// self-updating from GitHub Releases (signed with the project's updater key).

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            #[cfg(desktop)]
            app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Wobble Isles");
}

// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri_plugin_shell::ShellExt;

fn main() {
    tauri::Builder::default()
        // Initialize the shell plugin
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // "backend" matches the name we put in tauri.conf.json
            let sidecar_command = app.shell().sidecar("backend").unwrap();
            
            // Start the Python server in the background
            let (_receiver, _child) = sidecar_command.spawn().unwrap();
            
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
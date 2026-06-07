mod keyring;

use std::net::TcpListener;
use std::sync::Mutex;

use serde::Serialize;
use tauri::async_runtime::JoinHandle;
use tauri::{AppHandle, Manager, RunEvent, State};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

const SERVER_SCRIPT_RESOURCE: &str = "resources/server/server.mjs";
const SERVER_LOG_TARGET: &str = "braid-server";

/// All state that has to outlive a single sidecar start. Kept in a single
/// option so url, child, and log task can never disagree.
struct ServerHandle {
    url: String,
    child: CommandChild,
    log_task: JoinHandle<()>,
}

#[derive(Default)]
struct EmbeddedServer(Mutex<Option<ServerHandle>>);

#[derive(Serialize)]
struct ServerInfo {
    url: String,
}

#[tauri::command]
fn get_server_info(state: State<'_, EmbeddedServer>) -> Result<ServerInfo, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let handle = guard
        .as_ref()
        .ok_or_else(|| "embedded server has not started yet".to_string())?;
    Ok(ServerInfo { url: handle.url.clone() })
}

/// Bind to port 0, ask the kernel which port we got, drop the listener.
/// There is an inherent race between releasing the port and the Node
/// sidecar binding it. The window is sub-millisecond, accepted for now.
fn pick_free_port() -> std::io::Result<u16> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    let port = listener.local_addr()?.port();
    drop(listener);
    Ok(port)
}

fn start_embedded_server(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let port = pick_free_port()?;
    let braid_home = app.path().app_data_dir()?.join("workspaces");
    std::fs::create_dir_all(&braid_home)?;

    let server_script = app
        .path()
        .resolve(SERVER_SCRIPT_RESOURCE, tauri::path::BaseDirectory::Resource)?;

    let (mut rx, child) = app
        .shell()
        .sidecar("node")?
        .arg(server_script)
        .env("BRAID_SERVER_PORT", port.to_string())
        .env("BRAID_HOME", braid_home)
        .spawn()?;

    // Drain stdout/stderr so the OS pipe buffer never fills and stalls the
    // sidecar. Lines are forwarded to the Tauri log plugin so they show up
    // in `tauri dev` output and the future debug panel.
    let log_task = tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    log::info!(target: SERVER_LOG_TARGET, "{}", String::from_utf8_lossy(&line).trim_end())
                }
                CommandEvent::Stderr(line) => {
                    log::warn!(target: SERVER_LOG_TARGET, "{}", String::from_utf8_lossy(&line).trim_end())
                }
                CommandEvent::Error(err) => {
                    log::error!(target: SERVER_LOG_TARGET, "{err}")
                }
                CommandEvent::Terminated(payload) => {
                    log::warn!(target: SERVER_LOG_TARGET, "exited (code={:?})", payload.code);
                    break;
                }
                _ => {}
            }
        }
    });

    let url = format!("http://localhost:{port}");
    let state: State<'_, EmbeddedServer> = app.state();
    let mut guard = state.0.lock().map_err(|e| format!("lock poisoned: {e}"))?;
    *guard = Some(ServerHandle { url: url.clone(), child, log_task });

    log::info!("embedded server starting on {url}");
    Ok(())
}

fn stop_embedded_server(app: &AppHandle) {
    let state = app.state::<EmbeddedServer>();
    let mut guard = match state.0.lock() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    };
    if let Some(handle) = guard.take() {
        let _ = handle.child.kill();
        handle.log_task.abort();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_shell::init())
        .manage(EmbeddedServer::default())
        .invoke_handler(tauri::generate_handler![
            get_server_info,
            keyring::keyring_get_token,
            keyring::keyring_set_token,
            keyring::keyring_delete_token,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            if let Err(err) = start_embedded_server(&handle) {
                log::error!("failed to start embedded server: {err}");
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
            stop_embedded_server(app_handle);
        }
    });
}

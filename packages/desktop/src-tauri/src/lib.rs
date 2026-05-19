use std::net::TcpListener;
use std::sync::Mutex;

use serde::Serialize;
use tauri::async_runtime::JoinHandle;
use tauri::{AppHandle, Manager, RunEvent, State};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// Holds the embedded server's listening URL and the child process so the
/// frontend can ask for the URL and the app can clean up on exit.
#[derive(Default)]
struct EmbeddedServer {
    url: Mutex<Option<String>>,
    child: Mutex<Option<CommandChild>>,
    log_task: Mutex<Option<JoinHandle<()>>>,
}

#[derive(Serialize)]
struct ServerInfo {
    url: String,
}

#[tauri::command]
fn get_server_info(state: State<'_, EmbeddedServer>) -> Result<ServerInfo, String> {
    let url = state
        .url
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or_else(|| "embedded server has not started yet".to_string())?;
    Ok(ServerInfo { url })
}

/// Bind to port 0, ask the kernel which port we got, drop the listener.
/// There is an inherent race between releasing the port and the Node
/// sidecar binding it; in practice the window is sub-millisecond and we
/// accept it for simplicity.
fn pick_free_port() -> std::io::Result<u16> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    let port = listener.local_addr()?.port();
    drop(listener);
    Ok(port)
}

fn start_embedded_server(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let port = pick_free_port()?;
    let braid_home = app
        .path()
        .app_data_dir()?
        .join("workspaces");
    std::fs::create_dir_all(&braid_home)?;

    // Server bundle lives at <resource_dir>/resources/server/server.mjs.
    let server_script = app
        .path()
        .resolve("resources/server/server.mjs", tauri::path::BaseDirectory::Resource)?;

    let sidecar = app
        .shell()
        .sidecar("node")?
        .arg(server_script)
        .env("BRAID_SERVER_PORT", port.to_string())
        .env("BRAID_HOME", braid_home);

    let (mut rx, child) = sidecar.spawn()?;

    let url = format!("http://localhost:{port}");
    let state: State<'_, EmbeddedServer> = app.state();
    *state.url.lock().unwrap() = Some(url.clone());
    *state.child.lock().unwrap() = Some(child);

    // Drain stdout/stderr so the OS pipe buffer doesn't fill and stall
    // the server. Lines are forwarded to the Tauri log plugin so they
    // surface in `tauri dev` output and in the debug menu.
    let handle = tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => log::info!(target: "braid-server", "{}", String::from_utf8_lossy(&line).trim_end()),
                CommandEvent::Stderr(line) => log::warn!(target: "braid-server", "{}", String::from_utf8_lossy(&line).trim_end()),
                CommandEvent::Error(err) => log::error!(target: "braid-server", "{err}"),
                CommandEvent::Terminated(payload) => {
                    log::warn!(target: "braid-server", "exited (code={:?})", payload.code);
                    break;
                }
                _ => {}
            }
        }
    });
    *state.log_task.lock().unwrap() = Some(handle);

    log::info!("embedded server starting on {url}");
    Ok(())
}

fn stop_embedded_server(app: &AppHandle) {
    let state = app.state::<EmbeddedServer>();
    let mut guard = match state.child.lock() {
        Ok(g) => g,
        Err(_) => return,
    };
    if let Some(child) = guard.take() {
        // kill() returns the process's exit status; we don't care.
        let _ = child.kill();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build())
        .plugin(tauri_plugin_shell::init())
        .manage(EmbeddedServer::default())
        .invoke_handler(tauri::generate_handler![get_server_info])
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

use keyring::Entry;

const SERVICE: &str = "com.braid.desktop.tokens";

fn entry(remote_id: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, remote_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn keyring_get_token(remote_id: String) -> Result<Option<String>, String> {
    match entry(&remote_id)?.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(err) => Err(err.to_string()),
    }
}

#[tauri::command]
pub fn keyring_set_token(remote_id: String, token: String) -> Result<(), String> {
    entry(&remote_id)?
        .set_password(&token)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn keyring_delete_token(remote_id: String) -> Result<(), String> {
    match entry(&remote_id)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(err) => Err(err.to_string()),
    }
}

// Map the running host, or the BRAID_BUNDLE_TARGET override,
// to the npm-style triple kuzu uses for its prebuilt binaries.
// This is separate from the Rust triple the Tauri sidecar download uses,
// since kuzu publishes with npm naming while Tauri expects Rust naming.
export function targetTriple({ platform, arch, override } = {}) {
  if (override)
    return override
  if (platform === 'darwin' && arch === 'arm64')
    return 'darwin-arm64'
  if (platform === 'darwin' && arch === 'x64')
    return 'darwin-x64'
  if (platform === 'linux' && arch === 'arm64')
    return 'linux-arm64'
  if (platform === 'linux' && arch === 'x64')
    return 'linux-x64'
  if (platform === 'win32' && arch === 'x64')
    return 'win32-x64'
  throw new Error(`Unsupported bundle target: ${platform}-${arch}`)
}

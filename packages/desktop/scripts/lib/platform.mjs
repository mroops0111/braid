/**
 * Map the running host (or BRAID_RUST_TARGET override) to the Rust target
 * triple Tauri expects in sidecar binary filenames.
 *
 * Separate from the npm-style triple used for kuzu prebuilts: Tauri's
 * externalBin lookup is keyed on the Rust convention, kuzu is keyed on the
 * npm convention. Both mappings live close to where each tool consumes them.
 */
export function rustTargetTriple({ platform, arch, override } = {}) {
  if (override)
    return override
  if (platform === 'darwin' && arch === 'arm64')
    return 'aarch64-apple-darwin'
  if (platform === 'darwin' && arch === 'x64')
    return 'x86_64-apple-darwin'
  if (platform === 'linux' && arch === 'arm64')
    return 'aarch64-unknown-linux-gnu'
  if (platform === 'linux' && arch === 'x64')
    return 'x86_64-unknown-linux-gnu'
  if (platform === 'win32' && arch === 'x64')
    return 'x86_64-pc-windows-msvc'
  throw new Error(`Unsupported host: ${platform}-${arch}`)
}

/**
 * For each supported Rust target, return the matching nodejs.org tarball
 * filename, its archive format, and the path to the `node` executable
 * inside the extracted folder.
 */
export function nodeDistInfo(triple, version) {
  switch (triple) {
    case 'aarch64-apple-darwin':
      return { file: `node-v${version}-darwin-arm64.tar.gz`, format: 'tgz', binPath: 'bin/node' }
    case 'x86_64-apple-darwin':
      return { file: `node-v${version}-darwin-x64.tar.gz`, format: 'tgz', binPath: 'bin/node' }
    case 'aarch64-unknown-linux-gnu':
      return { file: `node-v${version}-linux-arm64.tar.xz`, format: 'txz', binPath: 'bin/node' }
    case 'x86_64-unknown-linux-gnu':
      return { file: `node-v${version}-linux-x64.tar.xz`, format: 'txz', binPath: 'bin/node' }
    case 'x86_64-pc-windows-msvc':
      return { file: `node-v${version}-win-x64.zip`, format: 'zip', binPath: 'node.exe' }
    default:
      throw new Error(`No Node distribution mapping for ${triple}`)
  }
}

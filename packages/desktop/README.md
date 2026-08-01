# @braidhq/desktop

Braid ships to non-technical users as one double-clickable app. `@braidhq/desktop` is the Tauri 2 shell that wraps `@braidhq/studio` (the UI) and, in its full flavor, a Node sidecar running `@braidhq/server` (the backend), packaged as a single Mac, Windows, or Linux installer.

## Role

The shell owns the window and the process lifecycle. It holds no product logic of its own, the UI lives in Studio and the backend lives in Server.

- **The Window**: A thin Rust host that opens the window, loads Studio's built assets, and exposes a handful of Tauri commands to the UI.
- **The Sidecar**: In the full build it spawns the bundled Node runtime to run Server on a pinned local port, drains the child's stdout and stderr into the Tauri log plugin, and kills it on exit.
- **The Keychain**: Three commands (`keyring_get_token`, `keyring_set_token`, `keyring_delete_token`) keep per-remote auth tokens in the OS keychain, keyed by remote id, so tokens never touch disk in plaintext.

## Structure

The package has no application source of its own. What lives here is the Rust host, the Tauri config, and the build scripts that stage Studio and Server into one bundle.

```
packages/desktop/
├── package.json                  scripts: dev, dev:remote, bundle, bundle:remote
├── scripts/
│   ├── prepare-sidecar.mjs       rebuild the server bundle, stage it, fetch the Node sidecar
│   └── lib/platform.mjs          host to Rust-triple and nodejs.org tarball mapping
├── test/scripts/lib/             vitest unit tests for the pure helpers
└── src-tauri/
    ├── Cargo.toml                crate braid-desktop
    ├── tauri.conf.json           window, externalBin, resources (full build)
    ├── tauri.remote.conf.json    overlay that drops the sidecar (remote build)
    ├── capabilities/             core plus scoped shell:allow-execute for the sidecar
    ├── binaries/                 node-<triple>, gitignored, downloaded at build time
    ├── resources/server/         copied server bundle, gitignored, regenerated
    └── src/
        ├── main.rs               Windows console suppression, entry point
        ├── lib.rs                start, track, and kill the Node sidecar
        └── keyring.rs            OS keychain store for per-remote auth tokens
```

- **scripts/platform.mjs**: Pure host mapping with no I/O, so it is unit-tested. It translates the running host, or an override, into the Rust target triple Tauri expects and the matching nodejs.org tarball. It is the only code in this package with real logic to cover.
- **scripts/prepare-sidecar.mjs**: The I/O orchestrator that rebuilds Server, copies the bundle into resources, and downloads the Node runtime. It runs before `tauri dev` and `tauri build`, so a stale turbo cache never leaks into an installer.
- **src/lib.rs**: The Tauri entry. It decides whether to start the sidecar, wires the log drain, and tears the child down on exit. `keyring.rs` and `main.rs` sit beside it as the keychain commands and the platform entry point.

## Build chain

`prepare-sidecar` is wired into `beforeDevCommand` and `beforeBuildCommand`, so it runs automatically and produces everything the shell embeds, in order.

1. `@braidhq/server build` compiles the server to `dist/` with `tsc`.
2. `@braidhq/server bundle` runs esbuild, copies the kuzu prebuilt, and writes a trimmed `package.json` into `bundle/`.
3. `prepare-sidecar` copies that bundle into `src-tauri/resources/server/`, then downloads the matching Node runtime into `src-tauri/binaries/`.
4. `tauri build` compiles the Rust crate, embeds the `externalBin` sidecar and the resources, and packages the installer.

Cross-target builds set `BRAID_RUST_TARGET` for Tauri and `BRAID_BUNDLE_TARGET` for the server bundle. Both mappings are covered by the tests under `test/scripts/lib/`.

## Packaging modes

The same shell and app identity (`Braid`, `io.braidhq.desktop`) ship in two flavors, so installing the remote-only build replaces a full one rather than sitting beside it.

- **Full** (`bundle`): embeds the Node sidecar and the server bundle, so the app runs a local server on port 4321 with no network needed.
- **Remote-only** (`bundle:remote`): builds with the `tauri.remote.conf.json` overlay that empties `externalBin` and `resources` and skips `prepare-sidecar`, so the installer is smaller and the shell never starts a local server. Studio talks to a remote server picked in Settings.

At runtime the shell starts the sidecar only when the server resource is present, which is exactly what the remote-only build omits. A full build can also be forced remote for one launch by setting `BRAID_DESKTOP_REMOTE_ONLY=1`, which is how `dev:remote` runs a local dev build without a sidecar.

## Development

```sh
pnpm --filter @braidhq/desktop dev            # full: local server plus Studio with HMR
pnpm --filter @braidhq/desktop dev:remote     # remote-only: Studio against a configured remote
pnpm --filter @braidhq/desktop bundle         # full installer, outputs under src-tauri/target/release/bundle/
pnpm --filter @braidhq/desktop bundle:remote  # remote-only installer
```

The first run is slow, a cold Rust compile plus the one-time Node download. Later runs reuse cached artifacts and start in seconds.

## Server URL resolution

Studio resolves the URL it talks to in `packages/studio/src/lib/serverUrl.ts`, in order.

1. The active remote chosen in Settings, whenever it is not Local.
2. The embedded sidecar URL, read once from the `get_server_info` Tauri command in a desktop runtime.
3. `VITE_BRAID_API_URL`, or the `http://localhost:4321` default used by web dev.

The remote-only build has no sidecar, so `get_server_info` returns nothing and resolution falls through to the active remote.

## Dependencies

Desktop sits at the outer edge and is a leaf, nothing imports it.

- **Depends On**: `@braidhq/studio` for the UI assets and `@braidhq/server` for the sidecar backend, both built into the bundle rather than imported as source.
- **Bundles**: The official Node runtime, downloaded per target from nodejs.org at build time and shipped as the Tauri sidecar.

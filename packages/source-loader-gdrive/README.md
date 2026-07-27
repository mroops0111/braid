# @braidhq/source-loader-gdrive

Braid keeps a product's intent and its code aligned in one knowledge graph, and lets plugins feed that graph from outside sources. `@braidhq/source-loader-gdrive` is the plugin that exports Google Docs from a Drive folder as markdown, so a team's design docs become a Braid source.

## Role

The drive loader walks a Drive folder, exports every Google Doc it finds as markdown, and keeps a manifest so later syncs touch only what changed.

- **The Export**: Each doc is exported to `<destination>/<sanitised-title>/index.md`, and its inlined base64 images are decoded into sibling files, so the markdown stays readable for humans and models.
- **The Manifest**: A `.braid-manifest.json` records each doc's id, title, and modified time, so sync can add, update, rename, or remove docs against the prior state instead of re-downloading everything.
- **The Auth**: A fresh OAuth access token is resolved per workspace and source through an injected callback, so credentials stay in the composition root, never in config.

## Structure

```
src/
├── GoogleDriveLoader.ts   the gdrive loader, config, walk, export, manifest-diff sync
├── driveClient.ts         the Drive REST client, list children and export a doc
├── Manifest.ts            the on-disk sync-state manifest, read and write
└── index.ts               re-exports the factory and its config type
```

- **GoogleDriveLoader**: The `createGoogleDriveLoader` factory. It walks the folder, filters by title, exports each doc, extracts inline images, and diffs against the manifest on sync.
- **driveClient**: The thin Drive REST wrapper, listing folder children and exporting a doc to a given mime type.
- **Manifest**: The read and write of `.braid-manifest.json`, the record sync diffs against.

## Export and Layout

Drive folder hierarchy is flattened. Every matched doc lands in its own directory directly under the destination, named from the sanitised Drive title, so two docs that sanitise to the same name collide and one must be renamed in Drive. Auto-created `Copy of` duplicates are skipped, and title `include` and `exclude` regexes narrow what is exported while subfolders are still traversed when `recursive` is set.

Only Google Docs are in scope. Sheets, Slides, Drawings, and Forms are left for a different plugin. The `folderId` alias `root` is rejected outright, since it would mirror an entire My Drive.

## Boundaries

- **Owns Its Directory**: The destination and its manifest are the loader's to write. Provision wipes and rebuilds it, sync reconciles it against Drive.
- **No Credentials On Disk**: The access token is resolved at run time through the injected callback. Only exported markdown and images land in the destination.
- **A Plugin, Not A Service**: It implements core's `SourceLoader` port through the sdk factory, and depends on the host to supply OAuth token resolution.

## Dependencies

- **Depends On**: `@braidhq/core` for the port, `@braidhq/schema` for shared types, `@braidhq/sdk` for the factory, and `zod`.
- **Consumed By**: The server composition root, where `composeFsApp` registers the gdrive loader and wires `resolveAccessToken` to its OAuth store.

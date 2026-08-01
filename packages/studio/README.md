# @braidhq/studio

Braid keeps a product's intent and its code aligned in one knowledge graph. `@braidhq/studio` is the web UI a human uses to see that graph and steer it. It renders the graph, the review queues that gate every change to it, and the skill runs that produce those changes, talking to the server over REST and a live event stream.

## Role

Studio is the presentation layer. It reads and displays server state, and it turns a reviewer's decisions into API calls, but it holds no authority of its own.

- **The Surfaces**: The graph canvas and table, the Proposals and Clarification review queues, the Actions and Batch skill panels, Activity, and History, one page per workspace surface.
- **The Live Loop**: A server-sent event stream that invalidates cached queries as runs finish and proposals apply, so the UI reflects server state without polling.
- **The Advisory Gate**: A client-side policy layer that disables and hides what a viewer may not do, mirroring the server's rules for a quiet UI while the server stays the real enforcer.

## Structure

The source is grouped by kind, not by feature. Pages compose components, components read through hooks in `lib`, and `policy` gates them.

```
src/
├── main.tsx        boot: server URL, tokens, then mount
├── App.tsx         auth gate, layout, routing, context providers
├── lib/            server client, data hooks, auth, routing state
├── pages/          one surface per file, plus settings/
├── components/     app widgets, graph/, ui/, SkillTranscript/
└── policy/         client-side capability checks
```

- **lib**: The non-visual core. The REST client (`api.ts`), the SSE streams (`sse.ts`, `useWorkspaceEvents.ts`), the TanStack Query hooks (`queries.ts`), the run store that outlives page mounts (`runStore.ts`), per-remote auth and tokens, and the hash-routing state.
- **pages**: One file per surface, fed a `workspaceId`. Every page is workspace-scoped except `Login` and `Settings`.
- **components**: App-level widgets, the `graph/` canvas and table layer over `@xyflow/react` and `dagre`, the `SkillTranscript/` renderer for a live `SkillEvent` stream, and the `ui/` shadcn and Radix primitives.
- **policy**: The capability registry and checks a component asks through `useWorkspacePolicy`, kept in lock-step with the server's own resolution.

## Data Flow

State comes from the server and returns to it as intent. Studio caches and renders in between, and never mutates the graph on its own.

- **Reads**: TanStack Query fetches through `api.ts`. A per-workspace SSE subscription invalidates the matching query keys as events arrive, so a finished run or applied proposal refreshes the view.
- **Writes are proposals**: The canvas never edits the graph directly. A skill run emits a `Proposal`, a reviewer sees its diff and validation issues, and applying it POSTs to the server, which commits and emits the event that refreshes the graph.
- **Runs stream**: `runStore` holds in-flight and completed runs outside React state, so leaving and returning to a page keeps the transcript and lets a multi-turn conversation resume.

## Design

Studio follows Linear: dark-first, compact, keyboard-first, with a purple accent. The look lives in tokens, so `src/styles.css` is the single source of truth for every colour, radius, and size. This section is the guideline, not the numbers.

- **Tokens, Not Values**: Style with semantic tokens (`bg-background`, `bg-card`, `text-muted-foreground`, `border-border`) and the named type scale. Never inline a hex, an `oklch(...)`, or an arbitrary `text-[13px]`. A missing value is added to `styles.css`, not hardcoded in a component.
- **Type**: Geist for the UI, Geist Mono for identifiers, ids, paths, args, and skill names. Four sizes only: `text-2xs` for labels and metadata, `text-xs` for body, `text-sm` for emphasis, `text-base` for headers.
- **Density**: An 8px rhythm. The sidebar recesses below the page, cards lift above it, and rows breathe. Dense like a tool, never cramped.
- **Casing**: Title Case for buttons and tabs, UPPERCASE for small section labels, Sentence case for descriptions and placeholders, and lowercase for status text since it mirrors the schema enum.
- **Reuse the Patterns**: A selectable row shows a 3px purple bar on its left edge when active (`ListRow`). Empty states go through `EmptyState`, domain status through `StatusBadge`, and a new primitive comes from shadcn in `ui/` before it is hand-rolled.
- **Restrained Motion**: `transition-colors duration-150` on hover, `tw-animate-css` for enters, and nothing that bounces, scales, or parallaxes. Reduced-motion is honoured globally.
- **Accessibility**: A visible focus ring, a pointer cursor on every control, and an `aria-label` on icon-only buttons. The same code ships to the Tauri desktop and mobile shells, so keep touch targets near 44px where the layout allows.
- **No Em-Dashes**: Never `—` or `–` in a user-facing string. Use a colon, a comma, or two sentences.

## Boundaries

These are the rules that keep Studio a thin, honest client. They are enforced in review.

- **Schema Only**: Studio imports `@braidhq/schema` and nothing else from the monorepo. It never reaches into `core` or `server`.
- **The Server Decides**: Client policy gates the UI for a calm experience, but the server enforces every rule. A rejected request surfaces as an error or a return to login, never a silent success.
- **No Direct Mutation**: Every graph change flows through a proposal a human applies. There is no path from a canvas gesture to a committed edge.
- **URL Is the Route**: Hash-based routing holds the active workspace and surface. There are no query params, and navigation replaces rather than stacks history.
- **Per-Remote Auth**: Each server has its own bearer token, in web `localStorage` or the Tauri keyring. Switching the active remote clears the query cache so no stale data bleeds across.

## Dependencies

Studio sits at the edge of the monorepo, downstream of the schema and the running server.

- **Depends On**: `@braidhq/schema` for every shape it renders, a live `@braidhq/server` to talk to, and the UI stack: `react`, `@tanstack/react-query`, `@xyflow/react` with `dagre`, `mermaid`, `react-markdown`, `cmdk`, Radix and `tailwindcss`, and `@tauri-apps/api` for the desktop shell.
- **Consumed By**: The `desktop` Tauri shell, which serves the built assets, and any browser pointed at a Braid server.

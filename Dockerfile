# Braid server, serving Studio from the same origin.
#
# The image carries three binaries the server shells out to. `git` for the git
# source loader, `uvx` for the braid-core MCP gateway a skill talks through,
# and `claude` for the default agent. Without them the server starts, then
# fails the first time anyone runs a skill.
#
# It runs from source under tsx rather than from the esbuild bundle, because
# tsx keeps each package's own module identity, which is what the skill and
# plugin lookups resolve against.

# ---------------------------------------------------------------------------
# deps: install the workspace and build the UI
# ---------------------------------------------------------------------------
FROM node:20-slim AS deps
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# pnpm asks before clearing a modules directory, and there is no TTY to answer.
ENV CI=true
RUN corepack enable

# kuzu compiles a native addon during install.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /repo

# `pnpm fetch` resolves from the lockfile alone, so the dependency layer
# survives any source change. The root manifest comes with it, since that is
# where corepack reads the pinned pnpm version from.
COPY package.json pnpm-lock.yaml ./
RUN pnpm fetch

COPY . .
RUN pnpm install --offline --frozen-lockfile
RUN pnpm --filter @braidhq/studio build

# ---------------------------------------------------------------------------
# uv: fetch uvx here so curl never enters the runtime
# ---------------------------------------------------------------------------
FROM node:20-slim AS uv
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN curl -LsSf https://astral.sh/uv/install.sh | sh

# ---------------------------------------------------------------------------
# runtime
# ---------------------------------------------------------------------------
FROM node:20-slim AS runtime
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

# System binaries the server shells out to.
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=uv /root/.local/bin/uv /usr/local/bin/uv
COPY --from=uv /root/.local/bin/uvx /usr/local/bin/uvx
RUN npm install -g @anthropic-ai/claude-code@2

WORKDIR /repo
COPY --from=deps /repo /repo

# Where state lives. Everything that must survive a redeploy sits here, the
# source mirrors, the graph, the artifacts, and each workspace's git history.
ENV BRAID_HOME=/data
ENV BRAID_SERVER_PORT=4321

# Serving the UI from this process keeps a deployment on one origin.
ENV BRAID_STUDIO_ROOT=/repo/packages/studio/dist

# Safe defaults an operator would otherwise have to remember.
# The library trusts every caller by default, which suits a laptop and not a
# shared host, and the pretty log transport cannot resolve outside a dev tree.
ENV BRAID_LOCAL_TRUST=false
ENV BRAID_LOG_PRETTY=false

# The server writes mirrors and git history as itself, so it owns its data.
RUN useradd --system --create-home --uid 10001 braid \
  && mkdir -p /data \
  && chown -R braid:braid /data /repo
USER braid

VOLUME ["/data"]
EXPOSE 4321

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.BRAID_SERVER_PORT||4321)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["pnpm", "--filter", "@braidhq/server", "start"]

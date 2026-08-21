# @braidhq/source-loader-mcp

Mirrors an API-backed source into markdown by calling one MCP tool until its
pages run out. One file per item, which is what makes an issue tracker or a
wiki a tracked source rather than a lookup an agent happens to make mid-run.

## The Shape It Expects

The loader knows a tool name and where the parts of a reply live. Nothing else.
Both are configuration, and the defaults describe one envelope:

```text
the tool takes
  { "since": "2026-01-01T00:00:00Z", "cursor": "abc", "limit": 100 }
and answers with
  { "items": [{ "id": "1", "title": "…", "body": "…", "updatedAt": "…" }],
    "nextCursor": "def" }
```

Point this at a server shaped that way and the whole config is a URL:

```yaml
kind: filesystem
id: issues
role: intent
path: ./intents/issues
loader:
  kind: mcp
  config:
    url: https://gateway.internal/redmine/mcp
    headers:
      Authorization: Bearer ${REDMINE_TOKEN}
```

Point it at a server you do not control and name its shape instead:

```yaml
config:
  url: https://jira.internal/mcp
  tool: search_issues
  response:
    items: data.records
    cursor: data.next
  item:
    id: key
    title: summary
    body: description
    updatedAt: touched
```

Each group carries one rule, which is why none of the keys need a suffix.
`arguments` names arguments the tool takes, `response` names keys in the reply,
and `item` names keys on one item. Every path may be dotted.

`${VAR}` in `url` and in any header resolves against the server's environment,
so a credential never lands in `PRODUCT.md`.

## What Lands On Disk

One `<id>.md` per item. Frontmatter carries every scalar the item has, not only
the mapped ones, so a status or an assignee reaches the agent without being
configured. The three mapped fields are also written under canonical names, so
a reader sees `title` whether the server called it `subject` or `summary`.

An item is written only when its rendering differs, so an untouched item stays
byte-identical across syncs and the fingerprints downstream do not churn.

## Incremental Reads

The newest `updatedAt` seen becomes the next sync's floor, recorded in
`.braid-mcp-cursor.json` beside the documents. The leading dot keeps it out of
the unit listing.

The mark is stored against the URL and tool it came from, so retargeting a
source re-reads it whole instead of silently skipping everything older.

Starting from a date rather than the whole history is the tool's own business,
through a default on its `since` argument. Nothing here needs to know.

## Two Things To Know

**Paging is walked here.** A gateway maps one tool call onto one upstream
request and does not loop. The walk stops at `maxPages`, and reports
`truncated`, so a server that always answers with a cursor cannot spin forever.
A repeated cursor is treated as an error rather than a ceiling, since it means
paging cannot advance at all.

**A failed call arrives on its own channel.** MCP reports a tool failure as
`isError` with a shape the server authors, never as the configured envelope. It
is raised, because a sync that quietly mirrors nothing is worse than one that
stops.

## Transport

Streamable HTTP only. The MCP server is a process the operator runs, so this
speaks to it and never manages its lifetime. Handling stdio would put spawning,
timeouts, and orphan reaping inside the Braid server for a case nobody has
asked for yet.

## A Note On The Name

`loader.kind: mcp` is not the same as `kind: mcp`, the source kind in the
schema. A source using this loader is a `filesystem` source, because what it
produces is a directory of files. Only the way that directory gets filled is
MCP. The two never appear in the same position.

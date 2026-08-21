# Shaping GitHub Into The Envelope

A worked example of the adaptation this loader expects, against a real API.
Nothing about Braid appears in GitHub and nothing about GitHub appears in
Braid. `gateway.yml` is the whole adapter.

Useful for checking the loader against something other than a fixture, and as
a template for shaping any REST API into the same convention.

## Running It

```bash
GH_TOKEN=$(gh auth token) uvx openapi-mcp-gateway --config gateway.yml
```

Then point a source at `http://127.0.0.1:8931/github/mcp`. The whole loader
config is that URL, because the tool already answers in the default shape.

`--dry-run` validates the config and the shaping without serving.

## What The Shaping Does

`strategy: replace` throws away the endpoint's real parameters and advertises
only `since`, `cursor`, and `limit`. The `request` expression maps those onto
what GitHub actually takes, and pins the repository and sort order. The
`response` expression turns a bare array into `{items, nextCursor}` and renames
each field.

`policy.allow` keeps everything else in the spec unreachable.

## Why Paging Walks Timestamps

GitHub pages with `page` and reports the next one in a `Link` header, and a
response expression is given the body alone. There is no page number in the
body and no total to compute one from, so a page cursor cannot be produced.

So the walk uses GitHub's own `since` instead, with the list sorted oldest
first, and the last item's timestamp as the cursor. A full page means more
remain. That costs something worth knowing: the page size is pinned inside the
expression rather than passed by the caller, so `limit` is decorative here, and
boundary items repeat because `since` is inclusive. Repeats are written as
unchanged, so they cost a comparison and nothing else.

This only works on an endpoint that offers a monotonic sort key. Tracked
upstream as openapi-mcp-gateway issue 75.

## The Spec

`github-issues.yaml` describes the one endpoint, rather than pulling GitHub's
full description, which is large enough that fetching it would test the gateway
rather than this loader.

# docketwatch — Build Report (Batch 22)

Rebuild of the `regulationsgov-mcp` MCP server (PyPI
v2.0.9; registry record
`com.1102tools/regulations-gov-mcp`) from the firsthand
spec in `specs-batch22/docketwatch.md`. Built 2026-10-27.

## Identity

- npm: `@reneturcios/docketwatch` @ 0.1.0, bin
  `docketwatch` → `dist/cli.js`
- MCP Registry name: `io.github.CloudCorpRecords/docketwatch`
  (matches `package.json` `mcpName`, `server.json` `name`,
  and the Dockerfile `io.modelcontextprotocol.server.name`
  label)
- server.json description (94 chars, verified):
  "Track Regulations.gov dockets, documents and public
  comments; open comment periods, FAR cases."
- server.json: npm package entry carries `"version":
  "0.1.0"`; the OCI entry
  (`ghcr.io/cloudcorprecords/docketwatch:0.1.0`) carries
  **no** `version` field (verified).

## Files (19-file factory set, per TEMPLATE.md §2)

package.json, server.json, Dockerfile, tsconfig.json
(byte-identical to builds/fairdraw/tsconfig.json, verified
with `cmp`), .gitignore, package-lock.json, README.md
(fresh prose), LICENSE (MIT, © 2026 Rene Turcios),
CHANGELOG.md (single 0.1.0 entry dated 2026-10-27),
src/index.ts, src/cli.ts, src/mcp.ts, src/types.ts,
src/docket.ts (core), test/docket.test.ts, and the four
workflows under .github/workflows/ (publish-container
adapted: IMAGE ghcr.io/cloudcorprecords/docketwatch, smoke
assertion on server name `docketwatch`). Plus this
BUILD-REPORT.md and the parity-out/ artifacts.
Total: 20 files (19 factory + this report).

## Tools built (9)

`search_documents`, `get_document_detail`,
`search_comments`, `get_comment_detail`, `search_dockets`,
`get_docket_detail`, `open_comment_periods`,
`far_case_history`, `get_access_status`.

## Implementation

- `src/mcp.ts`: low-level `Server` API
  (`sdk/server/index.js` + `StdioServerTransport`,
  handlers for `ListToolsRequestSchema` /
  `CallToolRequestSchema` from `sdk/types.js`), explicit
  JSON-schema literals for all 9 tools; no McpServer/zod
  registration. The served tools/list was verified
  deep-equal to the parity fixture (name, description
  and inputSchema for every tool, in order).
- `src/docket.ts`: Regulations.gov API v4 client. All
  upstream access goes through an injectable fetch; the
  base URL defaults to `https://api.regulations.gov/v4`
  (env `REGULATIONS_GOV_API_BASE`, injectable) and the
  clock used by `open_comment_periods` is injectable.
  The API key (env `REGULATIONS_GOV_API_KEY`, injectable)
  is sent as the `X-Api-Key` header. Flat arguments map
  to the documented `filter[...]` parameters
  (`search_term` → `filter[searchTerm]`, `agency_id` →
  `filter[agencyId]`, `docket_id` → `filter[docketId]`,
  `comment_on_id` → `filter[commentOnId]`, `posted_date`
  → `filter[postedDate]`, `posted_date_gte` →
  `filter[postedDate][ge]`, `posted_date_lte` →
  `filter[postedDate][le]`, `last_modified_date_gte` →
  `filter[lastModifiedDate][ge]`), plus `sort`,
  `page[number]`, `page[size]`; filter values pass
  through unchanged (case-sensitive). Plain search and
  detail calls return the upstream JSON verbatim.
  `get_document_detail` sends `include=attachments` only
  when `include_attachments` is true.
- Missing key: when no key is configured, every data
  tool fails (isError) with the pinned text
  `REGULATIONS_GOV_API_KEY is not set. Get a free
  api.data.gov key at https://api.data.gov/signup and
  set REGULATIONS_GOV_API_KEY, then retry.` and makes no
  request. `get_access_status` never calls out and
  returns `{"configured": true}` or
  `{"configured": false}` without revealing the key.
- Errors: non-2xx → `regulations.gov error: HTTP
  <status>`, with the suffix ` (check
  REGULATIONS_GOV_API_KEY; free keys from api.data.gov)`
  appended on 401/403 only; a throwing fetch →
  `regulations.gov unreachable`. Validation runs before
  any request with the pinned strings (`document_id must
  be a non-empty string`, `comment_id must be a non-empty
  string`, `docket_id must be a non-empty string`,
  `case_number must be a non-empty string`).
- CLI: one subcommand per tool taking a JSON argument
  string (`get_access_status` takes none), `mcp`,
  `--version`; unknown subcommand → usage on stderr,
  exit 2; isError results exit 1.

## Compositions (labelled) and the noted gap

- `open_comment_periods` — **composition (labelled):**
  pages `GET /documents` with
  `filter[postedDate][ge]` = 180 days before today (the
  scan window, a labelled local choice; no `sort` is
  assumed — pages are read in API order), at most 10
  pages of 250. Documents whose
  `attributes.commentEndDate` is today or later are
  kept, sorted ascending by that date, and `limit`
  (default 50) is applied. Returns
  `{"results": [...], "complete": <every scanned page
  was read>, "truncated": <results cut by limit>}`.
- `far_case_history` — **composition (labelled):**
  `GET /dockets/{case_number}` plus every page of
  `GET /documents?filter[docketId]={case_number}`
  (page size 250, at most 10 pages). Returns
  `{"docket": <docket response verbatim>, "documents":
  [<data arrays of all pages, concatenated>],
  "complete": <all document pages were read>}`.
- **Noted type-filter gap:** the API documentation read
  for this spec did not pin a document-type or
  docket-type filter parameter name, so no type filter
  argument is exposed. The case-sensitivity note is
  still honoured for the filters that are exposed.

## Verification (all real, run 2026-10-27)

- `npm run build` (tsc): exit 0. `npx tsc --noEmit`:
  exit 0.
- `npm test`: **27 tests, 27 pass, 0 fail** — fake fetch
  + fake clock only, no live network. Covers the full
  filter mapping for all three search tools (including
  the `X-Api-Key` header and the injected base URL),
  verbatim returns, `include=attachments` on/off,
  missing-key refusal with no request for data, detail
  and composition tools, the exact setup text, every
  validation message with no request made, HTTP error
  mapping (500 plain, 401/403 with suffix, 404 without),
  throwing-fetch → unreachable, `get_access_status`
  true/false without revealing the key or calling out,
  and both compositions: open-period filtering (past /
  today / future / missing end date), soonest-first
  order, the 180-day scan window and page-size-250
  request with no assumed sort, limit + truncation,
  paging to a short page (complete) and the 10-page cap
  (incomplete); FAR docket-verbatim + concatenated
  document pages, multi-page and cap cases, and docket
  failure propagation with no document fetch.
- `node dist/cli.js --version`: `0.1.0`; unknown
  command: usage on stderr, exit 2; missing-key and
  validation failures via the CLI exit 1 with the pinned
  error text; `get_access_status` prints
  `{"configured":false}` with no key and
  `{"configured":true}` with one set.
- Parity: `python3 harness/parity.py --original
  harness/fixtures/regulationsgov-mcp-tools-original.json
  --rebuild "stdio:node builds/docketwatch/dist/cli.js
  mcp" --out builds/docketwatch/parity-out` →
  **verdict=PASS parity_pct=100.0, 9/9 tools identical,
  no missing, no extra, no schema diffs**.
- Lockfile: Route 3 only — clean temp dir with
  package.json alone, `npm install --package-lock-only
  --ignore-scripts --offline`; parses, name
  `@reneturcios/docketwatch`, **128 package entries**.
  Dependencies installed in the build dir with
  `npm install --offline --ignore-scripts` (exit 0).

## Gap notes / deviations

- No live Regulations.gov call was made; behaviour is
  proven against fake fetch and a fake clock only.
- The type-filter gap above is a spec-pinned omission,
  not an oversight.
- Composition completeness follows the paged scan: a
  scan that ends on a short page (or the API's reported
  last page) is `complete`; hitting the 10-page cap on
  full pages is not.
- No push, no publish.

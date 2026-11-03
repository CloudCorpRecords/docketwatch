# docketwatch

Follow the federal rulemaking record without living in a
browser tab. docketwatch talks to the Regulations.gov
API v4 — the public record of dockets, documents and
public comments behind rules published by US agencies —
and answers with the API's own JSON, so a search result
here is the same payload you would get from the API
directly.

You will need a free api.data.gov key:

```bash
export REGULATIONS_GOV_API_KEY="<your key>"
```

Get one at https://api.data.gov/signup. The key goes out
as the `X-Api-Key` header on every data call. If the
variable is unset the server still starts and lists its
tools, but every data tool replies with setup
instructions and makes no request at all — handy for
checking that a client is wired up before a key exists.
`get_access_status` is the exception: it never calls
out and reports only `{"configured": true}` or
`{"configured": false}`, never the key itself. The base
URL defaults to `https://api.regulations.gov/v4` and
can be overridden with `REGULATIONS_GOV_API_BASE`.

The nine tools:

- `search_documents` — find documents (proposed rules,
  rules, notices, supporting material) by keyword,
  agency, docket and posted/modified date windows.
- `get_document_detail` — one document in full; pass
  `include_attachments: true` to ask the API to include
  its attachments.
- `search_comments` — search the public comments by
  keyword, agency, docket, or the document commented on.
- `get_comment_detail` — one comment's full text and
  submitter information.
- `search_dockets` — search rulemaking and
  nonrulemaking dockets by keyword or agency.
- `get_docket_detail` — one docket's metadata,
  abstract and RIN.
- `open_comment_periods` — **composition (labelled):**
  not a single API call. It pages through documents
  posted in the last 180 days (the scan window is a
  local choice), keeps those whose comment period ends
  today or later, and returns them soonest-closing
  first alongside `complete` and `truncated` flags.
- `far_case_history` — **composition (labelled):**
  fetches a FAR/DFARS case docket (for example
  `FAR-2023-0008`) together with every page of that
  docket's documents, concatenated, plus a `complete`
  flag saying whether all pages were read.
- `get_access_status` — the key check described above.

Search arguments are flat names that map onto the
API's documented `filter[...]` parameters, with `sort`,
`page[number]` and `page[size]` for ordering and
paging. Filter values are case-sensitive — the API
treats `EPA` and `epa` differently — and docketwatch
passes them through unchanged.

One honest gap: the API documentation used for this
build does not pin a document-type or docket-type
filter parameter name, so no type filter argument is
exposed. Keyword, agency, docket and date filters cover
the documented surface.

## CLI

Each tool is a subcommand taking one JSON argument
string (`get_access_status` takes none):

```bash
npx @reneturcios/docketwatch search_documents '{"agency_id":"EPA","search_term":"emissions"}'
npx @reneturcios/docketwatch get_document_detail '{"document_id":"EPA-HQ-OAR-2020-0001-0001","include_attachments":true}'
npx @reneturcios/docketwatch search_comments '{"docket_id":"EPA-HQ-OAR-2020-0001"}'
npx @reneturcios/docketwatch open_comment_periods '{"agency_id":"EPA","limit":20}'
npx @reneturcios/docketwatch far_case_history '{"case_number":"FAR-2023-0008"}'
npx @reneturcios/docketwatch get_access_status
npx @reneturcios/docketwatch --version
```

Output is the tool's result text (JSON for every
tool). Exit codes: `0` on success, `1` on a runtime
error (including a validation, missing-key or upstream
failure), `2` on a usage error.

## MCP server

```bash
npx -y @reneturcios/docketwatch mcp
```

MCP client config:

```json
{
  "mcpServers": {
    "docketwatch": {
      "command": "npx",
      "args": ["-y", "@reneturcios/docketwatch", "mcp"],
      "env": {
        "REGULATIONS_GOV_API_KEY": "<your key>"
      }
    }
  }
}
```

## Docker

```bash
docker run -i -e REGULATIONS_GOV_API_KEY="<your key>" ghcr.io/cloudcorprecords/docketwatch
docker run --rm -e REGULATIONS_GOV_API_KEY="<your key>" ghcr.io/cloudcorprecords/docketwatch get_access_status
```

## Development

```bash
npm install
npm run build   # tsc -> dist/
npm test        # tsx --test test/*.test.ts (fake fetch + fake clock, no network)
npm run dev     # run the CLI from source
```

## License

MIT — Copyright (c) 2026 Rene Turcios

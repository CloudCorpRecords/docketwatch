# Changelog

## 0.1.0 (2026-10-27)

- Initial release: nine MCP tools and matching CLI subcommands
  for the Regulations.gov API v4 — `search_documents`,
  `get_document_detail`, `search_comments`,
  `get_comment_detail`, `search_dockets`, `get_docket_detail`,
  `open_comment_periods`, `far_case_history`, and
  `get_access_status`.
- Flat search arguments map to the documented `filter[...]`
  parameters with `sort`, `page[number]`, and `page[size]`;
  successful data calls return the upstream JSON verbatim, and
  the API key is sent as the `X-Api-Key` header.
- `open_comment_periods` (labelled composition) scans a
  180-day window of documents and returns those whose comment
  period is still open; `far_case_history` (labelled
  composition) returns a FAR case docket together with all of
  its paged documents.
- With `REGULATIONS_GOV_API_KEY` unset, data tools return
  setup instructions and make no request; `get_access_status`
  reports only whether a key is configured.

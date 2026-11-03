/**
 * docketwatch core: a Regulations.gov API v4 client.
 *
 * Plain search and detail tools return the upstream JSON
 * verbatim. Flat arguments map to the documented
 * `filter[...]` parameters, plus `sort`, `page[number]`
 * and `page[size]`:
 *   search_term            -> filter[searchTerm]
 *   agency_id              -> filter[agencyId]
 *   docket_id              -> filter[docketId]
 *   comment_on_id          -> filter[commentOnId]
 *   posted_date            -> filter[postedDate]
 *   posted_date_gte        -> filter[postedDate][ge]
 *   posted_date_lte        -> filter[postedDate][le]
 *   last_modified_date_gte -> filter[lastModifiedDate][ge]
 *   page_number            -> page[number]
 *   page_size              -> page[size]
 * Filter values are case-sensitive and passed through
 * unchanged. `get_document_detail` sends
 * `include=attachments` only when `include_attachments`
 * is true.
 *
 * Configuration: the API key comes from
 * REGULATIONS_GOV_API_KEY (injectable in tests) and is
 * sent as the `X-Api-Key` header. The base URL defaults
 * to https://api.regulations.gov/v4 (env
 * REGULATIONS_GOV_API_BASE, injectable). When no key is
 * configured, every data tool fails with the pinned
 * setup-instructions text and makes no request;
 * `get_access_status` never calls out and reports only
 * whether a key is configured.
 *
 * Two tools are labelled compositions, not single calls:
 * - open_comment_periods pages GET /documents with
 *   filter[postedDate][ge] set 180 days before today
 *   (the labelled scan window), in API order, at most
 *   10 pages of 250, keeps documents whose
 *   attributes.commentEndDate is today or later (clock
 *   injectable), sorts ascending by that date and
 *   applies `limit` (default 50).
 * - far_case_history fetches GET /dockets/{case_number}
 *   plus every page of GET /documents filtered by that
 *   docket id (page size 250, at most 10 pages).
 *
 * Errors: a non-2xx reply is
 * `regulations.gov error: HTTP <status>` (401/403 add
 * the pinned key-check suffix); a throwing fetch is
 * `regulations.gov unreachable`. All validation runs
 * before any request, with the pinned error strings.
 * Noted gap: no document-type or docket-type filter
 * argument is exposed, because the API documentation
 * read for this rebuild did not pin a type filter
 * parameter name.
 */
import type {
  DocketDeps,
  FarCaseHistoryArgs,
  FetchFn,
  GetAccessStatusArgs,
  GetCommentDetailArgs,
  GetDocumentDetailArgs,
  GetDocketDetailArgs,
  OpenCommentPeriodsArgs,
  SearchCommentsArgs,
  SearchDocumentsArgs,
  SearchDocketsArgs,
} from "./types.js";

export const VERSION = "0.1.0";

export const DEFAULT_BASE_URL = "https://api.regulations.gov/v4";

export const MISSING_KEY_MESSAGE =
  "REGULATIONS_GOV_API_KEY is not set. Get a free api.data.gov key at https://api.data.gov/signup and set REGULATIONS_GOV_API_KEY, then retry.";

const PAGE_SIZE = 250;
const MAX_PAGES = 10;
const SCAN_WINDOW_DAYS = 180;

function resolveApiKey(deps: DocketDeps): string | undefined {
  return deps.apiKey !== undefined ? deps.apiKey : process.env.REGULATIONS_GOV_API_KEY;
}

function resolveBaseUrl(deps: DocketDeps): string {
  return (deps.baseUrl ?? process.env.REGULATIONS_GOV_API_BASE ?? DEFAULT_BASE_URL).replace(
    /\/+$/,
    "",
  );
}

function resolveNow(deps: DocketDeps): Date {
  const clock = deps.now ?? deps.clock;
  return clock ? clock() : new Date();
}

function requireApiKey(deps: DocketDeps): string {
  const key = resolveApiKey(deps);
  if (!key) {
    throw new Error(MISSING_KEY_MESSAGE);
  }
  return key;
}

function requireNonEmptyString(value: unknown, message: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(message);
  }
  return value;
}

const defaultFetch: FetchFn = async (url, init) => {
  const res = await fetch(url, init);
  return { ok: res.ok, status: res.status, text: () => res.text() };
};

type Param = [string, string];

function addParam(params: Param[], key: string, value: unknown): void {
  if (value !== undefined && value !== null) {
    params.push([key, String(value)]);
  }
}

async function requestText(
  deps: DocketDeps,
  apiKey: string,
  path: string,
  params: Param[],
): Promise<string> {
  const fetchFn = deps.fetchFn ?? defaultFetch;
  const base = resolveBaseUrl(deps);
  const query = params.length > 0 ? `?${new URLSearchParams(params).toString()}` : "";
  let res;
  try {
    res = await fetchFn(`${base}${path}${query}`, {
      method: "GET",
      headers: { "X-Api-Key": apiKey },
    });
  } catch {
    throw new Error("regulations.gov unreachable");
  }
  if (res.status < 200 || res.status >= 300) {
    const suffix =
      res.status === 401 || res.status === 403
        ? " (check REGULATIONS_GOV_API_KEY; free keys from api.data.gov)"
        : "";
    throw new Error(`regulations.gov error: HTTP ${res.status}${suffix}`);
  }
  try {
    return await res.text();
  } catch {
    throw new Error("regulations.gov unreachable");
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function dataArray(parsed: unknown): unknown[] {
  if (typeof parsed === "object" && parsed !== null) {
    const data = (parsed as Record<string, unknown>).data;
    if (Array.isArray(data)) return data;
  }
  return [];
}

function totalPages(parsed: unknown): number | undefined {
  if (typeof parsed === "object" && parsed !== null) {
    const meta = (parsed as Record<string, unknown>).meta;
    if (typeof meta === "object" && meta !== null) {
      const tp = (meta as Record<string, unknown>).totalPages;
      if (typeof tp === "number" && Number.isFinite(tp)) return tp;
    }
  }
  return undefined;
}

interface PagedDocuments {
  documents: unknown[];
  complete: boolean;
}

/** Page through GET /documents with the given base filters. */
async function fetchDocumentPages(
  deps: DocketDeps,
  apiKey: string,
  baseParams: Param[],
): Promise<PagedDocuments> {
  const documents: unknown[] = [];
  let complete = false;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const params: Param[] = [
      ...baseParams,
      ["page[size]", String(PAGE_SIZE)],
      ["page[number]", String(page)],
    ];
    const text = await requestText(deps, apiKey, "/documents", params);
    const parsed = parseJson(text);
    const data = dataArray(parsed);
    documents.push(...data);
    const tp = totalPages(parsed);
    if (tp !== undefined && page >= tp) {
      complete = true;
      break;
    }
    if (data.length < PAGE_SIZE) {
      complete = true;
      break;
    }
    if (page === MAX_PAGES) {
      complete = false;
    }
  }
  return { documents, complete };
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function commentEndDate(doc: unknown): string | undefined {
  if (typeof doc === "object" && doc !== null) {
    const attrs = (doc as Record<string, unknown>).attributes;
    if (typeof attrs === "object" && attrs !== null) {
      const end = (attrs as Record<string, unknown>).commentEndDate;
      if (typeof end === "string" && end.length > 0) return end;
    }
  }
  return undefined;
}

/** Search Regulations.gov documents. Upstream JSON verbatim. */
export async function searchDocuments(
  args: SearchDocumentsArgs,
  deps: DocketDeps = {},
): Promise<string> {
  const raw = (args ?? {}) as unknown as Record<string, unknown>;
  const apiKey = requireApiKey(deps);
  const params: Param[] = [];
  addParam(params, "filter[searchTerm]", raw.search_term);
  addParam(params, "filter[agencyId]", raw.agency_id);
  addParam(params, "filter[docketId]", raw.docket_id);
  addParam(params, "filter[postedDate]", raw.posted_date);
  addParam(params, "filter[postedDate][ge]", raw.posted_date_gte);
  addParam(params, "filter[postedDate][le]", raw.posted_date_lte);
  addParam(params, "filter[lastModifiedDate][ge]", raw.last_modified_date_gte);
  addParam(params, "sort", raw.sort);
  addParam(params, "page[number]", raw.page_number);
  addParam(params, "page[size]", raw.page_size);
  return requestText(deps, apiKey, "/documents", params);
}

/** Full details of one document, optionally with attachments. */
export async function getDocumentDetail(
  args: GetDocumentDetailArgs,
  deps: DocketDeps = {},
): Promise<string> {
  const raw = (args ?? {}) as unknown as Record<string, unknown>;
  const documentId = requireNonEmptyString(
    raw.document_id,
    "document_id must be a non-empty string",
  );
  const apiKey = requireApiKey(deps);
  const params: Param[] = [];
  if (raw.include_attachments === true) {
    params.push(["include", "attachments"]);
  }
  return requestText(deps, apiKey, `/documents/${encodeURIComponent(documentId)}`, params);
}

/** Search public comments. Upstream JSON verbatim. */
export async function searchComments(
  args: SearchCommentsArgs,
  deps: DocketDeps = {},
): Promise<string> {
  const raw = (args ?? {}) as unknown as Record<string, unknown>;
  const apiKey = requireApiKey(deps);
  const params: Param[] = [];
  addParam(params, "filter[searchTerm]", raw.search_term);
  addParam(params, "filter[agencyId]", raw.agency_id);
  addParam(params, "filter[docketId]", raw.docket_id);
  addParam(params, "filter[commentOnId]", raw.comment_on_id);
  addParam(params, "filter[postedDate][ge]", raw.posted_date_gte);
  addParam(params, "filter[postedDate][le]", raw.posted_date_lte);
  addParam(params, "sort", raw.sort);
  addParam(params, "page[number]", raw.page_number);
  addParam(params, "page[size]", raw.page_size);
  return requestText(deps, apiKey, "/comments", params);
}

/** Full text and submitter info of one comment. */
export async function getCommentDetail(
  args: GetCommentDetailArgs,
  deps: DocketDeps = {},
): Promise<string> {
  const raw = (args ?? {}) as unknown as Record<string, unknown>;
  const commentId = requireNonEmptyString(raw.comment_id, "comment_id must be a non-empty string");
  const apiKey = requireApiKey(deps);
  return requestText(deps, apiKey, `/comments/${encodeURIComponent(commentId)}`, []);
}

/** Search dockets. Upstream JSON verbatim. */
export async function searchDockets(
  args: SearchDocketsArgs,
  deps: DocketDeps = {},
): Promise<string> {
  const raw = (args ?? {}) as unknown as Record<string, unknown>;
  const apiKey = requireApiKey(deps);
  const params: Param[] = [];
  addParam(params, "filter[searchTerm]", raw.search_term);
  addParam(params, "filter[agencyId]", raw.agency_id);
  addParam(params, "sort", raw.sort);
  addParam(params, "page[number]", raw.page_number);
  addParam(params, "page[size]", raw.page_size);
  return requestText(deps, apiKey, "/dockets", params);
}

/** Docket metadata, abstract and RIN. */
export async function getDocketDetail(
  args: GetDocketDetailArgs,
  deps: DocketDeps = {},
): Promise<string> {
  const raw = (args ?? {}) as unknown as Record<string, unknown>;
  const docketId = requireNonEmptyString(raw.docket_id, "docket_id must be a non-empty string");
  const apiKey = requireApiKey(deps);
  return requestText(deps, apiKey, `/dockets/${encodeURIComponent(docketId)}`, []);
}

/**
 * Labelled composition: currently open comment periods.
 * Scans documents posted in the last 180 days (at most
 * 10 pages of 250, in API order) and keeps those whose
 * commentEndDate is today or later.
 */
export async function openCommentPeriods(
  args: OpenCommentPeriodsArgs,
  deps: DocketDeps = {},
): Promise<string> {
  const raw = (args ?? {}) as unknown as Record<string, unknown>;
  const apiKey = requireApiKey(deps);
  const now = resolveNow(deps);
  const today = isoDate(now);
  const since = isoDate(new Date(now.getTime() - SCAN_WINDOW_DAYS * 86_400_000));
  const baseParams: Param[] = [["filter[postedDate][ge]", since]];
  addParam(baseParams, "filter[searchTerm]", raw.search_term);
  addParam(baseParams, "filter[agencyId]", raw.agency_id);
  const { documents, complete } = await fetchDocumentPages(deps, apiKey, baseParams);
  const open = documents
    .map((doc) => ({ doc, end: commentEndDate(doc) }))
    .filter(
      (entry): entry is { doc: unknown; end: string } =>
        entry.end !== undefined && entry.end.slice(0, 10) >= today,
    )
    .sort((a, b) => (a.end < b.end ? -1 : a.end > b.end ? 1 : 0))
    .map((entry) => entry.doc);
  const limit =
    typeof raw.limit === "number" && Number.isInteger(raw.limit) && raw.limit >= 0
      ? raw.limit
      : 50;
  const results = open.slice(0, limit);
  const truncated = open.length > results.length;
  return JSON.stringify({ results, complete, truncated });
}

/**
 * Labelled composition: a FAR/DFARS rulemaking case —
 * its docket plus every page of its documents.
 */
export async function farCaseHistory(
  args: FarCaseHistoryArgs,
  deps: DocketDeps = {},
): Promise<string> {
  const raw = (args ?? {}) as unknown as Record<string, unknown>;
  const caseNumber = requireNonEmptyString(
    raw.case_number,
    "case_number must be a non-empty string",
  );
  const apiKey = requireApiKey(deps);
  const docketText = await requestText(
    deps,
    apiKey,
    `/dockets/${encodeURIComponent(caseNumber)}`,
    [],
  );
  const parsedDocket = parseJson(docketText);
  const docket = parsedDocket !== undefined ? parsedDocket : docketText;
  const { documents, complete } = await fetchDocumentPages(deps, apiKey, [
    ["filter[docketId]", caseNumber],
  ]);
  return JSON.stringify({ docket, documents, complete });
}

/** Whether a key is configured, without revealing it. Never calls out. */
export async function getAccessStatus(
  _args: GetAccessStatusArgs = {},
  deps: DocketDeps = {},
): Promise<string> {
  const configured = Boolean(resolveApiKey(deps));
  return JSON.stringify({ configured });
}

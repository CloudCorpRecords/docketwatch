/**
 * docketwatch types.
 *
 * Nine tools over the Regulations.gov API v4: document,
 * comment and docket search and detail, two labelled
 * compositions (open comment periods, FAR case history),
 * and a key-free access status check. Every tool answers
 * with a single text string holding JSON: the upstream
 * response verbatim for plain calls, or the composition's
 * documented JSON shape.
 */

export interface SearchDocumentsArgs {
  search_term?: string;
  agency_id?: string;
  docket_id?: string;
  posted_date?: string;
  posted_date_gte?: string;
  posted_date_lte?: string;
  last_modified_date_gte?: string;
  sort?: string;
  page_number?: number;
  page_size?: number;
}

export interface GetDocumentDetailArgs {
  document_id: string;
  include_attachments?: boolean;
}

export interface SearchCommentsArgs {
  search_term?: string;
  agency_id?: string;
  docket_id?: string;
  comment_on_id?: string;
  posted_date_gte?: string;
  posted_date_lte?: string;
  sort?: string;
  page_number?: number;
  page_size?: number;
}

export interface GetCommentDetailArgs {
  comment_id: string;
}

export interface SearchDocketsArgs {
  search_term?: string;
  agency_id?: string;
  sort?: string;
  page_number?: number;
  page_size?: number;
}

export interface GetDocketDetailArgs {
  docket_id: string;
}

export interface OpenCommentPeriodsArgs {
  agency_id?: string;
  search_term?: string;
  limit?: number;
}

export interface FarCaseHistoryArgs {
  case_number: string;
}

export interface GetAccessStatusArgs {
  // No arguments.
}

/** The minimal slice of a fetch Response this client relies on. */
export interface FetchResponseLike {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

/** Injectable fetch, so tests never touch the live network. */
export type FetchFn = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<FetchResponseLike>;

/** Runtime dependencies for the core, all injectable in tests. */
export interface DocketDeps {
  /** Fetch implementation. Defaults to the global fetch. */
  fetchFn?: FetchFn;
  /** Clock used by open_comment_periods. Defaults to the system clock. */
  now?: () => Date;
  /** Alias for `now`, accepted for convenience. */
  clock?: () => Date;
  /** Regulations.gov base URL. Defaults to env REGULATIONS_GOV_API_BASE, then https://api.regulations.gov/v4. */
  baseUrl?: string;
  /** API key. Defaults to env REGULATIONS_GOV_API_KEY. Never returned by any tool. */
  apiKey?: string;
}

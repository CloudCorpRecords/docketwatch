import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MISSING_KEY_MESSAGE,
  farCaseHistory,
  getAccessStatus,
  getCommentDetail,
  getDocumentDetail,
  getDocketDetail,
  openCommentPeriods,
  searchComments,
  searchDocuments,
  searchDockets,
} from "../src/docket.js";
import type { DocketDeps, FetchFn } from "../src/types.js";

/**
 * Every test runs against an injected fake fetch and a
 * fixed fake clock: no live network, no live call is made.
 */

const NOW = () => new Date("2026-10-27T12:00:00.000Z");
const TODAY = "2026-10-27";
const SINCE = new Date(NOW().getTime() - 180 * 86_400_000).toISOString().slice(0, 10);

interface Captured {
  url: string;
  headers?: Record<string, string>;
}

type Reply = { status?: number; body: unknown };
type Handler = (url: URL) => Reply;

function makeFetch(handler: Handler, captured: Captured[] = []): FetchFn {
  return async (url, init) => {
    captured.push({ url, headers: init?.headers });
    const r = handler(new URL(url));
    const status = r.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (typeof r.body === "string" ? r.body : JSON.stringify(r.body)),
    };
  };
}

const throwingFetch: FetchFn = async () => {
  throw new Error("connection refused");
};

function deps(fetchFn: FetchFn, extra: Partial<DocketDeps> = {}): DocketDeps {
  return { fetchFn, now: NOW, apiKey: "test-key", ...extra };
}

function okFetch(body: unknown, captured: Captured[] = []): FetchFn {
  return makeFetch(() => ({ body }), captured);
}

async function expectError(promise: Promise<unknown>, message: string): Promise<void> {
  await assert.rejects(promise, (err: unknown) => {
    assert.equal(err instanceof Error ? err.message : String(err), message);
    return true;
  });
}

function makeDoc(id: string, commentEndDate?: string): Record<string, unknown> {
  return {
    id,
    type: "documents",
    attributes: commentEndDate === undefined ? {} : { commentEndDate },
  };
}

describe("search_documents", () => {
  it("returns the upstream JSON verbatim and maps every filter", async () => {
    const payload = { data: [{ id: "D1" }], meta: { totalPages: 1 } };
    const captured: Captured[] = [];
    const out = await searchDocuments(
      {
        search_term: "emissions",
        agency_id: "EPA",
        docket_id: "EPA-HQ-2020-0001",
        posted_date: "2026-01-15",
        posted_date_gte: "2026-01-01",
        posted_date_lte: "2026-02-01",
        last_modified_date_gte: "2026-03-01",
        sort: "-postedDate",
        page_number: 2,
        page_size: 25,
      },
      deps(okFetch(payload, captured)),
    );
    assert.equal(out, JSON.stringify(payload));
    assert.equal(captured.length, 1);
    const url = new URL(captured[0].url);
    assert.equal(url.pathname, "/v4/documents");
    assert.equal(url.searchParams.get("filter[searchTerm]"), "emissions");
    assert.equal(url.searchParams.get("filter[agencyId]"), "EPA");
    assert.equal(url.searchParams.get("filter[docketId]"), "EPA-HQ-2020-0001");
    assert.equal(url.searchParams.get("filter[postedDate]"), "2026-01-15");
    assert.equal(url.searchParams.get("filter[postedDate][ge]"), "2026-01-01");
    assert.equal(url.searchParams.get("filter[postedDate][le]"), "2026-02-01");
    assert.equal(url.searchParams.get("filter[lastModifiedDate][ge]"), "2026-03-01");
    assert.equal(url.searchParams.get("sort"), "-postedDate");
    assert.equal(url.searchParams.get("page[number]"), "2");
    assert.equal(url.searchParams.get("page[size]"), "25");
    assert.equal(captured[0].headers?.["X-Api-Key"], "test-key");
  });

  it("omits parameters whose arguments were not given", async () => {
    const captured: Captured[] = [];
    await searchDocuments({}, deps(okFetch({ data: [] }, captured)));
    const url = new URL(captured[0].url);
    assert.deepEqual([...url.searchParams.keys()], []);
  });

  it("honours an injected base URL", async () => {
    const captured: Captured[] = [];
    await searchDocuments(
      {},
      deps(okFetch({ data: [] }, captured), { baseUrl: "https://example.test/reg/" }),
    );
    assert.ok(captured[0].url.startsWith("https://example.test/reg/documents"));
  });
});

describe("document, comment and docket detail", () => {
  it("get_document_detail sends include=attachments only when asked", async () => {
    const captured: Captured[] = [];
    const fetchFn = okFetch({ data: { id: "DOC-1" } }, captured);
    const out = await getDocumentDetail({ document_id: "DOC-1" }, deps(fetchFn));
    assert.equal(out, JSON.stringify({ data: { id: "DOC-1" } }));
    let url = new URL(captured[0].url);
    assert.equal(url.pathname, "/v4/documents/DOC-1");
    assert.equal(url.searchParams.get("include"), null);

    await getDocumentDetail(
      { document_id: "DOC-1", include_attachments: false },
      deps(fetchFn),
    );
    url = new URL(captured[1].url);
    assert.equal(url.searchParams.get("include"), null);

    await getDocumentDetail(
      { document_id: "DOC-1", include_attachments: true },
      deps(fetchFn),
    );
    url = new URL(captured[2].url);
    assert.equal(url.searchParams.get("include"), "attachments");
  });

  it("get_comment_detail fetches /comments/{id} verbatim", async () => {
    const captured: Captured[] = [];
    const payload = { data: { id: "C1", attributes: { comment: "hello" } } };
    const out = await getCommentDetail({ comment_id: "C1" }, deps(okFetch(payload, captured)));
    assert.equal(out, JSON.stringify(payload));
    assert.equal(new URL(captured[0].url).pathname, "/v4/comments/C1");
  });

  it("get_docket_detail fetches /dockets/{id} verbatim", async () => {
    const captured: Captured[] = [];
    const payload = { data: { id: "EPA-HQ-2020-0001" } };
    const out = await getDocketDetail(
      { docket_id: "EPA-HQ-2020-0001" },
      deps(okFetch(payload, captured)),
    );
    assert.equal(out, JSON.stringify(payload));
    assert.equal(new URL(captured[0].url).pathname, "/v4/dockets/EPA-HQ-2020-0001");
  });
});

describe("search_comments and search_dockets", () => {
  it("search_comments maps comment_on_id and the date window", async () => {
    const captured: Captured[] = [];
    await searchComments(
      {
        search_term: "noise",
        agency_id: "FAA",
        docket_id: "FAA-2026-0001",
        comment_on_id: "DOC-9",
        posted_date_gte: "2026-05-01",
        posted_date_lte: "2026-06-01",
        sort: "postedDate",
        page_number: 3,
        page_size: 10,
      },
      deps(okFetch({ data: [] }, captured)),
    );
    const url = new URL(captured[0].url);
    assert.equal(url.pathname, "/v4/comments");
    assert.equal(url.searchParams.get("filter[searchTerm]"), "noise");
    assert.equal(url.searchParams.get("filter[agencyId]"), "FAA");
    assert.equal(url.searchParams.get("filter[docketId]"), "FAA-2026-0001");
    assert.equal(url.searchParams.get("filter[commentOnId]"), "DOC-9");
    assert.equal(url.searchParams.get("filter[postedDate][ge]"), "2026-05-01");
    assert.equal(url.searchParams.get("filter[postedDate][le]"), "2026-06-01");
    assert.equal(url.searchParams.get("sort"), "postedDate");
    assert.equal(url.searchParams.get("page[number]"), "3");
    assert.equal(url.searchParams.get("page[size]"), "10");
  });

  it("search_dockets maps its filters", async () => {
    const captured: Captured[] = [];
    const payload = { data: [{ id: "DCK-1" }] };
    const out = await searchDockets(
      { search_term: "fuel", agency_id: "NHTSA", sort: "-postedDate", page_number: 1, page_size: 5 },
      deps(okFetch(payload, captured)),
    );
    assert.equal(out, JSON.stringify(payload));
    const url = new URL(captured[0].url);
    assert.equal(url.pathname, "/v4/dockets");
    assert.equal(url.searchParams.get("filter[searchTerm]"), "fuel");
    assert.equal(url.searchParams.get("filter[agencyId]"), "NHTSA");
    assert.equal(url.searchParams.get("sort"), "-postedDate");
    assert.equal(url.searchParams.get("page[number]"), "1");
    assert.equal(url.searchParams.get("page[size]"), "5");
  });
});

describe("missing key", () => {
  it("a data tool returns the setup text and makes no request", async () => {
    const captured: Captured[] = [];
    await expectError(
      searchDocuments({}, deps(okFetch({}, captured), { apiKey: "" })),
      MISSING_KEY_MESSAGE,
    );
    assert.deepEqual(captured, []);
  });

  it("detail, composition tools also refuse without a key", async () => {
    const captured: Captured[] = [];
    const noKey = deps(okFetch({}, captured), { apiKey: "" });
    await expectError(getDocumentDetail({ document_id: "DOC-1" }, noKey), MISSING_KEY_MESSAGE);
    await expectError(openCommentPeriods({}, noKey), MISSING_KEY_MESSAGE);
    await expectError(
      farCaseHistory({ case_number: "FAR-2023-0008" }, noKey),
      MISSING_KEY_MESSAGE,
    );
    assert.deepEqual(captured, []);
  });

  it("pins the exact setup-instructions text", () => {
    assert.equal(
      MISSING_KEY_MESSAGE,
      "REGULATIONS_GOV_API_KEY is not set. Get a free api.data.gov key at https://api.data.gov/signup and set REGULATIONS_GOV_API_KEY, then retry.",
    );
  });
});

describe("validation", () => {
  it("rejects an empty or missing document_id before any request", async () => {
    const captured: Captured[] = [];
    const d = deps(okFetch({}, captured));
    await expectError(
      getDocumentDetail({ document_id: "" }, d),
      "document_id must be a non-empty string",
    );
    await expectError(
      getDocumentDetail({} as never, d),
      "document_id must be a non-empty string",
    );
    await expectError(
      getDocumentDetail({ document_id: 7 } as never, d),
      "document_id must be a non-empty string",
    );
    assert.deepEqual(captured, []);
  });

  it("rejects an empty comment_id, docket_id and case_number", async () => {
    const captured: Captured[] = [];
    const d = deps(okFetch({}, captured));
    await expectError(getCommentDetail({ comment_id: "" }, d), "comment_id must be a non-empty string");
    await expectError(getDocketDetail({ docket_id: "" }, d), "docket_id must be a non-empty string");
    await expectError(
      farCaseHistory({ case_number: "" }, d),
      "case_number must be a non-empty string",
    );
    assert.deepEqual(captured, []);
  });
});

describe("upstream errors", () => {
  it("maps a non-2xx reply to regulations.gov error: HTTP <status>", async () => {
    const fetchFn = makeFetch(() => ({ status: 500, body: "boom" }));
    await expectError(searchDockets({}, deps(fetchFn)), "regulations.gov error: HTTP 500");
  });

  it("appends the key-check suffix on 401 and 403 only", async () => {
    const suffix = " (check REGULATIONS_GOV_API_KEY; free keys from api.data.gov)";
    const f401 = makeFetch(() => ({ status: 401, body: "no" }));
    await expectError(searchDockets({}, deps(f401)), `regulations.gov error: HTTP 401${suffix}`);
    const f403 = makeFetch(() => ({ status: 403, body: "no" }));
    await expectError(searchDockets({}, deps(f403)), `regulations.gov error: HTTP 403${suffix}`);
    const f404 = makeFetch(() => ({ status: 404, body: "no" }));
    await expectError(searchDockets({}, deps(f404)), "regulations.gov error: HTTP 404");
  });

  it("maps a throwing fetch to regulations.gov unreachable", async () => {
    await expectError(searchDockets({}, deps(throwingFetch)), "regulations.gov unreachable");
  });
});

describe("get_access_status", () => {
  it("reports configured true without revealing the key or calling out", async () => {
    const out = await getAccessStatus({}, deps(throwingFetch, { apiKey: "super-secret-key" }));
    assert.equal(out, JSON.stringify({ configured: true }));
    assert.ok(!out.includes("super-secret-key"));
  });

  it("reports configured false when no key is set", async () => {
    const out = await getAccessStatus({}, deps(throwingFetch, { apiKey: "" }));
    assert.equal(out, JSON.stringify({ configured: false }));
  });
});

describe("open_comment_periods (composition)", () => {
  function scanFetch(pages: Record<number, unknown[]>, captured: Captured[] = []): FetchFn {
    return makeFetch((url) => {
      const page = Number(url.searchParams.get("page[number]") ?? "1");
      return { body: { data: pages[page] ?? [] } };
    }, captured);
  }

  it("keeps only periods ending today or later, soonest first", async () => {
    const docs = [
      makeDoc("late", "2026-12-01"),
      makeDoc("closed", "2026-10-26"),
      makeDoc("today", TODAY),
      makeDoc("no-date"),
      makeDoc("soon", "2026-11-05"),
    ];
    const out = await openCommentPeriods({}, deps(scanFetch({ 1: docs })));
    const parsed = JSON.parse(out) as {
      results: Array<{ id: string }>;
      complete: boolean;
      truncated: boolean;
    };
    assert.deepEqual(
      parsed.results.map((r) => r.id),
      ["today", "soon", "late"],
    );
    assert.equal(parsed.complete, true);
    assert.equal(parsed.truncated, false);
  });

  it("scans from 180 days before today with page size 250 and no assumed sort", async () => {
    const captured: Captured[] = [];
    await openCommentPeriods(
      { agency_id: "EPA", search_term: "air" },
      deps(scanFetch({ 1: [] }, captured)),
    );
    assert.equal(captured.length, 1);
    const url = new URL(captured[0].url);
    assert.equal(url.pathname, "/v4/documents");
    assert.equal(url.searchParams.get("filter[postedDate][ge]"), SINCE);
    assert.equal(url.searchParams.get("filter[agencyId]"), "EPA");
    assert.equal(url.searchParams.get("filter[searchTerm]"), "air");
    assert.equal(url.searchParams.get("page[size]"), "250");
    assert.equal(url.searchParams.get("page[number]"), "1");
    assert.equal(url.searchParams.get("sort"), null);
  });

  it("applies limit and reports truncation", async () => {
    const docs = [makeDoc("a", "2026-11-01"), makeDoc("b", "2026-11-02"), makeDoc("c", "2026-11-03")];
    const out = await openCommentPeriods({ limit: 2 }, deps(scanFetch({ 1: docs })));
    const parsed = JSON.parse(out) as {
      results: Array<{ id: string }>;
      complete: boolean;
      truncated: boolean;
    };
    assert.deepEqual(
      parsed.results.map((r) => r.id),
      ["a", "b"],
    );
    assert.equal(parsed.truncated, true);
    assert.equal(parsed.complete, true);
  });

  it("pages until a short page and reports complete", async () => {
    const page1 = Array.from({ length: 250 }, (_, i) => makeDoc(`p1-${i}`, "2027-01-01"));
    const page2 = [makeDoc("p2-0", "2027-01-02"), makeDoc("p2-1", "2027-01-03")];
    const captured: Captured[] = [];
    const out = await openCommentPeriods(
      { limit: 300 },
      deps(scanFetch({ 1: page1, 2: page2 }, captured)),
    );
    const parsed = JSON.parse(out) as { results: unknown[]; complete: boolean; truncated: boolean };
    assert.equal(captured.length, 2);
    assert.equal(parsed.results.length, 252);
    assert.equal(parsed.complete, true);
    assert.equal(parsed.truncated, false);
  });

  it("stops at 10 full pages and reports incomplete", async () => {
    const full = Array.from({ length: 250 }, (_, i) => makeDoc(`d-${i}`, "2027-01-01"));
    const captured: Captured[] = [];
    const fetchFn = makeFetch(() => ({ body: { data: full } }), captured);
    const out = await openCommentPeriods({ limit: 5000 }, deps(fetchFn));
    const parsed = JSON.parse(out) as { results: unknown[]; complete: boolean };
    assert.equal(captured.length, 10);
    assert.equal(parsed.results.length, 2500);
    assert.equal(parsed.complete, false);
  });
});

describe("far_case_history (composition)", () => {
  const DOCKET = { data: { id: "FAR-2023-0008", attributes: { title: "FAR Case 2023-0008" } } };

  function caseFetch(
    pages: Record<number, unknown[]>,
    captured: Captured[] = [],
    docketReply: Reply = { body: DOCKET },
  ): FetchFn {
    return makeFetch((url) => {
      if (url.pathname.startsWith("/v4/dockets/")) return docketReply;
      const page = Number(url.searchParams.get("page[number]") ?? "1");
      return { body: { data: pages[page] ?? [] } };
    }, captured);
  }

  it("returns the docket verbatim plus its documents, complete", async () => {
    const captured: Captured[] = [];
    const docs = [makeDoc("x"), makeDoc("y")];
    const out = await farCaseHistory(
      { case_number: "FAR-2023-0008" },
      deps(caseFetch({ 1: docs }, captured)),
    );
    const parsed = JSON.parse(out) as {
      docket: unknown;
      documents: Array<{ id: string }>;
      complete: boolean;
    };
    assert.deepEqual(parsed.docket, DOCKET);
    assert.deepEqual(
      parsed.documents.map((d) => d.id),
      ["x", "y"],
    );
    assert.equal(parsed.complete, true);
    assert.equal(new URL(captured[0].url).pathname, "/v4/dockets/FAR-2023-0008");
    const docUrl = new URL(captured[1].url);
    assert.equal(docUrl.pathname, "/v4/documents");
    assert.equal(docUrl.searchParams.get("filter[docketId]"), "FAR-2023-0008");
    assert.equal(docUrl.searchParams.get("page[size]"), "250");
  });

  it("concatenates every document page", async () => {
    const page1 = Array.from({ length: 250 }, (_, i) => makeDoc(`a-${i}`));
    const page2 = [makeDoc("b-0"), makeDoc("b-1"), makeDoc("b-2")];
    const captured: Captured[] = [];
    const out = await farCaseHistory(
      { case_number: "FAR-2023-0008" },
      deps(caseFetch({ 1: page1, 2: page2 }, captured)),
    );
    const parsed = JSON.parse(out) as { documents: unknown[]; complete: boolean };
    assert.equal(parsed.documents.length, 253);
    assert.equal(parsed.complete, true);
    // 1 docket request + 2 document pages.
    assert.equal(captured.length, 3);
  });

  it("reports incomplete when document pages hit the 10-page cap", async () => {
    const full = Array.from({ length: 250 }, (_, i) => makeDoc(`f-${i}`));
    const fetchFn = makeFetch((url) => {
      if (url.pathname.startsWith("/v4/dockets/")) return { body: DOCKET };
      return { body: { data: full } };
    });
    const out = await farCaseHistory({ case_number: "FAR-2023-0008" }, deps(fetchFn));
    const parsed = JSON.parse(out) as { documents: unknown[]; complete: boolean };
    assert.equal(parsed.documents.length, 2500);
    assert.equal(parsed.complete, false);
  });

  it("propagates a docket failure and fetches no documents", async () => {
    const captured: Captured[] = [];
    const fetchFn = caseFetch({ 1: [] }, captured, { status: 404, body: "missing" });
    await expectError(
      farCaseHistory({ case_number: "FAR-2023-0008" }, deps(fetchFn)),
      "regulations.gov error: HTTP 404",
    );
    assert.equal(captured.length, 1);
  });
});

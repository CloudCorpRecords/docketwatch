/**
 * docketwatch MCP server. Tools: search_documents,
 * get_document_detail, search_comments, get_comment_detail,
 * search_dockets, get_docket_detail, open_comment_periods,
 * far_case_history, get_access_status.
 *
 * Why the low-level Server instead of McpServer: the
 * high-level helper converts zod schemas to JSON Schema and
 * injects keys that are not in this tool set's documented
 * spec ("$schema" and "additionalProperties"), which breaks
 * exact tool-list/schema parity with the spec. This file
 * serves tools/list with the spec's exact input schemas as
 * explicit literals, and the core validates every tools/call
 * argument set itself.
 *
 * Every tool returns a single text item holding JSON;
 * validation, missing-key and upstream failures come back
 * as isError results carrying the documented error strings.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import {
  farCaseHistory,
  getAccessStatus,
  getCommentDetail,
  getDocumentDetail,
  getDocketDetail,
  openCommentPeriods,
  searchComments,
  searchDocuments,
  searchDockets,
  VERSION,
} from "./docket.js";

const TOOLS = [
  {
    name: "search_documents",
    description:
      "Search Regulations.gov documents: proposed rules, rules, notices and supporting material.",
    inputSchema: {
      type: "object" as const,
      properties: {
        agency_id: { type: "string" , description: "Identifier of the agency." },
        docket_id: { type: "string" , description: "Identifier of the docket." },
        last_modified_date_gte: { type: "string" , description: "The last modified date gte for this call." },
        page_number: { type: "integer" , description: "Page number for paginated results (optional)." },
        page_size: { type: "integer" , description: "Number of results per page (optional)." },
        posted_date: { type: "string" , description: "The posted date for this call." },
        posted_date_gte: { type: "string" , description: "The posted date gte for this call." },
        posted_date_lte: { type: "string" , description: "The posted date lte for this call." },
        search_term: { type: "string" , description: "Search term." },
        sort: { type: "string" , description: "Sort order for the results (optional)." },
      },
    },
  },
  {
    name: "get_document_detail",
    description: "Full details of one Regulations.gov document, optionally with attachments.",
    inputSchema: {
      type: "object" as const,
      properties: {
        document_id: { type: "string" , description: "The document identifier for this call." },
        include_attachments: { type: "boolean" , description: "The include attachments for this call." },
      },
      required: ["document_id"],
    },
  },
  {
    name: "search_comments",
    description: "Search public comments by docket, document or keyword.",
    inputSchema: {
      type: "object" as const,
      properties: {
        agency_id: { type: "string" , description: "Identifier of the agency." },
        comment_on_id: { type: "string" , description: "The comment on identifier for this call." },
        docket_id: { type: "string" , description: "Identifier of the docket." },
        page_number: { type: "integer" , description: "Page number for paginated results (optional)." },
        page_size: { type: "integer" , description: "Number of results per page (optional)." },
        posted_date_gte: { type: "string" , description: "The posted date gte for this call." },
        posted_date_lte: { type: "string" , description: "The posted date lte for this call." },
        search_term: { type: "string" , description: "Search term." },
        sort: { type: "string" , description: "Sort order for the results (optional)." },
      },
    },
  },
  {
    name: "get_comment_detail",
    description: "Full text and submitter info of one public comment.",
    inputSchema: {
      type: "object" as const,
      properties: {
        comment_id: { type: "string" , description: "The comment identifier for this call." },
      },
      required: ["comment_id"],
    },
  },
  {
    name: "search_dockets",
    description: "Search rulemaking and nonrulemaking dockets.",
    inputSchema: {
      type: "object" as const,
      properties: {
        agency_id: { type: "string" , description: "Identifier of the agency." },
        page_number: { type: "integer" , description: "Page number for paginated results (optional)." },
        page_size: { type: "integer" , description: "Number of results per page (optional)." },
        search_term: { type: "string" , description: "Search term." },
        sort: { type: "string" , description: "Sort order for the results (optional)." },
      },
    },
  },
  {
    name: "get_docket_detail",
    description: "Docket metadata, abstract and RIN.",
    inputSchema: {
      type: "object" as const,
      properties: {
        docket_id: { type: "string" , description: "Identifier of the docket." },
      },
      required: ["docket_id"],
    },
  },
  {
    name: "open_comment_periods",
    description: "Currently open comment periods across procurement agencies.",
    inputSchema: {
      type: "object" as const,
      properties: {
        agency_id: { type: "string" , description: "Identifier of the agency." },
        limit: { type: "integer" , description: "Maximum number of results to return (optional)." },
        search_term: { type: "string" , description: "Search term." },
      },
    },
  },
  {
    name: "far_case_history",
    description: "A FAR/DFARS rulemaking case: its docket and documents, paged.",
    inputSchema: {
      type: "object" as const,
      properties: {
        case_number: { type: "string" , description: "The case number for this call." },
      },
      required: ["case_number"],
    },
  },
  {
    name: "get_access_status",
    description: "Check whether a Regulations.gov API key is configured, without revealing it.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
];

function textResult(text: string) {
  return {
    content: [{ type: "text" as const, text }],
  };
}

function errorResult(err: unknown) {
  return {
    content: [
      { type: "text" as const, text: err instanceof Error ? err.message : String(err) },
    ],
    isError: true,
  };
}

const server = new Server(
  { name: "docketwatch", version: VERSION },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const a = (args ?? {}) as Record<string, unknown>;
  try {
    let out: string;
    switch (name) {
      case "search_documents":
        out = await searchDocuments(a as never);
        break;
      case "get_document_detail":
        out = await getDocumentDetail(a as never);
        break;
      case "search_comments":
        out = await searchComments(a as never);
        break;
      case "get_comment_detail":
        out = await getCommentDetail(a as never);
        break;
      case "search_dockets":
        out = await searchDockets(a as never);
        break;
      case "get_docket_detail":
        out = await getDocketDetail(a as never);
        break;
      case "open_comment_periods":
        out = await openCommentPeriods(a as never);
        break;
      case "far_case_history":
        out = await farCaseHistory(a as never);
        break;
      case "get_access_status":
        out = await getAccessStatus();
        break;
      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
    return textResult(out);
  } catch (err) {
    if (err instanceof McpError) throw err;
    return errorResult(err);
  }
});

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
}

void main();

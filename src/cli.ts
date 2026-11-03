#!/usr/bin/env node
/**
 * docketwatch CLI.
 *
 *   docketwatch search_documents '<json>'
 *   docketwatch get_document_detail '<json>'
 *   docketwatch search_comments '<json>'
 *   docketwatch get_comment_detail '<json>'
 *   docketwatch search_dockets '<json>'
 *   docketwatch get_docket_detail '<json>'
 *   docketwatch open_comment_periods '<json>'
 *   docketwatch far_case_history '<json>'
 *   docketwatch get_access_status
 *   docketwatch mcp
 *   docketwatch --version
 *
 * Each tool subcommand takes one JSON argument string with
 * the tool's arguments (get_access_status takes none) and
 * prints the tool's result text. Exit codes: 0 success,
 * 1 runtime error, 2 usage error.
 */
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

const TOOL_NAMES = [
  "search_documents",
  "get_document_detail",
  "search_comments",
  "get_comment_detail",
  "search_dockets",
  "get_docket_detail",
  "open_comment_periods",
  "far_case_history",
  "get_access_status",
] as const;

function usage(): never {
  console.error(`Usage:
  docketwatch <tool> '<json-args>'     one of: ${TOOL_NAMES.join(", ")}
  docketwatch get_access_status
  docketwatch mcp
  docketwatch --version`);
  process.exit(2);
}

async function runTool(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case "search_documents":
      return searchDocuments(args as never);
    case "get_document_detail":
      return getDocumentDetail(args as never);
    case "search_comments":
      return searchComments(args as never);
    case "get_comment_detail":
      return getCommentDetail(args as never);
    case "search_dockets":
      return searchDockets(args as never);
    case "get_docket_detail":
      return getDocketDetail(args as never);
    case "open_comment_periods":
      return openCommentPeriods(args as never);
    case "far_case_history":
      return farCaseHistory(args as never);
    case "get_access_status":
      return getAccessStatus();
    default:
      usage();
  }
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "--version" || cmd === "-v") {
    console.log(VERSION);
    return;
  }
  if (cmd === "mcp") {
    if (rest.length !== 0) usage();
    await import("./mcp.js");
    return;
  }
  if (!(TOOL_NAMES as readonly string[]).includes(cmd ?? "")) usage();
  if (cmd === "get_access_status") {
    if (rest.length !== 0) usage();
    try {
      const out = await runTool(cmd, {});
      console.log(out);
    } catch (err) {
      console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
    return;
  }
  if (rest.length > 1) usage();
  let args: Record<string, unknown> = {};
  if (rest.length === 1) {
    try {
      const parsed: unknown = JSON.parse(rest[0]);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) usage();
      args = parsed as Record<string, unknown>;
    } catch {
      console.error("error: argument must be a JSON object string");
      process.exit(2);
    }
  }
  try {
    const out = await runTool(cmd, args);
    console.log(out);
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

void main();

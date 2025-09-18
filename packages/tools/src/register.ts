import { registerTools } from "@bolt-ai/core";
import { httpFetchTool } from "./http";
import { webSearchTool } from "./webSearch";

/** Registers the default toolset into the core global registry. */
export function registerDefaultTools() {
  registerTools(httpFetchTool, webSearchTool);
}

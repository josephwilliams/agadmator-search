#!/usr/bin/env node
// agadmator-mcp — MCP stdio server exposing agadmator's chess catalogue.
// Tools: search_games (text + structured filters) and get_game (full detail).
// All retrieval is local against data/index.json — no network, no API key.
// The tool definitions live in tools.js and are shared with the remote
// (Streamable HTTP) server so both transports expose identical tools.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools.js";
import { load } from "./search.js";

const server = new McpServer({ name: "agadmator-mcp", version: "0.1.0" });
registerTools(server);

load(); // warm the index before connecting
await server.connect(new StdioServerTransport());

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { Server } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

async function start() {
  const token = process.env.KINETIX_MCP_TOKEN;
  if (!token) throw new Error("Set KINETIX_MCP_TOKEN to a credential from the studio.");
  const endpoint = new URL(process.env.KINETIX_MCP_URL || "https://kinetix-chan.vercel.app/api/mcp");
  const loopback = ["localhost","127.0.0.1","[::1]"].includes(endpoint.hostname);
  if (endpoint.username || endpoint.password ||
      (endpoint.protocol !== "https:" && !(loopback && endpoint.protocol === "http:"))) {
    throw new Error("Use an HTTPS MCP endpoint or a localhost development URL.");
  }
  const upstream = new Client({name:"kinetix-stdio",version:"1.0.0"});
  const transport = new StreamableHTTPClientTransport(endpoint,{
    requestInit:{headers:{Authorization:"Bearer "+token},redirect:"error"},
  });
  await upstream.connect(transport);

  const server = new Server({name:"kinetix-studio",version:"1.0.0"},{capabilities:{tools:{},resources:{}}});
  server.setRequestHandler("tools/list",request=>upstream.listTools(request.params,{cacheMode:"refresh"}));
  server.setRequestHandler("tools/call",request=>upstream.callTool(request.params));
  server.setRequestHandler("resources/list",request=>upstream.listResources(request.params,{cacheMode:"bypass"}));
  server.setRequestHandler("resources/read",request=>upstream.readResource(request.params,{cacheMode:"bypass"}));
  server.onclose = () => { void upstream.close(); };
  await server.connect(new StdioServerTransport());
}

start().catch(() => {
  console.error("Could not open Kinetix MCP. Check the endpoint and rig credential.");
  process.exitCode = 1;
});

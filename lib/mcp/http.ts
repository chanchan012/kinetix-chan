import { createMcpHonoApp } from "@modelcontextprotocol/hono";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import type { Library } from "../../db/library";
import type { RoomBus } from "../realtime/bus";
import { RigAgent } from "./actions";
import { createStudioMcp } from "./server";

export function mcpHttp(repository:()=>Library, rooms?:()=>RoomBus) {
  const hosts = [process.env.VERCEL_URL,process.env.VERCEL_BRANCH_URL,process.env.VERCEL_PROJECT_PRODUCTION_URL]
    .filter((host):host is string=>Boolean(host));
  const app = createMcpHonoApp({
    host:process.env.VERCEL === "1" ? "0.0.0.0" : "127.0.0.1",
    ...(hosts.length && {allowedHosts:hosts,allowedOrigins:hosts}),
    maxRequestBodySize:1024*1024,
  });
  return app.all("/",async c => {
    const authorization = c.req.header("Authorization");
    const token = authorization?.match(/^Bearer (kinetix_[A-Za-z0-9_-]{43})$/i)?.[1];
    const library = token ? repository() : undefined;
    const credential = token && await library!.tokens.verify(token);
    if (!credential) {
      c.header("WWW-Authenticate",'Bearer realm="Kinetix"');
      return c.json({jsonrpc:"2.0",id:null,error:{code:-32001,message:"A valid rig credential is required."}},401);
    }
    const agent = new RigAgent(library!,credential,rooms);
    const server = createStudioMcp(agent);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator:undefined,enableJsonResponse:true,
    });
    await server.connect(transport);
    const {parsedBody} = c.var as {parsedBody?:unknown};
    return transport.handleRequest(c.req.raw,{parsedBody});
  });
}

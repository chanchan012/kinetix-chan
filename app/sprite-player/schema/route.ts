import { z } from "zod";
import { spriteBundleManifest } from "@/lib/export/sprite-playback";

export const dynamic="force-static";

export function GET() {
  return Response.json(z.toJSONSchema(spriteBundleManifest,{io:"input"}),{
    headers:{"Content-Type":"application/schema+json"},
  });
}

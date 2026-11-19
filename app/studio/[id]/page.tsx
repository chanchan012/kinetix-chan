import { auth } from "@clerk/nextjs/server";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Studio } from "@/components/studio/studio";
import { connectDatabase } from "@/db/client";
import { Library } from "@/db/library";
import { readRigState } from "@/lib/rig/model";
import { tracksSchema } from "@/lib/rig/animation";
import "./studio.css";

export default async function StudioPage({ params }: PageProps<"/studio/[id]">) {
  const { userId } = await auth.protect();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const library = new Library(connectDatabase());
  const row = await library.open(userId, id);
  if (!row) notFound();
  const clips = (await library.listClipAnimation(userId, id)).map(clip => ({...clip, tracks:tracksSchema.parse(clip.tracks)}));
  return <Studio key={id} actorId={userId} rigId={row.id} name={row.name}
    initial={readRigState(row.state)} revision={row.revision} clips={clips} owned={row.owned}
    renderConfigured={Boolean(process.env.INNGEST_SIGNING_KEY || process.env.INNGEST_DEV === "1")}/>;
}

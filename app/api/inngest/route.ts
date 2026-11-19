import { serve } from "inngest/next";
import { z } from "zod";
import { processThumbnails } from "@/jobs/thumbnails";
import { Library } from "@/db/library";
import { connectDatabase } from "@/db/client";
import { exportRequested, inngest } from "@/jobs/client";
import { processExport } from "@/jobs/exports";
import { ExportQueue } from "@/db/exports";

export const runtime = "nodejs";
export const maxDuration = 120;

const thumbnails = inngest.createFunction({
  id:"render-animation-thumbnails",triggers:[{cron:"*/5 * * * *"}],concurrency:1,retries:3
}, async ({step}) => step.run("render-pending-clips",() => processThumbnails(new Library(connectDatabase()))));

const renderExports = inngest.createFunction({
  id:"render-animation-export",triggers:[{event:exportRequested},{cron:"* * * * *"}],concurrency:1,retries:3,
}, async ({event,step}) => {
  const requested = z.object({jobId:z.uuid()}).safeParse(event.data);
  if (event.name === exportRequested && !requested.success) return null;
  return step.run("render-and-persist",() => processExport(new ExportQueue(connectDatabase()),requested.data?.jobId));
});

export const { GET, POST, PUT } = serve({client:inngest,functions:[thumbnails,renderExports]});

import { Inngest } from "inngest";
import { serve } from "inngest/next";
import { processThumbnails } from "@/jobs/thumbnails";
import { Library } from "@/db/library";
import { connectDatabase } from "@/db/client";

export const runtime = "nodejs";
const client = new Inngest({id:"kinetix-motion-studio"});
const thumbnails = client.createFunction({
  id:"render-animation-thumbnails",triggers:[{cron:"*/5 * * * *"}],concurrency:1,retries:3
}, async ({step}) => step.run("render-pending-clips",() => processThumbnails(new Library(connectDatabase()))));
export const { GET, POST, PUT } = serve({client,functions:[thumbnails]});

import type { Library } from "../../db/library";
import type { RoomBus } from "../realtime/bus";
import { readRigState } from "../rig/model";
import { planPngSequence } from "./png-sequence";
import type { SequenceImportInput,SequenceReceipt } from "./sequence-options";

type Actor={userId:string;clientId?:string;kind:"human"|"ai"};

export async function importPngSequence(library:Library,rigId:string,input:SequenceImportInput,actor:Actor,rooms?:()=>RoomBus) {
  const current=await library.open(actor.userId,rigId);
  if (!current) return {error:"not_found",status:404,message:"The rig is no longer available."} as const;
  const conflict=()=>({error:"revision_conflict",status:409,message:"The document changed. Refresh Studio or read the current revision before importing."} as const);
  if (input.revision!==current.revision) return conflict();
  const importId=input.importId ?? crypto.randomUUID();
  let plan:ReturnType<typeof planPngSequence>;
  try {
    const archive=Buffer.from(input.archive,"base64");
    if (archive.toString("base64")!==input.archive) throw new Error("The archive needs valid base64 ZIP data.");
    plan=planPngSequence(readRigState(current.state),archive,{...input,id:importId});
  } catch (error) {
    return {error:"invalid_sequence",status:400,
      message:error instanceof Error ? error.message.slice(0,500) : "Could not import this sequence."} as const;
  }
  const clip:SequenceReceipt["clip"]={id:importId,name:input.name,fps:plan.summary.fps,frameCount:plan.summary.frameCount,tracks:[],trackRevision:0};
  const receipt:SequenceReceipt={rigId,revision:current.revision,importId,drawingId:plan.drawingId,applied:false,
    ...plan.summary,clip,...(plan.previewPng && {previewPng:plan.previewPng})};
  if (input.preflight) return {receipt,status:200} as const;
  const saved=await library.saveSequenceImport(actor.userId,rigId,input.revision,plan.state,clip);
  if (!saved) return conflict();
  receipt.applied=true;
  receipt.revision=saved.revision;
  if (rooms) {
    try {
      const room=rooms();
      await Promise.allSettled([
        room.changed(rigId,{type:"revision",revision:saved.revision,...actor,label:"Import PNG sequence"},plan.state),
        room.timeline(rigId,clip.id),
      ]);
    } catch {
      // Clients recover the committed revision and clip from Neon.
    }
  }
  return {receipt,state:plan.state,status:201} as const;
}

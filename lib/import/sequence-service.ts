import type { Library } from "../../db/library";
import type { RoomBus } from "../realtime/bus";
import { readRigState,type KinetixRigState } from "../rig/model";
import { planPngSequence } from "./png-sequence";
import { planSpriteAtlas } from "./sprite-atlas";
import type { AtlasImportInput,AtlasSummary,ImportedClip,RasterReceipt,SequenceImportInput,SequenceSummary } from "./sequence-options";

type Actor={userId:string;clientId?:string;kind:"human"|"ai"};

type RasterPlan<T>={state:KinetixRigState;drawingId:string;previewPng?:string;details:T;clips:ImportedClip[]};

async function importRaster<T extends object>(library:Library,rigId:string,input:AtlasImportInput,actor:Actor,label:string,
  build:(rig:KinetixRigState,archive:Uint8Array,id:string)=>RasterPlan<T>|Promise<RasterPlan<T>>,rooms?:()=>RoomBus) {
  const current=await library.open(actor.userId,rigId);
  if (!current) return {error:"not_found",status:404,message:"The rig is no longer available."} as const;
  const conflict=()=>({error:"revision_conflict",status:409,message:"The document changed. Refresh Studio or read the current revision before importing."} as const);
  if (input.revision!==current.revision) return conflict();
  const importId=input.importId ?? crypto.randomUUID();
  let plan:RasterPlan<T>;
  try {
    const archive=Buffer.from(input.archive,"base64");
    if (archive.toString("base64")!==input.archive) throw new Error("The archive needs valid base64 ZIP data.");
    plan=await build(readRigState(current.state),archive,importId);
  } catch (error) {
    return {error:"invalid_sequence",status:400,
      message:error instanceof Error ? error.message.slice(0,500) : "Could not import these frames."} as const;
  }
  const receipt:RasterReceipt & T={...plan.details,rigId,revision:current.revision,importId,drawingId:plan.drawingId,applied:false,
    ...(plan.previewPng && {previewPng:plan.previewPng})};
  if (input.preflight) return {receipt,status:200} as const;
  const saved=await library.saveRasterImport(actor.userId,rigId,input.revision,plan.state,plan.clips);
  if (!saved) return conflict();
  receipt.applied=true;
  receipt.revision=saved.revision;
  if (rooms) {
    try {
      const room=rooms();
      await Promise.allSettled([
        room.changed(rigId,{type:"revision",revision:saved.revision,...actor,label},plan.state),
        ...plan.clips.map(clip=>room.timeline(rigId,clip.id)),
      ]);
    } catch {
      // Clients recover the committed revision and clip from Neon.
    }
  }
  return {receipt,state:plan.state,status:201} as const;
}

export function importPngSequence(library:Library,rigId:string,input:SequenceImportInput,actor:Actor,rooms?:()=>RoomBus) {
  return importRaster<SequenceSummary & {clip:ImportedClip}>(library,rigId,input,actor,"Import PNG sequence",(rig,archive,id)=>{
    const plan=planPngSequence(rig,archive,{...input,id});
    const clip:ImportedClip={id,name:input.name,fps:plan.summary.fps,frameCount:plan.summary.frameCount,tracks:[],trackRevision:0};
    return {...plan,details:{...plan.summary,clip},clips:[clip]};
  },rooms);
}

export function importSpriteAtlas(library:Library,rigId:string,input:AtlasImportInput,actor:Actor,rooms?:()=>RoomBus) {
  return importRaster<AtlasSummary>(library,rigId,input,actor,"Import sprite bundle",async(rig,archive,id)=>{
    const plan=await planSpriteAtlas(rig,archive,{...input,id});
    return {...plan,details:plan.summary,clips:plan.summary.clips};
  },rooms);
}

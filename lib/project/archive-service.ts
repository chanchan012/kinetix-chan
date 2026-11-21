import type { Library } from "../../db/library";
import { readRigState } from "../rig/model";
import { archiveSummary,planProjectReopen,readProjectArchive,writeProjectArchive } from "./archive";
import { projectArchiveClipLimit,type ExportProjectInput,type ProjectReopenReceipt,type ReopenProjectInput } from "./archive-options";

export async function exportProject(library:Library,owner:string,id:string,input:ExportProjectInput) {
  const source=await library.projectSnapshot(owner,id);
  if (!source) return {error:"not_found",status:404,message:"The project is no longer available."} as const;
  if (source.clips.length>projectArchiveClipLimit) {
    return {error:"project_too_large",status:400,message:"A portable project supports up to 128 saved clips."} as const;
  }
  const expected=new Map(input.clips.map(clip=>[clip.id,clip.trackRevision]));
  if (source.revision!==input.revision || source.clips.length!==expected.size ||
      source.clips.some(clip=>expected.get(clip.id)!==clip.trackRevision)) {
    return {error:"revision_conflict",status:409,message:"The project or its clips changed. Refresh the saved revisions and try again."} as const;
  }
  try {
    const {bytes,manifest,summary}=writeProjectArchive({...source,state:readRigState(source.state)});
    const filename=`kinetix-${id}.kinetix.zip`;
    return {manifest,summary,filename,byteCount:bytes.length,...(!input.preflight && {bytes})} as const;
  } catch (error) {
    const message=error instanceof Error && /archive limit/.test(error.message) ? error.message : "The saved project contains unsupported artwork or clip timing.";
    return {error:"invalid_project",status:400,message} as const;
  }
}

export async function reopenProject(library:Library,owner:string,input:ReopenProjectInput) {
  let summary:ReturnType<typeof archiveSummary>;
  let target:ReturnType<typeof planProjectReopen>;
  const importId=input.importId ?? crypto.randomUUID();
  try {
    const bytes=Buffer.from(input.archive,"base64");
    if (bytes.toString("base64")!==input.archive) throw new Error("The project needs a valid base64 ZIP.");
    const project=readProjectArchive(bytes);
    summary=archiveSummary(project);
    target=planProjectReopen(project,owner,importId,bytes,input.name ?? summary.name);
  } catch (error) {
    return {error:"invalid_project_archive",status:400,message:error instanceof Error ? error.message.slice(0,360) : "The project could not be read."} as const;
  }
  const receipt:ProjectReopenReceipt={...summary,name:target.name,importId,projectId:target.id,applied:false,clipIds:target.clipIds};
  if (input.preflight) return {receipt,status:200} as const;
  const restored=await library.restoreProject(owner,target);
  if (!restored) return {error:"import_conflict",status:409,message:"Retry using a fresh import ID."} as const;
  return {receipt:{...receipt,applied:true,reused:restored.reused},status:restored.reused ? 200 : 201} as const;
}

import { z } from "zod";
import type { Library } from "../../db/library";
import { queueExport } from "../export/requests";
import { prepareSpritePackage } from "../export/sprite-package";
import { spritePackageRequest } from "../export/sprite-package-options";
import { spriteBundleRequest } from "../export/sprite-bundle-options";
import { prepareSpriteBundle } from "../export/sprite-bundle";
import type { RoomBus } from "../realtime/bus";
import type { RoomPresence } from "../realtime/protocol";
import { channelSchema, easeSchema, sampleRig, setKey, setKeyEase, tracksSchema, type Channel, type Track } from "../rig/animation";
import { editRig, rigCommandSchema, type RigCommand } from "../rig/commands";
import { evaluateRig } from "../rig/kinematics";
import { artboardFor, boneSchema, constraintSchema, partSchema, pointSchema, readRigState, type KinetixRigState } from "../rig/model";
import { pencilKnots, primitiveKnots, primitiveShapes } from "../rig/path-geometry";
import { bindMesh } from "../rig/skinning";
import { viewportFrameFor } from "../rig/render";
import { layerTreeFor } from "../rig/layer-tree";
import { drawingIdSchema } from "../rig/drawings";
import { planSvgImport,svgImportByteLimit } from "../rig/svg-import";
import { atlasImportInput,sequenceImportInput,type AtlasImportInput,type SequenceImportInput } from "../import/sequence-options";
import { importPngSequence,importSpriteAtlas } from "../import/sequence-service";
import { exportProjectInput,reopenProjectInput,type ExportProjectInput,type ReopenProjectInput } from "../project/archive-options";
import { exportProject,reopenProject } from "../project/archive-service";
import { fitImagePlacement,imageBase64,imageFolder,imageId,imageName,imagePlacementSchema } from "../rig/images";
import { inspectImage,verifyProjectImages } from "../import/image-inspection";

const frame = z.int().min(0).max(35_999);
const clipId = z.uuid();
const boneId = boneSchema.shape.id;
const drawnPart = partSchema.omit({mesh:true,knots:true,closed:true});
type Agent = {id:string;rigId:string;userId:string;label:string;allowArchiveReopen?:boolean};
type Selection = RoomPresence["selection"];

export const inputs = {
  create_bone:z.strictObject({bone:boneSchema}),
  attach_ik_constraint:z.strictObject({constraint:constraintSchema}),
  draw_vector_part:z.strictObject({part:partSchema.omit({mesh:true})}),
  draw_primitive:z.strictObject({part:drawnPart,shape:z.enum(primitiveShapes),from:pointSchema,to:pointSchema,square:z.boolean().optional()}),
  draw_pencil_path:z.strictObject({part:drawnPart,points:z.array(pointSchema).min(2).max(1200),tolerance:z.number().min(0.01).max(100)}),
  edit_document:z.strictObject({
    revision:z.int().min(0).max(2_147_483_646),
    commands:z.array(rigCommandSchema).min(1).max(100),
  }),
  import_svg:z.strictObject({
    revision:z.int().min(0).max(2_147_483_646),svg:z.string().min(1).max(svgImportByteLimit),
    name:z.string().trim().min(1).max(120).optional(),importId:z.uuid().optional(),
    placement:z.enum(["original","fit"]).default("original"),preflight:z.boolean().default(false),
  }),
  import_png_sequence:sequenceImportInput,
  import_sprite_bundle:atlasImportInput,
  import_image_asset:z.strictObject({revision:z.int().min(0).max(2_147_483_646),id:imageId,name:imageName,folder:imageFolder.default(""),base64:imageBase64}),
  place_image_asset:z.strictObject({revision:z.int().min(0).max(2_147_483_646),id:imageId,assetId:imageId,mode:imagePlacementSchema.shape.mode.default("reference")}),
  read_image_asset:z.strictObject({id:imageId}),
  read_drawing_cel:z.strictObject({
    drawingId:drawingIdSchema,celId:drawingIdSchema,revision:z.int().min(0).optional(),
    offset:z.int().min(0).max(40_000).default(0),limit:z.int().min(1).max(2000).default(300),
  }),
  bind_mesh_weights:z.strictObject({
    partId:partSchema.shape.id, boneId,
    vertices:z.array(z.strictObject({
      index:z.int().min(0).max(4095),
      weights:z.array(z.strictObject({boneId,weight:z.number().gt(0).max(1)})).min(1).max(4),
    })).min(1).max(4096).optional(),
  }),
  create_animation_clip:z.strictObject({name:z.string().trim().min(1).max(120),fps:z.int().min(1).max(120),frameCount:z.int().min(1).max(36_000)}),
  insert_keyframe:z.strictObject({clipId,channel:channelSchema,frame,value:z.number().min(-1_000_000).max(1_000_000)}),
  set_easing_curve:z.strictObject({clipId,channel:channelSchema,frame,easing:easeSchema}),
  generate_procedural_cycle:z.strictObject({
    clipId,cycle:z.enum(["walk","idle","bounce"]),boneId:boneId.optional(),amplitude:z.number().gt(0).max(120).optional(),
  }),
  bake_ik_to_keyframes:z.strictObject({clipId,constraintId:constraintSchema.shape.id,startFrame:frame.optional(),endFrame:frame.optional()}),
  trigger_lottie_export:z.strictObject({clipId:clipId.optional(),startFrame:frame.optional(),endFrame:frame.optional(),requestId:z.uuid().optional()}),
  export_sprite_package:spritePackageRequest,
  export_sprite_bundle:spriteBundleRequest,
  export_project_archive:exportProjectInput,
  reopen_project_archive:reopenProjectInput,
};
export type ToolName = keyof typeof inputs;

function requireChannel(rig:KinetixRigState, channel:Channel) {
  const items = channel.kind === "part" ? rig.parts : channel.kind === "bone" ? rig.bones : rig.constraints;
  if (!items.some(item=>item.id===channel.id)) throw new Error("This channel does not belong to the current rig.");
}

export class RigAgent {
  constructor(private library:Library, private agent:Agent, private room?:()=>RoomBus) {}
  get rigId() { return this.agent.rigId; }
  get mayReopenArchives() {return this.agent.allowArchiveReopen===true;}
  private get userId() { return this.agent.userId; }

  private async live(publish:(bus:RoomBus)=>Promise<void>) {
    if (!this.room) return;
    try { await publish(this.room()); } catch {}
  }

  private async snapshot() {
    const current = await this.library.get(this.userId,this.rigId);
    if (!current) throw new Error("The rig is no longer available.");
    return {...current, state:readRigState(current.state)};
  }

  private async select(selection:Selection) {
    await this.live(bus=>bus.mark(this.rigId,{
      clientId:this.agent.id, userId:this.userId, kind:"ai", selection, expiresAt:Date.now()+45_000,
    }));
  }

  private async changeRig(label:string, build:(state:KinetixRigState)=>RigCommand | RigCommand[], selection:Selection, expectedRevision?:number) {
    for (let attempt=0; attempt<3; attempt++) {
      const current = await this.snapshot();
      if (expectedRevision !== undefined && current.revision !== expectedRevision) {
        throw new Error("The document has changed. Read its current revision before retrying.");
      }
      const command = build(current.state);
      const commands=Array.isArray(command) ? command : [command];
      const [state] = editRig(current.state,commands);
      if (commands.some(item=>item.type==="image.asset.put")) verifyProjectImages(state.images);
      const saved = await this.library.saveRigState(this.userId,this.rigId,current.revision,state);
      if (saved) {
        await this.live(bus=>bus.changed(this.rigId,{
          type:"revision", revision:saved.revision, clientId:this.agent.id, userId:this.userId,kind:"ai",label,
        },state));
        await this.select(selection);
        return {rigId:this.rigId,revision:saved.revision,command};
      }
    }
    throw new Error("The rig changed while saving. Read its latest hierarchy and retry.");
  }

  private async changeClip(id:string, update:(state:KinetixRigState, tracks:Track[], frames:number)=>Track[]) {
    for (let attempt=0;attempt<3;attempt++) {
      const {state} = await this.snapshot();
      const clip = await this.library.getClipAnimation(this.userId,this.rigId,id);
      if (!clip) throw new Error("The clip does not belong to this rig.");
      const tracks = tracksSchema.parse(update(state,tracksSchema.parse(clip.tracks),clip.frameCount));
      if (tracks.some(track=>track.keys.at(-1)!.frame>=clip.frameCount)) throw new Error("A keyframe lies outside the clip.");
      const saved = await this.library.saveClipTracks(this.userId,this.rigId,id,clip.trackRevision,tracks);
      if (saved) {
        await this.live(bus=>bus.timeline(this.rigId,id));
        return {clipId:id,trackRevision:saved.trackRevision,keyframes:tracks.reduce((sum,track)=>sum+track.keys.length,0)};
      }
    }
    throw new Error("The clip changed while saving. Read its latest timeline and retry.");
  }

  async hierarchy() {
    const {id,name,revision,state} = await this.snapshot();
    const loaded=new Set(state.images?.sources.map(source=>source.sha256));
    const imageUses=layerTreeFor(state).nodes.flatMap(node=>node.kind==="image" ? [{id:node.id,assetId:node.placement.assetId}] : []);
    return {
      rigId:id,name,revision,bones:state.bones,ikConstraints:state.constraints,
      slots:state.parts.map(part=>({id:part.id,name:part.name,parentId:part.parentId,vertices:part.mesh?.vertices.length ?? 0})),
      parts:state.parts,
      layers:layerTreeFor(state),
      swatches:state.swatches ?? [],
      ...(state.spriteSources && {spriteSources:state.spriteSources}),
      imageAssets:state.images?.assets.map(asset=>({...asset,available:loaded.has(asset.sha256),
        placements:imageUses.filter(use=>use.assetId===asset.id).map(use=>use.id)})) ?? [],
      drawings:state.drawings?.layers.map(({cels,...drawing})=>({
        ...drawing,cels:cels.map(cel=>({id:cel.id,runCount:cel.runs.length})),
      })) ?? [],
    };
  }

  async timelineSummary() {
    const clips = await this.library.listClipAnimation(this.userId,this.rigId);
    return {rigId:this.rigId,clips:clips.map(clip=>({...clip,tracks:tracksSchema.parse(clip.tracks)}))};
  }

  async viewportBounds() {
    const {state} = await this.snapshot();
    const {width,height} = artboardFor(state);
    return {rigId:this.rigId,...viewportFrameFor(state),exportArtboard:{x:0,y:0,width,height},
      ...(state.version === 2 && {artboard:state.artboard,guides:state.guides ?? []}),unit:"px",yAxis:"down"};
  }

  createBone({bone}:z.infer<typeof inputs.create_bone>) {
    return this.changeRig("Create bone",()=>({type:"bone.create",bone}),{kind:"bone",id:bone.id});
  }
  attachIK({constraint}:z.infer<typeof inputs.attach_ik_constraint>) {
    return this.changeRig("Attach IK",()=>({type:"ik.create",constraint}),{kind:"bone",id:constraint.upperId});
  }
  drawVector({part}:z.infer<typeof inputs.draw_vector_part>) {
    return this.changeRig("Draw vector part",()=>({type:"part.create",part}),{kind:"part",id:part.id});
  }
  drawPrimitive(input:z.infer<typeof inputs.draw_primitive>) {
    if (input.from.x === input.to.x || input.from.y === input.to.y) throw new Error("The shape needs a width and height.");
    const knots = primitiveKnots(input.shape,input.from,input.to,input.square ?? false);
    return this.drawVector({part:{...input.part,knots,closed:true}});
  }
  drawPencil(input:z.infer<typeof inputs.draw_pencil_path>) {
    const knots = pencilKnots(input.points,input.tolerance);
    return this.drawVector({part:{...input.part,knots,closed:false}});
  }
  async editDocument(input:z.infer<typeof inputs.edit_document>) {
    const exposureClips = new Map<string,number>();
    for (const command of input.commands) if (command.type==="exposure.set") {
      let frameCount=exposureClips.get(command.clipId);
      if (frameCount===undefined) {
        const clip=await this.library.getClipAnimation(this.userId,this.rigId,command.clipId);
        if (!clip) throw new Error("The exposure clip does not belong to this rig.");
        exposureClips.set(command.clipId,frameCount=clip.frameCount);
      }
      if (command.key.frame>=frameCount) throw new Error("The exposure is outside the clip.");
    }
    const edit = input.commands.findLast(command=>command.type==="cel.edit");
    return this.changeRig("Edit document",()=>input.commands,edit ? {kind:"drawing",id:edit.drawingId}:null,input.revision);
  }
  async importSvg(input:z.infer<typeof inputs.import_svg>) {
    const current=await this.snapshot();
    if (current.revision!==input.revision) throw new Error("The document has changed. Read its current revision before retrying.");
    const importId=input.importId ?? crypto.randomUUID();
    const {commands,...receipt}=planSvgImport(input.svg,{name:input.name,importId,
      fit:input.placement==="fit" ? artboardFor(current.state) : undefined});
    const summary={rigId:this.rigId,importId,...receipt,ready:commands.length>0};
    if (input.preflight || !commands.length) {
      if (commands.length) editRig(current.state,commands);
      return {...summary,revision:current.revision,applied:false};
    }
    const saved=await this.changeRig("Import SVG",()=>commands,null,input.revision);
    return {...summary,revision:saved.revision,applied:true};
  }
  async importPngSequence(input:SequenceImportInput) {
    const result=await importPngSequence(this.library,this.rigId,input,
      {kind:"ai",userId:this.userId,clientId:this.agent.id},this.room);
    if ("error" in result) throw new Error(result.message);
    return result.receipt;
  }
  async importSpriteAtlas(input:AtlasImportInput) {
    const result=await importSpriteAtlas(this.library,this.rigId,input,
      {kind:"ai",userId:this.userId,clientId:this.agent.id},this.room);
    if ("error" in result) throw new Error(result.message);
    return result.receipt;
  }
  async importImageAsset(input:z.output<typeof inputs.import_image_asset>) {
    const {base64,revision:oldRevision,id,name,folder}=input;
    const asset={...inspectImage(base64),id,name,folder};
    const {revision,rigId}=await this.changeRig("Import or replace image asset",()=>({type:"image.asset.put",asset,base64}),null,oldRevision);
    return {rigId,revision,asset};
  }
  async placeImageAsset(input:z.output<typeof inputs.place_image_asset>) {
    return this.changeRig("Place image asset",state=>{
      const asset=state.images?.assets.find(asset=>asset.id===input.assetId);
      if (!asset) throw new Error("The image asset does not belong to this rig.");
      return {type:"image.place",id:input.id,placement:fitImagePlacement(asset,artboardFor(state),input.mode)};
    },{kind:"image",id:input.id},input.revision);
  }
  async readImageAsset(input:z.output<typeof inputs.read_image_asset>) {
    const {state,revision}=await this.snapshot();
    const asset=state.images?.assets.find(asset=>asset.id===input.id);
    if (!asset) throw new Error("The image asset does not belong to this rig.");
    const source=state.images?.sources.find(source=>source.sha256===asset.sha256);
    return {asset,revision,available:Boolean(source),...(source && {imageData:source.base64})};
  }
  async readDrawingCel(input:z.infer<typeof inputs.read_drawing_cel>) {
    const {state,revision}=await this.snapshot();
    if (input.revision!==undefined && input.revision!==revision) throw new Error("The drawing changed. Read its latest hierarchy.");
    const drawing=state.drawings?.layers.find(item=>item.id===input.drawingId);
    const cel=drawing?.cels.find(item=>item.id===input.celId);
    if (!drawing || !cel) throw new Error("This cel does not belong to the current drawing.");
    const runs=cel.runs.slice(input.offset,input.offset+input.limit);
    const next=input.offset+runs.length;
    return {drawingId:drawing.id,celId:cel.id,revision,width:drawing.width,height:drawing.height,
      storage:drawing.storage,runs,nextOffset:next<cel.runs.length ? next : null};
  }
  bindWeights(input:z.infer<typeof inputs.bind_mesh_weights>) {
    return this.changeRig("Bind mesh weights",state=>{
      const part = state.parts.find(item=>item.id===input.partId);
      if (!part) throw new Error("The vector part was not found.");
      const mesh = {...(part.mesh ?? bindMesh(part,evaluateRig(state),input.boneId))};
      if (!mesh.bindings.some(binding=>binding.id===input.boneId)) throw new Error("Choose a bone with a bind transform.");
      if (!input.vertices?.length) {
        mesh.vertices = mesh.vertices.map(vertex=>({...vertex,splitFrom:undefined,weights:[{boneId:input.boneId,weight:1}]}));
      } else {
        const updates = new Map(input.vertices.map(vertex=>[vertex.index,vertex.weights]));
        if (updates.size !== input.vertices.length || [...updates.keys()].some(index=>index>=mesh.vertices.length)) {
          throw new Error("Weight edits require unique, existing mesh vertex indexes.");
        }
        mesh.vertices = mesh.vertices.map((vertex,index)=>{
          const weights = updates.get(index);
          if (!weights) return vertex;
          const sum = weights.reduce((total,item)=>total+item.weight,0);
          return {...vertex,splitFrom:undefined,weights:weights.map(weight=>({...weight,weight:weight.weight/sum}))};
        });
      }
      return {type:"part.update",id:part.id,changes:{mesh}};
    },{kind:"part",id:input.partId});
  }

  async createClip(input:z.infer<typeof inputs.create_animation_clip>) {
    const result = await this.library.addClip(this.userId,this.rigId,input);
    if (!result || typeof result.id !== "string") throw new Error("The rig is no longer available.");
    await this.live(bus=>bus.timeline(this.rigId,result.id as string));
    return result;
  }

  async insertKey(input:z.infer<typeof inputs.insert_keyframe>) {
    const result = await this.changeClip(input.clipId,(rig,tracks)=>{
      requireChannel(rig,input.channel);
      return setKey(tracks,input.channel,input.frame,input.value);
    });
    if (input.channel.kind!=="ik") await this.select({kind:input.channel.kind,id:input.channel.id});
    return result;
  }

  setEasing(input:z.infer<typeof inputs.set_easing_curve>) {
    return this.changeClip(input.clipId,(rig,tracks)=>{
      requireChannel(rig,input.channel);
      const track = tracks.find(item=>item.channel.kind===input.channel.kind &&
        item.channel.id===input.channel.id && item.channel.property===input.channel.property);
      if (!track?.keys.some(key=>key.frame===input.frame)) throw new Error("Insert a keyframe before setting its easing.");
      return setKeyEase(tracks,input.channel,input.frame,input.easing);
    });
  }

  async generateCycle(input:z.infer<typeof inputs.generate_procedural_cycle>) {
    let selectedId: string | undefined;
    const result = await this.changeClip(input.clipId,(rig,tracks,frames)=>{
      if (frames<3) throw new Error("A procedural cycle requires at least three frames.");
      const bone = input.boneId ? rig.bones.find(item=>item.id===input.boneId) :
        rig.bones.find(item=>item.id===(input.cycle==="walk" ? "upper" : "root")) ?? rig.bones[0];
      if (!bone) throw new Error("Choose a bone from this rig.");
      selectedId = bone.id;
      const constraint = rig.constraints.find(item=>item.enabled!==false && [item.upperId,item.lowerId].includes(bone.id));
      const channel:Channel = constraint ?
        {kind:"ik",id:constraint.id,property:input.cycle==="walk" ? "x" : "y"} :
        {kind:"bone",id:bone.id,property:input.cycle==="walk" ? "rotation" : "y"};
      const amount = input.amplitude ?? (input.cycle==="walk" ? 27 : input.cycle==="bounce" ? 30 : 6);
      const samples = input.cycle==="walk" ? [0,1,0,-1,0] : input.cycle==="bounce" ? [0,0.7,1,0.7,0] : [0,0.5,1,0.5,0];
      const keys = Math.min(samples.length,frames);
      let next = tracks.filter(item=>!(item.channel.kind===channel.kind &&
        item.channel.id===channel.id && item.channel.property===channel.property));
      for (let index=0;index<keys;index++) {
        const at = Math.round(index*(frames-1)/(keys-1));
        const sample = samples[Math.round(index*(samples.length-1)/(keys-1))];
        const value = constraint ? channel.property==="x" ? constraint.target.x + sample*amount : constraint.target.y - sample*amount :
          channel.property==="rotation" ? bone.rotation + sample*amount*Math.PI/180 : bone.offset.y-sample*amount;
        next = setKey(next,channel,at,value);
      }
      return next;
    });
    if (selectedId) await this.select({kind:"bone",id:selectedId});
    return result;
  }

  bakeIK(input:z.infer<typeof inputs.bake_ik_to_keyframes>) {
    return this.changeClip(input.clipId,(rig,tracks,frames)=>{
      const constraint = rig.constraints.find(item=>item.id===input.constraintId);
      if (!constraint) throw new Error("The IK constraint was not found.");
      const start = input.startFrame ?? 0;
      const end = input.endFrame ?? frames-1;
      if (start>end || end>=frames || end-start>=240) throw new Error("Choose an inclusive bake range of up to 240 frames.");
      const upper = rig.bones.find(item=>item.id===constraint.upperId)!;
      const upperChannel = {kind:"bone",id:constraint.upperId,property:"rotation"} as const;
      const lowerChannel = {kind:"bone",id:constraint.lowerId,property:"rotation"} as const;
      const enabled = {kind:"ik",id:constraint.id,property:"enabled"} as const;
      let next = tracks;
      for (let at=start;at<=end;at++) {
        const pose = evaluateRig(sampleRig(rig,tracks,at));
        const upperAngle = pose.get(upper.id)!.angle;
        const parent = upper.parentId ? pose.get(upper.parentId)!.angle : 0;
        next = setKey(next,upperChannel,at,upperAngle-parent);
        next = setKey(next,lowerChannel,at,pose.get(constraint.lowerId)!.angle-upperAngle);
        next = setKey(next,enabled,at,0);
      }
      if (start>0) next = setKey(next,enabled,start-1,1);
      if (end+1<frames) next = setKey(next,enabled,end+1,1);
      return next;
    });
  }

  async triggerLottie(input:z.infer<typeof inputs.trigger_lottie_export>) {
    const result = await queueExport(this.library.exports,this.userId,this.rigId,{
      id:input.requestId ?? crypto.randomUUID(),format:"lottie",
      clipId:input.clipId,startFrame:input.startFrame,endFrame:input.endFrame,
    });
    if ("error" in result) throw new Error("Could not queue Lottie export: "+result.error);
    return result.job;
  }

  async exportSpritePackage(input:z.output<typeof spritePackageRequest>) {
    const result = await prepareSpritePackage(this.library.exports,this.userId,this.rigId,input);
    if ("error" in result && result.error) throw new Error("Sprite package export failed: " + result.error);
    return {
      manifest:result.manifest,
      ...(result.bytes && { filename:"kinetix-" + input.clipId + ".zip",mimeType:"application/zip",
        base64:Buffer.from(result.bytes).toString("base64") }),
    };
  }
  async exportSpriteBundle(input:z.output<typeof spriteBundleRequest>) {
    const result=await prepareSpriteBundle(this.library.exports,this.userId,this.rigId,input);
    if ("error" in result && result.error) throw new Error("Sprite bundle export failed: "+result.error);
    return {
      manifest:result.manifest,
      ...(result.bytes && {filename:"kinetix-"+this.rigId+"-sprites.zip",mimeType:"application/zip",
        base64:Buffer.from(result.bytes).toString("base64")}),
    };
  }
  async exportProjectArchive(input:ExportProjectInput) {
    const result=await exportProject(this.library,this.userId,this.rigId,input);
    if ("error" in result) throw new Error(result.message);
    const {bytes,...receipt}=result;
    return {...receipt,...(bytes && {base64:Buffer.from(bytes).toString("base64"),mimeType:"application/zip"})};
  }
  async reopenProjectArchive(input:ReopenProjectInput) {
    if (!this.mayReopenArchives) throw new Error("This rig credential does not have project reopening permission.");
    const result=await reopenProject(this.library,this.userId,input);
    if ("error" in result) throw new Error(result.message);
    return result.receipt;
  }
}

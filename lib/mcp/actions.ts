import { z } from "zod";
import type { Library } from "../../db/library";
import { artboard } from "../export/frames";
import { queueExport } from "../export/requests";
import type { RoomBus } from "../realtime/bus";
import type { RoomPresence } from "../realtime/protocol";
import { channelSchema, easeSchema, sampleRig, setKey, setKeyEase, tracksSchema, type Channel, type Track } from "../rig/animation";
import { editRig, type RigCommand } from "../rig/commands";
import { evaluateRig } from "../rig/kinematics";
import { boneSchema, constraintSchema, partSchema, readRigState, type KinetixRigState } from "../rig/model";
import { bindMesh } from "../rig/skinning";
import { viewportFrame } from "../rig/render";

const frame = z.int().min(0).max(35_999);
const clipId = z.uuid();
const boneId = boneSchema.shape.id;
type Agent = {id:string;rigId:string;userId:string;label:string};
type Selection = RoomPresence["selection"];

export const inputs = {
  create_bone:z.strictObject({bone:boneSchema}),
  attach_ik_constraint:z.strictObject({constraint:constraintSchema}),
  draw_vector_part:z.strictObject({part:partSchema.omit({mesh:true})}),
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
};
export type ToolName = keyof typeof inputs;

function requireChannel(rig:KinetixRigState, channel:Channel) {
  const items = channel.kind === "bone" ? rig.bones : rig.constraints;
  if (!items.some(item=>item.id===channel.id)) throw new Error("This channel does not belong to the current rig.");
}

export class RigAgent {
  constructor(private library:Library, private agent:Agent, private room?:()=>RoomBus) {}
  get rigId() { return this.agent.rigId; }
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

  private async changeRig(label:string, build:(state:KinetixRigState)=>RigCommand, selection:Selection) {
    for (let attempt=0; attempt<3; attempt++) {
      const current = await this.snapshot();
      const command = build(current.state);
      const [state] = editRig(current.state,[command]);
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
    return {
      rigId:id,name,revision,bones:state.bones,ikConstraints:state.constraints,
      slots:state.parts.map(part=>({id:part.id,name:part.name,parentId:part.parentId,vertices:part.mesh?.vertices.length ?? 0})),
    };
  }

  async timelineSummary() {
    const clips = await this.library.listClipAnimation(this.userId,this.rigId);
    return {rigId:this.rigId,clips:clips.map(clip=>({...clip,tracks:tracksSchema.parse(clip.tracks)}))};
  }

  viewportBounds() {
    return {rigId:this.rigId,...viewportFrame,exportArtboard:{x:0,y:0,...artboard},unit:"px",yAxis:"down"};
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
  bindWeights(input:z.infer<typeof inputs.bind_mesh_weights>) {
    return this.changeRig("Bind mesh weights",state=>{
      const part = state.parts.find(item=>item.id===input.partId);
      if (!part) throw new Error("The vector part was not found.");
      const mesh = {...(part.mesh ?? bindMesh(part,evaluateRig(state),input.boneId))};
      if (!mesh.bindings.some(binding=>binding.id===input.boneId)) throw new Error("Choose a bone with a bind transform.");
      if (!input.vertices?.length) {
        mesh.vertices = mesh.vertices.map(vertex=>({...vertex,weights:[{boneId:input.boneId,weight:1}]}));
      } else {
        const updates = new Map(input.vertices.map(vertex=>[vertex.index,vertex.weights]));
        if (updates.size !== input.vertices.length || [...updates.keys()].some(index=>index>=mesh.vertices.length)) {
          throw new Error("Weight edits require unique, existing mesh vertex indexes.");
        }
        mesh.vertices = mesh.vertices.map((vertex,index)=>{
          const weights = updates.get(index);
          if (!weights) return vertex;
          const sum = weights.reduce((total,item)=>total+item.weight,0);
          return {...vertex,weights:weights.map(weight=>({...weight,weight:weight.weight/sum}))};
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
    if (input.channel.kind==="bone") await this.select({kind:"bone",id:input.channel.id});
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
}

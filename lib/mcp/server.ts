import { McpServer, type CallToolResult, type StandardSchemaWithJSON } from "@modelcontextprotocol/server";
import { z } from "zod";
import { inputs, type RigAgent, type ToolName } from "./actions";

export function createStudioMcp(agent:RigAgent) {
  const server = new McpServer({name:"kinetix-studio",version:"1.0.0"},{
    instructions:"This connection is scoped to one Kinetix rig. Frames are zero-based. Coordinates use canvas pixels, and rotations use radians.",
  });
  const resource = (name:string, description:string, read:()=>unknown|Promise<unknown>) => {
    const link = "kinetix://"+name;
    server.registerResource(name,link,{description,mimeType:"application/json"},async () => ({
      contents:[{uri:link,mimeType:"application/json",text:JSON.stringify(await read())}],
    }));
  };
  resource("rig-hierarchy","Bones, parent transforms, lengths, IK constraints and vector slots.",()=>agent.hierarchy());
  resource("timeline-summary","Clip durations, frame rates, keyframes and outgoing easing.",()=>agent.timelineSummary());
  resource("viewport-bounds","The rig artboard bounds and coordinate convention.",()=>agent.viewportBounds());

  function tool<Schema extends z.ZodType>(
    name:ToolName, description:string, schema:Schema, run:(input:z.output<Schema>)=>Promise<object>,
  ) {
    const inputSchema:StandardSchemaWithJSON = schema;
    server.registerTool(name,{description,inputSchema,annotations:{
      readOnlyHint:false,
      destructiveHint:["bind_mesh_weights","generate_procedural_cycle","bake_ik_to_keyframes"].includes(name),
      idempotentHint:false,openWorldHint:false,
    }},async (raw:unknown):Promise<CallToolResult> => {
      try {
        const data = await run(schema.parse(raw));
        return {content:[{type:"text" as const,text:JSON.stringify(data)}],structuredContent:{...data}};
      } catch (error) {
        const message = error instanceof Error && !/failed query|connection|sqlstate/i.test(error.message) ?
          error.message.slice(0,1200) : "Kinetix could not apply this operation.";
        return {isError:true,content:[{type:"text" as const,text:message}]};
      }
    });
  }
  tool("create_bone","Create a bone with a stable ID, optional parent, and local transform.",inputs.create_bone,input=>agent.createBone(input));
  tool("attach_ik_constraint","Attach a two-bone constraint to a connected upper and lower bone pair.",inputs.attach_ik_constraint,input=>agent.attachIK(input));
  tool("draw_vector_part","Add an open or closed vector path with optional cubic handles and bone parent.",inputs.draw_vector_part,input=>agent.drawVector(input));
  tool("bind_mesh_weights","Bind a closed vector part and assign up to four influences to specified vertices.",inputs.bind_mesh_weights,input=>agent.bindWeights(input));
  tool("create_animation_clip","Create a saved clip with a frame rate and duration in frames.",inputs.create_animation_clip,input=>agent.createClip(input));
  tool("insert_keyframe","Insert or replace a value in a bone or IK channel at a zero-based frame.",inputs.insert_keyframe,input=>agent.insertKey(input));
  tool("set_easing_curve","Update the outgoing cubic Bézier at an existing keyframe.",inputs.set_easing_curve,input=>agent.setEasing(input));
  tool("generate_procedural_cycle","Replace the selected channel with a walk, idle or bounce cycle.",inputs.generate_procedural_cycle,input=>agent.generateCycle(input));
  tool("bake_ik_to_keyframes","Sample IK into bone rotation keys and disable the constraint in the baked clip range.",inputs.bake_ik_to_keyframes,input=>agent.bakeIK(input));
  tool("trigger_lottie_export","Queue a Lottie snapshot for the selected clip or the rig's study animation.",inputs.trigger_lottie_export,input=>agent.triggerLottie(input));
  return server;
}

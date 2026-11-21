import { McpServer, type CallToolResult, type StandardSchemaWithJSON } from "@modelcontextprotocol/server";
import { z } from "zod";
import { inputs, type RigAgent, type ToolName } from "./actions";

export function createStudioMcp(agent:RigAgent) {
  const server = new McpServer({name:"kinetix-studio",version:"1.0.0"},{
    instructions:"Read and edit the bound Kinetix rig. An explicit archive grant can reopen a new private project under the same owner. Frames are zero-based. Coordinates use canvas pixels, and rotations use radians.",
  });
  const resource = (name:string, description:string, read:()=>unknown|Promise<unknown>) => {
    const link = "kinetix://"+name;
    server.registerResource(name,link,{description,mimeType:"application/json"},async () => ({
      contents:[{uri:link,mimeType:"application/json",text:JSON.stringify(await read())}],
    }));
  };
  resource("rig-hierarchy","Bones, IK, vector artwork, raster drawings and cel exposure tracks.",()=>agent.hierarchy());
  resource("timeline-summary","Clip durations, frame rates, keyframes and outgoing easing.",()=>agent.timelineSummary());
  resource("viewport-bounds","The rig artboard bounds and coordinate convention.",()=>agent.viewportBounds());

  function tool<Schema extends z.ZodType>(
    name:ToolName, description:string, schema:Schema, run:(input:z.output<Schema>)=>Promise<object>,
  ) {
    const inputSchema:StandardSchemaWithJSON = schema;
    const spriteExport=name==="export_sprite_package" || name==="export_sprite_bundle" || name==="export_fixed_sprite_bundle";
    const archiveExport=name==="export_project_archive";
    server.registerTool(name,{description,inputSchema,annotations:{
      readOnlyHint:spriteExport || archiveExport || name==="read_drawing_cel" || name==="read_image_asset",
      destructiveHint:["edit_document","bind_mesh_weights","generate_procedural_cycle","bake_ik_to_keyframes"].includes(name),
      idempotentHint:spriteExport || archiveExport || name==="read_drawing_cel" || name==="read_image_asset",openWorldHint:false,
    }},async (raw:unknown):Promise<CallToolResult> => {
      try {
        const data = await run(schema.parse(raw));
        if (name==="read_image_asset" && "imageData" in data && typeof data.imageData==="string" && "asset" in data) {
          const {imageData,...receipt}=data;
          const {mimeType}=receipt.asset as {mimeType:string};
          return {content:[{type:"text",text:JSON.stringify(receipt)},{type:"image",mimeType,data:imageData}],structuredContent:receipt};
        }
        if ((name==="import_png_sequence" || name==="import_sprite_bundle") && "previewPng" in data && typeof data.previewPng==="string") {
          const {previewPng,...receipt}=data;
          return {content:[{type:"text",text:JSON.stringify(receipt)},{type:"image",mimeType:"image/png",data:previewPng}],
            structuredContent:receipt};
        }
        const message = spriteExport && "base64" in data ?
          "Sprite package ready. Decode structuredContent.base64 to save the ZIP." : archiveExport && "base64" in data ?
          "Project archive ready. Decode structuredContent.base64 to save the ZIP." : JSON.stringify(data);
        return {content:[{type:"text" as const,text:message}],structuredContent:{...data}};
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
  tool("draw_primitive","Draw a rectangle, ellipse or star from opposite corners in the part's local coordinates.",inputs.draw_primitive,input=>agent.drawPrimitive(input));
  tool("draw_pencil_path","Simplify and smooth a sequence of sampled points in the part's local coordinates.",inputs.draw_pencil_path,input=>agent.drawPencil(input));
  tool("edit_document","Apply one atomic batch of rig and artwork commands at the specified revision.",inputs.edit_document,input=>agent.editDocument(input));
  tool("import_svg","Preflight or add a local SVG as an editable group at a saved revision. Returns import diagnostics and the created group ID.",inputs.import_svg,input=>agent.importSvg(input));
  tool("import_png_sequence","Preflight or import a base64 PNG sequence ZIP as a saved clip and editable RGBA drawing layer at the supplied revision.",
    inputs.import_png_sequence,input=>agent.importPngSequence(input));
  tool("import_sprite_bundle","Preflight or import a base64 Kinetix v2 sprite bundle as saved clips and editable cels with source timing and companion metadata.",
    inputs.import_sprite_bundle,input=>agent.importSpriteAtlas(input));
  tool("import_image_asset","Import a base64 still PNG or WebP. To replace or relink an image for all its placements, reuse its asset ID.",
    inputs.import_image_asset,input=>agent.importImageAsset(input));
  tool("place_image_asset","Place a saved image as a studio reference or as renderable artwork. Edit positioning and bone attachment through edit_document.",
    inputs.place_image_asset,input=>agent.placeImageAsset(input));
  tool("read_image_asset","Read an image asset and its validated bytes from the bound project.",inputs.read_image_asset,input=>agent.readImageAsset(input));
  tool("read_drawing_cel","Read a revision-pinned page of a cel's pixel runs as [row, left, width, ink].",inputs.read_drawing_cel,input=>agent.readDrawingCel(input));
  tool("bind_mesh_weights","Bind a closed vector part and assign up to four influences to specified vertices.",inputs.bind_mesh_weights,input=>agent.bindWeights(input));
  tool("create_animation_clip","Create a saved clip with a frame rate and duration in frames.",inputs.create_animation_clip,input=>agent.createClip(input));
  tool("insert_keyframe","Insert or replace a value in a bone, IK, or path position channel at a zero-based frame.",inputs.insert_keyframe,input=>agent.insertKey(input));
  tool("set_easing_curve","Update the outgoing cubic Bézier at an existing keyframe.",inputs.set_easing_curve,input=>agent.setEasing(input));
  tool("generate_procedural_cycle","Replace the selected channel with a walk, idle or bounce cycle.",inputs.generate_procedural_cycle,input=>agent.generateCycle(input));
  tool("bake_ik_to_keyframes","Sample IK into bone rotation keys and disable the constraint in the baked clip range.",inputs.bake_ik_to_keyframes,input=>agent.bakeIK(input));
  tool("trigger_lottie_export","Queue a Lottie snapshot for the selected clip or the rig's study animation.",inputs.trigger_lottie_export,input=>agent.triggerLottie(input));
  tool("export_sprite_package","Preflight or render a fixed-grid sprite ZIP from a saved clip at the specified revisions.",inputs.export_sprite_package,input=>agent.exportSpritePackage(input));
  tool("export_sprite_bundle","Preflight or render an owner-scoped, revision-pinned multi-clip ZIP with loose frames, fixed grids or packed atlas pages.",inputs.export_sprite_bundle,input=>agent.exportSpriteBundle(input));
  tool("export_fixed_sprite_bundle","Preflight or export revision-pinned clips as plain numbered PNGs or grid sheets at a fixed FPS, with timing error and cue mappings.",
    inputs.export_fixed_sprite_bundle,input=>agent.exportFixedSpriteBundle(input));
  tool("export_project_archive","Preflight or download the editable project ZIP. Supply the saved document revision and every clip ID and track revision.",
    inputs.export_project_archive,input=>agent.exportProjectArchive(input));
  if (agent.mayReopenArchives) tool("reopen_project_archive","Preview or reopen a portable project ZIP as a fresh private project. Reuse the preview import ID when applying.",
    inputs.reopen_project_archive,input=>agent.reopenProjectArchive(input));
  return server;
}

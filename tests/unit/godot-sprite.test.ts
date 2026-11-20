import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, it } from "vitest";
import { prepareSpritePackage } from "../../lib/export/sprite-package";
import { spritePackageRequest } from "../../lib/export/sprite-package-options";
import { setKey } from "../../lib/rig/animation";
import { createBlankRig } from "../../lib/rig/model";
import { editRig, type RigCommand } from "../../lib/rig/commands";

const godot = process.env.KINETIX_GODOT_PATH;

it.skipIf(!godot)("plays and reimports a Kinetix sprite package in a clean Godot project", async () => {
  const projectRoot = realpathSync(tmpdir());
  const project = realpathSync(mkdtempSync(join(projectRoot,"kinetix-godot-test-")));
  const rigId = "7cedd2ee-7e40-4539-8250-dabe25a308d1";
  const clipId = "ec445c9b-ec43-40fc-a2b6-bed51a59a906";
  const scene = `res://kinetix_generated/${rigId}/${clipId}/sprite.tscn`;
  const projectFile = join(project,"project.godot");
  const wrapper = `[gd_scene load_steps=2 format=3]
[ext_resource type="PackedScene" path="${scene}" id="1"]
[node name="Character" type="Node2D"]
position = Vector2(100,200)
[node name="ImportedSprite" parent="." instance=ExtResource("1")]
`;
  const rig = createBlankRig({name:"Lantern",width:64,height:64,background:null});
  rig.parts.push({id:"lantern",name:"Lantern",offset:{x:0,y:0},parentId:null,closed:true,fill:"#ee6c17",
    knots:[{point:{x:4,y:10}},{point:{x:16,y:10}},{point:{x:16,y:22}},{point:{x:4,y:22}}]});
  const channel = {kind:"part",id:"lantern",property:"x"} as const;

  function run(script:string, argument:string) {
    return execFileSync(godot!,["--headless","--path",project,"--script","res://" + script,"--",argument],
      {encoding:"utf8",timeout:15_000,windowsHide:true});
  }

  try {
    writeFileSync(projectFile,'config_version=5\n[application]\nconfig/name="Kinetix Import Test"\n[rendering]\nrenderer/rendering_method="gl_compatibility"\n');
    copyFileSync("integrations/godot/import_sprite_package.gd",join(project,"import.gd"));
    copyFileSync("tests/engine/check_godot_sprite.gd",join(project,"check.gd"));
    writeFileSync(join(project,"character.tscn"),wrapper);

    for (const [mode,name,revision,x,pivot] of [
      ["initial","Lantern",0,20,{x:12,y:20}],
      ["revised","Lantern revised",1,28,{x:30,y:32}],
    ] as const) {
      const tracks = setKey(setKey(setKey([],channel,0,0),channel,1,x),channel,2,0);
      const packageResult = await prepareSpritePackage({inputs:async()=>({rigId,revision,state:rig,name,
        clip:{id:clipId,name,frameCount:3,fps:12,trackRevision:revision,tracks},
      })},"owner",rigId,spritePackageRequest.parse({clipId,revision,trackRevision:revision,startFrame:0,endFrame:2,pivot}));
      if (!packageResult.bytes) throw new Error("Godot fixture package could not be exported.");
      const zip = join(project,mode+".zip");
      writeFileSync(zip,packageResult.bytes);
      expect(run("import.gd",zip)).toContain(scene);
      expect(run("check.gd",mode)).toContain("KINETIX_PLAYBACK " + mode);
      expect(readFileSync(join(project,"character.tscn"),"utf8")).toBe(wrapper);
    }
    const drawingId="flame";
    const transitions=[0,2,5,8,12,14];
    const actions = transitions.flatMap((frame,index):RigCommand[]=>{
      const id="pose-"+index;
      return [
        {type:"cel.create",drawingId,id,sourceId:index===1?"pose-0":undefined},
        {type:"cel.replace",drawingId,id,runs:[[15,7+index,1,255]]},
        {type:"exposure.set",drawingId,clipId,key:{frame,celId:id}},
      ];
    });
    const [drawing] = editRig(createBlankRig({name:"Flame",width:64,height:64,background:null}),[
      {type:"drawing.create",drawing:{id:drawingId,name:"Flame",width:64,height:64,
        storage:{mode:"indexed",colors:["#ff9500"]}}},
      ...actions,
      {type:"exposure.set",drawingId,clipId,key:{frame:11,celId:null}},
    ]);
    for (const scale of [1,3]) {
      const mode="cels-"+scale;
      const pixelPackage = await prepareSpritePackage({inputs:async()=>({rigId,revision:2,state:drawing,name:"Flame",
        clip:{id:clipId,name:"Flame",frameCount:16,fps:12,trackRevision:2,tracks:[]}})},
      "owner",rigId,spritePackageRequest.parse({clipId,revision:2,trackRevision:2,startFrame:0,endFrame:15,scale,pivot:{x:12,y:20}}));
      if (!pixelPackage.bytes) throw new Error("The Godot cel package could not be exported.");
      const celZip=join(project,mode+".zip");
      writeFileSync(celZip,pixelPackage.bytes);
      expect(run("import.gd",celZip)).toContain(scene);
      expect(run("check.gd",mode)).toContain("KINETIX_PLAYBACK "+mode);
      expect(readFileSync(join(project,"character.tscn"),"utf8")).toBe(wrapper);
    }
  } finally {
    if (dirname(project) === projectRoot) rmSync(project,{recursive:true,force:true});
  }
},90_000);

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, readdirSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, it } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { prepareSpriteBundle } from "../../lib/export/sprite-bundle";
import { spriteBundleRequest } from "../../lib/export/sprite-bundle-options";
import { openSpriteBundle, restoreSpritePixels } from "../../lib/export/sprite-playback";
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

it.skipIf(!godot)("imports version 2 layouts and preserves native playback and game references on reimport", async () => {
  const temp = realpathSync(tmpdir());
  const project = realpathSync(mkdtempSync(join(temp, "kinetix-godot-bundle-")));
  const rigId = "7cedd2ee-7e40-4539-8250-dabe25a308d1";
  const east = "ec445c9b-ec43-40fc-a2b6-bed51a59a906";
  const west = "9c44513b-fb93-4e63-945f-4f14de667fa6";
  const jump = "ec445c9b-ec43-40fc-a2b6-bed51a59a907";
  const blink = "ec445c9b-ec43-40fc-a2b6-bed51a59a908";
  const root = `kinetix_generated/${rigId}`;
  const wrapper = `[gd_scene load_steps=2 format=3]
[ext_resource type="PackedScene" path="res://${root}/${east}/sprite.tscn" id="1"]
[node name="Character" type="Node2D"]
position = Vector2(100,200)
[node name="ImportedSprite" parent="." instance=ExtResource("1")]
speed_scale = 2.0
`;
  const drawingId = "flame";
  const [state] = editRig(createBlankRig({name:"Flame",width:16,height:16,background:null}),[
    {type:"drawing.create",drawing:{id:drawingId,name:"Flame",width:16,height:16,
      storage:{mode:"indexed",colors:["#ff0040","#288dcf"]}}},
    {type:"cel.create",drawingId,id:"tall"},
    {type:"cel.replace",drawingId,id:"tall",runs:[[2,5,1,255],[3,5,1,255],[4,5,2,255],[5,6,1,192]]},
    {type:"cel.create",drawingId,id:"wide"},
    {type:"cel.replace",drawingId,id:"wide",runs:[[7,9,4,511]]},
    {type:"exposure.set",drawingId,clipId:east,key:{frame:0,celId:"tall"}},
    {type:"exposure.set",drawingId,clipId:east,key:{frame:1,celId:null}},
    {type:"exposure.set",drawingId,clipId:east,key:{frame:2,celId:"wide"}},
    {type:"exposure.set",drawingId,clipId:west,key:{frame:0,celId:"wide"}},
    {type:"exposure.set",drawingId,clipId:west,key:{frame:1,celId:"tall"}},
    {type:"exposure.set",drawingId,clipId:west,key:{frame:2,celId:null}},
    {type:"exposure.set",drawingId,clipId:jump,key:{frame:0,celId:"wide"}},
  ]);
  const clips = [
    {id:east,trackRevision:2,startFrame:0,endFrame:2,direction:"east",pivot:{x:6,y:10},frames:[
      {frame:0,durationTicks:4,origin:{x:5,y:9},sockets:[{name:"glow",x:6,y:5,angle:0.5}],
        collisions:[{name:"hot",kind:"rect",x:4,y:2,width:3,height:4}],events:[
          {name:"ignite",tick:3,data:{flammable:true}},{name:"start",tick:0},{name:"spark",tick:3},
        ]},
      {frame:1,durationTicks:2,pivot:{x:7,y:11}},
      {frame:2,durationTicks:3,events:[{name:"last",tick:2}]},
    ]},
    {id:west,trackRevision:2,startFrame:0,endFrame:2,direction:"west",loopMode:"ping-pong",
      frames:[{frame:0,durationTicks:3},{frame:1,durationTicks:2,events:[{name:"left",tick:1}]},{frame:2,durationTicks:1}]},
    {id:jump,trackRevision:2,startFrame:0,endFrame:0,loopMode:"once",
      frames:[{frame:0,durationTicks:2,events:[{name:"land",tick:1}]}]},
    {id:blink,trackRevision:2,startFrame:0,endFrame:0,loopMode:"repeat",
      frames:[{frame:0,durationTicks:2,events:[{name:"blink",tick:1}]}]},
  ];
  const run = (script:string, argument:string) => execFileSync(godot!,[
    "--headless","--path",project,"--script","res://"+script,"--",argument,
  ],{encoding:"utf8",timeout:15_000,windowsHide:true});
  const namedClip = (id:string, renamed=false) => ({
    id,name:id===east && renamed ? "Flicker Sunrise" : id===jump ? "Jump" : id===blink ? "Blink" : "Flicker",
    frameCount:3,fps:24,trackRevision:2,tracks:[],
  });
  const receipt = (output:string) => {
    const line = output.split(/\r?\n/).find(line=>line.startsWith("KINETIX_IMPORT "));
    if (!line) throw new Error(output);
    return JSON.parse(line.slice("KINETIX_IMPORT ".length));
  };
  try {
    writeFileSync(join(project,"project.godot"),'config_version=5\n[application]\nconfig/name="Kinetix Bundle Test"\n[rendering]\nrenderer/rendering_method="gl_compatibility"\n');
    for (const script of ["import_sprite_package.gd","import_sprite_bundle.gd","kinetix_sprite.gd"]) {
      copyFileSync("integrations/godot/"+script,join(project,script));
    }
    copyFileSync("tests/engine/check_godot_bundle.gd",join(project,"check.gd"));
    writeFileSync(join(project,"character.tscn"),wrapper);

    // The wrapper already points at and uses the key of the legacy single-clip scene.
    const legacy = await prepareSpritePackage({inputs:async()=>({rigId,revision:7,state,name:"Flame",clip:namedClip(east)})},
      "owner",rigId,spritePackageRequest.parse({clipId:east,revision:7,trackRevision:2,startFrame:0,endFrame:2}));
    if (!legacy.bytes) throw new Error("The legacy migration fixture could not be exported.");
    const legacyZip = join(project,"legacy.zip");
    writeFileSync(legacyZip,legacy.bytes);
    expect(receipt(run("import_sprite_package.gd",legacyZip)).scene).toBe(`res://${root}/${east}/sprite.tscn`);

    for (const layout of ["loose","fixed-grid","packed"] as const) {
      const scale = layout==="fixed-grid" ? 1 : 3;
      const packed = layout==="packed";
      const result = await prepareSpriteBundle({inputs:async(_owner,_rig,id)=>({
        rigId,revision:7,state,name:"Flame",clip:id ? namedClip(id,packed) : null,
      })},"owner",rigId,spriteBundleRequest.parse({revision:7,clips,layout,scale,maxTextureSize:64,filter:"linear",
        ...(packed && {packing:{padding:1,extrusion:1,rotate:true},alpha:"premultiplied",colorSpace:"linear"}),
      }));
      if (!result.bytes) throw new Error("The Godot bundle fixture could not be exported.");
      const {manifest,textures} = await openSpriteBundle(result.bytes);
      if (packed) expect(manifest.clips.some(clip=>clip.frames.some(frame=>frame.rotation===90))).toBe(true);
      const pixelHashes = Object.fromEntries(manifest.clips.flatMap(clip=>clip.frames.map(frame=>[frame.id,
        createHash("sha256").update(restoreSpritePixels(textures.get(frame.file)!,frame,manifest.texture).pixels).digest("hex"),
      ])));
      const zipPath = join(project,layout+".zip");
      const expectedPath = join(project,"expected.json");
      writeFileSync(zipPath,result.bytes);
      const imported = receipt(run("import_sprite_package.gd",zipPath));
      expect(imported).toMatchObject({version:2,scene:`res://${root}/sprite.tscn`,frameCount:8,omittedClipIds:[],clips:[
        {id:east,key:"Flicker",singleKey:"Flicker",name:packed ? "Flicker Sunrise" : "Flicker",direction:"east"},
        {id:west,key:"Flicker_west",direction:"west"}, {id:jump,key:"Jump"}, {id:blink,key:"Blink"},
      ]});
      writeFileSync(expectedPath,JSON.stringify({manifest,pixelHashes,imported}));
      expect(run("check.gd",expectedPath)).toContain("KINETIX_BUNDLE_PLAYBACK " + layout);
      expect(readFileSync(join(project,"character.tscn"),"utf8")).toBe(wrapper);

      if (packed) {
        const texturePath = join(project,root,"textures");
        const textureFiles = readdirSync(texturePath);
        expect(receipt(run("import_sprite_package.gd",zipPath))).toEqual(imported);
        expect(readdirSync(texturePath)).toEqual(textureFiles);
        const paths = [imported.scene,imported.frames,...imported.clips.map((clip:{scene:string})=>clip.scene)]
          .map((path:string)=>join(project,path.replace(/^res:\/\//,"")));
        const before = paths.map(path=>readFileSync(path));
        const lock = join(project,root,".kinetix-import.lock");
        mkdirSync(lock);
        expect(()=>run("import_sprite_package.gd",zipPath)).toThrow(/asset directory is locked/);
        rmdirSync(lock);
        expect(paths.map(path=>readFileSync(path))).toEqual(before);
        function reject(files:Record<string,Uint8Array>, message:RegExp) {
          writeFileSync(zipPath,zipSync(files));
          expect(()=>run("import_sprite_package.gd",zipPath)).toThrow(message);
          expect(paths.map(path=>readFileSync(path))).toEqual(before);
        }
        const damaged = unzipSync(result.bytes);
        damaged[manifest.files[0].file][33] ^= 1;
        reject(damaged,/checksum does not match/);
        const badTiming = unzipSync(result.bytes);
        const invalid = JSON.parse(strFromU8(badTiming["kinetix.json"]));
        invalid.clips[0].frames[1].startTick += 1;
        badTiming["kinetix.json"] = strToU8(JSON.stringify(invalid));
        reject(badTiming,/bounds, timing or metadata/);
        const partial = unzipSync(result.bytes);
        const subset = JSON.parse(strFromU8(partial["kinetix.json"]));
        subset.clips = subset.clips.slice(0,1);
        partial["kinetix.json"] = strToU8(JSON.stringify(subset));
        writeFileSync(zipPath,zipSync(partial));
        expect(receipt(run("import_sprite_package.gd",zipPath)).omittedClipIds.sort()).toEqual([west,jump,blink].sort());
        expect(paths.slice(3).map(path=>readFileSync(path))).toEqual(before.slice(3));
        writeFileSync(zipPath,result.bytes);
        expect(receipt(run("import_sprite_package.gd",zipPath))).toEqual(imported);
      }
    }
  } finally {
    if (dirname(project)===temp) rmSync(project,{recursive:true,force:true});
  }
},90_000);

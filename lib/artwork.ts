import type { Study } from "./studies";

type G = Pick<CanvasRenderingContext2D, "arc" | "beginPath" | "closePath" | "lineTo" | "lineWidth" | "moveTo" | "restore" | "rotate" | "save" | "stroke" | "translate"> & {
  fillStyle: unknown;
  strokeStyle: unknown;
  fill(): void;
};
type Point = [number, number];

// Each facet uses the same local space as its articulated parent.
function face(g: G, color: string, ...coordinates: number[]) {
  g.beginPath();
  g.moveTo(coordinates[0], coordinates[1]);
  for (let i = 2; i < coordinates.length; i += 2) g.lineTo(coordinates[i], coordinates[i + 1]);
  g.closePath();
  g.fillStyle = color;
  g.fill();
}
function pivot(g: G, x: number, y: number, angle: number, draw: () => void) {
  g.save();
  g.translate(x, y);
  g.rotate(angle);
  draw();
  g.restore();
}
function bones(g: G, ...points: Point[]) {
  g.lineWidth = 1.35;
  g.strokeStyle = "#3f4540";
  g.beginPath();
  points.forEach(([x,y], i) => i ? g.lineTo(x,y) : g.moveTo(x,y));
  g.stroke();
  for (const [x,y] of points) {
    g.beginPath(); g.arc(x,y,3.7,0,2*Math.PI);
    g.fillStyle = "#fff9e9"; g.fill(); g.stroke();
  }
}
function leg(g: G, x: number, y: number, angle: number, bend: number, back: boolean, rig: boolean, hind: boolean) {
  const knee: Point = hind ? [-18,39] : [12,41];
  pivot(g,x,y,angle,() => {
    const [kx,ky] = knee;
    face(g,back ? "#954027" : "#e45c24",-17,-7,17,-4,kx+9,ky,kx-7,ky+3);
    face(g,back ? "#853e2a" : "#bf4824",-17,-7,kx+2,ky,kx-7,ky+3);
    pivot(g,kx,ky,bend,() => {
      face(g,back ? "#85402d" : "#c0502b",-7,-3,8,-1,0,28,-10,39,-14,35);
      face(g,back ? "#302e30" : "#3e3837",-7,18,1,20,-6,36,4,36,11,41,-11,44,-16,38);
      if (rig && !back) bones(g,[0,0],[-10,38]);
    });
    if (rig && !back) bones(g,[0,0],knee);
  });
}
function fox(g: G, a: number, rig: boolean) {
  const s = Math.sin(a), c = Math.cos(a);
  g.translate(0,-4*c);
  leg(g,205,152,-.45-.75*c,.4+.45*s,true,false,true);
  leg(g,320,146,.7+.68*c,-.5+.5*s,true,false,false);
  pivot(g,209,144,.09*s,() => {
    face(g,"#d95b28",5,-8,-53,-16,-116,-38,-167,-77,-159,-29,-132,11,-73,32,-29,26,7,8);
    face(g,"#ee7936",-167,-77,-104,-28,-47,-13,-81,9,-135,-1);
    face(g,"#f3e7cd",-167,-77,-124,-46,-104,-28,-124,-31,-113,-16,-138,-25,-132,-7,-149,-17,-159,-29);
    face(g,"#ded0b7",-167,-77,-149,-17,-158,-24,-162,-43);
    face(g,"#b94422",-132,11,-81,9,-29,26,-73,32);
    face(g,"#f98638",-81,9,-47,-13,5,-8,-29,13);
    if (rig) bones(g,[0,0],[-73,8],[-135,-33]);
  });
  face(g,"#eb692c",170,143,197,116,229,105,289,113,333,91,359,105,350,146,315,171,266,163,228,177,187,168);
  face(g,"#fb8c40",170,143,197,116,229,105,217,139);
  face(g,"#f77b31",229,105,289,113,264,140,217,139);
  face(g,"#d75626",170,143,217,139,228,177,187,168);
  face(g,"#c84824",217,139,266,163,228,177);
  face(g,"#f1863c",264,140,289,113,333,91,325,130);
  face(g,"#d05224",264,140,325,130,315,171,266,163);
  leg(g,201,149,.76+.75*c,-.52+.5*s,false,rig,true);
  leg(g,326,144,-.67-.66*c,.29+.42*s,false,rig,false);
  pivot(g,326,117,.035*s,() => {
    face(g,"#ee762e",-21,-1,11,-28,46,-51,78,-53,82,-24,111,-6,106,3,76,15,43,11,15,46,9,27,-13,36,-9,14,-27,19);
    face(g,"#e55b23",17,-22,39,-78,61,-44,43,-13);
    face(g,"#573c32",29,-36,39,-68,50,-44);
    face(g,"#fb8938",47,-43,73,-84,81,-42,70,-22);
    face(g,"#333136",59,-47,71,-73,73,-46);
    face(g,"#ff9341",11,-28,46,-51,81,-42,72,-16,31,-6);
    face(g,"#e96729",81,-42,82,-24,111,-6,76,-7,72,-16);
    face(g,"#f7e8ce",111,-6,106,3,76,15,43,11,15,46,9,27,-13,36,8,3,38,-9,63,-1);
    face(g,"#e1ceb0",8,3,38,-9,16,14,-13,36);
    face(g,"#fff1d9",38,-9,63,-1,76,15,43,11,15,46,31,12);
    face(g,"#312f30",101,-11,115,-8,110,0,105,2);
    face(g,"#3b302a",65,-22,78,-24,74,-16,69,-17);
    face(g,"#faf3e5",72,-21,75,-21,73,-19);
    if (rig) bones(g,[0,0],[40,-22]);
  });
  if (rig) bones(g,[201,149],[266,137],[326,117]);
}
function heron(g: G, a: number, rig: boolean) {
  g.translate(0,6*Math.sin(a));
  face(g,"#394c72",247,149,164,164,60,163,54,166,157,174,252,162);
  pivot(g,256,131,.30*Math.sin(a),() => {
    face(g,"#516f9d",0,0,-19,-45,-91,-106,-115,-118,-82,-64,-52,-13);
    face(g,"#7994be",-115,-118,-66,-83,-19,-45,-52,-13);
  });
  face(g,"#849dc5",136,149,206,126,269,110,318,124,349,114,365,85,385,72,403,82,399,94,377,100,365,140,326,157,259,159,204,180);
  face(g,"#47648f",136,149,215,150,259,159,204,180);
  face(g,"#e7e5d9",318,124,349,114,365,85,385,72,399,80,372,97,359,132,326,157);
  face(g,"#d18a45",396,81,457,98,399,94);
  face(g,"#303a4a",378,77,397,78,403,83,384,82,348,97);
  face(g,"#f7efdc",388,79,393,80,390,83);
  pivot(g,253,140,.44*Math.sin(a),() => {
    face(g,"#6b89b7",14,-5,-25,-43,-75,-69,-165,-92,-131,-54,-143,-58,-107,-22,-116,-26,-80,2,-35,21);
    face(g,"#adc3dc",14,-5,-25,-43,-75,-69,-120,-78,-64,-29);
    face(g,"#91abd0",-75,-69,-165,-92,-114,-59,-64,-29);
    face(g,"#466693",-131,-54,-64,-29,-107,-22,-143,-58);
    face(g,"#5978a8",-107,-22,-64,-29,-35,21,-80,2);
    if (rig) bones(g,[0,0],[-58,-36],[-133,-74]);
  });
  if(rig) bones(g,[181,153],[253,140],[329,139],[379,84]);
}
function fish(g: G, a: number, rig: boolean) {
  const s = Math.sin(a);
  pivot(g,181,145,.28*s,() => {
    face(g,"#408679",13,2,-41,-30,-92,-45,-74,-9,-44,3,-71,28,-81,57,-33,39);
    face(g,"#77b5a0",-92,-45,-41,-30,13,2,-57,-10);
    face(g,"#255f5a",-44,3,13,2,-81,57);
    if(rig) bones(g,[0,0],[-54,4]);
  });
  face(g,"#4a9d88",174,145,217,110,253,97,311,99,359,113,400,142,409,151,384,168,321,184,263,185,213,168);
  face(g,"#307a70",231,110,252,76,297,63,286,99,265,118);
  face(g,"#92c6ac",174,145,217,110,253,97,278,121,224,150);
  face(g,"#e6d9b5",253,97,277,96,306,117,284,144,251,136,278,121);
  face(g,"#6ead96",277,96,311,99,359,113,323,145,306,117);
  face(g,"#256d64",174,145,224,150,263,185,213,168);
  face(g,"#3d8677",224,150,251,136,284,144,263,185);
  face(g,"#eedfc0",284,144,299,157,288,185,263,185);
  face(g,"#8db49c",323,145,359,113,400,142,409,151,370,156);
  face(g,"#387b6e",323,145,370,156,384,168,321,184);
  pivot(g,321,149,.18*s,() => {
    face(g,"#569787",0,0,-23,26,-46,56,-16,40,7,13);
    face(g,"#316e63",0,0,-46,56,-23,26);
  });
  face(g,"#233c39",371,137,379,133,386,140,378,146);
  face(g,"#fcf1cf",377,137,381,137,379,140);
  if(rig) bones(g,[181,145],[244,143],[317,141],[365,145]);
}
export function drawStudy(g: G, id: Study["id"], phase: number, rig: boolean) {
  g.save();
  const angle = phase * Math.PI * 2;
  ({fox,heron,fish})[id](g,angle,rig);
  g.restore();
}

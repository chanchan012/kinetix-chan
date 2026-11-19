import { expect, it } from "vitest";
import { evaluateRig } from "../../lib/rig/kinematics";
import { createRigState, rigStateSchema, type VectorPart } from "../../lib/rig/model";
import { bindMesh, deformMesh, paintMesh } from "../../lib/rig/skinning";

it("binds a closed path, paints normalized weights and blends two bone transforms", () => {
  const rig = createRigState("fox");
  const poses = evaluateRig(rig);
  const part: VectorPart = {
    id: "test", name: "Triangle", parentId: null, offset: {x:0,y:0}, fill:"#ffaa33", closed:true,
    knots: [{point:{x:10,y:10}},{point:{x:40,y:10}},{point:{x:10,y:40}}],
  };
  part.mesh = bindMesh(part,poses,"root");
  expect(part.mesh.triangles).toHaveLength(4);
  expect(deformMesh(part,poses)[0].x).toBeCloseTo(10);
  part.mesh = paintMesh(part,poses,"upper",{x:10,y:10},12,0.5);
  expect(part.mesh.vertices[0].weights).toEqual([{boneId:"root",weight:0.5},{boneId:"upper",weight:0.5}]);
  expect(part.mesh.vertices[1].weights).toEqual([{boneId:"root",weight:1}]);
  rig.parts.push(part);
  expect(rigStateSchema.safeParse(rig).success).toBe(true);
  rig.bones[1].offset.x += 20;
  const deformed = deformMesh(part,evaluateRig(rig));
  expect(deformed[0].x).toBeCloseTo(20);
  expect(deformed[1].x).toBeCloseTo(40);
});

import { expect, test } from "@playwright/test";

import { clerk } from "@clerk/testing/playwright";
import type { KinetixRigState } from "../../lib/rig/model";
import { forwardKinematics } from "../../lib/rig/kinematics";

test.beforeEach(async ({page}) => {
  await page.goto("/");
  await clerk.signIn({page, emailAddress:process.env.KINETIX_TEST_EMAIL!});
});

test("a member can open, manipulate, and save a studio rig", async ({page}, info) => {
  const name = "Playwright " + info.project.name + " rig";
  const created = await page.request.post("/api/rigs", {
    data: { name, study: "fox" },
  });
  expect(created.status()).toBe(201);
  const { id } = await created.json();
  const path = "/api/rigs/" + id;
  try {
    const fetched = await page.request.get(path + "/state");
    expect(fetched.status()).toBe(200);
    const { revision, state }: { revision: number; state: KinetixRigState } = await fetched.json();
    expect(state.version).toBe(1);
    state.bones[1].rotation = Math.PI / 4;
    const saved = await page.request.patch(path + "/state", { data: { revision, state } });
    expect(saved.status()).toBe(200);
    expect(await saved.json()).toMatchObject({ state, revision: revision + 1 });
    expect((await page.request.patch(path + "/state", { data: { revision, state } })).status()).toBe(409);

    await page.goto("/dashboard");
    await page.getByRole("button",{name:new RegExp(name)}).click();
    await page.getByRole("link",{name:"Open studio"}).click();
    await expect(page.getByRole("heading",{name,exact:true})).toBeVisible();
    await page.getByRole("button",{name:"Foreleg",exact:true}).click();
    const rotation = page.getByLabel("Rotation (°)");
    await expect(rotation).toHaveValue("45");
    const canvas = page.getByRole("img",{name:"Rig canvas"});
    await expect(canvas).toBeInViewport({ratio:1});
    const box = (await canvas.boundingBox())!;
    expect(box.height).toBeGreaterThan(95);
    const scale = Math.min(box.width / 510, box.height / 280);
    const project = (point: {x:number;y:number}) => ({
      x:box.x + box.width / 2 + (point.x - 245) * scale,
      y:box.y + box.height / 2 + (point.y - 143) * scale,
    });
    const pose = forwardKinematics(state.bones).get("upper")!;
    const around = (angle:number) => project({
      x:pose.origin.x + 30 * Math.cos(angle), y:pose.origin.y + 30 * Math.sin(angle),
    });
    const from = around(pose.angle);
    const to = around(pose.angle + 0.68);
    await page.mouse.move(from.x,from.y);
    await page.mouse.down();
    await page.mouse.move(to.x,to.y,{steps:6});
    await page.mouse.up();
    await expect(rotation).not.toHaveValue("45");
    await page.getByRole("button",{name:"Undo",exact:true}).click();
    await expect(rotation).toHaveValue("45");
    await page.getByRole("button",{name:"Redo",exact:true}).click();
    await expect(rotation).not.toHaveValue("45");

    const angle = Number(await rotation.inputValue()) * Math.PI / 180;
    const tip = project({
      x:pose.origin.x + state.bones[1].length * Math.cos(angle),
      y:pose.origin.y + state.bones[1].length * Math.sin(angle),
    });
    await page.getByRole("button",{name:"Draw bone",exact:true}).click();
    await page.mouse.move(tip.x,tip.y);
    await page.mouse.down();
    await page.mouse.move(tip.x + 26 * scale,tip.y + 24 * scale,{steps:5});
    await page.mouse.up();
    await expect(page.getByRole("button",{name:"Bone 4"})).toHaveAttribute("aria-pressed","true");
    await page.getByRole("button",{name:"Foreleg",exact:true}).click();

    await page.getByRole("button",{name:"Pen",exact:true}).click();
    await page.mouse.move(box.x + box.width * .33, box.y + box.height * .22);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * .40, box.y + box.height * .22,{steps:4});
    await page.mouse.up();
    await page.mouse.click(box.x + box.width * .42, box.y + box.height * .30);
    await page.getByRole("button",{name:"Finish path"}).click();
    await expect(page.getByRole("button",{name:"Path 1"})).toHaveAttribute("aria-pressed","true");
    await page.getByRole("button",{name:"Save",exact:true}).click();
    await expect(page.getByRole("button",{name:"Save",exact:true})).toBeDisabled();
    await expect(page.getByText("Saved",{exact:true})).toBeVisible();
    const reopened = await page.request.get(path + "/state");
    const edited: KinetixRigState = (await reopened.json()).state;
    expect(edited.parts[0].knots[0].outgoing).toBeDefined();
    expect(edited.bones[1].rotation).not.toBe(state.bones[1].rotation);
    expect(edited.bones[3]).toMatchObject({parentId:"upper",offset:{x:state.bones[1].length,y:0}});
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth &&
      document.documentElement.scrollHeight <= innerHeight &&
      Math.abs(document.querySelector(".studio-shell")!.getBoundingClientRect().height - innerHeight) < 1)).toBe(true);
    await page.screenshot({path:info.outputPath("studio.png")});
  } finally {
    expect((await page.request.delete(path)).status()).toBe(204);
  }
});

test("member library fits the viewport and opens the chosen study",async({page},info)=>{
  await page.getByRole("link",{name:"Rig library"}).click();
  await expect(page.getByRole("heading",{name:"Rig library"})).toBeVisible();
  const cards=page.locator("a.rig-card");
  await expect(cards).toHaveCount(3);
  await expect(page.getByRole("button",{name:"New rig"})).toBeVisible();
  const columns=await cards.evaluateAll(elements=>new Set(elements.map(el=>el.getBoundingClientRect().left)).size);
  expect(columns).toBe(({desktop:3,tablet:2,mobile:1,landscape:2})[info.project.name as "desktop"|"tablet"|"mobile"|"landscape"]);
  expect(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight && document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath("dashboard.png")});
  await page.getByRole("link",{name:/Blue heron/}).click();
  await expect(page.getByRole("img",{name:/Blue heron/})).toBeVisible();
  await page.getByRole("button",{name:"Play clip"}).click();
  await expect(page.getByRole("slider")).not.toHaveValue("1");
  await page.getByRole("button",{name:"Pause clip"}).click();
  await page.getByRole("slider").fill("18");
  await expect(page.getByRole("img",{name:/frame 18$/})).toBeVisible();
  const bones = page.getByRole("button",{name:"Bones",exact:true});
  await bones.click();
  await expect(bones).toHaveAttribute("aria-pressed","false");
  await page.getByRole("button",{name:"Quick guide"}).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth && document.documentElement.scrollHeight<=innerHeight)).toBe(true);
  const session = await page.request.get("/api/session");
  expect((await session.json()).mode).toBe("member");
});

test("member manages a rig and clip from the grid",async({page})=>{
  const rig={id:"d1ee7943-212b-45e4-ac00-43dc6d230eed",name:"Library fox",state:{study:"fox"}};
  let rows:object[]=[];
  let clips:object[]=[];
  await page.route("**/api/rigs**",async r=>{
    const method=r.request().method();
    if(r.request().url().includes("/clips")){
      if(method==="POST")clips=[{...r.request().postDataJSON(),id:"clip",thumbnail:null}];
      return r.fulfill({json:method==="GET"?clips:clips[0]});
    }
    if(method==="POST"){rows=[rig];return r.fulfill({status:201,json:rig});}
    if(method==="DELETE"){rows=[];return r.fulfill({status:204});}
    return r.fulfill({json:rows});
  });
  await page.goto("/dashboard");
  await page.getByRole("button",{name:"New rig"}).click();
  await page.getByLabel("Rig name").fill(rig.name);
  await page.getByRole("button",{name:"Create rig"}).click();
  const detail=page.getByRole("dialog",{name:rig.name});
  await detail.getByLabel("Clip name").fill("Walk");
  await detail.getByRole("button",{name:"Add clip"}).click();
  await expect(detail.getByText("Walk",{exact:true})).toBeVisible();
  page.once("dialog",d=>d.accept());
  await detail.getByRole("button",{name:"Delete rig"}).click();
  await expect(page.getByText("Create a rig to start your collection.")).toBeVisible();
});

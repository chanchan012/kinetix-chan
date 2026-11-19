import { expect, test } from "@playwright/test";

test("guest library fits the viewport and opens the chosen study",async({page},info)=>{
  await page.goto("/");
  await page.getByRole("link",{name:"Rig library"}).click();
  await expect(page.getByRole("heading",{name:"Rig library"})).toBeVisible();
  const cards=page.locator(".rig-card");
  await expect(cards).toHaveCount(3);
  await expect(page.getByRole("button",{name:"New rig"})).toHaveCount(0);
  const columns=await cards.evaluateAll(elements=>new Set(elements.map(el=>el.getBoundingClientRect().left)).size);
  expect(columns).toBe(({desktop:3,tablet:2,mobile:1,landscape:2})[info.project.name as "desktop"|"tablet"|"mobile"|"landscape"]);
  expect(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight && document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath("dashboard.png")});
  await page.getByRole("link",{name:/Blue heron/}).click();
  await expect(page.getByRole("img",{name:/Blue heron/})).toBeVisible();
});

test("member manages a rig and clip from the grid",async({page})=>{
  const rig={id:"d1ee7943-212b-45e4-ac00-43dc6d230eed",name:"Library fox",state:{study:"fox"}};
  let rows:object[]=[];
  let clips:object[]=[];
  await page.route("**/api/session",r=>r.fulfill({json:{mode:"member",userId:"test",canSave:true}}));
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

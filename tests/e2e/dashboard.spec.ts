import { expect, test } from "@playwright/test";

import { clerk } from "@clerk/testing/playwright";

test.beforeEach(async ({page}) => {
  await page.goto("/");
  await clerk.signIn({page, emailAddress:process.env.KINETIX_TEST_EMAIL!});
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

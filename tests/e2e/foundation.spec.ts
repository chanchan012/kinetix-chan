import { test, expect } from "@playwright/test";

for (const path of ["/","/sign-in","/sign-up"]) {
  test(path + " fits the viewport with its primary actions in view", async ({page}, testInfo) => {
    await page.goto(path);
    await expect(page.getByRole("heading",{level:1})).toBeVisible();
    await expect(page.locator(".primary")).toBeInViewport({ratio:1});
    const fits = await page.evaluate(() => {
      const doc = document.documentElement;
      const shell = document.querySelector(".app-shell")!.getBoundingClientRect();
      return { x:doc.scrollWidth<=innerWidth, y:doc.scrollHeight<=innerHeight, dvh:Math.abs(shell.height-innerHeight)<1 };
    });
    expect(fits).toEqual({x:true,y:true,dvh:true});
    if (path==="/") {
      await expect(page.getByRole("button",{name:/Jade koi/})).toBeInViewport({ratio:1});
      expect((await page.locator(".stage").boundingBox())!.height).toBeGreaterThan(50);
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: testInfo.outputPath("playground.png") });
    }
  });
}
test("studies, playback, scrubbing, bones, guide and guest entry",async({page}) => {
  await page.goto("/");
  await page.getByRole("button",{name:/Blue heron/}).click();
  await expect(page.getByRole("img",{name:/Blue heron/})).toBeVisible();
  await page.getByRole("button",{name:"Play clip"}).click();
  await expect(page.getByRole("slider")).not.toHaveValue("1");
  await page.getByRole("button",{name:"Pause clip"}).click();
  await page.getByRole("slider").fill("18");
  await expect(page.getByRole("img",{name:/frame 18$/})).toBeVisible();
  const bones = page.getByRole("button",{name:"Bones",exact:true});
  await bones.click(); await expect(bones).toHaveAttribute("aria-pressed","false");
  await page.getByRole("button",{name:"Quick guide"}).click();
  await expect(page.getByRole("dialog")).toBeVisible(); await page.keyboard.press("Escape");
  await page.getByRole("link",{name:"Sign in"}).click();
  await page.getByRole("link",{name:"Continue as guest"}).click();
  await expect(page.getByRole("button",{name:"Close playground"})).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button",{name:"Launch playground"})).toBeVisible();
});
test("Next routes API calls to Hono",async({request}) => {
  expect(await (await request.get("/api/session")).json()).toEqual({mode:"guest",canSave:false});
  expect((await request.get("/api/account")).status()).toBe(401);
});

import { test, expect } from "@playwright/test";
import { setupClerkTestingToken } from "@clerk/testing/playwright";

for (const path of ["/", "/sign-in", "/sign-up"]) {
  test(path + " fits the viewport", async ({page}) => {
    await setupClerkTestingToken({page});
    await page.goto(path);
    if (path === "/") {
      await expect(page.getByRole("link",{name:"Open workspace"})).toBeInViewport();
      await expect(page.getByRole("link",{name:/Jade koi/})).toBeInViewport();
    } else {
      const input = page.locator("main input:visible").first();
      await expect(input).toBeVisible({timeout:30000});
      const box = await input.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
      expect(await page.locator(".access-main").evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
    }
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth
      && document.documentElement.scrollHeight<=innerHeight
      && Math.abs(document.querySelector(".app-shell")!.getBoundingClientRect().height-innerHeight)<1)).toBe(true);
  });
}

test("signed-out deep links return to sign-in and legacy demo links stay public",async({page})=>{
  await page.goto("/?demo=1&study=heron");
  await expect(page.getByRole("slider")).toHaveCount(0);
  for (const path of ["/dashboard","/studio/studies/heron","/studio/rig.v1"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/sign-in\?/);
    expect(new URL(page.url()).searchParams.get("redirect_url")).toBe(path);
    await expect(page.getByRole("button",{name:"New rig"})).toHaveCount(0);
  }
});

test("private APIs reject signed-out requests", async ({request})=>{
  for (const path of ["/api/session","/api/account","/api/rigs"]) {
    expect((await request.get(path)).status()).toBe(401);
  }
});

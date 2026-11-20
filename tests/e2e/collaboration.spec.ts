import { createClerkClient } from "@clerk/backend";
import { clerk } from "@clerk/testing/playwright";
import { expect, test } from "@playwright/test";

test("an owner shares a rig and sees another account's selection and autosave", async ({page,browser},info) => {
  test.skip(info.project.name !== "desktop","Runs with two Clerk contexts on desktop.");
  const clerkApi = createClerkClient({secretKey:process.env.CLERK_SECRET_KEY});
  const email = "kinetix-editor-" + crypto.randomUUID() + "+clerk_test@example.com";
  const user = await clerkApi.users.createUser({emailAddress:[email],skipPasswordRequirement:true});
  await page.goto("/");
  const origin = new URL(page.url()).origin;
  await clerk.signIn({page,emailAddress:process.env.KINETIX_TEST_EMAIL!});
  const editorContext = await browser.newContext({baseURL:origin,viewport:{width:1440,height:900}});
  const editor = await editorContext.newPage();
  let path: string | undefined;
  try {
    const created = await page.request.post("/api/rigs",{data:{name:"Collaboration fixture",study:"fox"}});
    expect(created.status()).toBe(201);
    const {id} = await created.json();
    path = "/api/rigs/"+id;
    await editor.goto("/");
    await clerk.signIn({page:editor,emailAddress:email});
    expect((await editor.request.get(path+"/state")).status()).toBe(404);
    await page.goto("/studio/"+id);
    await page.getByRole("button",{name:"Share",exact:true}).click();
    const share = page.getByRole("dialog",{name:"Share rig"});
    await share.getByLabel("Editor email").fill(email);
    await share.getByRole("button",{name:"Grant editor access"}).click();
    await expect(share.getByText(email,{exact:true})).toBeVisible();
    await share.getByRole("button",{name:"Close",exact:true}).click();
    await editor.goto("/studio/"+id);
    await expect(editor.getByRole("heading",{name:"Collaboration fixture",exact:true})).toBeVisible();
    await expect(editor.getByRole("button",{name:"Share",exact:true})).toHaveCount(0);
    const collaborators = page.getByRole("group",{name:"Collaborators"});
    await expect(collaborators.getByRole("status",{name:"Collaboration connected"})).toBeVisible();
    await editor.getByRole("button",{name:"Foreleg",exact:true}).click();
    await expect(collaborators.getByRole("img",{name:"Editor · Foreleg"})).toBeVisible({timeout:9000});
    await page.getByRole("button",{name:"Foreleg",exact:true}).click();
    const value = editor.getByLabel("Rotation (°)");
    await value.fill("67");
    await value.press("Enter");
    await expect(editor.getByText("Saved",{exact:true})).toBeVisible({timeout:8000});
    await expect(page.getByLabel("Rotation (°)")).toHaveValue("67",{timeout:9000});
    const state = await (await page.request.get(path+"/state")).json();
    expect(state.state.bones[1].rotation).toBeCloseTo(67 * Math.PI / 180);
    const snapshot = await editor.evaluate(async events => {
      const response = await fetch(events);
      const reader = response.body!.getReader();
      try {
        const decoder = new TextDecoder();
        let buffer = "";
        while (!buffer.includes("\n\n")) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value,{stream:true});
        }
        const data = buffer.split("\n").find(line=>line.startsWith("data:"));
        return data ? JSON.parse(data.slice(5)) : null;
      } finally { await reader.cancel(); }
    }, path+"/events");
    expect(snapshot?.revision).toBe(state.revision);
    await page.getByRole("button",{name:"Share",exact:true}).click();
    page.once("dialog",dialog=>dialog.accept());
    await share.getByRole("button",{name:"Remove",exact:true}).click();
    await expect(share.getByText(email,{exact:true})).toHaveCount(0);
    expect((await editor.request.get(path+"/state")).status()).toBe(404);
  } finally {
    if (path) await page.request.delete(path);
    await editorContext.close();
    await clerkApi.users.deleteUser(user.id);
  }
});

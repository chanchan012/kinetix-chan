import { randomUUID } from "node:crypto";
import { createClerkClient } from "@clerk/backend";
import { clerkSetup } from "@clerk/testing/playwright";
import { eq } from "drizzle-orm";
import { connectDatabase } from "../../db/client";
import { rigs } from "../../db/schema";

export default async function setup() {
  const secretKey = process.env.CLERK_SECRET_KEY;
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  if (!secretKey?.startsWith("sk_test_") || !publishableKey?.startsWith("pk_test_")) {
    throw new Error("Playwright requires Kinetix development-instance Clerk credentials.");
  }
  await clerkSetup({secretKey, publishableKey, dotenv:false});
  const client = createClerkClient({secretKey, publishableKey});
  const email = `kinetix-${randomUUID()}+clerk_test@example.com`;
  const user = await client.users.createUser({emailAddress:[email], skipPasswordRequirement:true});
  process.env.KINETIX_TEST_EMAIL = email;
  return async () => {
    try {
      await connectDatabase().delete(rigs).where(eq(rigs.ownerId,user.id));
    } finally {
      await client.users.deleteUser(user.id);
    }
  };
}

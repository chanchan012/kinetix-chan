export function clerkEnabled() {
  if (process.env.KINETIX_DEMO_ONLY === "1") return false;
  const publicKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (Boolean(publicKey) !== Boolean(secretKey)) {
    throw new Error("Configure both Clerk keys to enable account access.");
  }
  return Boolean(publicKey && secretKey);
}

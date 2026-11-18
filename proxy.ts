import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { clerkEnabled } from "./lib/config";

const withClerk = clerkMiddleware();
export default function proxy(request: NextRequest, event: NextFetchEvent) {
  return clerkEnabled() ? withClerk(request, event) : NextResponse.next();
}
export const config = { matcher: ["/((?!api/|_next/|.*\\.[^/]+$).*)"] };

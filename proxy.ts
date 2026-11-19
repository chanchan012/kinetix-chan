import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

export default clerkMiddleware(async (auth, request) => {
  const section = request.nextUrl.pathname.split("/")[1];
  if ((section === "dashboard" || section === "studio") && !(await auth()).userId) {
    const signIn = new URL("/sign-in", request.url);
    signIn.searchParams.set("redirect_url", request.nextUrl.pathname + request.nextUrl.search);
    const response = NextResponse.redirect(signIn);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}, { signInUrl: "/sign-in", signUpUrl: "/sign-up" });

export const config = { matcher: ["/", "/sign-in/:path*", "/sign-up/:path*", "/dashboard/:path*", "/studio/:path*"] };

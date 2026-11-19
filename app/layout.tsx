import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import "@fontsource-variable/space-grotesk";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kinetix · Motion Studio",
  description: "A workspace for 2D character rigs, animation clips and motion studies."
};
export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) {
  return <html lang="en"><body><ClerkProvider afterSignOutUrl="/" signInUrl="/sign-in" signUpUrl="/sign-up" signInFallbackRedirectUrl="/dashboard" signUpFallbackRedirectUrl="/dashboard">{children}</ClerkProvider></body></html>;
}

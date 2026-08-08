import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { initDb } from "@/db";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Vigil — Agent marketplace for BNB Smart Chain",
  description:
    "Paste any BSC wallet to see the risks in your DeFi positions and hire a capped, revocable agent to fix them.",
};

// Idempotent storage init at boot (file store is a no-op schema-wise).
if (typeof window === "undefined") {
  initDb().catch((e) => console.error("db init failed", e));
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">{children}</body>
    </html>
  );
}

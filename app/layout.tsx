import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Forge · Autonomous research lab",
  description:
    "Give a model a benchmark and a budget. Follow real post-training experiments, independent governance, and reproducible evidence.",
  applicationName: "Forge",
  icons: { icon: "/icon.svg" },
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <head>
        <link
          rel="preload"
          href="/fonts/ibm-plex-sans-latin.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="/fonts/ibm-plex-mono-latin.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}

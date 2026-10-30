import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";

// Geist (SIL OFL) stands in for the licensed grotesk measured in docs/site/modal-reference.md.
const geist = Geist({
  subsets: ["latin"],
  variable: "--site-font",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Forge · Post-training that runs itself",
  description:
    "Bring your agent's production traffic. Forge trains on its failures on an H100, proves the fix on questions it never saw, and hands you the weights.",
};

export const viewport: Viewport = { themeColor: "#ffffff" };

export default function SiteLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <div className={geist.variable}>{children}</div>;
}

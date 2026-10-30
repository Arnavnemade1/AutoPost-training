import type { Metadata, Viewport } from "next";
import { DM_Mono, Geist } from "next/font/google";

// Geist (SIL OFL) stands in for the licensed grotesk measured in docs/site/modal-reference.md.
const geist = Geist({
  subsets: ["latin"],
  variable: "--site-font",
  display: "swap",
});

// DM Mono (SIL OFL) is the code face the reference ships.
const mono = DM_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--site-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Forge · Post-training that runs itself",
  description:
    "Bring your agent's production traffic. Forge turns its failures into a private model fine-tuned for your tasks, and you own the weights.",
};

export const viewport: Viewport = { themeColor: "#ffffff" };

export default function SiteLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <div className={`${geist.variable} ${mono.variable}`}>{children}</div>;
}

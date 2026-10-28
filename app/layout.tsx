import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Forge · Autonomous research lab',
  description: 'Give a model a benchmark and a budget. Follow real post-training experiments, independent governance, and reproducible evidence.',
  applicationName: 'Forge',
  icons: { icon: '/icon.svg' },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" suppressHydrationWarning><body>{children}</body></html>;
}

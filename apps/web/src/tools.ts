import { access, constants } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

/** Local executables the dashboard's renderer and recorder need. Never downloaded. */
async function executable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
async function onPath(name: string): Promise<string | null> {
  for (const directory of (process.env.PATH ?? "").split(delimiter))
    if (directory && (await executable(join(directory, name)))) return join(directory, name);
  return null;
}
const playwright = join(homedir(), "Library/Caches/ms-playwright");
const linuxPlaywright = join(homedir(), ".cache/ms-playwright");

async function first(candidates: (string | null)[]): Promise<string | null> {
  for (const candidate of candidates)
    if (candidate && (await executable(candidate))) return candidate;
  return null;
}

/**
 * Headless Chromium: `FORGE_CHROME`, then a Playwright headless shell, then an installed
 * Chrome or Chromium. Rendering happens in a throwaway profile.
 */
export async function findChrome(): Promise<string> {
  const found = await first([
    process.env.FORGE_CHROME ?? null,
    join(
      playwright,
      "chromium_headless_shell-1217/chrome-headless-shell-mac-arm64/chrome-headless-shell",
    ),
    join(
      linuxPlaywright,
      "chromium_headless_shell-1217/chrome-headless-shell-linux64/chrome-headless-shell",
    ),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    await onPath("google-chrome"),
    await onPath("chromium"),
    await onPath("chromium-browser"),
  ]);
  if (!found)
    throw new Error("CHROME_NOT_FOUND: set FORGE_CHROME to a Chrome or Chromium executable");
  return found;
}

/**
 * FFmpeg with an MJPEG pipe input and a VP8 WebM encoder: `FORGE_FFMPEG`, then `ffmpeg`
 * on PATH, then Playwright's bundled build. An explicit `FORGE_FFMPEG` is never replaced.
 */
export async function findFfmpeg(): Promise<string> {
  if (process.env.FORGE_FFMPEG) {
    if (await executable(process.env.FORGE_FFMPEG)) return process.env.FORGE_FFMPEG;
    throw new Error(
      `FFMPEG_NOT_FOUND: FORGE_FFMPEG is not executable: ${process.env.FORGE_FFMPEG}`,
    );
  }
  const found = await first([
    await onPath("ffmpeg"),
    join(playwright, "ffmpeg-1011/ffmpeg-mac"),
    join(linuxPlaywright, "ffmpeg-1011/ffmpeg-linux"),
  ]);
  if (!found) throw new Error("FFMPEG_NOT_FOUND: install FFmpeg or set FORGE_FFMPEG");
  return found;
}

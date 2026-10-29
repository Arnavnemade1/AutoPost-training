import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findChrome } from "./tools.js";

export interface Viewport {
  width: number;
  height: number;
  mobile?: boolean;
  deviceScaleFactor?: number;
}

/**
 * Minimal Chrome DevTools Protocol client: one headless browser, one page, in a throwaway
 * profile. Enough to render the dashboard, read its DOM and capture frames.
 */
export class Browser {
  private next = 1;
  private readonly pending = new Map<number, { ok: (v: any) => void; fail: (e: Error) => void }>();
  private constructor(
    private readonly process: ChildProcess,
    private readonly socket: WebSocket,
    private readonly profile: string,
  ) {
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      const waiter = message.id ? this.pending.get(message.id) : undefined;
      if (!waiter) return;
      this.pending.delete(message.id);
      if (message.error) waiter.fail(new Error(`CDP ${message.error.message}`));
      else waiter.ok(message.result);
    });
  }

  static async launch(timeoutMs = 30000): Promise<Browser> {
    const chrome = await findChrome();
    const profile = await mkdtemp(join(tmpdir(), "forge-browser-"));
    const args = [
      "--headless",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--hide-scrollbars",
      "--mute-audio",
      "--force-color-profile=srgb",
      ...(process.env.FORGE_CHROME_NO_SANDBOX === "1" ? ["--no-sandbox"] : []),
      "about:blank",
    ];
    const child = spawn(chrome, args, { stdio: ["ignore", "ignore", "pipe"] });
    const endpoint = await new Promise<string>((resolve, reject) => {
      let output = "";
      const timer = setTimeout(() => reject(new Error("CHROME_START_TIMEOUT")), timeoutMs);
      child.stderr!.on("data", (chunk) => {
        output += chunk;
        const match = /DevTools listening on (ws:\/\/\S+)/.exec(output);
        if (match) {
          clearTimeout(timer);
          resolve(match[1]);
        }
      });
      child.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`CHROME_EXITED: ${code}: ${output.slice(-500)}`));
      });
    });
    const port = new URL(endpoint).port;
    const target = (await (
      await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })
    ).json()) as { webSocketDebuggerUrl: string };
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", () => reject(new Error("CDP_CONNECT_FAILED")), {
        once: true,
      });
    });
    const browser = new Browser(child, socket, profile);
    await browser.send("Page.enable");
    await browser.send("Runtime.enable");
    return browser;
  }

  send<T = any>(method: string, params: object = {}): Promise<T> {
    const id = this.next++;
    return new Promise<T>((ok, fail) => {
      this.pending.set(id, { ok, fail });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async viewport(viewport: Viewport): Promise<void> {
    await this.send("Emulation.setDeviceMetricsOverride", {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: viewport.deviceScaleFactor ?? 1,
      mobile: viewport.mobile ?? false,
    });
  }
  /** Navigates and waits for the load event and a settled frame. */
  async open(url: string): Promise<void> {
    await this.send("Page.navigate", { url });
    for (let i = 0; i < 100; i++) {
      if ((await this.evaluate<string>("document.readyState")) === "complete") break;
      await Bun.sleep(50);
    }
    await this.evaluate(
      "new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))",
    );
  }
  async evaluate<T = unknown>(expression: string): Promise<T> {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails)
      throw new Error(
        `PAGE_ERROR: ${result.exceptionDetails.exception?.description ?? "evaluation failed"}`,
      );
    return result.result.value as T;
  }
  async screenshot(format: "jpeg" | "png" = "jpeg", quality = 80): Promise<Buffer> {
    const result = await this.send<{ data: string }>("Page.captureScreenshot", {
      format,
      ...(format === "jpeg" ? { quality } : {}),
    });
    return Buffer.from(result.data, "base64");
  }
  async close(): Promise<void> {
    try {
      this.socket.close();
    } catch {}
    this.process.kill("SIGTERM");
    await new Promise((resolve) => {
      if (this.process.exitCode !== null) return resolve(undefined);
      const timer = setTimeout(() => {
        this.process.kill("SIGKILL");
        resolve(undefined);
      }, 3000);
      this.process.once("exit", () => {
        clearTimeout(timer);
        resolve(undefined);
      });
    });
    await rm(this.profile, { recursive: true, force: true });
  }
}

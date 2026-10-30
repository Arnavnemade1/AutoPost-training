import { lstat, realpath } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { loadCampaign } from "./campaign.js";
import { renderFragment, renderPage, type View } from "./render.js";

const types: Record<string, string> = {
  json: "application/json",
  jsonl: "application/x-ndjson",
  webm: "video/webm",
  safetensors: "application/octet-stream",
  jpg: "image/jpeg",
  gz: "application/gzip",
};

export interface Dashboard {
  url: string;
  stop(): Promise<void>;
}

/**
 * Loopback-only dashboard for one campaign directory. Pages are rendered per request from
 * the stored files; `/files/` serves only the evidence files the dashboard itself lists,
 * so actor storage, Relay databases and datasets are never reachable through it.
 */
export function serveDashboard(directory: string, port = 0): Dashboard {
  const root = resolve(directory);
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    async fetch(request) {
      const url = new URL(request.url);
      if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
      if (url.pathname === "/") {
        const view: View = url.searchParams.get("view") === "live" ? "live" : "full";
        const inspect = url.searchParams.get("inspect");
        const campaign = await loadCampaign(root);
        const body = url.searchParams.has("fragment")
          ? renderFragment(campaign, view, inspect)
          : renderPage(campaign, view, inspect);
        return new Response(body, {
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
        });
      }
      if (url.pathname === "/api/campaign")
        return Response.json(await loadCampaign(root), {
          headers: { "cache-control": "no-store" },
        });
      if (url.pathname.startsWith("/files/")) {
        const path = url.pathname
          .slice("/files/".length)
          .split("/")
          .map(decodeURIComponent)
          .join("/");
        if (!(await loadCampaign(root)).downloads.some((d) => d.path === path))
          return new Response("Not found", { status: 404 });
        const full = join(root, path);
        const info = await lstat(full).catch(() => null);
        if (!info?.isFile() || !(await realpath(full)).startsWith(`${await realpath(root)}${sep}`))
          return new Response("Not found", { status: 404 });
        return new Response(Bun.file(full), {
          headers: {
            "content-type": types[path.split(".").pop() ?? ""] ?? "application/octet-stream",
          },
        });
      }
      return new Response("Not found", { status: 404 });
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    async stop() {
      await server.stop(true);
    },
  };
}

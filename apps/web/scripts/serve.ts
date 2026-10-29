import { resolve } from "node:path";
import { serveDashboard } from "../src/server.js";

// bun scripts/serve.ts <campaign-directory> [--port N]
const directory = process.argv[2];
if (!directory) throw new Error("Usage: bun scripts/serve.ts <campaign-directory> [--port N]");
const flag = process.argv.indexOf("--port");
const dashboard = serveDashboard(resolve(directory), flag > 0 ? Number(process.argv[flag + 1]) : 0);
console.log(
  `Dashboard for ${resolve(directory)}: ${dashboard.url} (live view: ${dashboard.url}/?view=live)`,
);

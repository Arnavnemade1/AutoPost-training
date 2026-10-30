// The loopback HTTP adapter follows the collaborator's orchestrator/relay-server.mjs.
// This profile keeps its own dependency pins; no collaborator source is modified.
import { createEngine } from "@relaycast/engine";
import { createNodeRuntime } from "@relaycast/engine/adapters/node";
import { serve } from "@hono/node-server";

const port = Number(process.argv[3] ?? 7528);
const runtime = createNodeRuntime({
  dbPath: process.argv[2] ?? "data/relaycast.db",
  baseUrl: `http://127.0.0.1:${port}`,
  config: { environment: "test" },
});
const app = createEngine(runtime.deps);
const server = serve(
  { fetch: app.fetch, port, hostname: "127.0.0.1" },
  ({ port }) => {
    console.log(JSON.stringify({ url: `http://127.0.0.1:${port}` }));
  },
);
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.once(signal, () =>
    server.close(() => {
      runtime.close();
      process.exit(0);
    }),
  );
}

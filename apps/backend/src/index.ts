import { PORTS } from "@resilynx/contracts";

export function handleRequest(req: Request): Response {
  const url = new URL(req.url);
  if (url.pathname === "/health") {
    return Response.json({ status: "ok" });
  }
  return new Response("Not Found", { status: 404 });
}

if (import.meta.main) {
  const server = Bun.serve({ port: PORTS.backend, fetch: handleRequest });
  console.log(`backend listening on :${server.port}`);
}

import { NextRequest } from 'next/server';
export const dynamic = 'force-dynamic';
async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const origin = request.headers.get('origin');
  if (request.method === 'POST' && origin && origin !== request.nextUrl.origin) {
    return Response.json({ detail: 'Untrusted request origin' }, { status: 403 });
  }
  const endpoint = new URL(path.map(encodeURIComponent).join('/'), (process.env.FORGE_API_URL || 'http://127.0.0.1:8000') + '/');
  endpoint.search = request.nextUrl.search;
  try {
    const upstream = await fetch(endpoint, { method: request.method, headers: { 'Content-Type': 'application/json' },
      body: request.method === 'POST' ? await request.text() : undefined, cache: 'no-store', signal: AbortSignal.timeout(30000) });
    const headers = new Headers();
    for (const key of ['content-type', 'content-disposition']) { const value = upstream.headers.get(key); if (value) headers.set(key, value); }
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch {
    return Response.json({ detail: 'The research engine is unavailable. Start the lab services, then retry.' }, { status: 503 });
  }
}
export { proxy as GET, proxy as POST };

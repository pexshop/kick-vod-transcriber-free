export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    if (url.pathname === "/api/health") {
      return Response.json({
        ok: true,
        service: "kick-vod-transcriber-free",
        extractorConfigured: Boolean(env.EXTRACTOR_URL && env.EXTRACTOR_TOKEN),
        transcription: "local browser model; no paid API",
      });
    }

    if (url.pathname === "/api/audio" && request.method === "POST") {
      if (!env.EXTRACTOR_URL || !env.EXTRACTOR_TOKEN) {
        return Response.json(
          { error: "Audio extraction is not configured. Set EXTRACTOR_URL and EXTRACTOR_TOKEN in Worker settings." },
          { status: 503 },
        );
      }

      let body;
      try {
        body = await request.json();
      } catch {
        return Response.json({ error: "Invalid JSON body." }, { status: 400 });
      }

      if (typeof body.url !== "string" || !/^https?:\/\/(www\.)?kick\.com\//i.test(body.url)) {
        return Response.json({ error: "Enter a valid public Kick VOD URL." }, { status: 400 });
      }

      try {
        const upstreamUrl = new URL("/audio", env.EXTRACTOR_URL);
        const upstream = await fetch(upstreamUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${env.EXTRACTOR_TOKEN}`,
          },
          body: JSON.stringify({ url: body.url }),
          signal: AbortSignal.timeout(1000 * 60 * 10),
        });

        if (!upstream.ok) {
          const error = await upstream.json().catch(() => ({}));
          return Response.json(
            { error: error.detail || error.error || "Audio extraction failed." },
            { status: upstream.status },
          );
        }

        const headers = new Headers({
          "Content-Type": upstream.headers.get("Content-Type") || "audio/mpeg",
          "Content-Disposition": 'attachment; filename="kick-vod-audio.mp3"',
          "Cache-Control": "no-store",
        });
        return new Response(upstream.body, { status: 200, headers });
      } catch {
        return Response.json(
          { error: "Could not reach the free extraction service. It may be waking up; please retry in a minute." },
          { status: 502 },
        );
      }
    }

    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Kick VOD Transcriber is running.");
  },
};

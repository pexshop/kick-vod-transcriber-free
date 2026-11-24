export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const requestId = crypto.randomUUID();

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
      console.log(JSON.stringify({ event: "audio_request_received", requestId }));

      if (!env.EXTRACTOR_URL || !env.EXTRACTOR_TOKEN) {
        console.error(JSON.stringify({ event: "extractor_not_configured", requestId }));
        return Response.json(
          { error: "Audio extraction is not configured. Check EXTRACTOR_URL and EXTRACTOR_TOKEN in Worker settings.", requestId },
          { status: 503 },
        );
      }

      let body;
      try {
        body = await request.json();
      } catch {
        return Response.json({ error: "Invalid JSON body.", requestId }, { status: 400 });
      }

      let vodUrl;
      try { vodUrl = new URL(body.url); } catch {
        return Response.json({ error: "Enter a valid public Kick VOD URL.", requestId }, { status: 400 });
      }
      if (typeof body.url !== "string" || !["http:", "https:"].includes(vodUrl.protocol) || !["kick.com", "www.kick.com"].includes(vodUrl.hostname.toLowerCase())) {
        return Response.json({ error: "Enter a valid public Kick VOD URL.", requestId }, { status: 400 });
      }

      let upstreamUrl;
      try {
        upstreamUrl = new URL("/audio", env.EXTRACTOR_URL);
        if (upstreamUrl.protocol !== "https:" && upstreamUrl.hostname !== "localhost") {
          throw new Error("EXTRACTOR_URL must use HTTPS.");
        }
      } catch (error) {
        console.error(JSON.stringify({ event: "invalid_extractor_url", requestId, message: String(error) }));
        return Response.json({ error: "The extraction service URL is invalid. Check EXTRACTOR_URL.", requestId }, { status: 500 });
      }

      const startedAt = Date.now();
      console.log(JSON.stringify({ event: "upstream_audio_request_started", requestId, host: upstreamUrl.host }));

      try {
        const upstream = await fetch(upstreamUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${env.EXTRACTOR_TOKEN}`,
            "X-Request-ID": requestId,
          },
          body: JSON.stringify({ url: body.url }),
          signal: AbortSignal.timeout(10 * 60 * 1000),
        });

        console.log(JSON.stringify({
          event: "upstream_audio_response",
          requestId,
          status: upstream.status,
          durationMs: Date.now() - startedAt,
          contentLength: upstream.headers.get("Content-Length"),
        }));

        if (!upstream.ok) {
          const contentType = upstream.headers.get("Content-Type") || "";
          let detail = "Audio extraction failed.";
          if (contentType.includes("application/json")) {
            const error = await upstream.json().catch(() => ({}));
            detail = error.detail || error.error || detail;
          } else {
            const text = await upstream.text().catch(() => "");
            if (text) detail = text.slice(0, 500);
          }
          return Response.json({ error: detail, requestId }, { status: upstream.status });
        }

        const headers = new Headers({
          "Content-Type": upstream.headers.get("Content-Type") || "audio/mpeg",
          "Content-Disposition": 'attachment; filename="kick-vod-audio.mp3"',
          "Cache-Control": "no-store",
          "X-Request-ID": requestId,
        });
        return new Response(upstream.body, { status: 200, headers });
      } catch (error) {
        const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
        console.error(JSON.stringify({
          event: timedOut ? "upstream_audio_timeout" : "upstream_audio_error",
          requestId,
          durationMs: Date.now() - startedAt,
          message: String(error?.message || error).slice(0, 300),
        }));
        return Response.json(
          { error: timedOut
              ? "The audio extraction service took too long. The free server may be waking up; wait a minute and retry."
              : "Could not reach the audio extraction service. Check the Worker logs and Render service status.",
            requestId },
          { status: timedOut ? 504 : 502 },
        );
      }
    }

    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Kick VOD Transcriber is running.");
  },
};
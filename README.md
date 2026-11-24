# Kick VOD Transcriber

A free-to-use English website for extracting audio from public Kick VODs and transcribing speech locally in the visitor's browser.

## How it works

- Cloudflare Worker serves the website and securely proxies audio extraction requests.
- A small Render free web service uses yt-dlp and FFmpeg to extract audio from supported public Kick VODs.
- Transformers.js loads the open-source `whisper-tiny.en` speech model in the visitor's browser.
- Audio transcription runs on the visitor's device. No OpenAI API key, paid transcription API, account, or server-side speech API is used.
- The speech model is downloaded from Hugging Face on first use and cached by the browser where supported.

## Free-tier limits

"Free" means this project does not call a paid speech API. Hosting providers may change their free-tier policies. Render free services can sleep while idle and have resource/time limits. The starter limits VODs to 30 minutes and extracted audio to 24 MB. Browser transcription can be slow, especially on phones; keep the page open while it works. The first model download can be large and requires an internet connection.

This is not a guarantee of unlimited or always-available processing.

## Deploy the extractor

1. Connect this repository to Render using **New → Blueprint**.
2. Set a long random value for `EXTRACTOR_TOKEN`.
3. Deploy and wait until the service is Live.
4. Test `https://YOUR-RENDER-SERVICE.onrender.com/health`; it should return `ok: true`.

## Connect Cloudflare Worker

In **Workers & Pages → kick-vod-transcriber → Settings → Variables and Secrets**:

- Add `EXTRACTOR_URL` as a variable, containing the Render base URL (no trailing endpoint path).
- Add `EXTRACTOR_TOKEN` as a secret with the exact same token configured in Render.

Deploy the Worker with this repository's `wrangler.toml` and `worker.js`. Test `/api/health`; `extractorConfigured` should be true.

## Responsible use

Only process public VODs you are authorized to access. Private, login-gated, DRM-protected, deleted, or otherwise restricted content is unsupported. This project does not bypass access controls. Kick may change its delivery mechanisms, so yt-dlp support is not guaranteed for every VOD. This independent project is not affiliated with Kick.

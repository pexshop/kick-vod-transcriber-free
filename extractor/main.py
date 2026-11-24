import logging
import os
import re
import shutil
import tempfile
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, HttpUrl
from starlette.background import BackgroundTask
from yt_dlp import YoutubeDL

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("kick-extractor")

app = FastAPI(title="Kick VOD Audio Extractor")
TOKEN = os.getenv("EXTRACTOR_TOKEN")
MAX_DURATION_SECONDS = int(os.getenv("MAX_DURATION_SECONDS", "1800"))
MAX_AUDIO_BYTES = 24 * 1024 * 1024


class AudioJob(BaseModel):
    url: HttpUrl


def check_auth(authorization: str | None):
    if not TOKEN:
        raise HTTPException(status_code=503, detail="EXTRACTOR_TOKEN is not configured on the extraction service.")
    if authorization != f"Bearer {TOKEN}":
        raise HTTPException(status_code=401, detail="Worker and Render EXTRACTOR_TOKEN values do not match.")


@app.get("/health")
def health():
    return {"ok": True, "transcription": "runs locally in the visitor's browser"}


@app.post("/audio")
def extract_audio(job: AudioJob, authorization: str | None = Header(default=None), x_request_id: str | None = Header(default=None)):
    request_id = x_request_id or "untracked"
    check_auth(authorization)

    url = str(job.url)
    if not re.match(r"^https?://(www\.)?kick\.com/", url, re.I):
        raise HTTPException(status_code=400, detail="Only public Kick URLs are accepted.")

    logger.info("audio_job_started request_id=%s", request_id)
    temp_dir = tempfile.mkdtemp(prefix="kick-audio-")
    try:
        output = str(Path(temp_dir) / "audio.%(ext)s")
        options = {
            # Select an audio-only stream first; never download the full video when audio is available.
            "format": "bestaudio[acodec!=none]/best[acodec!=none]",
            "outtmpl": output,
            "noplaylist": True,
            "quiet": True,
            "no_warnings": True,
            "restrictfilenames": True,
            "socket_timeout": 30,
            "retries": 2,
            "fragment_retries": 2,
            "concurrent_fragment_downloads": 2,
            "max_filesize": MAX_AUDIO_BYTES,
            "postprocessors": [{
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": "64",
            }],
        }

        try:
            with YoutubeDL(options) as ydl:
                # Fetch metadata first so overlong VODs are rejected before downloading audio.
                info = ydl.extract_info(url, download=False)
                duration = info.get("duration")
                if duration is None:
                    logger.warning("duration_unknown request_id=%s", request_id)
                elif duration > MAX_DURATION_SECONDS:
                    minutes = MAX_DURATION_SECONDS // 60
                    raise HTTPException(
                        status_code=413,
                        detail=f"This VOD is {int(duration // 60)} minutes long; the free limit is {minutes} minutes.",
                    )
                ydl.download([url])
        except HTTPException:
            raise
        except Exception as exc:
            message = str(exc)
            logger.exception("yt_dlp_failed request_id=%s", request_id)
            if "max-filesize" in message.lower() or "file is larger" in message.lower() or "filesize" in message.lower():
                raise HTTPException(status_code=413, detail="The source audio is too large for the 24 MB free limit.")
            raise HTTPException(
                status_code=422,
                detail=f"Could not extract this public VOD. It may be unavailable or unsupported: {message[:220]}",
            )

        audio = Path(temp_dir) / "audio.mp3"
        if not audio.exists():
            raise HTTPException(status_code=500, detail="Audio extraction finished without producing an MP3 file.")
        size = audio.stat().st_size
        if size > MAX_AUDIO_BYTES:
            raise HTTPException(status_code=413, detail="Extracted audio is larger than the 24 MB free limit.")

        logger.info("audio_job_completed request_id=%s bytes=%s", request_id, size)
        return FileResponse(
            audio,
            media_type="audio/mpeg",
            filename="kick-vod-audio.mp3",
            background=BackgroundTask(shutil.rmtree, temp_dir, ignore_errors=True),
        )
    except Exception:
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise

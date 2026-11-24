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

app = FastAPI(title="Kick VOD Audio Extractor")
TOKEN = os.getenv("EXTRACTOR_TOKEN")
MAX_DURATION_SECONDS = int(os.getenv("MAX_DURATION_SECONDS", "1800"))
MAX_AUDIO_BYTES = 24 * 1024 * 1024


class AudioJob(BaseModel):
    url: HttpUrl


def check_auth(authorization: str | None):
    if not TOKEN:
        raise HTTPException(status_code=503, detail="EXTRACTOR_TOKEN is not configured.")
    if authorization != f"Bearer {TOKEN}":
        raise HTTPException(status_code=401, detail="Unauthorized")


@app.get("/health")
def health():
    return {"ok": True, "transcription": "runs locally in the visitor's browser"}


@app.post("/audio")
def extract_audio(job: AudioJob, authorization: str | None = Header(default=None)):
    check_auth(authorization)
    url = str(job.url)
    if not re.match(r"^https?://(www\.)?kick\.com/", url, re.I):
        raise HTTPException(status_code=400, detail="Only public Kick URLs are accepted.")

    temp_dir = tempfile.mkdtemp(prefix="kick-audio-")
    try:
        output = str(Path(temp_dir) / "audio.%(ext)s")
        options = {
            "format": "bestaudio/best",
            "outtmpl": output,
            "noplaylist": True,
            "quiet": True,
            "no_warnings": True,
            "restrictfilenames": True,
            "max_filesize": MAX_AUDIO_BYTES,
            "postprocessors": [{
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": "64",
            }],
        }
        try:
            with YoutubeDL(options) as ydl:
                info = ydl.extract_info(url, download=False)
                duration = info.get("duration")
                if duration and duration > MAX_DURATION_SECONDS:
                    raise HTTPException(
                        status_code=413,
                        detail=f"VOD exceeds the {MAX_DURATION_SECONDS // 60}-minute free processing limit.",
                    )
                ydl.download([url])
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(
                status_code=422,
                detail=f"Could not extract this public VOD. It may be unavailable or unsupported: {str(exc)[:240]}",
            )

        audio = Path(temp_dir) / "audio.mp3"
        if not audio.exists():
            raise HTTPException(status_code=500, detail="Audio extraction did not produce an MP3 file.")
        if audio.stat().st_size > MAX_AUDIO_BYTES:
            raise HTTPException(status_code=413, detail="Extracted audio exceeds the 24 MB limit.")

        return FileResponse(
            audio,
            media_type="audio/mpeg",
            filename="kick-vod-audio.mp3",
            background=BackgroundTask(shutil.rmtree, temp_dir, ignore_errors=True),
        )
    except Exception:
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise

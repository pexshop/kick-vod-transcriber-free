import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.2";

env.allowLocalModels = false;

let transcriberPromise;

function sendProgress(message) {
  self.postMessage({ type: "progress", message });
}

self.addEventListener("message", async (event) => {
  if (event.data?.type !== "transcribe") return;

  try {
    if (!event.data.audio || !(event.data.audio instanceof Float32Array)) {
      throw new Error("Audio data is missing or invalid.");
    }

    if (!transcriberPromise) {
      sendProgress("Loading Whisper tiny English model. The first download may take a few minutes…");
      transcriberPromise = pipeline(
        "automatic-speech-recognition",
        "onnx-community/whisper-tiny.en",
        {
          dtype: "q8",
          progress_callback: (progress) => {
            if (progress.status === "progress" && progress.total) {
              const pct = Math.round((progress.loaded / progress.total) * 100);
              sendProgress("Downloading speech model… " + pct + "%");
            } else if (progress.status === "done") {
              sendProgress("Speech model ready. Transcribing on your device…");
            }
          }
        }
      ).catch((error) => {
        transcriberPromise = undefined;
        throw error;
      });
    }

    const transcriber = await transcriberPromise;
    sendProgress("Transcribing locally. Longer recordings take longer; keep this page open…");
    const output = await transcriber(event.data.audio, {
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: true
    });
    self.postMessage({ type: "complete", output });
  } catch (error) {
    self.postMessage({
      type: "error",
      message: String(error?.message || error).slice(0, 500)
    });
  }
});
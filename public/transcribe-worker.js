import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.2";

env.allowLocalModels = false;
// Keep the ONNX runtime lightweight on phones; a single thread reduces memory pressure.
try { env.backends.onnx.wasm.numThreads = 1; } catch {}

let transcriberPromise;
function sendProgress(requestId, message) {
  self.postMessage({ type: "progress", requestId, message });
}

self.addEventListener("message", async (event) => {
  const { type, audio, requestId } = event.data || {};
  if (type !== "transcribe") return;
  try {
    if (!(audio instanceof Float32Array) || audio.length < 1600) {
      throw new Error("音频数据为空或太短，请继续采集后重试。");
    }
    if (!transcriberPromise) {
      sendProgress(requestId, "正在加载 Whisper 英文模型；首次下载可能需要几分钟…");
      transcriberPromise = pipeline(
        "automatic-speech-recognition",
        "onnx-community/whisper-tiny.en",
        {
          dtype: "q8",
          progress_callback: (progress) => {
            if (progress.status === "progress" && progress.total) {
              const pct = Math.round((progress.loaded / progress.total) * 100);
              sendProgress(requestId, "正在下载语音模型… " + pct + "%");
            } else if (progress.status === "done") {
              sendProgress(requestId, "模型文件已下载，正在准备识别…");
            }
          }
        }
      ).catch((error) => {
        transcriberPromise = undefined;
        throw error;
      });
    }
    const transcriber = await transcriberPromise;
    sendProgress(requestId, "正在本机识别音频…");
    const output = await transcriber(audio, {
      chunk_length_s: 15,
      stride_length_s: 3,
      return_timestamps: true
    });
    self.postMessage({ type: "complete", requestId, output });
  } catch (error) {
    const raw = String(error?.message || error);
    let message = raw;
    if (/fetch|network|load failed|failed to fetch|http/i.test(raw)) {
      message = "模型下载或网络请求失败。请检查网络/VPN后点击重试。详情：" + raw;
    } else if (/memory|alloc|out of memory|wasm/i.test(raw)) {
      message = "iPhone 可用内存不足，已降低处理负担。请关闭其他网页后重试。详情：" + raw;
    }
    self.postMessage({ type: "error", requestId, message: message.slice(0, 700) });
  }
});

import "./styles.css";
import type { ChatJobRequest, RelayToWorkerEvent, WorkerToRelayEvent } from "../../shared/protocol.js";

type WebLlmEngine = {
  chat: {
    completions: {
      create(input: {
        model: string;
        messages: readonly { role: string; content: string }[];
        temperature?: number;
        max_tokens?: number;
        stream?: false;
      }): Promise<{
        choices?: Array<{
          message?: {
            content?: string;
          };
        }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
        };
      }>;
    };
  };
};

const DEFAULT_MODEL = "Llama-3.2-1B-Instruct-q4f32_1-MLC";

const relayUrlInput = element<HTMLInputElement>("relayUrl");
const sessionIdInput = element<HTMLInputElement>("sessionId");
const tokenInput = element<HTMLInputElement>("sessionToken");
const modelIdInput = element<HTMLInputElement>("modelId");
const loadModelButton = element<HTMLButtonElement>("loadModelButton");
const connectButton = element<HTMLButtonElement>("connectButton");
const disconnectButton = element<HTMLButtonElement>("disconnectButton");
const statusText = element<HTMLElement>("statusText");
const stateBadge = element<HTMLElement>("stateBadge");
const logElement = element<HTMLPreElement>("log");

let engine: WebLlmEngine | null = null;
let socket: WebSocket | null = null;
let state = "offline";

restoreSettings();
renderState("offline", "Configure the relay, load a model, then connect.");
registerServiceWorker();

loadModelButton.addEventListener("click", () => {
  void loadModel();
});

connectButton.addEventListener("click", () => {
  connectWorker();
});

disconnectButton.addEventListener("click", () => {
  socket?.close();
  socket = null;
  renderState("offline", "Disconnected");
});

for (const input of [relayUrlInput, sessionIdInput, tokenInput, modelIdInput]) {
  input.addEventListener("change", saveSettings);
}

async function loadModel(): Promise<void> {
  const model = modelIdInput.value.trim();
  if (!model) {
    appendLog("Model id is required.");
    return;
  }

  saveSettings();
  setButtons(false);
  renderState("loading", `Loading ${model}`);
  sendWorkerEvent({
    type: "worker.loading",
    model,
    message: "Loading model"
  });

  try {
    const webllm = await import("@mlc-ai/web-llm");
    engine = await webllm.CreateMLCEngine(model, {
      initProgressCallback: (progress: { text?: string; progress?: number }) => {
        const pct = typeof progress.progress === "number" ? ` ${Math.round(progress.progress * 100)}%` : "";
        renderState("loading", `${progress.text ?? "Loading model"}${pct}`);
      }
    });
    renderState("ready", `Ready: ${model}`);
    sendWorkerEvent({
      type: "worker.ready",
      model
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load model";
    engine = null;
    renderState("error", message);
    sendWorkerEvent({
      type: "worker.error",
      model,
      message
    });
  } finally {
    setButtons(true);
  }
}

function connectWorker(): void {
  const relayUrl = relayUrlInput.value.trim();
  const session = sessionIdInput.value.trim() || "default";
  const token = tokenInput.value.trim();

  if (!relayUrl) {
    appendLog("Relay WebSocket URL is required.");
    return;
  }

  saveSettings();
  const url = new URL(relayUrl);
  url.searchParams.set("session", session);
  if (token) {
    url.searchParams.set("token", token);
  }

  socket?.close();
  socket = new WebSocket(url);
  renderState(state === "ready" ? "ready" : "loading", "Connecting to relay");

  socket.addEventListener("open", () => {
    appendLog(`Connected to ${url.origin}`);
    if (engine) {
      sendWorkerEvent({
        type: "worker.ready",
        model: modelIdInput.value.trim()
      });
      renderState("ready", `Ready: ${modelIdInput.value.trim()}`);
    } else {
      sendWorkerEvent({
        type: "worker.loading",
        model: modelIdInput.value.trim(),
        message: "Worker connected, model not loaded"
      });
      renderState("loading", "Connected. Load the model to accept jobs.");
    }
  });

  socket.addEventListener("message", (event) => {
    void handleRelayEvent(event.data);
  });

  socket.addEventListener("close", () => {
    appendLog("Relay connection closed.");
    socket = null;
    renderState("offline", "Disconnected from relay");
  });

  socket.addEventListener("error", () => {
    appendLog("Relay connection error.");
  });
}

async function handleRelayEvent(raw: string): Promise<void> {
  let event: RelayToWorkerEvent;
  try {
    event = JSON.parse(raw) as RelayToWorkerEvent;
  } catch {
    appendLog("Ignored invalid relay event.");
    return;
  }

  if (event.type !== "job.request") {
    return;
  }

  if (!engine) {
    sendWorkerEvent({
      type: "job.error",
      jobId: event.jobId,
      code: "model_loading",
      message: "Model is not loaded"
    });
    return;
  }

  renderState("busy", `Running ${event.request.model}`);
  appendLog(`Job ${event.jobId} started.`);

  try {
    const result = await runChat(event.request);
    sendWorkerEvent({
      type: "job.result",
      jobId: event.jobId,
      outputText: result.outputText,
      usage: result.usage
    });
    appendLog(`Job ${event.jobId} completed.`);
    renderState("ready", `Ready: ${modelIdInput.value.trim()}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Inference failed";
    sendWorkerEvent({
      type: "job.error",
      jobId: event.jobId,
      code: "worker_error",
      message
    });
    appendLog(`Job ${event.jobId} failed: ${message}`);
    renderState("ready", `Ready: ${modelIdInput.value.trim()}`);
  }
}

async function runChat(request: ChatJobRequest): Promise<{
  outputText: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}> {
  if (!engine) {
    throw new Error("Model is not loaded");
  }

  const response = await engine.chat.completions.create({
    model: modelIdInput.value.trim(),
    messages: request.messages,
    temperature: request.temperature,
    max_tokens: request.max_tokens,
    stream: false
  });
  const outputText = response.choices?.[0]?.message?.content;

  if (!outputText) {
    throw new Error("Model returned no assistant text");
  }

  return {
    outputText,
    usage: response.usage
  };
}

function sendWorkerEvent(event: WorkerToRelayEvent): void {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }

  socket.send(JSON.stringify(event));
}

function restoreSettings(): void {
  relayUrlInput.value = localStorage.getItem("phone-worker.relayUrl") ?? defaultRelayUrl();
  sessionIdInput.value = localStorage.getItem("phone-worker.sessionId") ?? "default";
  tokenInput.value = localStorage.getItem("phone-worker.token") ?? "";
  modelIdInput.value = localStorage.getItem("phone-worker.modelId") ?? DEFAULT_MODEL;
}

function saveSettings(): void {
  localStorage.setItem("phone-worker.relayUrl", relayUrlInput.value.trim());
  localStorage.setItem("phone-worker.sessionId", sessionIdInput.value.trim());
  localStorage.setItem("phone-worker.token", tokenInput.value.trim());
  localStorage.setItem("phone-worker.modelId", modelIdInput.value.trim());
}

function defaultRelayUrl(): string {
  const host = location.hostname || "127.0.0.1";
  return `ws://${host}:8787/worker`;
}

function renderState(nextState: string, message: string): void {
  state = nextState;
  stateBadge.textContent = nextState;
  stateBadge.className = `badge ${nextState}`;
  statusText.textContent = message;
}

function setButtons(enabled: boolean): void {
  loadModelButton.disabled = !enabled;
  connectButton.disabled = !enabled;
  disconnectButton.disabled = !enabled;
}

function appendLog(message: string): void {
  const line = `[${new Date().toLocaleTimeString()}] ${message}`;
  logElement.textContent = logElement.textContent ? `${line}\n${logElement.textContent}` : line;
}

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) {
    throw new Error(`Missing element #${id}`);
  }

  return found as T;
}

function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  navigator.serviceWorker.register("./service-worker.js").catch((error: unknown) => {
    appendLog(`Service worker registration failed: ${error instanceof Error ? error.message : "unknown error"}`);
  });
}

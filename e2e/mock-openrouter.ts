import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createHash } from "node:crypto";

const PORT = Number(process.env.MOCK_OPENROUTER_PORT ?? 4010);

/** Per-model behavior overrides for e2e (fail / timeout / custom reply). */
type ModelBehavior = {
  fail?: boolean;
  timeoutMs?: number;
  reply?: string;
  cost?: number;
};

const behaviors = new Map<string, ModelBehavior>();
const chatRequests: unknown[] = [];
let synthesizerCalls = 0;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(payload);
}

const MODELS = {
  data: [
    {
      id: "openai/gpt-4o-mini",
      name: "GPT-4o Mini",
      context_length: 128000,
      pricing: { prompt: "0.00000015", completion: "0.0000006" },
      architecture: { input_modalities: ["text"], output_modalities: ["text"] },
      supported_parameters: ["tools", "tool_choice", "response_format"],
    },
    {
      id: "anthropic/claude-3.5-haiku",
      name: "Claude 3.5 Haiku",
      context_length: 200000,
      pricing: { prompt: "0.0000008", completion: "0.000004" },
      architecture: { input_modalities: ["text", "image"] },
      supported_parameters: ["tools", "reasoning"],
    },
    {
      id: "google/gemini-2.0-flash",
      name: "Gemini 2.0 Flash",
      context_length: 1000000,
      pricing: { prompt: "0.0000001", completion: "0.0000004" },
      architecture: { input_modalities: ["text"] },
      supported_parameters: ["response_format"],
    },
    {
      id: "meta-llama/llama-3.3-70b",
      name: "Llama 3.3 70B",
      context_length: 128000,
      pricing: { prompt: "0.00000035", completion: "0.0000004" },
      architecture: { input_modalities: ["text"] },
      supported_parameters: [],
    },
    {
      id: "mistralai/mistral-small",
      name: "Mistral Small",
      context_length: 128000,
      pricing: { prompt: "0.0000001", completion: "0.0000003" },
      architecture: { input_modalities: ["text"] },
      supported_parameters: [],
    },
    {
      id: "deepseek/deepseek-chat",
      name: "DeepSeek Chat",
      context_length: 64000,
      pricing: { prompt: "0.00000014", completion: "0.00000028" },
      architecture: { input_modalities: ["text"] },
      supported_parameters: [],
    },
  ],
};

function defaultReplyFor(modelId: string): string {
  if (modelId.includes("anthropic")) {
    return "Anthropic view: caffeine half-life is ~5 hours in adults. Dose matters.";
  }
  if (modelId.includes("google")) {
    return "Google view: caffeine half-life is ~3–7 hours; genetics vary clearance.";
  }
  if (
    modelId.includes("meta-llama") ||
    modelId.includes("mistral") ||
    modelId.includes("deepseek")
  ) {
    return `Open-weight (${modelId}): caffeine clears in about 5 hours on average.`;
  }
  return "Here is a short answer with code:\n\n```js\nconsole.log('hello araitchi')\n```\n\nDone.";
}

function synthesizerJson(valid: boolean): string {
  if (!valid) return "{ not valid json";
  return JSON.stringify({
    finalAnswer:
      "Caffeine half-life is typically about 5 hours in healthy adults, with wide individual variation.",
    consensus: ["Caffeine half-life is measured in hours, not minutes"],
    contradictions: [
      {
        topic: "Typical half-life",
        positions: [
          { member: "Member A", stance: "~5 hours" },
          { member: "Member B", stance: "~3–7 hours range" },
          { member: "Member C", stance: "~5 hours average" },
        ],
        needsEvidence: true,
      },
    ],
    uniqueInsights: [
      { member: "Member B", insight: "Genetics affect clearance" },
    ],
    blindSpots: ["Pregnancy and liver disease not discussed"],
    confidence: "medium",
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  const path = url.pathname;

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "*",
    });
    res.end();
    return;
  }

  if (req.method === "POST" && path === "/api/v1/_test/behaviors") {
    const raw = await readBody(req);
    try {
      const body = JSON.parse(raw) as Record<string, ModelBehavior>;
      behaviors.clear();
      for (const [id, b] of Object.entries(body)) behaviors.set(id, b);
      synthesizerCalls = 0;
      chatRequests.length = 0;
      json(res, 200, { ok: true });
    } catch {
      json(res, 400, { error: "bad json" });
    }
    return;
  }

  if (req.method === "GET" && path === "/api/v1/_test/requests") {
    json(res, 200, { requests: chatRequests, synthesizerCalls });
    return;
  }

  if (req.method === "GET" && (path === "/auth" || path === "/api/v1/auth")) {
    const callback = url.searchParams.get("callback_url");
    if (!callback) {
      json(res, 400, { error: "missing callback" });
      return;
    }
    const target = new URL(callback);
    target.searchParams.set("code", "mock-auth-code");
    res.writeHead(302, { Location: target.toString() });
    res.end();
    return;
  }

  if (req.method === "GET" && path === "/api/v1/models") {
    json(res, 200, MODELS);
    return;
  }

  if (req.method === "GET" && path === "/api/v1/_test/last-chat") {
    json(res, 200, { request: chatRequests.at(-1) ?? null });
    return;
  }

  if (req.method === "GET" && path === "/api/v1/key") {
    const auth = req.headers.authorization ?? "";
    if (!auth.includes("Bearer ")) {
      json(res, 401, { error: "unauthorized" });
      return;
    }
    json(res, 200, {
      data: {
        label: "mock-key",
        usage: 0.12,
        limit: 10,
        limit_remaining: 9.88,
        is_free_tier: false,
      },
    });
    return;
  }

  if (req.method === "POST" && path === "/api/v1/auth/keys") {
    const raw = await readBody(req);
    let body: { code?: string; code_verifier?: string } = {};
    try {
      body = JSON.parse(raw) as typeof body;
    } catch {
      json(res, 400, { error: "bad json" });
      return;
    }
    if (!body.code || !body.code_verifier) {
      json(res, 403, { error: "Invalid code or code_verifier" });
      return;
    }
    const digest = createHash("sha256")
      .update(body.code_verifier)
      .digest("hex")
      .slice(0, 24);
    json(res, 200, { key: `sk-or-v1-mock-${digest}` });
    return;
  }

  if (req.method === "POST" && path === "/api/v1/chat/completions") {
    const raw = await readBody(req);
    let parsed: {
      model?: string;
      stream?: boolean;
      messages?: { role: string; content: string | unknown }[];
      response_format?: { type?: string };
    } = {};
    try {
      parsed = JSON.parse(raw) as typeof parsed;
      chatRequests.push(parsed);
    } catch {
      chatRequests.push({ raw });
    }

    const modelId = parsed.model ?? "openai/gpt-4o-mini";
    const behavior = behaviors.get(modelId) ?? {};
    const msgBlob = JSON.stringify(parsed.messages ?? []);
    const isSynth =
      msgBlob.includes("Member A") ||
      msgBlob.includes("anonymized") ||
      msgBlob.includes("Synthesize") ||
      msgBlob.includes("independent answers") ||
      Boolean(parsed.response_format);

    if (behavior.fail) {
      // 400 so the AI SDK does not auto-retry forever on "retryable" 5xx
      json(res, 400, {
        error: { message: `Configured failure for ${modelId}` },
      });
      return;
    }

    if (behavior.timeoutMs) {
      await new Promise((r) => setTimeout(r, behavior.timeoutMs));
    }

    const slow = url.searchParams.get("slow") === "1";
    let reply: string;
    if (isSynth) {
      synthesizerCalls += 1;
      const malformedFirst =
        behaviors.get("__synth__")?.fail && synthesizerCalls === 1;
      reply = synthesizerJson(!malformedFirst);
    } else {
      reply = behavior.reply ?? defaultReplyFor(modelId);
    }

    const usage = {
      prompt_tokens: 12,
      completion_tokens: 28,
      total_tokens: 40,
      cost: behavior.cost ?? 0.0012,
    };

    // generateText/doGenerate omits stream or sets false; streamText sets true
    if (parsed.stream !== true) {
      json(res, 200, {
        id: "chatcmpl-mock",
        object: "chat.completion",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: reply },
            finish_reason: "stop",
          },
        ],
        usage,
      });
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });

    const id = "chatcmpl-mock";
    const send = (obj: unknown) => {
      res.write(`data: ${JSON.stringify(obj)}\n\n`);
    };

    send({
      id,
      object: "chat.completion.chunk",
      choices: [{ index: 0, delta: { role: "assistant", content: "" } }],
    });

    for (const ch of reply) {
      if (slow) {
        await new Promise((r) => setTimeout(r, 40));
      }
      send({
        id,
        object: "chat.completion.chunk",
        choices: [{ index: 0, delta: { content: ch } }],
      });
    }

    send({
      id,
      object: "chat.completion.chunk",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      usage,
    });
    res.write("data: [DONE]\n\n");
    res.end();
    return;
  }

  json(res, 404, { error: "not found", path });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`mock openrouter on http://127.0.0.1:${PORT}`);
});

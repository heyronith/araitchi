import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createHash } from "node:crypto";

const PORT = Number(process.env.MOCK_OPENROUTER_PORT ?? 4010);

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
  ],
};

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
    // Deterministic fake key for tests (not a real secret).
    const digest = createHash("sha256")
      .update(body.code_verifier)
      .digest("hex")
      .slice(0, 24);
    json(res, 200, { key: `sk-or-v1-mock-${digest}` });
    return;
  }

  if (req.method === "POST" && path === "/api/v1/chat/completions") {
    const slow = url.searchParams.get("slow") === "1";
    const reply =
      "Here is a short answer with code:\n\n```js\nconsole.log('hello araitchi')\n```\n\nDone.";

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
      usage: {
        prompt_tokens: 12,
        completion_tokens: 28,
        total_tokens: 40,
        cost: 0.0012,
      },
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

import http from "node:http";
import { URL } from "node:url";

import type { UnifiedStatus } from "../status.js";
import type { PushRequest, PushResult } from "../push-queue.js";
import { PushQueue } from "../push-queue.js";

export type EnqueueResponse = {
  sessionId: string;
  position: number;
};

export type StatusResponse = {
  status: "queued" | "in-progress" | "completed" | "failed";
  result?: {
    status: string;
    branch?: string;
    error?: string;
  };
  error?: string;
};

export type ApiServerOpts = {
  repoDir: string;
  getStatus: () => Promise<UnifiedStatus>;
  pushQueue: PushQueue;
  executePush: (req: PushRequest) => Promise<PushResult>;
  host?: string;
  port?: number;
};

let server: http.Server | null = null;
let listeningPort: number | null = null;

function sendJson(res: http.ServerResponse, statusCode: number, body: unknown): void {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  const limitBytes = 1_000_000;
  let total = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    total += buf.length;
    if (total > limitBytes) throw new Error("request too large");
    chunks.push(buf);
  }
  const raw = Buffer.concat(chunks).toString("utf-8");
  if (!raw) return {};
  return JSON.parse(raw);
}

export async function startApiServer(opts: ApiServerOpts): Promise<number> {
  if (server && listeningPort != null) return listeningPort;

  const host = opts.host ?? "127.0.0.1";
  const port = opts.port ?? 8420;

  server = http.createServer(async (req, res) => {
    try {
      const method = req.method ?? "GET";
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const path = url.pathname;

      if (method === "GET" && path === "/api/status") {
        const status = await opts.getStatus();
        return sendJson(res, 200, status);
      }

      if (method === "POST" && path === "/api/push/enqueue") {
        const body = await readJson(req);
        const b = body as { sessionId?: unknown; cwd?: unknown; priority?: unknown };
        const sessionId = typeof b.sessionId === "string" ? b.sessionId : "";
        const cwd = typeof b.cwd === "string" ? b.cwd : "";
        const priority = typeof b.priority === "number" ? b.priority : 0;

        if (!sessionId || !cwd) {
          return sendJson(res, 400, { error: "sessionId and cwd required" });
        }

        // @ts-expect-error pre-existing type mismatch
        const enq = opts.pushQueue.enqueue({ sessionId, cwd, priority });
        void opts.pushQueue.processQueue(opts.executePush).catch((err) => {
          console.error("[api] push queue processing error:", err);
        });

        const response: EnqueueResponse = { sessionId, position: enq.position };
        return sendJson(res, 200, response);
      }

      if (method === "GET" && path.startsWith("/api/push/status/")) {
        const sessionId = decodeURIComponent(path.slice("/api/push/status/".length));
        if (!sessionId) return sendJson(res, 400, { error: "sessionId required" });

        const result = opts.pushQueue.getResult(sessionId);
        if (result) {
          const response: StatusResponse = {
            status: "completed",
            result: {
              status: result.status,
              branch: result.branch,
              error: result.error,
            },
          };
          return sendJson(res, 200, response);
        }

        if (opts.pushQueue.getProcessingSessionId() === sessionId) {
          const response: StatusResponse = { status: "in-progress" };
          return sendJson(res, 200, response);
        }

        const queued = opts.pushQueue.getQueueSnapshot().some((r) => r.sessionId === sessionId);
        if (queued) {
          const response: StatusResponse = { status: "queued" };
          return sendJson(res, 200, response);
        }

        const response: StatusResponse = { status: "failed", error: "not found" };
        return sendJson(res, 200, response);
      }

      return sendJson(res, 404, { error: "not found" });
    } catch (err) {
      return sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server!.once("error", reject);
    server!.listen(port, host, () => resolve());
  });

  const addr = server.address();
  if (addr && typeof addr === "object") {
    listeningPort = addr.port;
  } else {
    listeningPort = port;
  }

  console.log(`[api] Control API listening on http://${host}:${listeningPort}`);
  return listeningPort;
}

export async function stopApiServer(): Promise<void> {
  if (!server) return;
  const s = server;
  server = null;
  listeningPort = null;
  await new Promise<void>((resolve) => s.close(() => resolve()));
}

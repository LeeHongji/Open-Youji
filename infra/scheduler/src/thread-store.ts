import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface ThreadRecord {
  convKey: string;
  channel: string;
  threadTs: string;
  createdAt: number;
  lastActivityAt: number;
}

export interface ThreadMessage {
  id: number;
  convKey: string;
  role: "user" | "assistant";
  content: string;
  slackTs: string | null;
  createdAt: number;
}

interface ThreadRow {
  conv_key: string;
  channel: string;
  thread_ts: string;
  created_at: number;
  last_activity_at: number;
}

interface MessageRow {
  id: number;
  conv_key: string;
  role: string;
  content: string;
  slack_ts: string | null;
  created_at: number;
}

export class ThreadStore {
  private db: Database.Database;
  private stmtEnsureInsert: Database.Statement;
  private stmtEnsureUpdate: Database.Statement;
  private stmtAddMessage: Database.Statement;
  private stmtUpdateActivity: Database.Statement;
  private stmtGetMessages: Database.Statement;
  private stmtGetThread: Database.Statement;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);

    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
    this.db.pragma("synchronous = NORMAL");

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS threads (
        conv_key TEXT PRIMARY KEY,
        channel TEXT NOT NULL,
        thread_ts TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        last_activity_at INTEGER NOT NULL DEFAULT (unixepoch())
      );

      CREATE TABLE IF NOT EXISTS thread_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conv_key TEXT NOT NULL REFERENCES threads(conv_key),
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        slack_ts TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );

      CREATE INDEX IF NOT EXISTS idx_thread_messages_conv_key
        ON thread_messages(conv_key, created_at DESC);

      CREATE UNIQUE INDEX IF NOT EXISTS idx_thread_messages_dedup
        ON thread_messages(conv_key, slack_ts) WHERE slack_ts IS NOT NULL;
    `);

    this.stmtEnsureInsert = this.db.prepare(
      "INSERT OR IGNORE INTO threads (conv_key, channel, thread_ts) VALUES (?, ?, ?)"
    );
    this.stmtEnsureUpdate = this.db.prepare(
      "UPDATE threads SET last_activity_at = unixepoch() WHERE conv_key = ?"
    );
    this.stmtAddMessage = this.db.prepare(
      "INSERT OR IGNORE INTO thread_messages (conv_key, role, content, slack_ts) VALUES (?, ?, ?, ?)"
    );
    this.stmtUpdateActivity = this.db.prepare(
      "UPDATE threads SET last_activity_at = unixepoch() WHERE conv_key = ?"
    );
    this.stmtGetMessages = this.db.prepare(
      "SELECT * FROM (SELECT id, conv_key, role, content, slack_ts, created_at FROM thread_messages WHERE conv_key = ? ORDER BY created_at DESC, id DESC LIMIT ?) ORDER BY created_at ASC, id ASC"
    );
    this.stmtGetThread = this.db.prepare(
      "SELECT conv_key, channel, thread_ts, created_at, last_activity_at FROM threads WHERE conv_key = ?"
    );

    console.log("[thread-store] initialized:", dbPath);
  }

  ensureThread(convKey: string, channel: string, threadTs: string): void {
    this.stmtEnsureInsert.run(convKey, channel, threadTs);
    this.stmtEnsureUpdate.run(convKey);
  }

  addMessage(convKey: string, msg: { role: "user" | "assistant"; content: string; slackTs?: string }): void {
    this.stmtAddMessage.run(convKey, msg.role, msg.content, msg.slackTs ?? null);
    this.stmtUpdateActivity.run(convKey);
  }

  getMessages(convKey: string, opts?: { limit?: number }): ThreadMessage[] {
    const limit = opts?.limit ?? 20;
    const rows = this.stmtGetMessages.all(convKey, limit) as MessageRow[];
    return rows.map((row) => ({
      id: row.id,
      convKey: row.conv_key,
      role: row.role as "user" | "assistant",
      content: row.content,
      slackTs: row.slack_ts,
      createdAt: row.created_at,
    }));
  }

  getThread(convKey: string): ThreadRecord | null {
    const row = this.stmtGetThread.get(convKey) as ThreadRow | undefined;
    if (!row) return null;
    return {
      convKey: row.conv_key,
      channel: row.channel,
      threadTs: row.thread_ts,
      createdAt: row.created_at,
      lastActivityAt: row.last_activity_at,
    };
  }

  close(): void {
    this.db.close();
    console.log("[thread-store] closed");
  }
}

import Database from "better-sqlite3";
import { homedir } from "node:os";
import { join } from "node:path";

export interface OpenCodeSessionTokens {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export function getOpenCodeDbPath(): string {
  return join(homedir(), ".local", "share", "opencode", "opencode.db");
}

export function getSessionTokens(sessionId: string): OpenCodeSessionTokens | null {
  const dbPath = getOpenCodeDbPath();
  try {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const row = db.prepare(`
      SELECT 
        SUM(json_extract(data, '$.tokens.input')) as input_tokens,
        SUM(json_extract(data, '$.tokens.output')) as output_tokens,
        SUM(json_extract(data, '$.tokens.total')) as total_tokens
      FROM message 
      WHERE session_id = ? AND json_extract(data, '$.role') = 'assistant'
    `).get(sessionId) as { input_tokens: number | null; output_tokens: number | null; total_tokens: number | null } | undefined;
    db.close();
    
    if (!row || row.input_tokens === null) return null;
    
    return {
      inputTokens: row.input_tokens ?? 0,
      outputTokens: row.output_tokens ?? 0,
      totalTokens: row.total_tokens ?? 0,
    };
  } catch {
    return null;
  }
}

export interface ModelPricing {
  inputCostPerMillion: number;
  outputCostPerMillion: number;
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  "glm5/zai-org/GLM-5-FP8": { inputCostPerMillion: 0.07, outputCostPerMillion: 0.07 },
  "glm-4-plus": { inputCostPerMillion: 0.07, outputCostPerMillion: 0.07 },
  "claude-sonnet-4-20250514": { inputCostPerMillion: 3.0, outputCostPerMillion: 15.0 },
  "claude-sonnet-4-20250514:thinking": { inputCostPerMillion: 3.0, outputCostPerMillion: 15.0 },
  "claude-3-5-sonnet-20241022": { inputCostPerMillion: 3.0, outputCostPerMillion: 15.0 },
  "claude-3-5-sonnet-20241022:thinking": { inputCostPerMillion: 3.0, outputCostPerMillion: 15.0 },
  "claude-opus-4-20250514": { inputCostPerMillion: 15.0, outputCostPerMillion: 75.0 },
  "claude-opus-4-20250514:thinking": { inputCostPerMillion: 15.0, outputCostPerMillion: 75.0 },
  "claude-3-opus-20240229": { inputCostPerMillion: 15.0, outputCostPerMillion: 75.0 },
};

export function getModelPricing(modelId: string): ModelPricing | undefined {
  return MODEL_PRICING[modelId];
}

export function calculateCost(tokens: OpenCodeSessionTokens, pricing: ModelPricing): number {
  const inputCost = (tokens.inputTokens / 1_000_000) * pricing.inputCostPerMillion;
  const outputCost = (tokens.outputTokens / 1_000_000) * pricing.outputCostPerMillion;
  return inputCost + outputCost;
}

export function getSessionCostFromDb(sessionId: string, modelId?: string): number | null {
  const tokens = getSessionTokens(sessionId);
  if (!tokens) return null;
  
  if (!modelId) {
    const defaultPricing: ModelPricing = { inputCostPerMillion: 0.07, outputCostPerMillion: 0.07 };
    return calculateCost(tokens, defaultPricing);
  }
  
  const pricing = getModelPricing(modelId);
  if (!pricing) {
    const defaultPricing: ModelPricing = { inputCostPerMillion: 0.07, outputCostPerMillion: 0.07 };
    return calculateCost(tokens, defaultPricing);
  }
  
  return calculateCost(tokens, pricing);
}

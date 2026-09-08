import type { LLMProvider, LLMRequest, LLMResponse } from "../providers.js";
import { ProviderError } from "../errors.js";

export interface OpenAILLMProviderOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** "responses" (default, for gpt-5.6/gpt-6) or "chat" (gpt-4o-class). */
  apiStyle?: "responses" | "chat";
  /** Reasoning effort for reasoning-capable models. */
  reasoningEffort?: "low" | "medium" | "high";
}

interface ChatCompletionResponse {
  model?: string;
  choices?: { message?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

interface ResponsesContent {
  type?: string;
  text?: string;
}
interface ResponsesOutputItem {
  type?: string;
  content?: ResponsesContent[];
}
interface ResponsesResponse {
  model?: string;
  output?: ResponsesOutputItem[];
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
}

/**
 * OpenAI-compatible LLM provider. Defaults to the Responses API so gpt-5.6 /
 * gpt-6 reasoning models are reachable; falls back to Chat Completions when
 * `apiStyle: "chat"` is selected. Normalizes both into the LLMResponse contract.
 */
export class OpenAILLMProvider implements LLMProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly apiStyle: "responses" | "chat";
  private readonly reasoningEffort?: "low" | "medium" | "high";

  constructor(opts: OpenAILLMProviderOptions) {
    this.apiKey = opts.apiKey;
    this.model = opts.model;
    this.baseUrl = (opts.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
    this.fetchImpl = opts.fetchImpl ?? ((url, init) => fetch(url, init));
    this.apiStyle = opts.apiStyle ?? "responses";
    this.reasoningEffort = opts.reasoningEffort;
  }

  async generate(req: LLMRequest): Promise<LLMResponse> {
    return this.apiStyle === "responses" ? this.generateResponses(req) : this.generateChat(req);
  }

  private async generateResponses(req: LLMRequest): Promise<LLMResponse> {
    const started = Date.now();
    const body: Record<string, unknown> = {
      model: this.model,
      input: req.messages.map((m) => ({ role: m.role, content: m.content })),
    };
    if (req.responseFormat === "json_object") body.text = { format: { type: "json_object" } };
    if (req.maxTokens) body.max_output_tokens = req.maxTokens;
    const effort = req.reasoningEffort ?? this.reasoningEffort;
    if (effort) body.reasoning = { effort };

    const res = await this.fetchImpl(`${this.baseUrl}/responses`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ProviderError(`LLM request failed (${res.status})`, {
        details: { httpStatus: res.status, body: text.slice(0, 500) },
        retryable: res.status === 429 || res.status >= 500,
      });
    }
    const data = (await res.json().catch(() => ({}))) as ResponsesResponse;
    // Collect only the model's output text (skip reasoning/refusal output items).
    const content = (data.output ?? [])
      .flatMap((o) => o.content ?? [])
      .filter((c) => c.type === "output_text")
      .map((c) => c.text ?? "")
      .join("");
    return {
      content,
      promptTokens: data.usage?.input_tokens ?? 0,
      completionTokens: data.usage?.output_tokens ?? 0,
      totalTokens: data.usage?.total_tokens ?? 0,
      model: data.model ?? this.model,
      latencyMs: Date.now() - started,
    };
  }

  private async generateChat(req: LLMRequest): Promise<LLMResponse> {
    const started = Date.now();
    const res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        messages: req.messages,
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        ...(req.responseFormat === "json_object" ? { response_format: { type: "json_object" } } : {}),
        ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ProviderError(`LLM request failed (${res.status})`, {
        details: { httpStatus: res.status, body: text.slice(0, 500) },
        retryable: res.status === 429 || res.status >= 500,
      });
    }
    const data = (await res.json().catch(() => ({}))) as ChatCompletionResponse;
    return {
      content: data.choices?.[0]?.message?.content ?? "",
      promptTokens: data.usage?.prompt_tokens ?? 0,
      completionTokens: data.usage?.completion_tokens ?? 0,
      totalTokens: data.usage?.total_tokens ?? 0,
      model: data.model ?? this.model,
      latencyMs: Date.now() - started,
    };
  }
}
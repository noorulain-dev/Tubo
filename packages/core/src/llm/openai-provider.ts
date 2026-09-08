import type { LLMProvider, LLMRequest, LLMResponse } from "../providers.js";
import { ProviderError } from "../errors.js";

export interface OpenAILLMProviderOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

interface ChatCompletionResponse {
  model?: string;
  choices?: { message?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

/**
 * OpenAI-compatible chat-completions client. Works with OpenAI directly or any
 * OpenAI-compatible endpoint (DeepSeek, etc.) by varying baseUrl/model.
 */
export class OpenAILLMProvider implements LLMProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: OpenAILLMProviderOptions) {
    this.apiKey = opts.apiKey;
    this.model = opts.model;
    this.baseUrl = (opts.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
    this.fetchImpl = opts.fetchImpl ?? ((url, init) => fetch(url, init));
  }

  async generate(req: LLMRequest): Promise<LLMResponse> {
    const started = Date.now();
    const res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: req.messages,
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        ...(req.responseFormat === "json_object" ? { response_format: { type: "json_object" } } : {}),
        ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new ProviderError(`LLM request failed (${res.status})`, {
        details: { httpStatus: res.status, body: body.slice(0, 500) },
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
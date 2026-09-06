import type { SemanticState } from "../semantic.js";
import type { LLMProvider } from "../providers.js";
import { buildInterpretPrompt } from "./prompt.js";
import { enforceRules, type RulesContext } from "./rules.js";
import { validateEvidence, validateSemanticState } from "./validate.js";
import type { InterpretInput, InterpretResult } from "./types.js";

export interface SemanticInterpreterOptions {
  /** Optional cost model to populate observability.costUsd. */
  cost?: { inputPerTokenUsd: number; outputPerTokenUsd: number };
  now?: () => number;
}

export class SemanticInterpreter {
  constructor(
    private readonly llm: LLMProvider,
    private readonly opts: SemanticInterpreterOptions = {},
  ) {}

  async interpret(input: InterpretInput): Promise<InterpretResult> {
    const now = this.opts.now ?? (() => Date.now());
    const startedAt = now();
    const interactionId = input.interactionId ?? `interaction_${startedAt}`;

    const { system, user } = buildInterpretPrompt(input);
    const response = await this.llm.generate({
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      responseFormat: "json_object",
    });

    const latencyMs = now() - startedAt;
    const errors: string[] = [];
    let schemaValid = false;
    let evidenceValid = true;
    let state: SemanticState | null = null;
    let corrections: string[] = [];

    try {
      const parsed = JSON.parse(response.content) as unknown;
      const validated = validateSemanticState(parsed, interactionId);
      schemaValid = true;

      const rulesCtx: RulesContext = {
        participants: input.participants,
        account: input.account,
      };
      const ruled = enforceRules(validated, rulesCtx);
      corrections = ruled.corrections;
      state = ruled.state;

      if (input.truncated) {
        state = { ...state, blockers: [...state.blockers, "interaction source is truncated"] };
      }

      const issues = validateEvidence(state, input.text);
      if (issues.length > 0) {
        evidenceValid = false;
        for (const issue of issues) {
          errors.push(`${issue.field}: ${issue.reason}${issue.text ? ` ("${issue.text}")` : ""}`);
        }
      }
    } catch (err) {
      errors.push(`schema validation failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    const observability = {
      model: response.model,
      latencyMs,
      inputTokens: response.promptTokens,
      outputTokens: response.completionTokens,
      schemaValid,
      evidenceValid,
      ...(this.opts.cost
        ? {
            costUsd:
              response.promptTokens * this.opts.cost.inputPerTokenUsd +
              response.completionTokens * this.opts.cost.outputPerTokenUsd,
          }
        : {}),
    };

    return {
      state,
      ok: state !== null && evidenceValid && errors.length === 0,
      errors,
      corrections,
      observability,
    };
  }
}

export type { InterpretInput, InterpretResult } from "./types.js";

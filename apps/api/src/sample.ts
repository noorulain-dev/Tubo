import {
  AuditService,
  Executor,
  MemoryAuditSink,
  SemanticInterpreter,
  type AgentReadContext,
  type LLMProvider,
} from "./core.js";
import { createApp } from "./app.js";
import { RunService } from "./pipeline.js";
import { FixedProviderResolver } from "./provider-resolver.js";
import { InMemoryRunStore } from "./store.js";
import {
  createCrmRead,
  createCrmWrite,
  createEmailRead,
  createEmailWrite,
  createFixtureLLM,
  createSampleCommercial,
  getSampleState,
  resetSampleData,
  type SampleState,
} from "./sample-fixtures.js";

export interface SampleWiring {
  app: ReturnType<typeof createApp>;
  service: RunService;
  state: SampleState;
  reset: () => void;
}

export function createSampleApp(opts: { llm?: LLMProvider } = {}): SampleWiring {
  const state = getSampleState();
  const llm = opts.llm ?? createFixtureLLM();
  const commercial = createSampleCommercial();

  const readContext: AgentReadContext = {
    crm: createCrmRead(state),
    email: createEmailRead(state),
    commercial,
  };
  const interpreter = new SemanticInterpreter(llm);
  const audit = new AuditService(new MemoryAuditSink());
  const executor = new Executor(createCrmWrite(state), createEmailWrite(state), { audit });

  const resolver = new FixedProviderResolver({ readContext, executor });
  const store = new InMemoryRunStore();
  const service = new RunService({ interpreter, resolver, store, mode: "sample" });
  const app = createApp({ sampleService: service, mode: "sample", reset: resetSampleData });

  return { app, service, state, reset: resetSampleData };
}

export { resetSampleData };

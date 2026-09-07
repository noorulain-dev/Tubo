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

export function createSampleApp(opts: { llm?: LLMProvider; authToken?: string } = {}): SampleWiring {
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
  const service = new RunService({ interpreter, readContext, executor, audit, mode: "sample" });
  const app = createApp({ sampleService: service, authToken: opts.authToken, mode: "sample", reset: resetSampleData });

  return { app, service, state, reset: resetSampleData };
}

export { resetSampleData };

import { describe, expect, it } from "vitest";
import type {
  AgentReadContext,
  CommercialStateReadProvider,
  CRMReadProvider,
  CRMWriteProvider,
  EmailReadProvider,
  EmailWriteProvider,
} from "../index.js";

const readOnlyCrm: CRMReadProvider = {
  resolveAccount: async () => [],
  getContacts: async () => [],
  getOpenDeal: async () => null,
  getDeal: async () => null,
  getRecentNotes: async () => [],
  getOpenTasks: async () => [],
  checkExistingAction: async () => null,
};

const writeOnlyCrm: CRMWriteProvider = {
  createNote: async () => ({ externalRef: "n1" }),
  createTask: async () => ({ externalRef: "t1" }),
  updateField: async () => ({ externalRef: "f1" }),
  updateStage: async () => ({ externalRef: "s1" }),
};

const emailWrite: EmailWriteProvider = {
  createDraft: async () => ({ externalRef: "d1" }),
};

const emailRead: EmailReadProvider = {
  getThread: async () => null,
  getMessage: async () => null,
  hasOutboundCommunication: async () => false,
  getDrafts: async () => [],
};

const commercialRead: CommercialStateReadProvider = {
  getCommercialState: async () => ({
    accountId: "a",
    trial: null,
    subscription: null,
    commercialException: null,
    provenance: "test",
  }),
  getTrialState: async () => null,
  getSubscriptionState: async () => null,
  getCustomerActivity: async () => null,
  getCommercialException: async () => null,
};

describe("provider boundaries", () => {
  it("read CRM provider exposes no write methods", () => {
    expect("createTask" in readOnlyCrm).toBe(false);
    expect("updateStage" in readOnlyCrm).toBe(false);
    expect("createNote" in readOnlyCrm).toBe(false);
  });

  it("write CRM provider exposes no read methods", () => {
    expect("getContacts" in writeOnlyCrm).toBe(false);
    expect("getOpenDeal" in writeOnlyCrm).toBe(false);
  });

  it("email write provider is draft-only (no send)", () => {
    expect("createDraft" in emailWrite).toBe(true);
    expect("send" in emailWrite).toBe(false);
  });

  it("email read provider exposes no write methods", () => {
    expect("createDraft" in emailRead).toBe(false);
    expect("send" in emailRead).toBe(false);
  });

  it("commercial read provider has no write methods", () => {
    expect("createTask" in commercialRead).toBe(false);
    expect("updateStage" in commercialRead).toBe(false);
  });

  it("agent read context only bundles read providers", () => {
    const ctx: AgentReadContext = {
      crm: readOnlyCrm,
      email: emailRead,
      commercial: commercialRead,
    };
    expect("createTask" in ctx.crm).toBe(false);
    expect("createDraft" in ctx.email).toBe(false);
    expect(ctx.email.getThread).toBeTypeOf("function");
    expect(ctx.commercial.getCommercialState).toBeTypeOf("function");
  });
});

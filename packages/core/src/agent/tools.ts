import { z } from "zod";
import type { AuthorityLevel, SourceType } from "../enums.js";
import type { AgentReadContext, TaskSignature } from "../providers.js";
import { CommercialStateSchema } from "../commercial.js";

export interface ToolDefinition {
  name: string;
  description: string;
  /** Validated before the handler runs. */
  argsSchema: z.ZodTypeAny;
  /** Optional result validation (safety net). */
  resultSchema?: z.ZodTypeAny;
  /** Read-only source/authority tagging for observability + reconciliation. */
  source?: SourceType;
  authority?: AuthorityLevel;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (args: any, ctx: AgentReadContext) => Promise<unknown>;
}

/**
 * The default read-only tool registry. The reasoning agent can call ONLY these
 * tools. There are deliberately no mutation tools (no create/update/send).
 */
export function buildDefaultTools(): ToolDefinition[] {
  return [
    {
      name: "resolve_account",
      description: "Resolve a company/account by name or domain.",
      argsSchema: z.object({ query: z.string() }),
      source: "hubspot",
      authority: "authoritative",
      handler: (a, ctx) => ctx.crm.resolveAccount(a.query),
    },
    {
      name: "get_account_context",
      description: "Bundle of contacts, open deal, and recent notes for an account.",
      argsSchema: z.object({ accountId: z.string() }),
      source: "hubspot",
      authority: "authoritative",
      handler: async (a, ctx) => ({
        contacts: await ctx.crm.getContacts(a.accountId),
        openDeal: await ctx.crm.getOpenDeal(a.accountId),
        notes: await ctx.crm.getRecentNotes(a.accountId),
      }),
    },
    {
      name: "get_contacts",
      description: "Retrieve contacts associated with an account.",
      argsSchema: z.object({ accountId: z.string() }),
      source: "hubspot",
      authority: "authoritative",
      handler: (a, ctx) => ctx.crm.getContacts(a.accountId),
    },
    {
      name: "get_open_deal",
      description: "Retrieve the current open deal for an account.",
      argsSchema: z.object({ accountId: z.string() }),
      source: "hubspot",
      authority: "authoritative",
      handler: (a, ctx) => ctx.crm.getOpenDeal(a.accountId),
    },
    {
      name: "get_recent_notes",
      description: "Retrieve recent notes for an account.",
      argsSchema: z.object({ accountId: z.string() }),
      source: "hubspot",
      authority: "authoritative",
      handler: (a, ctx) => ctx.crm.getRecentNotes(a.accountId),
    },
    {
      name: "get_open_tasks",
      description: "Retrieve open tasks for an account.",
      argsSchema: z.object({ accountId: z.string() }),
      source: "tasks",
      authority: "authoritative",
      handler: (a, ctx) => ctx.crm.getOpenTasks(a.accountId),
    },
    {
      name: "get_email_thread",
      description: "Retrieve a Gmail thread by id.",
      argsSchema: z.object({ threadId: z.string() }),
      source: "gmail",
      authority: "authoritative",
      handler: (a, ctx) => ctx.email.getThread(a.threadId),
    },
    {
      name: "get_outbound_communication",
      description: "Check whether outbound communication has been sent for an account (verifies sent/paid/delivered claims against the authoritative email source).",
      argsSchema: z.object({ accountId: z.string() }),
      source: "gmail",
      authority: "authoritative",
      handler: (a, ctx) => ctx.email.hasOutboundCommunication(a.accountId),
    },
    {
      name: "check_existing_action",
      description: "Check whether an equivalent task already exists.",
      argsSchema: z.object({
        accountId: z.string(),
        signature: z.record(z.unknown()).optional(),
      }),
      source: "tasks",
      authority: "authoritative",
      handler: (a, ctx) =>
        ctx.crm.checkExistingAction(a.accountId, (a.signature ?? {}) as TaskSignature),
    },
    {
      name: "get_commercial_state",
      description: "Retrieve authoritative commercial/subscription state for an account.",
      argsSchema: z.object({ accountId: z.string() }),
      resultSchema: CommercialStateSchema,
      source: "commercial",
      authority: "authoritative",
      handler: (a, ctx) => ctx.commercial.getCommercialState(a.accountId),
    },
    {
      name: "get_customer_activity",
      description: "Retrieve customer activity for an account.",
      argsSchema: z.object({ accountId: z.string() }),
      source: "commercial",
      authority: "authoritative",
      handler: (a, ctx) => ctx.commercial.getCustomerActivity(a.accountId),
    },
    {
      name: "get_commercial_exception",
      description: "Retrieve any approved commercial exception for an account.",
      argsSchema: z.object({ accountId: z.string() }),
      source: "commercial",
      authority: "authoritative",
      handler: (a, ctx) => ctx.commercial.getCommercialException(a.accountId),
    },
  ];
}

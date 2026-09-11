import type { Account } from "../domain.js";
import { AuditService, NoopAuditSink } from "../audit-service.js";
import { InMemoryIdempotencyStore, type IdempotencyStore } from "../idempotency.js";
import type {
  ContactRecord,
  CreateTaskInput,
  CRMProvider,
  DealRecord,
  NoteRecord,
  TaskRecord,
  TaskSignature,
} from "../providers.js";
import { HubSpotHttpClient, isNotFoundError, type HubSpotClientOptions } from "./hubspot-client.js";
import {
  normalizeCompany,
  normalizeContact,
  normalizeDeal,
  normalizeNote,
  normalizeTask,
  type RawHubSpotObject,
} from "./normalize.js";

export interface HubSpotCRMProviderOptions {
  audit?: AuditService;
  idempotency?: IdempotencyStore;
}

const DEAL_PROPERTIES = ["dealname", "dealstage", "amount", "hubspot_owner_id", "closedate", "nextstep"];
const CONTACT_PROPERTIES = ["email", "firstname", "lastname", "lifecyclestage", "associatedcompanyid"];
const TASK_PROPERTIES = ["hs_task_subject", "hs_task_type", "hs_task_status", "hs_timestamp", "hubspot_owner_id"];
const NOTE_PROPERTIES = ["hs_note_body", "hs_timestamp"];
const COMPANY_PROPERTIES = ["name", "domain"];
const CLOSED_STAGES = new Set(["closedwon", "closedlost"]);

/**
 * HubSpot CRM provider implementing both CRMReadProvider and CRMWriteProvider.
 * The write methods exist only to be handed to the deterministic executor; the
 * reasoning agent receives a CRMReadProvider reference and can never call them.
 */
export class HubSpotCRMProvider implements CRMProvider {
  private readonly audit: AuditService;
  private readonly idempotency: IdempotencyStore;

  constructor(private readonly client: HubSpotHttpClient, opts: HubSpotCRMProviderOptions = {}) {
    this.audit = opts.audit ?? new AuditService(new NoopAuditSink());
    this.idempotency = opts.idempotency ?? new InMemoryIdempotencyStore();
  }

  // -------------------------------------------------------------------------
  // READ operations
  // -------------------------------------------------------------------------

  async resolveAccount(query: string): Promise<Account[]> {
    this.audit.emit({ eventType: "crm.read", payload: { method: "resolveAccount", query } });
    const raw = await this.client.searchAll("/crm/v3/objects/companies/search", {
      filterGroups: [
        { filters: [{ propertyName: "name", operator: "CONTAINS_TOKEN", value: query }] },
      ],
      properties: COMPANY_PROPERTIES,
      limit: 100,
    });
    return (raw as RawHubSpotObject[])
      .filter((r) => !r.archived)
      .map(normalizeCompany);
  }

  async listCompanies(): Promise<Account[]> {
    this.audit.emit({ eventType: "crm.read", payload: { method: "listCompanies" } });
    const raw = await this.client.searchAll("/crm/v3/objects/companies/search", {
      filterGroups: [],
      properties: COMPANY_PROPERTIES,
      limit: 100,
    });
    return (raw as RawHubSpotObject[])
      .filter((r) => !r.archived)
      .map(normalizeCompany);
  }

  async getContacts(accountId: string): Promise<ContactRecord[]> {
    this.audit.emit({ eventType: "crm.read", payload: { method: "getContacts", accountId } });
    const raw = await this.client.searchAll("/crm/v3/objects/contacts/search", {
      filterGroups: [
        { filters: [{ propertyName: "associatedcompanyid", operator: "EQ", value: accountId }] },
      ],
      properties: CONTACT_PROPERTIES,
      limit: 100,
    });
    return (raw as RawHubSpotObject[])
      .filter((r) => !r.archived)
      .map((r) => ({ ...normalizeContact(r), accountId }));
  }

  async getOpenDeal(accountId: string): Promise<DealRecord | null> {
    this.audit.emit({ eventType: "crm.read", payload: { method: "getOpenDeal", accountId } });
    const raw = await this.client.searchAll("/crm/v3/objects/deals/search", {
      filterGroups: [
        { filters: [{ propertyName: "associations.company", operator: "EQ", value: accountId }] },
      ],
      properties: DEAL_PROPERTIES,
      limit: 100,
    });
    const open = (raw as RawHubSpotObject[]).find(
      (r) => !r.archived && !CLOSED_STAGES.has((r.properties.dealstage ?? "").toLowerCase()),
    );
    return open ? { ...normalizeDeal(open), accountId } : null;
  }

  async getDeal(dealId: string): Promise<DealRecord | null> {
    this.audit.emit({ eventType: "crm.read", payload: { method: "getDeal", dealId } });
    try {
      const raw = await this.client.get(`/crm/v3/objects/deals/${dealId}`, {
        properties: DEAL_PROPERTIES.join(","),
      });
      return normalizeDeal(raw as RawHubSpotObject);
    } catch (err) {
      if (isNotFoundError(err)) return null;
      throw err;
    }
  }

  async getRecentNotes(accountId: string): Promise<NoteRecord[]> {
    this.audit.emit({ eventType: "crm.read", payload: { method: "getRecentNotes", accountId } });
    const raw = await this.client.searchAll("/crm/v3/objects/notes/search", {
      filterGroups: [
        { filters: [{ propertyName: "associations.company", operator: "EQ", value: accountId }] },
      ],
      properties: NOTE_PROPERTIES,
      limit: 100,
    });
    return (raw as RawHubSpotObject[])
      .filter((r) => !r.archived)
      .map((r) => ({ ...normalizeNote(r), accountId }));
  }

  async getOpenTasks(accountId: string): Promise<TaskRecord[]> {
    this.audit.emit({ eventType: "crm.read", payload: { method: "getOpenTasks", accountId } });
    const raw = await this.client.searchAll("/crm/v3/objects/tasks/search", {
      filterGroups: [
        { filters: [{ propertyName: "associations.company", operator: "EQ", value: accountId }] },
      ],
      properties: TASK_PROPERTIES,
      limit: 100,
    });
    return (raw as RawHubSpotObject[])
      .filter((r) => !r.archived)
      .map((r) => ({ ...normalizeTask(r), accountId }));
  }

  async checkExistingAction(accountId: string, signature: TaskSignature): Promise<TaskRecord | null> {
    this.audit.emit({ eventType: "crm.read", payload: { method: "checkExistingAction", accountId } });
    const tasks = await this.getOpenTasks(accountId);
    return tasks.find((t) => isEquivalent(t, signature)) ?? null;
  }

  // -------------------------------------------------------------------------
  // WRITE operations (consumed only by the deterministic executor)
  // -------------------------------------------------------------------------

  async createNote(accountId: string, body: string, idempotencyKey?: string): Promise<{ externalRef: string }> {
    const replay = idempotencyKey ? this.idempotency.get(idempotencyKey) : undefined;
    if (replay) {
      this.audit.emit({ eventType: "crm.write.idempotent_replay", payload: { method: "createNote", accountId } });
      return { externalRef: replay };
    }
    const res = (await this.client.post(
      "/crm/v3/objects/notes",
      { properties: { hs_note_body: body, hs_timestamp: new Date().toISOString() } },
      { idempotencyKey },
    )) as { id: string };
    if (idempotencyKey) this.idempotency.set(idempotencyKey, res.id);
    this.audit.emit({ eventType: "crm.write", payload: { method: "createNote", accountId, externalRef: res.id } });
    return { externalRef: res.id };
  }

  async createTask(input: CreateTaskInput, idempotencyKey?: string): Promise<{ externalRef: string }> {
    const replay = idempotencyKey ? this.idempotency.get(idempotencyKey) : undefined;
    if (replay) {
      this.audit.emit({ eventType: "crm.write.idempotent_replay", payload: { method: "createTask", accountId: input.accountId } });
      return { externalRef: replay };
    }
    const res = (await this.client.post(
      "/crm/v3/objects/tasks",
      {
        properties: {
          hs_task_subject: input.title,
          hs_task_type: input.type,
          // HubSpot requires a due date on tasks; default to 7 days out when the
          // interaction did not resolve an explicit deadline.
          hs_timestamp: input.dueDate ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          hubspot_owner_id: input.ownerId ?? undefined,
        },
      },
      { idempotencyKey },
    )) as { id: string };
    if (idempotencyKey) this.idempotency.set(idempotencyKey, res.id);
    this.audit.emit({ eventType: "crm.write", payload: { method: "createTask", accountId: input.accountId, externalRef: res.id } });
    return { externalRef: res.id };
  }

  async updateField(
    accountId: string,
    objectType: string,
    field: string,
    value: unknown,
  ): Promise<{ externalRef: string }> {
    const res = (await this.client.patch(`/crm/v3/objects/${objectType}/${accountId}`, {
      properties: { [field]: value },
    })) as { id: string };
    this.audit.emit({ eventType: "crm.write", payload: { method: "updateField", accountId, objectType, field, externalRef: res.id } });
    return { externalRef: res.id };
  }

  async updateStage(dealId: string, stage: string): Promise<{ externalRef: string }> {
    const res = (await this.client.patch(`/crm/v3/objects/deals/${dealId}`, {
      properties: { dealstage: stage },
    })) as { id: string };
    this.audit.emit({ eventType: "crm.write", payload: { method: "updateStage", dealId, stage, externalRef: res.id } });
    return { externalRef: res.id };
  }
}

function normalizeTitle(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function isEquivalent(task: TaskRecord, sig: TaskSignature): boolean {
  if (sig.title && normalizeTitle(task.title) !== normalizeTitle(sig.title)) return false;
  if (sig.type && task.type.toLowerCase() !== sig.type.toLowerCase()) return false;
  if (sig.contactId != null && task.contactId !== sig.contactId) return false;
  if (sig.ownerId != null && task.ownerId !== sig.ownerId) return false;
  if (sig.dueDate != null && task.dueDate !== sig.dueDate) return false;
  return true;
}

export interface CreateHubSpotCRMProviderOptions extends Omit<HubSpotClientOptions, "audit"> {
  audit?: AuditService;
  idempotency?: IdempotencyStore;
}

export function createHubSpotCRMProvider(options: CreateHubSpotCRMProviderOptions): HubSpotCRMProvider {
  const { audit, idempotency, ...clientOptions } = options;
  const client = new HubSpotHttpClient({ ...clientOptions, audit });
  return new HubSpotCRMProvider(client, { audit, idempotency });
}

import type { Account } from "../domain.js";
import type {
  ContactRecord,
  DealRecord,
  NoteRecord,
  TaskRecord,
} from "../providers.js";

/** Minimal raw HubSpot object shape (the part we normalize from). */
export interface RawHubSpotObject {
  id: string;
  properties: Record<string, string | null | undefined>;
  archived?: boolean;
}

function str(value: string | null | undefined): string {
  return value ?? "";
}

function nullable(value: string | null | undefined): string | null {
  return value == null || value === "" ? null : value;
}

export function normalizeCompany(raw: RawHubSpotObject): Account {
  return {
    id: raw.id,
    externalId: raw.id,
    domain: nullable(raw.properties.domain),
    name: str(raw.properties.name),
    source: "hubspot",
  };
}

export function normalizeContact(raw: RawHubSpotObject): ContactRecord {
  return {
    id: raw.id,
    externalId: raw.id,
    email: nullable(raw.properties.email),
    firstName: nullable(raw.properties.firstname),
    lastName: nullable(raw.properties.lastname),
    lifecycleStage: nullable(raw.properties.lifecyclestage),
  };
}

export function normalizeDeal(raw: RawHubSpotObject): DealRecord {
  const amount = raw.properties.amount;
  return {
    id: raw.id,
    externalId: raw.id,
    name: str(raw.properties.dealname),
    stage: str(raw.properties.dealstage),
    amount: amount != null && amount !== "" ? Number(amount) : null,
    ownerId: nullable(raw.properties.hubspot_owner_id),
    closeDate: nullable(raw.properties.closedate),
    nextStep: nullable(raw.properties.nextstep ?? raw.properties.next_step),
  };
}

export function normalizeTask(raw: RawHubSpotObject): TaskRecord {
  return {
    id: raw.id,
    externalId: raw.id,
    ownerId: nullable(raw.properties.hubspot_owner_id),
    title: str(raw.properties.hs_task_subject ?? raw.properties.subject),
    type: str(raw.properties.hs_task_type),
    status: str(raw.properties.hs_task_status),
    dueDate: nullable(raw.properties.hs_timestamp ?? raw.properties.due_date),
  };
}

export function normalizeNote(raw: RawHubSpotObject): NoteRecord {
  return {
    id: raw.id,
    externalId: raw.id,
    body: str(raw.properties.hs_note_body),
    createdAt: nullable(raw.properties.hs_timestamp),
  };
}

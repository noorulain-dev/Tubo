import { describe, expect, it } from "vitest";
import {
  AuthenticationError,
  PermissionError,
  ProviderError,
  HubSpotHttpClient,
  HubSpotCRMProvider,
  InMemoryIdempotencyStore,
  type CreateTaskInput,
  type FetchLike,
  type FetchResponse,
} from "../index.js";

function jsonRes(status: number, body: unknown, headers: Record<string, string> = {}): FetchResponse {
  return {
    status,
    headers: { get: (name: string) => headers[name] ?? headers[name.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function makeClient(fetchImpl: FetchLike): HubSpotHttpClient {
  return new HubSpotHttpClient({
    accessToken: "test-token",
    fetch: fetchImpl,
    sleep: async () => {},
    now: () => 0,
    maxRetries: 2,
  });
}

describe("HubSpotCRMProvider", () => {
  it("normalizes company, contacts, and open deal", async () => {
    const fetchImpl: FetchLike = async (url) => {
      if (url.includes("companies/search")) {
        return jsonRes(200, {
          results: [{ id: "co1", properties: { name: "Acme", domain: "acme.com" } }],
          paging: {},
        });
      }
      if (url.includes("contacts/search")) {
        return jsonRes(200, {
          results: [
            {
              id: "c1",
              properties: {
                email: "a@acme.com",
                firstname: "Ann",
                lastname: "Lee",
                lifecyclestage: "opportunity",
              },
            },
          ],
          paging: {},
        });
      }
      if (url.includes("deals/search")) {
        return jsonRes(200, {
          results: [
            {
              id: "d1",
              properties: {
                dealname: "Acme Expansion",
                dealstage: "Proposal",
                amount: "48000",
                hubspot_owner_id: "o1",
                closedate: null,
                nextstep: "send proposal",
              },
            },
          ],
          paging: {},
        });
      }
      return jsonRes(200, { results: [], paging: {} });
    };

    const provider = new HubSpotCRMProvider(makeClient(fetchImpl));
    const accounts = await provider.resolveAccount("Acme");
    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.name).toBe("Acme");
    expect(accounts[0]?.source).toBe("hubspot");

    const contacts = await provider.getContacts("co1");
    expect(contacts).toHaveLength(1);
    expect(contacts[0]?.email).toBe("a@acme.com");
    expect(contacts[0]?.accountId).toBe("co1");

    const deal = await provider.getOpenDeal("co1");
    expect(deal?.stage).toBe("Proposal");
    expect(deal?.amount).toBe(48000);
    expect(deal?.ownerId).toBe("o1");
    expect(deal?.nextStep).toBe("send proposal");
  });

  it("returns empty list when no company matches", async () => {
    const fetchImpl: FetchLike = async () => jsonRes(200, { results: [], paging: {} });
    const provider = new HubSpotCRMProvider(makeClient(fetchImpl));
    expect(await provider.resolveAccount("Nope")).toEqual([]);
  });

  it("returns multiple matching contacts", async () => {
    const fetchImpl: FetchLike = async (url) => {
      if (url.includes("contacts/search")) {
        return jsonRes(200, {
          results: [
            { id: "c1", properties: { email: "a@x.com" } },
            { id: "c2", properties: { email: "b@x.com" } },
          ],
          paging: {},
        });
      }
      return jsonRes(200, { results: [], paging: {} });
    };
    const provider = new HubSpotCRMProvider(makeClient(fetchImpl));
    expect(await provider.getContacts("co1")).toHaveLength(2);
  });

  it("returns null when no open deal exists", async () => {
    const fetchImpl: FetchLike = async (url) => {
      if (url.includes("deals/search")) {
        return jsonRes(200, {
          results: [{ id: "d1", properties: { dealname: "Closed", dealstage: "closedwon" } }],
          paging: {},
        });
      }
      return jsonRes(200, { results: [], paging: {} });
    };
    const provider = new HubSpotCRMProvider(makeClient(fetchImpl));
    expect(await provider.getOpenDeal("co1")).toBeNull();
  });

  it("detects an existing equivalent task", async () => {
    const fetchImpl: FetchLike = async (url) => {
      if (url.includes("tasks/search")) {
        return jsonRes(200, {
          results: [
            {
              id: "t1",
              properties: {
                hs_task_subject: "Send proposal",
                hs_task_type: "EMAIL",
                hs_task_status: "NOT_STARTED",
              },
            },
          ],
          paging: {},
        });
      }
      return jsonRes(200, { results: [], paging: {} });
    };
    const provider = new HubSpotCRMProvider(makeClient(fetchImpl));
    expect((await provider.checkExistingAction("co1", { title: "send proposal" }))?.id).toBe("t1");
    expect(await provider.checkExistingAction("co1", { title: "something else" })).toBeNull();
  });

  it("retries on 429 then succeeds", async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls++;
      if (calls === 1) return jsonRes(429, {}, { "retry-after": "0" });
      return jsonRes(200, { results: [], paging: {} });
    };
    const provider = new HubSpotCRMProvider(makeClient(fetchImpl));
    expect(await provider.resolveAccount("Acme")).toEqual([]);
    expect(calls).toBe(2);
  });

  it("gives up after bounded retries on persistent 500", async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls++;
      return jsonRes(500, {});
    };
    const provider = new HubSpotCRMProvider(makeClient(fetchImpl));
    await expect(provider.resolveAccount("Acme")).rejects.toBeInstanceOf(ProviderError);
    expect(calls).toBe(3);
  });

  it("does not retry on 403 and surfaces PermissionError", async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls++;
      return jsonRes(403, {});
    };
    const provider = new HubSpotCRMProvider(makeClient(fetchImpl));
    await expect(provider.resolveAccount("Acme")).rejects.toBeInstanceOf(PermissionError);
    expect(calls).toBe(1);
  });

  it("does not retry on 401 and surfaces AuthenticationError", async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls++;
      return jsonRes(401, {});
    };
    const provider = new HubSpotCRMProvider(makeClient(fetchImpl));
    await expect(provider.resolveAccount("Acme")).rejects.toBeInstanceOf(AuthenticationError);
    expect(calls).toBe(1);
  });

  it("does not duplicate a task write for the same idempotency key", async () => {
    let posts = 0;
    const fetchImpl: FetchLike = async () => {
      posts++;
      return jsonRes(201, { id: "task-1", properties: {} });
    };
    const provider = new HubSpotCRMProvider(makeClient(fetchImpl), {
      idempotency: new InMemoryIdempotencyStore(),
    });
    const input: CreateTaskInput = { accountId: "co1", title: "Follow up", type: "TODO" };
    const a = await provider.createTask(input, "key-1");
    const b = await provider.createTask(input, "key-1");
    expect(a.externalRef).toBe("task-1");
    expect(b.externalRef).toBe("task-1");
    expect(posts).toBe(1);
  });
});

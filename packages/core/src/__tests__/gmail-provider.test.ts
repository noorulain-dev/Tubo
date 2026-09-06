import { describe, expect, it } from "vitest";
import {
  GmailClient,
  GmailProvider,
  InMemoryIdempotencyStore,
  PermissionError,
  decodeBase64Url,
  normalizeMessage,
  normalizeThread,
  parseAddress,
  parseAddressList,
  type EmailReadProvider,
  type GmailFetch,
  type GmailResponse,
} from "../index.js";

function jsonRes(status: number, body: unknown, headers: Record<string, string> = {}): GmailResponse {
  return {
    status,
    headers: { get: (name: string) => headers[name] ?? headers[name.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function makeClient(fetchImpl: GmailFetch): GmailClient {
  return new GmailClient({
    accessToken: "test-token",
    fetch: fetchImpl,
    sleep: async () => {},
    now: () => 0,
    maxRetries: 2,
  });
}

const threadResponse = {
  id: "thread-1",
  messages: [
    {
      id: "m1",
      threadId: "thread-1",
      labelIds: ["SENT"],
      internalDate: "1690000000000",
      payload: {
        headers: [
          { name: "From", value: "Rep <rep@company.com>" },
          { name: "To", value: "Customer <cust@acme.com>" },
          { name: "Subject", value: "Proposal follow-up" },
        ],
        parts: [
          { mimeType: "text/plain", body: { data: Buffer.from("Hello there", "utf-8").toString("base64url") } },
        ],
      },
    },
  ],
};

describe("gmail normalization", () => {
  it("parses addresses from name<email> form", () => {
    expect(parseAddress("Jane <jane@acme.com>")).toBe("jane@acme.com");
    expect(parseAddress("jane@acme.com")).toBe("jane@acme.com");
  });

  it("parses recipient lists", () => {
    expect(parseAddressList("A <a@x.com>, b@y.com")).toEqual(["a@x.com", "b@y.com"]);
  });

  it("decodes base64url plain text", () => {
    const encoded = Buffer.from("Hello there", "utf-8").toString("base64url");
    expect(decodeBase64Url(encoded)).toBe("Hello there");
  });

  it("normalizes thread participants and message state", () => {
    const thread = normalizeThread(threadResponse as never);
    expect(thread.id).toBe("thread-1");
    expect(thread.subject).toBe("Proposal follow-up");
    expect(thread.participants).toEqual(["rep@company.com", "cust@acme.com"]);
    expect(thread.messages[0]?.state).toBe("sent");
    expect(thread.messages[0]?.body).toBe("Hello there");
  });
});

describe("GmailProvider", () => {
  it("reads a thread", async () => {
    const fetchImpl: GmailFetch = async () => jsonRes(200, threadResponse);
    const provider = new GmailProvider(makeClient(fetchImpl));
    const thread = await provider.getThread("thread-1");
    expect(thread?.subject).toBe("Proposal follow-up");
    expect(thread?.messages).toHaveLength(1);
  });

  it("returns null for a missing thread", async () => {
    const fetchImpl: GmailFetch = async () => jsonRes(404, {});
    const provider = new GmailProvider(makeClient(fetchImpl));
    expect(await provider.getThread("missing")).toBeNull();
  });

  it("surfaces permission failures", async () => {
    let calls = 0;
    const fetchImpl: GmailFetch = async () => {
      calls++;
      return jsonRes(403, {});
    };
    const provider = new GmailProvider(makeClient(fetchImpl));
    await expect(provider.getThread("thread-1")).rejects.toBeInstanceOf(PermissionError);
    expect(calls).toBe(1);
  });

  it("determines outbound communication exists", async () => {
    const fetchImpl: GmailFetch = async () => jsonRes(200, threadResponse);
    const provider = new GmailProvider(makeClient(fetchImpl));
    expect(await provider.hasOutboundCommunication("thread-1")).toBe(true);
  });

  it("creates a draft", async () => {
    const fetchImpl: GmailFetch = async () => jsonRes(200, { id: "draft-1" });
    const provider = new GmailProvider(makeClient(fetchImpl));
    const result = await provider.createDraft({
      to: ["cust@acme.com"],
      subject: "Proposal",
      body: "Hi",
    });
    expect(result.externalRef).toBe("draft-1");
  });

  it("avoids duplicate drafts with the same subject on a thread", async () => {
    let posts = 0;
    const draftThread = {
      id: "thread-2",
      messages: [
        {
          id: "draft-existing",
          threadId: "thread-2",
          labelIds: ["DRAFT"],
          payload: { headers: [{ name: "Subject", value: "Proposal" }] },
        },
      ],
    };
    const fetchImpl: GmailFetch = async (url, init) => {
      if (init.method === "POST") {
        posts++;
        return jsonRes(200, { id: "draft-new" });
      }
      return jsonRes(200, draftThread);
    };
    const provider = new GmailProvider(makeClient(fetchImpl), {
      idempotency: new InMemoryIdempotencyStore(),
    });
    const result = await provider.createDraft(
      { to: ["cust@acme.com"], subject: "proposal", body: "Hi", threadId: "thread-2" },
      "key-1",
    );
    expect(result.externalRef).toBe("draft-existing");
    expect(posts).toBe(0);
  });

  it("does not expose write operations on the read interface", () => {
    const readOnly: EmailReadProvider = {
      getThread: async () => null,
      getMessage: async () => null,
      hasOutboundCommunication: async () => false,
      getDrafts: async () => [],
    };
    expect("createDraft" in readOnly).toBe(false);
    expect("send" in readOnly).toBe(false);
    expect("sendEmail" in readOnly).toBe(false);
  });
});

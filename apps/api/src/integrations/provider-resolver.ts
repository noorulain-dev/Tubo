import {
  AuditService,
  Executor,
  GmailClient,
  GmailProvider,
  HubSpotCRMProvider,
  HubSpotCommercialContext,
  HubSpotHttpClient,
  loadConfig,
  type AgentReadContext,
  type CommercialStateReadProvider,
  type ContactRecord,
  type CreateDraftInput,
  type CreateTaskInput,
  type CRMReadProvider,
  type CRMWriteProvider,
  type DealRecord,
  type EmailReadProvider,
  type EmailWriteProvider,
  type NoteRecord,
  type TaskRecord,
  type TaskSignature,
  type Account,
  type EmailMessageRecord,
  type EmailThreadRecord,
} from "../shared/core.js";
import { getGmailRefreshToken, getHubspotAccessToken, markNeedsReauth } from "./connections.js";
import { exchangeGmailRefreshToken } from "./gmail-oauth.js";
import { createSampleCommercial } from "../shared/sample-fixtures.js";
import { PostgresAuditSink, PostgresExecutionStore } from "../runs/store-pg.js";

export interface ResolvedProviders {
  readContext: AgentReadContext;
  executor: Executor;
}

/**
 * Resolves the read context + executor for a given authenticated user. This is
 * the single seam future integrations (Google Calendar, Fireflies) plug into.
 */
export interface ProviderResolver {
  resolve(userId: string): Promise<ResolvedProviders>;
}

/** A resolver that always returns the same (e.g. sample/test) providers. */
export class FixedProviderResolver implements ProviderResolver {
  constructor(private readonly providers: ResolvedProviders) {}
  async resolve(_userId: string): Promise<ResolvedProviders> {
    return this.providers;
  }
}

/**
 * Caches a Gmail access token and refreshes it transparently when it nears
 * expiry, so a long-lived session never forces the user to re-authenticate.
 */
export class GmailTokenManager {
  private accessToken?: string;
  private expiresAtMs = 0;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly refreshToken: string,
  ) {}

  async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.accessToken && now < this.expiresAtMs - 60_000) {
      return this.accessToken;
    }
    const { accessToken, expiresIn } = await exchangeGmailRefreshToken({
      clientId: this.clientId,
      clientSecret: this.clientSecret,
      refreshToken: this.refreshToken,
    });
    this.accessToken = accessToken;
    this.expiresAtMs = now + expiresIn * 1000;
    return accessToken;
  }
}

/** A connection state for the current resolution. */
export interface ConnectionWarnings {
  gmailNeedsReauth?: boolean;
  hubspotMissing?: boolean;
  gmailMissing?: boolean;
}

/**
 * Resolves providers from the authenticated user's `connections` rows (HubSpot
 * access token, Gmail refresh token). An unconnected integration yields an
 * EMPTY provider (no fabricated data), never another user's credentials and
 * never a silent fallback to sample fixtures.
 */
export class LiveProviderResolver implements ProviderResolver {
  constructor(private readonly gmailOAuth: { clientId: string; clientSecret: string } | undefined) {}

  async resolve(userId: string): Promise<ResolvedProviders> {
    const audit = new AuditService(new PostgresAuditSink(userId));

    // HubSpot — prefer the user's own connection, fall back to the operator token.
    let hubspotClient: HubSpotHttpClient | undefined;
    let hubspot: HubSpotCRMProvider | undefined;
    const hubspotToken = (await getHubspotAccessToken(userId)) ?? loadConfig().hubspotAccessToken;
    if (hubspotToken) {
      hubspotClient = new HubSpotHttpClient({ accessToken: hubspotToken, audit });
      hubspot = new HubSpotCRMProvider(hubspotClient, { audit });
    }

    // Gmail (with refresh)
    let gmail: GmailProvider | undefined;
    const gmailRefresh = await getGmailRefreshToken(userId);
    if (gmailRefresh && this.gmailOAuth) {
      const manager = new GmailTokenManager(this.gmailOAuth.clientId, this.gmailOAuth.clientSecret, gmailRefresh);
      try {
        const accessToken = await manager.getAccessToken();
        gmail = new GmailProvider(new GmailClient({ accessToken, audit }), { audit });
      } catch (err) {
        // Distinguish revoked consent (needs reauthorization) from a temporary
        // Google outage (retry-safe). Only mark needs_reauth on 4xx.
        if (isReauthError(err)) {
          await markNeedsReauth(userId, "gmail");
        }
        // gmail stays undefined -> empty provider (no fabricated "no email").
      }
    }

    let commercial: CommercialStateReadProvider = createSampleCommercial();
    if (hubspotClient) {
      const hc = hubspotClient;
      commercial = new HubSpotCommercialContext({
        mapping: { objectType: "company", statusProperty: "revexec_billing_status" },
        readProperties: async (objectType, objectId, properties) => {
          const raw = (await hc.get(`/crm/v3/objects/${objectType}/${objectId}`, {
            properties: properties.join(","),
          })) as { properties?: Record<string, string | null | undefined> };
          return raw.properties ?? {};
        },
      });
    }

    const readContext: AgentReadContext = {
      crm: hubspot ?? emptyCrmRead(),
      email: gmail ?? emptyEmailRead(),
      commercial,
    };

    const executor = new Executor(
      hubspot ?? emptyCrmWrite(),
      gmail ?? emptyEmailWrite(),
      { audit, store: new PostgresExecutionStore(userId) },
    );

    return { readContext, executor };
  }
}

// ---------------------------------------------------------------------------
// Empty providers (return nothing; writes throw). Never fabricate data.
// ---------------------------------------------------------------------------

function isReauthError(err: unknown): boolean {
  const status = (err as { status?: number } | undefined)?.status;
  return status === 400 || status === 401;
}

function emptyCrmRead(): CRMReadProvider {
  return {
    async resolveAccount(): Promise<Account[]> {
      return [];
    },
    async getContacts(): Promise<ContactRecord[]> {
      return [];
    },
    async getOpenDeal(): Promise<DealRecord | null> {
      return null;
    },
    async getDeal(): Promise<DealRecord | null> {
      return null;
    },
    async getRecentNotes(): Promise<NoteRecord[]> {
      return [];
    },
    async getOpenTasks(): Promise<TaskRecord[]> {
      return [];
    },
    async checkExistingAction(): Promise<TaskRecord | null> {
      return null;
    },
  };
}

function emptyCrmWrite(): CRMWriteProvider {
  return {
    async createNote(): Promise<{ externalRef: string }> {
      throw new Error("HubSpot is not connected");
    },
    async createTask(_input: CreateTaskInput): Promise<{ externalRef: string }> {
      throw new Error("HubSpot is not connected");
    },
    async updateField(): Promise<{ externalRef: string }> {
      throw new Error("HubSpot is not connected");
    },
    async updateStage(): Promise<{ externalRef: string }> {
      throw new Error("HubSpot is not connected");
    },
  };
}

function emptyEmailRead(): EmailReadProvider {
  return {
    async getThread(): Promise<EmailThreadRecord | null> {
      return null;
    },
    async getMessage(): Promise<EmailMessageRecord | null> {
      return null;
    },
    async hasOutboundCommunication(): Promise<boolean> {
      return false;
    },
    async getDrafts(): Promise<EmailMessageRecord[]> {
      return [];
    },
  };
}

function emptyEmailWrite(): EmailWriteProvider {
  return {
    async createDraft(_input: CreateDraftInput): Promise<{ externalRef: string }> {
      throw new Error("Gmail is not connected");
    },
  };
}

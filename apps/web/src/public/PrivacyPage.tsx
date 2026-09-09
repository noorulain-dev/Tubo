import { PublicArticle } from "./PublicLayout";

export function PrivacyPage() {
  return (
    <PublicArticle title="Privacy" lead="What Tubo connects to, what it reads, and what it never shows.">
      <section>
        <h2>Integrations</h2>
        <p>
          Tubo can connect to Google Calendar, Gmail, HubSpot and Fireflies. Each connection is optional and is only used
          to read the operational context needed to reconcile an account.
        </p>
      </section>

      <section>
        <h2>User-authorised access</h2>
        <p>
          Google Calendar and Gmail access is granted by the user through Google OAuth and can be revoked at any time.
          Google OAuth for this project is currently limited to approved testing accounts.
        </p>
      </section>

      <section>
        <h2>Assessment data</h2>
        <p>
          This assessment environment runs on synthetic, test business data. Accounts, interactions and evaluation
          scenarios are generated for testing and do not represent real customers.
        </p>
      </section>

      <section>
        <h2>How integration data is used</h2>
        <p>
          Integration data is used to build reconciled account state: commitments, open questions, blockers, CRM
          alignment and execution gaps. It is not used for advertising or sold to third parties.
        </p>
      </section>

      <section>
        <h2>Credentials</h2>
        <p>
          Access tokens, API keys and secrets are never rendered in the interface. Connection screens show only whether a
          provider is connected and whether it needs re-authorisation.
        </p>
      </section>

      <section>
        <h2>Contact</h2>
        <p>
          For questions about this assessment environment or to request removal of a connected account, contact the
          project owner through the channel used to share this project.
        </p>
      </section>
    </PublicArticle>
  );
}

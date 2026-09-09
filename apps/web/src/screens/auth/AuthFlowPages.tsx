import { Link } from "react-router-dom";
import { MailCheck } from "lucide-react";
import { AuthShell } from "./AuthShell";
import { InfoNotice } from "../../components/States";

/**
 * Verification, forgot-password and reset-password screens.
 *
 * The current backend exposes sign-in and registration only. These screens are
 * built as real UI states but deliberately do not fake a server call that does
 * not exist — they explain the actual state instead.
 */

export function VerifyEmailPage() {
  return (
    <AuthShell
      emphasis
      title="Confirm your email address"
      lead="One quick step before Tubo can act on your accounts."
      footer={
        <span>
          Wrong address? <Link to="/signup">Sign up again</Link>
        </span>
      }
    >
      <div className="verify-visual" aria-hidden="true">
        <MailCheck size={34} />
      </div>
      <ol className="verify-steps">
        <li>Open the message Tubo sent to your inbox.</li>
        <li>Select the confirmation link inside it.</li>
        <li>You'll land back here, signed in and ready.</li>
      </ol>
      <InfoNotice>
        Email delivery is not enabled in this assessment environment, so accounts are usable immediately after sign-up.
      </InfoNotice>
      <Link className="btn btn-primary btn-block" to="/app/command-center">
        Continue to Tubo
      </Link>
    </AuthShell>
  );
}

export function ForgotPasswordPage() {
  return (
    <AuthShell
      title="Reset your password"
      lead="We'll help you back into your workspace."
      footer={
        <span>
          Remembered it? <Link to="/login">Sign in</Link>
        </span>
      }
    >
      <InfoNotice>
        Self-service password reset is not enabled in this environment. Contact the project owner to have your access
        restored.
      </InfoNotice>
      <Link className="btn btn-secondary btn-block" to="/login">
        Back to sign in
      </Link>
    </AuthShell>
  );
}

export function ResetPasswordPage() {
  return (
    <AuthShell
      title="Choose a new password"
      lead="Set a password you don't use anywhere else."
      footer={
        <span>
          <Link to="/login">Back to sign in</Link>
        </span>
      }
    >
      <InfoNotice>
        This reset link cannot be completed because password reset is not enabled in this environment.
      </InfoNotice>
      <Link className="btn btn-secondary btn-block" to="/login">
        Back to sign in
      </Link>
    </AuthShell>
  );
}

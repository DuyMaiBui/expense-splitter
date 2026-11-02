import { DEFAULT_FROM, readEmailEnv, type EmailEnv } from "./env";

/**
 * The email transport seam.
 *
 * The reset flow only ever calls `EmailSender#send`; WHICH provider delivers the message is
 * resolved by `getEmailSender` from the Worker's bindings. Swapping providers (or adding a
 * second one) means adding an implementation here, never touching lib/password-reset.ts or the
 * route handlers.
 *
 * Degraded state is deliberate and quiet: with no provider configured the returned sender logs
 * one warning and sends nothing. Throwing there would leak "email is configured" versus not on
 * the always-200 forgot-password response, so the flow simply never completes for that user.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface EmailSender {
  send(msg: EmailMessage): Promise<void>;
}

/** What `getEmailSender` decided, for a route that wants to log the degraded state once. */
export interface EmailSenderInfo {
  sender: EmailSender;
  /** Provider name when configured ("resend"), null when no provider is configured. */
  provider: string | null;
}

const RESEND_ENDPOINT = "https://api.resend.com/emails";
/** A hung provider must not hold the Worker open; the reset code is already stored either way. */
const SEND_TIMEOUT_MS = 10_000;

/** A sender that delivers nothing. Used when no provider is configured. */
export class NoOpEmailSender implements EmailSender {
  private warned = false;

  async send(msg: EmailMessage): Promise<void> {
    if (!this.warned) {
      this.warned = true;
      console.warn(
        "[email] no provider configured (EMAIL_PROVIDER/EMAIL_API_KEY): dropping message to",
        msg.to,
      );
    }
  }
}

/** Resend over `fetch` (workerd-safe; no SDK dependency). */
export class ResendEmailSender implements EmailSender {
  constructor(
    private readonly apiKey: string,
    private readonly from: string = DEFAULT_FROM,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(msg: EmailMessage): Promise<void> {
    const response = await this.fetchImpl(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: this.from,
        to: [msg.to],
        subject: msg.subject,
        text: msg.text,
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });

    if (!response.ok) {
      // The body may name the account or the address; log the status and a truncated body only.
      const detail = (await response.text().catch(() => "")).slice(0, 200);
      throw new Error(`Resend trả về HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
    }
  }
}

/**
 * The sender for this request.
 *
 * Configuration is all-or-nothing: a provider name without an API key (or vice versa) is treated
 * as unconfigured rather than as a half-built sender, so the caller never sees a request leave
 * for a provider it cannot authenticate with.
 */
export function getEmailSenderDetails(env: EmailEnv = readEmailEnv()): EmailSenderInfo {
  const provider = env.EMAIL_PROVIDER?.toLowerCase();

  if (provider === "resend" && env.EMAIL_API_KEY) {
    return {
      provider: "resend",
      sender: new ResendEmailSender(env.EMAIL_API_KEY, env.EMAIL_FROM ?? DEFAULT_FROM),
    };
  }

  return { provider: null, sender: new NoOpEmailSender() };
}

/** Convenience wrapper for callers that do not need the provider name. */
export function getEmailSender(env?: EmailEnv): EmailSender {
  return getEmailSenderDetails(env).sender;
}

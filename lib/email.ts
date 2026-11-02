import { DEFAULT_FROM, readEmailEnv, type EmailEnv } from "./env";

/**
 * The email transport seam.
 *
 * The reset flow only ever calls `EmailSender#send`; the sender is resolved by `getEmailSender`
 * from the Worker's environment. Resend is the provider: `RESEND_API_KEY` present means Resend,
 * absent means no delivery. Adding a second provider means adding an implementation here, never
 * touching lib/password-reset.ts or the route handlers.
 *
 * The key comes from a local `.env` in development and a Worker secret in production — never from
 * the vault, and nothing here looks one up.
 *
 * Degraded state is deliberate and quiet: with no key the returned sender logs one warning and
 * sends nothing. Throwing there would leak "email is configured" versus not on the always-200
 * forgot-password response, so the flow simply never completes for that user.
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
  /** Provider name when configured ("resend"), null when there is no API key. */
  provider: string | null;
}

const RESEND_ENDPOINT = "https://api.resend.com/emails";
/** A hung provider must not hold the Worker open; the reset code is already stored either way. */
const SEND_TIMEOUT_MS = 10_000;

/** A sender that delivers nothing. Used when `RESEND_API_KEY` is absent. */
export class NoOpEmailSender implements EmailSender {
  private warned = false;

  async send(msg: EmailMessage): Promise<void> {
    if (!this.warned) {
      this.warned = true;
      console.warn(
        "[email] RESEND_API_KEY is not set (add it to .env locally, as a Worker secret in production): dropping message to",
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
 * Resend is the only provider, so the presence of the key IS the configuration: there is no
 * provider name to set, and a blank key is "not configured" rather than a half-built sender.
 */
export function getEmailSenderDetails(env: EmailEnv = readEmailEnv()): EmailSenderInfo {
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.RESEND_FROM?.trim();

  if (apiKey) {
    return {
      provider: "resend",
      sender: new ResendEmailSender(apiKey, from || DEFAULT_FROM),
    };
  }

  return { provider: null, sender: new NoOpEmailSender() };
}

/** Convenience wrapper for callers that do not need the provider name. */
export function getEmailSender(env?: EmailEnv): EmailSender {
  return getEmailSenderDetails(env).sender;
}

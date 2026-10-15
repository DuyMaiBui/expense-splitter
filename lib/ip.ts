/**
 * Validates and normalises an IP address typed by an admin. Cloudflare reports the client
 * address in `cf-connecting-ip` as either dotted IPv4 or IPv6; anything else is not a ban target.
 */
export function normalizeIp(input: string): string | null {
  const text = input.trim().toLowerCase();

  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (v4) {
    return v4.slice(1).every((part) => Number(part) <= 255) ? text : null;
  }

  if (text.includes(":") && /^[0-9a-f:.]+$/.test(text)) {
    try {
      // The URL parser applies the full IPv6 grammar and canonicalises the result.
      return new URL(`http://[${text}]/`).hostname.slice(1, -1);
    } catch {
      return null;
    }
  }
  return null;
}

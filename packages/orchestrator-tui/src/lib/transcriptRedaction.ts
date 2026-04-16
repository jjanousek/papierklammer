import crypto from "node:crypto";

const SECRET_KEY_RE =
  /(api[-_]?key|access[-_]?token|auth(?:_?token)?|authorization|bearer|secret|passwd|password|credential|jwt|private[-_]?key|cookie|connectionstring)/i;
const REDACTION_SENTINEL_RE = /\[redacted [^\]]+\]/i;
const ENV_ASSIGNMENT_RE =
  /\b(export\s+)?([A-Za-z_][A-Za-z0-9_-]*)\s*=\s*("[^"\r\n]*"|'[^'\r\n]*'|`[^`\r\n]*`|[^\s\r\n]+)/g;
const KEY_VALUE_RE =
  /(["']?)([A-Za-z_][A-Za-z0-9_-]*)(\1)(\s*:\s*)("[^"\r\n]*"|'[^'\r\n]*'|`[^`\r\n]*`|[^\s,\r\n}]+)/g;
const AUTHORIZATION_BEARER_RE = /\b(Authorization\s*:\s*Bearer\s+)([A-Za-z0-9._~+/=-]{12,})/gi;
const BEARER_RE = /\b(Bearer\s+)([A-Za-z0-9._~+/=-]{12,})/gi;
const KNOWN_SECRET_VALUE_RE =
  /\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z-_]{20,}|ya29\.[0-9A-Za-z\-_]+)\b/g;
const JWT_VALUE_RE =
  /\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]{8,})?\b/g;

function sha256Prefix(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function isQuoted(value: string): value is `"${string}"` | `'${string}'` | `\`${string}\`` {
  const first = value[0];
  return (
    value.length >= 2
    && (first === "\"" || first === "'" || first === "`")
    && value[value.length - 1] === first
  );
}

function isAlreadyRedacted(value: string): boolean {
  return value === "***REDACTED***" || REDACTION_SENTINEL_RE.test(value);
}

function redactSecretValue(value: string, label = "redacted"): string {
  if (isAlreadyRedacted(value)) {
    return value;
  }

  return `[${label} len=${value.length} sha256=${sha256Prefix(value)}]`;
}

function redactPreservingQuotes(value: string, label = "redacted"): string {
  if (isQuoted(value)) {
    const quote = value[0];
    const inner = value.slice(1, -1);
    return `${quote}${redactSecretValue(inner, label)}${quote}`;
  }
  return redactSecretValue(value, label);
}

function maybeRedactAssignmentValue(key: string, value: string): string {
  if (!SECRET_KEY_RE.test(key)) {
    return value;
  }

  const innerValue = isQuoted(value) ? value.slice(1, -1) : value;
  if (/authorization/i.test(key) && /^Bearer$/i.test(innerValue)) {
    return value;
  }
  const authorizationBearerMatch = innerValue.match(/^Bearer\s+(.+)$/i);
  if (authorizationBearerMatch) {
    const redactedBearer = `Bearer ${redactSecretValue(authorizationBearerMatch[1] ?? "", "redacted credential")}`;
    if (isQuoted(value)) {
      const quote = value[0];
      return `${quote}${redactedBearer}${quote}`;
    }
    return redactedBearer;
  }

  return redactPreservingQuotes(value);
}

export function redactSecretLikeText(text: string): string {
  if (!text) {
    return text;
  }

  let redacted = text.replace(
    ENV_ASSIGNMENT_RE,
    (match, exportPrefix: string | undefined, key: string, value: string) => {
      const nextValue = maybeRedactAssignmentValue(key, value);
      if (nextValue === value) {
        return match;
      }
      return `${exportPrefix ?? ""}${key}=${nextValue}`;
    },
  );

  redacted = redacted.replace(
    KEY_VALUE_RE,
    (match, openingQuote: string, key: string, closingQuote: string, separator: string, value: string) => {
      const nextValue = maybeRedactAssignmentValue(key, value);
      if (nextValue === value) {
        return match;
      }
      return `${openingQuote}${key}${closingQuote}${separator}${nextValue}`;
    },
  );

  redacted = redacted.replace(
    AUTHORIZATION_BEARER_RE,
    (_match, prefix: string, token: string) => `${prefix}${redactSecretValue(token)}`,
  );

  redacted = redacted.replace(
    BEARER_RE,
    (_match, prefix: string, token: string) => `${prefix}${redactSecretValue(token)}`,
  );

  redacted = redacted.replace(KNOWN_SECRET_VALUE_RE, (value) => redactSecretValue(value, "redacted credential"));
  redacted = redacted.replace(JWT_VALUE_RE, (value) => redactSecretValue(value, "redacted credential"));

  return redacted;
}

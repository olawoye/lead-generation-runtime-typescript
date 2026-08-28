export interface CrmLeadLike {
  email?: string | null;
  primary_email?: string | null;
  work_email?: string | null;
  person_email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  name?: string | null;
  company_name?: string | null;
  company?: string | null;
  domain?: string | null;
  website?: string | null;
  phone?: string | null;
  mobile_phone?: string | null;
  job_title?: string | null;
  title?: string | null;
  [key: string]: unknown;
}

function normalizeText(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const text = String(value).trim();
  return text.length > 0 ? text : undefined;
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    hash ^= code;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function resolvePlaceholderEmailDomain(): string {
  const configured = normalizeText(process.env.PLACEHOLDER_EMAIL_DOMAIN);
  return configured && configured.includes('.') ? configured : 'no-email-domain.com';
}

export function normalizeLeadForCrm<T extends CrmLeadLike>(lead: T): T & {
  email: string;
  company_name?: string;
  first_name?: string;
  last_name?: string;
  name?: string;
  phone?: string;
  domain?: string;
} {
  const normalized = { ...lead } as T & {
    email: string;
    company_name?: string;
    first_name?: string;
    last_name?: string;
    name?: string;
    phone?: string;
    domain?: string;
  };

  const chosenEmail =
    normalizeText(lead.email) ??
    normalizeText(lead.primary_email) ??
    normalizeText(lead.work_email) ??
    normalizeText(lead.person_email);

  const placeholderDomain = resolvePlaceholderEmailDomain();
  const baseIdentifier = [
    normalizeText(lead.company_name) ?? normalizeText(lead.company) ?? normalizeText(lead.domain) ?? normalizeText(lead.website) ?? 'lead',
    normalizeText(lead.first_name) ?? '',
    normalizeText(lead.last_name) ?? '',
    normalizeText(lead.name) ?? '',
  ]
    .filter(Boolean)
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'lead';

  const fallbackEmail = `lead-${stableHash(baseIdentifier || JSON.stringify(lead))}@${placeholderDomain}`;

  normalized.email = chosenEmail ?? fallbackEmail;
  normalized.company_name = normalizeText(lead.company_name) ?? normalizeText(lead.company) ?? undefined;
  normalized.first_name = normalizeText(lead.first_name) ?? undefined;
  normalized.last_name = normalizeText(lead.last_name) ?? undefined;
  const fallbackName = [normalized.first_name, normalized.last_name].filter(Boolean).join(' ');
  normalized.name = normalizeText(lead.name) ?? (fallbackName || undefined);
  normalized.phone = normalizeText(lead.phone) ?? normalizeText(lead.mobile_phone) ?? undefined;
  normalized.domain = normalizeText(lead.domain) ?? normalizeText(lead.website) ?? undefined;

  return normalized;
}

export function buildCrmLeadPayload<T extends CrmLeadLike>(lead: T): T & {
  email: string;
  company_name?: string;
  first_name?: string;
  last_name?: string;
  name?: string;
  phone?: string;
  domain?: string;
  crm_sync_status?: 'placeholder_email';
} {
  const normalized = normalizeLeadForCrm(lead);

  return {
    ...normalized,
    crm_sync_status: normalized.email.includes('@') && normalized.email.includes(resolvePlaceholderEmailDomain()) ? 'placeholder_email' : undefined,
  };
}

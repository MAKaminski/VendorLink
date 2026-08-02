import { z } from 'zod';
import type { LlmClient } from '@vendorlink/core';
import { replyClassificationSchema, type ReplyClassification } from '@vendorlink/core/domain';

/**
 * Reply classification.
 *
 * Two layers, deterministic first. Auto-replies and bounce notifications are
 * identified by their headers and stock phrasing — that is a parser's job, and
 * routing an out-of-office to a model would be paying for an answer we can
 * read off the envelope.
 *
 * The model only sees replies a human actually wrote, and its answer feeds
 * `GlobalContactSignal`: an `approved` boosts the address for every tenant and
 * a `wrong_department` penalises it, so a wrong classification is not
 * cosmetic. That is why the deterministic layer takes precedence and why the
 * model must quote its evidence.
 */

export interface ReplyInput {
  readonly fromEmail: string;
  readonly subject: string;
  readonly bodyText: string;
  readonly headers?: Record<string, string>;
}

export interface ReplyClassificationResult {
  readonly classification: ReplyClassification;
  readonly confidence: number;
  readonly method: 'deterministic' | 'llm';
  readonly evidence: string | null;
  /** Anything the reply asked for, e.g. a portal URL or a missing document. */
  readonly extracted: Record<string, unknown>;
}

const AUTO_REPLY_HEADERS = [
  'auto-submitted',
  'x-autoreply',
  'x-autorespond',
  'x-auto-response-suppress',
];

const AUTO_REPLY_SUBJECT_RE =
  /^(?:re:\s*)?(?:out of (?:the )?office|automatic reply|auto(?:matic)?[- ]?response|away from|vacation|thank you for (?:your )?(?:email|contacting))/i;

const BOUNCE_RE =
  /(?:mail delivery (?:failed|subsystem)|undeliverable|delivery status notification|550[ -]|recipient (?:address )?rejected|user unknown|mailbox (?:is )?full)/i;

const UNSUBSCRIBE_RE =
  /(?:unsubscribe|remove me|stop (?:sending|contacting)|do not (?:contact|email)|take me off)/i;

// `wrong_department` deliberately has no deterministic rule. The phrasings
// overlap heavily with ordinary replies ("please contact us with any
// questions"), and a false positive applies a -40 penalty to a good address
// for every tenant. That case goes to the interpret layer.

/**
 * Deterministic pass. Returns null when the reply needs interpretation.
 */
export function classifyDeterministic(input: ReplyInput): ReplyClassificationResult | null {
  const headers = input.headers ?? {};
  const headerKeys = Object.keys(headers).map((k) => k.toLowerCase());

  for (const header of AUTO_REPLY_HEADERS) {
    if (headerKeys.includes(header) && headers[header]?.toLowerCase() !== 'no') {
      return {
        classification: 'auto_reply',
        confidence: 1,
        method: 'deterministic',
        evidence: `${header}: ${headers[header]}`,
        extracted: {},
      };
    }
  }

  if (AUTO_REPLY_SUBJECT_RE.test(input.subject)) {
    return {
      classification: 'auto_reply',
      confidence: 0.95,
      method: 'deterministic',
      evidence: input.subject,
      extracted: {},
    };
  }

  const bounceMatch = BOUNCE_RE.exec(`${input.subject}\n${input.bodyText}`);
  if (bounceMatch) {
    // Treated as `other` rather than `rejected`: a bounce is a delivery
    // failure, and conflating it with a PM saying no would poison the
    // approval metrics.
    return {
      classification: 'other',
      confidence: 0.9,
      method: 'deterministic',
      evidence: bounceMatch[0],
      extracted: { bounce: true },
    };
  }

  const unsubscribeMatch = UNSUBSCRIBE_RE.exec(input.bodyText);
  if (unsubscribeMatch) {
    return {
      classification: 'unsubscribe',
      confidence: 0.9,
      method: 'deterministic',
      evidence: unsubscribeMatch[0],
      extracted: {},
    };
  }

  return null;
}

const llmSchema = z.object({
  classification: replyClassificationSchema,
  confidence: z.number().min(0).max(1),
  evidence_quote: z.string().min(4),
  portal_url: z.string().nullable().optional(),
  requested_documents: z.array(z.string()).max(10).optional(),
  forwarded_to_email: z.string().nullable().optional(),
});

const JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['classification', 'confidence', 'evidence_quote'],
  properties: {
    classification: {
      type: 'string',
      enum: [
        'approved', 'more_info_needed', 'rejected', 'auto_reply',
        'wrong_department', 'unsubscribe', 'other',
      ],
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    evidence_quote: {
      type: 'string',
      description: 'A verbatim span from the reply body supporting the classification.',
    },
    portal_url: {
      type: ['string', 'null'],
      description: 'A vendor portal URL the reply directs us to, if any.',
    },
    requested_documents: {
      type: 'array',
      items: { type: 'string' },
      maxItems: 10,
      description: 'Documents the reply asks for, in its own words.',
    },
    forwarded_to_email: {
      type: ['string', 'null'],
      description: 'An address the reply redirects us to, if it names one.',
    },
  },
} as const;

const SYSTEM = `You classify replies received by a service contractor who applied to join a \
property management company's approved vendor pool.

Classifications:
- approved: the vendor has been added, or is told they are approved/set up.
- more_info_needed: additional documents, forms, portal registration or details are requested.
- rejected: the application is declined, or the pool is closed.
- wrong_department: the recipient says they are not the right contact.
- unsubscribe: they ask not to be contacted again.
- auto_reply: an out-of-office or automated acknowledgement.
- other: anything else, including delivery failure notices.

Return an evidence_quote copied verbatim from the reply. If the reply is ambiguous, choose \
'other' with low confidence rather than guessing — a wrong 'approved' misreports the vendor's \
status and a wrong 'wrong_department' penalises a good address for every other customer.`;

export async function classifyReply(
  input: ReplyInput,
  llm: LlmClient,
): Promise<ReplyClassificationResult> {
  const deterministic = classifyDeterministic(input);
  if (deterministic) return deterministic;

  const response = await llm.json({
    operation: 'email.classify_reply',
    system: SYSTEM,
    user: [
      `FROM: ${input.fromEmail}`,
      `SUBJECT: ${input.subject}`,
      '',
      'BODY:',
      input.bodyText.slice(0, 6000),
    ].join('\n'),
    jsonSchema: JSON_SCHEMA as unknown as Record<string, unknown>,
    parse: (raw) => llmSchema.parse(raw),
    maxTokens: 512,
  });

  const value = response.value;

  // Same guard as Engine #1's S4: an unquotable justification is not evidence.
  const quoteFound = normalize(input.bodyText).includes(normalize(value.evidence_quote));

  return {
    classification: quoteFound ? value.classification : 'other',
    confidence: quoteFound ? value.confidence : 0,
    method: 'llm',
    evidence: quoteFound ? value.evidence_quote : null,
    extracted: {
      ...(value.portal_url ? { portal_url: value.portal_url } : {}),
      ...(value.requested_documents?.length
        ? { requested_documents: value.requested_documents }
        : {}),
      ...(value.forwarded_to_email ? { forwarded_to_email: value.forwarded_to_email } : {}),
      ...(quoteFound ? {} : { quote_verification_failed: true }),
    },
  };
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * The cross-tenant signal a classification implies, or null when it says
 * nothing about the address's quality.
 */
export function signalForClassification(
  classification: ReplyClassification,
): 'confirmed' | 'wrong_department' | 'unsubscribe' | null {
  switch (classification) {
    case 'approved':
    case 'more_info_needed':
      // Both prove a human at the right desk read it — §5.3's boost case.
      return 'confirmed';
    case 'wrong_department':
      return 'wrong_department';
    case 'unsubscribe':
      return 'unsubscribe';
    default:
      return null;
  }
}

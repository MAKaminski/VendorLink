import type { CaptchaKind, PlatformSlug } from '@vendorlink/core/domain';

/**
 * Engine #2 types.
 *
 * The central object is `FormField` — everything the filler knows about one
 * input after label resolution. It is deliberately serializable: the whole
 * point of `form_schemas` is that the first tenant to hit a form pays the
 * discovery cost and every later tenant replays it.
 */

export type FieldType =
  | 'text'
  | 'email'
  | 'tel'
  | 'number'
  | 'url'
  | 'date'
  | 'textarea'
  | 'select'
  | 'radio'
  | 'checkbox'
  | 'file'
  | 'hidden'
  | 'unknown';

export interface FieldOption {
  readonly value: string;
  readonly label: string;
}

export interface FormField {
  /** CSS selector that uniquely identifies this control. */
  readonly selector: string;
  /** Best label we could resolve, from any of the five strategies. */
  readonly label: string;
  /** Where the label came from — useful when a mapping looks wrong. */
  readonly labelSource:
    | 'label_for'
    | 'aria_label'
    | 'wrapping_label'
    | 'placeholder'
    | 'preceding_text'
    | 'table_header'
    | 'name_attribute'
    | 'none';
  readonly name: string | null;
  readonly id: string | null;
  readonly type: FieldType;
  readonly required: boolean;
  readonly options: readonly FieldOption[];
  readonly maxLength: number | null;
  /** Canonical profile path, once mapped. */
  readonly mapsTo: string | null;
  readonly mapConfidence: number;
  readonly mappedBy: 'deterministic' | 'llm' | 'operator' | null;
  readonly notes: string | null;
}

export interface FormSchema {
  readonly url: string;
  readonly fields: readonly FormField[];
  /** Hash of the form's DOM shape; a mismatch retires this schema version. */
  readonly hash: string;
  readonly captchaKind: CaptchaKind;
  readonly platformSlug: PlatformSlug | null;
  readonly submitSelector: string | null;
  /** Multi-step wizards report how many steps were traversed. */
  readonly stepCount: number;
}

export interface FieldWrite {
  readonly selector: string;
  readonly label: string;
  /** Redaction marker for secrets, never the literal value. */
  readonly valueWritten: string;
  readonly sourceField: string | null;
  readonly confidence: number;
  readonly wasLlmMapped: boolean;
  readonly isRedacted: boolean;
}

export type SubmissionOutcome =
  | { kind: 'submitted'; confirmation: Confirmation | null }
  | { kind: 'needs_attention'; reason: AttentionReason; detail: string }
  | { kind: 'failed'; detail: string };

export type AttentionReason =
  | 'captcha_required'
  | 'account_required'
  | 'payment_required'
  | 'tos_restricted'
  | 'low_confidence_mapping'
  | 'unmapped_required_field'
  | 'form_not_found'
  | 'first_submission_approval';

export interface Confirmation {
  /** How we know it went through — §6.4's ordered evidence list. */
  readonly method: 'confirmation_number' | 'success_text' | 'url_transition' | 'inbound_email';
  readonly value: string;
  readonly screenshotKey: string | null;
}

/**
 * The §6.3 step-7 gate result.
 *
 * `confidence` is the minimum over *required* fields, because a form is only
 * as fillable as its worst mandatory field. An optional field we cannot map is
 * a shrug; a required one is a wrong submission.
 */
export interface GateDecision {
  readonly confidence: number;
  readonly proceed: boolean;
  readonly reason: AttentionReason | null;
  readonly detail: string;
  /** Required fields with no mapping — named, so the operator can fix them. */
  readonly unmappedRequired: readonly string[];
}

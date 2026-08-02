import { and, eq } from 'drizzle-orm';
import {
  computeCompleteness,
  decryptSecret,
  einLast4,
  encryptSecret,
  type VendorProfile,
} from '@vendorlink/core';
import {
  documents,
  vendorInsurance,
  vendorLicenses,
  vendorProfiles,
  vendorServiceAreas,
  vendorTrades,
  type VendorProfileRow,
} from '../schema/index';
import { TenantScopedRepository, TenantTableRepository } from './base';

/**
 * The vendor profile and everything hanging off it.
 *
 * Assembling the full `VendorProfile` here — rather than letting callers join
 * as they please — is what lets both engines take a single well-typed object,
 * and is where the EIN is decrypted exactly once, on request.
 */
export class VendorProfileRepository extends TenantScopedRepository {
  /**
   * Fetch the assembled profile.
   *
   * `includeSecrets` is false by default and must be opted into: the LLM
   * boundary in §10 forbids sending the EIN to a model, so the shape handed
   * around by default simply does not contain it.
   */
  async get(opts: { includeSecrets?: boolean } = {}): Promise<VendorProfile | null> {
    const [row] = await this.db
      .select()
      .from(vendorProfiles)
      .where(this.scoped(vendorProfiles))
      .limit(1);
    if (!row) return null;

    const [trades, areas, licenses, insurance, docs] = await Promise.all([
      this.db.select().from(vendorTrades).where(this.scoped(vendorTrades)),
      this.db.select().from(vendorServiceAreas).where(this.scoped(vendorServiceAreas)),
      this.db.select().from(vendorLicenses).where(this.scoped(vendorLicenses)),
      this.db.select().from(vendorInsurance).where(this.scoped(vendorInsurance)),
      this.db
        .select()
        .from(documents)
        .where(this.scoped(documents, eq(documents.isCurrent, true))),
    ]);

    return {
      id: row.id,
      tenant_id: row.tenantId,
      legal_name: row.legalName,
      dba: row.dba,
      entity_type: row.entityType,
      ein: opts.includeSecrets && row.einEncrypted ? decryptSecret(row.einEncrypted) : null,
      ein_last4: row.einLast4,
      duns: row.duns,
      website: row.website,
      year_founded: row.yearFounded,
      employee_count: row.employeeCount,
      primary_contact_name: row.primaryContactName,
      primary_contact_title: row.primaryContactTitle,
      primary_contact_email: row.primaryContactEmail,
      primary_contact_phone: row.primaryContactPhone,
      after_hours_phone: row.afterHoursPhone,
      dispatch_email: row.dispatchEmail,
      address_line1: row.addressLine1,
      address_line2: row.addressLine2,
      city: row.city,
      state: row.state,
      postal: row.postal,
      county: row.county,
      hours_of_operation: row.hoursOfOperation,
      offers_after_hours: row.offersAfterHours,
      after_hours_fee_cents: row.afterHoursFeeCents,
      hourly_rate_cents: row.hourlyRateCents,
      dispatch_fee_cents: row.dispatchFeeCents,
      trip_fee_cents: row.tripFeeCents,
      minimum_invoice_cents: row.minimumInvoiceCents,
      warranty_terms: row.warrantyTerms,
      payment_terms: row.paymentTerms,
      accepts_ach: row.acceptsAch,
      remit_to: row.remitTo ?? null,
      w9_signed_date: row.w9SignedDate,
      background_check_consent: row.backgroundCheckConsent,
      response_time_hours: row.responseTimeHours,
      capability_statement: row.capabilityStatement,
      completeness_score: row.completenessScore,
      trades: trades.map((t) => ({
        id: t.id,
        trade_slug: t.tradeSlug,
        naics_code: t.naicsCode ?? undefined,
        csi_code: t.csiCode ?? undefined,
        is_primary: t.isPrimary,
      })),
      service_areas: areas.map((a) => ({
        id: a.id,
        kind: a.kind,
        center_lat: a.centerLat,
        center_lng: a.centerLng,
        radius_miles: a.radiusMiles,
        zips: a.zips,
        counties: a.counties,
        states: a.states as VendorProfile['service_areas'][number]['states'],
      })),
      licenses: licenses.map((l) => ({
        id: l.id,
        license_type: l.licenseType,
        license_number: l.licenseNumber,
        issuing_state: l.issuingState,
        issuing_authority: l.issuingAuthority ?? undefined,
        issued_on: l.issuedOn,
        expires_on: l.expiresOn,
        document_id: l.documentId,
      })),
      insurance: insurance.map((i) => ({
        id: i.id,
        policy_type: i.policyType,
        carrier: i.carrier,
        naic_code: i.naicCode ?? undefined,
        policy_number: i.policyNumber,
        each_occurrence_cents: i.eachOccurrenceCents,
        aggregate_cents: i.aggregateCents,
        effective_on: i.effectiveOn,
        expires_on: i.expiresOn,
        additional_insured_text: i.additionalInsuredText,
        waiver_of_subrogation: i.waiverOfSubrogation,
        primary_and_noncontributory: i.primaryAndNoncontributory,
        document_id: i.documentId,
        agent_name: i.agentName,
        agent_email: i.agentEmail,
        agent_phone: i.agentPhone,
      })),
      documents: docs.map((d) => ({
        id: d.id,
        kind: d.kind,
        label: d.label,
        r2_key: d.r2Key,
        mime: d.mime,
        bytes: d.bytes,
        sha256: d.sha256,
        page_count: d.pageCount,
        expires_on: d.expiresOn,
        is_current: d.isCurrent,
      })),
    };
  }

  /** Create the profile row for a new tenant. */
  async create(legalName: string): Promise<VendorProfileRow> {
    const [row] = await this.db
      .insert(vendorProfiles)
      .values(this.withTenant(vendorProfiles, { legalName }))
      .returning();
    return row as VendorProfileRow;
  }

  /**
   * Apply a partial update, encrypting the EIN and recomputing completeness.
   * `version` is bumped on every write because the run idempotency key is
   * derived from it — editing the profile legitimately allows a re-send.
   */
  async update(
    patch: Partial<{
      legalName: string;
      dba: string | null;
      entityType: VendorProfileRow['entityType'];
      ein: string | null;
      website: string | null;
      yearFounded: number | null;
      employeeCount: number | null;
      primaryContactName: string | null;
      primaryContactTitle: string | null;
      primaryContactEmail: string | null;
      primaryContactPhone: string | null;
      afterHoursPhone: string | null;
      dispatchEmail: string | null;
      addressLine1: string | null;
      addressLine2: string | null;
      city: string | null;
      state: VendorProfileRow['state'];
      postal: string | null;
      county: string | null;
      hoursOfOperation: VendorProfileRow['hoursOfOperation'];
      offersAfterHours: boolean;
      afterHoursFeeCents: number | null;
      hourlyRateCents: number | null;
      dispatchFeeCents: number | null;
      tripFeeCents: number | null;
      minimumInvoiceCents: number | null;
      warrantyTerms: string | null;
      paymentTerms: string | null;
      acceptsAch: boolean;
      w9SignedDate: string | null;
      backgroundCheckConsent: boolean;
      responseTimeHours: number | null;
      capabilityStatement: string | null;
    }>,
  ): Promise<VendorProfileRow | null> {
    const { ein, ...rest } = patch;
    const values: Record<string, unknown> = { ...rest, updatedAt: new Date() };

    if (ein !== undefined) {
      // Store only the ciphertext plus the last four; the plaintext never
      // lands in a column, a log line, or an LLM prompt.
      values['einEncrypted'] = ein === null ? null : encryptSecret(ein);
      values['einLast4'] = ein === null ? null : einLast4(ein);
    }

    const [row] = await this.db
      .update(vendorProfiles)
      .set(values)
      .where(this.scoped(vendorProfiles))
      .returning();
    if (!row) return null;

    await this.refreshCompleteness();
    return row;
  }

  /** Recompute and persist the score after any change that could move it. */
  async refreshCompleteness(): Promise<number> {
    const profile = await this.get();
    if (!profile) return 0;
    const { score } = computeCompleteness(profile);
    await this.db
      .update(vendorProfiles)
      .set({ completenessScore: score })
      .where(this.scoped(vendorProfiles));
    return score;
  }

  async bumpVersion(): Promise<number> {
    const [row] = await this.db
      .select({ version: vendorProfiles.version })
      .from(vendorProfiles)
      .where(this.scoped(vendorProfiles))
      .limit(1);
    const next = (row?.version ?? 0) + 1;
    await this.db
      .update(vendorProfiles)
      .set({ version: next })
      .where(this.scoped(vendorProfiles));
    return next;
  }

  async currentVersion(): Promise<number> {
    const [row] = await this.db
      .select({ version: vendorProfiles.version })
      .from(vendorProfiles)
      .where(this.scoped(vendorProfiles))
      .limit(1);
    return row?.version ?? 1;
  }

  // ---- child collections -------------------------------------------------

  async setTrades(
    trades: Array<{ tradeSlug: string; isPrimary: boolean; naicsCode?: string }>,
  ): Promise<void> {
    await this.db.delete(vendorTrades).where(this.scoped(vendorTrades));
    if (trades.length === 0) return;
    await this.db.insert(vendorTrades).values(
      trades.map((t) =>
        this.withTenant(vendorTrades, {
          tradeSlug: t.tradeSlug as never,
          isPrimary: t.isPrimary,
          naicsCode: t.naicsCode ?? null,
        }),
      ),
    );
  }

  async addServiceArea(
    area: Omit<typeof vendorServiceAreas.$inferInsert, 'tenantId' | 'id'>,
  ): Promise<void> {
    await this.db.insert(vendorServiceAreas).values(this.withTenant(vendorServiceAreas, area));
  }

  async addLicense(
    license: Omit<typeof vendorLicenses.$inferInsert, 'tenantId' | 'id'>,
  ): Promise<void> {
    await this.db.insert(vendorLicenses).values(this.withTenant(vendorLicenses, license));
    await this.refreshCompleteness();
  }

  async addInsurance(
    policy: Omit<typeof vendorInsurance.$inferInsert, 'tenantId' | 'id'>,
  ): Promise<void> {
    await this.db.insert(vendorInsurance).values(this.withTenant(vendorInsurance, policy));
    await this.refreshCompleteness();
  }
}

/** Documents, with supersession handling so "current" means one row per kind. */
export class DocumentRepository extends TenantTableRepository<typeof documents> {
  protected readonly table = documents;

  async listByKind(kind: string, opts: { currentOnly?: boolean } = {}) {
    return this.db
      .select()
      .from(documents)
      .where(
        this.scoped(
          documents,
          eq(documents.kind, kind as never),
          opts.currentOnly === false ? undefined : eq(documents.isCurrent, true),
        ),
      );
  }

  async listCurrent() {
    return this.db
      .select()
      .from(documents)
      .where(this.scoped(documents, eq(documents.isCurrent, true)));
  }

  /**
   * Mark previous documents of the same kind superseded.
   *
   * An expired COI silently invalidates a vendor everywhere they have been
   * approved, so "which one is current" has to be unambiguous rather than
   * inferred from upload order.
   */
  async supersedePrevious(kind: string, newDocumentId: string): Promise<void> {
    await this.db
      .update(documents)
      .set({ isCurrent: false, supersededById: newDocumentId })
      .where(
        this.scoped(
          documents,
          and(eq(documents.kind, kind as never), eq(documents.isCurrent, true)),
        ),
      );
    // Re-mark the incoming document, which the blanket update above also hit.
    await this.db
      .update(documents)
      .set({ isCurrent: true, supersededById: null })
      .where(this.scoped(documents, eq(documents.id, newDocumentId)));
  }
}

import {
  centsToDisplayLimit,
  formatDate,
  POLICY_TYPE_LABELS,
  primaryTrade,
  serviceAreaSummary,
  summarizeTrades,
  tradeLabel,
  type VendorProfile,
} from '@vendorlink/core/domain';

/**
 * The packet email.
 *
 * §5.4 asks for a message that reads as though a human at the service company
 * wrote it. That rules out marketing layout: this is a plain business email
 * with a short table of credentials, because that is what the recipient — a
 * vendor coordinator working through an inbox — actually needs.
 *
 * Every claim in the body comes from the profile. Nothing is generated, so
 * there is nothing here that can be wrong in a way the vendor did not enter.
 */

export interface PacketContext {
  readonly profile: VendorProfile;
  readonly pmCompanyName: string;
  /** Physical address line required by CAN-SPAM. */
  readonly senderPostalAddress: string;
  readonly optOutUrl: string;
  /** Signed links for attachments that did not fit the size cap. */
  readonly overflowLinks?: ReadonlyArray<{ label: string; url: string }>;
  readonly trackingPixelUrl?: string;
}

export interface RenderedEmail {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

function insuranceLines(profile: VendorProfile): string[] {
  return profile.insurance
    .filter((policy) => (policy.each_occurrence_cents ?? 0) > 0 || (policy.aggregate_cents ?? 0) > 0)
    .map((policy) => {
      const label = POLICY_TYPE_LABELS[policy.policy_type];
      const parts: string[] = [];
      if (policy.each_occurrence_cents) {
        parts.push(`${centsToDisplayLimit(policy.each_occurrence_cents)} each occurrence`);
      }
      if (policy.aggregate_cents) {
        parts.push(`${centsToDisplayLimit(policy.aggregate_cents)} aggregate`);
      }
      const expiry = policy.expires_on ? `, expires ${formatDate(policy.expires_on, 'us')}` : '';
      return `${label}: ${parts.join(' / ')} (${policy.carrier}${expiry})`;
    });
}

function licenceLines(profile: VendorProfile): string[] {
  return profile.licenses.map((licence) => {
    const expiry = licence.expires_on ? `, expires ${formatDate(licence.expires_on, 'us')}` : '';
    return `${licence.license_type} — ${licence.license_number} (${licence.issuing_state}${expiry})`;
  });
}

function availabilityLine(profile: VendorProfile): string {
  const response = profile.response_time_hours
    ? `We respond to dispatch within ${profile.response_time_hours} hours.`
    : '';
  const afterHours = profile.offers_after_hours
    ? ` We cover after-hours and emergency calls${
        profile.after_hours_phone ? ` on ${profile.after_hours_phone}` : ''
      }.`
    : ' We do not currently offer after-hours coverage.';
  return `${response}${afterHours}`.trim();
}

export function renderSubject(profile: VendorProfile, _pmCompanyName: string): string {
  const trade = primaryTrade(profile);
  const tradeText = trade ? tradeLabel(trade.trade_slug) : summarizeTrades([]);
  return `Vendor application — ${profile.legal_name} (${tradeText}), ${serviceAreaSummary(profile)}`;
}

export function renderPacketEmail(context: PacketContext): RenderedEmail {
  const { profile, pmCompanyName } = context;

  const tradeNames = profile.trades.map((t) => tradeLabel(t.trade_slug));
  const insurance = insuranceLines(profile);
  const licences = licenceLines(profile);
  const contactName = profile.primary_contact_name ?? profile.legal_name;

  const greeting = `Hello ${pmCompanyName} team,`;
  const intro =
    `I'd like to be considered for ${pmCompanyName}'s approved vendor list. ` +
    `${profile.legal_name}${profile.dba ? ` (dba ${profile.dba})` : ''} is a ` +
    `${tradeNames.length > 0 ? tradeNames.join(', ').toLowerCase() : 'service'} contractor ` +
    `${profile.year_founded ? `established in ${profile.year_founded}, ` : ''}` +
    `serving ${serviceAreaSummary(profile)}.`;

  const sections: Array<{ heading: string; lines: string[] }> = [
    { heading: 'Trades', lines: tradeNames.length > 0 ? tradeNames : ['On request'] },
    { heading: 'Service area', lines: [serviceAreaSummary(profile)] },
  ];

  if (licences.length > 0) sections.push({ heading: 'Licences', lines: licences });
  if (insurance.length > 0) sections.push({ heading: 'Insurance', lines: insurance });

  sections.push({ heading: 'Availability', lines: [availabilityLine(profile)] });

  if (profile.w9_signed_date) {
    sections.push({
      heading: 'W-9',
      lines: [`Signed ${formatDate(profile.w9_signed_date, 'us')} and attached.`],
    });
  }

  const ask =
    'Everything you should need is attached. Please let me know if you use a vendor ' +
    'portal — I am happy to complete it directly.';

  const signature = [
    contactName,
    profile.primary_contact_title ?? null,
    profile.legal_name,
    profile.primary_contact_phone ?? null,
    profile.primary_contact_email ?? null,
    profile.website ?? null,
  ].filter((line): line is string => Boolean(line));

  // ---- plain text --------------------------------------------------------
  const textParts: string[] = [greeting, '', intro, ''];
  for (const section of sections) {
    textParts.push(`${section.heading}:`);
    for (const line of section.lines) textParts.push(`  - ${line}`);
    textParts.push('');
  }
  if (context.overflowLinks?.length) {
    textParts.push('Also available to download (links expire in 7 days):');
    for (const link of context.overflowLinks) textParts.push(`  - ${link.label}: ${link.url}`);
    textParts.push('');
  }
  textParts.push(ask, '', ...signature, '', '—', context.senderPostalAddress);
  textParts.push(
    `If you would prefer not to receive vendor applications from us, unsubscribe here: ${context.optOutUrl}`,
  );

  // ---- html --------------------------------------------------------------
  const htmlSections = sections
    .map(
      (section) => `
      <tr>
        <td style="padding:4px 16px 4px 0;vertical-align:top;color:#475569;white-space:nowrap;">
          ${escapeHtml(section.heading)}
        </td>
        <td style="padding:4px 0;color:#0f172a;">
          ${section.lines.map(escapeHtml).join('<br>')}
        </td>
      </tr>`,
    )
    .join('');

  const overflowHtml = context.overflowLinks?.length
    ? `<p style="margin:16px 0;color:#475569;">Also available to download (links expire in 7 days):<br>${context.overflowLinks
        .map((l) => `<a href="${escapeAttr(l.url)}">${escapeHtml(l.label)}</a>`)
        .join('<br>')}</p>`
    : '';

  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#ffffff;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#0f172a;">
  <p style="margin:0 0 16px;">${escapeHtml(greeting)}</p>
  <p style="margin:0 0 16px;">${escapeHtml(intro)}</p>
  <table cellpadding="0" cellspacing="0" style="margin:0 0 16px;border-collapse:collapse;">
    ${htmlSections}
  </table>
  ${overflowHtml}
  <p style="margin:0 0 16px;">${escapeHtml(ask)}</p>
  <p style="margin:0 0 16px;">${signature.map(escapeHtml).join('<br>')}</p>
  <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0 12px;">
  <p style="margin:0;font-size:12px;color:#94a3b8;">
    ${escapeHtml(context.senderPostalAddress)}<br>
    If you would prefer not to receive vendor applications from us,
    <a href="${escapeAttr(context.optOutUrl)}" style="color:#94a3b8;">unsubscribe</a>.
  </p>
  ${context.trackingPixelUrl ? `<img src="${escapeAttr(context.trackingPixelUrl)}" width="1" height="1" alt="" style="display:block;">` : ''}
</body></html>`;

  return {
    subject: renderSubject(profile, pmCompanyName),
    text: textParts.join('\n'),
    html,
  };
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(input: string): string {
  return escapeHtml(input).replace(/'/g, '&#39;');
}

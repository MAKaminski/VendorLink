'use server';

import { revalidatePath } from 'next/cache';
import {
  NodeDnsResolver,
  NodeHttpFetcher,
  AnthropicLlmClient,
  DisabledLlmClient,
  type LlmClient,
} from '@vendorlink/core';
import { DbContactStore, DirectoryRepository } from '@vendorlink/db';
import { resolveOnboardingContacts } from '@vendorlink/resolver';
import { apiContext, db } from '@/lib/context';

/**
 * Force a re-resolution (§8's `POST /api/pm-companies/:id/resolve`).
 *
 * Rate limited per company because this is our traffic against someone else's
 * site: §6.5's politeness rule applies to discovery just as much as to
 * submission.
 */
const RESOLVE_COOLDOWN_MS = 60_000;
const lastResolvedByCompany = new Map<string, number>();

export async function resolveNow(
  pmCompanyId: string,
): Promise<{ ok: true; contacts: number } | { error: string }> {
  const ctx = await apiContext();
  if (!ctx) return { error: 'Your session expired. Sign in again.' };

  const last = lastResolvedByCompany.get(pmCompanyId) ?? 0;
  const waited = Date.now() - last;
  if (waited < RESOLVE_COOLDOWN_MS) {
    return {
      error: `Just resolved. Try again in ${Math.ceil((RESOLVE_COOLDOWN_MS - waited) / 1000)}s.`,
    };
  }

  const directory = new DirectoryRepository(db());
  const company = await directory.findById(pmCompanyId);
  if (!company?.website) return { error: 'That company has no website on file to resolve.' };

  // The real Anthropic client only when a key is configured; otherwise the
  // deterministic rubric runs alone rather than the resolution failing.
  const llm: LlmClient = process.env.ANTHROPIC_API_KEY
    ? new AnthropicLlmClient()
    : new DisabledLlmClient();

  const profile = await ctx.repos.profile.get();
  const primaryTrade = profile?.trades.find((t) => t.is_primary)?.trade_slug;

  lastResolvedByCompany.set(pmCompanyId, Date.now());

  const result = await resolveOnboardingContacts(
    {
      pmCompanyId,
      website: company.website,
      ...(primaryTrade ? { trade: primaryTrade } : {}),
      ...(profile?.city ? { market: profile.city } : {}),
      cache: 'bypass',
    },
    {
      fetcher: new NodeHttpFetcher(),
      dns: new NodeDnsResolver(),
      llm,
      store: new DbContactStore(db()),
    },
    {
      useLlm: Boolean(process.env.ANTHROPIC_API_KEY),
      companyName: company.name,
    },
  );

  revalidatePath(`/pm/${pmCompanyId}`);
  revalidatePath(`/pm/${pmCompanyId}/trace`);
  return { ok: true, contacts: result.contacts.length };
}

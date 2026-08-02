import Link from 'next/link';
import { US_STATES } from '@vendorlink/core';
import { DirectoryRepository } from '@vendorlink/db';
import { db, requireContext } from '@/lib/context';
import { Badge, Card, CardHeader, EmptyState, Input, Select } from '@/components/ui';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 25;

export default async function DirectoryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; state?: string; minUnits?: string; page?: string }>;
}) {
  await requireContext();
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? '1', 10) || 1);
  const minUnits = params.minUnits ? Number.parseInt(params.minUnits, 10) : undefined;

  const directory = new DirectoryRepository(db());
  const { rows, total } = await directory.search({
    q: params.q,
    state: params.state,
    minUnits: Number.isFinite(minUnits) ? minUnits : undefined,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-ink">PM Directory</h1>
          <p className="text-sm text-ink-muted">
            {total.toLocaleString()} property management companies. Pick one and connect.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          {/* GET form so filters live in the URL and stay shareable. */}
          <form className="flex flex-wrap items-end gap-3" action="/directory">
            <div className="min-w-[220px] flex-1">
              <label htmlFor="q" className="mb-1.5 block text-xs font-medium text-ink">
                Search
              </label>
              <Input id="q" name="q" defaultValue={params.q ?? ''} placeholder="Company or domain" />
            </div>
            <div className="w-36">
              <label htmlFor="state" className="mb-1.5 block text-xs font-medium text-ink">
                State
              </label>
              <Select id="state" name="state" defaultValue={params.state ?? ''}>
                <option value="">Any</option>
                {US_STATES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </div>
            <div className="w-40">
              <label htmlFor="minUnits" className="mb-1.5 block text-xs font-medium text-ink">
                Min. units
              </label>
              <Select id="minUnits" name="minUnits" defaultValue={params.minUnits ?? ''}>
                <option value="">Any</option>
                <option value="200">200+</option>
                <option value="1000">1,000+</option>
                <option value="5000">5,000+</option>
                <option value="10000">10,000+</option>
              </Select>
            </div>
            <button
              type="submit"
              className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover"
            >
              Filter
            </button>
            {(params.q || params.state || params.minUnits) && (
              <Link href="/directory" className="px-2 py-2 text-sm text-ink-muted hover:text-ink">
                Clear
              </Link>
            )}
          </form>
        </CardHeader>

        {rows.length === 0 ? (
          <EmptyState
            title="No companies match those filters"
            body="Try widening the search, or add a property manager by URL to bring them into the directory."
          />
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-subtle">
              <tr>
                <th className="px-5 py-2 font-medium">Company</th>
                <th className="px-5 py-2 font-medium">Market</th>
                <th className="px-5 py-2 font-medium text-right">Units</th>
                <th className="px-5 py-2 font-medium">Portfolio</th>
                <th className="px-5 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((company) => (
                <tr key={company.id} className="hover:bg-surface-sunken">
                  <td className="px-5 py-3">
                    <Link
                      href={`/pm/${company.id}`}
                      className="font-medium text-ink hover:text-brand"
                    >
                      {company.name}
                    </Link>
                    <p className="text-xs text-ink-subtle">{company.domain}</p>
                  </td>
                  <td className="px-5 py-3 text-ink-muted">
                    {company.hqCity}
                    {company.hqState ? `, ${company.hqState}` : ''}
                  </td>
                  <td className="px-5 py-3 text-right text-ink-muted">
                    {company.portfolioUnits?.toLocaleString() ?? '—'}
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex flex-wrap gap-1">
                      {company.portfolioType.slice(0, 2).map((type) => (
                        <Badge key={type}>{type.replace(/_/g, ' ')}</Badge>
                      ))}
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    {company.crawlStatus === 'pending' ? (
                      <Badge>Not yet resolved</Badge>
                    ) : (
                      <Badge tone="ok">Resolved</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {pageCount > 1 && (
        <nav className="flex items-center justify-between text-sm">
          <PageLink params={params} page={page - 1} disabled={page <= 1}>
            ← Previous
          </PageLink>
          <span className="text-ink-muted">
            Page {page} of {pageCount}
          </span>
          <PageLink params={params} page={page + 1} disabled={page >= pageCount}>
            Next →
          </PageLink>
        </nav>
      )}
    </div>
  );
}

function PageLink({
  params,
  page,
  disabled,
  children,
}: {
  params: Record<string, string | undefined>;
  page: number;
  disabled: boolean;
  children: React.ReactNode;
}) {
  if (disabled) return <span className="text-ink-subtle">{children}</span>;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value && key !== 'page') query.set(key, value);
  }
  query.set('page', String(page));
  return (
    <Link href={`/directory?${query.toString()}`} className="text-brand hover:underline">
      {children}
    </Link>
  );
}

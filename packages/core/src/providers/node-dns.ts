import { promises as dns } from 'node:dns';
import type { DnsResolver, MxRecord } from './types';

/**
 * DNS over the platform resolver, used by Engine #1's S5 verification step and
 * by the sending-domain health widget.
 *
 * A lookup failure returns an empty array rather than throwing: "no MX" is a
 * scoring signal (−60), not an error condition, and the caller records it in
 * the trace either way. Results are memoized per instance because a single
 * resolution run checks the same domain repeatedly.
 */
export class NodeDnsResolver implements DnsResolver {
  private readonly mxCache = new Map<string, MxRecord[]>();
  private readonly txtCache = new Map<string, string[]>();

  async resolveMx(domain: string): Promise<MxRecord[]> {
    const key = domain.toLowerCase();
    const cached = this.mxCache.get(key);
    if (cached) return cached;
    let records: MxRecord[];
    try {
      records = await dns.resolveMx(key);
    } catch {
      records = [];
    }
    this.mxCache.set(key, records);
    return records;
  }

  async resolveTxt(domain: string): Promise<string[]> {
    const key = domain.toLowerCase();
    const cached = this.txtCache.get(key);
    if (cached) return cached;
    let records: string[];
    try {
      records = (await dns.resolveTxt(key)).map((chunks) => chunks.join(''));
    } catch {
      records = [];
    }
    this.txtCache.set(key, records);
    return records;
  }
}

/** Table-driven resolver for tests. Unlisted domains resolve to no records. */
export class MapDnsResolver implements DnsResolver {
  constructor(
    private readonly mx: Map<string, MxRecord[]> = new Map(),
    private readonly txt: Map<string, string[]> = new Map(),
  ) {}

  async resolveMx(domain: string): Promise<MxRecord[]> {
    return this.mx.get(domain.toLowerCase()) ?? [];
  }

  async resolveTxt(domain: string): Promise<string[]> {
    return this.txt.get(domain.toLowerCase()) ?? [];
  }

  static withMx(domains: readonly string[]): MapDnsResolver {
    return new MapDnsResolver(
      new Map(domains.map((d) => [d.toLowerCase(), [{ exchange: `mx.${d}`, priority: 10 }]])),
    );
  }
}

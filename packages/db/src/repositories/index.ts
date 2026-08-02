export * from './base';
export * from './profile';
export * from './runs';
export * from './directory';
export * from './contact-store';

import type { Database } from '../client';
import { DocumentRepository, VendorProfileRepository } from './profile';
import {
  ConnectionRunRepository,
  ConnectionTaskRepository,
  PortalFieldWriteRepository,
  TaskEventRepository,
} from './runs';
import { DirectoryRepository } from './directory';

/**
 * Everything a request needs, bound to one tenant.
 *
 * Route handlers and worker steps take this rather than a `Database`, so the
 * tenant predicate is applied before any caller gets a chance to forget it.
 * `directory` is the one deliberately global member — see DirectoryRepository.
 */
export interface TenantRepositories {
  readonly tenantId: string;
  readonly profile: VendorProfileRepository;
  readonly documents: DocumentRepository;
  readonly runs: ConnectionRunRepository;
  readonly tasks: ConnectionTaskRepository;
  readonly events: TaskEventRepository;
  readonly fieldWrites: PortalFieldWriteRepository;
  readonly directory: DirectoryRepository;
}

export function repositoriesFor(db: Database, tenantId: string): TenantRepositories {
  const ctx = { db, tenantId };
  return {
    tenantId,
    profile: new VendorProfileRepository(ctx),
    documents: new DocumentRepository(ctx),
    runs: new ConnectionRunRepository(ctx),
    tasks: new ConnectionTaskRepository(ctx),
    events: new TaskEventRepository(ctx),
    fieldWrites: new PortalFieldWriteRepository(ctx),
    directory: new DirectoryRepository(db),
  };
}

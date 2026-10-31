import { AsyncLocalStorage } from 'node:async_hooks';
import type { MaintenanceCoordinator, OperationPermit } from './coordinator';
import { MaintenanceCoordinatorError, MaintenanceOutcomeUncertainError } from './errors';
import { DEFAULT_OPERATION_LEASE_SECONDS } from './store';

export interface ScopedOperationPermit extends OperationPermit {
  readonly signal: AbortSignal;
  markOutcomeUncertain(): void;
}

interface ScopeFrame {
  readonly siteKey: string;
  readonly permit: ScopedOperationPermit;
  readonly parent: ScopeFrame | null;
  active: boolean;
}

// Admission boundaries are constructed by independent runtime surfaces (HTTP,
// workers, and startup/service callers), but they all participate in one
// process-local lexical operation tree. Keeping the context module-global lets
// a nested surface reuse its caller's permit without coupling the instances.
const operationScopeStorage = new AsyncLocalStorage<ScopeFrame>();

function inheritedPermit(frame: ScopeFrame | undefined, siteKey: string): ScopedOperationPermit | null {
  for (let current: ScopeFrame | null | undefined = frame; current; current = current.parent) {
    if (current.active && current.siteKey === siteKey) return current.permit;
  }
  return null;
}

/** Nested same-site calls reuse one permit; only the outer scope settles it. */
export class MaintenanceOperationScope {
  constructor(private readonly coordinator: MaintenanceCoordinator) {}

  async run<T>(input: {
    siteKey: string;
    operationKind: string;
    leaseSeconds?: number;
  }, work: (permit: ScopedOperationPermit) => Promise<T>): Promise<T> {
    const inherited = operationScopeStorage.getStore();
    const existing = inheritedPermit(inherited, input.siteKey);
    if (existing) return work(existing);

    const execute = async (): Promise<T> => {
      const leaseSeconds = input.leaseSeconds ?? DEFAULT_OPERATION_LEASE_SECONDS;
      const owned = await this.coordinator.admit({ ...input, leaseSeconds });
      const controller = new AbortController();
      let explicitlyUncertain = false;
      let ownerLost = false;
      let heartbeatInFlight: Promise<void> | null = null;
      const permit: ScopedOperationPermit = {
        ...owned,
        signal: controller.signal,
        markOutcomeUncertain: () => { explicitlyUncertain = true; },
      };
      // Each newly admitted site receives an immutable branch-local frame.
      // Async siblings inherit the same parent frame, never each other's new
      // permit, while true lexical descendants still discover this permit.
      const frame: ScopeFrame = { siteKey: input.siteKey, permit, parent: inherited ?? null, active: true };

      const heartbeat = async () => {
        if (heartbeatInFlight || ownerLost) return;
        heartbeatInFlight = this.coordinator.heartbeat(owned, leaseSeconds)
          .then(async (retained) => {
            if (retained) return;
            ownerLost = true;
            await this.coordinator.markUncertain(owned).catch(() => undefined);
            controller.abort(new MaintenanceCoordinatorError(
              'MAINTENANCE_OPERATION_NOT_OWNER',
              'Maintenance operation ownership was lost while work was still running.'
            ));
          })
          .catch((error) => {
            ownerLost = true;
            controller.abort(new MaintenanceCoordinatorError(
              'MAINTENANCE_OPERATION_NOT_OWNER',
              'Maintenance operation heartbeat failed; ownership is no longer trusted.',
              { cause: error instanceof Error ? error.message : String(error) }
            ));
          })
          .finally(() => { heartbeatInFlight = null; });
        await heartbeatInFlight;
      };
      const heartbeatIntervalMs = Math.max(100, Math.floor((leaseSeconds * 1000) / 4));
      const timer = setInterval(() => { void heartbeat(); }, heartbeatIntervalMs);
      timer.unref();

      let result!: T;
      let workError: unknown;
      try {
        result = await operationScopeStorage.run(frame, () => work(permit));
      } catch (error) {
        workError = error;
      } finally {
        // AsyncLocalStorage context can outlive an awaited callback when that
        // callback schedules detached work. Such work must never reuse a
        // permit that the lexical owner is about to settle.
        frame.active = false;
        clearInterval(timer);
        await heartbeatInFlight;
      }

      const ambiguousError = workError instanceof MaintenanceOutcomeUncertainError;
      if (ownerLost || explicitlyUncertain || ambiguousError) {
        await this.coordinator.markUncertain(owned).catch(() => undefined);
        if (workError !== undefined) throw workError;
        if (ownerLost) {
          throw new MaintenanceCoordinatorError(
            'MAINTENANCE_OPERATION_NOT_OWNER',
            'Maintenance operation ownership was lost before work settled.'
          );
        }
        return result;
      }

      // An awaited validation/business error has a known outcome. Releasing
      // the permit prevents ordinary rejections from poisoning future drains.
      await this.coordinator.complete(owned);
      if (workError !== undefined) throw workError;
      return result;
    };
    return execute();
  }
}

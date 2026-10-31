import { describe, expect, it, vi } from 'vitest';
import type { MaintenanceCoordinator, OperationPermit } from './coordinator';
import { MaintenanceCoordinatorError } from './errors';
import { MaintenanceOperationScope } from './operation-scope';

function permit(operationKind: string): OperationPermit {
  return {
    operationId: 'outer-operation',
    ownerToken: 'outer-owner',
    siteKey: 'site-a',
    generation: 1,
    operationKind,
  };
}

function coordinator(input: {
  admit: (operationKind: string) => Promise<OperationPermit>;
}) {
  return {
    admit: vi.fn(({ operationKind }: { operationKind: string }) => input.admit(operationKind)),
    heartbeat: vi.fn(async () => true),
    complete: vi.fn(async () => undefined),
    markUncertain: vi.fn(async () => undefined),
  };
}

describe('MaintenanceOperationScope process-wide nesting', () => {
  it('reuses an active permit across scope instances after admission closes', async () => {
    let admissionOpen = true;
    const outerCoordinator = coordinator({
      admit: async (operationKind) => permit(operationKind),
    });
    const innerCoordinator = coordinator({
      admit: async () => {
        if (!admissionOpen) {
          throw new MaintenanceCoordinatorError(
            'MAINTENANCE_ADMISSION_CLOSED',
            'capture barrier is active'
          );
        }
        return permit('unexpected-inner-admission');
      },
    });
    const outerScope = new MaintenanceOperationScope(
      outerCoordinator as unknown as MaintenanceCoordinator
    );
    const innerScope = new MaintenanceOperationScope(
      innerCoordinator as unknown as MaintenanceCoordinator
    );

    let innerOperationId = '';
    await outerScope.run(
      { siteKey: 'site-a', operationKind: 'http:POST:/media' },
      async (outerPermit) => {
        admissionOpen = false;
        await innerScope.run(
          { siteKey: 'site-a', operationKind: 'worker:webpage:verify-capture' },
          async (innerPermit) => {
            innerOperationId = innerPermit.operationId;
          }
        );
        expect(outerCoordinator.complete).not.toHaveBeenCalled();
        expect(innerOperationId).toBe(outerPermit.operationId);
      }
    );

    expect(outerCoordinator.admit).toHaveBeenCalledOnce();
    expect(innerCoordinator.admit).not.toHaveBeenCalled();
    expect(outerCoordinator.complete).toHaveBeenCalledOnce();
    expect(innerCoordinator.complete).not.toHaveBeenCalled();
  });

  it('does not reuse a cross-instance permit after its outer lifetime settles', async () => {
    const outerCoordinator = coordinator({
      admit: async (operationKind) => permit(operationKind),
    });
    const admissionClosed = new MaintenanceCoordinatorError(
      'MAINTENANCE_ADMISSION_CLOSED',
      'capture barrier is active'
    );
    const innerCoordinator = coordinator({ admit: async () => { throw admissionClosed; } });
    const outerScope = new MaintenanceOperationScope(
      outerCoordinator as unknown as MaintenanceCoordinator
    );
    const innerScope = new MaintenanceOperationScope(
      innerCoordinator as unknown as MaintenanceCoordinator
    );
    let releaseDetached!: () => void;
    const detachedGate = new Promise<void>((resolve) => { releaseDetached = resolve; });
    let detached!: Promise<void>;

    await outerScope.run(
      { siteKey: 'site-a', operationKind: 'http:DELETE:/media/:id' },
      async () => {
        detached = (async () => {
          await detachedGate;
          await innerScope.run(
            { siteKey: 'site-a', operationKind: 'worker:cleanup' },
            async () => undefined
          );
        })();
      }
    );

    releaseDetached();
    await expect(detached).rejects.toBe(admissionClosed);
    expect(outerCoordinator.complete).toHaveBeenCalledOnce();
    expect(innerCoordinator.admit).toHaveBeenCalledOnce();
  });
});

import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const serverRoot = process.cwd();
const workspaceRoot = path.resolve(serverRoot, '..');

async function source(relativePath: string) {
  return readFile(path.resolve(workspaceRoot, relativePath), 'utf8');
}

describe('general Requests release boundary', () => {
  it('does not register or advertise general Request APIs', async () => {
    const [server, endpoints, reports, metrics] = await Promise.all([
      source('darshan-server/src/server/index.ts'),
      source('darshan-server/src/config/apiEndpoints.ts'),
      source('darshan-server/src/routes/reports.ts'),
      source('darshan-server/src/routes/metrics.ts'),
    ]);

    expect(server).not.toContain('requestRoutes');
    expect(endpoints).not.toMatch(/withBase\('\/requests(?:\/|')/);
    expect(endpoints).not.toContain('requestsByDepartment');
    expect(reports).not.toContain('schema.requests');
    expect(metrics).not.toContain('schema.requests');
    await expect(access(path.resolve(serverRoot, 'src/routes/requests.ts'))).rejects.toThrow();
  });

  it('removes the CMS surface while preserving Schedule Requests', async () => {
    const [shell, endpoints, dashboard, scheduleQueue, server] = await Promise.all([
      source('darshan-cms/src/AuthenticatedAppShell.tsx'),
      source('darshan-cms/src/api/endpoints.ts'),
      source('darshan-cms/src/pages/Dashboard.tsx'),
      source('darshan-cms/src/pages/ScheduleQueue.tsx'),
      source('darshan-server/src/server/index.ts'),
    ]);

    expect(shell).not.toContain('path="/requests"');
    expect(endpoints).not.toMatch(/(?:base:|requestsByDepartment:).*\/requests/);
    expect(dashboard).not.toContain('reports-requests-by-department');
    expect(scheduleQueue).toContain('scheduleRequestsApi');
    expect(server).toContain('scheduleRequestRoutes');
  });
});

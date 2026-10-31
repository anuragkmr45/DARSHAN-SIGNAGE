import { runWithWorkerAdmission } from '@/maintenance/worker-admission';
import {
  createMediaCacheReport,
  type CreateMediaCacheReportInput,
} from '@/services/media-cache-report-service';

export interface MediaCacheReportTelemetryJob {
  reportId: string;
  receivedAt: string;
  report: Omit<CreateMediaCacheReportInput, 'id' | 'receivedAt' | 'reportedAt'> & {
    reportedAt: string | null;
  };
}

async function persistMediaCacheReport(job: MediaCacheReportTelemetryJob) {
  await createMediaCacheReport({
    ...job.report,
    id: job.reportId,
    receivedAt: new Date(job.receivedAt),
    reportedAt: job.report.reportedAt ? new Date(job.report.reportedAt) : null,
  });
}

export async function processMediaCacheReportTelemetry(job: MediaCacheReportTelemetryJob) {
  return runWithWorkerAdmission(
    'telemetry:media-cache-report',
    () => persistMediaCacheReport(job)
  );
}

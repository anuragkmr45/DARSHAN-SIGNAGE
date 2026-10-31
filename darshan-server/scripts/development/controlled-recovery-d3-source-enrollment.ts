/** Root-observed read-only host enrollment and bounded image capability observations; no service/materialization pass is implied. */
export const D3_OPENSSL = Object.freeze({ path: '/usr/bin/openssl', sha256: '1d72cbc5bf62be3f3dbd7626c295b63c5fdc1dd8439f323ac47998d8a062b4c9',
  version: 'OpenSSL 3.5.5 27 Jan 2026 (Library: OpenSSL 3.5.5 27 Jan 2026)', ownerUid: 0, ownerGid: 0, mode: '0755' });
export const D3_PG_MATERIALIZER_IMAGE = 'sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea';
export const D3_MINIO_FILE_CREDENTIALS = Object.freeze({ verified: true, imageId: 'sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e',
  evidencePath: '/home/hexmon/Desktop/DARSHAN-SIGNAGE/qa-artifacts/evidence/controlled-recovery-d3-minio-file-credentials-capability-2026-10-30.md', evidenceSha256: 'daee5137f15f99a8fddffdc039e79e40c0f2aedd04c586f1a83567e37941bb0a' });
export const D3_SOURCE_HELPER_CAPABILITY = Object.freeze({ imageId: D3_PG_MATERIALIZER_IMAGE, observedByRoot: true, networkNone: true,
  install: '/usr/bin/install', stat: '/bin/stat', sha256sum: '/usr/bin/sha256sum', sync: '/bin/sync', minioBinaryFileCredentialsVerified: D3_MINIO_FILE_CREDENTIALS.verified });

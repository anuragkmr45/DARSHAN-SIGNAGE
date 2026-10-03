export const CHROMIUM_RUNTIME_HOME = '/tmp/darshan-worker-home';

export const CHROMIUM_RUNTIME_ENV = {
  HOME: CHROMIUM_RUNTIME_HOME,
  XDG_CONFIG_HOME: `${CHROMIUM_RUNTIME_HOME}/.config`,
  XDG_CACHE_HOME: `${CHROMIUM_RUNTIME_HOME}/.cache`,
  TMPDIR: '/tmp',
} as const;

export const CHROMIUM_RUNTIME_LAUNCH_ARGS = [
  '--disable-dev-shm-usage',
  // Chromium's Crashpad helper aborts this stateless worker runtime before page.goto().
  '--disable-crash-reporter',
] as const;

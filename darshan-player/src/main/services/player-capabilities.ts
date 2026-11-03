import type { AppConfig, PlayerCapabilities } from '../../common/types'
import { developmentLiveCapability } from '../live-development-profile'

/** The same current declaration travels over authenticated REST and HELLO.
 * Keep sending the no-LIVE declaration after disabling the gate so the server
 * cannot retain a capability from an earlier configuration indefinitely. */
export function buildPlayerCapabilities(config: AppConfig, env: NodeJS.ProcessEnv = process.env): PlayerCapabilities {
  return {
    commands: ['REFRESH', 'REFRESH_SCHEDULE', 'RESYNC', 'REBOOT', 'SCREENSHOT', 'TAKE_SCREENSHOT', 'CLEAR_CACHE', 'PING'],
    screenshot: true, log_upload: true, offline_startup: true, background_push: false,
    features: ['message_emergency_v1', 'webcontents_view_v1', 'pdf_page_selection_v1',
      ...(developmentLiveCapability(config, env) ? ['live_broadcast_v1'] : [])],
  }
}

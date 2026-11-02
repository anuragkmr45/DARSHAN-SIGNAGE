import { AccessToken, RoomServiceClient, TrackSource } from 'livekit-server-sdk';
import { performance } from 'node:perf_hooks';

export class LiveKitAdapter {
  constructor({ url, apiKey, apiSecret, timeoutMs = 1500, confirmationTimeoutMs = 2000 }) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.timeoutMs = timeoutMs;
    this.confirmationTimeoutMs = confirmationTimeoutMs;
    this.rooms = new RoomServiceClient(url, apiKey, apiSecret, { requestTimeout: timeoutMs / 1000, failover: false });
    this.probes = new RoomServiceClient(url, apiKey, apiSecret, { requestTimeout: 0.5, failover: false });
  }

  async createToken(entry) {
    const token = new AccessToken(this.apiKey, this.apiSecret, {
      identity: entry.participantId,
      // This is defense in depth only; local leases and gateway admission are authoritative.
      ttl: 10,
    });
    const sources = [TrackSource.SCREEN_SHARE];
    if (entry.audio.microphone) sources.push(TrackSource.MICROPHONE);
    if (entry.audio.screen_share_audio) sources.push(TrackSource.SCREEN_SHARE_AUDIO);
    token.addGrant({
      room: entry.room, roomJoin: true,
      canPublish: entry.role === 'presenter',
      canSubscribe: entry.role === 'receiver',
      canPublishData: false,
      ...(entry.role === 'presenter' ? { canPublishSources: sources } : {}),
    });
    return token.toJwt();
  }

  async removeParticipant(room, identity) {
    let timer;
    try {
      await Promise.race([
        this.rooms.removeParticipant(room, identity),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('SFU_TIMEOUT')), this.timeoutMs); }),
      ]);
    } catch (error) {
      // Removal is idempotent even when a connection never reached the SFU.
      if (error?.code !== 'not_found') throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async confirmParticipant(entry) {
    const until = performance.now() + this.confirmationTimeoutMs;
    do {
      let timer;
      try {
        await Promise.race([
          this.probes.getParticipant(entry.room, entry.participantId),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('REGISTRATION_DEADLINE')), Math.max(1, until - performance.now())); }),
        ]);
        return;
      } catch (error) {
        // Cold CPU-limited nodes can briefly time out after accepting a join. This read
        // can retry without granting another connection or extending its authority.
        if (['unauthenticated', 'permission_denied', 'invalid_argument'].includes(error?.code)) throw error;
      } finally { clearTimeout(timer); }
      await new Promise((resolve) => setTimeout(resolve, 20));
    } while (performance.now() < until);
    throw new Error('PARTICIPANT_REGISTRATION_UNCONFIRMED');
  }
}

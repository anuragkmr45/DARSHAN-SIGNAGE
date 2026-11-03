import { Room, RoomEvent, Track } from 'livekit-client';
const el = id => document.getElementById(id);
const session = crypto.randomUUID();
let capture, microphone, room, generation = 0, renewing = false, timer, deadlineTimer, leaseEnd = 0;
let starting = false;
let activeRun;
let patternTimer;
const status = message => { el('status').textContent = message; };
const api = async (route, body) => {
  const response = await fetch(route, { method:'POST', headers:{'content-type':'application/json',authorization:`Bearer ${el('token').value}`}, body:JSON.stringify({...body,presenter_session_id:session}), signal:AbortSignal.timeout(2500) });
  if (!response.ok) throw new Error(`Authority denied or unavailable (${response.status})`);
  return response.json();
};
const clearCapture = () => {
  clearInterval(patternTimer);patternTimer=undefined;
  for (const stream of [capture,microphone]) stream?.getTracks().forEach(track=>track.stop());
  capture = microphone = undefined; el('preview').srcObject = null; el('start').disabled = true;
};
// Supplemental transport fixture; it is never recorded as getDisplayMedia proof.
el('pattern').onclick=()=>{
  if(room||starting)return;
  ++generation;clearCapture();
  const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=720;
  const ctx=canvas.getContext('2d');const began=performance.now();
  const draw=()=>{ctx.fillStyle='#113d4f';ctx.fillRect(0,0,1280,720);ctx.fillStyle='#ffffff';ctx.font='bold 62px sans-serif';ctx.fillText('DARSHAN TRANSPORT TEST',85,220);ctx.font='50px monospace';ctx.fillText(`${((performance.now()-began)/1000).toFixed(1)} seconds`,85,340);ctx.fillStyle='#69eab4';ctx.fillRect(85,430,100+(performance.now()-began)%1000,80);};
  draw();patternTimer=setInterval(draw,100);capture=canvas.captureStream(10);
  el('preview').srcObject=capture;el('start').disabled=false;el('stop').disabled=false;
  el('details').textContent='Synthetic canvas video only. Real screen/window/tab capture and native audio remain separate tests.';
  status('Synthetic local preview ready; this does not verify OS screen capture.');
};
const stop = async (reason = 'Stopped') => {
  ++generation; clearTimeout(timer); clearTimeout(deadlineTimer); renewing = false; starting = false;
  const previousRoom=room; room=undefined;
  const previousRun=activeRun;activeRun=undefined;
  clearCapture(); el('stop').disabled=true; el('choose').disabled=false;
  status(reason);
  void previousRoom?.disconnect(true);
  if(previousRun)try { await api('/prototype/stop',previousRun); } catch { /* lease enforcement remains authoritative */ }
};
el('choose').onclick = async () => {
  if(room || starting)return;
  const mine=++generation; clearCapture();
  try {
    const stream=await navigator.mediaDevices.getDisplayMedia({video:true,audio:el('captured-audio').checked});
    if(mine!==generation){stream.getTracks().forEach(t=>t.stop());return;}
    capture=stream;el('preview').srcObject=stream;
    stream.getVideoTracks()[0].addEventListener('ended',()=>{
      if(mine===generation && capture===stream)void stop('Screen sharing stopped');
    });
    let microphoneUnavailable=false;
    if(el('microphone').checked){
      try{const mic=await navigator.mediaDevices.getUserMedia({audio:true});if(mine!==generation){mic.getTracks().forEach(t=>t.stop());return;}microphone=mic;}
      catch{if(mine!==generation)return;microphoneUnavailable=true;}
    }
    el('details').textContent=JSON.stringify({video:stream.getVideoTracks().map(t=>t.getSettings()),captured_audio_tracks:stream.getAudioTracks().length,microphone_tracks:microphone?.getAudioTracks().length??0},null,2);
    el('start').disabled=false;el('stop').disabled=false;
    status(microphoneUnavailable?'Microphone unavailable; local video preview is ready. Nothing is broadcasting yet.':'Local preview ready. Nothing is broadcasting yet.');
  } catch { if(mine===generation)status('Source selection cancelled or denied.'); }
};
const renew = async mine => {
  if(mine!==generation || !room || renewing)return;
  renewing=true;
  try{
    if(el('renew').checked){
      const started=performance.now(); const grant=await api('/prototype/authority/presenter',activeRun);
      if(mine!==generation)return;
      leaseEnd=started+Math.min(grant.lease_ms,grant.window_remaining_ms);
      clearTimeout(deadlineTimer); deadlineTimer=setTimeout(()=>void stop('Live authority expired'),Math.max(0,leaseEnd-performance.now()));
    }
  }catch{if(mine===generation && room)status('Authority renewal failed; live cutoff remains armed.');}
  finally{if(mine===generation){renewing=false;if(room)timer=setTimeout(()=>void renew(mine),3000);}}
};
el('start').onclick=async()=>{
  if(!capture||room||starting)return;
  starting=true;const mine=generation;el('start').disabled=true;el('choose').disabled=true;
  const requestedRun={request_id:crypto.randomUUID()};activeRun=requestedRun;
  try{
    const created=await api('/prototype/start',{...requestedRun,microphone:Boolean(microphone?.getAudioTracks().length),screen_share_audio:Boolean(capture.getAudioTracks().length)});
    const expectedRun={...requestedRun,...created};
    if(mine!==generation){await api('/prototype/stop',expectedRun);return;}
    activeRun=expectedRun;
    const began=performance.now();const grant=await api('/prototype/authority/presenter',{...expectedRun,reconnect:true});
    if(mine!==generation){await api('/prototype/stop',expectedRun);return;}
    leaseEnd=began+Math.min(grant.lease_ms,grant.window_remaining_ms);
    room=new Room({reconnectPolicy:{nextRetryDelayInMs:()=>null},adaptiveStream:false});
    const connecting=room;
    room.on(RoomEvent.Disconnected,()=>{if(mine===generation)void stop('Media connection ended');});
    deadlineTimer=setTimeout(()=>void stop('Live authority expired'),Math.max(0,leaseEnd-performance.now()));
    // Loop-1 direct local transport must not depend on a public STUN service.
    await connecting.connect(grant.signal_url,grant.ticket,{autoSubscribe:false,rtcConfig:{iceServers:[]}});
    if(mine!==generation){await connecting.disconnect(true);return;}
    await connecting.localParticipant.publishTrack(capture.getVideoTracks()[0],{source:Track.Source.ScreenShare,simulcast:false,videoCodec:'vp8'});
    for(const track of capture.getAudioTracks())await connecting.localParticipant.publishTrack(track,{source:Track.Source.ScreenShareAudio});
    for(const track of microphone?.getAudioTracks()??[])await connecting.localParticipant.publishTrack(track,{source:Track.Source.Microphone});
    if(mine!==generation)return;
    status('Presenter transmitting. Check the real Electron receiver for rendering.');
    void renew(mine);
  }catch(error){if(mine===generation)await stop(error.message);}
  finally{if(mine===generation)starting=false;}
};
el('stop').onclick=()=>void stop('Presenter stopped the attempt');
document.addEventListener('visibilitychange',()=>{if(room)void renew(generation);});
window.addEventListener('pagehide',()=>{++generation;clearCapture();void room?.disconnect(true);});
// Do not present inert controls as ready while this module is still loading.
el('choose').disabled=false;el('pattern').disabled=false;
status('Choose a source to preview.');

import { contextBridge, ipcRenderer } from 'electron'
import type { LivePrototypeBridge } from '../../common/live-prototype'

const bridge: LivePrototypeBridge = {
  grant: () => ipcRenderer.invoke('live-prototype:grant'),
  report: (value) => ipcRenderer.send('live-prototype:observation', value),
  state: () => ipcRenderer.invoke('live-prototype:state'),
  onState: (listener) => {
    const receive = (_event: Electron.IpcRendererEvent, value: { reason: string; fallback_url?: string }) => listener(value)
    ipcRenderer.on('live-prototype:state', receive)
    return () => { ipcRenderer.removeListener('live-prototype:state', receive) }
  },
}
contextBridge.exposeInMainWorld('livePrototype', bridge)

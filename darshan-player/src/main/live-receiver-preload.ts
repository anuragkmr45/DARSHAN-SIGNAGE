import { contextBridge, ipcRenderer } from 'electron'
import type { LiveReceiverBridge } from '../common/live-runtime'
const bridge: LiveReceiverBridge = {
  grant: () => ipcRenderer.invoke('live-receiver:grant'),
  lease: () => ipcRenderer.invoke('live-receiver:lease'),
  report: value => ipcRenderer.send('live-receiver:observation', value),
  onActivate: listener => {
    const receive = (): void => listener()
    ipcRenderer.on('live-receiver:activate', receive)
    return () => ipcRenderer.removeListener('live-receiver:activate', receive)
  },
}
contextBridge.exposeInMainWorld('liveReceiver', bridge)

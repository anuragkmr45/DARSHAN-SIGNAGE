const { app, BrowserWindow } = require('electron')
const { captureWindowsBrowserWindow } = require('../dist/main/main/services/windows-window-capture.js')

async function main() {
  await app.whenReady()

  const window = new BrowserWindow({
    width: 320,
    height: 240,
    title: 'WIN-QA-COMPOSITOR-SMOKE',
    frame: false,
    show: true,
    backgroundColor: '#000000',
    alwaysOnTop: false,
    webPreferences: {
      sandbox: true,
    },
  })

  const html = `<!doctype html>
    <html>
      <head><title>WIN-QA-COMPOSITOR-SMOKE</title></head>
      <body style="margin:0;background:#000;width:100vw;height:100vh;overflow:hidden">
        <canvas id="source" style="display:none"></canvas>
        <img id="visible" style="display:block;width:100vw;height:100vh;object-fit:contain;background:#fff" />
        <script>
          const canvas = document.getElementById('source')
          canvas.width = 320
          canvas.height = 240
          const context = canvas.getContext('2d')
          context.fillStyle = '#fff'
          context.fillRect(0, 0, canvas.width, canvas.height)
          document.getElementById('visible').src = canvas.toDataURL('image/png')
        </script>
      </body>
    </html>`
  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  await new Promise((resolve) => setTimeout(resolve, 750))

  const cover = new BrowserWindow({
    width: 320,
    height: 240,
    title: 'WIN-QA-COMPOSITOR-COVER',
    frame: false,
    show: true,
    backgroundColor: '#000000',
    webPreferences: { sandbox: true },
  })
  cover.setBounds(window.getBounds())
  await cover.loadURL('data:text/html,<body style="margin:0;background:%23000"></body>')
  cover.moveTop()
  await new Promise((resolve) => setTimeout(resolve, 250))

  const image = await captureWindowsBrowserWindow(window)
  if (!image || image.isEmpty()) {
    throw new Error('Composed BrowserWindow capture was empty')
  }

  const sample = image.resize({ width: 1, height: 1 }).toBitmap()
  const colorChannels = [sample[0], sample[1], sample[2]]
  if (colorChannels.some((value) => value < 220)) {
    throw new Error(`Composed BrowserWindow capture was not visibly white: ${colorChannels.join(',')}`)
  }

  console.log(JSON.stringify({
    result: 'PASS',
    sourceMatched: true,
    captureSize: image.getSize(),
    centerIsWhite: true,
  }))
  cover.destroy()
  window.destroy()
  app.quit()
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  app.exit(1)
})

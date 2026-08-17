/**
 * macOS reads the bold application-menu title and the About panel's icon from
 * the running bundle, not from app.setName() or app.dock.setIcon() —
 * unpackaged, that bundle is Electron's own, so dev shows "Electron" and the
 * Electron atom no matter what the app calls itself. Stamping the dev binary
 * is the only way to fix either before packaging. Idempotent, and re-run by
 * `npm run dev` because reinstalling electron restores the stock bundle.
 */
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

if (process.platform === 'darwin') {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const contents = new URL('../node_modules/electron/dist/Electron.app/Contents/', import.meta.url)
  const plist = fileURLToPath(new URL('Info.plist', contents))

  try {
    const before = readFileSync(plist, 'utf8')
    const after = before.replace(
      /(<key>CFBundle(?:Name|DisplayName)<\/key>\s*<string>)[^<]*(<\/string>)/g,
      `$1${pkg.productName}$2`
    )
    if (after !== before) writeFileSync(plist, after)

    // Overwrites the file CFBundleIconFile already points at, so the icon
    // needs no plist edit and Finder's icon cache has nothing stale to hold.
    copyFileSync(
      fileURLToPath(new URL('../resources/icon.icns', import.meta.url)),
      fileURLToPath(new URL('Resources/electron.icns', contents))
    )
  } catch (error) {
    // A missing binary is install-electron's problem to report, not this
    // script's — a cosmetic name must never block `npm run dev`.
    console.warn(`could not brand the dev bundle: ${error.message}`)
  }
}

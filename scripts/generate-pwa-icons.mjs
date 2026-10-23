import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

// Run with: node scripts/generate-pwa-icons.mjs
// Uses the same installed Chrome and Playwright dev dependency as the E2E suite.
// No image-generation service or application runtime dependency is involved.
const source = await readFile(new URL('../public/favicon.svg', import.meta.url), 'utf8')
const output = new URL('../public/icons/', import.meta.url)
await mkdir(output, { recursive: true })

const icons = [
  { filename: 'pwa-192.png', size: 192, opaque: false, maskable: false },
  { filename: 'pwa-512.png', size: 512, opaque: false, maskable: false },
  { filename: 'pwa-maskable-512.png', size: 512, opaque: true, maskable: true },
  { filename: 'apple-touch-icon.png', size: 180, opaque: true, maskable: false },
]

const browser = await chromium.launch({ channel: 'chrome' })
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 })
  for (const icon of icons) {
    await page.setViewportSize({ width: icon.size, height: icon.size })
    await page.setContent('<style>html,body{margin:0;padding:0}svg{display:block}</style>')
    await page.evaluate(({ source, size, opaque, maskable }) => {
      const svg = new DOMParser().parseFromString(source, 'image/svg+xml').documentElement
      const background = svg.querySelector('rect')
      if (svg.nodeName !== 'svg' || svg.getAttribute('viewBox') !== '0 0 32 32' || !background) {
        throw new Error('Expected the existing 32 × 32 favicon with a background rectangle.')
      }
      svg.setAttribute('width', String(size))
      svg.setAttribute('height', String(size))
      if (opaque) {
        // iOS and maskable launchers apply their own corner masks.
        background.removeAttribute('rx')
        background.removeAttribute('ry')
      }
      if (maskable) {
        // Keep the entire existing mark inside the centered 40%-radius safe circle.
        // https://www.w3.org/TR/appmanifest/#icon-masks
        const mark = document.createElementNS('http://www.w3.org/2000/svg', 'g')
        mark.setAttribute('transform', 'translate(3.2 3.2) scale(0.8)')
        for (const child of Array.from(svg.children)) {
          if (child !== background) mark.append(child)
        }
        svg.append(mark)
      }
      document.body.append(document.importNode(svg, true))
    }, { source, ...icon })
    const png = await page.locator('svg').screenshot({ omitBackground: true })
    await writeFile(new URL(icon.filename, output), png)
    console.log(`${icon.size} × ${icon.size}: ${fileURLToPath(new URL(icon.filename, output))}`)
  }
} finally {
  await browser.close()
}

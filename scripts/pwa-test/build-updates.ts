import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { build } from 'vite'

export default async function buildUpdates() {
  for (const version of ['a', 'b']) {
    await build({
      configFile: resolve('vite.config.ts'),
      logLevel: 'warn',
      build: { outDir: resolve('.artifacts/pwa-update', version), emptyOutDir: true },
      plugins: [{
        name: 'pwa-update-test-build-marker',
        transform(code, id) {
          if (!id.split('?')[0]?.replaceAll('\\', '/').endsWith('/src/features/goals/GoalsPage.tsx')) return
          // Change a real lazy module's content hash, not just the HTML revision.
          // This statement exists only in these disposable production test builds.
          return { code: `${code}\n;document.documentElement.dataset.pwaTestLazyBuild = ${JSON.stringify(version)};\n`, map: null }
        },
        transformIndexHtml: {
          order: 'post',
          handler: () => [{ tag: 'meta', attrs: { name: 'pwa-test-build', content: version }, injectTo: 'head' }],
        },
      }],
    })
  }
  const [first, second] = await Promise.all(['a', 'b'].map((version) => readFile(resolve('.artifacts/pwa-update', version, 'sw.js'), 'utf8')))
  if (first === second) throw new Error('Two production builds must generate different service workers and precache revisions')
}

// Workbox owns caching. This guard only permits a user-requested activation
// when no other app window could lose a draft or an old lazy-loaded module.
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'SAFE_SKIP_WAITING' || !event.ports[0]) return;
  const reply = (result) => event.ports[0].postMessage(result);
  event.waitUntil((async () => {
    try {
      const source = event.source;
      const scope = new URL(self.registration.scope);
      if (!source || !('id' in source) || !source.url.startsWith(scope.href)) {
        reply({ ok: false, reason: 'unknown-client' });
        return;
      }
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      if (windows.some((client) => client.id !== source.id && client.url.startsWith(scope.href))) {
        reply({ ok: false, reason: 'other-windows' });
        return;
      }
      await self.skipWaiting();
      reply({ ok: true });
    } catch {
      reply({ ok: false, reason: 'unavailable' });
    }
  })());
});

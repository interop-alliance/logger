import { test, expect } from '@playwright/test'

test('pagehide flushes the ndjson batch with keepalive in a real browser', async ({
  page
}) => {
  await page.goto('/test/index.html')
  await page.evaluate(async () => {
    localStorage.removeItem('captured-fetch')
    // This callback runs in the browser; '/src/index.ts' is a URL served by the
    // vite dev server, not a module path tsc can resolve from disk.
    // @ts-expect-error -- dev-server URL, resolved at runtime by vite
    const seam = await import('/src/index.ts')
    seam.configure({ console: false })
    const calls: { keepalive: boolean; body: string }[] = []
    window.fetch = ((url: unknown, init?: RequestInit) => {
      calls.push({
        keepalive: init?.keepalive === true,
        body: String(init?.body ?? '')
      })
      // pagehide runs as the page unloads, so stash synchronously
      localStorage.setItem('captured-fetch', JSON.stringify(calls))
      return Promise.resolve(new Response(null, { status: 204 }))
    }) as typeof window.fetch
    seam.addSink(seam.ndjsonSink({ url: '/__interop-logger', flushMs: 60_000 }))
    const log = seam.createLogger('fw:browser')
    log.warn('one')
    log.warn('two')
  })
  // a same-origin navigation fires a real pagehide
  await page.goto('/test/index.html?after')
  const captured = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('captured-fetch') ?? '[]')
  )
  expect(captured).toHaveLength(1)
  expect(captured[0].keepalive).toBe(true)
  const lines = captured[0].body
    .split('\n')
    .map((line: string) => JSON.parse(line))
  expect(lines.map((line: { msg: string }) => line.msg)).toEqual(['one', 'two'])
  expect(lines.map((line: { seq: number }) => line.seq)).toEqual([0, 1])
  expect(typeof lines[0].page).toBe('string')
})

test('error-level events flush immediately without keepalive', async ({
  page
}) => {
  await page.goto('/test/index.html')
  const captured = await page.evaluate(async () => {
    // @ts-expect-error -- dev-server URL, resolved at runtime by vite
    const seam = await import('/src/index.ts')
    seam.configure({ console: false })
    const calls: { keepalive: boolean; body: string }[] = []
    window.fetch = ((url: unknown, init?: RequestInit) => {
      calls.push({
        keepalive: init?.keepalive === true,
        body: String(init?.body ?? '')
      })
      return Promise.resolve(new Response(null, { status: 204 }))
    }) as typeof window.fetch
    seam.addSink(seam.ndjsonSink({ url: '/__interop-logger', flushMs: 60_000 }))
    seam.createLogger('fw:browser').error('boom', { err: new Error('broke') })
    return calls
  })
  expect(captured).toHaveLength(1)
  const firstCall = captured[0] as { keepalive: boolean; body: string }
  expect(firstCall.keepalive).toBe(false)
  const line = JSON.parse(firstCall.body)
  expect(line.level).toBe('error')
  expect(line.err.name).toBe('Error')
  expect(line.err.message).toBe('broke')
})

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { interopLoggerPlugin } from '../../src/vite.js'
import type { IncomingMessage, ServerResponse } from 'node:http'

type Handler = (req: IncomingMessage, res: ServerResponse) => void

let dir: string
let file: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'interop-logger-'))
  file = path.join(dir, 'app.ndjson')
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

function startPlugin(options: Record<string, unknown> = {}): Handler {
  const plugin = interopLoggerPlugin({ file, ...options })
  let handler: Handler | undefined
  plugin.configureServer({
    middlewares: {
      use(route: string, routeHandler: Handler): void {
        expect(route).toBe('/__interop-logger')
        handler = routeHandler
      }
    }
  })
  if (handler === undefined) {
    throw new Error('the plugin registered no middleware')
  }
  return handler
}

function makeReq({
  method = 'POST',
  headers = {},
  body = ''
}: {
  method?: string
  headers?: Record<string, string>
  body?: string
} = {}): IncomingMessage {
  const req = new Readable({
    read(): void {}
  }) as unknown as IncomingMessage & {
    push(chunk: Buffer | null): void
  }
  ;(req as unknown as { method: string }).method = method
  req.headers = { host: 'localhost:5173', ...headers }
  setImmediate(() => {
    if (body.length > 0) {
      req.push(Buffer.from(body))
    }
    req.push(null)
  })
  return req
}

function makeRes(): ServerResponse & { ended: boolean } {
  const res = {
    statusCode: 200,
    ended: false,
    end(): void {
      res.ended = true
    }
  }
  return res as unknown as ServerResponse & { ended: boolean }
}

async function post(
  handler: Handler,
  reqOptions: Parameters<typeof makeReq>[0] = {}
): Promise<ServerResponse & { ended: boolean }> {
  const res = makeRes()
  handler(makeReq(reqOptions), res)
  await vi.waitFor(() => {
    expect(res.ended).toBe(true)
  })
  return res
}

function validLine(msg: string): string {
  return JSON.stringify({
    ts: 111,
    ns: 'fw:test',
    level: 'warn',
    msg,
    page: 'p1',
    seq: 0
  })
}

describe('interopLoggerPlugin', () => {
  it('parses and re-serializes a valid NDJSON POST', async () => {
    const handler = startPlugin()
    const injected = JSON.stringify({
      ts: 1,
      ns: 'fw:x',
      level: 'info',
      msg: 'two',
      evil: 'smuggled'
    })
    const res = await post(handler, {
      body: `${validLine('one')}\n${injected}\n`
    })
    expect(res.statusCode).toBe(204)
    const lines = fs
      .readFileSync(file, 'utf8')
      .trim()
      .split('\n')
      .map(line => JSON.parse(line))
    expect(lines).toHaveLength(2)
    expect(lines[0]).toEqual({
      ts: 111,
      ns: 'fw:test',
      level: 'warn',
      msg: 'one',
      page: 'p1',
      seq: 0
    })
    // unknown keys are dropped by the re-serialization projection
    expect(lines[1]).toEqual({ ts: 1, ns: 'fw:x', level: 'info', msg: 'two' })
  })

  it('accepts the truncation stub line shape', async () => {
    const handler = startPlugin()
    const stub = JSON.stringify({
      truncated: true,
      ns: 'fw:test',
      level: 'error',
      msg: 'huge'
    })
    const res = await post(handler, { body: stub })
    expect(res.statusCode).toBe(204)
  })

  it('refuses a body that is not LogEvent NDJSON, appending nothing', async () => {
    const handler = startPlugin()
    expect((await post(handler, { body: 'not json' })).statusCode).toBe(400)
    expect(
      (await post(handler, { body: JSON.stringify({ msg: 'shapeless' }) }))
        .statusCode
    ).toBe(400)
    expect(fs.existsSync(file)).toBe(false)
  })

  it('refuses an oversize request', async () => {
    const handler = startPlugin({ maxRequestBytes: 64 })
    const res = await post(handler, { body: validLine('x'.repeat(200)) })
    expect(res.statusCode).toBe(413)
    expect(fs.existsSync(file)).toBe(false)
  })

  it('caps the total file size', async () => {
    const handler = startPlugin({ maxFileBytes: 100 })
    fs.writeFileSync(file, 'y'.repeat(90) + '\n')
    const res = await post(handler, { body: validLine('one') })
    expect(res.statusCode).toBe(507)
    expect(fs.readFileSync(file, 'utf8')).not.toContain('fw:test')
  })

  it('refuses cross-origin posts by Origin and by Sec-Fetch-Site', async () => {
    const handler = startPlugin()
    expect(
      (
        await post(handler, {
          headers: { origin: 'http://evil.example' },
          body: validLine('x')
        })
      ).statusCode
    ).toBe(403)
    expect(
      (
        await post(handler, {
          headers: { 'sec-fetch-site': 'cross-site' },
          body: validLine('x')
        })
      ).statusCode
    ).toBe(403)
    expect(
      (
        await post(handler, {
          headers: { origin: 'null' },
          body: validLine('x')
        })
      ).statusCode
    ).toBe(403)
    expect(fs.existsSync(file)).toBe(false)
  })

  it('accepts a same-origin post', async () => {
    const handler = startPlugin()
    const res = await post(handler, {
      headers: {
        origin: 'http://localhost:5173',
        'sec-fetch-site': 'same-origin'
      },
      body: validLine('ok')
    })
    expect(res.statusCode).toBe(204)
  })

  it('answers 405 to non-POST methods', async () => {
    const handler = startPlugin()
    expect((await post(handler, { method: 'GET' })).statusCode).toBe(405)
  })

  it('rotates the file to a .prev sibling on server start', async () => {
    const handler = startPlugin()
    await post(handler, { body: validLine('from-run-one') })
    startPlugin()
    const prev = path.join(dir, 'app.prev.ndjson')
    expect(fs.existsSync(prev)).toBe(true)
    expect(fs.readFileSync(prev, 'utf8')).toContain('from-run-one')
    expect(fs.existsSync(file)).toBe(false)
  })
})

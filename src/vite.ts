/*!
 * Copyright (c) 2026 Interop Alliance. All rights reserved.
 */

/**
 * The dev-server half of the NDJSON sink: a Vite plugin whose middleware
 * accepts `POST /__interop-logger` batches and appends them to a local
 * NDJSON file. Each posted line is parsed as LogEvent JSON and
 * re-serialized -- request bytes are never appended verbatim -- with
 * cross-origin posts refused and request and total file size capped. On
 * server start the file rotates to a `.prev` sibling rather than
 * truncating. Dev server only; imported by vite.config.ts, never by app
 * source.
 */
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'

const ENDPOINT_PATH = '/__interop-logger'
const LEVELS = new Set(['debug', 'info', 'warn', 'error'])

/**
 * Projects one parsed line onto the known NDJSON line fields, dropping
 * anything else a poster smuggled in.
 *
 * @param line {Record<string, unknown>}
 * @returns {Record<string, unknown>}
 */
function projectLine(line: Record<string, unknown>): Record<string, unknown> {
  const projected: Record<string, unknown> = {
    ts: line.ts,
    ns: line.ns,
    level: line.level,
    msg: line.msg
  }
  for (const key of ['err', 'data', 'page', 'seq', 'truncated']) {
    if (line[key] !== undefined) {
      projected[key] = line[key]
    }
  }
  return projected
}

/**
 * Validates one parsed line as LogEvent-shaped JSON (the truncation stub
 * included).
 *
 * @param line {unknown}
 * @returns {boolean}
 */
function isLogEventLine(line: unknown): line is Record<string, unknown> {
  if (typeof line !== 'object' || line === null || Array.isArray(line)) {
    return false
  }
  const record = line as Record<string, unknown>
  if (typeof record.ns !== 'string' || typeof record.msg !== 'string') {
    return false
  }
  if (typeof record.level !== 'string' || !LEVELS.has(record.level)) {
    return false
  }
  if (record.truncated === true) {
    return true
  }
  return typeof record.ts === 'number'
}

/**
 * Refuses a request whose Origin or Sec-Fetch-Site marks it cross-origin.
 * The endpoint accepts no-preflight simple POSTs by browser construction,
 * so this check is what keeps any visited tab from writing the log file.
 *
 * @param req {IncomingMessage}
 * @returns {boolean}
 */
function isSameOrigin(req: IncomingMessage): boolean {
  const site = req.headers['sec-fetch-site']
  if (site !== undefined && site !== 'same-origin' && site !== 'none') {
    return false
  }
  const origin = req.headers.origin
  if (origin === undefined) {
    return true
  }
  if (origin === 'null') {
    return false
  }
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

/**
 * Rotates an existing log file to its `.prev` sibling (e.g. app.ndjson to
 * app.prev.ndjson) and ensures the directory exists. A restart must not
 * delete the log of the failure being investigated.
 *
 * @param file {string}
 */
function rotate(file: string): void {
  const parsed = path.parse(file)
  fs.mkdirSync(parsed.dir === '' ? '.' : parsed.dir, { recursive: true })
  if (fs.existsSync(file)) {
    fs.renameSync(
      file,
      path.join(parsed.dir, `${parsed.name}.prev${parsed.ext}`)
    )
  }
}

/**
 * Creates the dev-server plugin.
 *
 * @param options {object}
 * @param [options.file] {string} - the NDJSON file path.
 * @param [options.maxRequestBytes] {number}
 * @param [options.maxFileBytes] {number}
 * @returns {object} - a Vite plugin (typed structurally to keep the
 *   package dependency-free).
 */
export function interopLoggerPlugin(
  options: {
    file?: string
    maxRequestBytes?: number
    maxFileBytes?: number
  } = {}
): {
  name: string
  apply: 'serve'
  configureServer(server: {
    middlewares: {
      use(
        route: string,
        handler: (req: IncomingMessage, res: ServerResponse) => void
      ): void
    }
  }): void
} {
  const file = options.file ?? path.join('.dev-logs', 'app.ndjson')
  const maxRequestBytes = options.maxRequestBytes ?? 1024 * 1024
  const maxFileBytes = options.maxFileBytes ?? 32 * 1024 * 1024

  function refuse(res: ServerResponse, statusCode: number): void {
    res.statusCode = statusCode
    res.end()
  }

  function append(body: string, res: ServerResponse): void {
    let fileBytes: number
    try {
      fileBytes = fs.statSync(file).size
    } catch {
      fileBytes = 0
    }
    if (fileBytes + body.length > maxFileBytes) {
      refuse(res, 507)
      return
    }
    const parsedLines: Record<string, unknown>[] = []
    for (const rawLine of body.split('\n')) {
      if (rawLine.trim().length === 0) {
        continue
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(rawLine)
      } catch {
        refuse(res, 400)
        return
      }
      if (!isLogEventLine(parsed)) {
        refuse(res, 400)
        return
      }
      parsedLines.push(projectLine(parsed))
    }
    if (parsedLines.length > 0) {
      fs.appendFileSync(
        file,
        parsedLines.map(line => JSON.stringify(line)).join('\n') + '\n'
      )
    }
    refuse(res, 204)
  }

  return {
    name: 'interop-logger',
    apply: 'serve',
    configureServer(server): void {
      rotate(file)
      server.middlewares.use(
        ENDPOINT_PATH,
        function handleLogPost(
          req: IncomingMessage,
          res: ServerResponse
        ): void {
          if (req.method !== 'POST') {
            refuse(res, 405)
            return
          }
          if (!isSameOrigin(req)) {
            refuse(res, 403)
            return
          }
          const chunks: Buffer[] = []
          let received = 0
          let refused = false
          req.on('data', function onChunk(chunk: Buffer): void {
            received += chunk.length
            if (received > maxRequestBytes) {
              refused = true
              refuse(res, 413)
              req.destroy()
              return
            }
            chunks.push(chunk)
          })
          req.on('end', function onEnd(): void {
            if (refused) {
              return
            }
            append(Buffer.concat(chunks).toString('utf8'), res)
          })
          req.on('error', function onError(): void {
            // the response is already refused or the socket is gone
          })
        }
      )
    }
  }
}

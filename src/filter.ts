/*!
 * Copyright (c) 2026 Interop Alliance. All rights reserved.
 */

/**
 * The wildcard namespace filter: a comma-separated pattern list where `*`
 * matches any suffix and a `-` prefix negates (the grammar borrowed from the
 * `debug` package). The filter gates `debug`-level events only.
 */

interface CompiledFilter {
  names: RegExp[]
  skips: RegExp[]
}

let cachedPattern: string | null = null
let cachedFilter: CompiledFilter | null = null

/**
 * Compiles one filter pattern list into match and skip regexps.
 *
 * @param pattern {string}
 * @returns {CompiledFilter}
 */
function compileFilter(pattern: string): CompiledFilter {
  const names: RegExp[] = []
  const skips: RegExp[] = []
  for (const rawEntry of pattern.split(/[\s,]+/)) {
    if (rawEntry.length === 0) {
      continue
    }
    const negated = rawEntry.startsWith('-')
    const body = negated ? rawEntry.slice(1) : rawEntry
    if (body.length === 0) {
      continue
    }
    const source =
      '^' +
      body.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*?') +
      '$'
    const regexp = new RegExp(source)
    if (negated) {
      skips.push(regexp)
    } else {
      names.push(regexp)
    }
  }
  return { names, skips }
}

/**
 * Reports whether a namespace matches a filter pattern list. The compiled
 * form of the most recent pattern is cached, so the steady-state cost of an
 * unmatched `debug` event is one predicate call.
 *
 * @param options {object}
 * @param options.pattern {string}
 * @param options.ns {string}
 * @returns {boolean}
 */
export function matchesFilter({
  pattern,
  ns
}: {
  pattern: string
  ns: string
}): boolean {
  if (pattern !== cachedPattern || cachedFilter === null) {
    cachedPattern = pattern
    cachedFilter = compileFilter(pattern)
  }
  for (const skip of cachedFilter.skips) {
    if (skip.test(ns)) {
      return false
    }
  }
  for (const name of cachedFilter.names) {
    if (name.test(ns)) {
      return true
    }
  }
  return false
}

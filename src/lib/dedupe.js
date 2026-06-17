/**
 * in-flight de-dupe + 짧은 완료 캐시 — 검색 폴링 비용 절감 (codex S1 권고, S2 이관).
 *
 * 같은 키(동일 검색조건+market IP)의 요청이 동시에 들어오면 진행 중인 promise 1개를 공유한다.
 * 완료된 결과는 짧은 TTL 동안 캐시해 재마운트/재시도/동일조건 재요청의 중복 폴링을 막는다.
 * 실패(reject)는 캐시하지 않는다 — 다음 요청이 즉시 재시도.
 *
 * ⚠ 키에 clientIp(market) 를 포함한다: KAYAK 가격·세금이 IP market 종속이라 IP 다른 손님끼리
 *   결과를 공유하면 안 된다. 같은 IP(개발실·운영 동일 egress) 손님끼리만 공유된다.
 */

const inflight = new Map() // key → Promise
const done = new Map() // key → { value, expires }

const DEFAULT_TTL_MS = Number(process.env.SEARCH_CACHE_TTL_MS ?? 45_000)
// done 캐시 최대 엔트리. 트래픽이 멈춰 lazy GC 가 안 돌아도 메모리가 무한정 늘지 않도록 상한.
const MAX_DONE = Number(process.env.SEARCH_CACHE_MAX ?? 200)

/** 만료 엔트리 청소 + 크기 상한 강제(Map 삽입순=오래된 것부터 제거). */
function gc() {
  const now = Date.now()
  for (const [k, e] of done) if (e.expires <= now) done.delete(k)
  // 만료 청소 후에도 상한 초과면 가장 오래된 엔트리부터 제거(트래픽 정지 시 잔류 방지).
  while (done.size > MAX_DONE) {
    const oldest = done.keys().next().value
    if (oldest === undefined) break
    done.delete(oldest)
  }
}

/**
 * @param {string} key 검색조건+IP 직렬화 키
 * @param {() => Promise<any>} fn 실제 KAYAK 호출+어댑터(없을 때만 실행)
 * @param {{ttlMs?:number}} opts
 */
export async function dedupe(key, fn, { ttlMs = DEFAULT_TTL_MS } = {}) {
  const now = Date.now()
  const cached = done.get(key)
  if (cached && cached.expires > now) return cached.value

  const running = inflight.get(key)
  if (running) return running

  const p = (async () => {
    try {
      const value = await fn()
      done.set(key, { value, expires: Date.now() + ttlMs })
      return value
    } finally {
      inflight.delete(key)
      gc()
    }
  })()
  inflight.set(key, p)
  return p
}

/** 테스트용 reset. */
export function _resetDedupe() {
  inflight.clear()
  done.clear()
}

/** 테스트용: 완료 캐시 현재 크기. */
export function _doneSize() {
  return done.size
}

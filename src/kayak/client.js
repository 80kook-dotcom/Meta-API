/**
 * KAYAK Affiliate API 저수준 호출 래퍼 (S1 연결).
 *
 * 책임: ① URL 조립(host+path+query) + apiKey 주입  ② 헤더(검색만 UA + x-original-client-ip)
 *       ③ 단일 호출 fetch + 네트워크 타임아웃  ④ JSON / NDJSON 파싱
 *       ⑤ 검색 비동기 폴링(isComplete=false → 재호출, codex 권고 A=서버 블로킹)
 *
 * 🔴 검색 API(/api/3.0/*)만 헤더 2개 필수:
 *    - User-Agent          : 실 브라우저값 (curl 기본=403, Postman=400)
 *    - x-original-client-ip: 최종 사용자 IP (없으면 400 MISSING_ORIGINAL_CLIENT_IP_HEADER)
 *  자동완성·정적피드·리포팅은 헤더 불필요.
 *
 * 어댑터(KAYAK 응답 → 앱 타입 변환)는 S2~. 이 모듈은 RAW KAYAK 응답을 반환한다.
 */
import { config } from '../config.js'

/** KAYAK 호출 실패를 의미있는 코드로 감싸는 에러. */
export class KayakError extends Error {
  constructor(message, { status, code, body, retryable = false } = {}) {
    super(message)
    this.name = 'KayakError'
    this.status = status ?? 502 // 중계→앱 기본 502(업스트림 오류)
    this.code = code ?? 'KAYAK_UPSTREAM_ERROR'
    this.body = body
    // 일시(transient) 오류 여부 — 폴링 중 재시도 가능(네트워크/타임아웃/업스트림 5xx·429). S6·#22.
    this.retryable = retryable
  }
}

/** 검색 API 공통 헤더. clientIp = 손님 실 IP(서버 계산값). */
export function searchHeaders(clientIp) {
  return {
    'User-Agent': config.searchUserAgent,
    'x-original-client-ip': clientIp,
  }
}

/** host + path + query → URL. query 값이 null/undefined 면 생략. apiKey 는 호출부에서 query 에 포함. */
export function buildUrl(host, path, query = {}) {
  const url = new URL(path, host)
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue
    url.searchParams.set(k, String(v))
  }
  return url.toString()
}

/** 비밀 키를 로그/에러에 노출하지 않도록 URL 의 apiKey 값을 가린다. */
export function redactUrl(url) {
  return String(url).replace(/(apiKey=)[^&]*/i, '$1***')
}

/** NDJSON(application/x-ndjson) 본문 → 객체 배열. 빈 줄 무시. */
export function parseNdjson(text) {
  const out = []
  for (const line of text.split('\n')) {
    const s = line.trim()
    if (!s) continue
    out.push(JSON.parse(s))
  }
  return out
}

/**
 * 단일 KAYAK 호출(폴링 1회분). 200 외에는 KayakError.
 * @param {string} url  완성된 URL(apiKey 포함)
 * @param {object} opts { headers?, ndjson?, signal? }
 */
export async function fetchOnce(url, { headers = {}, ndjson = false, signal } = {}) {
  // 호출부 signal 이 없으면 자체 타임아웃 적용.
  const timeoutSignal = signal ?? AbortSignal.timeout(config.requestTimeoutMs)
  let res
  try {
    res = await fetch(url, { headers, signal: timeoutSignal })
  } catch (e) {
    const aborted = e?.name === 'AbortError' || e?.name === 'TimeoutError'
    // 네트워크/타임아웃은 일시 오류 → 폴링 재시도 대상(retryable).
    throw new KayakError(
      aborted ? `KAYAK 응답 타임아웃(${config.requestTimeoutMs}ms)` : `네트워크 오류: ${e?.message}`,
      { status: 504, code: aborted ? 'KAYAK_TIMEOUT' : 'KAYAK_NETWORK_ERROR', retryable: true },
    )
  }

  const bodyText = await res.text()
  if (!res.ok) {
    // 일시 오류(재시도 가치 있음): 업스트림 5xx·429(rate-limit). 4xx(400/403 등)는 요청 자체 문제 → terminal.
    const retryable = res.status >= 500 || res.status === 429
    // 400/403 등 — KAYAK 본문(있으면)을 그대로 진단에 싣되 키는 노출 안 됨(URL 만 redact).
    throw new KayakError(`KAYAK ${res.status} (${redactUrl(url)})`, {
      status: res.status === 403 || res.status === 400 ? 502 : res.status,
      code: `KAYAK_HTTP_${res.status}`,
      body: bodyText.slice(0, 500),
      retryable,
    })
  }

  if (ndjson) return parseNdjson(bodyText)
  try {
    return JSON.parse(bodyText)
  } catch {
    throw new KayakError(`KAYAK 응답 JSON 파싱 실패 (${redactUrl(url)})`, {
      status: 502,
      code: 'KAYAK_BAD_JSON',
      body: bodyText.slice(0, 200),
    })
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * KAYAK 호출 공통 진입점.
 * - 일반(자동완성·정적·리포팅): fetchOnce 1회.
 * - 검색(poll=true): isComplete=true 까지 같은 URL 재호출(서버 블로킹 폴링).
 *   간격·최대횟수·전체 타임아웃은 config.poll. 타임아웃 시 KAYAK_TIMEOUT(504).
 *
 * @param {string} url  완성된 URL(apiKey 포함)
 * @param {object} opts { headers?, ndjson?, poll? }
 * @returns RAW KAYAK 응답(어댑터는 S2~)
 */
export async function callKayak(url, { headers = {}, ndjson = false, poll = false } = {}) {
  if (!poll) return fetchOnce(url, { headers, ndjson })

  const { intervalMs, maxAttempts, timeoutMs, maxTransientRetries } = config.poll
  const deadline = Date.now() + timeoutMs
  let last
  // 연속 일시오류 카운터(S6·#22). deadline 안에서 재시도하되 연속 transient 가 상한을 넘으면 포기 —
  // 업스트림 장애 시 KAYAK·자체 서버를 계속 두드리지 않도록 보호(codex 결정3).
  let consecutiveTransient = 0
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) break
    // 폴링 1회는 남은 전체 타임아웃과 단일 요청 타임아웃 중 작은 값으로 제한.
    const perCall = Math.min(remaining, config.requestTimeoutMs)
    try {
      last = await fetchOnce(url, { headers, signal: AbortSignal.timeout(perCall) })
      consecutiveTransient = 0 // 성공 응답(미완성이라도) → 연속 카운터 리셋.
      if (last?.isComplete) return last
    } catch (e) {
      // terminal(4xx 등 재시도 무의미)은 즉시 전파. 일시 오류만 상한 내 재시도.
      if (!(e instanceof KayakError) || !e.retryable) throw e
      consecutiveTransient += 1
      if (consecutiveTransient > maxTransientRetries) throw e // 연속 transient 상한 초과 → 포기.
    }
    if (attempt < maxAttempts && deadline - Date.now() > intervalMs) await sleep(intervalMs)
  }
  // 미완성으로 종료 — 부분응답 대신 명확한 타임아웃(codex 권고: 데모는 504+메시지).
  throw new KayakError(`검색 가격수집 미완료(폴링 ${maxAttempts}회·${timeoutMs}ms 초과)`, {
    status: 504,
    code: 'KAYAK_SEARCH_INCOMPLETE',
    body: last ? { isComplete: false, totalResults: last.totalResults } : undefined,
  })
}

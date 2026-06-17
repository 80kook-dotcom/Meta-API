/**
 * 환경변수 로딩·검증.
 * 키는 절대 소스/깃에 두지 않는다 — `.env`(로컬) 또는 운영 서버 환경변수로만 주입.
 */
import process from 'node:process'

// .env 파일이 있으면 로드(없으면 OS 환경변수만 사용). Node 20.12+ 내장.
try {
  process.loadEnvFile(new URL('../.env', import.meta.url))
} catch {
  // .env 없음 — OS 환경변수로 주입된 경우 정상. 키 누락은 missingSecrets() 로 검증.
}

/** 쉼표 구분 환경변수 → 트림된 비어있지 않은 문자열 배열. */
function splitCsv(s) {
  return String(s ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
}

/**
 * 숫자 환경변수 파싱 + 검증 (S6 적대리뷰 #7·fail-fast).
 * 잘못된 값(오타로 NaN·음수·비정수)은 기동 시 throw 한다 — 조용히 NaN 이 폴링/캐시/토큰 TTL 로
 * 흘러들어 무한/즉시 루프·캐시 무력화·TTL 우회를 일으키는 것을 막는다. env 미설정이면 fallback(유효).
 */
export function num(raw, fallback, { min = 0, max = Infinity, integer = true, name } = {}) {
  const v = Number(raw ?? fallback)
  if (!Number.isFinite(v) || (integer && !Number.isInteger(v)) || v < min || v > max) {
    throw new Error(
      `환경변수 ${name} 값이 올바르지 않습니다(받음: ${JSON.stringify(raw)}). ` +
        `${integer ? '정수' : '수'}·범위 [${min}, ${max === Infinity ? '∞' : max}] 이어야 합니다.`,
    )
  }
  return v
}

// 운영 환경 플래그(S6). RELAY_ENV 우선, 없으면 NODE_ENV, 기본 development.
// production 이면 기동 시 보안 설정을 강제(validateProductionConfig·fail-fast).
const relayEnv = (process.env.RELAY_ENV ?? process.env.NODE_ENV ?? 'development').toLowerCase()

export const config = {
  port: num(process.env.PORT, 8787, { min: 0, max: 65535, name: 'PORT' }),

  // 운영 모드 여부(S6). 라우트/health/검증이 이 값을 읽는다(테스트가 토글 가능).
  relayEnv,
  isProduction: relayEnv === 'production',

  // KAYAK affiliate 호스트. 운영 확정 = ko-kr (실측). 샌드박스 sandbox-en-us 는 403. S1 에서 재확인.
  kayakHost: process.env.KAYAK_HOST ?? 'https://ko-kr.kayakaffiliates.com',
  reportingHost: process.env.KAYAK_REPORTING_HOST ?? 'https://api.affiliates.hotelscombined.com',

  // 비밀 키 (검색·정적·자동완성 공용 / 리포팅 전용)
  apiKey: process.env.KAYAK_API_KEY ?? '',
  reportingKey: process.env.KAYAK_REPORTING_KEY ?? '',

  // 딥링크 a= 값 (공개값·비밀 아님)
  affiliateId: process.env.KAYAK_AFFILIATE_ID ?? '',

  // 검색 API 필수 User-Agent (curl/Postman 기본값은 차단됨)
  searchUserAgent:
    process.env.KAYAK_SEARCH_UA ??
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',

  // CORS 허용 오리진(쉼표 구분). 기본 로컬 vite + 배포 도메인.
  // ⚠ 운영(production)에서는 localhost 포함/빈 목록이면 기동 거부(validateProductionConfig).
  allowedOrigins: splitCsv(
    process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173,http://localhost:4173,https://meta-re.pages.dev',
  ),

  // ── 통화·언어 SSOT + 허용목록(S6·#21) ──
  // KAYAK 계정 KRW 고정(다통화는 KAYAK 회신 대기). 비허용 값 요청은 400(무음 오표기 금지·lib/market.js).
  market: {
    currencyCode: process.env.DEFAULT_CURRENCY ?? 'KRW',
    languageCode: process.env.DEFAULT_LANGUAGE ?? 'ko_KR',
    supportedCurrencies: splitCsv(process.env.SUPPORTED_CURRENCIES ?? 'KRW'),
    supportedLanguages: splitCsv(process.env.SUPPORTED_LANGUAGES ?? 'ko_KR'),
  },

  // 자동완성 단기 캐시(ms·S6·#22). 디바운스 타이핑 반복 쿼리의 KAYAK 호출 쿼터 절감(market 무관).
  autocompleteCacheTtlMs: num(process.env.AUTOCOMPLETE_CACHE_TTL_MS, 60_000, { min: 0, name: 'AUTOCOMPLETE_CACHE_TTL_MS' }),

  // ── 검색 비동기 폴링 예산(S1·codex 권고: A=서버 블로킹 폴링) ──
  // 첫 응답 isComplete=false → 같은 요청 재호출. 간격·최대횟수·전체 타임아웃.
  poll: {
    intervalMs: num(process.env.KAYAK_POLL_INTERVAL_MS, 1000, { min: 0, name: 'KAYAK_POLL_INTERVAL_MS' }),
    maxAttempts: num(process.env.KAYAK_POLL_MAX_ATTEMPTS, 10, { min: 1, name: 'KAYAK_POLL_MAX_ATTEMPTS' }),
    timeoutMs: num(process.env.KAYAK_POLL_TIMEOUT_MS, 12000, { min: 1, name: 'KAYAK_POLL_TIMEOUT_MS' }),
    // 폴링 중 연속 일시오류(네트워크/타임아웃/5xx) 재시도 상한(S6·#22·S2 적대리뷰 이관).
    // deadline 안에서 재시도하되 연속 실패가 이 수를 넘으면 포기(장애 시 업스트림 과호출 방지).
    maxTransientRetries: num(process.env.KAYAK_POLL_MAX_TRANSIENT, 3, { min: 0, name: 'KAYAK_POLL_MAX_TRANSIENT' }),
  },
  // 단일 KAYAK 호출(폴링 1회분) 네트워크 타임아웃.
  requestTimeoutMs: num(process.env.KAYAK_REQUEST_TIMEOUT_MS, 8000, { min: 1, name: 'KAYAK_REQUEST_TIMEOUT_MS' }),

  // ── 캐시백 리포팅(S5) ──
  // Reporting 은 startDate~endDate 필수. 미지정 시 기본 조회 창(일). 최근 N일치 거래.
  cashback: {
    lookbackDays: num(process.env.CASHBACK_LOOKBACK_DAYS, 400, { min: 1, name: 'CASHBACK_LOOKBACK_DAYS' }),
    // 단일 페이지 조회 건수(회원 1인의 거래는 보통 소량). 초과분은 truncation 로그로 경고.
    pageSize: num(process.env.CASHBACK_PAGE_SIZE, 1000, { min: 1, name: 'CASHBACK_PAGE_SIZE' }),
    // 정산 경과 추론 임계 '일'(ET 기준 paymentMonth 다음 달 N일 이후 → Approved). adapters/cashback.js 참조.
    settleDay: num(process.env.CASHBACK_SETTLE_DAY, 26, { min: 1, max: 31, name: 'CASHBACK_SETTLE_DAY' }),
    // ── 라벨 서명(S6·#11/D2·IDOR 방어) ──
    // 설정 시 /api/cashback 이 exp+sig(HMAC-SHA256(label.exp)) 를 강제. 미설정(개발/데모)=현행 trust-label.
    labelHmacSecret: process.env.CASHBACK_LABEL_HMAC_SECRET ?? '',
    // 라벨 서명 허용 최대 수명(초). 발급 후 이보다 만료가 먼 장기 토큰은 거부(codex: 짧은 만료).
    labelTokenMaxAgeSec: num(process.env.CASHBACK_LABEL_MAX_AGE_SEC, 300, { min: 0, name: 'CASHBACK_LABEL_MAX_AGE_SEC' }),
  },

  // ── 보안 hook (S1 골격·기본 비활성=로컬 개발 허용 / 운영 S6에서 강제) ──
  security: {
    // 앱↔중계 공유 시크릿. 설정 시 /api 요청에 x-relay-secret 헤더 강제.
    // 공개 SPA에선 완전 비밀 불가(임시 남용 억제용). 미설정 시 통과(개발).
    relaySharedSecret: process.env.RELAY_SHARED_SECRET ?? '',
    // IP당 분당 최대 요청. 0=비활성(개발). 운영 데모 전 양수로.
    rateLimitPerMin: num(process.env.RATE_LIMIT_PER_MIN, 0, { min: 0, name: 'RATE_LIMIT_PER_MIN' }),
    // origin 없는 요청(curl·서버간) 허용 여부. 개발=true, 운영 데모=false 권장.
    allowNoOrigin: (process.env.ALLOW_NO_ORIGIN ?? 'true') !== 'false',
  },

  // ── 클라이언트 IP 신뢰경계(codex #2/#13) ──
  // 들어온 x-original-client-ip 는 신뢰하지 않고 서버가 계산한다.
  // 신뢰 프록시 hop 수(0=직결, CF/LB 뒤면 그 hop 수). XFF 위조 방지.
  trustProxyHops: num(process.env.TRUST_PROXY_HOPS, 0, { min: 0, name: 'TRUST_PROXY_HOPS' }),
  // 개발 폴백 client IP(localhost 등 공인 IP 산출 불가 시). 임의 IP 금지 → 우리 개발실 egress.
  devClientIp: process.env.DEV_CLIENT_IP ?? '58.75.223.130',
}

/** 누락된 비밀 키 '이름'만 반환(값은 절대 노출 안 함). 서버 기동은 하되 경고용. */
export function missingSecrets() {
  const miss = []
  if (!config.apiKey) miss.push('KAYAK_API_KEY')
  if (!config.reportingKey) miss.push('KAYAK_REPORTING_KEY')
  if (!config.affiliateId) miss.push('KAYAK_AFFILIATE_ID')
  return miss
}

/**
 * 운영(production) 설정 강제 검증 — fail-fast (S6·#16/#12/#13·codex 결정1).
 *
 * 키를 쥔 PUBLIC 프록시는 '불완전 기동'보다 '기동 실패'가 안전(codex). 운영인데 보안 게이트가
 * 비어 있으면 fatal 로 모아 server.js 가 기동을 중단한다. 비치명 위험은 warn 으로 경고만 한다.
 * (개발 모드면 빈 결과 — 로컬은 관대.) config.* 를 라이브로 읽어 테스트가 토글 가능.
 *
 * @returns {{fatal:string[], warn:string[]}}
 */
export function validateProductionConfig() {
  const fatal = []
  const warn = []
  if (!config.isProduction) return { fatal, warn }

  const sec = config.security
  // ── fatal: 운영 필수 보안 게이트 ──
  if (!sec.relaySharedSecret) fatal.push('RELAY_SHARED_SECRET 미설정 — 운영은 앱↔중계 공유 시크릿 필수')
  if (!(sec.rateLimitPerMin > 0)) fatal.push('RATE_LIMIT_PER_MIN<=0 — 운영은 IP당 분당 요청 제한(rate-limit) 필수')
  if (sec.allowNoOrigin) fatal.push('ALLOW_NO_ORIGIN=true — 운영은 origin 없는 요청(curl·서버간)을 차단(false)해야 함')
  if (!config.allowedOrigins.length) fatal.push('ALLOWED_ORIGINS 비어 있음 — 운영 앱 도메인을 명시해야 함')
  const localhostOrigins = config.allowedOrigins.filter((o) => /localhost|127\.0\.0\.1|\[::1\]/i.test(o))
  if (localhostOrigins.length) fatal.push(`ALLOWED_ORIGINS 에 로컬 도메인 포함(${localhostOrigins.join(', ')}) — 운영에서 제거`)
  const miss = missingSecrets()
  if (miss.length) fatal.push(`KAYAK 키 미설정: ${miss.join(', ')}`)

  // ── warn: 권고(기동은 허용) ──
  if (!config.cashback.labelHmacSecret) {
    warn.push('CASHBACK_LABEL_HMAC_SECRET 미설정 — 캐시백 임의 라벨 조회(IDOR) 방어 비활성. 캐시백을 운영 노출 시 설정 권고')
  }
  if (config.trustProxyHops === 0) {
    warn.push('TRUST_PROXY_HOPS=0 — 프록시(CF/LB) 뒤 운영이면 손님 실 IP 대신 프록시 IP 가 KAYAK 에 전달됨. hop 수 설정 권고')
  }
  return { fatal, warn }
}

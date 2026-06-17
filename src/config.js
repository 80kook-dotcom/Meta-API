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

export const config = {
  port: Number(process.env.PORT ?? 8787),

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
  allowedOrigins: (
    process.env.ALLOWED_ORIGINS ??
    'http://localhost:5173,http://localhost:4173,https://meta-re.pages.dev'
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  // ── 검색 비동기 폴링 예산(S1·codex 권고: A=서버 블로킹 폴링) ──
  // 첫 응답 isComplete=false → 같은 요청 재호출. 간격·최대횟수·전체 타임아웃.
  poll: {
    intervalMs: Number(process.env.KAYAK_POLL_INTERVAL_MS ?? 1000),
    maxAttempts: Number(process.env.KAYAK_POLL_MAX_ATTEMPTS ?? 10),
    timeoutMs: Number(process.env.KAYAK_POLL_TIMEOUT_MS ?? 12000),
  },
  // 단일 KAYAK 호출(폴링 1회분) 네트워크 타임아웃.
  requestTimeoutMs: Number(process.env.KAYAK_REQUEST_TIMEOUT_MS ?? 8000),

  // ── 캐시백 리포팅(S5) ──
  // Reporting 은 startDate~endDate 필수. 미지정 시 기본 조회 창(일). 최근 N일치 거래.
  cashback: {
    lookbackDays: Number(process.env.CASHBACK_LOOKBACK_DAYS ?? 400),
    // 단일 페이지 조회 건수(회원 1인의 거래는 보통 소량). 초과분은 truncation 로그로 경고.
    pageSize: Number(process.env.CASHBACK_PAGE_SIZE ?? 1000),
    // 정산 경과 추론 임계 '일'(ET 기준 paymentMonth 다음 달 N일 이후 → Approved). adapters/cashback.js 참조.
    settleDay: Number(process.env.CASHBACK_SETTLE_DAY ?? 26),
  },

  // ── 보안 hook (S1 골격·기본 비활성=로컬 개발 허용 / 운영 S6에서 강제) ──
  security: {
    // 앱↔중계 공유 시크릿. 설정 시 /api 요청에 x-relay-secret 헤더 강제.
    // 공개 SPA에선 완전 비밀 불가(임시 남용 억제용). 미설정 시 통과(개발).
    relaySharedSecret: process.env.RELAY_SHARED_SECRET ?? '',
    // IP당 분당 최대 요청. 0=비활성(개발). 운영 데모 전 양수로.
    rateLimitPerMin: Number(process.env.RATE_LIMIT_PER_MIN ?? 0),
    // origin 없는 요청(curl·서버간) 허용 여부. 개발=true, 운영 데모=false 권장.
    allowNoOrigin: (process.env.ALLOW_NO_ORIGIN ?? 'true') !== 'false',
  },

  // ── 클라이언트 IP 신뢰경계(codex #2/#13) ──
  // 들어온 x-original-client-ip 는 신뢰하지 않고 서버가 계산한다.
  // 신뢰 프록시 hop 수(0=직결, CF/LB 뒤면 그 hop 수). XFF 위조 방지.
  trustProxyHops: Number(process.env.TRUST_PROXY_HOPS ?? 0),
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

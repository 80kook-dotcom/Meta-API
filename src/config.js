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
}

/** 누락된 비밀 키 '이름'만 반환(값은 절대 노출 안 함). 서버 기동은 하되 경고용. */
export function missingSecrets() {
  const miss = []
  if (!config.apiKey) miss.push('KAYAK_API_KEY')
  if (!config.reportingKey) miss.push('KAYAK_REPORTING_KEY')
  if (!config.affiliateId) miss.push('KAYAK_AFFILIATE_ID')
  return miss
}

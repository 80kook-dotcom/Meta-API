/**
 * KAYAK Affiliate API 호출 래퍼(골격).
 * S0: 인터페이스·헤더 규약만 정의. 실제 fetch 구현은 S1(연결 테스트)에서.
 *
 * 🔴 검색 API(/api/3.0/*)만 헤더 2개 필수:
 *    - User-Agent          : 실 브라우저값 (curl 기본=403, Postman=400)
 *    - x-original-client-ip: 최종 사용자 IP (없으면 400 MISSING_ORIGINAL_CLIENT_IP_HEADER)
 *  자동완성·정적피드·리포팅은 헤더 불필요.
 */
import { config } from '../config.js'

/** 검색 API 공통 헤더. clientIp = 손님 실 IP(운영) 또는 임의값(개발). */
export function searchHeaders(clientIp) {
  return {
    'User-Agent': config.searchUserAgent,
    'x-original-client-ip': clientIp,
  }
}

/**
 * KAYAK 호출 공통 래퍼(골격).
 * S1 에서 fetch + 쿼리 직렬화 + apiKey 주입 + 헤더 + 폴링/NDJSON 처리를 구현한다.
 */
export async function callKayak() {
  throw new Error('NOT_IMPLEMENTED: KAYAK 호출은 S1(연결 테스트)에서 구현됩니다.')
}

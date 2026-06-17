/**
 * Meta-API — Meta-Re ↔ KAYAK Affiliate API 중계(프록시) 서버 · 기동 진입점.
 *
 * 책임: ① 키 보관(환경변수) ② 화이트리스트 IP(개발실 58.75.223.130)에서 KAYAK 호출
 *       ③ CORS 허용(앱 도메인) ④ KAYAK 응답 → 앱 타입 변환 ⑤ 폴링·constants 캐시
 *
 * 앱 조립은 app.js(createApp). 여기서는 운영 설정 검증(fail-fast) + listen 만 한다.
 * S6(운영 전환): 기동 직전 validateProductionConfig 로 운영 보안 게이트를 강제한다 —
 *   운영(production)인데 시크릿/rate-limit/CORS/키가 미흡하면 기동을 중단한다(codex 결정1).
 */
import { createApp } from './app.js'
import { config, missingSecrets, validateProductionConfig } from './config.js'
import { logger } from './lib/logger.js'

// ── 운영 설정 강제 검증(S6·fail-fast) ──
const { fatal, warn } = validateProductionConfig()
for (const w of warn) logger.warn('운영 설정 경고', { issue: w })
if (fatal.length) {
  for (const f of fatal) logger.error('운영 설정 오류', { issue: f })
  // 키를 쥔 PUBLIC 프록시는 '불완전 기동'보다 '기동 실패'가 안전(codex). 프로세스 종료.
  throw new Error(`운영(production) 보안 설정 미흡 ${fatal.length}건 — 기동 중단. 위 오류를 해결 후 재기동하세요.`)
}

const app = createApp()

app.listen(config.port, () => {
  const missing = missingSecrets()
  logger.info('중계 서버 기동', {
    url: `http://localhost:${config.port}`,
    relayEnv: config.relayEnv,
    kayakHost: config.kayakHost,
    secretsLoaded: missing.length === 0,
    missingSecrets: missing,
  })
  if (missing.length) {
    logger.warn('키 미설정 — 검색/리포팅 호출 전 .env 확인 필요', { missingSecrets: missing })
  }
})

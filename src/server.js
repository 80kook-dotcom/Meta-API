/**
 * Meta-API — Meta-Re ↔ KAYAK Affiliate API 중계(프록시) 서버 · 기동 진입점.
 *
 * 책임: ① 키 보관(환경변수) ② 화이트리스트 IP(개발실 58.75.223.130)에서 KAYAK 호출
 *       ③ CORS 허용(앱 도메인) ④ KAYAK 응답 → 앱 타입 변환(S2~) ⑤ 폴링·constants 캐시(S2~)
 *
 * 앱 조립은 app.js(createApp). 여기서는 listen 만(테스트는 createApp 을 직접 사용).
 * S1(현재): KAYAK 실호출 연결 계층(src/kayak/*) + 연결 테스트(scripts/connection-test.mjs).
 *           HTTP 라우트(/api/*) 어댑터 연결은 S2 부터.
 */
import { createApp } from './app.js'
import { config, missingSecrets } from './config.js'

const app = createApp()

app.listen(config.port, () => {
  const missing = missingSecrets()
  console.log(`[meta-api] 중계 서버 기동 → http://localhost:${config.port}`)
  console.log(`[meta-api] KAYAK host: ${config.kayakHost}`)
  if (missing.length) {
    console.warn(`[meta-api] ⚠ 키 미설정: ${missing.join(', ')} — .env 확인(검색/리포팅 호출 전 필요)`)
  } else {
    console.log('[meta-api] ✓ 키 로드됨(환경변수)')
  }
})

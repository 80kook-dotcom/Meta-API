/**
 * Meta-API — Meta-Re ↔ KAYAK Affiliate API 중계(프록시) 서버.
 *
 * 책임: ① 키 보관(환경변수) ② 화이트리스트 IP(개발실 58.75.223.130)에서 KAYAK 호출
 *       ③ CORS 허용(앱 도메인) ④ KAYAK 응답 → 앱 타입 변환(S2~) ⑤ 폴링·constants 캐시(S2~)
 *
 * S0(현재): 서버 골격 + /health + /api/* 스텁. KAYAK 실호출은 S1 부터.
 */
import express from 'express'
import cors from 'cors'
import { config, missingSecrets } from './config.js'
import autocompleteRouter from './routes/autocomplete.js'
import hotelsRouter from './routes/hotels.js'
import hotelRouter from './routes/hotel.js'
import cashbackRouter from './routes/cashback.js'

const app = express()

// CORS: 앱 도메인만 허용(브라우저가 중계 서버를 직접 호출하므로 필요).
app.use(
  cors({
    origin(origin, cb) {
      // origin 없음(같은 출처·서버간·curl)은 허용. 그 외엔 화이트리스트만.
      if (!origin || config.allowedOrigins.includes(origin)) cb(null, true)
      else cb(new Error(`CORS: origin not allowed (${origin})`))
    },
  }),
)
app.use(express.json())

// 헬스체크 — S0 완료 기준(KAYAK 호출 없이 200). 키는 '이름'만, 값은 절대 노출 안 함.
app.get('/health', (_req, res) => {
  const missing = missingSecrets()
  res.json({
    ok: true,
    service: 'meta-api',
    phase: 'S0-skeleton',
    secretsLoaded: missing.length === 0,
    missingSecrets: missing,
    kayakHost: config.kayakHost,
    time: new Date().toISOString(),
  })
})

// /api/* 라우트 (S0=스텁 501, S1~S5 에서 KAYAK 연동으로 채움).
app.use('/api', autocompleteRouter)
app.use('/api', hotelsRouter)
app.use('/api', hotelRouter)
app.use('/api', cashbackRouter)

// 미구현/미정 경로.
app.use((req, res) => {
  res.status(404).json({ error: 'NOT_FOUND', path: req.path })
})

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

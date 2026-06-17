/**
 * Express 앱 조립 (app/listen 분리 — codex S0 자문 #4ⓐ, 테스트 용이).
 * server.js 는 이 app 을 import 해 listen 만 한다.
 *
 * 미들웨어 순서:
 *   cors → json → clientIp(전역, req.clientIp 산출)
 *   /health (공개)
 *   /api → relayAuth → rateLimit → 라우터(S2~에서 KAYAK 연동으로 채움)
 *   notFound → errorHandler
 */
import express from 'express'
import cors from 'cors'
import { config, missingSecrets } from './config.js'
import { clientIp } from './middleware/clientIp.js'
import { relayAuth } from './middleware/relayAuth.js'
import { rateLimit } from './middleware/rateLimit.js'
import { errorHandler } from './middleware/errorHandler.js'
import autocompleteRouter from './routes/autocomplete.js'
import hotelsRouter from './routes/hotels.js'
import hotelRouter from './routes/hotel.js'
import cashbackRouter from './routes/cashback.js'

export function createApp() {
  const app = express()

  // CORS: 앱 도메인만 허용. origin 없는 요청(curl·서버간)은 allowNoOrigin 설정에 따름.
  app.use(
    cors({
      origin(origin, cb) {
        if (!origin) return cb(config.security.allowNoOrigin ? null : new Error('CORS: origin required'), config.security.allowNoOrigin)
        if (config.allowedOrigins.includes(origin)) return cb(null, true)
        cb(new Error(`CORS: origin not allowed (${origin})`))
      },
    }),
  )
  app.use(express.json())
  app.use(clientIp) // 모든 요청에 신뢰경계 IP 산출

  // 헬스체크 — 공개(인증/rate-limit 앞단). 키는 '이름'만, 값은 절대 노출 안 함.
  app.get('/health', (_req, res) => {
    const missing = missingSecrets()
    res.json({
      ok: true,
      service: 'meta-api',
      phase: 'S2-adapter',
      secretsLoaded: missing.length === 0,
      missingSecrets: missing,
      kayakHost: config.kayakHost,
      time: new Date().toISOString(),
    })
  })

  // /api/* — 인증 hook → rate-limit → 라우터(S1=스텁 501, S2~ KAYAK 연동).
  app.use('/api', relayAuth, rateLimit)
  app.use('/api', autocompleteRouter)
  app.use('/api', hotelsRouter)
  app.use('/api', hotelRouter)
  app.use('/api', cashbackRouter)

  // 미구현/미정 경로.
  app.use((req, res) => {
    res.status(404).json({ error: 'NOT_FOUND', path: req.path })
  })

  app.use(errorHandler)
  return app
}

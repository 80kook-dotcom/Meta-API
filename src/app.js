/**
 * Express 앱 조립 (app/listen 분리 — codex S0 자문 #4ⓐ, 테스트 용이).
 * server.js 는 이 app 을 import 해 listen 만 한다.
 *
 * 미들웨어 순서:
 *   json → clientIp(전역, req.clientIp 산출)
 *   /health · /internal/health (인프라/운영자 면 — CORS 앞단·Origin 헤더 없이 도달 가능)
 *   /api → CORS(브라우저 cross-origin 제어) → relayAuth → rateLimit → 라우터
 *   notFound → errorHandler
 *
 * ⚠ CORS 는 /api 에만 건다(S6 수정). 전역 CORS 는 운영(allowNoOrigin=false)에서 Origin 헤더 없는
 *    인프라 헬스체크(LB·업타임 모니터·curl)까지 403 으로 막는다 → /health 를 못 쓰게 된다.
 *    CORS 는 '브라우저가 /api 를 cross-origin 호출'하는 것을 제어하는 장치이므로 /api 로 한정한다.
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

  app.use(express.json())
  app.use(clientIp) // 모든 요청에 신뢰경계 IP 산출

  // CORS: 앱 도메인만 허용. origin 없는 요청(curl·서버간)은 allowNoOrigin 설정에 따름.
  // /api 에만 적용한다(헬스 엔드포인트는 인프라가 Origin 없이 도달해야 함·위 주석 참고).
  const apiCors = cors({
    origin(origin, cb) {
      if (!origin) return cb(config.security.allowNoOrigin ? null : new Error('CORS: origin required'), config.security.allowNoOrigin)
      if (config.allowedOrigins.includes(origin)) return cb(null, true)
      cb(new Error(`CORS: origin not allowed (${origin})`))
    },
  })

  // 헬스체크 — 공개(인증/rate-limit 앞단).
  // ⚠ 운영(production)에서는 {ok:true} 로 최소화한다(codex 결정5·#3): 공개 면에 kayakHost·키 이름·
  //   phase 등 내부 정보를 노출하지 않는다. 상세 진단은 보호된 /internal/health 로(운영자 전용).
  app.get('/health', (_req, res) => {
    if (config.isProduction) return res.json({ ok: true })
    const missing = missingSecrets()
    res.json({
      ok: true,
      service: 'meta-api',
      phase: 'S6-ops',
      relayEnv: config.relayEnv,
      secretsLoaded: missing.length === 0,
      missingSecrets: missing,
      kayakHost: config.kayakHost,
      time: new Date().toISOString(),
    })
  })

  // 내부 진단 — 운영자 전용. relaySharedSecret 설정 시 x-relay-secret 헤더 일치해야 노출(미설정=개발·노출).
  // 운영의 상세 헬스(설정 점검·키 로드 여부·보안 게이트 상태)는 여기서만 본다(공개 /health 와 분리·codex).
  app.get('/internal/health', (req, res) => {
    const secret = config.security.relaySharedSecret
    // 운영 이중 방어선(적대리뷰 #5): validateProductionConfig 가 운영에서 시크릿을 fatal 로 강제하지만,
    // 혹시라도 시크릿 없이 운영 모드로 도달하면 상세를 노출하지 않고 차단한다(server.js 미경유 진입 등).
    if (config.isProduction && !secret) {
      return res.status(503).json({ error: 'SERVICE_UNAVAILABLE', message: '보안 설정 미흡으로 진단을 제공하지 않습니다.' })
    }
    if (secret && req.headers['x-relay-secret'] !== secret) {
      return res.status(401).json({ error: 'UNAUTHORIZED', message: '내부 진단 접근 권한이 없습니다.' })
    }
    const missing = missingSecrets()
    res.json({
      ok: true,
      service: 'meta-api',
      phase: 'S6-ops',
      relayEnv: config.relayEnv,
      secretsLoaded: missing.length === 0,
      missingSecrets: missing,
      kayakHost: config.kayakHost,
      reportingHost: config.reportingHost,
      market: config.market,
      security: {
        relayAuth: !!secret,
        rateLimitPerMin: config.security.rateLimitPerMin,
        allowNoOrigin: config.security.allowNoOrigin,
        trustProxyHops: config.trustProxyHops,
        cashbackLabelHmac: !!config.cashback.labelHmacSecret,
      },
      time: new Date().toISOString(),
    })
  })

  // /api/* — CORS(브라우저 cross-origin) → 인증 hook → rate-limit → 라우터.
  app.use('/api', apiCors, relayAuth, rateLimit)
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

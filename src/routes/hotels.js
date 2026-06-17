import { Router } from 'express'

const router = Router()

/**
 * GET /api/hotels?...  →  앱 { results, totalCount }
 * 매핑(S1~S2): GET {KAYAK_HOST}/api/3.0/hotels
 *   ?apiKey=&userTrackId=&destination=&checkin=&checkout=&rooms=
 *   &currencyCode=KRW&languageCode=ko_KR
 *   &responseOptions=topRates,images,features,filter,destination
 *   &onlyIfComplete=false&includeTaxesInTotal=true
 * 🔴 필수 헤더: User-Agent(실 브라우저값) + x-original-client-ip(사용자 IP)
 * 비동기: 첫 응답 isComplete=false → isComplete=true 까지 폴링.
 */
router.get('/hotels', (_req, res) => {
  res.status(501).json({
    error: 'NOT_IMPLEMENTED',
    phase: 'S0',
    note: 'KAYAK Hotel Search(다중) 연동은 S1~S2 에서 구현됩니다.',
    willMapTo: 'GET {KAYAK_HOST}/api/3.0/hotels',
  })
})

export default router

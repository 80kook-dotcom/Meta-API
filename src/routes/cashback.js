import { Router } from 'express'
import { config } from '../config.js'
import { getTransactions } from '../kayak/endpoints.js'
import { adaptTransactions } from '../adapters/cashback.js'
import { dedupe } from '../lib/dedupe.js'
import { verifyLabelToken } from '../lib/labelToken.js'
import { logger } from '../lib/logger.js'

const router = Router()

/**
 * GET /api/cashback?labels=&startDate=&endDate=&pageSize=  →  앱 CashbackTxn[]
 * KAYAK: GET {REPORTING_HOST}/api/transactions/hotels?apiKey={reportingKey}&startDate=&endDate=&labels=&pageSize=
 *   (헤더 X-Version:2.0 · IP + Reporting Key 필수 → 반드시 중계). 상태규칙·매핑은 adapters/cashback.js.
 *
 * 🔒 [11·보안] `labels` 는 **단일·필수**. 누락/빈 값이면 KAYAK 을 호출하지 않고 400 으로 차단한다.
 *    ⚠ KAYAK 은 labels 를 생략하면 affiliate **전 회원**의 거래를 반환한다(RAML) → 대량 유출.
 *    → 빈 라벨로는 절대 호출하지 않는다(누출 자체를 불가능하게).
 *    문자셋·길이 제한으로 다회원 일괄조회(콤마)·주입을 차단(codex D2). 단일 라벨만 허용.
 *    ⚠ 잔여 IDOR: 이 중계는 stateless(서버 세션 없음)라 앱이 보낸 라벨을 신뢰한다. 라벨은 이미
 *      딥링크 p= 로 공개되는 비PII 값이라 치명적이진 않으나, 운영(S6)에서는 allmytour 인증 백엔드가
 *      발급한 서명 토큰(JWT/HMAC)에서 라벨을 도출해 임의 라벨 조회를 막아야 한다(codex 권고).
 */

// 라벨 허용 문자셋: URL-safe unreserved(RFC3986) — UUID(userTrackId)·비PII memberId 커버. 콤마 불가 → 단일.
const LABEL_RE = /^[A-Za-z0-9._~-]{1,128}$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

router.get('/cashback', async (req, res, next) => {
  try {
    // 캐시백은 회원 1인 단위 데이터 → 중간 캐시/브라우저 히스토리에 남기지 않는다(no-store).
    // sig 가 query 에 실릴 수 있어(codex 권고) 캐싱·재현을 막는다.
    res.setHeader('Cache-Control', 'no-store')

    const now = new Date()

    // ── [11] 라벨 게이팅 ──
    // 배열 쿼리(?labels=a&labels=b)는 Express 가 배열로 파싱 → 명시적으로 거부(다회원 일괄조회 차단·의도 명확화).
    if (Array.isArray(req.query.labels)) {
      return res.status(400).json({
        error: 'INVALID_LABEL',
        message: '라벨은 단일 값이어야 합니다(배열·콤마 구분 불가).',
      })
    }
    const labels = String(req.query.labels ?? '').trim()
    if (!labels) {
      // 빈 라벨로 호출하면 전 회원 유출 → 호출하지 않고 차단. 200 [] 로 앱 버그를 가리지 않는다(codex D1).
      return res.status(400).json({
        error: 'MISSING_LABELS',
        message: '회원 라벨(labels)이 필요합니다. 빈 라벨로는 조회할 수 없습니다.',
      })
    }
    if (!LABEL_RE.test(labels)) {
      return res.status(400).json({
        error: 'INVALID_LABEL',
        message: '라벨 형식이 올바르지 않습니다(단일 값·URL-safe 문자·최대 128자).',
      })
    }

    // ── [11/D2·S6] 라벨 서명 검증(IDOR 방어) ──
    // CASHBACK_LABEL_HMAC_SECRET 설정 시에만 강제. 인증 백엔드가 회원 본인 라벨에 대해 발급한
    // exp+sig(HMAC-SHA256(label.exp))를 검증해 임의 라벨 조회를 막는다. 미설정(개발/데모)=현행 trust-label.
    const hmacSecret = config.cashback.labelHmacSecret
    if (hmacSecret) {
      const v = verifyLabelToken({
        label: labels,
        exp: req.query.exp,
        sig: req.query.sig,
        secret: hmacSecret,
        nowSec: Math.floor(now.getTime() / 1000),
        maxAgeSec: config.cashback.labelTokenMaxAgeSec,
      })
      if (!v.ok) return res.status(v.status).json({ error: v.code, message: v.message })
    }

    // ── 조회 기간(미지정 시 기본 창) ──
    // ⚠ 기본 창은 의도적으로 넉넉하다(최근 lookbackDays 일 ~ 내일). KAYAK 은 ET 기준이나 시작은 ~400일 전,
    //   종료는 UTC 내일(+1일)이라 ET 의 오늘/어제 경계가 창 안에 완전히 포함된다(경계 누락 불가).
    //   정밀 기간이 필요하면 앱이 startDate·endDate 를 명시 전달한다(그때 정확한 범위 사용).
    const end = new Date(now)
    end.setUTCDate(end.getUTCDate() + 1)
    const start = new Date(now)
    start.setUTCDate(start.getUTCDate() - config.cashback.lookbackDays)
    const startDate = String(req.query.startDate ?? '').trim() || start.toISOString().slice(0, 10)
    const endDate = String(req.query.endDate ?? '').trim() || end.toISOString().slice(0, 10)
    if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) {
      return res.status(400).json({
        error: 'INVALID_DATE',
        message: 'startDate·endDate 는 YYYY-MM-DD 형식이어야 합니다.',
      })
    }
    // 논리적 범위 검증 — KAYAK 은 start>end 를 invalid 로 거부(RAML). 중계에서 먼저 차단(GIGO 방지).
    if (startDate > endDate) {
      return res.status(400).json({
        error: 'INVALID_DATE_RANGE',
        message: 'startDate 는 endDate 보다 이후일 수 없습니다.',
      })
    }

    const pageSize = config.cashback.pageSize

    // de-dupe 키: 회원 라벨 + 기간(IP 무관 — 캐시백은 market 종속이 아니라 회원 종속). 콜론 접두로 네임스페이스.
    const key = `cb:${JSON.stringify({ labels, startDate, endDate, pageSize })}`

    // 캐시백은 시간에 따라 상태(Waiting→Approved)가 변하므로 완료캐시 TTL 을 짧게(10s) — 동시 중복 호출만 합치고
    // stale 상태 고착을 최소화한다(적대리뷰). KAYAK 자체도 1h 캐시라 부하는 충분히 절감된다.
    const payload = await dedupe(
      key,
      async () => {
        const raw = await getTransactions({ startDate, endDate, labels, pageSize })
        const rawLen = Array.isArray(raw) ? raw.length : undefined
        // 페이지 상한 도달 시 잘렸을 수 있음을 경고(무음 truncation 금지·키는 로그에 남기지 않음).
        // 회원 1인 거래는 보통 소량이라 발현 가능성 희박. 다중 페이지 수집은 S6 이관.
        if (rawLen === pageSize) {
          logger.warn('cashback 페이지 상한 도달 — 일부 거래 누락 가능', {
            pageSize,
            hint: '기간 축소 또는 다중 페이지 수집 필요',
          })
        }
        return adaptTransactions(raw, { now })
      },
      { ttlMs: 10_000 },
    )

    res.json(payload)
  } catch (e) {
    next(e)
  }
})

export default router

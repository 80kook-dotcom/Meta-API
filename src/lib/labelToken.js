/**
 * 캐시백 라벨 서명 토큰 — 운영 IDOR 방어 (S6 · CODEX_REVIEW_POINTS #11/D2).
 *
 * 문제: 중계는 stateless 라 앱이 보낸 `labels`(회원 라벨)를 그대로 신뢰한다 → 라벨만 바꿔
 *       타인 캐시백 조회(IDOR)가 가능하다. 라벨은 딥링크 `p=` 로 이미 공개되는 비PII 값이라
 *       치명적이진 않으나, 운영에서는 임의 라벨 조회를 막아야 한다.
 *
 * 방어: allmytour 인증 백엔드가 **로그인한 회원 본인의 라벨에 대해서만** 단기 서명을 발급한다.
 *       서명 = HMAC-SHA256(`${label}.${exp}`, secret) hex. 중계는 secret(CASHBACK_LABEL_HMAC_SECRET)
 *       설정 시에만 이 검증을 강제하고, 미설정(개발/데모)이면 현행 trust-label 동작을 유지한다.
 *
 * codex 정교화(2026-06-17): label-only 서명은 **영구 bearer token** 이 되어 한 번 유출되면 영구
 *   재사용된다 → `exp`(만료)를 서명에 바인딩하고, 발급 후 maxAge 를 넘는 장기 토큰은 거부한다.
 *   nonce(단회성)는 본 위험(비PII·공개 라벨)에는 과하다 — exp 로 충분.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

/** HMAC-SHA256(`${label}.${exp}`, secret) → hex. 발급(인증 백엔드)·검증 공용. */
export function signLabel(label, exp, secret) {
  return createHmac('sha256', secret).update(`${label}.${exp}`).digest('hex')
}

/**
 * 라벨 토큰 검증. secret 설정 시에만 호출한다.
 * @param {object} p
 * @param {string} p.label  검증 대상 라벨(쿼리 labels)
 * @param {string|number} p.exp  만료 Unix 초(쿼리 exp)
 * @param {string} p.sig  HMAC hex(쿼리 sig)
 * @param {string} p.secret  공유 시크릿(config)
 * @param {number} p.nowSec  현재 Unix 초(주입·테스트 결정성)
 * @param {number} [p.maxAgeSec]  발급 후 허용 최대 수명(장기 토큰 거부). 0/미지정이면 미적용.
 * @returns {{ok:true} | {ok:false, status:number, code:string, message:string}}
 */
export function verifyLabelToken({ label, exp, sig, secret, nowSec, maxAgeSec = 0 }) {
  if (!sig || exp === undefined || exp === null || exp === '') {
    return { ok: false, status: 401, code: 'MISSING_LABEL_SIG', message: '라벨 서명(exp·sig)이 필요합니다.' }
  }
  const expNum = Number(exp)
  if (!Number.isInteger(expNum) || expNum <= 0) {
    return { ok: false, status: 400, code: 'INVALID_LABEL_EXP', message: 'exp 는 양의 정수(Unix 초)여야 합니다.' }
  }
  if (nowSec > expNum) {
    return { ok: false, status: 401, code: 'EXPIRED_LABEL_SIG', message: '라벨 서명이 만료되었습니다(재발급 필요).' }
  }
  // 장기 토큰 방어 — 만료가 현재로부터 maxAge(+slack) 보다 멀면 거부(codex: 짧은 만료 권고).
  if (maxAgeSec > 0 && expNum - nowSec > maxAgeSec) {
    return { ok: false, status: 401, code: 'LABEL_SIG_TTL_TOO_LONG', message: '라벨 서명 유효기간이 허용치를 초과했습니다.' }
  }
  const expected = signLabel(label, expNum, secret)
  const a = Buffer.from(expected, 'hex')
  const b = Buffer.from(String(sig), 'hex')
  // timingSafeEqual 은 길이가 같아야 한다 — 길이 다르면 즉시 불일치(타이밍 누출 없음).
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, status: 401, code: 'INVALID_LABEL_SIG', message: '라벨 서명 검증에 실패했습니다.' }
  }
  return { ok: true }
}

/**
 * 통화·언어 파라미터 검증 (S6 · CODEX_REVIEW_POINTS #21).
 *
 * KAYAK 계정은 KRW 고정(다통화는 KAYAK 회신 대기). 요청 currencyCode/languageCode 를
 * 허용목록으로 검증해 **비허용 값은 400 으로 거부**한다 — 무음 오표기(예: USD 거래를 KRW 로
 * 보여줌)를 막기 위해 KRW 로 강제 coerce 하지 않는다(codex 권고: 무음 coerce 금지).
 * 누락(빈 값)일 때만 config.market 기본값(SSOT)을 쓴다.
 *
 * 다통화 도입 시: 허용목록 확장 + 서버 단일 SSOT 환산(표시계층 아님)으로 추가한다.
 */
import { config } from '../config.js'

function resolve(raw, fallback, allowlist, code, label) {
  const value = String(raw ?? '').trim() || fallback
  if (!allowlist.includes(value)) {
    return {
      error: {
        error: code,
        message: `지원하지 않는 ${label}입니다(${value}). 지원: ${allowlist.join(', ')}.`,
      },
    }
  }
  return { value }
}

/** @returns {{value:string} | {error:{error:string,message:string}}} */
export function resolveCurrency(raw) {
  return resolve(raw, config.market.currencyCode, config.market.supportedCurrencies, 'UNSUPPORTED_CURRENCY', '통화')
}

/** @returns {{value:string} | {error:{error:string,message:string}}} */
export function resolveLanguage(raw) {
  return resolve(raw, config.market.languageCode, config.market.supportedLanguages, 'UNSUPPORTED_LANGUAGE', '언어')
}

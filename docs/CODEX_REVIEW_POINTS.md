# CODEX 교차검토 지점 — KAYAK 연동 (S0~S6)

> **목적**: S1 착수 전, 각 세션 구현에서 codex(교차검토)가 필요한 결정 지점을 미리 식별·고정해 잊지 않도록 한다.
> **판정 기준**(CLAUDE.md): ① 대안 2개+ 경합 ② 보안·성능·데이터무결성 영향 ③ 자체 확신도 80% 미만. 표준 패턴·자명 구현은 제외.
> **도출 방법**: 다중 에이전트 워크플로(33 에이전트·실코드 grep/read·find→적대 triage, run `wf_10ee2a1b`) + 직접 분석 + 검사관 교차검증.
> **결과**: 식별 26건 → **codex 권고 22건**(high 14 / medium 8) + 제외 4건.
> **검증 메모**: 검사관이 워크플로 근거 6건 중 1건의 표현 과장을 적발 → 정정 반영(아래 #16 S0 CORS: "무조건 허용" → 실제 "화이트리스트 강제 + `!origin`만 통과 + 인증·rate-limit 부재").
> **codex 호출 상태**: S0 골격(1회)·S1 #2/#3(1회) 자문 성공(2026-06-17). 잔여 high는 각 세션 착수 직전 호출. codex 응답은 자문일 뿐 자동 적용 금지. codex가 KAYAK 비공개 스펙(운영 HOST·`p=` 인코딩·쿼터)을 대신 알 수는 없으므로 해당 항목은 KAYAK 포털 확인과 병행.

## 우선순위 요약 (22건)

| # | 세션 | 지점 | 차원 | 우선 |
|---|---|---|---|---|
| 1 | S0/S1/S6 | 검색 `x-original-client-ip` IP 출처·신뢰경계 | 보안·계약 | 🔴 high |
| 2 | S1 | 검색 비동기 폴링 위치(서버 블로킹 vs 앱 재폴링) | 성능·무결성 | 🔴 high |
| 3 | S1/S2 | 페이지네이션(KAYAK 25/250) ↔ 앱 전체수신 모델 | 아키텍처 | 🔴 high |
| 4 | S2 | 카드 amenities — `features` 미수신 + 라벨 정확매칭 → 필터 무음 0건 | 무결성 | 🔴 high |
| 5 | S2 | 캐시백 모델(provider 단위·FLAT·cap) ↔ 앱(per-rate·cap 무시) | 무결성 | 🔴 high |
| 6 | S3 | `isComplete` 폴링 예산(간격·횟수·타임아웃·중복합치기) | 성능 | 🔴 high |
| 7 | S2/S3 | `guestRating` 0~10 ↔ 앱 0~5 + `-1` 처리(cross-cutting) | 무결성 | 🔴 high |
| 8 | S4 | `p=` 라벨 정체(기기 추적ID vs 회원ID vs PII) | 보안 | 🔴 high |
| 9 | S4 | `p=` 인코딩 규칙(`+`/`%20`/문자셋 제한) | 무결성 | 🔴 high |
| 10 | S5 | Approved/Waiting 판정 근거(API 단독 근사·포털 기준) | 무결성 | 🔴 high |
| 11 | S5 | `labels` 누락 시 전 회원 거래 유출 + 라벨 무검증 IDOR | 보안 | 🔴 high |
| 12 | S6 | 운영 앱→중계 도달 경로(상대경로/CORS/리버스프록시) | 아키텍처 | 🔴 high |
| 13 | S6 | 운영 `x-original-client-ip` 산출(프록시 체인 신뢰 IP) | 보안 | 🔴 high |
| 14 | S6 | 운영 빌드 MSW/mocks 제거 vs 게이트(`/api/deals` 누수) | 무결성 | 🔴 high |
| 15 | S0 | `/api/hotels` 요청 계약 불일치(앱 무파라미터 vs 조건 필수) | 계약 | 🟡 med |
| 16 | S0 | 중계 인증·남용 방지(키 보관 프록시·인증/rate-limit 0건) | 보안 | 🟡 med |
| 17 | S2 | `totalCount` 의미·필터 위치(클라 vs 서버) | 성능 | 🟡 med |
| 18 | S2 | constants NDJSON 캐시(적재시점·갱신·콜드스타트 폴백) | 아키텍처 | 🟡 med |
| 19 | S3 | 개별 리뷰 미제공 → quotes/aspects 대체 | 계약 | 🟡 med |
| 20 | S3 | `propertyType`·facility 라벨 보강 소스(캐시 vs 정적피드) | 정확성 | 🟡 med |
| 21 | S6 | 통화/언어 파라미터화·다통화 FX 환산 SSOT | 무결성 | 🟡 med |
| 22 | S6 | 호출 쿼터 대응(폴링 부하·캐시 신선도·백오프) | 성능 | 🟡 med |

---

## 세션별 상세 (결정 / 대안 / codex 질문 초안 / 코드 근거)

### S0 — 골격(완료) · 사후 검토

**[16·med] 중계 인증·남용 방지** ⚠검사관 정정 반영
- 사실(정정): `server.js` L20-27의 CORS는 화이트리스트를 강제하나(브라우저 cross-origin 차단), **origin 헤더 없는 요청(`!origin`: curl·서버간)은 통과**하고 **인증·rate-limit 코드가 0건**. 비밀 키를 쥔 프록시라 IP망/도구 접근자가 키 쿼터로 KAYAK 호출 가능.
- 대안: (A) 현행 유지 (B) 공유 시크릿 헤더 + rate-limit (C) 운영만 강화·골격에 hook
- 질문 초안: "키를 쥔 프록시에 앱↔중계 인증을 둘지(브라우저 노출이라 완전 비밀 불가)? 최소 rate-limit·`!origin` 차단을 공개 데모 전 적용할지?"
- 근거: `server.js:20-27`, `src/` 내 auth/rate-limit 0건

**[15·med] `/api/hotels` 요청 계약 불일치** (실 결정은 S1~S2)
- 사실: 앱 `Results.tsx:109`가 `/api/hotels`를 **무파라미터** 호출 → 전체 받아 클라가 필터·정렬·무한스크롤. KAYAK은 `destination`·`checkin`·`checkout`·`rooms` **필수** + 비동기.
- 대안: (A) 앱이 searchStore 조건을 쿼리로 전달(앱 일부 변경) (B) 앱 무변경·세션 우회(복잡·위험) (C) 폴링 책임 분담
- 질문 초안: "앱이 검색조건을 쿼리로 실어 보내도록 계약 변경 vs 세션 우회? AC6의 onlyIfComplete 폴링 방식과 함께 확정?"
- 근거: `Results.tsx:109`, `mocks/handlers.ts:37-50`, 개발요청서 AC6

### S1 — 연결

**[2·high] 검색 비동기 폴링 위치**
- 결정: `isComplete=false` 폴링. 서버 블로킹(완성본 1회·앱 무변경·6~10초 지연) vs 앱 재폴링(앱 변경·점진 렌더) vs `onlyIfComplete=true` 202 반복 vs 하이브리드.
- 질문 초안: "폴링을 서버/앱 어디서? 간격·최대횟수·타임아웃·부분결과 반환 정책? 동일조건 in-flight 중복합치기?"
- 근거: RAML L19-24, 샘플 `searchTime:6759ms`, `Results.tsx` 폴링 없음

**[3·high] 페이지네이션 25/250 ↔ 전체수신 모델**
- 사실: 샘플 `totalResults:1247` vs `results` 25건. KAYAK `pageSize` 기본25·최대250.
- 대안: pageSize=250 단발(251건+ 누락) / 전체 병합(느림·쿼터) / 패스스루+앱 서버페이징 재설계 / summaryOnly 카운트 분리
- 질문 초안: "`totalCount`에 무엇을(서버 totalResults vs 반환건수)? 첫 화면 상한? 무한스크롤을 서버 페이징과 연결? 필터를 서버로?"
- 근거: 샘플 totalResults 1247·results 25, RAML pageSize 25/250, `handlers.ts:37-50`

### S2 — 어댑터·constants

**[4·high] amenities — `features` 미수신 + 라벨 정확매칭 함정**
- 사실: 샘플 25건에 per-hotel `features` 0건(responseOptions에서 빠짐). 앱 `filters.ts:73`이 고정 한글 카탈로그(`AMENITY_CATALOG:142-158`)와 **정확 문자열 AND 매칭** → KAYAK 라벨 그대로 넣으면 **편의시설 필터가 조용히 0건**.
- 대안: (A) `features` 옵션 추가 + facility ID→앱 카탈로그 정규화 (B) MVP amenities=[]·필터 숨김 (C) 서버 filter 버킷 기반 재설계
- 질문 초안: "responseOptions에 `features` 추가하고 facility ID를 앱 고정 카탈로그로 정규화 vs 필터를 서버 버킷으로 재설계?"
- 근거: 샘플 features 0건, `filters.ts:73`, `AMENITY_CATALOG:142-158`

**[5·high] 캐시백 모델 불일치·cap 미반영(금액 과대표시)**
- 사실: cashback은 `providers[]` 단위(실측 5.5%·cap 1,200,000 KRW), `isDirect` 공급사는 cashback 없음. 앱 `Cashback={PERCENTAGE|NONE,value?}`로 FLAT·cap·currency 없음. **`outlink.ts:82-85`가 cap 무시 → 금액 과대표시**(`Outlink.tsx:141` '최대 N%' 배너).
- 대안: 앱 타입 확장(FLAT·cap 추가) / 어댑터 평탄화(PERCENTAGE 근사) / 실효율 재계산(cap/총액×100)
- 질문 초안: "cap을 `min(총액×율, cap)`로 반영하려면 앱 타입 확장 vs 어댑터 실효율 평탄화? `isDirect`(cashback 없음)는 NONE 처리?"
- 근거: 샘플 `providers[].cashback`, `types/index.ts:18-23`, `outlink.ts:82-85`, `Outlink.tsx:141`

**[7·high] `guestRating` 0~10 ↔ 0~5 (cross-cutting)** — S3-11과 공통 헬퍼로 한 번에 확정

**[17·med] `totalCount`·필터 위치** — #3과 함께 검토
- 질문 초안: "필터/정렬을 클라(현 구조) 유지 vs KAYAK filter 파라미터(서버) 이전? 카운트 정합?"
- 근거: `types:71-74`, `filters.ts:3-5`

**[18·med] constants NDJSON 캐시**
- 결정: 적재시점(기동 선적재 vs lazy)·저장(메모리 vs 디스크 영속)·갱신주기(일/주)·콜드스타트 실패 폴백·언어별 캐시키.
- 질문 초안: "constants 기동 선적재 vs lazy? 적재 실패 시 숫자 노출 vs 검색 차단? thundering-herd 가드? 디스크 스냅샷?"
- 근거: datafeed RAML NDJSON, `src/` constants/cache 모듈 부재

### S3 — 상세·폴링

**[6·high] `isComplete` 폴링 예산** (S1-2와 동일 설계축·상세 적용)
- 결정: 서버 블로킹 폴링 기본(간격 700~1000ms·최대 6~8회·8~10초 타임아웃) + 동일 hotel+조건 중복합치기. 타임아웃 시 부분응답 반환.
- 질문 초안: "상세 폴링 예산값 적정? 동시 동일요청 de-dupe? 타임아웃 부분결과 UX?"
- 근거: `Detail.tsx:141-152` 폴링 없음(단 1회 fetch)

**[11·high] `guestRating` 0~10 cross-cutting**
- 결정: ÷2(0~5·앱 무변경·0.5 손실) vs 앱 0~10 전환(`RatingBadge`·`ratingWord`·리뷰막대 분모 수정). `-1`=평점없음 분기.
- 질문 초안: "÷2 변환 vs 0~10 전환? 목록(`guestRating`)·상세(`reviews.OVERALL`) 두 경로를 공통 헬퍼로 단일 척도 강제?"
- 근거: `types:55`, `Detail.tsx:81-86`(ratingWord 임계 4.5/4.0/3.5)·`:514`(score/5*100)

**[19·med] 개별 리뷰 대체**
- 사실: KAYAK은 `quotes`/`aspects`만 제공(author/date/text 없음). 앱 `HotelReviews.items[]`·'리뷰 더보기'가 author/date 직접 렌더.
- 대안: items[]에 빈값 매핑(숨김) / 리뷰탭 재구성(카테고리+인용구) / (author·date 임의생성 = 무결성 위반·금지)
- 질문 초안: "리뷰 탭을 quotes/카테고리 점수 위주로 재구성 vs items 숨김?"
- 근거: RAML reviews L648-681, `Detail.tsx:500-551`

**[20·med] `propertyType`·facility 보강 소스**
- 사실: 단일응답에 `propertyType` 없음·features 숫자. 앱 `FAC_ICON:71-78` 키(wifi/parking…)가 KAYAK featureTags(parking_transport…)와 불일치.
- 대안: 다중검색 캐시 조회 / static feed 보강 / 빈값 폴백. + featureTags→FAC_ICON 매핑표.
- 질문 초안: "`propertyType`을 다중검색 캐시 vs static feed? 상세 직접진입(딥링크·새로고침) 캐시미스 폴백? featureTags→앱 아이콘 키 매핑?"
- 근거: `Detail.tsx:71-78`, RAML SingleHotelSearchResponse(propertyType 부재)

### S4 — 딥링크 `p=`

**[8·high] `p=` 라벨 정체**
- 사실: `Member` 타입에 비PII 회원ID 없음(email/이름/전화만). 가이드 §6은 `userTrackId`와 분리한 '회원 라벨' 요구.
- 대안: `userTrackId` 재사용(로그인 전후 끊김) / 비PII 회원ID 신규 발급 / email(PII 외부 노출 위험)
- 질문 초안: "`p=`에 기기 `userTrackId` vs 신규 비PII 회원ID? (email은 외부 URL·리포트에 평문 노출이라 금지) 로그인 전후 추적 일관성?"
- 근거: `types/index.ts:218-225`(Member), `sessionStore.ts:46`(userTrackId)

**[9·high] `p=` 인코딩 규칙**
- 사실: `URLSearchParams.set`은 형제 파라미터(`url=`·`utid`·`cookieOverrides`) 보존 OK. 단 공백→`+` 직렬화. KAYAK Tracking 스펙 [미정].
- 대안: URLSearchParams 그대로(`+` 허용 베팅) / 라벨 `[A-Za-z0-9_-]` 제한(모호성 제거) / encodeURIComponent
- 질문 초안: "`p=` 라벨을 영숫자로 제한해 인코딩 모호성을 제거 vs `+`/`%20` 베팅? (KAYAK Getting Started>Tracking 확인 병행)"
- 근거: 가이드 §6·§11.2 [미정]

### S5 — 캐시백

**[10·high] Approved/Waiting 판정**
- 사실: KAYAK `statusCode`는 Active(1)/Cancelled(11)뿐·Approved 없음. **가이드 §8(paymentMonth만으로 Approved 금지) ↔ QA Q2(Active+paymentMonth=null=대기)가 목 데이터와 모순**(Waiting인데 paymentMonth 2026-07·08 채워짐).
- 대안: ET 정산일 경과 추론(paymentMonth 익월 25일 경과) / paymentMonth 단순분기(가이드 금지) / 포털 지급보고서 연동(S5 범위 초과)
- 질문 초안: "Reporting만으로 Approved를 정산일 경과로 근사 vs 포털 연동? 보수적 기본 Waiting?"
- 근거: 가이드 §8 L119-123, QA Q2, KAYAK 리포트 형식 회신 대기(§11-6)

**[11·high] `labels` 누락 시 전 회원 유출·IDOR** 🔴
- 사실: `labels` 생략 시 KAYAK이 **affiliate 전체(전 회원) 거래 반환**(RAML L1223-1226). 앱은 회원 라벨 SSOT 없이 `userTrackId`만(`sessionStore:46`).
- 대안: 빈 라벨→전체반환 그대로(금지·유출) / 빈·비로그인 차단(빈 배열) + 유효 라벨만 호출 / 서버 세션에서 회원ID 도출(앱 라벨 무신뢰)
- 질문 초안: "빈 라벨 시 KAYAK 호출 차단? 앱이 보낸 라벨을 무신뢰하고 서버 세션에서 회원 식별해 IDOR(라벨만 바꿔 타인 캐시백 조회) 방지?"
- 근거: RAML L1223-1226, `sessionStore.ts:46`

### S6 — 운영 전환

**[12·high] 운영 앱→중계 도달 경로**
- 사실: 앱 5곳 상대경로 `/api/*`(Results/Search/Detail/Cashback/Deals). 운영은 앱(CF Pages)·중계(고정IP) 도메인 분리. `_redirects` /api 제외는 SPA fallback만 끊을 뿐 중계로 보내주지 않음.
- 대안: CF `_redirects` 200 리버스프록시(같은출처·CORS 불필요·홉+1) / Pages Functions 포워딩(컴포넌트+1) / `VITE_API_BASE` 절대URL 직접호출(CORS·preflight·혼합콘텐츠)
- 질문 초안: "운영에서 `/api`를 CF 리버스프록시로 같은출처 유지 vs 절대 URL 직접호출? (CF egress는 KAYAK 화이트 밖이라 중계 경유 필수)"
- 근거: 상대경로 5곳, 가이드 §9 `_redirects`

**[13·high] 운영 `x-original-client-ip` 산출** (S0-1·S1과 통합 결정)
- 사실: 운영 중계는 CF/LB 뒤 → `req.socket.remoteAddress`가 프록시 IP. RAML L91-92: client IP 기반 market-specific 세금·요금.
- 대안: CF-Connecting-IP(CF 종속) / XFF 최좌측 + trust proxy hop(위조 위험) / 운영 고정IP 일괄(지역가격 훼손 가능)
- 질문 초안: "손님 실IP를 CF-Connecting-IP vs XFF 체인에서 신뢰 추출? 위조 방지 trust proxy 설정? 운영IP 일괄 시 KRW·세금 정합?"
- 근거: 가이드 §2, RAML L91-92, trust proxy 코드 0건

**[14·high] MSW/mocks 제거 vs 게이트(`/api/deals` 누수)** 🔴
- 사실: `main.tsx` enableMocking이 prod도 MSW start(데모용). `/api/deals`는 중계 라우트(autocomplete/hotels/hotel/cashback)에 없고 MSW만 응답 → 운영에 가짜 데이터 누수 위험. 단순 제거 시 `DealsCarousel.tsx:24`가 빈 화면.
- 대안: 완전 제거(dev 빈화면) / `import.meta.env.DEV` 게이트(트리셰이킹·누수 점검) / 중계가 `/api/deals` 보강 후 제거
- 질문 초안: "운영 빌드 MSW 완전 제거 vs DEV 게이트? `/api/deals`를 중계가 커버 vs 앱에서 제거?"
- 근거: `main.tsx` enableMocking, `DealsCarousel.tsx:24`, 중계 라우트 4종

**[21·med] 통화/언어 파라미터화·FX**
- 질문 초안: "당분간 KRW 고정·표시계층만 추상화 vs 다통화 환산 도입? FX 환산 SSOT를 서버 한 곳에? (KAYAK 다통화 회신 대기)"
- 근거: `Outlink.tsx:100·141` KRW 하드코딩, QA §3·가이드 §11-7

**[22·med] 호출 쿼터 대응**
- 질문 초안: "폴링 `onlyIfComplete=false` 고정간격 vs `true` 202 백오프? 자동완성 디바운스·중계 단기캐시로 호출 절감? (쿼터 기준 미정)"
- 근거: 가이드 §11-3, `Search.tsx:82`, AC6

---

## 제외(codex 불필요) 4건 — 표준/자명/이미 결정
- **S1 개발 `x-original-client-ip` 값**: `client.js`에 개발=임의값 정해짐. 쿼리 `currencyCode=KRW`/`languageCode` 고정으로 무결성 중화. (운영 산출은 #13에서 다룸)
- **S2 `guestRating` 표기 정규화(단독)**: 표시 정규화·자명. (단 S3 cross-cutting #7/#11은 keep)
- **S4 `p=` 치환 구현(URLSearchParams vs 정규식)**: 가이드 §6이 URLSearchParams로 결정·표준. (형제 바이트 동일성은 단위테스트로 보장)
- **S5 KRW double→정수 반올림**: round-then-sum 표준·`outlink.ts` Math.round 선례.

## codex 자문 결과 — S0 골격 (2026-06-17 · 실제 호출 성공)
codex read-only 검토. 핵심 4건 + 내 판단:
1. **CORS/인증**: `!origin` 통과(`server.js:22`) + `/api` 무인증(`:46`)은 S1 이후 과소방어. 로컬 개발은 허용, **원격 데모부터 rate-limit + 좁은 CORS + no-origin 차단 + 요청검증** 필요. 공유 시크릿 헤더는 공개 SPA에선 비밀 아님(임시 억제용). 운영은 세션/Cloudflare Access/Basic Auth. → 본 문서 #16·#11과 정합. **채택**(데모 배포 전 보완).
2. **client IP 신뢰경계**(핵심): 개발=개발실 NAT 공인 IP 또는 실제 요청자 IP(임의 한국 IP는 피하라). 운영=`X-Forwarded-For` 직접 신뢰 금지·CF 뒤=`CF-Connecting-IP`·LB 뒤=신뢰 프록시 XFF만. `trust proxy`를 `true`로 넓게 열지 말고 hop/대역 제한. **들어온 `x-original-client-ip`는 무시하고 서버 계산값만 KAYAK에 전달**. → #1·#13 강화. **채택**.
3. **`/health` 노출**: `kayakHost`(`server.js:40`)·누락키 이름(`:39`)은 고위험 아니나 공개 운영엔 불필요 → 운영 health `{ok:true}` 축소, 내부정보는 인증 debug 엔드포인트로. → 신규. **채택**(운영 S6).
4. **구조(S1 재작업 감소)**: ⓐ `app.listen`이 `server.js:56`에 박혀 테스트 불편 → **앱 생성/listen 분리** ⓑ KAYAK 헬퍼를 search/autocomplete/reporting의 host·auth·header 차이를 담게 분리 ⓒ `/api` 앞단에 인증·rate-limit·client IP 산출·공통 에러변환을 거는 **미들웨어 1곳**. → 신규·직접분석에 없던 유용한 구조 권고. **S1 착수 시 선반영 권고**.

> codex 결론: S0 방향은 크게 안 틀림. 단 S1 실호출 전에 "공개 프록시가 아니다(접근제어)"·"client IP는 신뢰경계 안에서 서버가 계산" 두 원칙을 먼저 고정 권장.

## codex 자문 결과 — S1 연결 (2026-06-17 · 실제 호출 성공)
S1 고유 high 2건(#2 폴링·#3 페이지네이션) read-only 자문. 결론 + 내 판단:

**[2·high] 검색 폴링 위치/예산** → codex 권고 **A(중계 서버 블로킹 폴링)**.
- 근거: 앱 무변경(현 `/api/hotels` 1회 호출 구조 유지)·데모 안정성. B(앱 재폴링·점진 렌더)는 S6, C(`onlyIfComplete=true` 202)는 A의 내부 옵션.
- 권고 수치: 간격 1s·최대 10회·하드 타임아웃 12~15s·타임아웃 시 **504+명확한 에러**(빈 결과보다 나음)·동일 조건 **in-flight de-dupe 필요**(완료 30~60s 캐시).
- **내 판단·반영**: A 채택(가이드 §10·앱 무변경 원칙과 정합). `config.poll`=간격 1000ms·최대 10회·타임아웃 12000ms·단일요청 8000ms로 구현(`src/kayak/client.js callKayak`). 타임아웃→`KayakError(KAYAK_SEARCH_INCOMPLETE, 504)`. **de-dupe·완료캐시는 라우트 어댑터가 생기는 S2로 이관**(S1은 연결 계층 primitive까지·연결 테스트는 HTTP 우회). → 동의.

**[3·high] 페이지네이션** → codex 권고: S1 **`pageSize=250` 단발·앱 무변경**, 앱 `totalCount`=**실제 반환 건수**, KAYAK `totalResults`(1234~1247)는 **별도 메타** 보관, 서버 페이징은 **S6**.
- **내 판단·반영**: 동의. 단 S1 연결 테스트는 빠른 검증 위해 `pageSize=25`로 호출(라우트가 250 지정은 S2). `totalCount`/`serverTotalResults` 계약 확정은 **어댑터가 생기는 S2 결정**(#3/#15/#17과 함께)으로 명시 이관. 250 초과(1234건 중) 누락은 S1~S2 수용·"상위 결과" 메타로 표기.

> 결론: S1 연결 계층은 폴링 primitive + pageSize 패스스루로 두 결정을 **지원**만 하고, 앱 계약(totalCount·de-dupe·캐시) 확정은 S2로 이관. codex와 합치.

## S1 연결 — 구현·검증 완료 (2026-06-17)
- **구조 선반영**(사용자 결정·codex S0 #4): `src/app.js`(createApp)/`server.js`(listen) 분리 · `/api` 공통 미들웨어 4종(`middleware/clientIp.js`=들어온 `x-original-client-ip` 폐기+서버계산 / `rateLimit.js`=슬라이딩윈도우·기본 비활성 / `relayAuth.js`=공유시크릿·기본 통과 / `errorHandler.js`=KayakError→JSON) · KAYAK 헬퍼 패밀리 분리(`kayak/client.js` 저수준 callKayak + `kayak/endpoints.js` autocomplete/searchHotels/searchHotel/constants/transactions의 host·auth·header 차이). 보안 hook은 **env 게이트**(개발=관대·운영 S6 강제).
- **연결 실측**(개발실 IP 58.75.223.130·`npm run test:connect`): 자동완성 200·6건(`kplace:22028` 선택) / 검색 200·**폴링 후 isComplete=true(8.06s)**·totalResults 1234·25건·KRW·Novotel ★5 평점8.7·403,920원·bookUri `hapi-ko-kr…`(a=,p=) / 보조 정적피드 NDJSON 200 파싱. /health 200·/api 501스텁 미들웨어 통과·404 정상.
- **키 누출 0**: 키는 `.env`·QA·샘플(전부 gitignore)에만. 커밋 대상 파일 grep 0건.

## 실측 프로브 결과 — S2 착수 (2026-06-17 · 라이브 KAYAK·개발실 IP)
어댑터/캐시 설계 전, 모호 지점을 라이브 호출로 확정(추측 제거):
- **#4 features 수신**: responseOptions 에 `features` 포함 시 **per-hotel `features:[숫자ID]` 25/25 채워짐**(미포함 시 0/25). → #4 옵션 A(features+정규화) 채택 가능.
- **facility 카탈로그**: `constants-mapping?types=facility` = NDJSON 1행 `{facility:{features:[{id,name,type}],tags:[]}}` ≈298종(매우 세분). `types=property` = `{property:[{id,name}]}` 0~51.
- **propertyType**: 검색 응답 내 `propertyTypes` 패싯이 0~51 전체 + results 의 사용 id 전부 커버(폴백 불필요 수준). → 패싯 1차·constants 폴백.
- **자동완성 필드**: `entityKey·primaryPlaceType·fullName(대문자)·hotelName·cityName`. KAYAK 는 hotel 을 앞에 줌 → 중계가 city→region→hotel 재정렬. ⚠ 앱 필드는 `fullname`(소문자).
- **cashback**: providers[].cashback `{type:PERCENTAGE,value:5.5,cap:1200000,currency:KRW}`, isDirect 공급사는 cashback 없음.
- **guestRating**: 0~10(7.7~9.4)·-1=평점없음. 앱 목/컴포넌트는 0~5(3.8~4.9·임계 4.5/4.0/3.5) → ÷2 확정.

## codex 자문 결과 — S2 어댑터 (2026-06-17 · 실제 호출 성공)
high #4·#5·#7 + #17·#18 read-only 자문. 4건 모두 내 결정에 **동의**, 2개 정교화 채택:
1. **#4 amenities**: 정적 버킷 맵 채택(raw 라벨 dump 거부). ⚠정교화: **'무료 WiFi' 버킷은 명시적 유료(389 와이파이 유료·362 인터넷 추가요금) 제외**(유료를 무료로 표기하면 사용자 신뢰 훼손). '주차'는 유료 포함 OK, '반려동물'은 동반가능(394)만·불가(363) 제외. → `adapters/amenities.js` 반영.
2. **#5 cashback**: 리스트는 `{type,value}` 충실 변환(isDirect→NONE). cap/currency 는 앱 타입 확장 없이 **진단/전방호환 추가필드로 보존**(리스트 카드는 율%만 쓰므로 과대표시 아님·금액·cap 정확도는 향후 아웃링크 트랙). → `transform.mapCashback`.
3. **#7 guestRating**: ÷2·소수1자리·-1→0 동의. ⚠no-rating 구분 손실은 `numberOfReviews` 로 별도 판단 여지 남김. → `transform.normalizeGuestRating`.
4. **#17/#18**: totalCount=반환건수 동의·KAYAK `totalResults` 는 **`serverTotalResults` 별도 진단필드**로 보존. constants 캐시 lazy+TTL(24h)+single-flight+cold-start 폴백 동의. → `adapters/hotels.js`·`kayak/constants.js`.

## S2 어댑터 — 구현·검증 완료 (2026-06-17)
- **신규 모듈**: `adapters/transform.js`(공통: guestRating·cashback·placeType·providerInitial·images·ratesCheapestFirst) / `adapters/amenities.js`(15버킷 정적맵·featuresToAmenities) / `adapters/autocomplete.js` / `adapters/hotels.js` / `kayak/constants.js`(lazy·TTL·single-flight 캐시) / `lib/dedupe.js`(in-flight 공유 + 45s 완료캐시·키에 clientIp market 포함·reject 미캐시). 라우트 `routes/autocomplete.js`·`routes/hotels.js` 실연결(스텁 제거).
- **보안**: 어댑터가 KAYAK `destination.href`·`result.href`(apiKey 평문 포함)를 **읽지 않음**(앱 타입 안전필드만 선택) → 키 누출 차단. 응답 본문 grep apiKey 0.
- **단위테스트** `npm test`: 34/34 pass(transform·amenities·autocomplete·hotels·dedupe). 합성 픽스처(비밀 없음)·hermetic(패싯 커버로 네트워크 미발생).
- **라우트 실측** `npm run test:route`(개발실 IP): /health phase=S2-adapter / 자동완성 6건·앱 PlaceType·fullname·키누출0 / 검색 **250건·totalCount 250·serverTotalResults 1252**·첫 호텔 "노보텔 앰배서더 서울 동대문"★5 평점4.4/5 호텔·amenities13·**최저요금 403920(topRates[0]=최저가)**·cashback 앱타입·bookUri p= 보존·키누출0 / 파라미터누락 400 / 동시 de-dupe 200·200.
- **라이브가 잡은 버그**: 검색 API `userTrackId` **필수**(없으면 400 MISSING_USER_TRACK_ID) → 라우트가 앱 미전달 시 `relay-{uuid}` 폴백 생성.
- **이관/잔여**: 앱 측 연결(searchStore→쿼리 전달·MSW 제거·TopRate.bookUri/cap 타입 확장·RatingBadge 0~5 확인)은 **Meta-Re 실 API 연동 트랙**. S3 상세는 `kayak/constants.js getFacilityMap`(시설 라벨)·#19/#20 재사용.

### S2 적대 리뷰(다차원 워크플로 `wf_d49848e7`·20 에이전트) — 발견 7건(원시15→검증7)
5차원(계약·보안·견고성·결정준수·버킷맵) 병렬 검토 + 각 발견 적대 검증. 결과: **6건 수정·1건 S6 이관**.
- **major** `availableRooms` 누락 0 폴백 → 앱이 '잔여 0개'(거짓 매진) 표시 → **수정**: ROOMS_UNKNOWN(99·임계 3 초과→배지 미노출).
- **major** `numberOfProviders` 폴백이 4로 잘린 topRates.length 사용 → '가격비교 더보기' 과소표시 → **수정**: 폴백을 원본 rates 의 distinct providerIndex 수로.
- **minor** 재정렬 후 `isCheapestRate` 플래그가 최저가와 어긋남(S02 가격비교 테두리 오표시 리스크) → **수정**: 정렬 후 최저가만 true 재계산.
- **minor** `numberOfProviders`(contract 차원·위 major 중복) → 동일 수정으로 해소.
- **minor** errorHandler 가 err.body 를 raw 로그 → apiKey 잔존 가능(앱 비노출·로그 한정) → **수정**: `scrubSecrets` 로 apiKey= 패턴 가림.
- **minor** dedupe done 캐시 GC 가 호출 시에만 동작 → 트래픽 정지 시 메모리 잔류 → **수정**: 크기 상한(MAX_DONE 200·오래된 것부터 제거).
- **minor** 폴링 중 일시 오류 1회로 검색 즉시 실패(재시도 없음) → **S6 #22(쿼터·백오프)로 이관**(검증된 S1 폴링 동작 변경 회피·코드별 분기 필요). 단위테스트 40/40·라우트 실측 재통과.

## 갱신 이력
- **2026-06-17 v1**: 워크플로(33 에이전트·`wf_10ee2a1b`) 22 keep + 직접분석 + 검사관 교차검증(코드근거 5/6 일치·S0 CORS 표현 1건 정정).
- **2026-06-17 v1.1**: codex S0 골격 자문 1회 성공(위 4건). high 14건은 각 세션 착수 직전 codex 호출 예정.
- **2026-06-17 사용자 결정**: S0 보안·구조 보강(앱↔중계 인증·rate-limit / client IP 서버 계산 신뢰경계 / `app`·`listen` 분리 / KAYAK 헬퍼 host·auth 분리 / `/api` 공통 미들웨어)을 **S1 착수 시 함께 선반영**으로 확정. → S1 시작 시 먼저 codex로 #1·#16·구조 권고를 확정한 뒤 자동완성·검색 실호출 구현.
- **2026-06-17 v1.2 (S1 완료)**: 위 구조·보안 선반영 + #2/#3 codex 자문(성공) 반영 + 자동완성·검색 실호출 200 검증. 상세는 위 "codex 자문 결과 — S1 연결" / "S1 연결 — 구현·검증 완료". 잔여 high(#4·#5·#7 등)는 S2 착수 직전 codex 호출.
- **2026-06-17 v1.3 (S2 완료)**: #4·#5·#7·#17·#18 실측 프로브 + codex 자문(성공·4건 동의·2건 정교화) 반영. 어댑터 6모듈 + 라우트 실연결. 단위 34/34 + 라우트 실측(250건 실데이터·키누출0) 통과. userTrackId 필수 버그 라이브로 적발·수정. 상세는 위 3개 S2 섹션. 잔여 high(#6·#8~#14 등)는 S3~S6 착수 직전 codex 호출.

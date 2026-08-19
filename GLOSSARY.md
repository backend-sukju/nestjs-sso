# 용어 정리집

SSO를 만들면서 마주친 용어들을 정리했습니다. 각 항목은 **이 저장소 어디에 나오는지**를 함께 적었습니다.

- [역할](#역할--누가-무엇을-하는가)
- [토큰](#토큰)
- [JWT 클레임](#jwt-클레임)
- [플로우와 파라미터](#플로우와-파라미터)
- [등록과 계정 관리](#등록과-계정-관리)
- [로그아웃](#로그아웃)
- [보안 개념](#보안-개념)
- [oidc-provider 고유 개념](#oidc-provider-고유-개념)
- [RFC 목록](#rfc-목록)

---

## 역할 — 누가 무엇을 하는가

같은 것을 명세마다 다르게 부릅니다. OIDC는 OAuth 2.0 위에 얹힌 규격이라 두 체계가 한 문서에 섞여 나옵니다.

| 약어 | 풀네임 | 뜻 | 이 저장소 |
| --- | --- | --- | --- |
| **OP** | OpenID Provider | 인증해주는 쪽 | `src/` 전체 (:3000) |
| **IdP** | Identity Provider | OP와 같은 개념. SAML·일반 문맥에서 쓰는 말 | — |
| **AS** | Authorization Server | 토큰을 발급하는 쪽. OAuth 2.0 용어 | — |
| **RP** | Relying Party | 인증을 위임하고 그 결과에 **의존하는** 앱 | `apps/portal.js` 등 |
| **Client** | — | RP와 같은 대상. OAuth 2.0 용어 | `src/config/clients.ts` |
| **SP** | Service Provider | RP와 같은 개념. SAML 용어 | — |
| **RS** | Resource Server | 액세스 토큰을 **검사해서** API를 내주는 쪽 | `apps/notes.js:39` |
| **Resource Owner** | — | 데이터의 주인, 즉 사용자 | alice, bob |

### 헷갈리기 쉬운 것

**한 앱이 RP이면서 RS일 수 있습니다.** 메모 앱이 그렇고, 그래서 **신원이 두 개**입니다.

```
RP 로서 → client_id: notes-app
RS 로서 → http://localhost:4100/api
```

**RS 여부는 데이터 보유와 무관합니다.** 판별 기준은 토큰의 방향입니다.

```
RP:  토큰을 받아서 → 들고 다닌다 (Authorization 헤더를 붙여 보낸다)
RS:  토큰을 받아서 → 검사한다   (Authorization 헤더를 읽고 판단한다)
```

자기 저장소가 없는 이미지 변환 API도 Bearer 토큰을 검사한다면 완전한 RS이고,
데이터가 아무리 많아도 브라우저 세션으로만 접근한다면 순수 RP입니다.

---

## 토큰

| 이름 | 받는 쪽(`aud`) | 용도 |
| --- | --- | --- |
| **id_token** | `client_id` (앱) | "이 사용자가 로그인했다"는 **증명서**. 항상 JWT |
| **access_token** | 리소스 서버 식별자 (API) | "이 API를 호출해도 된다"는 **열쇠** |
| **refresh_token** | — | 액세스 토큰을 갱신하는 데만 쓰는 값. 클라이언트만 사용 |
| **logout_token** | `client_id` | "이 세션은 끝났다"고 알리는 JWT. 백채널 로그아웃용 |

### Opaque token (불투명 토큰)

내용이 없는 무작위 문자열입니다. 받는 쪽이 스스로 해석하지 못하고 발급자에게 물어봐야 합니다.

oidc-provider는 `resource`가 지정되지 않은 액세스 토큰을 opaque로 발급합니다 —
검증할 리소스 서버가 없으니 JWT일 이유도 없다는 관점입니다.
`apps/lib/rp.js`의 `decodeJwt()`가 JWT가 아니면 `null`을 돌려주는 이유입니다.

### JWT 계열

| 약어 | 풀네임 | 뜻 |
| --- | --- | --- |
| **JWT** | JSON Web Token | 서명된 JSON. `헤더.페이로드.서명`을 base64url로 이어붙인 것 |
| **JWS** | JSON Web Signature | JWT의 서명 부분 규격 |
| **JWK** | JSON Web Key | 키 하나를 JSON으로 표현한 것 |
| **JWKS** | JSON Web Key Set | 공개키 묶음. 클라이언트가 서명 검증에 씁니다 |
| **kid** | Key ID | JWKS 안에서 어느 키로 검증할지 고르는 식별자 |

JWT는 **서명된 것이지 암호화된 것이 아닙니다.** 누구나 페이로드를 읽을 수 있으니
민감한 값을 넣으면 안 됩니다.

---

## JWT 클레임

| 클레임 | 뜻 | 비고 |
| --- | --- | --- |
| `iss` | issuer — 누가 발급했나 | 검증 시 필수 |
| `sub` | subject — 누구에 대한 토큰인가 | **불변 식별자.** 로컬 DB 키로 이걸 씁니다 |
| `aud` | audience — 누가 받아야 하나 | 검증 시 필수. 아래 참고 |
| `exp` / `iat` | 만료 / 발급 시각 | |
| `jti` | JWT ID | 재사용 탐지용 고유값 |
| `azp` | authorized party | `aud`가 여러 개일 때 실제 요청 클라이언트 |
| `nonce` | 클라이언트가 보낸 값의 반사 | 리플레이 방지 |
| `auth_time` | 실제 인증이 일어난 시각 | `max_age` 판정에 사용 |
| `sid` | session ID | 백채널 로그아웃이 어느 세션인지 지목 |
| `act` | actor | **위임 체인.** 누가 대신 호출하는지 |
| `scope` | 허용 범위 | 공백 구분 문자열 |

### `aud`가 왜 중요한가

`aud`를 검사하지 않으면 **A API용으로 발급된 토큰이 B API에서도 통합니다.**
이걸 confused deputy 문제라고 부릅니다.

```js
// apps/notes.js:50 — 이 줄이 없으면 남의 API 토큰이 통과한다
audience: API_AUDIENCE,
```

서명이 유효한 것과 나에게 발급된 것은 다른 문제입니다. `iss`와 `aud`를 함께 봐야 합니다.

### `sub`를 키로 써야 하는 이유

이메일을 로컬 DB 키로 쓰면 사용자가 이메일을 바꾸는 순간 계정이 갈라집니다.
`sub`는 IdP가 보장하는 불변값입니다.

---

## 플로우와 파라미터

### Authorization Code Flow

인가 코드를 먼저 받고, 그걸 백채널에서 토큰으로 바꾸는 방식입니다.
토큰이 브라우저 주소창을 거치지 않는 게 핵심입니다. 현재 사실상 유일하게 권장되는 플로우입니다.

### PKCE — Proof Key for Code Exchange

인가 코드를 가로채도 토큰으로 바꾸지 못하게 막습니다. "픽시"라고 읽습니다.

```
1. 클라이언트: code_verifier(무작위) 생성 → 보관
2. 인가 요청:  code_challenge = base64url(sha256(verifier))  를 보냄
3. 토큰 요청:  code_verifier 원본을 보냄
4. SSO:        다시 해시해서 일치하는지 대조
```

`apps/lib/rp.js:104-116`. 원래 public 클라이언트용이었지만 지금은 **모든 클라이언트에 권장**됩니다.

### state / nonce

둘 다 클라이언트가 무작위로 만들어 보내고 되돌려받아 대조하지만, 막는 게 다릅니다.

| | 어디로 | 무엇을 막나 |
| --- | --- | --- |
| `state` | 인가 요청 → 콜백 쿼리 | **CSRF** — 남이 시작한 로그인이 내 세션에 붙는 것 |
| `nonce` | 인가 요청 → id_token 클레임 | **리플레이** — 예전 id_token 재사용 |

### prompt

| 값 | 뜻 |
| --- | --- |
| `none` | 화면을 절대 띄우지 말 것. 안 되면 에러 (silent authentication) |
| `login` | 세션이 있어도 재인증 요구 |
| `consent` | 동의 화면을 다시 띄울 것. `offline_access`에 필요 |
| `select_account` | 계정 선택 화면 |
| `create` | 신규 가입 의사. **oidc-provider 미지원** |

### 그 밖

| 파라미터 | 뜻 |
| --- | --- |
| `max_age` | 마지막 인증이 이보다 오래됐으면 재인증 |
| `resource` | 이 토큰이 어느 API용인지 지정 (RFC 8707). `aud`가 여기서 정해집니다 |
| `scope` | 요청하는 권한 범위. **신청서지 권한이 아닙니다** — SSO가 등록 정보와 대조해 잘라냅니다 |
| `offline_access` | 리프레시 토큰을 달라는 scope. 스펙상 `prompt=consent`가 함께 와야 유효 |

### Token Exchange (RFC 8693)

가진 토큰을 **다른 API용 토큰으로 바꾸는** 것. 위임(delegation)의 표준 방식입니다.

```
포털의 로그인 토큰  →  [SSO]  →  메모 API 전용 토큰
                              aud = http://localhost:4100/api
                              sub = 원래 사용자 그대로
                              act = { sub: "portal-app" }   ← 누가 대신 부르는지
```

`src/token-exchange.ts`. oidc-provider에 없어서 `registerGrantType`으로 직접 붙였습니다.

**반드시 지킬 규칙** — 결과 scope는 원본 토큰의 scope를 넘을 수 없습니다(`token-exchange.ts:62`).
이 교집합을 빼면 로그인 때 사용자가 동의하지 않은 권한을 교환 단계에서 만들어낼 수 있습니다.

### Discovery

`/.well-known/openid-configuration`. 엔드포인트 위치를 하드코딩하지 않게 해주는 문서입니다.

---

## 등록과 계정 관리

### DCR — Dynamic Client Registration (RFC 7591)

클라이언트가 `POST /register`로 스스로 등록하는 표준. RFC 7592가 그 등록의 수정·삭제를 다룹니다.

`src/provider.factory.ts:168`에서 켜져 있습니다. **클라이언트 등록에는 표준이 있어서**
플래그 하나로 엔드포인트가 생깁니다. 반대로 **리소스(API) 등록은 표준이 없어**
`src/config/resources.ts`를 직접 만들었습니다.

### JIT Provisioning — Just-In-Time

각 서비스가 가입 절차를 두지 않고, **첫 로그인 순간에 로컬 레코드를 자동 생성**하는 방식입니다.

```
id_token 도착 → sub 로 로컬 DB 조회
  └ 있으면 → 그대로 진행
  └ 없으면 → 레코드 생성 후 진행    ← 사용자는 가입한 줄 모른다
```

계정 생성(인증 신원)은 IdP가, 서비스별 프로필은 각 서비스가 맡는 분업입니다.
서비스가 각자 가입 폼을 두면 같은 사람이 서비스마다 다른 `sub`를 갖게 되어 SSO의 전제가 무너집니다.

### SCIM — System for Cross-domain Identity Management (RFC 7643/7644)

**계정 생명주기를 각 서비스에 밀어주는** 별도 프로토콜입니다. OIDC와 완전히 별개입니다.

**OIDC와 방향이 반대입니다.** 역할이 통째로 뒤집힙니다.

| | 요청을 거는 쪽 (client) | 요청을 받는 쪽 (server) | 무엇이 흐르나 |
| --- | --- | --- | --- |
| OIDC | 서비스 (RP) | IdP | 서비스가 신원을 **당겨온다** (pull) |
| SCIM | **IdP** | **서비스** | IdP가 계정 변경을 **밀어준다** (push) |

OIDC에서는 서비스가 `/authorize`·`/token`을 호출하는 클라이언트지만,
SCIM에서는 **서비스가 API를 열고**(`/scim/v2/Users`, `/scim/v2/Groups`)
IdP가 그리로 `POST`·`PATCH`·`DELETE`를 보냅니다.
SCIM 요청도 Bearer 토큰으로 인증하므로, 이때는 서비스가 토큰을 검사하는 쪽이 됩니다.

**왜 반대 방향이 필요한가.** JIT만으로는 **탈퇴·비활성화가 전파되지 않기 때문**입니다.

```
JIT :  사용자가 로그인할 때만   → 그 사용자에 대해서만   → 알게 된다
SCIM:  계정이 바뀐 즉시        → 접속 여부와 무관하게   → 알려준다
```

퇴사자는 다시 로그인하지 않습니다. 그래서 JIT는 영원히 그 사실을 모르고,
각 서비스에 계정이 살아 있는 채로 남습니다. IdP가 먼저 말을 걸어야만 풀리는 문제입니다.
부서 이동·이름 변경·그룹 편입도 마찬가지입니다.

SCIM은 OIDC와 **다른 규격**입니다. OpenID Foundation이 아니라 IETF(RFC 7643/7644)이고,
데이터 모델도 따로입니다(`userName`, `active`, `emails`, `groups`).

백채널 로그아웃은 **세션만** 끊습니다. 계정 자체와는 무관합니다.

### Consent (동의)

"이 앱이 내 정보에 접근해도 된다"는 사용자의 허락. 한 번 받으면 기록되어 다음부터 생략됩니다.
사내 1st-party 앱은 보통 건너뜁니다 — `src/config/clients.ts`의 `skip_consent`.

---

## 로그아웃

| 방식 | 경로 | 특징 |
| --- | --- | --- |
| **RP-Initiated Logout** | 브라우저 → SSO | 앱이 사용자를 SSO 로그아웃 화면으로 보냄 |
| **Back-Channel Logout** | SSO → 각 앱 (서버-서버) | 브라우저가 각 앱을 방문하지 않아도 전파됨 |
| **Front-Channel Logout** | 숨은 iframe | 브라우저 의존. 서드파티 쿠키 차단으로 신뢰도가 낮음 |

이 저장소는 백채널을 씁니다. SSO가 `logout_token`(JWT)을 각 앱의
`backchannel_logout_uri`로 POST하고, 앱은 JWKS로 검증한 뒤 그 `sid`의 로컬 세션을 끊습니다
(`apps/lib/rp.js:54`의 `bySsoSid` 역인덱스).

**Single Logout(SLO)**은 이 전체를 가리키는 말입니다.

---

## 보안 개념

| 용어 | 뜻 | 이 저장소에서 |
| --- | --- | --- |
| **Confused deputy** | 권한 있는 쪽이 남을 대신해 잘못된 일을 수행 | `aud` 검사로 방지 |
| **Open redirect** | 등록 안 된 주소로 사용자를 보내버리는 것 | `redirect_uri` 완전 일치 |
| **CSRF** | 남이 시작한 요청이 내 세션에 붙는 것 | `state` |
| **Replay** | 예전 토큰·응답을 재사용 | `nonce`, 인가 코드 1회용 |
| **SSRF** | 서버가 내부망으로 요청을 보내게 유도 | oidc-provider가 기본 차단 |
| **Refresh token rotation** | 갱신할 때마다 이전 토큰 폐기 | `rotateRefreshToken: true` |

### Confidential vs Public client

| | 뜻 | 인증 방식 |
| --- | --- | --- |
| **Confidential** | 비밀을 안전하게 보관할 수 있는 서버 앱 | `client_secret` |
| **Public** | SPA·모바일. 코드가 사용자 손에 있어 비밀을 못 지킴 | 없음 — PKCE로 대체 |

### 인가 코드 재사용

oidc-provider는 재사용을 **탈취 신호**로 보고 그 grant의 토큰을 전부 폐기합니다.
코드만 거부하는 것보다 강한 방어입니다.

---

## oidc-provider 고유 개념

라이브러리 문서를 읽을 때 필요한 말들입니다. 표준 용어가 아닙니다.

| 용어 | 뜻 |
| --- | --- |
| **Grant** | 사용자가 특정 클라이언트에 허락한 scope의 기록. 동의의 실체 |
| **Interaction** | 로그인·동의처럼 사용자에게 물어봐야 하는 구간. `src/interactions.ts` |
| **Adapter** | 세션·토큰 저장소 인터페이스. 기본은 인메모리라 운영에선 교체 필요 |
| **Resource Server Info** | `getResourceServerInfo`가 돌려주는 `aud`·scope·토큰 형식 |
| **Client Metadata** | 클라이언트 등록 정보. 필드명은 RFC 7591 표준을 따릅니다 |

---

## RFC 목록

| 번호 | 제목 | 이 저장소와의 관계 |
| --- | --- | --- |
| RFC 6749 | OAuth 2.0 Authorization Framework | 기반 |
| RFC 6750 | Bearer Token Usage | `Authorization: Bearer` |
| RFC 6265 | HTTP State Management (쿠키) | §8.5 — **쿠키는 포트를 구분하지 않습니다** |
| RFC 7519 | JSON Web Token (JWT) | 클레임 정의 |
| RFC 7591 | Dynamic Client Registration | `/oauth2/register` |
| RFC 7592 | Client Registration Management | 등록 수정·삭제 |
| RFC 7636 | PKCE | 필수로 설정 |
| RFC 7643/7644 | SCIM | 미구현 — 계정 생명주기 |
| RFC 7662 | Token Introspection | `/oauth2/introspect` |
| RFC 7009 | Token Revocation | `/oauth2/revoke` |
| RFC 8693 | Token Exchange | `src/token-exchange.ts` |
| RFC 8707 | Resource Indicators | `resource` 파라미터 |

OpenID Connect 쪽은 RFC가 아니라 OpenID Foundation 명세입니다 —
Core 1.0, Discovery 1.0, Dynamic Client Registration 1.0, RP-Initiated Logout 1.0,
Back-Channel Logout 1.0.

---

관련 문서: [README.md](README.md) · [PROVIDER-NOTES.md](PROVIDER-NOTES.md)

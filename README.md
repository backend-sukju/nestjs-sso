# NestJS SSO 목업 — OpenID Connect Provider

NestJS 위에 **[oidc-provider](https://github.com/panva/node-oidc-provider)**(OpenID Certified)를
얹은 SSO 서버 목업입니다. 클라이언트 앱 3개가 함께 들어 있어, SSO 로그인부터
**앱 간 API 호출(RFC 8693 토큰 교환)**, 백채널 로그아웃까지 브라우저로 확인할 수 있습니다.

프로토콜 구현은 라이브러리가 맡고, 이 저장소에는 조직 고유의 결정만 남습니다 —
클라이언트·리소스 등록, 로그인/동의 화면, 토큰 교환 정책.

## 모듈 시스템

전체가 ESM입니다 — `package.json`의 `"type": "module"`, tsconfig의 `module: nodenext`.
상대 import에는 `.js` 확장자가 필요합니다 (`import { CLIENTS } from './config/clients.js'`).
Node 22 이상이 필요합니다.

## 구성

| 프로세스 | 포트 | 역할 |
| --- | --- | --- |
| SSO 서버 (IdP) | 3000 | OIDC 프로바이더 |
| 사내 포털 | 4000 | 클라이언트 A — 다른 앱의 API를 호출하는 쪽 |
| 메모 앱 | 4100 | 클라이언트 B — RP이면서 **자기 API(`/api/notes`)를 호스팅** |
| 관리 콘솔 | 4200 | 클라이언트 C — 권한 경계 확인용 |

## 실행

```bash
npm install

# 터미널 1 — SSO 서버 (IdP)
npm start

# 터미널 2 — 클라이언트 앱 3개
npm run apps                # :4000 / :4100 / :4200
```

> SSO를 재시작하면 세션이 전부 사라지므로 앱들도 함께 재시작하는 편이 깔끔합니다
> (인메모리 어댑터라 앱이 들고 있는 세션과 어긋납니다).

브라우저에서 `http://localhost:4000` → **SSO 로그인** 클릭. 상단 네비게이션으로 세 앱을 오가면
로그인 화면 없이 그대로 들어가는 것을 확인할 수 있습니다.

| 목업 계정 | 비밀번호 |
| --- | --- |
| `alice` | `password123` |
| `bob` | `password123` |

자동 검증 (서버와 앱이 떠 있는 상태에서):

```bash
npm run test:e2e            # 프로토콜 단위 42개 시나리오
npm run test:multi          # 다중 클라이언트 · 앱 간 API 호출 32개 시나리오
```

스위트는 구현 세부에 묶이지 않게 작성돼 있습니다 — 폼 action을 화면에서 읽고,
내부 리다이렉트를 따라가며, 거부 방식(리다이렉트 vs 에러 화면)을 둘 다 허용합니다.
쿠키는 **브라우저와 동일하게 호스트 기준**으로 보관합니다(포트 무시). 오리진별로 나누면
같은 호스트의 앱끼리 쿠키가 충돌하는 버그를 놓칩니다 — 실제로 한 번 놓쳤습니다.

### 세 앱이 모두 localhost라서 생기는 것

쿠키는 호스트로만 구분되고 **포트는 무시됩니다**(RFC 6265 §8.5). 세 앱이 세션 쿠키 이름을
공유하면 앱을 오갈 때마다 서로의 쿠키를 덮어써 로그인이 풀립니다. 그래서 각 앱은
`rp_sid_<client_id>` 형태로 이름을 나눠 씁니다 (`apps/lib/rp.js`). 실제 배포처럼 앱마다
도메인이 다르면 생기지 않는 문제입니다.

## 인증 흐름

```
[Client] ──(1) GET /oauth2/authorize?code_challenge=…&state=…&nonce=… ──▶ [SSO]
[SSO]    ──(2) 로그인 화면 → 동의 화면 ───────────────────────────────▶ [User]
[SSO]    ──(3) 302 redirect_uri?code=…&state=… ──────────────────────▶ [Client]
[Client] ──(4) POST /oauth2/token  (code + code_verifier + client 인증) ▶ [SSO]
[SSO]    ──(5) access_token / id_token / refresh_token ──────────────▶ [Client]
[Client] ──(6) GET /oauth2/userinfo  (Bearer access_token) ──────────▶ [SSO]
```

**SSO의 실체**는 (2)단계입니다. 로그인 성공 시 IdP 도메인에 `sso_session` 쿠키가 심기고,
다른 클라이언트가 (1)단계로 들어오면 이 쿠키만으로 로그인 화면 없이 곧장 (3)으로 넘어갑니다.

## 엔드포인트

| 메서드 | 경로 | 설명 | 담당 |
| --- | --- | --- | --- |
| GET | `/.well-known/openid-configuration` | Discovery 문서 | 라이브러리 |
| GET | `/.well-known/jwks.json` | id_token 검증용 공개키 (JWKS) | 라이브러리 |
| GET | `/oauth2/authorize` | 인가 요청 (프론트채널) | 라이브러리 |
| POST | `/oauth2/token` | 인가 코드 · 리프레시 · **토큰 교환(RFC 8693)** | 라이브러리 + `token-exchange.ts` |
| GET·POST | `/oauth2/userinfo` | 액세스 토큰으로 사용자 정보 조회 | 라이브러리 |
| POST | `/oauth2/introspect` | 토큰 상태 조회 (RFC 7662) | 라이브러리 |
| POST | `/oauth2/revoke` | 토큰 폐기 (RFC 7009) | 라이브러리 |
| POST | `/oauth2/register` | **동적 클라이언트 등록 (RFC 7591/7592)** | 라이브러리 |
| GET | `/oauth2/logout` | RP-Initiated Logout + 백채널 통지 | 라이브러리 |
| GET | `/interaction` | 로그인 · 동의 화면 | **`interactions.ts`** |
| POST | `/interaction/login`, `/interaction/consent` | 자격증명 검증 · 동의 처리 | **`interactions.ts`** |

`/oauth2/register`가 공짜로 따라오는 이유는 **클라이언트 등록에는 표준이 있기** 때문입니다.
반대로 리소스(API) 등록은 표준이 없어 `config/resources.ts`로 직접 만들었습니다.

## 등록된 클라이언트

| client_id | 포트 | 접근 가능한 API | 토큰 교환 | 동의 화면 |
| --- | --- | --- | --- | --- |
| `portal-app` | 4000 | **메모 API** | 허용 | 있음 |
| `notes-app` | 4100 | 메모 API | 불가 | 생략 (1st-party) |
| `admin-app` | 4200 | 없음 | 불가 | 있음 |
| `demo-spa` | — | 없음 | 불가 | 생략 (public client 테스트용) |

UserInfo는 목록에 없습니다 — oidc-provider에서 **UserInfo는 리소스가 아니라서**,
`aud`가 붙은 토큰은 오히려 거부됩니다. 그래서 로그인용 액세스 토큰은
`resource`를 지정하지 않은 **불투명(opaque) 문자열**로 발급됩니다.

## 클라이언트 간 API 호출

포털은 메모 앱의 DB를 직접 보지 않습니다. **SSO에서 메모 API 전용 토큰을 교환받아 HTTP로 호출**합니다.

```
[포털 :4000] ──(1) POST /oauth2/token ─────────────────────────▶ [SSO :3000]
              grant_type=urn:ietf:params:oauth:grant-type:token-exchange
              subject_token=<포털의 로그인 토큰>
              audience=http://localhost:4100/api
              scope=notes:read

[SSO]        ──(2) 새 access_token ────────────────────────────▶ [포털]
              aud = http://localhost:4100/api   ← 메모 API 전용으로 좁혀짐
              sub = user-1001                   ← 사용자는 그대로
              act = { sub: "portal-app" }       ← 누가 대신 호출하는지 기록

[포털]        ──(3) GET /api/notes  Authorization: Bearer … ────▶ [메모 앱 :4100]
[메모 앱]     ──(4) JWKS로 서명 검증 → aud·scope·sub 확인 ──────┐
              ──(5) 그 사용자의 메모만 응답 ────────────────────▶ [포털]
```

세 가지가 동시에 성립합니다.

- **포털은 메모 앱의 비밀번호나 DB를 모른다** — 가진 건 SSO가 발급한 토큰뿐입니다.
- **토큰은 메모 API에서만 통한다** — `aud`가 좁혀져 있어 다른 API에 재사용할 수 없습니다.
  포털의 로그인 토큰(불투명 문자열, aud 없음)을 그대로 들이밀면 메모 앱이 401로 거부합니다.
- **호출 주체가 남는다** — `act.sub=portal-app`이 찍혀서, 메모 앱은 "앨리스 본인의 직접 호출"과
  "포털이 앨리스를 대신한 호출"을 구분해 로그로 남깁니다.

관리 콘솔은 클라이언트 등록 정보에 메모 API가 없어서, 같은 사용자로 로그인했더라도
토큰 교환 자체가 `invalid_target`으로 거부됩니다.

## 로그아웃 연동 (Back-Channel Logout)

한 앱에서 로그아웃하면 SSO가 그 세션에 참여한 **모든 클라이언트의 `backchannel_logout_uri`로
`logout_token`(JWT)을 서버-서버로 POST**합니다. 각 앱은 JWKS로 검증한 뒤 해당 `sid`의 로컬 세션을
끊습니다. 브라우저가 각 앱을 방문하지 않아도 세 앱이 함께 로그아웃됩니다.

## 코드 구조

```
src/                            # SSO 서버 — 전부 합쳐 700줄, 프로토콜 코드는 0줄
├─ main.ts                      # Nest 부트스트랩 + provider 미들웨어 마운트
├─ provider.factory.ts          # ★ oidc-provider 설정 (기능 플래그 · 라우트 · TTL · 서명 키)
├─ interactions.ts              # 로그인 · 동의 화면 (라이브러리가 안 해주는 유일한 UI)
├─ token-exchange.ts            # RFC 8693 — oidc-provider 에 없어 직접 등록
├─ resources.runtime.ts         # getResourceServerInfo — 클라이언트별 API 접근 허용
├─ oidc-provider.d.ts           # 패키지에 타입이 없어 모듈 선언만
├─ config/
│  ├─ clients.ts                # 클라이언트 등록 (RFC 7591 메타데이터 형식)
│  ├─ resources.ts              # 리소스(API) 레지스트리 — scope 정의를 소유. 표준 없음
│  └─ accounts.ts               # 인메모리 사용자
└─ views/templates.ts           # 로그인 · 동의 · 오류 화면 HTML

apps/
├─ lib/rp.js                    # 세 앱이 공유하는 OIDC 클라이언트 구현
├─ lib/ui.js                    # 공용 화면 스타일 · 네비게이션
├─ portal.js                    # :4000 토큰 교환 → 메모 앱 API 호출
├─ notes.js                     # :4100 RP + 리소스 서버(/api/notes)
├─ admin.js                     # :4200 권한 경계 확인
└─ run-all.js                   # 세 앱 동시 실행
```

## 적용된 보안 규칙

oidc-provider가 기본으로 해주는 것 — redirect_uri 완전 일치, 인가 코드 1회용,
state/nonce 반사, 클라이언트 인증(Basic/post/none), UserInfo의 aud 검사.
여기에 더해 **인가 코드가 재사용되면 그 grant의 토큰을 전부 폐기**합니다(탈취 신호로 간주).

설정으로 켠 것:

- **PKCE 필수 (S256)** — `pkce: { required: () => true }`. public·confidential 모두 강제.
- **리프레시 토큰 회전** — `rotateRefreshToken: true`. 기본값은 public 클라이언트만입니다.
- **aud 분리 (RFC 8707)** — `resourceIndicators`. 액세스 토큰마다 호출 대상 API를 못박습니다.
  `resources.runtime.ts`가 클라이언트별 접근 허용까지 검사합니다.
- **백채널 로그아웃** — `backchannelLogout`. 세션이 끊기면 전 클라이언트에 통지합니다.

토큰 교환(`token-exchange.ts`)에 직접 넣은 규칙:

- **축소만 가능** — 결과 scope ⊆ 원본 토큰의 scope. 이 교집합을 빼면 로그인 때 동의하지 않은
  권한을 교환 단계에서 새로 만들어낼 수 있습니다. (`npm run test:multi`의 `[6]`)
- **위임 재교환 차단** — 이미 `act`가 붙은 토큰은 다시 교환할 수 없습니다.
- **세션 확인** — 로그아웃된 세션의 토큰으로는 새 토큰을 받아갈 수 없습니다.

설정 하나하나의 배경은 [PROVIDER-NOTES.md](PROVIDER-NOTES.md)에 정리했습니다.

## 목업이라 생략한 것 (운영 전환 시 필요)

1. **영속화** — oidc-provider의 기본 인메모리 어댑터를 씁니다(기동 시 경고가 뜹니다).
   재시작하면 세션·토큰이 사라지고 다중 인스턴스에서 동작하지 않습니다. `adapter` 교체가 필요합니다.
   사용자·클라이언트·리소스 등록도 코드에 하드코딩되어 있습니다 — DB나 설정 파일로 빼야 합니다.
2. **서명 키 관리** — 키를 `.keys/signing-key.jwk.json` 평문 파일에 보관합니다(재시작해도 `kid`가 유지되도록).
   운영에서는 KMS/HSM에 보관하고 `kid` 기반 무중단 롤오버가 필요합니다.
3. **비밀번호 해싱** — 목업 사용자 비밀번호가 평문입니다. bcrypt/argon2로 교체해야 합니다.
4. **쿠키 보안** — `secure: true`, HTTPS, 세션 고정 방지를 위한 로그인 시 세션 ID 재발급이 필요합니다.
5. **브루트포스 방어** — 로그인 시도 제한, 계정 잠금, CAPTCHA가 없습니다.
6. **CSRF 토큰** — 우리가 만든 `/interaction/login`·`/interaction/consent` 폼에 CSRF 토큰이 없습니다.
   (`sameSite: lax`에만 의존. 라이브러리의 로그아웃 폼에는 xsrf가 있습니다)
7. **CORS** — 현재 모든 origin을 허용합니다. 등록된 클라이언트 origin만 열어야 합니다.
8. **SSRF 방어를 껐습니다** — 앱이 localhost라 백채널 통지가 막혀서, `fetch` 훅에서 localhost에
   한해 우회했습니다. 운영에서는 절대 하면 안 됩니다. ([PROVIDER-NOTES.md](PROVIDER-NOTES.md))
9. **감사 로그 / MFA / 동의 이력 관리** — 미구현.

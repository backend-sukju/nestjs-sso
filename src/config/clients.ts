/**
 * 클라이언트 등록.
 * ★ 직접 짠 버전의 OAuthClient 인터페이스와 달리, 여기 필드명은 전부
 *   RFC 7591(+ OIDC Dynamic Client Registration) 표준 메타데이터다.
 *   그래서 DCR 엔드포인트로 등록해도 똑같은 모양이 된다.
 */
const NOTES_API = 'http://localhost:4100/api';

// UserInfo 는 여기 없다 — oidc-provider 에서 UserInfo 는 리소스가 아니라서
// aud 가 붙은 토큰은 오히려 거부된다. 로그인 토큰은 불투명(opaque) 문자열로 나간다.
const TOKEN_EXCHANGE = 'urn:ietf:params:oauth:grant-type:token-exchange';

export const CLIENTS = [
  {
    client_id: 'portal-app',
    client_secret: 'portal-secret',
    client_name: '사내 포털 (:4000)',
    token_endpoint_auth_method: 'client_secret_basic',
    grant_types: ['authorization_code', 'refresh_token', TOKEN_EXCHANGE],
    response_types: ['code'],
    redirect_uris: ['http://localhost:4000/callback'],
    post_logout_redirect_uris: ['http://localhost:4000/'],
    scope: 'openid profile email offline_access notes:read',
    require_auth_time: true,
    backchannel_logout_uri: 'http://localhost:4000/backchannel-logout',
    backchannel_logout_session_required: true,
    // ↓ 표준에 없는 필드 — extraClientMetadata 로 등록해서 쓴다
    allowed_resources: [NOTES_API],
    skip_consent: false,
  },
  {
    client_id: 'notes-app',
    client_secret: 'notes-secret',
    client_name: '메모 앱 (:4100)',
    token_endpoint_auth_method: 'client_secret_basic',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    redirect_uris: ['http://localhost:4100/callback'],
    post_logout_redirect_uris: ['http://localhost:4100/'],
    scope: 'openid profile email notes:read notes:write',
    require_auth_time: true,
    backchannel_logout_uri: 'http://localhost:4100/backchannel-logout',
    backchannel_logout_session_required: true,
    allowed_resources: [NOTES_API],
    skip_consent: true,
  },
  {
    client_id: 'admin-app',
    client_secret: 'admin-secret',
    client_name: '관리 콘솔 (:4200)',
    token_endpoint_auth_method: 'client_secret_basic',
    grant_types: ['authorization_code'],
    response_types: ['code'],
    redirect_uris: ['http://localhost:4200/callback'],
    post_logout_redirect_uris: ['http://localhost:4200/'],
    scope: 'openid profile email',
    require_auth_time: true,
    backchannel_logout_uri: 'http://localhost:4200/backchannel-logout',
    backchannel_logout_session_required: true,
    // 접근 가능한 API 가 없다 → 토큰 교환을 시도해도 invalid_target
    allowed_resources: [],
    skip_consent: false,
  },
  {
    client_id: 'demo-spa',
    client_name: '데모 SPA (public, secret 없음)',
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code'],
    response_types: ['code'],
    redirect_uris: ['http://localhost:4000/callback'],
    post_logout_redirect_uris: ['http://localhost:4000/'],
    scope: 'openid profile',
    require_auth_time: true,
    allowed_resources: [],
    skip_consent: true,
  },
];

/** 표준 밖 메타데이터. oidc-provider 에 이름을 알려줘야 등록 시 보존된다 */
export const EXTRA_CLIENT_METADATA = ['allowed_resources', 'skip_consent'];

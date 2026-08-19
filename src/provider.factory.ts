import { Logger } from '@nestjs/common';
import Provider, { errors } from 'oidc-provider';
import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { CLIENTS, EXTRA_CLIENT_METADATA } from './config/clients.js';
import { findUserById } from './config/accounts.js';
import { ALL_RESOURCE_SCOPES, RESOURCES } from './config/resources.js';
import { getResourceServerInfo } from './resources.runtime.js';
import { createTokenExchangeHandler, TOKEN_EXCHANGE, TOKEN_EXCHANGE_PARAMS } from './token-exchange.js';
import { errorPage, loggedOutPage } from './views/templates.js';

const logger = new Logger('OidcProvider');

/** 직접 짠 버전과 같은 키 파일을 쓴다 → 서버를 바꿔도 kid 가 유지된다 */
function loadJwks(): { keys: unknown[] } {
  const path = resolve(process.env.SIGNING_KEY_PATH ?? '.keys/signing-key.jwk.json');

  let jwk: Record<string, unknown>;
  try {
    jwk = JSON.parse(readFileSync(path, 'utf8'));
    logger.log(`서명 키 로드: ${path}`);
  } catch {
    // 첫 기동이면 만들어 저장한다. 재시작마다 키가 바뀌면 클라이언트가 캐시한
    // JWKS 와 어긋나서 모든 토큰 검증이 깨진다.
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    jwk = privateKey.export({ format: 'jwk' }) as Record<string, unknown>;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(jwk, null, 2), { mode: 0o600 });
    logger.log(`서명 키 생성: ${path}`);
  }
  return { keys: [{ ...jwk, use: 'sig', alg: 'RS256' }] };
}

/** 클라이언트 등록의 scope 에 어디에도 정의되지 않은 이름이 있으면 기동을 막는다 */
function validateRegistrations(staticScopes: string[]): void {
  const known = new Set([...staticScopes, ...ALL_RESOURCE_SCOPES]);
  for (const client of CLIENTS) {
    const unknown = (client.scope ?? '').split(' ').filter((s) => s && !known.has(s));
    if (unknown.length) {
      throw new Error(
        `클라이언트 ${client.client_id} 의 scope 에 등록되지 않은 이름이 있습니다: ${unknown.join(', ')}`,
      );
    }
    const resources: string[] = (client as any).allowed_resources ?? [];
    for (const r of resources) {
      if (!RESOURCES.some((x) => x.identifier === r)) {
        throw new Error(`클라이언트 ${client.client_id} 가 미등록 resource 를 참조합니다: ${r}`);
      }
    }
  }
}

export async function createProvider(issuer: string): Promise<any> {
  // 리소스 scope 도 Authorization Server 가 아는 이름이어야 클라이언트 등록이 통과한다
  // (oidc-provider 는 client.scope 를 이 목록과 대조한다)
  const staticScopes = ['openid', 'profile', 'email', 'offline_access', ...ALL_RESOURCE_SCOPES];
  validateRegistrations(staticScopes);

  const provider = new Provider(issuer, {
    clients: CLIENTS,
    jwks: loadJwks(),

    // 표준 밖 메타데이터를 등록해야 클라이언트 객체에 보존된다
    extraClientMetadata: { properties: EXTRA_CLIENT_METADATA },

    scopes: staticScopes,
    claims: {
      openid: ['sub'],
      profile: ['name', 'preferred_username', 'picture'],
      email: ['email', 'email_verified'],
    },

    async findAccount(_ctx: any, id: string) {
      const user = findUserById(id);
      if (!user) return undefined;
      return {
        accountId: id,
        async claims(_use: string, scope: string) {
          const s = scope.split(' ');
          return {
            sub: id,
            ...(s.includes('profile')
              ? { name: user.name, preferred_username: user.username, picture: user.picture }
              : {}),
            ...(s.includes('email') ? { email: user.email, email_verified: user.emailVerified } : {}),
          };
        },
      };
    },

    // 직접 짠 버전과 같은 경로를 쓴다 → 앱과 테스트가 그대로 붙는다
    routes: {
      authorization: '/oauth2/authorize',
      token: '/oauth2/token',
      userinfo: '/oauth2/userinfo',
      end_session: '/oauth2/logout',
      introspection: '/oauth2/introspect',
      revocation: '/oauth2/revoke',
      registration: '/oauth2/register',
      jwks: '/.well-known/jwks.json',
    },

    // 상호작용 URL 에 uid 를 넣지 않는다 — oidc-provider 가 상호작용 쿠키의 path 를
    // 이 URL 로 잡기 때문에, uid 를 넣으면 폼 POST 경로가 쿠키 범위를 벗어난다.
    interactions: { url: () => '/interaction' },

    pkce: { required: () => true },

    // 기본값(true)이면 code 플로우의 id_token 에는 sub 만 담긴다(스펙 권장).
    // 직접 짠 버전과 화면 동작을 맞추기 위해 프로필 클레임을 함께 싣는다.
    conformIdTokenClaims: false,

    // 기본값은 public 클라이언트에만 회전을 적용한다. 직접 짠 버전과 맞춰 항상 회전.
    rotateRefreshToken: true,

    /**
     * 스펙대로라면 offline_access 는 prompt=consent 가 함께 와야 유효하고,
     * oidc-provider 는 그렇지 않으면 scope 에서 조용히 제거한다(OIDC Core §11).
     * 이 목업은 직접 짠 버전과 의미를 맞추려고 클라이언트 등록 기준으로만 판단한다.
     */
    async issueRefreshToken(_ctx: any, client: any) {
      return client.grantTypeAllowed('refresh_token');
    },

    ttl: {
      AccessToken: 600,
      AuthorizationCode: 60,
      IdToken: 600,
      RefreshToken: 60 * 60 * 24 * 14,
      Session: 60 * 60 * 8,
      Grant: 60 * 60 * 8,
      Interaction: 600,
    },

    features: {
      devInteractions: { enabled: false },
      // ↓ 직접 짠 버전에서 손으로 만든 것들이 전부 플래그 하나로 대체된다
      resourceIndicators: {
        enabled: true,
        getResourceServerInfo: (ctx: any, ri: string, client: any) =>
          getResourceServerInfo(ctx, ri, client, errors),
        // 클라이언트가 resource 를 명시하지 않으면 토큰을 특정 API 에 묶지 않는다.
        // (묶이면 oidc-provider 가 /userinfo 에서 그 토큰을 거부한다)
        useGrantedResource: () => false,
      },
      backchannelLogout: { enabled: true },
      rpInitiatedLogout: {
        enabled: true,
        // 기본 로그아웃 확인 화면을 자동 제출 폼으로 바꾼다.
        // (확인 단계 자체는 남겨두되 사용자 클릭 없이 진행 — 브라우저에서 자연스럽게 동작)
        async logoutSource(ctx: any, form: string) {
          ctx.type = 'html';
          ctx.body = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<title>로그아웃 · SSO</title></head><body>${form}
<script>document.forms[0].submit()</script>
<noscript><button type="submit" form="op.logoutForm" name="logout" value="yes">로그아웃 계속</button></noscript>
</body></html>`;
        },
        async postLogoutSuccessSource(ctx: any) {
          ctx.type = 'html';
          ctx.body = loggedOutPage();
        },
      },
      introspection: { enabled: true },
      revocation: { enabled: true },
      // 클라이언트 등록은 표준(RFC 7591/7592)이라 켜기만 하면 된다
      registration: { enabled: true, initialAccessToken: false },
      registrationManagement: { enabled: true },
    },

    /** 위임 체인 표시 — 교환으로 나온 토큰에만 act 를 붙인다 */
    async extraTokenClaims(_ctx: any, token: any) {
      if (token.gty?.includes('token-exchange')) {
        return { act: { sub: token.clientId } };
      }
      return undefined;
    },

    /** skip_consent 클라이언트는 동의 화면 없이 자동 승인 */
    async loadExistingGrant(ctx: any) {
      const grantId =
        ctx.oidc.result?.consent?.grantId ??
        ctx.oidc.session.grantIdFor(ctx.oidc.client.clientId);

      if (grantId) return ctx.oidc.provider.Grant.find(grantId);
      if (!(ctx.oidc.client as any).skip_consent) return undefined;

      const grant = new ctx.oidc.provider.Grant({
        clientId: ctx.oidc.client.clientId,
        accountId: ctx.oidc.session.accountId,
      });
      grant.addOIDCScope(ctx.oidc.params.scope);
      const resource = ctx.oidc.params.resource;
      if (resource) grant.addResourceScope(resource, ctx.oidc.params.scope);
      await grant.save();
      return grant;
    },

    async renderError(ctx: any, out: any) {
      ctx.type = 'html';
      ctx.body = errorPage(out.error ?? 'error', out.error_description ?? '');
    },

    /**
     * oidc-provider 는 아웃바운드 요청(백채널 로그아웃 등)이 특수 용도 IP 로
     * 가는 것을 SSRF 방어로 차단한다. 이 목업은 앱들이 localhost 에 있어서
     * 백채널 통지가 전부 막히므로, localhost 에 한해 보호 디스패처를 우회한다.
     * ★ 운영에서는 절대 하면 안 된다 — 내부망 스캔을 막는 장치다.
     */
    async fetch(url: string, options: any) {
      if (new URL(url).hostname === 'localhost') delete options.dispatcher;
      return globalThis.fetch(url, options);
    },

    cookies: {
      keys: [process.env.COOKIE_KEY ?? 'mockup-cookie-key'],
      names: { session: 'sso_session', interaction: '_interaction', resume: '_interaction_resume' },
    },
  });

  provider.registerGrantType(
    TOKEN_EXCHANGE,
    createTokenExchangeHandler(errors),
    TOKEN_EXCHANGE_PARAMS,
  );
  logger.log(`토큰 교환(RFC 8693) grant 등록: ${TOKEN_EXCHANGE}`);

  provider.on('backchannel.success', (_ctx: any, client: any) =>
    logger.log(`백채널 로그아웃 통지 성공: ${client.clientId}`));
  provider.on('backchannel.error', (_ctx: any, err: any, client: any) =>
    logger.warn(`백채널 로그아웃 통지 실패: ${client?.clientId} — ${err?.message} / cause=${err?.cause?.message ?? err?.cause?.code ?? ''} / uri=${client?.backchannelLogoutUri}`));
  provider.on('grant.error', (_ctx: any, err: any) => logger.warn(`grant.error: ${err.message}`));
  provider.on('server_error', (_ctx: any, err: any) => logger.error(err));

  return provider;
}

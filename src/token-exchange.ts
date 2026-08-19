/**
 * RFC 8693 토큰 교환 — oidc-provider 에 없는 유일한 기능이라 직접 붙인다.
 * provider.registerGrantType(name, handler, params) 로 등록한다.
 *
 * 직접 짠 버전(src/oidc/token.controller.ts)의 규칙을 그대로 옮겼다:
 *   - subject_token 은 이 클라이언트에게 발급된 것이어야 한다
 *   - 이미 위임된 토큰(act 있음)은 재교환 불가
 *   - 대상 리소스는 클라이언트의 allowed_resources 안에 있어야 한다
 *   - 최종 scope ⊆ 원본 토큰의 scope  ← 이걸 빼면 권한 상승이 된다
 */
import { getResourceServerInfo, resourceOf } from './resources.runtime.js';

export const TOKEN_EXCHANGE = 'urn:ietf:params:oauth:grant-type:token-exchange';
const ACCESS_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:access_token';

export const TOKEN_EXCHANGE_PARAMS = [
  'subject_token',
  'subject_token_type',
  'requested_token_type',
  'audience',
  'resource',
  'scope',
];

export function createTokenExchangeHandler(errors: any) {
  const { InvalidGrant, InvalidRequest, InvalidTarget, InvalidScope } = errors;

  return async function tokenExchangeHandler(ctx: any): Promise<void> {
    const { client } = ctx.oidc;
    const { AccessToken, ResourceServer } = ctx.oidc.provider;
    const params = ctx.oidc.params;

    if (!params.subject_token) throw new InvalidRequest('subject_token 파라미터가 필요합니다');
    if (params.subject_token_type && params.subject_token_type !== ACCESS_TOKEN_TYPE) {
      throw new InvalidRequest(`지원하지 않는 subject_token_type: ${params.subject_token_type}`);
    }

    const target = params.audience ?? params.resource;
    if (!target) throw new InvalidRequest('audience(또는 resource) 파라미터가 필요합니다');

    const resource = resourceOf(target);
    if (!resource) throw new InvalidTarget(`등록되지 않은 대상입니다: ${target}`);

    const subject = await AccessToken.find(params.subject_token);
    if (!subject) throw new InvalidGrant('subject_token 이 유효하지 않습니다');
    if (subject.clientId !== client.clientId) {
      throw new InvalidGrant('다른 클라이언트에 발급된 토큰은 교환할 수 없습니다');
    }
    if (subject.gty?.includes('token-exchange')) {
      throw new InvalidGrant('이미 위임된 토큰은 다시 교환할 수 없습니다');
    }

    // getResourceServerInfo 안에서 allowed_resources 를 검사한다
    const info = await getResourceServerInfo(ctx, target, client, errors);

    // 최종 scope = 요청 ∩ 원본 토큰 ∩ 클라이언트 허용 ∩ 리소스 지원
    const requested: string[] = (params.scope ?? '').split(' ').filter(Boolean);
    const subjectScopes: string[] = [...(subject.scopes ?? new Set<string>())];
    const clientScopes = new Set((client.scope ?? '').split(' ').filter(Boolean));
    const resourceScopes = new Set(info.scope.split(' '));

    const scopes = (requested.length ? requested.filter((s) => subjectScopes.includes(s)) : subjectScopes)
      .filter((s) => clientScopes.has(s))
      .filter((s) => resourceScopes.has(s));

    if (!scopes.length) {
      throw new InvalidScope(`${resource.name} 에 대해 허용된 scope 가 없습니다`, params.scope);
    }

    const token = new AccessToken({
      accountId: subject.accountId,
      client,
      grantId: subject.grantId,
      gty: 'token-exchange',
      scope: scopes.join(' '),
      sessionUid: subject.sessionUid,
      sid: subject.sid,
      expiresWithSession: subject.expiresWithSession,
    });
    token.resourceServer = new ResourceServer(target, info);

    ctx.oidc.entity('AccessToken', token);
    const value = await token.save();

    ctx.body = {
      access_token: value,
      issued_token_type: ACCESS_TOKEN_TYPE,
      token_type: token.tokenType,
      expires_in: token.expiration,
      scope: token.scope,
    };
  };
}

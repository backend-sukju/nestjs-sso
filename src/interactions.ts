/**
 * 로그인·동의 화면. oidc-provider 가 대신해주지 않는 유일한 UI 영역이다.
 * (프로토콜은 라이브러리가, "사용자에게 무엇을 어떻게 묻는가"는 우리가)
 *
 * 화면 템플릿은 직접 짠 버전과 같은 파일을 재사용한다 — 엔진만 바뀌고 UI 는 동일.
 */
import { Logger } from '@nestjs/common';
import express, { type Request, type Response, type Router } from 'express';
import { validateUser, findUserById } from './config/accounts.js';
import { SCOPE_LABELS } from './config/resources.js';
import { consentPage, errorPage, loginPage } from './views/templates.js';

const logger = new Logger('Interactions');
const form = express.urlencoded({ extended: false });

export function createInteractionRouter(provider: any): Router {
  const router = express.Router();

  /** 어떤 상호작용이 필요한지 보고 화면을 고른다 */
  router.get('/interaction', async (req: Request, res: Response) => {
    try {
      const details = await provider.interactionDetails(req, res);
      const client = await provider.Client.find(details.params.client_id);

      if (details.prompt.name === 'login') {
        return res.type('html').send(
          loginPage({
            authRequestId: details.uid,
            clientName: client.clientName,
            action: '/interaction/login',
          }),
        );
      }

      if (details.prompt.name === 'consent') {
        const user = findUserById(details.session.accountId);
        return res.type('html').send(
          consentPage({
            authRequestId: details.uid,
            clientName: client.clientName,
            userName: user?.name ?? details.session.accountId,
            scopes: missingScopes(details.prompt.details),
            action: '/interaction/consent',
            labels: SCOPE_LABELS,
          }),
        );
      }

      return res
        .status(400)
        .type('html')
        .send(errorPage('unsupported_prompt', `처리하지 않는 prompt: ${details.prompt.name}`));
    } catch (e: any) {
      return res.status(400).type('html').send(errorPage('invalid_request', e.message));
    }
  });

  router.post('/interaction/login', form, async (req: Request, res: Response) => {
    try {
      const details = await provider.interactionDetails(req, res);
      const client = await provider.Client.find(details.params.client_id);
      const { username, password } = req.body as Record<string, string>;

      const user = validateUser(username ?? '', password ?? '');
      if (!user) {
        return res.status(401).type('html').send(
          loginPage({
            authRequestId: details.uid,
            clientName: client.clientName,
            error: '아이디 또는 비밀번호가 올바르지 않습니다.',
            username,
            action: '/interaction/login',
          }),
        );
      }

      logger.log(`로그인 성공: ${user.username} (${client.clientId})`);
      // mergeWithLastSubmission:false — 새 로그인이므로 이전 제출값을 이어받지 않는다
      return await provider.interactionFinished(
        req,
        res,
        { login: { accountId: user.id } },
        { mergeWithLastSubmission: false },
      );
    } catch (e: any) {
      return res.status(400).type('html').send(errorPage('invalid_request', e.message));
    }
  });

  router.post('/interaction/consent', form, async (req: Request, res: Response) => {
    try {
      const details = await provider.interactionDetails(req, res);
      const { prompt, params, session, grantId } = details;

      if ((req.body as Record<string, string>).decision !== 'allow') {
        return await provider.interactionFinished(req, res, {
          error: 'access_denied',
          error_description: '사용자가 접근 권한을 거부했습니다',
        });
      }

      const grant = grantId
        ? await provider.Grant.find(grantId)
        : new provider.Grant({ accountId: session.accountId, clientId: params.client_id });

      const d = prompt.details;
      if (d.missingOIDCScope) grant.addOIDCScope(d.missingOIDCScope.join(' '));
      if (d.missingOIDCClaims) grant.addOIDCClaims(d.missingOIDCClaims);
      if (d.missingResourceScopes) {
        for (const [indicator, scopes] of Object.entries(d.missingResourceScopes)) {
          grant.addResourceScope(indicator, (scopes as string[]).join(' '));
        }
      }

      const saved = await grant.save();
      return await provider.interactionFinished(
        req,
        res,
        { consent: { grantId: saved } },
        { mergeWithLastSubmission: true },
      );
    } catch (e: any) {
      return res.status(400).type('html').send(errorPage('invalid_request', e.message));
    }
  });

  return router;
}

/** 동의 화면에 보여줄 scope = OIDC scope + 리소스별 scope */
function missingScopes(details: any): string[] {
  const oidc: string[] = details.missingOIDCScope ?? [];
  const resource: string[] = Object.values(details.missingResourceScopes ?? {}).flat() as string[];
  return [...new Set([...oidc, ...resource])];
}

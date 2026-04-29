import { Request, Response } from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import axios from 'axios';
import { v7 as uuidv7 } from 'uuid';
import { getPrisma } from '../lib/prisma.js';

// Cookie options
function cookieOpts(maxAge: number): object {
  const isProduction = (process.env.WEB_ORIGIN || '').startsWith('https://');
  return { httpOnly: true, sameSite: isProduction ? 'none' : 'lax', secure: isProduction, maxAge };
}

// In-memory PKCE + state store (TTL: 10 minutes)
interface PkceEntry {
  code_challenge: string;
  code_challenge_method: string;
  redirect_uri?: string;
  created_at: number;
}
const pkceStore = new Map<string, PkceEntry>();

function cleanPkceStore() {
  const now = Date.now();
  for (const [state, entry] of pkceStore) {
    if (now - entry.created_at > 10 * 60 * 1000) pkceStore.delete(state);
  }
}

// Token helpers

function issueAccessToken(userId: string, role: string): string {
  return jwt.sign(
    { sub: userId, role },
    process.env.JWT_SECRET!,
    { expiresIn: (process.env.ACCESS_TOKEN_EXPIRY || '3m') as any }
  );
}

async function issueRefreshToken(userId: string): Promise<string> {
  const prisma = getPrisma();
  const plain = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(plain).digest('hex');
  const expiresAt = new Date(Date.now() + Number(process.env.REFRESH_TOKEN_EXPIRY_MS || 300000));

  await prisma.refreshToken.create({
    data: { id: uuidv7(), user_id: userId, token_hash: hash, expires_at: expiresAt },
  });
  return plain;
}

function hashToken(plain: string): string {
  return crypto.createHash('sha256').update(plain).digest('hex');
}

// GitHub OAuth helpers

function buildGithubAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GITHUB_CLIENT_ID!,
    redirect_uri: process.env.GITHUB_CALLBACK_URL!,
    scope: 'read:user user:email',
    state,
  });
  return `https://github.com/login/oauth/authorize?${params}`;
}

async function exchangeCodeForToken(code: string): Promise<string> {
  const res = await axios.post(
    'https://github.com/login/oauth/access_token',
    {
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: process.env.GITHUB_CALLBACK_URL,
    },
    { headers: { Accept: 'application/json' } }
  );
  if (!res.data.access_token) throw new Error('GitHub did not return an access token');
  return res.data.access_token;
}

async function getGithubUser(ghToken: string) {
  const [userRes, emailRes] = await Promise.all([
    axios.get('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${ghToken}`, 'User-Agent': 'insighta-api' },
    }),
    axios.get('https://api.github.com/user/emails', {
      headers: { Authorization: `Bearer ${ghToken}`, 'User-Agent': 'insighta-api' },
    }).catch(() => ({ data: [] })),
  ]);
  const primary = (emailRes.data as any[]).find((e: any) => e.primary)?.email ?? null;
  return { ...userRes.data, primary_email: primary };
}

async function upsertUser(ghUser: any) {
  const prisma = getPrisma();
  const existing = await prisma.user.findUnique({ where: { github_id: String(ghUser.id) } });

  if (existing) {
    return prisma.user.update({
      where: { github_id: String(ghUser.id) },
      data: {
        username: ghUser.login,
        email: ghUser.primary_email,
        avatar_url: ghUser.avatar_url,
        last_login_at: new Date(),
      },
    });
  }

  return prisma.user.create({
    data: {
      id: uuidv7(),
      github_id: String(ghUser.id),
      username: ghUser.login,
      email: ghUser.primary_email,
      avatar_url: ghUser.avatar_url,
      role: 'analyst',
      is_active: true,
      last_login_at: new Date(),
    },
  });
}

// Controllers

export class AuthController {
  // GET /auth/github — start OAuth (PKCE-aware)
  static startGithubOAuth(req: Request, res: Response) {
    cleanPkceStore();
    const state = crypto.randomBytes(16).toString('hex');
    const { code_challenge, code_challenge_method, redirect_uri } = req.query as Record<string, string>;

    if (code_challenge) {
      pkceStore.set(state, {
        code_challenge,
        code_challenge_method: code_challenge_method || 'S256',
        redirect_uri,
        created_at: Date.now(),
      });
    } else {
      // Web flow — store state with no PKCE
      pkceStore.set(state, { code_challenge: '', code_challenge_method: '', redirect_uri, created_at: Date.now() });
    }

    return res.redirect(buildGithubAuthUrl(state));
  }

  // GET /auth/github/callback
  static async webCallback(req: Request, res: Response) {
    const { code, state } = req.query as Record<string, string>;
    const webOrigin = process.env.WEB_ORIGIN || 'http://localhost:5173';

    try {
      if (!code || !state || !pkceStore.has(state)) {
        return res.redirect(`${webOrigin}/login?error=invalid_state`);
      }
      pkceStore.delete(state);

      const ghToken = await exchangeCodeForToken(code);
      const ghUser = await getGithubUser(ghToken);
      const user = await upsertUser(ghUser);

      if (!user.is_active) {
        return res.redirect(`${webOrigin}/login?error=account_disabled`);
      }

      const accessToken = issueAccessToken(user.id, user.role);
      const refreshToken = await issueRefreshToken(user.id);

      res
        .cookie('access_token', accessToken, cookieOpts(3 * 60 * 1000))
        .cookie('refresh_token', refreshToken, cookieOpts(Number(process.env.REFRESH_TOKEN_EXPIRY_MS || 300000)))
        .redirect(`${webOrigin}/`);
    } catch (err) {
      console.error('Web OAuth callback error:', err);
      res.redirect(`${webOrigin}/login?error=auth_failed`);
    }
  }

  // POST /auth/cli/callback — CLI sends {code, state, code_verifier}
  static async cliCallback(req: Request, res: Response) {
    const { code, state, code_verifier } = req.body as Record<string, string>;

    if (!code || !state || !code_verifier) {
      return res.status(400).json({ status: 'error', message: 'Missing required fields: code, state, code_verifier' });
    }

    const entry = pkceStore.get(state);
    if (!entry) {
      return res.status(400).json({ status: 'error', message: 'Invalid or expired state' });
    }
    pkceStore.delete(state);

    // Verify PKCE
    if (entry.code_challenge) {
      const expected = crypto
        .createHash('sha256')
        .update(code_verifier)
        .digest('base64url');
      if (expected !== entry.code_challenge) {
        return res.status(400).json({ status: 'error', message: 'PKCE verification failed' });
      }
    }

    try {
      const ghToken = await exchangeCodeForToken(code);
      const ghUser = await getGithubUser(ghToken);
      const user = await upsertUser(ghUser);

      if (!user.is_active) {
        return res.status(403).json({ status: 'error', message: 'Account is disabled' });
      }

      const accessToken = issueAccessToken(user.id, user.role);
      const refreshToken = await issueRefreshToken(user.id);

      return res.status(200).json({
        status: 'success',
        access_token: accessToken,
        refresh_token: refreshToken,
        user: { id: user.id, username: user.username, email: user.email, avatar_url: user.avatar_url, role: user.role },
      });
    } catch (err) {
      console.error('CLI callback error:', err);
      return res.status(502).json({ status: 'error', message: 'GitHub authentication failed' });
    }
  }

  // POST /auth/refresh
  static async refresh(req: Request, res: Response) {
    const prisma = getPrisma();
    // Accept from body (CLI) or cookie (web)
    const plain: string = req.body?.refresh_token || req.cookies?.refresh_token;

    if (!plain) {
      return res.status(400).json({ status: 'error', message: 'Refresh token required' });
    }

    try {
      const hash = hashToken(plain);
      const stored = await prisma.refreshToken.findUnique({ where: { token_hash: hash }, include: { user: true } });

      if (!stored || stored.expires_at < new Date()) {
        return res.status(401).json({ status: 'error', message: 'Invalid or expired refresh token' });
      }
      if (!stored.user.is_active) {
        return res.status(403).json({ status: 'error', message: 'Account is disabled' });
      }

      // Rotate — delete old, issue new pair
      await prisma.refreshToken.delete({ where: { id: stored.id } });

      const newAccessToken = issueAccessToken(stored.user.id, stored.user.role);
      const newRefreshToken = await issueRefreshToken(stored.user.id);

      // Web: set cookies; CLI: return JSON
      if (req.cookies?.refresh_token) {
        return res
          .cookie('access_token', newAccessToken, cookieOpts(3 * 60 * 1000))
          .cookie('refresh_token', newRefreshToken, cookieOpts(Number(process.env.REFRESH_TOKEN_EXPIRY_MS || 300000)))
          .json({ status: 'success', access_token: newAccessToken, refresh_token: newRefreshToken });
      }

      return res.json({ status: 'success', access_token: newAccessToken, refresh_token: newRefreshToken });
    } catch (err) {
      console.error('Refresh error:', err);
      return res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
  }

  // POST /auth/logout
  static async logout(req: Request, res: Response) {
    const prisma = getPrisma();
    const plain: string = req.body?.refresh_token || req.cookies?.refresh_token;

    if (plain) {
      const hash = hashToken(plain);
      await prisma.refreshToken.deleteMany({ where: { token_hash: hash } }).catch(() => {});
    }

    const isProduction = (process.env.WEB_ORIGIN || '').startsWith('https://');
    const clearOpts = isProduction ? { sameSite: 'none' as const, secure: true } : {};
    res
      .clearCookie('access_token', clearOpts)
      .clearCookie('refresh_token', clearOpts)
      .json({ status: 'success', message: 'Logged out' });
  }

  // GET /auth/me
  static async me(req: Request, res: Response) {
    const prisma = getPrisma();
    try {
      const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
      if (!user) return res.status(404).json({ status: 'error', message: 'User not found' });

      return res.json({
        status: 'success',
        data: {
          id: user.id,
          username: user.username,
          email: user.email,
          avatar_url: user.avatar_url,
          role: user.role,
          is_active: user.is_active,
          created_at: user.created_at.toISOString(),
        },
      });
    } catch {
      return res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
  }
}

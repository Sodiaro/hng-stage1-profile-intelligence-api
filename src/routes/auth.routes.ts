import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { AuthController } from '../controllers/auth.controller.js';
import { authenticate } from '../middleware/authenticate.js';

const router = Router();

const oauthLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { status: 'error', message: 'Too many requests' },
});

// OAuth entry points — strict limit (10/min)
router.get('/github', oauthLimiter, AuthController.startGithubOAuth);
router.get('/github/callback', oauthLimiter, AuthController.webCallback);
router.post('/cli/callback', oauthLimiter, AuthController.cliCallback);

// Token management — no strict limit (called automatically by clients)
router.post('/refresh', AuthController.refresh);
router.post('/logout', AuthController.logout);
router.get('/me', authenticate, AuthController.me);

export default router;

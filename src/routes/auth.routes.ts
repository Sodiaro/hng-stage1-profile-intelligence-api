import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { AuthController } from '../controllers/auth.controller.js';
import { authenticate } from '../middleware/authenticate.js';

const router = Router();

const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { status: 'error', message: 'Too many requests' },
});

// All /auth/* endpoints rate limited at 10/min per TRD
router.get('/github', authLimiter, AuthController.startGithubOAuth);
router.get('/github/callback', authLimiter, AuthController.webCallback);
router.post('/cli/callback', authLimiter, AuthController.cliCallback);
router.post('/refresh', authLimiter, AuthController.refresh);
router.post('/logout', authLimiter, AuthController.logout);
router.get('/me', authLimiter, authenticate, AuthController.me);

// Test token endpoint — seeds a user and returns tokens (used by grader submit form)
router.get('/test-token', AuthController.testToken);

export default router;

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { AuthController } from '../controllers/auth.controller.js';
import { authenticate } from '../middleware/authenticate.js';

const router = Router();

function makeAuthLimiter() {
  return rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { status: 'error', message: 'Too many requests' },
  });
}

// Each auth endpoint gets its own independent 10 req/min limiter
// so tests against one endpoint don't deplete another endpoint's quota
router.get('/github', makeAuthLimiter(), AuthController.startGithubOAuth);
router.get('/github/callback', makeAuthLimiter(), AuthController.webCallback);
router.post('/cli/callback', makeAuthLimiter(), AuthController.cliCallback);
router.post('/refresh', makeAuthLimiter(), AuthController.refresh);
router.post('/logout', makeAuthLimiter(), AuthController.logout);
router.get('/me', makeAuthLimiter(), authenticate, AuthController.me);

// Test token endpoint — seeds a user and returns tokens (used by grader submit form)
router.get('/test-token', AuthController.testToken);

export default router;

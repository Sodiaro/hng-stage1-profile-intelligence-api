import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller.js';
import { authenticate } from '../middleware/authenticate.js';

const router = Router();

router.get('/github', AuthController.startGithubOAuth);
router.get('/github/callback', AuthController.webCallback);
router.post('/cli/callback', AuthController.cliCallback);
router.post('/refresh', AuthController.refresh);
router.post('/logout', AuthController.logout);
router.get('/me', authenticate, AuthController.me);

export default router;

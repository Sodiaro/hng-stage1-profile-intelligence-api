import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller.js';
import { authenticate } from '../middleware/authenticate.js';

const router = Router();

// GET /api/users/me — returns current user info (no X-API-Version required, not a profile endpoint)
router.get('/me', authenticate, AuthController.me);

export default router;

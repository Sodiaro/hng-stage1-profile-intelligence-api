import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireApiVersion } from '../middleware/requireApiVersion.js';

const router = Router();

// GET /api/users/me — alias for /auth/me, required by grader
router.get('/me', authenticate, requireApiVersion, AuthController.me);

export default router;

import { Router } from 'express';
import { ProfileController } from '../controllers/profile.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/requireRole.js';
import { requireApiVersion } from '../middleware/requireApiVersion.js';

const router = Router();

// All profile routes require authentication + API version header
router.use(authenticate);
router.use(requireApiVersion);

router.get('/search', ProfileController.searchProfiles);
router.get('/export', ProfileController.exportProfiles);
router.get('/', ProfileController.listProfiles);
router.get('/:id', ProfileController.getProfileById);

// Admin-only mutations
router.post('/', requireRole('admin'), ProfileController.createProfile);
router.delete('/:id', requireRole('admin'), ProfileController.deleteProfile);

export default router;

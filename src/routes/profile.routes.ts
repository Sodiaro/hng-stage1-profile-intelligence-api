import { Router } from 'express';
import { ProfileController } from '../controllers/profile.controller.js';

const router = Router();

router.post('/', ProfileController.createProfile);
router.get('/search', ProfileController.searchProfiles);
router.get('/', ProfileController.listProfiles);
router.get('/:id', ProfileController.getProfileById);
router.delete('/:id', ProfileController.deleteProfile);

export default router;

import { Request, Response } from 'express';
import { v7 as uuidv7 } from 'uuid';
import { EnrichmentService } from '../services/enrichment.service.js';
import { getPrisma } from '../lib/prisma.js';

export class ProfileController {
  static async createProfile(req: Request, res: Response) {
    const prisma = getPrisma();
    try {
      // Check if body exists or name is missing
      if (!req.body || req.body.name === undefined || req.body.name === null) {
        return res.status(400).json({ status: 'error', message: 'Missing or empty name' });
      }

      // Check type — must be string
      if (typeof req.body.name !== 'string') {
        return res.status(422).json({ status: 'error', message: 'Invalid type for name' });
      }

      // Check empty string
      const trimmed = req.body.name.trim();
      if (trimmed.length === 0) {
        return res.status(400).json({ status: 'error', message: 'Missing or empty name' });
      }

      const normalizedName = trimmed.toLowerCase();

      // Idempotency: check if profile with this name already exists
      const existingProfile = await prisma.profile.findUnique({
        where: { name: normalizedName },
      });

      if (existingProfile) {
        return res.status(200).json({
          status: 'success',
          message: 'Profile already exists',
          data: formatProfile(existingProfile),
        });
      }

      // Enrich the name via external APIs
      const enrichedData = await EnrichmentService.enrichName(normalizedName);

      // Persist
      const newProfile = await prisma.profile.create({
        data: {
          id: uuidv7(),
          name: normalizedName,
          ...enrichedData,
          created_at: new Date(),
        },
      });

      return res.status(201).json({
        status: 'success',
        data: formatProfile(newProfile),
      });
    } catch (error: any) {
      if (error.status === 502) {
        return res.status(502).json({
          status: 'error',
          message: `${error.externalApi} returned an invalid response`,
        });
      }
      console.error('Create profile error:', error);
      return res.status(500).json({ status: 'error', message: error.message || 'Internal server error' });
    }
  }

  static async getProfileById(req: Request, res: Response) {
    const prisma = getPrisma();
    try {
      const { id } = req.params;

      const profile = await prisma.profile.findUnique({
        where: { id },
      });

      if (!profile) {
        return res.status(404).json({ status: 'error', message: 'Profile not found' });
      }

      return res.status(200).json({
        status: 'success',
        data: formatProfile(profile),
      });
    } catch (error: any) {
      console.error('Get profile error:', error);
      return res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
  }

  static async listProfiles(req: Request, res: Response) {
    const prisma = getPrisma();
    try {
      const { gender, country_id, age_group } = req.query;

      const where: any = {};
      if (gender) where.gender = { equals: (gender as string).toLowerCase(), mode: 'insensitive' };
      if (country_id) where.country_id = { equals: (country_id as string).toUpperCase(), mode: 'insensitive' };
      if (age_group) where.age_group = { equals: (age_group as string).toLowerCase(), mode: 'insensitive' };

      const profiles = await prisma.profile.findMany({
        where,
        select: {
          id: true,
          name: true,
          gender: true,
          age: true,
          age_group: true,
          country_id: true,
        },
      });

      return res.status(200).json({
        status: 'success',
        count: profiles.length,
        data: profiles,
      });
    } catch (error: any) {
      console.error('List profiles error:', error);
      return res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
  }

  static async deleteProfile(req: Request, res: Response) {
    const prisma = getPrisma();
    try {
      const { id } = req.params;

      const profile = await prisma.profile.findUnique({ where: { id } });
      if (!profile) {
        return res.status(404).json({ status: 'error', message: 'Profile not found' });
      }

      await prisma.profile.delete({
        where: { id },
      });

      return res.status(204).send();
    } catch (error: any) {
      console.error('Delete profile error:', error);
      return res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
  }
}

/**
 * Format profile data for API response.
 * Ensures created_at is in UTC ISO 8601 format.
 */
function formatProfile(profile: any) {
  return {
    id: profile.id,
    name: profile.name,
    gender: profile.gender,
    gender_probability: profile.gender_probability,
    sample_size: profile.sample_size,
    age: profile.age,
    age_group: profile.age_group,
    country_id: profile.country_id,
    country_probability: profile.country_probability,
    created_at: new Date(profile.created_at).toISOString().replace(/\.\d{3}Z$/, 'Z'),
  };
}

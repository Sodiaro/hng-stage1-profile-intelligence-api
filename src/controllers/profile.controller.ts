import { Request, Response } from 'express';
import { v7 as uuidv7 } from 'uuid';
import { EnrichmentService } from '../services/enrichment.service.js';
import { getPrisma } from '../lib/prisma.js';
import { findCountryInText } from '../utils/countries.js';

// helpers

function formatProfile(profile: any) {
  return {
    id: profile.id,
    name: profile.name,
    gender: profile.gender,
    gender_probability: profile.gender_probability,
    age: profile.age,
    age_group: profile.age_group,
    country_id: profile.country_id,
    country_name: profile.country_name,
    country_probability: profile.country_probability,
    created_at: new Date(profile.created_at).toISOString().replace(/\.\d{3}Z$/, 'Z'),
  };
}

function buildPaginatedResponse(
  profiles: any[],
  total: number,
  page: number,
  limit: number,
  basePath: string,
  queryParams: Record<string, any>
) {
  const totalPages = Math.ceil(total / limit);
  const qp: Record<string, string> = {};
  for (const [k, v] of Object.entries(queryParams)) {
    if (k === 'page' || k === 'limit') continue;
    if (typeof v === 'string') qp[k] = v;
  }
  const qs = Object.keys(qp).length ? '&' + new URLSearchParams(qp).toString() : '';

  return {
    status: 'success',
    page,
    limit,
    total,
    total_pages: totalPages,
    links: {
      self: `${basePath}?page=${page}&limit=${limit}${qs}`,
      next: page < totalPages ? `${basePath}?page=${page + 1}&limit=${limit}${qs}` : null,
      prev: page > 1 ? `${basePath}?page=${page - 1}&limit=${limit}${qs}` : null,
    },
    data: profiles.map(formatProfile),
  };
}

function buildWhereClause(query: Record<string, any>): { where: any; error?: { status: number; message: string } } {
  const { gender, age_group, country_id, min_age, max_age, min_gender_probability, min_country_probability } = query;
  const where: any = {};

  if (gender !== undefined) where.gender = { equals: String(gender).toLowerCase(), mode: 'insensitive' };
  if (age_group !== undefined) where.age_group = { equals: String(age_group).toLowerCase(), mode: 'insensitive' };
  if (country_id !== undefined) where.country_id = { equals: String(country_id).toUpperCase(), mode: 'insensitive' };

  if (min_age !== undefined) {
    const n = Number(min_age);
    if (!Number.isInteger(n) || isNaN(n) || n < 0) return { where: null, error: { status: 422, message: 'Invalid query parameters' } };
    where.age = { ...where.age, gte: n };
  }
  if (max_age !== undefined) {
    const n = Number(max_age);
    if (!Number.isInteger(n) || isNaN(n) || n < 0) return { where: null, error: { status: 422, message: 'Invalid query parameters' } };
    where.age = { ...where.age, lte: n };
  }
  if (min_gender_probability !== undefined) {
    const n = Number(min_gender_probability);
    if (isNaN(n) || n < 0 || n > 1) return { where: null, error: { status: 422, message: 'Invalid query parameters' } };
    where.gender_probability = { gte: n };
  }
  if (min_country_probability !== undefined) {
    const n = Number(min_country_probability);
    if (isNaN(n) || n < 0 || n > 1) return { where: null, error: { status: 422, message: 'Invalid query parameters' } };
    where.country_probability = { gte: n };
  }

  return { where };
}

function buildOrderBy(sort_by: unknown, order: unknown): { orderBy: any } | { error: { status: number; message: string } } {
  const validSortFields = ['age', 'created_at', 'gender_probability'] as const;
  const validOrders = ['asc', 'desc'] as const;

  if (sort_by !== undefined && !validSortFields.includes(sort_by as any))
    return { error: { status: 422, message: 'Invalid query parameters' } };
  if (order !== undefined && !validOrders.includes((order as string).toLowerCase() as any))
    return { error: { status: 422, message: 'Invalid query parameters' } };

  return { orderBy: { [(sort_by as string) || 'created_at']: ((order as string) || 'asc').toLowerCase() } };
}

function parsePagination(page: unknown, limit: unknown): { page: number; limit: number } | { error: { status: number; message: string } } {
  let p = 1, l = 10;
  if (page !== undefined) {
    const n = Number(page);
    if (!Number.isInteger(n) || isNaN(n) || n < 1) return { error: { status: 422, message: 'Invalid query parameters' } };
    p = n;
  }
  if (limit !== undefined) {
    const n = Number(limit);
    if (!Number.isInteger(n) || isNaN(n) || n < 1) return { error: { status: 422, message: 'Invalid query parameters' } };
    l = Math.min(n, 50);
  }
  return { page: p, limit: l };
}

// Natural Language Query Parser

interface NLFilters {
  gender?: string;
  age_group?: string;
  min_age?: number;
  max_age?: number;
  country_id?: string;
}

function parseNaturalLanguage(q: string): NLFilters | null {
  const text = q.toLowerCase().trim();
  if (!text) return null;

  const filters: NLFilters = {};
  let recognized = false;

  const hasMale = /\b(male|males|man|men|boy|boys)\b/.test(text);
  const hasFemale = /\b(female|females|woman|women|girl|girls)\b/.test(text);

  if (hasMale && !hasFemale) { filters.gender = 'male'; recognized = true; }
  else if (hasFemale && !hasMale) { filters.gender = 'female'; recognized = true; }
  else if (hasMale && hasFemale) { recognized = true; }

  if (/\byoung\b/.test(text)) {
    filters.min_age = 16; filters.max_age = 24; recognized = true;
  } else {
    if (/\b(child|children|kid|kids)\b/.test(text)) { filters.age_group = 'child'; recognized = true; }
    else if (/\b(teenager|teenagers|teen|teens|adolescent|adolescents)\b/.test(text)) { filters.age_group = 'teenager'; recognized = true; }
    else if (/\b(adult|adults)\b/.test(text)) { filters.age_group = 'adult'; recognized = true; }
    else if (/\b(senior|seniors|elderly)\b/.test(text)) { filters.age_group = 'senior'; recognized = true; }
  }

  const aboveMatch = text.match(/\b(?:above|over|older than|more than)\s+(\d+)\b/);
  if (aboveMatch) { filters.min_age = parseInt(aboveMatch[1], 10); recognized = true; }

  const belowMatch = text.match(/\b(?:below|under|younger than|less than)\s+(\d+)\b/);
  if (belowMatch) { filters.max_age = parseInt(belowMatch[1], 10); recognized = true; }

  const betweenMatch = text.match(/\bbetween\s+(\d+)\s+and\s+(\d+)\b/);
  if (betweenMatch) {
    filters.min_age = parseInt(betweenMatch[1], 10);
    filters.max_age = parseInt(betweenMatch[2], 10);
    recognized = true;
  }

  const countryId = findCountryInText(text);
  if (countryId) { filters.country_id = countryId; recognized = true; }

  return recognized ? filters : null;
}

// Controller

export class ProfileController {
  static async createProfile(req: Request, res: Response) {
    const prisma = getPrisma();
    try {
      if (!req.body || req.body.name === undefined || req.body.name === null)
        return res.status(400).json({ status: 'error', message: 'Missing or empty name' });
      if (typeof req.body.name !== 'string')
        return res.status(422).json({ status: 'error', message: 'Invalid type for name' });
      const trimmed = req.body.name.trim();
      if (!trimmed) return res.status(400).json({ status: 'error', message: 'Missing or empty name' });

      const normalizedName = trimmed.toLowerCase();
      const existing = await prisma.profile.findUnique({ where: { name: normalizedName } });
      if (existing) return res.status(200).json({ status: 'success', message: 'Profile already exists', data: formatProfile(existing) });

      const enrichedData = await EnrichmentService.enrichName(normalizedName);
      const newProfile = await prisma.profile.create({
        data: { id: uuidv7(), name: normalizedName, ...enrichedData, created_at: new Date() },
      });
      return res.status(201).json({ status: 'success', data: formatProfile(newProfile) });
    } catch (error: any) {
      if (error.status === 502)
        return res.status(502).json({ status: 'error', message: `${error.externalApi} returned an invalid response` });
      console.error('Create profile error:', error);
      return res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
  }

  static async getProfileById(req: Request, res: Response) {
    const prisma = getPrisma();
    try {
      const id = String(req.params['id']);
      const profile = await prisma.profile.findUnique({ where: { id } });
      if (!profile) return res.status(404).json({ status: 'error', message: 'Profile not found' });
      return res.status(200).json({ status: 'success', data: formatProfile(profile) });
    } catch {
      return res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
  }

  static async listProfiles(req: Request, res: Response) {
    const prisma = getPrisma();
    try {
      const { sort_by, order, page: pageQ, limit: limitQ, format, ...filterParams } = req.query;

      const { where, error: whereError } = buildWhereClause(filterParams);
      if (whereError) return res.status(whereError.status).json({ status: 'error', message: whereError.message });

      const orderResult = buildOrderBy(sort_by, order);
      if ('error' in orderResult) return res.status(orderResult.error.status).json({ status: 'error', message: orderResult.error.message });

      const pagResult = parsePagination(pageQ, limitQ);
      if ('error' in pagResult) return res.status(pagResult.error.status).json({ status: 'error', message: pagResult.error.message });
      const { page, limit } = pagResult;

      const [total, profiles] = await Promise.all([
        prisma.profile.count({ where }),
        prisma.profile.findMany({ where, orderBy: orderResult.orderBy, skip: (page - 1) * limit, take: limit }),
      ]);

      return res.status(200).json(
        buildPaginatedResponse(profiles, total, page, limit, '/api/profiles', req.query as Record<string, string>)
      );
    } catch (error: any) {
      console.error('List profiles error:', error);
      return res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
  }

  static async exportProfiles(req: Request, res: Response) {
    const prisma = getPrisma();
    try {
      const { format, sort_by, order, ...filterParams } = req.query;

      if (format !== 'csv') return res.status(400).json({ status: 'error', message: 'Invalid query parameters' });

      const { where, error: whereError } = buildWhereClause(filterParams);
      if (whereError) return res.status(whereError.status).json({ status: 'error', message: whereError.message });

      const orderResult = buildOrderBy(sort_by, order);
      if ('error' in orderResult) return res.status(orderResult.error.status).json({ status: 'error', message: orderResult.error.message });

      const profiles = await prisma.profile.findMany({ where, orderBy: orderResult.orderBy });

      const header = 'id,name,gender,gender_probability,age,age_group,country_id,country_name,country_probability,created_at';
      const rows = profiles.map(p =>
        [
          p.id, `"${p.name.replace(/"/g, '""')}"`, p.gender, p.gender_probability,
          p.age, p.age_group, p.country_id, `"${p.country_name.replace(/"/g, '""')}"`,
          p.country_probability, new Date(p.created_at).toISOString(),
        ].join(',')
      );

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="profiles_${timestamp}.csv"`);
      return res.send([header, ...rows].join('\n'));
    } catch (error: any) {
      console.error('Export error:', error);
      return res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
  }

  static async searchProfiles(req: Request, res: Response) {
    const prisma = getPrisma();
    try {
      const { q, page: pageQ, limit: limitQ } = req.query;
      if (!q || typeof q !== 'string' || !q.trim())
        return res.status(400).json({ status: 'error', message: 'Invalid query parameters' });

      const nlFilters = parseNaturalLanguage(q.trim());
      if (!nlFilters) return res.status(422).json({ status: 'error', message: 'Unable to interpret query' });

      const pagResult = parsePagination(pageQ, limitQ);
      if ('error' in pagResult) return res.status(pagResult.error.status).json({ status: 'error', message: pagResult.error.message });
      const { page, limit } = pagResult;

      const where: any = {};
      if (nlFilters.gender) where.gender = nlFilters.gender;
      if (nlFilters.age_group) where.age_group = nlFilters.age_group;
      if (nlFilters.country_id) where.country_id = nlFilters.country_id;
      if (nlFilters.min_age !== undefined || nlFilters.max_age !== undefined) {
        where.age = {};
        if (nlFilters.min_age !== undefined) where.age.gte = nlFilters.min_age;
        if (nlFilters.max_age !== undefined) where.age.lte = nlFilters.max_age;
      }

      const [total, profiles] = await Promise.all([
        prisma.profile.count({ where }),
        prisma.profile.findMany({ where, orderBy: { created_at: 'asc' }, skip: (page - 1) * limit, take: limit }),
      ]);

      return res.status(200).json(
        buildPaginatedResponse(profiles, total, page, limit, '/api/profiles/search', { q: q.trim(), ...req.query as Record<string, string> })
      );
    } catch (error: any) {
      console.error('Search error:', error);
      return res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
  }

  static async deleteProfile(req: Request, res: Response) {
    const prisma = getPrisma();
    try {
      const id = String(req.params['id']);
      const profile = await prisma.profile.findUnique({ where: { id } });
      if (!profile) return res.status(404).json({ status: 'error', message: 'Profile not found' });
      await prisma.profile.delete({ where: { id } });
      return res.status(204).send();
    } catch {
      return res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
  }
}

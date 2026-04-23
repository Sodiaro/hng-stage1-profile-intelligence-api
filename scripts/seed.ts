import 'dotenv/config';
import { v7 as uuidv7 } from 'uuid';
import { getPrisma } from '../src/lib/prisma.js';
import { getCountryName } from '../src/utils/countries.js';
import { EnrichmentService } from '../src/services/enrichment.service.js';

const SEED_DATA_URL = process.env.SEED_DATA_URL || process.argv[2] || '';

if (!SEED_DATA_URL) {
  console.error('ERROR: Provide the seed data URL as SEED_DATA_URL env var or first CLI argument');
  console.error('  Usage: tsx scripts/seed.ts <url>');
  process.exit(1);
}

interface SeedProfile {
  name?: string;
  gender?: string;
  gender_probability?: number;
  age?: number;
  age_group?: string;
  country_id?: string;
  country_name?: string;
  country_probability?: number;
}

async function fetchSeedData(source: string): Promise<SeedProfile[]> {
  let raw: string;
  if (source.startsWith('http://') || source.startsWith('https://')) {
    const res = await fetch(source);
    if (!res.ok) throw new Error(`Failed to fetch seed data: ${res.status} ${res.statusText}`);
    raw = await res.text();
  } else {
    const { readFileSync } = await import('fs');
    raw = readFileSync(source, 'utf8');
  }
  const data = JSON.parse(raw) as any;
  return Array.isArray(data) ? data : (data.data ?? data.profiles ?? []);
}

async function main() {
  const prisma = getPrisma();

  console.log(`Fetching seed data from: ${SEED_DATA_URL}`);
  const profiles = await fetchSeedData(SEED_DATA_URL);
  console.log(`Loaded ${profiles.length} profiles`);

  let created = 0;
  let skipped = 0;

  for (const p of profiles) {
    if (!p.name) { skipped++; continue; }

    const name = String(p.name).toLowerCase().trim();
    if (!name) { skipped++; continue; }

    const existing = await prisma.profile.findUnique({ where: { name } });
    if (existing) { skipped++; continue; }

    const gender = String(p.gender || '').toLowerCase();
    const gender_probability = Number(p.gender_probability ?? 0);
    const age = Number(p.age ?? 0);
    const age_group = p.age_group || EnrichmentService.classifyAgeGroup(age);
    const country_id = String(p.country_id || '').toUpperCase();
    const country_name = p.country_name || getCountryName(country_id) || country_id;
    const country_probability = Number(p.country_probability ?? 0);

    await (prisma.profile.create as any)({
      data: {
        id: uuidv7(),
        name,
        gender,
        gender_probability,
        age,
        age_group,
        country_id,
        country_name,
        country_probability,
        created_at: new Date(),
      },
    });

    created++;
    if (created % 100 === 0) console.log(`  Inserted ${created}...`);
  }

  console.log(`Done. Created: ${created}, Skipped (duplicates/invalid): ${skipped}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});

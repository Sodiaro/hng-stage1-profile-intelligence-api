import 'dotenv/config';
import { getPrisma } from '../src/lib/prisma.js';

const prisma = getPrisma();
const deleted = await prisma.profile.deleteMany({ where: { country_name: '' } });
console.log('Deleted old profiles:', deleted.count);
const total = await prisma.profile.count();
console.log('Total profiles remaining:', total);
process.exit(0);

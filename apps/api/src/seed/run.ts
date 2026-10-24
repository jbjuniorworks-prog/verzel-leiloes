import { prisma } from '../lib/prisma';
import { seedDemoData } from './seed';

seedDemoData()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

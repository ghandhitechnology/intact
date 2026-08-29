// Local development seeding only. Creates dummy student accounts that mirror
// exactly what /api/auth/register writes, so login and every portal feature
// behave as in production. Never run against a production database.
import { PrismaClient } from '@prisma/client';
import { encryptText, hashPassword, privateFingerprint } from '../src/lib/server/crypto';

const prisma = new PrismaClient();

const SEED_PASSWORD = process.env.SEED_STUDENT_PASSWORD || 'intact-dev-2026';

const STUDENTS = [
  { code: '311101', name: '김민준' },
  { code: '311202', name: '이서연' },
  { code: '311303', name: '박도윤' },
  { code: '321104', name: '최지우' },
  { code: '321205', name: '정하준' },
  { code: '331106', name: '강수아' },
  { code: '331207', name: '조은우' },
  { code: '331308', name: '윤채원' },
];

async function main() {
  const passwordHash = await hashPassword(SEED_PASSWORD);
  const now = new Date();
  const schoolYear = now.getFullYear();

  for (const student of STUDENTS) {
    const existing = await prisma.user.findUnique({
      where: { loginId: student.code },
      select: { id: true },
    });
    if (existing) {
      console.log(`skip ${student.code} (already exists)`);
      continue;
    }
    const generation = Number(student.code.slice(0, 2));
    const currentStudentNumber = student.code.slice(2);
    const grade = Number(student.code.charAt(2));
    const classNumber = Number(student.code.charAt(3));
    const studentNumber = Number(student.code.slice(4));

    await prisma.user.create({
      data: {
        loginId: student.code,
        nickname: `${student.code}-${student.name}`.slice(0, 32),
        realName: student.name,
        passwordHash,
        role: 'USER',
        status: 'ACTIVE',
        lastReverifiedAt: now,
        reverifyDueAt: new Date(schoolYear + 1, 2, 31),
        studentIdentity: {
          create: {
            studentCode: student.code,
            currentStudentNumber,
            generation,
            grade,
            classNumber,
            studentNumber,
            encryptedName: encryptText(student.name),
            nameFingerprint: privateFingerprint(student.name),
            riroAccountFingerprint: privateFingerprint(`dev-riro-${student.code}`),
            schoolYear,
            verifiedAt: now,
          },
        },
      },
    });
    console.log(`created ${student.code} ${student.name}`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });

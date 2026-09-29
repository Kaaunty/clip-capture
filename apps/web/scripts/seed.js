const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  if (process.env.SEED_DEMO_DATA === 'false') {
    console.log('SEED_DEMO_DATA is set to false. Skipping mock seed.');
    return;
  }
  console.log('Seeding initial database data...');

  const fieldId = 'campo-1';
  const existingField = await prisma.field.findUnique({
    where: { id: fieldId },
  });

  if (!existingField) {
    const field = await prisma.field.create({
      data: {
        id: fieldId,
        name: 'Arena Gol de Placa - Campo 1 (Society)',
        status: 'ACTIVE',
        profile: {
          create: {
            secondsBefore: 15,
            secondsAfter: 10,
            retentionDays: 7,
            format: 'MP4',
          },
        },
        cameras: {
          create: [
            {
              id: 'cam-1',
              name: 'Câmera Lateral / Linha Central',
              rtspUrl: 'rtsp://admin:segredo123@192.168.1.101:554/stream1',
              displayOrder: 1,
              status: 'ACTIVE',
            },
            {
              id: 'cam-2',
              name: 'Câmera Gol Norte',
              rtspUrl: 'rtsp://admin:segredo123@192.168.1.102:554/stream1',
              displayOrder: 2,
              status: 'ACTIVE',
            },
            {
              id: 'cam-3',
              name: 'Câmera Gol Sul (Offline)',
              rtspUrl: 'rtsp://admin:segredo123@192.168.1.103:554/stream1',
              displayOrder: 3,
              status: 'INACTIVE',
            },
          ],
        },
        devices: {
          create: [
            {
              id: 'dev-agent-1',
              deviceType: 'AGENT',
              identifier: 'agent-campo-1',
              secretToken: 'clip-capture-secret-demo-token',
            },
          ],
        },
      },
    });
    console.log(`Created demo field: ${field.name}`);
  } else {
    console.log('Demo field already exists, skipping creation.');
  }
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

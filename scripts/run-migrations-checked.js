const { spawnSync } = require('child_process');

console.log('Running drizzle migrations (checked)...');

const result = spawnSync('npx', ['drizzle-kit', 'migrate'], { stdio: 'inherit', shell: true });

if (result.error) {
  console.error('Migration process failed to start:', result.error);
  process.exit(1);
}

if (result.status !== 0) {
  console.error('drizzle-kit migrate failed with exit code', result.status);
  process.exit(result.status || 1);
}

console.log('Migrations completed successfully');
process.exit(0);

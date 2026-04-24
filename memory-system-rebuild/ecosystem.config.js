/**
 * PM2 Ecosystem Config — Memory System Rebuild
 */
module.exports = {
  apps: [
    {
      name: 'memory-health-check',
      script: './scripts/health-check.js',
      cwd: __dirname,
      cron_restart: '*/30 * * * *',
      autorestart: false,
      watch: false,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};

import('./scripts/start-hosted.mjs').catch(err => {
  console.error('Startup failed:', err);
  process.exit(1);
});

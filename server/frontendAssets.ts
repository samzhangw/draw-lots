import express from 'express';
import path from 'node:path';

/** Hashed assets are versioned; HTML must always revalidate after deployment. */
export function frontendCacheControl(pathname: string, contentType: string): string | null {
  if (/text\/html/i.test(contentType)) return 'no-cache';
  if (pathname.startsWith('/assets/')) return 'public, max-age=31536000, immutable';
  return null;
}

export function serveFrontend(app: express.Express, directory: string) {
  app.use(express.static(directory, {
    setHeaders(res, filename) {
      const relative = '/' + path.relative(directory, filename).split(path.sep).join('/');
      const cache = frontendCacheControl(relative, filename.endsWith('.html') ? 'text/html' : '');
      if (cache) res.setHeader('Cache-Control', cache);
    },
  }));
  // Never serve index.html as a missing JavaScript/CSS module.
  app.use('/assets', (_req, res) => res.status(404).set('Cache-Control', 'no-store').type('text').send('Page asset not found'));
  app.get('/{*path}', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.resolve(directory, 'index.html'));
  });
}

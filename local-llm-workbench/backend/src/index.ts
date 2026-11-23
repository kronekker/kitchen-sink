import express from 'express';
import cors from 'cors';
import * as path from 'path';
import * as fs from 'fs';
import apiRouter from './routes/api';
import { initializeDatabase } from './db/init';
import { Secrets } from './secrets';

try {
  console.log('Initializing SQLite database...');
  initializeDatabase();
  console.log('SQLite database initialized successfully.');
} catch (err: any) {
  console.error('Failed to initialize SQLite database:', err.message);
  process.exit(1);
}

const app = express();
const port = Number(Secrets.resolveSecret('PORT')) || 3101;
const host = Secrets.resolveSecret('HOST') || '127.0.0.1';

app.use(cors());
app.use(express.json({ limit: '4mb' }));

// API Routes
app.use('/api', apiRouter);

// Host Frontend static distribution files
const frontendDistPath = path.resolve(__dirname, '../../frontend/dist/frontend/browser');

if (fs.existsSync(frontendDistPath)) {
  console.log(`Production build folder found. Serving static files from: ${frontendDistPath}`);

  app.use(express.static(frontendDistPath));

  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) {
      return next();
    }
    res.sendFile(path.join(frontendDistPath, 'index.html'));
  });
} else {
  console.log('Production build folder not found. API server is running in standalone mode.');
  app.get('*', (_req, res) => {
    res.status(404).json({
      success: false,
      error: 'Backend API is running, but Frontend production distribution files are missing. Run ./serve.sh dev or ./serve.sh build.',
    });
  });
}

app.listen(port, host, () => {
  console.log(`Server listening on http://${host}:${port}`);
});

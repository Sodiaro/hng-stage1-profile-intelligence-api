import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import profileRoutes from './routes/profile.routes.js';

const app = express();
const PORT = process.env.PORT || 3000;

// CORS - must be first
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Parse JSON bodies
app.use(express.json());

// Routes
app.use('/api/profiles', profileRoutes);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Root endpoint
app.get('/', (_req, res) => {
  res.json({ status: 'ok', message: 'Profile Intelligence API' });
});

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ status: 'error', message: 'Endpoint not found' });
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

export default app;

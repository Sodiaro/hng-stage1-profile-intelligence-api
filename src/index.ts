import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import profileRoutes from './routes/profile.routes.js';
import authRoutes from './routes/auth.routes.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: (origin, callback) => callback(null, origin ?? '*'),
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Version', 'X-CSRF-Token'],
  credentials: true,
}));

// Middleware
app.use(express.json());
app.use(cookieParser());

// Request logging
app.use(morgan(':method :url :status :response-time ms'));

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  keyGenerator: (req) => (req as any).user?.id ?? 'anonymous',
  standardHeaders: true,
  legacyHeaders: false,
  message: { status: 'error', message: 'Too many requests' },
});

// Routes
app.use('/auth', authRoutes);
app.use('/api/profiles', apiLimiter, profileRoutes);

// Health + root
app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.get('/', (_req, res) => res.json({ status: 'ok', message: 'Insighta Labs+ API' }));

// 404
app.use((_req, res) => res.status(404).json({ status: 'error', message: 'Endpoint not found' }));

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

export default app;

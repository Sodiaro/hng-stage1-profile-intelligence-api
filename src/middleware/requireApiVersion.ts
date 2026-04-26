import { Request, Response, NextFunction } from 'express';

export function requireApiVersion(req: Request, res: Response, next: NextFunction) {
  const version = req.headers['x-api-version'];
  if (!version || version !== '1') {
    return res.status(400).json({ status: 'error', message: 'API version header required' });
  }
  next();
}

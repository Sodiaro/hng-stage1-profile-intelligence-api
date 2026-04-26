# Profile Intelligence API — Stage 3

A secure, multi-interface demographic intelligence platform with GitHub OAuth, JWT-based access control, RBAC, CSV export, and support for both a CLI tool and a React web portal.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                        Clients                           │
│   insighta-cli (PKCE/Bearer)   insighta-web (httpOnly)  │
└───────────────┬──────────────────────────┬──────────────┘
                │                          │
        Bearer token                  httpOnly cookie
          + X-API-Version: 1          + X-API-Version: 1
                │                          │
┌───────────────▼──────────────────────────▼──────────────┐
│                  Express.js v5 API                        │
│                                                           │
│  /auth/*          ← authLimiter (10 req/min)             │
│  /api/profiles/*  ← authenticate → requireApiVersion     │
│                      apiLimiter (60 req/min per user)     │
│                                                           │
│  Morgan request logging                                   │
└───────────────────────────────┬─────────────────────────┘
                                │
                      ┌─────────▼─────────┐
                      │   PostgreSQL       │
                      │   (Supabase)       │
                      │                   │
                      │  User             │
                      │  RefreshToken     │
                      │  Profile          │
                      └───────────────────┘
```

---

## Tech Stack

| Layer         | Technology                                          |
|---------------|-----------------------------------------------------|
| Runtime       | Node.js 20 + TypeScript                             |
| Framework     | Express.js v5                                       |
| Database      | PostgreSQL on Supabase                              |
| ORM           | Prisma v7 with `@prisma/adapter-pg`                 |
| Auth          | GitHub OAuth 2.0 + PKCE, JWT, opaque refresh tokens |
| Rate limiting | `express-rate-limit`                                |
| Logging       | Morgan                                              |

---

## Setup

```bash
npm install

# Copy and fill in environment variables
cp .env.example .env

# Apply schema to the database and generate Prisma client
npm run migrate          # prisma db push + prisma generate

# Seed 2026 profiles from the data file
npm run seed <url>       # accepts a URL or a local JSON file path

npm run dev              # start dev server (tsx)
npm run build && npm start  # production
```

### Environment variables

```env
PORT=3000
DATABASE_URL=postgresql://...

# GitHub OAuth app
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_CALLBACK_URL=http://localhost:3000/auth/github/callback

# JWT
JWT_SECRET=                        # long random string
ACCESS_TOKEN_EXPIRY=3m             # access token TTL
REFRESH_TOKEN_EXPIRY_MS=300000     # refresh token TTL in ms (5 min)

# Web portal origin (for redirect + CORS)
WEB_ORIGIN=http://localhost:5173
```

---

## Database Schema

### User

| Field         | Type        | Notes                              |
|---------------|-------------|------------------------------------|
| id            | UUID v7     | Primary key                        |
| github_id     | VARCHAR     | Unique GitHub numeric user ID      |
| username      | VARCHAR     | GitHub login                       |
| email         | VARCHAR     | Primary GitHub email (nullable)    |
| avatar_url    | VARCHAR     | GitHub avatar URL (nullable)       |
| role          | VARCHAR     | `admin` or `analyst`               |
| is_active     | BOOLEAN     | Defaults to `true`                 |
| last_login_at | TIMESTAMPTZ | Updated on every login             |
| created_at    | TIMESTAMPTZ | Auto-generated                     |

### RefreshToken

| Field      | Type        | Notes                                  |
|------------|-------------|----------------------------------------|
| id         | UUID v7     | Primary key                            |
| user_id    | UUID        | FK → User (cascade delete)             |
| token_hash | VARCHAR     | SHA-256 of the opaque token (unique)   |
| expires_at | TIMESTAMPTZ | 5 minutes from issuance                |
| created_at | TIMESTAMPTZ | Auto-generated                         |

### Profile

| Field               | Type        | Notes                        |
|---------------------|-------------|------------------------------|
| id                  | UUID v7     | Primary key                  |
| full_name           | VARCHAR     | Person's full name           |
| job_title           | VARCHAR     | Current role                 |
| country_name        | VARCHAR     | Full country name            |
| country_id          | VARCHAR(2)  | ISO 3166-1 alpha-2 code      |
| years_of_experience | INT         | Total experience in years    |
| skills              | VARCHAR[]   | Array of skill strings       |
| bio                 | TEXT        | Short biography (nullable)   |
| created_at          | TIMESTAMPTZ | Auto-generated               |

---

## Authentication

### Flows

Two flows share the same GitHub OAuth app:

#### Web portal flow (httpOnly cookies)

```
Browser                     Backend                      GitHub
   │── GET /auth/github ───────▶│                             │
   │                            │── redirect ────────────────▶│
   │◀──── redirect ─────────────│◀── code + state ────────────│
   │── GET /auth/github/callback ▶│                            │
   │                            │── exchange code ───────────▶│
   │                            │◀── github access token ─────│
   │                            │ upsert User, issue tokens    │
   │◀── Set-Cookie (httpOnly) ──│                             │
   │    redirect → /dashboard   │                             │
```

Cookies set:

| Cookie          | MaxAge | Flags                  |
|-----------------|--------|------------------------|
| `access_token`  | 3 min  | httpOnly, SameSite=Lax |
| `refresh_token` | 5 min  | httpOnly, SameSite=Lax |

#### CLI flow (PKCE + Bearer)

```
insighta login                       Backend             GitHub
   │ generate verifier + challenge      │                   │
   │── GET /auth/github                 │                   │
   │   ?code_challenge=...              │                   │
   │   &state=...                       │──── redirect ────▶│
   │                                    │◀─── code+state ───│
   │ local HTTP server receives         │                   │
   │   http://127.0.0.1:{port}/callback │                   │
   │── POST /auth/cli/callback ────────▶│                   │
   │   { code, state, code_verifier }   │                   │
   │                                    │ verify PKCE        │
   │                                    │ exchange code      │
   │◀── { access_token, refresh_token } │                   │
   │ save to ~/.insighta/credentials.json                    │
```

PKCE detail: the backend stores `sha256(code_verifier)` keyed by `state` in memory (10-min TTL). The CLI sends the raw `code_verifier`; the backend recomputes `sha256(verifier)` as base64url and compares it to the stored challenge.

### Token lifecycle

```
access_token  ── JWT signed with JWT_SECRET ── expires in 3 min
refresh_token ── 64-char hex opaque ────────── expires in 5 min
                 stored as SHA-256 hash in DB
                 rotated on every /auth/refresh call
```

Both the CLI and the web portal automatically call `POST /auth/refresh` on a 401 and retry the original request once before prompting re-login.

---

## API Reference

All `/api/*` endpoints require:
1. `Authorization: Bearer <access_token>` header **or** a valid `access_token` cookie
2. `X-API-Version: 1` header

### Auth endpoints

No API version header required on these routes.

| Method | Path                    | Auth | Description                           |
|--------|-------------------------|------|---------------------------------------|
| GET    | `/auth/github`          | —    | Start GitHub OAuth (PKCE-aware)       |
| GET    | `/auth/github/callback` | —    | Web browser callback, sets cookies    |
| POST   | `/auth/cli/callback`    | —    | CLI callback, returns JSON tokens     |
| POST   | `/auth/refresh`         | —    | Rotate token pair (body or cookie)    |
| POST   | `/auth/logout`          | —    | Revoke refresh token, clear cookies   |
| GET    | `/auth/me`              | ✓    | Current user details                  |

#### POST /auth/cli/callback

Request body:
```json
{ "code": "...", "state": "...", "code_verifier": "..." }
```

Response 200:
```json
{
  "status": "success",
  "access_token": "<jwt>",
  "refresh_token": "<hex>",
  "user": { "id": "...", "username": "...", "email": "...", "role": "analyst" }
}
```

#### POST /auth/refresh

CLI (body):
```json
{ "refresh_token": "<hex>" }
```

Web: no body needed — reads the `refresh_token` cookie automatically.

Response 200:
```json
{ "status": "success", "access_token": "<jwt>", "refresh_token": "<hex>" }
```

#### GET /auth/me

Response 200:
```json
{
  "status": "success",
  "data": {
    "id": "...", "username": "...", "email": "...",
    "avatar_url": "...", "role": "analyst",
    "is_active": true, "created_at": "2026-04-26T12:00:00Z"
  }
}
```

---

### Profile endpoints

| Method | Path                   | Role  | Description                |
|--------|------------------------|-------|----------------------------|
| GET    | `/api/profiles`        | any   | List profiles (paginated)  |
| GET    | `/api/profiles/search` | any   | Natural language search    |
| GET    | `/api/profiles/export` | any   | Export profiles as CSV     |
| GET    | `/api/profiles/:id`    | any   | Get single profile         |
| POST   | `/api/profiles`        | admin | Create profile             |
| DELETE | `/api/profiles/:id`    | admin | Delete profile             |

#### Pagination response shape

All list endpoints return:
```json
{
  "status": "success",
  "page": 1,
  "limit": 20,
  "total": 2026,
  "total_pages": 102,
  "links": {
    "self": "/api/profiles?page=1&limit=20",
    "next": "/api/profiles?page=2&limit=20",
    "prev": null
  },
  "data": [ ... ]
}
```

#### GET /api/profiles — filter parameters

| Param            | Description                              | Example                          |
|------------------|------------------------------------------|----------------------------------|
| `country_name`   | Case-insensitive exact match             | `?country_name=Nigeria`          |
| `job_title`      | Partial match                            | `?job_title=engineer`            |
| `min_experience` | Min years of experience (inclusive)      | `?min_experience=5`              |
| `max_experience` | Max years of experience (inclusive)      | `?max_experience=10`             |
| `skills`         | Comma-separated — profile must have all  | `?skills=Python,React`           |
| `sort`           | `field:asc` or `field:desc`             | `?sort=years_of_experience:desc` |
| `page`           | Page number (default: 1)                 | `?page=2`                        |
| `limit`          | Items per page (default: 20, max: 100)   | `?limit=50`                      |

#### GET /api/profiles/search

```
GET /api/profiles/search?q=engineers in Nigeria with 5+ years
GET /api/profiles/search?q=top designers in Kenya
GET /api/profiles/search?q=senior developers with Python skills
```

Supports `page` and `limit`. Response shape is identical to the list endpoint.

#### GET /api/profiles/export

```
GET /api/profiles/export?format=csv
```

Returns `text/csv` with `Content-Disposition: attachment; filename="profiles.csv"`. Accepts the same filter parameters as `GET /api/profiles`.

#### POST /api/profiles (admin only)

```json
{
  "full_name": "Ada Okafor",
  "job_title": "Senior Engineer",
  "country_name": "Nigeria",
  "years_of_experience": 7,
  "skills": ["TypeScript", "Node.js", "PostgreSQL"],
  "bio": "Building APIs since 2017."
}
```

Response 201:
```json
{ "status": "success", "data": { "id": "...", ... } }
```

#### DELETE /api/profiles/:id (admin only)

Response 204 — no body.

---

## RBAC

| Role    | Permissions                                          |
|---------|------------------------------------------------------|
| analyst | Read-only: list, search, export, get single profile  |
| admin   | All analyst permissions + create and delete profiles |

New users are assigned the `analyst` role by default. Role must be changed directly in the database. An inactive (`is_active = false`) account is rejected at every protected endpoint with HTTP 403.

---

## Rate Limiting

| Scope             | Limit        |
|-------------------|--------------|
| `/auth/*` routes  | 10 req / min |
| `/api/*` per user | 60 req / min |

Exceeding the limit returns HTTP `429 Too Many Requests`.

---

## Natural Language Query System

The `/search` endpoint uses **rule-based parsing only** — no AI or LLMs.

**Experience tokens:**
- `X+ years` / `at least X years` / `more than X years` → `min_experience=X`
- `under X years` / `less than X years` → `max_experience=X`
- `between X and Y years` → `min_experience=X, max_experience=Y`

**Country tokens:**
- Country names and demonyms matched against a lookup table
- Longer names matched before shorter (e.g. `south africa` before `africa`)

**Skills tokens:**
- Words following `with` or `skilled in` that match recognised skill names

**Sort tokens:**
- `top`, `best`, `most experienced` → `sort=years_of_experience:desc`

### Mapping examples

| Query | Filters applied |
|-------|-----------------|
| `engineers in Nigeria with 5+ years` | `job_title=engineer, country_name=Nigeria, min_experience=5` |
| `top designers in Kenya` | `job_title=designer, country_name=Kenya, sort=years_of_experience:desc` |
| `senior developers with Python` | `job_title=developer, skills=Python` |

Unrecognised query returns:
```json
{ "status": "error", "message": "Unable to interpret query" }
```

---

## CLI — insighta

Install globally after building the `insighta-cli` repo:

```bash
cd insighta-cli
npm install && npm run build
npm link    # or: npm install -g .
```

### Commands

```bash
insighta login                          # GitHub OAuth in browser (PKCE)
insighta logout                         # Revoke session
insighta whoami                         # Show current user

insighta profiles list                  # List profiles (table output)
insighta profiles list --country Nigeria --limit 50
insighta profiles get <id>              # Single profile detail
insighta profiles search "engineers in Kenya with 5+ years"
insighta profiles create \
  --name "Ada Okafor" \
  --job-title "Engineer" \
  --country Nigeria \
  --years 7 \
  --skills "TypeScript,Node.js"
insighta profiles export profiles.csv   # Download as CSV
```

Credentials are stored at `~/.insighta/credentials.json`. The CLI silently refreshes the access token on expiry using the stored refresh token.

---

## Web Portal — insighta-web

A React + Vite SPA that authenticates via HTTP-only cookies.

```bash
cd insighta-web
npm install
npm run dev    # http://localhost:5173
```

| Route           | Description                         | Auth  |
|-----------------|-------------------------------------|-------|
| `/login`        | GitHub OAuth sign-in                | —     |
| `/`             | Dashboard with profile count        | ✓     |
| `/profiles`     | Paginated profile list + CSV export | ✓     |
| `/profiles/:id` | Profile detail + admin delete       | ✓     |
| `/profiles/new` | Create profile form                 | admin |
| `/search`       | Natural language search             | ✓     |
| `/account`      | Current user info + sign out        | ✓     |

---

## Error Responses

```json
{ "status": "error", "message": "<description>" }
```

| Status | Meaning                              |
|--------|--------------------------------------|
| 400    | Missing or invalid parameter         |
| 401    | Missing or expired access token      |
| 403    | Insufficient role / account disabled |
| 404    | Resource not found                   |
| 422    | Unprocessable entity                 |
| 429    | Rate limit exceeded                  |
| 500    | Internal server error                |
| 502    | Upstream (GitHub API) failure        |

---

## Request Logging

Morgan logs every request to stdout:

```
GET /api/profiles 200 12ms - 4.2kb
POST /auth/cli/callback 200 310ms - 0.5kb
```

# Profile Intelligence API

A RESTful Profile Intelligence Service that enriches name data using external APIs (Genderize, Agify, Nationalize), persists results in PostgreSQL, and provides endpoints for profile management.

## Tech Stack

- **Runtime**: Node.js with TypeScript
- **Framework**: Express.js v5
- **Database**: PostgreSQL (Supabase)
- **ORM**: Prisma v7 with `@prisma/adapter-pg`
- **External APIs**: Genderize, Agify, Nationalize

## Setup

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your DATABASE_URL

# Generate Prisma client
npx prisma generate

# Push schema to database
npx prisma db push

# Run development server
npm run dev
```

## API Endpoints

### POST /api/profiles
Create a new profile by enriching a name.

**Request:**
```json
{ "name": "ella" }
```

**Response (201):**
```json
{
  "status": "success",
  "data": {
    "id": "uuid-v7",
    "name": "ella",
    "gender": "female",
    "gender_probability": 0.99,
    "sample_size": 97517,
    "age": 53,
    "age_group": "adult",
    "country_id": "CM",
    "country_probability": 0.097,
    "created_at": "2026-04-17T12:00:00Z"
  }
}
```

Idempotent: submitting the same name again returns the existing profile with `"message": "Profile already exists"`.

### GET /api/profiles/:id
Retrieve a profile by UUID.

### GET /api/profiles
List profiles with optional case-insensitive filters: `gender`, `country_id`, `age_group`.

Example: `/api/profiles?gender=male&country_id=NG`

### DELETE /api/profiles/:id
Delete a profile. Returns `204 No Content`.

## Error Handling

| Status | Description |
|--------|-------------|
| 400 | Missing or empty name |
| 422 | Invalid type for name |
| 404 | Profile not found |
| 502 | External API returned invalid response |
| 500 | Internal server error |

## Deployment

The API is deployed on leapcell

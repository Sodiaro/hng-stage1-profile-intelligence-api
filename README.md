# Profile Intelligence API — Stage 2

A queryable demographic intelligence API that enriches name data, stores structured profiles in PostgreSQL, and exposes advanced filtering, sorting, pagination, and natural language search.

## Tech Stack

- **Runtime**: Node.js with TypeScript
- **Framework**: Express.js v5
- **Database**: PostgreSQL (Supabase)
- **ORM**: Prisma v7 with `@prisma/adapter-pg`
- **External APIs**: Genderize, Agify, Nationalize

## Setup

```bash
npm install

# Apply schema and seed the database
npm run migrate          # prisma db push + prisma generate
npm run seed <url>       # seed 2026 profiles from the data file URL

npm run dev              # start dev server
```

## Database Schema

| Field               | Type           | Notes                              |
|---------------------|----------------|------------------------------------|
| id                  | UUID v7        | Primary key                        |
| name                | VARCHAR UNIQUE | Person's full name                 |
| gender              | VARCHAR        | `male` or `female`                 |
| gender_probability  | FLOAT          | Confidence score (0–1)             |
| age                 | INT            | Exact age                          |
| age_group           | VARCHAR        | `child`, `teenager`, `adult`, `senior` |
| country_id          | VARCHAR(2)     | ISO code (NG, KE, etc.)            |
| country_name        | VARCHAR        | Full country name                  |
| country_probability | FLOAT          | Confidence score (0–1)             |
| created_at          | TIMESTAMP      | UTC, auto-generated                |

---

## API Endpoints

### POST /api/profiles
Create a profile by enriching a name via Genderize, Agify, Nationalize.

**Request:** `{ "name": "amara" }`

**Response 201:**
```json
{
  "status": "success",
  "data": {
    "id": "019xxx",
    "name": "amara",
    "gender": "female",
    "gender_probability": 0.98,
    "age": 28,
    "age_group": "adult",
    "country_id": "NG",
    "country_name": "Nigeria",
    "country_probability": 0.21,
    "created_at": "2026-04-23T10:00:00Z"
  }
}
```

Idempotent — same name returns existing profile with HTTP 200.

---

### GET /api/profiles
List profiles with combined filters, sorting, and pagination.

**Filter parameters:**

| Param                   | Description                        | Example              |
|-------------------------|------------------------------------|----------------------|
| `gender`                | `male` or `female`                 | `?gender=male`       |
| `age_group`             | `child`, `teenager`, `adult`, `senior` | `?age_group=adult` |
| `country_id`            | 2-letter ISO code                  | `?country_id=NG`     |
| `min_age`               | Minimum age (inclusive)            | `?min_age=25`        |
| `max_age`               | Maximum age (inclusive)            | `?max_age=40`        |
| `min_gender_probability`| Minimum gender confidence          | `?min_gender_probability=0.9` |
| `min_country_probability`| Minimum country confidence        | `?min_country_probability=0.1` |

**Sorting:**

| Param     | Values                                     | Default      |
|-----------|--------------------------------------------|--------------|
| `sort_by` | `age`, `created_at`, `gender_probability` | `created_at` |
| `order`   | `asc`, `desc`                              | `asc`        |

**Pagination:**

| Param   | Default | Max |
|---------|---------|-----|
| `page`  | `1`     | —   |
| `limit` | `10`    | `50`|

**Example:**
```
GET /api/profiles?gender=male&country_id=NG&min_age=25&sort_by=age&order=desc&page=1&limit=10
```

**Response:**
```json
{
  "status": "success",
  "page": 1,
  "limit": 10,
  "total": 312,
  "data": [ ... ]
}
```

---

### GET /api/profiles/search
Natural language query interface. Converts plain English into database filters.

```
GET /api/profiles/search?q=young males from nigeria
GET /api/profiles/search?q=females above 30
GET /api/profiles/search?q=adult males from kenya
GET /api/profiles/search?q=male and female teenagers above 17
GET /api/profiles/search?q=people from angola
```

Supports `page` and `limit` pagination parameters.

**Response format:** same as `GET /api/profiles`.

**Error (uninterpretable query):**
```json
{ "status": "error", "message": "Unable to interpret query" }
```

---

### GET /api/profiles/:id
Retrieve a single profile by UUID.

### DELETE /api/profiles/:id
Delete a profile. Returns `204 No Content`.

---

## Natural Language Query System

The `/search` endpoint uses **rule-based parsing only** (no AI or LLMs).

### How it works

The query string is lowercased and scanned for recognised tokens:

**Gender tokens:**
- `male`, `males`, `man`, `men`, `boy`, `boys` → `gender=male`
- `female`, `females`, `woman`, `women`, `girl`, `girls` → `gender=female`
- Both genders in the same query → no gender filter applied

**Age group tokens:**
- `child`, `children`, `kid`, `kids` → `age_group=child`
- `teenager`, `teenagers`, `teen`, `teens` → `age_group=teenager`
- `adult`, `adults` → `age_group=adult`
- `senior`, `seniors`, `elderly` → `age_group=senior`
- `young` → **not** an age group; maps to `min_age=16 AND max_age=24`

**Age range tokens:**
- `above X` / `over X` / `older than X` → `min_age=X`
- `below X` / `under X` / `younger than X` → `max_age=X`
- `between X and Y` → `min_age=X AND max_age=Y`

**Country tokens:**
- Country names and demonyms recognised anywhere in the query
- Examples: `nigeria` → `NG`, `kenyan` → `KE`, `south africa` → `ZA`
- Longer country names are matched before shorter ones (e.g. `south africa` before `africa`)

### Mapping examples

| Query | Filters applied |
|-------|-----------------|
| `young males` | `gender=male, min_age=16, max_age=24` |
| `females above 30` | `gender=female, min_age=30` |
| `people from angola` | `country_id=AO` |
| `adult males from kenya` | `gender=male, age_group=adult, country_id=KE` |
| `male and female teenagers above 17` | `age_group=teenager, min_age=17` |

### Unrecognised queries
If no known tokens are found, the endpoint returns:
```json
{ "status": "error", "message": "Unable to interpret query" }
```

---

## Error Responses

All errors follow this structure:
```json
{ "status": "error", "message": "<description>" }
```

| Status | Meaning                              |
|--------|--------------------------------------|
| 400    | Missing or empty required parameter  |
| 422    | Invalid parameter type or value      |
| 404    | Profile not found                    |
| 502    | External enrichment API failed       |
| 500    | Internal server error                |

---

## CORS

`Access-Control-Allow-Origin: *` is set on all responses.

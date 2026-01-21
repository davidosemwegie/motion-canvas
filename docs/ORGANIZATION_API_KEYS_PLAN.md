# Organization API Keys - Implementation Plan

## Overview

This document outlines the plan for implementing Organization API Keys in Motion Canvas, enabling programmatic access to the platform for third-party integrations, CI/CD pipelines, and automation workflows.

**Reference Architecture**: Based on [Clerk's Machine Authentication API Keys](https://clerk.com/docs/guides/development/machine-auth/api-keys) patterns.

---

## 1. Core Concepts

### 1.1 What Are Organization API Keys?

API keys are **long-lived, opaque tokens** that allow third-party services to access your API on behalf of an organization. Unlike JWTs, opaque tokens support **instant revocation** without waiting for token expiry.

### 1.2 Key Principles

| Principle | Description |
|-----------|-------------|
| **Identity Context** | Every API key is tied to a user OR organization |
| **Scoped Access** | Keys have specific scopes defining what they can access |
| **Instant Revocation** | Opaque tokens can be invalidated immediately |
| **Audit Trail** | Track who created keys and when they're used |
| **Secret Once** | The secret is only shown at creation time |

---

## 2. Data Models

### 2.1 Organization

```typescript
interface Organization {
  id: string;                    // org_xxx format
  name: string;
  slug: string;                  // URL-friendly identifier
  metadata: Record<string, any>; // Custom metadata
  createdAt: Date;
  updatedAt: Date;
}
```

### 2.2 API Key

```typescript
interface APIKey {
  id: string;                    // key_xxx format

  // Identity binding
  subject: string;               // user_xxx OR org_xxx
  subjectType: 'user' | 'organization';

  // Key details
  name: string;                  // e.g., "Production CI/CD"
  description?: string;          // Longer description
  keyPrefix: string;             // First 8 chars for identification (mc_xxxxxxxx)
  keyHash: string;               // bcrypt hash of full key (never store plaintext!)

  // Access control
  scopes: string[];              // e.g., ["projects:read", "exports:write"]

  // Metadata
  claims?: Record<string, any>;  // Custom claims/metadata
  createdBy: string;             // user_xxx who created this key

  // Lifecycle
  lastUsedAt?: Date;
  expiresAt?: Date;              // null = never expires
  revokedAt?: Date;
  revokedBy?: string;
  revocationReason?: string;

  createdAt: Date;
  updatedAt: Date;
}
```

### 2.3 API Key Creation Response

```typescript
interface APIKeyCreateResponse {
  apiKey: APIKey;
  secret: string;  // Full key - ONLY returned at creation time!
}
```

---

## 3. API Design

### 3.1 Endpoints

#### Create API Key
```
POST /api/v1/organizations/:orgId/api-keys
```

**Request Body:**
```json
{
  "name": "Production CI/CD",
  "description": "Used for automated exports in CI pipeline",
  "scopes": ["projects:read", "exports:write"],
  "claims": {
    "environment": "production",
    "team": "platform"
  },
  "expiresIn": null
}
```

**Response (201):**
```json
{
  "apiKey": {
    "id": "key_2abc123def456",
    "subject": "org_xyz789",
    "subjectType": "organization",
    "name": "Production CI/CD",
    "keyPrefix": "mc_a1b2c3d4",
    "scopes": ["projects:read", "exports:write"],
    "createdBy": "user_abc123",
    "createdAt": "2025-01-21T10:00:00Z"
  },
  "secret": "mc_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0"
}
```

> **Warning**: The `secret` field is only returned once at creation. Store it securely!

#### List API Keys
```
GET /api/v1/organizations/:orgId/api-keys
```

**Query Parameters:**
- `limit` (default: 20, max: 100)
- `offset` (default: 0)
- `status` (active | revoked | expired | all)

**Response (200):**
```json
{
  "data": [
    {
      "id": "key_2abc123def456",
      "name": "Production CI/CD",
      "keyPrefix": "mc_a1b2c3d4",
      "scopes": ["projects:read", "exports:write"],
      "lastUsedAt": "2025-01-20T15:30:00Z",
      "createdAt": "2025-01-01T10:00:00Z"
    }
  ],
  "totalCount": 5,
  "hasMore": false
}
```

#### Get API Key
```
GET /api/v1/organizations/:orgId/api-keys/:keyId
```

#### Update API Key
```
PATCH /api/v1/organizations/:orgId/api-keys/:keyId
```

**Allowed Updates:**
- `name`
- `description`
- `scopes` (narrowing only, cannot expand)
- `claims`

#### Revoke API Key
```
POST /api/v1/organizations/:orgId/api-keys/:keyId/revoke
```

**Request Body:**
```json
{
  "reason": "Key compromised - rotating credentials"
}
```

---

## 4. Scopes System

### 4.1 Scope Format

Scopes follow the pattern: `resource:action` or `resource:subresource:action`

### 4.2 Available Scopes

| Scope | Description |
|-------|-------------|
| `projects:read` | View project metadata and settings |
| `projects:write` | Create/update/delete projects |
| `exports:read` | View export history and status |
| `exports:write` | Trigger new exports |
| `assets:read` | Access project assets |
| `assets:write` | Upload/modify assets |
| `settings:read` | View organization settings |
| `settings:write` | Modify organization settings |
| `api-keys:read` | View API keys (without secrets) |
| `api-keys:write` | Create/revoke API keys |

### 4.3 Scope Hierarchy

```
organization:*          (full access)
├── projects:*
│   ├── projects:read
│   └── projects:write
├── exports:*
│   ├── exports:read
│   └── exports:write
├── assets:*
│   ├── assets:read
│   └── assets:write
└── settings:*
    ├── settings:read
    └── settings:write
```

---

## 5. Authentication Flow

### 5.1 Key Format

```
mc_<random_32_bytes_base62_encoded>

Example: mc_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0
```

### 5.2 Request Authentication

API keys are passed via the `Authorization` header:

```
Authorization: Bearer mc_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6
```

Or via `X-API-Key` header:

```
X-API-Key: mc_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6
```

### 5.3 Validation Flow

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Request    │────▶│  Extract Key │────▶│  Lookup by   │
│   Arrives    │     │  from Header │     │  Prefix      │
└──────────────┘     └──────────────┘     └──────────────┘
                                                  │
                                                  ▼
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Attach     │◀────│   Verify     │◀────│  Check if    │
│   Context    │     │   Hash       │     │  Revoked     │
└──────────────┘     └──────────────┘     └──────────────┘
                                                  │
                                                  ▼
                                          ┌──────────────┐
                                          │   Check      │
                                          │   Expiry     │
                                          └──────────────┘
```

### 5.4 Request Context

After successful authentication, attach to request:

```typescript
interface APIKeyContext {
  apiKeyId: string;
  subject: string;
  subjectType: 'user' | 'organization';
  scopes: string[];
  claims: Record<string, any>;
}
```

---

## 6. Security Considerations

### 6.1 Key Storage

- **NEVER** store plaintext keys in the database
- Use bcrypt (cost factor 12+) for hashing
- Store only the key prefix (first 8 chars) for identification
- Index by prefix for efficient lookup

### 6.2 Key Generation

```typescript
import { randomBytes } from 'crypto';

function generateAPIKey(): { key: string; prefix: string } {
  const bytes = randomBytes(32);
  const key = `mc_${bytes.toString('base64url')}`;
  const prefix = key.substring(0, 12); // mc_ + 8 chars
  return { key, prefix };
}
```

### 6.3 Rate Limiting

| Context | Limit |
|---------|-------|
| Per API Key | 1000 requests/minute |
| Per Organization | 5000 requests/minute |
| Key Creation | 10 keys/hour per org |

### 6.4 Audit Logging

Log all API key events:
- Creation (who, when, scopes)
- Usage (endpoint, timestamp, IP)
- Revocation (who, when, reason)
- Failed authentication attempts

---

## 7. Implementation Phases

### Phase 1: Foundation (Database & Models)

**Tasks:**
1. Set up database (PostgreSQL recommended)
2. Create Organization model and migrations
3. Create APIKey model and migrations
4. Implement key generation utility
5. Implement secure hashing

**Deliverables:**
- Database schema
- TypeScript interfaces
- Key generation utilities

### Phase 2: Core API

**Tasks:**
1. Implement authentication middleware
2. Create API key CRUD endpoints
3. Implement scope validation
4. Add request context injection

**Deliverables:**
- `/api/v1/organizations/:orgId/api-keys/*` endpoints
- Auth middleware
- Scope checking utilities

### Phase 3: Integration

**Tasks:**
1. Integrate with existing vite-plugin middleware pattern
2. Add WebSocket authentication support
3. Implement key validation caching (Redis)
4. Add rate limiting

**Deliverables:**
- Vite plugin integration
- WebSocket auth
- Performance optimizations

### Phase 4: UI Components

**Tasks:**
1. Create API Keys management page
2. Key creation modal with scope selection
3. Key listing with filtering/search
4. Revocation confirmation flow
5. Copy-to-clipboard for new keys

**Deliverables:**
- React/Preact components
- Integration with existing UI patterns

### Phase 5: Polish & Security

**Tasks:**
1. Comprehensive audit logging
2. Rate limiting implementation
3. Key rotation guidance
4. Documentation
5. Security review

**Deliverables:**
- Audit logs
- Rate limiter
- User documentation

---

## 8. File Structure

```
packages/
├── api-server/                    # New package
│   ├── src/
│   │   ├── index.ts
│   │   ├── db/
│   │   │   ├── client.ts
│   │   │   ├── migrations/
│   │   │   └── schema.ts
│   │   ├── models/
│   │   │   ├── Organization.ts
│   │   │   ├── APIKey.ts
│   │   │   └── index.ts
│   │   ├── middleware/
│   │   │   ├── auth.ts
│   │   │   ├── rateLimit.ts
│   │   │   └── scopeCheck.ts
│   │   ├── routes/
│   │   │   ├── apiKeys.ts
│   │   │   └── organizations.ts
│   │   ├── services/
│   │   │   ├── apiKeyService.ts
│   │   │   └── authService.ts
│   │   └── utils/
│   │       ├── keyGenerator.ts
│   │       └── hash.ts
│   ├── package.json
│   └── tsconfig.json
│
├── ui/
│   └── src/
│       └── components/
│           └── api-keys/          # New directory
│               ├── APIKeyList.tsx
│               ├── APIKeyCreate.tsx
│               ├── APIKeyRow.tsx
│               └── ScopeSelector.tsx
│
└── vite-plugin/
    └── src/
        └── partials/
            └── apiAuth.ts         # New file - middleware integration
```

---

## 9. Database Schema (PostgreSQL)

```sql
-- Organizations table
CREATE TABLE organizations (
    id VARCHAR(32) PRIMARY KEY,           -- org_xxx
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) UNIQUE NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- API Keys table
CREATE TABLE api_keys (
    id VARCHAR(32) PRIMARY KEY,           -- key_xxx
    subject VARCHAR(32) NOT NULL,         -- org_xxx or user_xxx
    subject_type VARCHAR(20) NOT NULL,    -- 'organization' or 'user'
    name VARCHAR(255) NOT NULL,
    description TEXT,
    key_prefix VARCHAR(16) NOT NULL,      -- For identification
    key_hash VARCHAR(255) NOT NULL,       -- bcrypt hash
    scopes TEXT[] NOT NULL DEFAULT '{}',
    claims JSONB DEFAULT '{}',
    created_by VARCHAR(32) NOT NULL,      -- user_xxx
    last_used_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,               -- NULL = never expires
    revoked_at TIMESTAMPTZ,
    revoked_by VARCHAR(32),
    revocation_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Indexes
    CONSTRAINT fk_subject_org
        FOREIGN KEY (subject)
        REFERENCES organizations(id)
        ON DELETE CASCADE
);

CREATE INDEX idx_api_keys_prefix ON api_keys(key_prefix);
CREATE INDEX idx_api_keys_subject ON api_keys(subject);
CREATE INDEX idx_api_keys_active ON api_keys(subject)
    WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW());

-- Audit log table
CREATE TABLE api_key_audit_log (
    id SERIAL PRIMARY KEY,
    api_key_id VARCHAR(32) NOT NULL,
    event_type VARCHAR(50) NOT NULL,      -- 'created', 'used', 'revoked', 'auth_failed'
    actor_id VARCHAR(32),                 -- Who performed the action
    ip_address INET,
    user_agent TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_api_key ON api_key_audit_log(api_key_id);
CREATE INDEX idx_audit_created ON api_key_audit_log(created_at);
```

---

## 10. SDK/Client Usage Examples

### Creating an API Key

```typescript
const response = await fetch('/api/v1/organizations/org_xyz/api-keys', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${sessionToken}`
  },
  body: JSON.stringify({
    name: 'CI/CD Pipeline',
    scopes: ['projects:read', 'exports:write']
  })
});

const { apiKey, secret } = await response.json();
console.log('Save this secret securely:', secret);
// mc_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0
```

### Using an API Key

```typescript
// In your CI/CD script or third-party integration
const response = await fetch('https://api.motion-canvas.io/v1/projects', {
  headers: {
    'X-API-Key': process.env.MOTION_CANVAS_API_KEY
  }
});
```

### Revoking a Key

```typescript
await fetch('/api/v1/organizations/org_xyz/api-keys/key_abc123/revoke', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${sessionToken}`
  },
  body: JSON.stringify({
    reason: 'Rotating credentials after team member departure'
  })
});
```

---

## 11. Error Responses

### Standard Error Format

```json
{
  "error": {
    "code": "invalid_api_key",
    "message": "The provided API key is invalid or has been revoked",
    "details": {
      "keyPrefix": "mc_a1b2c3d4"
    }
  }
}
```

### Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `invalid_api_key` | 401 | Key doesn't exist or wrong secret |
| `revoked_api_key` | 401 | Key has been revoked |
| `expired_api_key` | 401 | Key has expired |
| `insufficient_scope` | 403 | Key lacks required scope |
| `rate_limit_exceeded` | 429 | Too many requests |
| `key_not_found` | 404 | API key ID not found |

---

## 12. Open Questions

1. **User API Keys**: Should we also support user-scoped API keys (not just organization)?
2. **Key Rotation**: Should we support automatic key rotation with overlap periods?
3. **IP Allowlisting**: Should keys be restricted to specific IP ranges?
4. **Webhook Notifications**: Notify on key events (creation, revocation, suspicious usage)?
5. **Key Inheritance**: Should org admin keys automatically have all scopes?

---

## References

- [Clerk API Keys Documentation](https://clerk.com/docs/guides/development/machine-auth/api-keys)
- [Clerk Machine Auth Overview](https://clerk.com/docs/guides/development/machine-auth/overview)
- [Clerk APIKeys SDK Reference](https://clerk.com/docs/reference/javascript/api-keys)
- [Clerk API Keys Changelog](https://clerk.com/changelog/2025-12-11-api-keys-public-beta)
- [OWASP API Security](https://owasp.org/API-Security/)

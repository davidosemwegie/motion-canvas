# Organization API Keys - Implementation Plan

## Overview

This document outlines the plan for implementing Organization API Keys in Motion Canvas, enabling programmatic access to the platform for third-party integrations, CI/CD pipelines, and automation workflows.

**Stack:**
- **[Clerk](https://clerk.com)** - User & organization authentication
- **[Unkey](https://unkey.com)** - API key management, rate limiting, analytics

---

## 1. Architecture Overview

### 1.1 Why Clerk + Unkey?

| Concern | Solution | Why |
|---------|----------|-----|
| User authentication | Clerk | Session management, org membership, UI components |
| API key management | Unkey | Key storage, verification, rate limiting, analytics |
| Identity linking | `ownerId` | Unkey stores Clerk's `userId`/`orgId` for lookup |

### 1.2 High-Level Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              TWO AUTH PATHS                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  INTERACTIVE (Browser/App)              PROGRAMMATIC (CI/CD, Scripts)       │
│  ─────────────────────────              ─────────────────────────────       │
│                                                                             │
│  User logs in via Clerk                 Request includes API key            │
│         │                                        │                          │
│         ▼                                        ▼                          │
│  ┌─────────────┐                        ┌─────────────────┐                 │
│  │   Clerk     │                        │     Unkey       │                 │
│  │  verifies   │                        │    verifies     │                 │
│  │   session   │                        │    API key      │                 │
│  └─────────────┘                        └─────────────────┘                 │
│         │                                        │                          │
│         ▼                                        ▼                          │
│  Returns: userId, orgId                 Returns: ownerId (= Clerk ID)       │
│         │                                        │                          │
│         │                                        ▼                          │
│         │                               ┌─────────────────┐                 │
│         │                               │  Fetch user/org │                 │
│         │                               │   from Clerk    │                 │
│         │                               └─────────────────┘                 │
│         │                                        │                          │
│         └────────────────┬───────────────────────┘                          │
│                          ▼                                                  │
│                   Authenticated!                                            │
│                   (userId, orgId available)                                 │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.3 Key Principles

| Principle | Description |
|-----------|-------------|
| **Identity Linking** | Every Unkey API key stores Clerk's `userId`/`orgId` in `ownerId` |
| **Scoped Access** | Keys have specific scopes defining what they can access |
| **Instant Revocation** | Unkey uses opaque tokens (not JWTs) for immediate invalidation |
| **Built-in Rate Limiting** | Unkey handles per-key and per-org rate limits at the edge |
| **Analytics Included** | Usage tracking comes free with Unkey |

---

## 2. Unkey Setup

### 2.1 Environment Variables

```bash
# Clerk
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_xxx
CLERK_SECRET_KEY=sk_xxx

# Unkey
UNKEY_ROOT_KEY=unkey_xxx        # For server-side key management
UNKEY_API_ID=api_xxx            # Your Unkey API identifier
```

### 2.2 Unkey API Configuration

Create an API in the [Unkey Dashboard](https://app.unkey.com) with:

| Setting | Value |
|---------|-------|
| Name | `motion-canvas-api` |
| Key prefix | `mc_` |
| Default rate limit | 1000 requests/minute |
| Default expiration | None (keys don't expire by default) |

---

## 3. Implementation

### 3.1 Creating API Keys (Server Action)

When a user creates an API key through your UI, they're authenticated via Clerk. Store their Clerk ID in Unkey.

```typescript
// app/actions/api-keys.ts
'use server';

import { auth } from '@clerk/nextjs/server';
import { Unkey } from '@unkey/api';

const unkey = new Unkey({ rootKey: process.env.UNKEY_ROOT_KEY! });

export async function createApiKey(data: {
  name: string;
  scopes: string[];
  expiresIn?: number;
}) {
  // 1. Get Clerk auth context
  const { userId, orgId } = auth();
  if (!userId) throw new Error('Unauthorized');

  // 2. Determine the owner (org takes precedence)
  const ownerId = orgId ?? userId;

  // 3. Create key in Unkey, linking to Clerk identity
  const { result, error } = await unkey.keys.create({
    apiId: process.env.UNKEY_API_ID!,
    name: data.name,
    ownerId: ownerId,                    // Links to Clerk org/user
    meta: {
      clerkUserId: userId,               // Who created it
      clerkOrgId: orgId,                 // Which org (if any)
      scopes: data.scopes,               // Our app's scopes
    },
    expires: data.expiresIn
      ? Date.now() + data.expiresIn * 1000
      : undefined,
    ratelimit: {
      type: 'fast',
      limit: 1000,
      refillRate: 1000,
      refillInterval: 60000,             // 1000 req/min
    },
  });

  if (error) {
    throw new Error(error.message);
  }

  // 4. Return the key (secret only shown once!)
  return {
    keyId: result.keyId,
    key: result.key,                     // mc_xxxxx - show to user ONCE
  };
}
```

### 3.2 Listing API Keys

```typescript
// app/actions/api-keys.ts

export async function listApiKeys() {
  const { userId, orgId } = auth();
  if (!userId) throw new Error('Unauthorized');

  const ownerId = orgId ?? userId;

  const { result, error } = await unkey.keys.list({
    apiId: process.env.UNKEY_API_ID!,
    ownerId: ownerId,
  });

  if (error) throw new Error(error.message);

  return result.keys.map(key => ({
    id: key.id,
    name: key.name,
    createdAt: key.createdAt,
    expires: key.expires,
    // Note: We don't have access to the actual key anymore
  }));
}
```

### 3.3 Revoking API Keys

```typescript
// app/actions/api-keys.ts

export async function revokeApiKey(keyId: string) {
  const { userId, orgId } = auth();
  if (!userId) throw new Error('Unauthorized');

  // Verify the key belongs to this user/org before revoking
  const { result: keyInfo } = await unkey.keys.get({ keyId });

  const ownerId = orgId ?? userId;
  if (keyInfo?.ownerId !== ownerId) {
    throw new Error('Forbidden');
  }

  const { error } = await unkey.keys.revoke({ keyId });
  if (error) throw new Error(error.message);

  return { success: true };
}
```

### 3.4 Verifying API Keys (API Middleware)

When an API request comes in with an API key, verify it and get the Clerk user/org.

```typescript
// lib/auth/api-key-auth.ts

import { verifyKey } from '@unkey/api';
import { clerkClient } from '@clerk/nextjs/server';

export interface ApiKeyAuthResult {
  valid: boolean;
  userId?: string;
  orgId?: string;
  scopes?: string[];
  error?: string;
}

export async function authenticateApiKey(
  apiKey: string
): Promise<ApiKeyAuthResult> {
  // 1. Verify the key with Unkey
  const { result, error } = await verifyKey(apiKey);

  if (error) {
    return { valid: false, error: error.message };
  }

  if (!result.valid) {
    return { valid: false, error: 'Invalid or revoked API key' };
  }

  // 2. Extract Clerk IDs from Unkey metadata
  const clerkUserId = result.meta?.clerkUserId as string;
  const clerkOrgId = result.meta?.clerkOrgId as string | undefined;
  const scopes = result.meta?.scopes as string[] | undefined;

  // 3. Optionally verify user still exists in Clerk
  try {
    await clerkClient.users.getUser(clerkUserId);
  } catch {
    return { valid: false, error: 'User no longer exists' };
  }

  // 4. Optionally verify org membership still valid
  if (clerkOrgId) {
    try {
      const memberships = await clerkClient.users.getOrganizationMembershipList({
        userId: clerkUserId,
      });
      const isMember = memberships.some(m => m.organization.id === clerkOrgId);
      if (!isMember) {
        return { valid: false, error: 'User no longer in organization' };
      }
    } catch {
      return { valid: false, error: 'Organization verification failed' };
    }
  }

  return {
    valid: true,
    userId: clerkUserId,
    orgId: clerkOrgId,
    scopes,
  };
}
```

### 3.5 API Route Middleware

```typescript
// middleware/api-auth.ts

import { auth } from '@clerk/nextjs/server';
import { authenticateApiKey } from '@/lib/auth/api-key-auth';

export async function withAuth(request: Request) {
  const apiKey = request.headers.get('x-api-key');
  const authHeader = request.headers.get('authorization');

  // Path 1: API Key authentication
  if (apiKey) {
    const result = await authenticateApiKey(apiKey);
    if (!result.valid) {
      return new Response(JSON.stringify({ error: result.error }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return {
      userId: result.userId,
      orgId: result.orgId,
      scopes: result.scopes,
      authMethod: 'api_key' as const,
    };
  }

  // Path 2: Clerk session authentication
  const { userId, orgId } = auth();
  if (userId) {
    return {
      userId,
      orgId,
      scopes: ['*'],  // Full access for interactive users
      authMethod: 'session' as const,
    };
  }

  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}
```

### 3.6 Example Protected API Route

```typescript
// app/api/projects/route.ts

import { withAuth } from '@/middleware/api-auth';
import { hasScope } from '@/lib/auth/scopes';

export async function GET(request: Request) {
  const authResult = await withAuth(request);

  if (authResult instanceof Response) {
    return authResult;  // Unauthorized response
  }

  const { userId, orgId, scopes } = authResult;

  // Check scopes
  if (!hasScope(scopes, 'projects:read')) {
    return new Response(JSON.stringify({ error: 'Insufficient scope' }), {
      status: 403,
    });
  }

  // Fetch projects for this org/user
  const projects = await db.projects.findMany({
    where: { ownerId: orgId ?? userId },
  });

  return Response.json({ projects });
}
```

---

## 4. Scopes System

### 4.1 Available Scopes

| Scope | Description |
|-------|-------------|
| `projects:read` | View project metadata and settings |
| `projects:write` | Create/update/delete projects |
| `exports:read` | View export history and status |
| `exports:write` | Trigger new exports |
| `assets:read` | Access project assets |
| `assets:write` | Upload/modify assets |

### 4.2 Scope Checking Utility

```typescript
// lib/auth/scopes.ts

export function hasScope(
  userScopes: string[] | undefined,
  requiredScope: string
): boolean {
  if (!userScopes) return false;

  // Wildcard access
  if (userScopes.includes('*')) return true;

  // Exact match
  if (userScopes.includes(requiredScope)) return true;

  // Resource wildcard (e.g., "projects:*" grants "projects:read")
  const [resource] = requiredScope.split(':');
  if (userScopes.includes(`${resource}:*`)) return true;

  return false;
}
```

---

## 5. UI Components

### 5.1 API Keys Management Page

```tsx
// app/settings/api-keys/page.tsx

'use client';

import { useState } from 'react';
import { createApiKey, listApiKeys, revokeApiKey } from '@/app/actions/api-keys';

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [newKey, setNewKey] = useState<string | null>(null);

  async function handleCreate(name: string, scopes: string[]) {
    const result = await createApiKey({ name, scopes });
    setNewKey(result.key);  // Show once!
    refreshKeys();
  }

  async function handleRevoke(keyId: string) {
    if (confirm('Are you sure? This cannot be undone.')) {
      await revokeApiKey(keyId);
      refreshKeys();
    }
  }

  return (
    <div>
      <h1>API Keys</h1>

      {newKey && (
        <div className="alert alert-warning">
          <strong>Save this key now!</strong> It won't be shown again.
          <code>{newKey}</code>
          <button onClick={() => navigator.clipboard.writeText(newKey)}>
            Copy
          </button>
        </div>
      )}

      <CreateKeyForm onSubmit={handleCreate} />

      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Created</th>
            <th>Last Used</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {keys.map(key => (
            <tr key={key.id}>
              <td>{key.name}</td>
              <td>{key.createdAt}</td>
              <td>{key.lastUsedAt ?? 'Never'}</td>
              <td>
                <button onClick={() => handleRevoke(key.id)}>
                  Revoke
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

---

## 6. Implementation Phases

### Phase 1: Unkey Setup & Basic Integration

**Tasks:**
1. Create Unkey account and API
2. Add environment variables
3. Install `@unkey/api` package
4. Implement `createApiKey` server action
5. Implement `verifyKey` middleware

**Deliverables:**
- Working key creation flow
- Basic API authentication with keys

### Phase 2: Full CRUD & Clerk Integration

**Tasks:**
1. Implement `listApiKeys` with Clerk org filtering
2. Implement `revokeApiKey` with ownership verification
3. Add Clerk user/org validation on verify
4. Implement scope checking

**Deliverables:**
- Complete key management
- Proper identity linking

### Phase 3: UI Components

**Tasks:**
1. Create API Keys settings page
2. Key creation modal with scope selector
3. Key listing with last-used info
4. Copy-to-clipboard + warning on creation
5. Revocation confirmation flow

**Deliverables:**
- User-facing key management UI

### Phase 4: Polish & Monitoring

**Tasks:**
1. Set up Unkey analytics dashboard
2. Configure rate limits per key tier
3. Add usage-based alerts
4. Documentation for API consumers

**Deliverables:**
- Production-ready system
- API documentation

---

## 7. What Unkey Handles For Us

| Feature | Build Ourselves | With Unkey |
|---------|-----------------|------------|
| Key hashing/storage | Must implement | Included |
| Key verification | Must implement | `verifyKey()` |
| Rate limiting | Must implement (Redis) | Included (edge) |
| Usage analytics | Must implement | Dashboard included |
| Key expiration | Must implement | Included |
| Audit logs | Must implement | Included |
| Global performance | Must deploy globally | Included |

**Estimated time saved: 2-3 weeks of development**

---

## 8. Costs

### Unkey Pricing

| Tier | Price | Verifications | Best For |
|------|-------|---------------|----------|
| Free | $0 | 1,000/month | Development |
| Pro | $25/mo | 150,000/month | Production |
| Custom | Contact | Unlimited | Enterprise |

### Clerk Pricing

Already using Clerk for auth - no additional cost for this feature.

---

## 9. Security Considerations

### 9.1 Key Security (Handled by Unkey)

- Keys are hashed with one-way encryption
- Only prefix is stored for identification
- Full key shown once at creation

### 9.2 Our Responsibilities

- Validate Clerk user/org still exists on sensitive operations
- Check org membership hasn't been revoked
- Implement proper scope checking
- Never log full API keys

### 9.3 Recommended Rate Limits

| Context | Limit |
|---------|-------|
| Per API Key | 1,000 requests/minute |
| Per Organization | 5,000 requests/minute |
| Key Creation | 10 keys/hour per org |

---

## 10. Error Responses

### Standard Error Format

```json
{
  "error": {
    "code": "invalid_api_key",
    "message": "The provided API key is invalid or has been revoked"
  }
}
```

### Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `invalid_api_key` | 401 | Key doesn't exist or revoked |
| `expired_api_key` | 401 | Key has expired |
| `user_not_found` | 401 | Clerk user no longer exists |
| `org_membership_revoked` | 401 | User removed from org |
| `insufficient_scope` | 403 | Key lacks required scope |
| `rate_limit_exceeded` | 429 | Too many requests |

---

## 11. Example: Full Request Flow

```typescript
// External service calling your API
const response = await fetch('https://api.yourapp.com/v1/projects', {
  headers: {
    'X-API-Key': 'mc_abc123...',
  },
});

// Your API:
// 1. Extract key from header
// 2. Call Unkey: verifyKey('mc_abc123...')
// 3. Unkey returns: { valid: true, ownerId: 'org_xyz', meta: { clerkUserId: 'user_123', scopes: ['projects:read'] } }
// 4. Optionally: Fetch user from Clerk to verify still exists
// 5. Check scope: hasScope(['projects:read'], 'projects:read') → true
// 6. Execute request with org context
// 7. Return projects for org_xyz
```

---

## References

- [Unkey Documentation](https://www.unkey.com/docs)
- [Unkey TypeScript SDK](https://www.unkey.com/docs/libraries/ts/sdk/overview)
- [Using Unkey with Auth Providers](https://www.unkey.com/blog/using-unkey-with-auth)
- [Clerk Documentation](https://clerk.com/docs)
- [Clerk + API Keys](https://clerk.com/docs/guides/development/machine-auth/api-keys)

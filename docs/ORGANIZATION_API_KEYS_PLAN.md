# Organization API Keys - Implementation Plan

## Overview

This document outlines the plan for implementing Organization API Keys in Motion Canvas, enabling programmatic access to the platform for third-party integrations, CI/CD pipelines, and automation workflows.

**Stack:** [Clerk](https://clerk.com) - User authentication, organization management, AND API key management (native feature)

---

## 1. Architecture Overview

### 1.1 Why Clerk-Only?

| Benefit | Description |
|---------|-------------|
| **Single vendor** | No additional service to manage |
| **Native integration** | API keys tied directly to Clerk orgs/users |
| **Built-in UI option** | Can use `<OrganizationProfile/>` or build custom |
| **Unified billing** | Part of existing Clerk subscription |
| **Same SDK** | Use `clerkClient.apiKeys.*` methods |

### 1.2 Key Features

- **Organization-scoped keys** - Keys belong to an org, not individual users
- **Scopes** - Fine-grained permissions per key
- **Instant revocation** - Opaque tokens (not JWTs) can be invalidated immediately
- **Auto-creation** - Default API key created when org is created

---

## 2. Features

### 2.1 Dashboard Sidebar Page

New page at `/dashboard/api-keys` with:

- List of all API keys for the current organization
- Create new key (name, scopes, expiration)
- Copy key to clipboard (shown once on creation)
- Revoke existing keys
- View last used timestamp

### 2.2 Auto-Create on Organization Creation

When a new organization is created via Clerk:

1. Webhook receives `organization.created` event
2. Automatically create a default API key named "Default API Key"
3. Store the key securely (user must retrieve from dashboard)

---

## 3. Implementation

### 3.1 Environment Variables

```bash
# Existing Clerk config
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_xxx
CLERK_SECRET_KEY=sk_xxx

# New: Webhook signing secret
CLERK_WEBHOOK_SIGNING_SECRET=whsec_xxx
```

### 3.2 Enable Organization API Keys in Clerk Dashboard

1. Go to Clerk Dashboard → Configure → API Keys
2. Enable "Organization API keys"
3. Configure default scopes (optional)

---

## 4. Server Actions

### 4.1 Create API Key

```typescript
// app/actions/api-keys.ts
'use server';

import { auth } from '@clerk/nextjs/server';
import { createClerkClient } from '@clerk/backend';

const clerkClient = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY!,
});

export async function createApiKey(data: {
  name: string;
  scopes?: string[];
  expiresInDays?: number;
}) {
  const { userId, orgId } = await auth();

  if (!userId || !orgId) {
    throw new Error('Must be in an organization to create API keys');
  }

  const apiKey = await clerkClient.apiKeys.create({
    name: data.name,
    subject: orgId,                              // org_xxx
    createdBy: userId,                           // Track who created it
    scopes: data.scopes,
    secondsUntilExpiration: data.expiresInDays
      ? data.expiresInDays * 24 * 60 * 60
      : undefined,                               // undefined = never expires
  });

  // IMPORTANT: apiKey.secret is only available here, never again!
  return {
    id: apiKey.id,
    name: apiKey.name,
    secret: apiKey.secret,                       // Show to user ONCE
    createdAt: apiKey.createdAt,
  };
}
```

### 4.2 List API Keys

```typescript
// app/actions/api-keys.ts

export async function listApiKeys() {
  const { orgId } = await auth();

  if (!orgId) {
    throw new Error('Must be in an organization');
  }

  const response = await clerkClient.apiKeys.getAll({
    subject: orgId,
  });

  return response.data.map(key => ({
    id: key.id,
    name: key.name,
    createdAt: key.createdAt,
    lastUsedAt: key.lastUsedAt,
    expiresAt: key.expiresAt,
    scopes: key.scopes,
    createdBy: key.createdBy,
  }));
}
```

### 4.3 Revoke API Key

```typescript
// app/actions/api-keys.ts

export async function revokeApiKey(keyId: string, reason?: string) {
  const { userId, orgId } = await auth();

  if (!userId || !orgId) {
    throw new Error('Unauthorized');
  }

  // Verify key belongs to this org
  const key = await clerkClient.apiKeys.get(keyId);
  if (key.subject !== orgId) {
    throw new Error('Forbidden');
  }

  await clerkClient.apiKeys.revoke({
    apiKeyId: keyId,
    revocationReason: reason,
  });

  return { success: true };
}
```

---

## 5. Webhook: Auto-Create API Key on Org Creation

### 5.1 Webhook Route

```typescript
// app/api/webhooks/clerk/route.ts

import { verifyWebhook } from '@clerk/nextjs/webhooks';
import { createClerkClient } from '@clerk/backend';
import { headers } from 'next/headers';

const clerkClient = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY!,
});

export async function POST(req: Request) {
  const headerPayload = await headers();
  const payload = await req.json();

  let event;
  try {
    event = await verifyWebhook(payload, headerPayload);
  } catch (err) {
    console.error('Webhook verification failed:', err);
    return new Response('Webhook verification failed', { status: 400 });
  }

  // Handle organization.created event
  if (event.type === 'organization.created') {
    const { id: orgId, name: orgName, created_by: createdBy } = event.data;

    try {
      // Auto-create a default API key for the new organization
      await clerkClient.apiKeys.create({
        name: 'Default API Key',
        subject: orgId,
        createdBy: createdBy,
        scopes: ['projects:read', 'exports:read'],  // Limited default scopes
      });

      console.log(`Created default API key for org: ${orgName} (${orgId})`);
    } catch (err) {
      console.error('Failed to create default API key:', err);
      // Don't fail the webhook - org creation should still succeed
    }
  }

  return new Response('OK', { status: 200 });
}
```

### 5.2 Configure Webhook in Clerk Dashboard

1. Go to Clerk Dashboard → Webhooks
2. Add endpoint: `https://yourapp.com/api/webhooks/clerk`
3. Subscribe to event: `organization.created`
4. Copy signing secret to `CLERK_WEBHOOK_SIGNING_SECRET`

---

## 6. Dashboard UI

### 6.1 Sidebar Navigation

Add to your dashboard sidebar:

```typescript
// components/dashboard/sidebar.tsx

const sidebarItems = [
  // ... existing items
  {
    name: 'API Keys',
    href: '/dashboard/api-keys',
    icon: KeyIcon,
  },
];
```

### 6.2 API Keys Page

```tsx
// app/dashboard/api-keys/page.tsx

'use client';

import { useState, useEffect } from 'react';
import { createApiKey, listApiKeys, revokeApiKey } from '@/app/actions/api-keys';

interface ApiKey {
  id: string;
  name: string;
  createdAt: Date;
  lastUsedAt?: Date;
  expiresAt?: Date;
  scopes?: string[];
}

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [newKeySecret, setNewKeySecret] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadKeys();
  }, []);

  async function loadKeys() {
    setLoading(true);
    const data = await listApiKeys();
    setKeys(data);
    setLoading(false);
  }

  async function handleCreate(formData: FormData) {
    setIsCreating(true);
    try {
      const result = await createApiKey({
        name: formData.get('name') as string,
        scopes: (formData.get('scopes') as string)?.split(',').filter(Boolean),
      });
      setNewKeySecret(result.secret);
      loadKeys();
    } finally {
      setIsCreating(false);
    }
  }

  async function handleRevoke(keyId: string) {
    if (!confirm('Are you sure? This cannot be undone.')) return;
    await revokeApiKey(keyId);
    loadKeys();
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
  }

  return (
    <div className="p-6 max-w-4xl">
      <h1 className="text-2xl font-bold mb-6">API Keys</h1>

      {/* New Key Alert */}
      {newKeySecret && (
        <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
          <p className="font-semibold text-yellow-800 mb-2">
            Save your API key now - it won't be shown again!
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 p-2 bg-white rounded border font-mono text-sm">
              {newKeySecret}
            </code>
            <button
              onClick={() => copyToClipboard(newKeySecret)}
              className="px-3 py-2 bg-yellow-600 text-white rounded hover:bg-yellow-700"
            >
              Copy
            </button>
            <button
              onClick={() => setNewKeySecret(null)}
              className="px-3 py-2 border rounded hover:bg-gray-50"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Create Form */}
      <form action={handleCreate} className="mb-8 p-4 border rounded-lg">
        <h2 className="text-lg font-semibold mb-4">Create New API Key</h2>
        <div className="grid gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Name</label>
            <input
              name="name"
              required
              placeholder="e.g., CI/CD Pipeline"
              className="w-full p-2 border rounded"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">
              Scopes (comma-separated, optional)
            </label>
            <input
              name="scopes"
              placeholder="e.g., projects:read,exports:write"
              className="w-full p-2 border rounded"
            />
          </div>
          <button
            type="submit"
            disabled={isCreating}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {isCreating ? 'Creating...' : 'Create API Key'}
          </button>
        </div>
      </form>

      {/* Keys List */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Existing Keys</h2>
        {loading ? (
          <p className="text-gray-500">Loading...</p>
        ) : keys.length === 0 ? (
          <p className="text-gray-500">No API keys yet.</p>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b">
                <th className="text-left p-2">Name</th>
                <th className="text-left p-2">Created</th>
                <th className="text-left p-2">Last Used</th>
                <th className="text-left p-2">Scopes</th>
                <th className="text-left p-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {keys.map(key => (
                <tr key={key.id} className="border-b">
                  <td className="p-2 font-medium">{key.name}</td>
                  <td className="p-2 text-gray-600">
                    {new Date(key.createdAt).toLocaleDateString()}
                  </td>
                  <td className="p-2 text-gray-600">
                    {key.lastUsedAt
                      ? new Date(key.lastUsedAt).toLocaleDateString()
                      : 'Never'}
                  </td>
                  <td className="p-2">
                    {key.scopes?.length ? (
                      <span className="text-xs bg-gray-100 px-2 py-1 rounded">
                        {key.scopes.join(', ')}
                      </span>
                    ) : (
                      <span className="text-gray-400">All</span>
                    )}
                  </td>
                  <td className="p-2">
                    <button
                      onClick={() => handleRevoke(key.id)}
                      className="text-red-600 hover:text-red-800"
                    >
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
```

---

## 7. API Authentication Middleware

### 7.1 Verify API Key in API Routes

```typescript
// lib/auth/api-key-auth.ts

import { auth } from '@clerk/nextjs/server';

export async function withApiKeyAuth(request: Request) {
  const apiKey = request.headers.get('x-api-key');

  // Path 1: API Key authentication
  if (apiKey) {
    // Clerk's auth() helper handles API key verification automatically
    // when acceptsToken is set to 'api_key'
    const { userId, orgId, has } = await auth.protect({
      acceptsToken: 'api_key',
    });

    return {
      userId,
      orgId,
      hasScope: (scope: string) => has({ scope }),
      authMethod: 'api_key' as const,
    };
  }

  // Path 2: Session authentication (browser)
  const { userId, orgId } = await auth();
  if (userId) {
    return {
      userId,
      orgId,
      hasScope: () => true,  // Full access for interactive users
      authMethod: 'session' as const,
    };
  }

  throw new Error('Unauthorized');
}
```

### 7.2 Protected API Route Example

```typescript
// app/api/projects/route.ts

import { withApiKeyAuth } from '@/lib/auth/api-key-auth';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  try {
    const { orgId, hasScope } = await withApiKeyAuth(request);

    if (!hasScope('projects:read')) {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }

    // Fetch projects for this organization
    const projects = await db.projects.findMany({
      where: { organizationId: orgId },
    });

    return NextResponse.json({ projects });
  } catch (error) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }
}
```

---

## 8. Scopes

### 8.1 Available Scopes

| Scope | Description |
|-------|-------------|
| `projects:read` | View project metadata and settings |
| `projects:write` | Create/update/delete projects |
| `exports:read` | View export history and status |
| `exports:write` | Trigger new exports |
| `assets:read` | Access project assets |
| `assets:write` | Upload/modify assets |

### 8.2 Default Scopes for Auto-Created Keys

When an organization is created, the default API key gets:
- `projects:read`
- `exports:read`

Users can create additional keys with broader scopes from the dashboard.

---

## 9. Implementation Phases

### Phase 1: Setup & Server Actions

**Tasks:**
1. Enable Organization API keys in Clerk Dashboard
2. Add `CLERK_WEBHOOK_SIGNING_SECRET` env var
3. Implement server actions: `createApiKey`, `listApiKeys`, `revokeApiKey`
4. Test key creation and listing

**Deliverables:**
- Working key CRUD operations

### Phase 2: Webhook & Auto-Creation

**Tasks:**
1. Create webhook route at `/api/webhooks/clerk`
2. Handle `organization.created` event
3. Auto-create default API key
4. Configure webhook in Clerk Dashboard
5. Test with ngrok locally

**Deliverables:**
- Auto-created key when org is created

### Phase 3: Dashboard UI

**Tasks:**
1. Add "API Keys" to dashboard sidebar
2. Create `/dashboard/api-keys` page
3. Implement key creation form
4. Implement key listing table
5. Add copy-to-clipboard for new keys
6. Add revoke confirmation flow

**Deliverables:**
- Full API key management UI

### Phase 4: API Authentication

**Tasks:**
1. Implement `withApiKeyAuth` middleware
2. Update API routes to accept API key auth
3. Implement scope checking
4. Test programmatic API access

**Deliverables:**
- API routes accept both session and API key auth

---

## 10. File Structure

```
app/
├── api/
│   ├── webhooks/
│   │   └── clerk/
│   │       └── route.ts          # Webhook handler
│   └── projects/
│       └── route.ts              # Example protected route
├── actions/
│   └── api-keys.ts               # Server actions
├── dashboard/
│   └── api-keys/
│       └── page.tsx              # API Keys management page
│
lib/
└── auth/
    └── api-key-auth.ts           # Auth middleware

components/
└── dashboard/
    └── sidebar.tsx               # Add API Keys link
```

---

## 11. Testing

### 11.1 Local Webhook Testing

```bash
# Install ngrok
brew install ngrok

# Start your dev server
npm run dev

# In another terminal, expose localhost
ngrok http 3000

# Use the ngrok URL in Clerk Dashboard webhook config
# e.g., https://abc123.ngrok.io/api/webhooks/clerk
```

### 11.2 API Key Usage Test

```bash
# Create a key via dashboard, then test:
curl -H "X-API-Key: sk_xxx" https://yourapp.com/api/projects
```

---

## 12. Security Considerations

### 12.1 Handled by Clerk

- Key hashing and secure storage
- Rate limiting
- Instant revocation
- Audit logging

### 12.2 Our Responsibilities

- Validate org membership before operations
- Implement proper scope checking
- Never log full API keys
- Show key secret only once at creation
- Verify webhook signatures

---

## 13. Error Handling

### Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `unauthorized` | 401 | No valid API key or session |
| `forbidden` | 403 | Key lacks required scope |
| `key_revoked` | 401 | API key has been revoked |
| `key_expired` | 401 | API key has expired |
| `org_required` | 400 | Must be in an organization |

### Error Response Format

```json
{
  "error": {
    "code": "forbidden",
    "message": "API key lacks required scope: projects:write"
  }
}
```

---

## References

- [Clerk API Keys Documentation](https://clerk.com/docs/guides/development/machine-auth/api-keys)
- [Clerk APIKeys SDK Reference](https://clerk.com/docs/reference/javascript/api-keys)
- [Clerk Webhooks Guide](https://clerk.com/docs/webhooks/sync-data)
- [Clerk API Keys Changelog](https://clerk.com/changelog/2025-12-11-api-keys-public-beta)

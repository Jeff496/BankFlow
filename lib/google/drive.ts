import { googleJson, type GoogleTokens } from "./fetch";

const BASE = "https://www.googleapis.com/drive/v3";

/**
 * Add a user as an editor (writer) on a file. Idempotent at the API level:
 * re-sharing to the same address doesn't 409, it just returns the existing
 * permission. `sendNotificationEmail=false` keeps things quiet for an MVP
 * that's bulk-sharing to all group members.
 */
export async function shareFile(
  tokens: GoogleTokens,
  fileId: string,
  email: string,
): Promise<void> {
  await googleJson(
    `${BASE}/files/${encodeURIComponent(fileId)}/permissions?sendNotificationEmail=false`,
    tokens,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        role: "writer",
        type: "user",
        emailAddress: email,
      }),
    },
    "drive.share",
  );
}

interface ListPermissionsResponse {
  permissions: Array<{
    id: string;
    emailAddress?: string;
    type: string;
    role: string;
  }>;
}

/**
 * Returns the email addresses already shared on a file. Used to skip re-
 * sharing on subsequent syncs and to detect members who've been removed
 * locally but still have access on the sheet (we don't auto-revoke for MVP
 * — that's a separate feature).
 */
export async function listPermissionEmails(
  tokens: GoogleTokens,
  fileId: string,
): Promise<Set<string>> {
  const data = await googleJson<ListPermissionsResponse>(
    `${BASE}/files/${encodeURIComponent(fileId)}/permissions?fields=permissions(id,emailAddress,type,role)`,
    tokens,
    {},
    "drive.list_permissions",
  );
  const emails = new Set<string>();
  for (const p of data.permissions ?? []) {
    if (p.type === "user" && p.emailAddress) {
      emails.add(p.emailAddress.toLowerCase());
    }
  }
  return emails;
}


---
name: ms365-mcp
description: "Microsoft 365 MCP workflow — login, create/upload files, manage Excel/email/calendar. Use when working with @softeria/ms-365-mcp-server for OneDrive, Outlook, Excel, or any Microsoft Graph operation."
---

# Skill: Microsoft 365 MCP (`@softeria/ms-365-mcp-server`)

Workflow for using the MS365 MCP server with Microsoft Graph API.

## When to use

- User asks to create/upload files to OneDrive
- User asks to send/read emails via Outlook
- User asks to manage calendar events
- User asks to work with Excel workbooks on OneDrive
- Any Microsoft 365 / Graph API operation

## Prerequisites

- `@softeria/ms-365-mcp-server` configured in `opencode.json` with `enabled: true`
- Microsoft account (personal or work/school)

## Workflow

### 1. Login

Always check login status first:

```typescript
ms365_verify-login()
```

If not logged in, initiate OAuth Device Code flow:

```typescript
ms365_login()
// Returns a device code. User must:
// 1. Open https://login.microsoft.com/device
// 2. Enter the code
// 3. Authenticate with Microsoft account
```

After user confirms, verify:

```typescript
ms365_verify-login()
// Should return { success: true, userData: { displayName, userPrincipalName } }
```

### 2. List available accounts (optional)

```typescript
ms365_list-accounts()
// Returns list of logged-in accounts
```

### 3. Find OneDrive drive ID

```typescript
ms365_list-drives()
// Find the drive with driveType: "personal" and name: "OneDrive"
// Save the drive ID (e.g. "48E780BF48E3C6E7")
```

### 4. Get root folder item ID

```typescript
ms365_get-drive-root-item({ driveId: "<drive-id>" })
// Save the root item ID (e.g. "48E780BF48E3C6E7!sea8cc6beffdb43d7976fbc7da445c639")
```

## Creating & Uploading Files (Critical — avoid these errors!)

### ❌ DON'T: Use `upload-file-content` for new files

```
ms365_upload-file-content({ driveId, driveItemId: "root:/test.xlsx", body: "<base64>" })
// Error: "Entity only allows writes with a JSON Content-Type header"
// The tool sends base64 as JSON body, but Graph API expects raw binary
```

### ❌ DON'T: Use `create-upload-session` with root item ID

```
ms365_create-upload-session({ driveId, driveItemId: "<root-id>", body: {...} })
// Error: "The request is malformed or incorrect."
```

### ✅ DO: Two-step process

**Step 1 — Create empty file via Graph batch:**

```typescript
ms365_graph-batch({
  body: {
    requests: [{
      id: "1",
      method: "POST",
      url: "/drives/<drive-id>/items/<root-item-id>/children",
      headers: { "Content-Type": "application/json" },
      body: {
        name: "filename.xlsx",
        file: {},
        "@microsoft.graph.conflictBehavior": "rename"
      }
    }]
  }
})
// Returns the new file's item ID (e.g. "48E780BF48E3C6E7!s044277beddcc4e7e...")
```

**Step 2 — Upload content to the new file:**

```typescript
ms365_upload-file-content({
  driveId: "<drive-id>",
  driveItemId: "<new-file-item-id>",
  body: "<base64-encoded-file-content>"
})
// This works because the file item already exists
```

### Creating the file locally first

Use `officecli_create` to generate a blank Office file:

```bash
officecli_create({ output: "/tmp/filename.xlsx" })
```

Then read as base64:

```bash
base64 -i /tmp/filename.xlsx
```

Then upload via the two-step process above.

## Working with Excel Files

### List worksheets in a workbook

```typescript
ms365_list-excel-worksheets({ driveId, driveItemId })
```

### Read a range

```typescript
ms365_get-excel-range({ driveId, driveItemId, workbookWorksheetId: "Sheet1", address: "A1:E10" })
```

### Write values to a range

```typescript
ms365_update-excel-range({
  driveId,
  driveItemId,
  workbookWorksheetId: "Sheet1",
  address: "A1:B2",
  body: { values: [["Header1", "Header2"], ["Value1", "Value2"]] }
})
```

### Get used range (find populated area)

```typescript
ms365_get-excel-used-range({ driveId, driveItemId, workbookWorksheetId: "Sheet1" })
```

## Working with Email

### List inbox messages

```typescript
ms365_list-mail-messages({
  select: "id,subject,from,receivedDateTime,bodyPreview,isRead",
  top: 10
})
```

### Send an email

```typescript
ms365_send-mail({
  body: {
    Message: {
      subject: "Subject here",
      body: { contentType: "html", content: "<p>Body here</p>" },
      toRecipients: [{ emailAddress: { address: "user@example.com" } }]
    }
  }
})
```

### Search emails (KQL)

```typescript
ms365_list-mail-messages({
  search: "\"from:someone@example.com AND subject:meeting\"",
  select: "id,subject,from,receivedDateTime"
})
```

**Important:** KQL search values MUST be wrapped in double quotes.

## Working with Calendar

### List upcoming events

```typescript
ms365_list-calendar-events({
  select: "id,subject,start,end",
  top: 10,
  orderby: "start/dateTime asc"
})
```

### Get calendar view (expanded recurring events)

```typescript
ms365_get-calendar-view({
  startDateTime: "2026-01-01T00:00:00Z",
  endDateTime: "2026-12-31T23:59:59Z",
  select: "id,subject,start,end"
})
```

### Create an event

```typescript
ms365_create-calendar-event({
  body: {
    subject: "Meeting title",
    start: { dateTime: "2026-07-20T10:00:00", timeZone: "Asia/Ho_Chi_Minh" },
    end: { dateTime: "2026-07-20T11:00:00", timeZone: "Asia/Ho_Chi_Minh" },
    attendees: [{ emailAddress: { address: "user@example.com" } }]
  }
})
```

## Common Errors & Solutions

| Error | Cause | Solution |
|-------|-------|----------|
| `No valid token found` | Not logged in | Run `ms365_login()` and follow device code flow |
| `Entity only allows writes with a JSON Content-Type header` | Uploading content to a non-existent file | Create empty file first via Graph batch, then upload |
| `Cannot upload content to an item representing a folder` | Using folder ID instead of file ID | Use the file's item ID, not the root folder ID |
| `The request is malformed or incorrect` | Wrong path/ID format for upload session | Use two-step process instead (create + upload) |
| `400 Bad Request` on batch | Body is a string instead of object | Pass body as a JSON object, not a string |
| `ConsistencyLevel: eventual` required | Advanced query on directory collections | Add `count: true` parameter to enable advanced query mode |

## Tips

- **$select** — Always use `$select` to limit fields returned. Reduces response size significantly.
- **$top** — Start with small page sizes (5-15). Use `fetchAllPages: true` only when you need everything.
- **KQL search** — Always wrap search values in double quotes: `search: "\"from:user@example.com\""`
- **Base64 on macOS** — Use `base64 -i <file>` (not `base64 <file>` which is the Linux syntax)
- **Graph batch** — Max 20 requests per batch. Use `dependsOn` for sequential operations.
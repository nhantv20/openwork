---
name: file-organizer
description: "Organize, classify, and batch-rename files. Use when user wants to auto-organize files by pattern, batch rename, classify files by type, merge markdown files, or archive files."
category: productivity
---

# File Organizer

Automatically organize, classify, and rename files in the workspace using pattern matching and rules.

## Capabilities

1. **Auto-organize**: Move files to target directories based on regex patterns
2. **Batch rename**: Rename multiple files using pattern replacement
3. **File classification**: Group files by extension, name pattern, or content
4. **File merging**: Combine multiple markdown files into one
5. **Archive**: Move old files to an archive directory

## Usage

### Auto-organize files

```typescript
const rules = [
  { pattern: "\\.md$", targetDir: "docs" },
  { pattern: "\\.ts$", targetDir: "src" },
  { pattern: "report.*", targetDir: "reports" },
];

await client.organizeWorkspaceFiles(workspaceId, rules);
```

### Batch rename

```typescript
const renames = [
  { path: "old-name.md", newName: "new-name.md" },
  { path: "file-v1.txt", newName: "file-v2.txt" },
];

await client.batchRenameWorkspaceFiles(workspaceId, renames);
```

### File merging

When merging markdown files, read each file's content and combine them:

```typescript
const filesToMerge = ["intro.md", "chapter1.md", "chapter2.md"];
const merged = filesToMerge.map(f => `# ${f}\n\n${content}`).join("\n\n---\n\n");
```

## Best Practices

1. **Always preview before acting**: Show the user what will happen before making changes
2. **Use descriptive patterns**: Make regex patterns clear and explain what they match
3. **Handle conflicts**: Check for existing files before moving/renaming
4. **Backup important files**: Archive instead of deleting when uncertain
5. **Batch operations**: Group similar operations for efficiency

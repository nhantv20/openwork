# Build & Deploy OpenWork (macOS + Windows)

## Yêu cầu máy build

| Công cụ | macOS | Windows |
|----------|-------|---------|
| Node.js 24 | ✅ | ✅ |
| pnpm 11.4.0 | ✅ | ✅ |
| Bun >= 1.3.10 | ✅ | ✅ |
| Visual Studio Build Tools | ❌ | ✅ |
| Xcode CLI tools | ✅ | ❌ |

## Build

### 1. Clone & cài dependencies

```bash
git clone https://github.com/nhantv20/openwork.git
cd openwork
pnpm install --frozen-lockfile
```

### 2. Build installer

**macOS:**
```bash
pnpm --filter @openwork/desktop package:electron
```
→ File ở `apps/desktop/dist-electron/openwork-mac-arm64-0.17.7.dmg`

**Windows:**
```bash
pnpm --filter @openwork/desktop package:electron
```
→ File ở `apps/desktop/dist-electron/openwork-win-x64-0.17.7.exe`

---

## Cài đặt trên máy mới

### Bước 1: Cài OpenWork

**macOS:** Mở file `.dmg` → kéo OpenWork vào Applications

**Windows:** Chạy file `.exe` → next → finish

### Bước 2: Mở app lần đầu

- macOS: Có thể bị chặn vì không có chữ ký Apple. Vào **System Settings → Privacy & Security** → click **Open Anyway**
- Windows: Windows Defender có thể cảnh báo. Click **More info → Run anyway**

### Bước 3: Cấu hình FPT Cloud AI

Sau khi app mở lên:

1. **Settings → Environment**
2. Click **+ Add variable**
3. Thêm 2 biến:

| Key | Value | Bắt buộc |
|-----|-------|----------|
| `FPT_API_KEY` | `sk-...` (key thật) | ✅ |
| `FPT_CONFIG` | `{ "models": { ... } }` | ❌ (tuỳ chọn) |

4. Click **Apply Changes**

### Bước 4: Dùng

Mở session → model picker → chọn **FPT Cloud** → **Qwen3.6-27B** hoặc **DeepSeek-V4-Flash**

---

## Lưu ý

- **Không cần** tạo file `~/.config/opencode/opencode.json` — app tự đọc từ Environment Variables
- **Không cần** cài Node.js / pnpm / Bun trên máy người dùng
- Mỗi lần đổi key hoặc model, vào **Settings → Environment** sửa → **Apply Changes**

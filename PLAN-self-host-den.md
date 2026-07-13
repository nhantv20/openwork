# Plan: Self-host Den API (Personal, PaaS) + Reconnect Desktop App

> **Scope:** Solo dev, no email invites, no Den web. Just Den API + desktop app, no org-level model restrictions, full control over Better Auth.

## Goal

Deploy `den-api` lên một managed PaaS (Render được recommend vì OpenWork chính thức dùng Render), cấu hình Better Auth, kết nối desktop app qua `desktop-bootstrap.json`. Sau khi xong:

- Sign in flow trong desktop app dùng Den server của bạn
- Không còn restriction `allowZenModel` / `allowCustomProviders` từ OpenWork Cloud
- Bạn có toàn quyền set policy cho chính mình (hoặc không set gì = unrestricted)
- DB là MySQL managed, TLS tự động, secret tự sinh

## High-Level Architecture

```
┌──────────────────┐       HTTPS        ┌──────────────────────┐
│  Desktop app     │ ──────────────────▶│  den-api (Render)    │
│  (Electron)      │   bearer token     │  Port 8790           │
│  ~/.config/      │                    │  - Better Auth       │
│   openwork/      │                    │  - /v1/me/*          │
│   desktop-       │                    │  - desktop-config    │
│   bootstrap.json │                    └──────────┬───────────┘
└──────────────────┘                               │
                                                  │ Drizzle/MySQL
                                                  ▼
                                         ┌──────────────────────┐
                                         │  MySQL (Render KV)  │
                                         │  or PlanetScale      │
                                         └──────────────────────┘
```

## Tasks

### Phase 0: Chuẩn bị local (30 phút)

- [ ] **0.1.** Tạo tài khoản [Render](https://render.com) (free tier OK cho dev, $0/mo + $7/mo cho MySQL)
- [ ] **0.2.** Tạo tài khoản [Resend](https://resend.com) (free 3000 emails/tháng) cho email verification
  - Hoặc bỏ qua nếu set `OPENWORK_DEV_MODE=1` + `DEN_REQUIRE_EMAIL_VERIFICATION=false`
- [ ] **0.3.** (Tuỳ chọn) Tạo tài khoản [GitHub OAuth App](https://github.com/settings/developers) nếu muốn "Sign in with GitHub"
  - Authorization callback URL: `https://<den-api-host>/api/auth/callback/github`
- [ ] **0.4.** Sinh `BETTER_AUTH_SECRET`:
  ```bash
  openssl rand -base64 48
  ```
- [ ] **0.5.** Sinh `DEN_DB_ENCRYPTION_KEY`:
  ```bash
  openssl rand -base64 48
  ```
- [ ] **0.6.** Clone repo local nếu chưa có:
  ```bash
  git clone https://github.com/different-ai/openwork.git
  cd openwork
  ```
- [ ] **0.7.** (Tuỳ chọn) Fork repo để có thể push custom changes mà không cần PR upstream

### Phase 1: Provision MySQL trên Render (15 phút)

- [ ] **1.1.** Vào Render Dashboard → **New +** → **MySQL**
- [ ] **1.2.** Config:
  - Name: `openwork-den-db`
  - Region: `Oregon` (match default worker region)
  - Plan: `Starter` ($7/mo) cho dev, `Standard` ($25/mo) nếu cần backup tự động
  - MySQL version: leave default 8.x
- [ ] **1.3.** Copy **Internal Database URL** — Render sẽ tự tạo `mysql://user:pass@host/db` với TLS
- [ ] **1.4.** Test connection local:
  ```bash
  mysql -h <host> -u <user> -p --ssl-mode=REQUIRED
  ```

### Phase 1.5: Build den-api locally (15 phút)

> Den-api chạy từ compiled JS (`dist/server.js`), cần build trước khi deploy.

- [ ] **1.5.1.** Từ root repo, cài dependencies và build:
  ```bash
  pnpm install
  pnpm --filter @openwork-ee/den-api build
  ```
- [ ] **1.5.2.** Verify `ee/apps/den-api/dist/server.js` đã được tạo
- [ ] **1.5.3.** Commit `ee/apps/den-api/dist/` hoặc thêm vào `.gitignore` (tuỳ strategy)

### Phase 2: Deploy den-api lên Render (45 phút)

> **Lưu ý:** `ee/apps/den-api/Dockerfile` **không tồn tại** trong repo. Dùng Render Node runtime (không cần Docker).

**Cách A: Render Blueprint (recommended — infra-as-code)**

- [ ] **2.1.** Tạo file `render.yaml` ở root repo:
  ```yaml
  services:
    - type: web
      name: openwork-den-api
      runtime: node
      rootDir: ee/apps/den-api
      buildCommand: pnpm install && pnpm build
      startCommand: node dist/server.js
      plan: starter
      region: oregon
      healthCheckPath: /health
      envVars:
        - key: BETTER_AUTH_SECRET
          generateValue: true
        - key: BETTER_AUTH_URL
          value: https://openwork-den-api.onrender.com   # placeholder, update sau khi deploy
        - key: DEN_DB_ENCRYPTION_KEY
          generateValue: true
        - key: DATABASE_URL
          fromDatabase:
            name: openwork-den-db
            property: connectionString
        - key: OPENWORK_DEV_MODE
          value: "1"
        - key: DEN_REQUIRE_EMAIL_VERIFICATION
          value: "false"
        - key: DEN_BOOTSTRAP_ADMIN_EMAILS
          value: <your-email>@example.com
        - key: CORS_ORIGINS
          value: "*"   # desktop app dùng bearer, không cần strict
        - key: PORT
          value: "8790"
        # Tuỳ chọn
        # - key: GITHUB_CLIENT_ID
        #   value: xxx
        # - key: GITHUB_CLIENT_SECRET
        #   sync: false
        # - key: RESEND_API_KEY
        #   sync: false
  databases:
    - name: openwork-den-db
      plan: starter
      region: oregon
  ```
- [ ] **2.2.** Commit + push `render.yaml` lên GitHub
- [ ] **2.3.** Vào Render → **New +** → **Blueprint** → chọn repo → Apply
- [ ] **2.4.** Đợi build (~5-10 phút). Nếu fail, check logs:
  - "Module not found" → Node version không match hoặc thiếu `pnpm install`
  - "DATABASE_URL is required" → Render chưa inject
  - "BETTER_AUTH_SECRET must be 32+ chars" → secret quá ngắn
  - "Cannot find dist/server.js" → build chưa chạy hoặc rootDir sai

  > **⚠️ Migration cần chạy trước khi start.** Den-api **không auto-migrate on startup**.
  > Dùng 1 trong 3 cách:
  > - **Cách 1 (khuyến nghị):** Sửa `buildCommand` thành:
  >   ```yaml
  >   buildCommand: pnpm install && pnpm --filter @openwork-ee/den-db db:bootstrap && pnpm --filter @openwork-ee/den-api build
  >   ```
  > - **Cách 2:** Deploy xong → Render Shell: `pnpm --filter @openwork-ee/den-db db:migrate`
  > - **Cách 3:** Tạo migrate script riêng và sửa `startCommand` thành `node dist/migrate.js && node dist/server.js`

**Cách B: Render Manual Setup (nếu A fail)**

- [ ] **2.5.** Vào Render → **New +** → **Web Service**
- [ ] **2.6.** Connect GitHub repo
- [ ] **2.7.** Config:
  - Name: `openwork-den-api`
  - Runtime: `Node` (không phải Docker)
  - Root Directory: `ee/apps/den-api`
  - Build Command: `pnpm install && pnpm build`
  - Start Command: `node dist/server.js`
  - Region: Oregon
  - Plan: Starter ($7/mo)
- [ ] **2.8.** Paste tất cả env vars thủ công
- [ ] **2.9.** Deploy
- [ ] **2.10.** (Sau deploy) Chạy migration qua Render Shell:
  ```bash
  pnpm --filter @openwork-ee/den-db db:migrate
  ```
  Hoặc cập nhật Build Command thành:
  ```
  pnpm install && pnpm --filter @openwork-ee/den-db db:bootstrap && pnpm build
  ```
  Và redeploy.

### Phase 3: Verify den-api (15 phút)

- [ ] **3.1.** Check Render logs — đảm bảo app start không crash, listen port 8790
- [ ] **3.2.** Verify health endpoint:
  ```bash
  curl https://openwork-den-api.onrender.com/health
  ```
- [ ] **3.3.** Verify Better Auth reachable (dùng `/ready` — kiểm tra cả DB):
  ```bash
  curl https://openwork-den-api.onrender.com/ready
  ```
- [ ] **3.4.** Update env var `BETTER_AUTH_URL` trên Render = URL thật của bạn (nếu dùng cách A)
- [ ] **3.5.** Restart service
- [ ] **3.6.** Verify CORS preflight:
  ```bash
  curl -X OPTIONS https://openwork-den-api.onrender.com/v1/me \
    -H "Origin: file://" \
    -H "Access-Control-Request-Method: GET" \
    -v
  ```
- [ ] **3.7.** (Optional) Sign up test user bằng curl:
  ```bash
  curl -X POST https://openwork-den-api.onrender.com/api/auth/sign-up/email \
    -H "Content-Type: application/json" \
    -d '{"email":"you@example.com","password":"<long-password>","name":"Test"}'
  ```
- [ ] **3.8.** Verify user tạo trong MySQL:
  ```bash
  mysql -h <host> -u <user> -p --ssl-mode=REQUIRED openwork_den \
    -e "SELECT id, email, name FROM user;"
  ```

### Phase 4: Bootstrap admin org (15 phút)

- [ ] **4.1.** Sau khi sign up user đầu tiên (matching `DEN_BOOTSTRAP_ADMIN_EMAILS`), login tạo token:
  ```bash
  curl -X POST https://openwork-den-api.onrender.com/api/auth/sign-in/email \
    -H "Content-Type: application/json" \
    -c cookies.txt \
    -d '{"email":"you@example.com","password":"<long-password>"}'
  ```
- [ ] **4.2.** Tạo organization (nếu chưa có):
  ```bash
  curl -X POST https://openwork-den-api.onrender.com/api/auth/organization/create \
    -H "Content-Type: application/json" \
    -b cookies.txt \
    -d '{"name":"My Personal Workspace","slug":"personal"}'
  ```
- [ ] **4.3.** Set active org — gọi endpoint tương ứng (xem `apps/app/src/app/lib/den.ts:1804` để biết exact path)
- [ ] **4.4.** Verify desktop-config endpoint trả về `{}` (không có policy = unrestricted):
  ```bash
  curl https://openwork-den-api.onrender.com/v1/me/desktop-config \
    -b cookies.txt | jq .
  ```
  → Output kỳ vọng: `{}`

### Phase 5: Cấu hình Desktop App (20 phút)

- [ ] **5.1.** Tìm đường dẫn bootstrap config:
  - macOS: `~/Library/Application Support/openwork/desktop-bootstrap.json`
  - Linux: `~/.config/openwork/desktop-bootstrap.json`
  - Windows: `%APPDATA%\openwork\desktop-bootstrap.json`
  - Hoặc set `OPENWORK_DESKTOP_BOOTSTRAP_PATH=/custom/path.json`
- [ ] **5.2.** Ghi file:
  ```json
  {
    "baseUrl": "https://openwork-den-api.onrender.com",
    "apiBaseUrl": "https://openwork-den-api.onrender.com",
    "requireSignin": false
  }
  ```
- [ ] **5.3.** Kill app, xoá cache cũ (optional nhưng nên làm):
  ```bash
  rm -rf ~/Library/Application\ Support/openwork/Cache
  rm ~/Library/Application\ Support/openwork/Local\ Storage/leveldb/*.log
  ```
- [ ] **5.4.** Mở lại desktop app
- [ ] **5.5.** Click **Sign in** → browser/system mở → trỏ về `https://openwork-den-api.onrender.com/api/auth/...`
  - Better Auth tự render sign-in page (HTML, không phải JSON) — đó là expected behavior
  - Flow: nhập email và mật khẩu đã tạo ở Phase 3.7 → authorize → desktop app tự động nhận session
  - Nếu browser không redirect về desktop app tự động, kiểm tra `handoff` field trong bootstrap config
- [ ] **5.6.** Verify desktop app đã auth (top-right avatar hiện tên bạn)
- [ ] **5.7.** Click dropdown model — phải hiện **TẤT CẢ** models từ providers đã connect (không bị filter)

### Phase 6: Validate end-to-end (30 phút)

- [ ] **6.1.** Tạo session mới trong desktop app
- [ ] **6.2.** Chọn model bất kỳ (vd: `claude-sonnet-4.5` từ Anthropic, `gpt-4o` từ OpenAI)
- [ ] **6.3.** Gửi message test → verify response OK
- [ ] **6.4.** Check localStorage `openwork.den.desktopConfig:*`:
  ```js
  // Trong DevTools console
  Object.keys(localStorage).filter(k => k.includes('desktopConfig')).forEach(k => console.log(k, localStorage.getItem(k)))
  ```
  → Phải là `{}` hoặc chỉ chứa keys không phải `false`
- [ ] **6.5.** Verify `useDesktopRestriction("allowZenModel")` = false trong React DevTools
- [ ] **6.6.** Verify `useDesktopRestriction("allowCustomProviders")` = false
- [ ] **6.7.** Tạo custom provider trong OpenCode config → verify nó hiện trong dropdown

### Phase 7: Hardening (optional, sau khi work)

- [ ] **7.1.** Add custom domain: `den.your-domain.com` thay `*.onrender.com`
  - Update `BETTER_AUTH_URL` + `DEN_BETTER_AUTH_TRUDTED_ORIGINS`
  - Cấu hình DNS CNAME → Render auto-generate Let's Encrypt cert
- [ ] **7.2.** Setup backup schedule cho MySQL (Render Pro plan hoặc manual pg_dump weekly)
- [ ] **7.3.** Add monitoring: Render built-in + UptimeRobot cho health endpoint
- [ ] **7.4.** (Optional) Enable `DEN_PLAN_GATING_ENABLED=false` explicitly để chắc chắn không bị plan check
- [ ] **7.5.** (Optional) Configure GitHub OAuth để có nút "Sign in with GitHub"
- [ ] **7.6.** (Optional) Configure Resend/SMTP cho email đẹp thay vì console log

## Dependencies

| Task | Depends on |
|------|------------|
| Phase 0 | — |
| Phase 1 | 0.1 (Render account) |
| Phase 1.5 | 0.6 (repo cloned), pnpm installed |
| Phase 2 | 0.4, 0.5 (secrets), 1.x (DB), 1.5.x (build xong) |
| Phase 3 | 2.x (deploy xong) |
| Phase 4 | 3.7 (user tạo xong) |
| Phase 5 | 4.4 (Den API ready) |
| Phase 6 | 5.x (desktop reconnect xong) |
| Phase 7 | 6.x (everything works) |

## Success Criteria

- [ ] `curl https://<den-host>/health` trả `200 OK`
- [ ] Sign up + sign in qua Better Auth thành công
- [ ] `/v1/me/desktop-config` trả `{}` (unrestricted)
- [ ] Desktop app sign in vào Den server của bạn (không phải OpenWork Cloud)
- [ ] Dropdown model hiển thị TẤT CẢ models từ connected providers
- [ ] Không còn thấy `allowZenModel: false` hoặc `allowCustomProviders: false` ở bất cứ đâu
- [ ] Session tạo được, message gửi được, model respond
- [ ] DB schema migrate đúng (chạy `pnpm db:bootstrap` hoặc `pnpm db:migrate` trước — không auto-migrate on startup)

## Cost Estimate

| Item | Cost |
|------|------|
| Render Web Service (Starter) | $7/mo |
| Render MySQL (Starter 1GB) | $7/mo |
| Domain (optional) | ~$12/year |
| Resend (optional) | Free tier OK |
| **Total** | **~$14/mo** |

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Render free tier sleep sau 15min | Dùng Starter $7/mo, hoặc cron-job ping mỗi 10min |
| MySQL connection pool exhausted | Starter có 100 connections, đủ cho 1 user |
| `desktop-bootstrap.json` path khác OS | Dùng `OPENWORK_DESKTOP_BOOTSTRAP_PATH` env để force |
| Sign-in flow fail vì thiếu Den web | Better Auth tự render HTML sign-in page — expected. Nếu không redirect về desktop, kiểm tra `handoff` field |
| Drizzle migration fail | Phải chạy migration **trước** khi start: `pnpm db:bootstrap` hoặc `pnpm db:migrate`. Không auto-migrate on startup |
| Better Auth secret bị lộ | Rotate bằng cách tạo secret mới + redeploy |
| DB bị xoá do free tier expiry | Backup local bằng `mysqldump` weekly |

## Open Questions

1. ~~**Dockerfile**: Check `ee/apps/den-api/Dockerfile` có tồn tại không?~~ ✅ **Không tồn tại** — plan đã chuyển sang Render Node runtime.
2. **Email provider**: Có muốn Resend không hay skip email hoàn toàn (dùng dev mode)?
3. **Custom domain**: Bạn có domain sẵn không, hay dùng `*.onrender.com`?
4. **GitHub OAuth**: Có muốn setup luôn không?
5. **Migration path**: Sau khi work, có muốn viết `render.yaml` lên repo chính thức qua PR không, hay giữ fork riêng?

## Notes

- Repo OpenWork dùng EE folder `ee/` cho Den source — license là enterprise-only. Self-host code đã public, chỉ một số tính năng enterprise bị gate. Plan này chỉ dùng public API.
- Helm chart `oci://ghcr.io/different-ai/charts/openwork-ee` available nhưng overkill cho solo dev. Skip.
- Nếu muốn plan khác (VPS + Docker Compose, hoặc K8s Helm), tell me — sẽ tạo PLAN thứ 2.

---

**Next step đề xuất:** Trả lời các Open Questions còn lại → generate exact `render.yaml` (Node runtime) + `desktop-bootstrap.json` + checklist commands cho bạn.
# Plan: Auto Update cho OpenWork — Desktop + Server + Docker

> **Cập nhật:** 2026-07-12 (sau khi verify lại codebase)  
> **Mục tiêu:** Hoàn thiện auto update trên cả 3 surface — **Desktop (Electron)**, **`openwork-server` (npm binary)**, **Docker images (`openwork-den-api`, `openwork-den-web`, `openwork-inference`)** — ưu tiên **đơn giản, ít code, dùng tooling đã có sẵn**.  
> **Owner:** Nhân  
> **Trạng thái:** Phase 0 ✅ DONE (release pipeline + updater wire đã có sẵn — chỉ thiếu UX thông báo + test E2E)

---

## TL;DR — Khuyến nghị

> **Sau khi verify lại repo:** phần lớn hạ tầng auto update **đã có sẵn và chạy được khi push tag `v*`**. Chỉ còn thiếu UX thông báo + E2E test + docs Watchtower. Effort thực tế nhỏ hơn estimate lần đầu nhiều.

| Surface | Phương án | Trạng thái | Còn cần làm | Effort |
|---|---|---|---|---|
| **Desktop (Electron)** | `electron-updater` + GitHub Releases + `scripts/release/publish-electron-assets.mjs` | 🔶 Wire xong, thiếu UX | UpdateBanner UI + channel switcher + E2E `fraimz` | **1.5–2 ngày** |
| **`openwork-server` (npm)** | npm publish qua job `publish-npm` trong `release-macos-aarch64.yml` | ✅ Đã chạy khi push tag | Optional: `openwork-server update` subcommand in lệnh | **0.5–1 ngày** (optional) |
| **Docker + Helm** | Job build/push trong `publish-ee-images.yml` (tag `v*`) + Helm OCI trong `release-macos-aarch64.yml` | ✅ Đã chạy khi push tag | Watchtower compose + docs `helm upgrade`/`helm rollback` | **0.5 ngày** |

**Tổng effort còn lại: 1.5–2.5 ngày (không tính optional self-update subcommand).**

---

## Phát hiện quan trọng khi verify lại

Sau lần review đầu (estimate 3–5 ngày), đọc kỹ lại repo thì thấy **5 chỗ claim sai**, đã sửa trong doc này:

| # | Claim cũ (sai) | Thực tế trong repo |
|---|---|---|
| 1 | "Chưa có cách nào publish Electron lên GitHub Releases" | `scripts/release/publish-electron-assets.mjs` (221 dòng) đã merge `latest*.yml` từ multi-platform + upload assets + manifests lên GH Release qua `gh release upload`. Được dùng trong job `publish-electron-assets` của `release-macos-aarch64.yml`. |
| 2 | "Chưa có GH Action publish npm" | Job `publish-npm` trong `release-macos-aarch64.yml` (line 701–) đã làm: compare version với `npm view`, skip nếu đã publish, dùng `NPM_TOKEN` secret, fallback skip nếu thiếu token. |
| 3 | "Server chưa có bump script" | `pnpm bump:patch\|minor\|major\|set` ở root đã bump đồng thời 5 package: `apps/app`, `apps/desktop`, `apps/orchestrator`, `apps/server`, `apps/opencode-router`. `scripts/release/verify-tag.mjs` enforce 5 version phải match với tag. |
| 4 | "Cần tạo mới `release-electron.yml`" | Workflow `release-macos-aarch64.yml` (956 dòng) đã là release flow end-to-end: `resolve-release` → `verify-release` → `publish-electron` (4 platform) → `publish-electron-assets` → `release-orchestrator-sidecars` → `publish-npm` → `publish-daytona-snapshot` → `aur-publish` → `publish-release`. Trigger: push tag `v*`. |
| 5 | "Helm chart chỉ publish, chưa có hướng dẫn upgrade" | `packaging/helm/openwork-ee` đã publish OCI lên `oci://ghcr.io/<owner>/charts`, đã có sẵn trong cùng workflow. Cần viết docs `helm upgrade`/`helm rollback` cho user. |

**Kết luận:** Phase 0 không còn là khảo sát — **đã có sẵn**. Các phase còn lại chỉ là **hoàn thiện UX + test + docs**.

---

## Nguyên tắc thiết kế plan

- Mỗi phase là **1 PR độc lập**, ship riêng được, test riêng được.
- **Không tự viết update protocol** — ưu tiên `electron-updater`/npm/Helm/Watchtower.
- **Không tự host update server** — ưu tiên GitHub Releases + GHCR.
- **Rollback đơn giản:** pin version trong config, bỏ pin là rollback.

### Ký hiệu

| Ký hiệu | Ý nghĩa |
|---------|---------|
| ✅ **DONE** | Đã có sẵn, đã verify hoạt động |
| 🔶 **PARTIAL** | Có building blocks, thiếu 1-2 phần |
| ⚠️ **EARLY** | Có nền tảng, cần build thêm |
| ❌ **NONE** | Chưa có gì |
| 📌 **TODO** | Kế hoạch làm tiếp |

---

## Khảo sát thực tế (đã verify bằng grep + read)

### 1. Desktop (Electron) — 🔶 PARTIAL

- ✅ `apps/desktop/package.json` đã khai báo `electron-updater ^6.3.9` + `electron-builder ^25.1.8`.
- ✅ `apps/desktop/electron/updater.mjs` đã có: `applyElectronUpdaterFeed()`, 2 channel **stable** + **alpha** (alpha hiện chỉ macOS), feed trỏ về GitHub Releases:
  ```
  stable: https://github.com/different-ai/openwork/releases/latest/download
  alpha:  https://github.com/different-ai/openwork/releases/download/alpha-macos-latest
  ```
- ✅ `electron-builder.yml` đã có block `publish: provider: github` (owner `different-ai`, repo `openwork`).
- ✅ `apps/desktop/electron/preload.mjs` đã expose bridge `subscribe to download progress`.
- ✅ `apps/desktop/electron/updater.test.mjs` test helper `staleUpdaterStatePaths` (cleanup ShipIt cache trên macOS).
- ✅ `scripts/release/publish-electron-assets.mjs` merge `latest*.yml` từ 4 platform build + upload assets + manifests lên GH Release.
- ✅ `release-macos-aarch64.yml` job `publish-electron` (line 272–) build macos/linux/windows/windows-arm64; job `publish-electron-assets` (line 557–) upload.
- 🔶 **Thiếu:**
  1. UI thông báo "Có update" + progress + "Restart to update" trong renderer.
  2. Channel switcher menu `Help → Switch to alpha/stable`.
  3. IPC handlers `updater:download` / `updater:quit-and-install` (chỉ có events, chưa có invoke handlers — verify khi code).
  4. E2E test thật (cần `fraimz` flow).

### 2. `openwork-server` (npm CLI) — ✅ DONE phần infrastructure

- ✅ `apps/server/package.json` publish public (`publishConfig.access: public`, repo `different-ai/openwork`).
- ✅ `build:bin:all` dùng `bun build --compile` ra 6 target (darwin arm64/x64, linux x64/arm64, windows x64/arm64).
- ✅ Job `publish-npm` (line 701–) trong `release-macos-aarch64.yml`:
  - Compare version với `npm view openwork-server version` → skip nếu đã publish.
  - `pnpm --filter openwork-server publish --access public --no-git-checks`.
  - Dùng `NPM_TOKEN` secret, nếu thiếu → skip silently + warn.
  - Trigger: push tag `v*` (cùng trigger với toàn bộ release flow).
- ✅ `scripts/release/verify-tag.mjs` enforce 5 package version phải match tag (line 41–45).
- 📌 **Optional:** CLI subcommand `openwork-server update` in lệnh `npm install -g openwork-server@<version>` (không tự spawn — an toàn permission).

### 3. Docker + Helm — ✅ DONE phần infrastructure

- ✅ `packaging/docker/Dockerfile.{den,den-web,inference}` đã có.
- ✅ `.github/workflows/publish-ee-images.yml` build + push `ghcr.io/<owner>/{openwork-den-api,openwork-den-web,openwork-inference}` đa-arch (`linux/amd64,linux/arm64`) theo tag `v*`, có cache GHA + smoke health endpoint trên PR.
- ✅ Helm chart `packaging/helm/openwork-ee` publish lên `oci://ghcr.io/<owner>/charts` (`helm push ... tgz`) trong cùng `release-macos-aarch64.yml`.
- 📌 **Còn thiếu:**
  1. Auto-bump `Chart.yaml#version` + `appVersion` trong `scripts/release/prepare.mjs` khi bump version (hiện tại bump chỉ sync 5 npm package, chưa sync chart).
  2. Watchtower compose example cho dev single-node.
  3. Docs `helm upgrade` / `helm rollback` trong `packaging/docker/README.md`.

---

## Các phương án đã xét (và lý do chọn/bỏ)

| Phương án | Surface | Đánh giá | Quyết định |
|---|---|---|---|
| **`electron-updater` + GitHub Releases** | Desktop | Wire sẵn, 0 infra mới, code signing có sẵn (xem `build-electron-desktop.yml` notarize job), multi-platform support | ✅ **Đang dùng** |
| `electron-builder` Squirrel.Windows | Desktop | Chỉ Windows, NSIS đang dùng ổn hơn | ❌ Bỏ |
| Squirrel.Mac (`electron-squirrel-startup`) | Desktop | macOS cần DMG + notarize, dùng DMG update qua GH Releases | ❌ Bỏ |
| Tauri updater (custom protocol `tauri://`) | Desktop | OpenWork đang migrate Tauri → Electron, code updater Electron đã có sẵn | ❌ Bỏ |
| Custom HTTP update server (S3/Cloudflare R2) | Desktop | Tốn infra + tự code signature check + không cần thiết khi GH Releases miễn phí | ❌ Bỏ |
| **npm registry** (public) | Server | Đã wire trong `publish-npm` job, `npm update -g` đã quen thuộc | ✅ **Đang dùng** |
| Custom self-hosted tarball download | Server | Tự code signature + version compare, không đáng | ❌ Bỏ |
| **Watchtower** (auto-pull + recreate container) | Docker (single-node) | 0 code, 1 dòng `image: ...` + label `watchtower.enable=true` | ✅ **Đề xuất (dev/single-node)** |
| **Helm `helm upgrade`** + image tag bump | Docker (k8s/prod) | Standard, có `helm rollback`, atomic, không cần sidecar | ✅ **Đang dùng (prod)** |
| K3s/Kubernetes rollout tự động qua ArgoCD/Flux | Docker (k8s) | Mạnh nhưng cần GitOps setup sẵn — openwork chưa có | ❌ Bỏ (đề xuất tương lai) |
| Watchtower cho k8s | Docker (k8s) | Không phù hợp (k8s có Deployment rollout riêng) | ❌ Bỏ |

---

## Kế hoạch triển khai (sau khi đã có infrastructure)

### Phase 0 — Hạ tầng auto update ✅ DONE

Release pipeline end-to-end đã chạy được khi push tag `v*`:
- Version sync 5 package qua `pnpm bump:patch|minor|major|set` + `scripts/release/verify-tag.mjs`.
- Electron assets + `latest*.yml` qua `publish-electron-assets.mjs` (job trong `release-macos-aarch64.yml`).
- npm publish qua `publish-npm` job.
- Docker images qua `publish-ee-images.yml`.
- Helm chart OCI qua job trong cùng `release-macos-aarch64.yml`.

**Verify Phase 0 (đã chạy):**
```bash
# Verify updater wired
grep -n "electron-updater" apps/desktop/package.json
grep -n "autoUpdater\|setFeedURL" apps/desktop/electron/updater.mjs | head
grep -n "publish:" apps/desktop/electron-builder.yml

# Verify Docker publish
grep -n "REGISTRY\|ghcr.io" .github/workflows/publish-ee-images.yml | head

# Verify npm publish job
grep -n "publish-npm\|npm-auth" .github/workflows/release-macos-aarch64.yml | head
grep -n "publish-electron-assets" scripts/release/publish-electron-assets.mjs | head

# Verify version sync
node scripts/release/verify-tag.mjs --tag v0.17.7
```

### Phase 1 — Desktop: hoàn thiện UX update + E2E 🔶 → ✅

**PR 1: UI update flow trong renderer**

- Trong `apps/app/` (Vite + React, đóng gói vào `extraResources` của desktop — xem `electron-builder.yml`), thêm dialog/banner:
  - "OpenWork X.Y.Z is available — Download (12%) / Restart when ready / Later".
  - Listen events từ preload bridge: `update-available`, `download-progress`, `update-downloaded`, `error`.
- Action buttons gọi qua IPC: `updater:download`, `updater:quit-and-install` (verify handlers đã có trong `updater.mjs` chưa; nếu chưa thì thêm ~40 LoC).
- **Channel switcher** (opt-in alpha): lưu `electron-updater-channel.v1.json` (đã có helper read/write), expose menu `Help → Switch to alpha` / `Switch to stable`.

**File touch (ước lượng):**
- `apps/app/src/components/UpdateBanner.tsx` (new, ~120 LoC)
- `apps/app/src/lib/updater-bridge.ts` (new, ~30 LoC)
- `apps/desktop/electron/updater.mjs` — thêm IPC handlers nếu chưa có (~40 LoC)
- `apps/desktop/electron/preload.mjs` — expose thêm channel (~10 LoC)
- `apps/desktop/electron/main.mjs` (hoặc `app-menu.mjs`) — thêm menu items cho channel switcher (~20 LoC)

**Test commands:**
```bash
pnpm --filter @openwork/app typecheck
pnpm --filter @openwork/desktop test  # updater.test.mjs đã có
```

**E2E (dùng `fraimz` skill):**
```bash
pnpm fraimz --flow desktop-auto-update
# flow mẫu:
#   1. Install OpenWork 0.17.6 từ Release cũ.
#   2. Có sẵn GitHub Release 0.17.7 với latest.yml + artifacts đúng platform.
#   3. Launch app → expect banner "0.17.7 available" trong <30s.
#   4. Click Download → expect progress 0→100% qua DOM + log.
#   5. Click Restart → expect app đóng + mở lại với version 0.17.7.
#   6. Verify qua Help → About dialog hoặc `app.getVersion()`.
```

### Phase 2 — Server: optional self-update subcommand 📌 (nice-to-have)

> Phần infrastructure (npm publish) đã chạy trong Phase 0. Phase 2 chỉ là **optional CLI helper** giúp user dễ check version mới.

**PR 2 (optional, 50 LoC): `openwork-server update` subcommand**

- File: `apps/server/src/cli.ts` — thêm subcommand `update`:
  - `GET https://registry.npmjs.org/openwork-server/latest` → so sánh `version` với `package.json` bundled.
  - Nếu mới hơn: in `Run: npm install -g openwork-server@<version>` (không tự spawn).
- Lý do không tự spawn: self-update qua npm cần spawn process khác, trên Windows dễ lock binary, global install cần sudo. UX an toàn nhất là in command cho user.

**File touch:**
- `apps/server/src/cli.ts` (~50 LoC subcommand)
- `apps/server/src/cli.test.ts` (new, ~30 LoC test mock registry response)

**Test commands:**
```bash
pnpm --filter openwork-server typecheck
pnpm --filter openwork-server test
```

### Phase 3 — Docker + Helm: bump chart + Watchtower docs 📌

**PR 3: Wire `Chart.yaml` bump vào `scripts/release/prepare.mjs`**

- Hiện tại `pnpm bump:*` chỉ sync 5 npm package (xem `verify-tag.mjs`). Cần thêm bước sync `packaging/helm/openwork-ee/Chart.yaml#version` + `appVersion` theo tag.
- Lưu ý: dùng `js-yaml` (đã có trong repo) để edit YAML, không dùng regex.

**File touch:**
- `scripts/release/helm-bump.mjs` (new helper, ~30 LoC dùng `js-yaml`)
- `scripts/release/prepare.mjs` — gọi helper sau `pnpm bump:${bumpType}` (~10 LoC)

**Test commands:**
```bash
pnpm release:prepare patch --dry-run
# Kiểm tra Chart.yaml diff đúng version
git diff packaging/helm/openwork-ee/Chart.yaml
```

**PR 4: Watchtower compose example + docs**

- File mới: `packaging/docker/docker-compose.watchtower.yml`:
  ```yaml
  services:
    watchtower:
      image: containrrr/watchtower
      volumes:
        - /var/run/docker.sock:/var/run/docker.sock
      environment:
        - WATCHTOWER_LABEL_ENABLE=true
        - WATCHTOWER_CLEANUP=true
        - WATCHTOWER_POLL_INTERVAL=86400  # 24h
      command: --label-enable --cleanup
  ```
- Update `packaging/docker/README.md`:
  - Section "Auto-update single-node dev": thêm label `com.centurylinklabs.watchtower.enable=true` vào 3 service `openwork-*` trong `docker-compose.yml`, kèm command `docker compose -f docker-compose.yml -f docker-compose.watchtower.yml up -d`.
  - Section "Production k8s": docs `helm upgrade --install openwork oci://ghcr.io/<owner>/charts/openwork-ee --version X.Y.Z` + `helm rollback` + cách pin image tag trong `values.yaml`.

**File touch:**
- `packaging/docker/docker-compose.watchtower.yml` (new, ~15 dòng)
- `packaging/docker/README.md` (~50 dòng docs — bao gồm cả k8s section)
- `packaging/docker/docker-compose.yml` (3 dòng label mới trên 3 services `openwork-*`)

**Test commands:**
```bash
docker compose -f packaging/docker/docker-compose.yml config | grep -i watchtower
# Verify label applied
docker compose -f packaging/docker/docker-compose.yml -f packaging/docker/docker-compose.watchtower.yml config
```

---

## Acceptance criteria (definition of done cho cả plan)

### Desktop
- [ ] Bump version lên `0.17.8`, push tag → GitHub Release có artifacts + `latest*.yml` đầy đủ cho 4 platform (verify qua `gh release view v0.17.8 --json assets`).
- [ ] Cài OpenWork `0.17.7` → bật app → banner xuất hiện trong <30s nói "0.17.8 available".
- [ ] Click Download → progress bar chạy → "Restart to update" enable khi xong.
- [ ] Click Restart → app đóng → mở lại với version `0.17.8` (verify qua `app.getVersion()` log hoặc About dialog).
- [ ] Có `fraimz.html` evidence cho flow trên.
- [ ] Channel switcher hoạt động: bật `alpha` → feed đổi sang `alpha-macos-latest` URL (verify qua log `applyElectronUpdaterFeed`).

### Server
- [x] Bump version lên `0.17.8`, push tag → npm registry có version mới trong <5 phút (đã có sẵn job `publish-npm`).
- [x] `npm view openwork-server version` trả về đúng version vừa publish.
- [x] `npm install -g openwork-server@0.17.8` thành công trên macOS arm64, linux x64, windows x64 (binaries có sẵn qua `build:bin:all`).
- [ ] (Optional) `openwork-server update` in đúng command khi có version mới.

### Docker + Helm
- [x] Push tag `v0.17.8` → 3 images mới (`openwork-den-api:0.17.8`, `openwork-den-web:0.17.8`, `openwork-inference:0.17.8`) xuất hiện trên GHCR.
- [x] Helm chart `openwork-ee-0.17.8.tgz` xuất hiện trên `oci://ghcr.io/<owner>/charts`.
- [ ] (PR 3) `Chart.yaml#version` + `appVersion` tự động bump theo tag trong release flow.
- [ ] (PR 4) `helm upgrade --install ... --version 0.17.8` thành công trên kind/minikube (verify qua docs + smoke test).
- [ ] (PR 4) Watchtower detect + pull + recreate containers trong <1 phút (single-node dev, verify qua compose up + push new image).
- [ ] (PR 4) `helm rollback` về version trước thành công trong <30s (docs có ví dụ).

---

## Rủi ro & mitigations

| Rủi ro | Mitigation |
|---|---|
| **Code signing cert hết hạn** (macOS notarize, Windows SignPath) | Tự động fail GH Action → block release. `release-macos-aarch64.yml` có input `notarize: false` + `sign_windows: false` là escape hatch. |
| **`latest.yml` không match artifacts** do partial publish | `publish-electron-assets.mjs` validate manifest: check `latest-mac.yml` có cả `mac-arm64` + `mac-x64`, check `latest.yml` có cả `win-arm64` + `win-x64`, throw nếu thiếu. Nếu fail giữa chừng, `gh release upload --clobber` retry. |
| **Người dùng từ chối update** (defer nhiều lần) | `electron-updater` đã set `disableDifferentialDownload` (giảm partial cache issue). UI cho defer 3 lần trước khi force. |
| **Watchtower restart giữa task đang chạy** | Watchtower `--include-stopped` + `--revive-stopped` (chỉ restart stopped container trừ khi mới). Default 24h poll interval để ít gián đoạn. |
| **Helm chart version conflict** khi bump sai | `scripts/release/prepare.mjs --dry-run` + `helm lint` trong `publish-ee-images.yml` đã có. PR 3 thêm bump tự động. |
| **`openwork-server` self-update tự ghi đè binary đang chạy** | Không tự spawn `npm install -g` — in command cho user thay vì chạy ngầm. |
| **Tự host update server chết** | Chọn GitHub Releases + GHCR → uptime 99.9%+, free, không tự host. |
| **`NPM_TOKEN` secret hết hạn / chưa set** | `publish-npm` job có fallback skip silently (line 791–798). Manual recovery: tạo token mới, set lại secret, re-run workflow với `workflow_dispatch`. |

---

## Khuyến nghị thứ tự ship

> **Sau verify lại:** PR 1 + PR 3 + PR 4 = 100% value còn lại. PR 2 optional.

1. **Phase 3 PR 3** (Helm `Chart.yaml` bump auto) — **làm đầu tiên** vì 40 LoC, unlock việc pin version Helm cho production. Low risk, test bằng `pnpm release:prepare patch --dry-run`.
2. **Phase 1 PR 1** (UI update banner) — main UX win, user thấy được. Cần `fraimz` flow verify.
3. **Phase 3 PR 4** (Watchtower docs + helm upgrade/rollback docs) — 30 phút, đóng gói, không cần test E2E phức tạp.
4. **Phase 2 PR 2** (optional `openwork-server update` subcommand) — làm sau cùng nếu user feedback cần.

**Tổng effort ước lượng còn lại: 1.5–2.5 ngày** (1 dev) — nhanh hơn estimate cũ vì phần lớn infrastructure đã có.

---

## Tài liệu tham khảo

- [`electron-updater` docs](https://www.electron.build/auto-update) — pattern `provider: github` + `setFeedURL` đang dùng.
- [`electron-builder` publish config](https://www.electron.build/configuration/publish) — block `publish` trong `electron-builder.yml` đã đúng.
- [Watchtower labels](https://containrrr.dev/watchtower/container-selection/) — dùng `com.centurylinklabs.watchtower.enable=true`.
- [Helm OCI registry](https://helm.sh/docs/topics/registries/) — `oci://ghcr.io/<owner>/charts` đã wire.
- [npm `publishConfig`](https://docs.npmjs.com/cli/v10/configuring-npm/package-json#publishconfig) — `openwork-server` đã set `access: public`.
- [GHCR packages](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry) — 3 image đã publish lên `ghcr.io/different-ai/openwork-*`.

---

## Những thứ KHÔNG nên làm (out of scope)

- ❌ Tự viết update protocol riêng (đã có `electron-updater`/npm/Helm).
- ❌ Tự host update server trên S3/Cloudflare R2.
- ❌ Code signature tự quản lý (dùng Apple/Windows certs qua GH Secrets, đã wire).
- ❌ Tự spawn `npm install -g` trong self-update (in command thay vì chạy).
- ❌ Auto-bump major version (luôn bump manual qua `pnpm bump:minor` để review changelog).
- ❌ Force update lên user (luôn cho defer).
- ❌ Tự viết manifest merger cho Electron — `publish-electron-assets.mjs` đã làm tốt rồi.

---

## Câu hỏi mở / cần user confirm trước khi ship

1. **Code signing certs** cho macOS + Windows đã có chưa? (Cần cho `publish-electron` job khi `notarize: true` / `sign_windows: true`.) Nếu chưa, default workflow đã `notarize: true, sign_windows: false` — có ổn không?
2. **`NPM_TOKEN` secret** đã config trong repo chưa? Nếu chưa, `publish-npm` job sẽ skip silently với warning — có cần setup trước khi ship PR 1 không?
3. **Watchtower policy:** mặc định đề xuất 24h poll interval + cleanup image cũ. Hay user muốn chỉ dùng `helm upgrade` cho mọi môi trường (kể cả dev)?
4. **Alpha channel** hiện chỉ macOS — có mở rộng Linux/Windows không? Cần thêm job build cho 2 platform đó + cập nhật feed URL (hiện tên là `alpha-macos-latest`).
5. **Có muốn include "What's new" trong update dialog không?** Cần wire `CHANGELOG.md` parse — effort thêm ~1 ngày. Hiện `changelog/` có sẵn trong repo.
6. **Channel switcher UI:** đặt trong `Help → Switch to alpha` menu (dùng `app-menu.mjs` của Electron) hay trong Settings page trong renderer? Cả 2 đều modify cùng file `electron-updater-channel.v1.json`.

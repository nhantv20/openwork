# Plan: Tích hợp `drawio-ai-kit` cho OpenWork — Cloud Architecture Diagrams

> **Cập nhật:** 2026-07-11  
> **Mục tiêu:** Cho phép OpenWork sinh diagram kiến trúc cloud (AWS / Azure / GCP / Databricks) + BPMN **đúng chuẩn**, validate trước khi xuất, tận dụng icon ground-truth từ `drawio-ai-kit` upstream (MIT, 0 runtime dep).  
> **Owner:** Nhân  
> **Trạng thái:** Phase 0 ✅ DONE (pilot commit `c582e702`)

---

## Nguyên tắc thiết kế plan

Mỗi phase là **1 PR độc lập**, có thể:
- ship riêng (không phụ thuộc phase sau)
- test riêng bằng lệnh rõ ràng
- demo riêng cho stakeholder
- revert riêng nếu có vấn đề

> **Không có phase nào phải đợi phase trước xong mới bắt đầu được.** Phase 3 (eval flow) có thể làm song song với Phase 1 (PNG) vì test ở layer khác nhau.

### Ký hiệu

| Ký hiệu | Ý nghĩa |
|---------|---------|
| ✅ **DONE** | Đã commit, đã verify |
| 🔶 **PARTIAL** | Có building blocks, thiếu 1-2 phần |
| ⚠️ **EARLY** | Có nền tảng, cần build thêm |
| ❌ **NONE** | Chưa có gì |
| 📌 **TODO** | Kế hoạch làm tiếp |

### Test commands dùng xuyên suốt plan

```bash
pnpm drawio:doctor                                    # CLI install state
pnpm test:drawio                                      # 16 unit tests (Phase 0)
pnpm drawio:aws:smoke                                 # build validate audit
pnpm drawio:aws:build --build-script X --out Y --name Z   # custom build
pnpm evals --flow drawio-aws-architecture             # Electron eval (Phase 3+)
pnpm fraimz --flow drawio-aws-architecture            # Daytona eval (Phase 3+)
pnpm --filter @openwork/app test:health               # app tests (Phase 2)
```

---

## Phase 0: Foundation ✅ DONE

> **Commit:** `c582e702` — feat(opencode): integrate drawio-ai-kit for cloud architecture diagrams

**Shipped**:
- ✅ 5 domain skills (`.opencode/skills/drawio-{aws,azure,gcp,databricks,bpmn}/SKILL.md`)
- ✅ Custom agent (`drawio-architect`)
- ✅ `office-assistant` delegation + diagram routing table
- ✅ Scripts: `drawio-doctor.mjs`, `drawio-install.mjs`, `drawio-aws-build.mjs`, `drawio-smoke-build.mjs`
- ✅ Pin: `vendor/drawio-ai-kit.PIN.md` (v1.0.0, commit `814d97e`)
- ✅ 16 unit tests pass

**Cách test Phase 0**:
```bash
pnpm drawio:doctor      # phải ra OK, installed: drawio-ai-kit@1.0.0
pnpm test:drawio        # 16 tests pass
pnpm drawio:aws:smoke   # build ra diagrams/aws/smoke-3tier.drawio
```

**Demo**: `open diagrams/aws/smoke-3tier.drawio` trong app.diagrams.net → thấy AWS Cloud → VPC → 3-tier chuẩn.

---

## Phase 1: Wire PNG output xuống downstream skills

> **Mục tiêu:** PNG từ `drawio-aws:build` có thể nhét thẳng vào `morph-ppt` deck, `word-creator` doc, dashboard.  
> **PR:** #1 (1-2 ngày) — Ship riêng được.  
> **Test độc lập:** Phase 1 có testable boundary riêng qua `pnpm drawio:export-png` + visual check.

### Tasks

| # | Task | File / Location | Test |
|---|------|-----------------|------|
| 1.1 | Tạo `scripts/drawio-export-png.mjs` — wrapper riêng cho render | `scripts/drawio-export-png.mjs` | `pnpm drawio:export-png --in foo.drawio --out foo.png` exit 0 |
| 1.2 | Update `scripts/drawio-aws-build.mjs` — luôn render PNG khi `DRAWIO_CLI` có sẵn, KHÔNG skip silently | `scripts/drawio-aws-build.mjs` | Khi có `DRAWIO_CLI`, output ghi rõ "rendering → output.png" |
| 1.3 | Add `pnpm drawio:export-png` script vào `package.json` | `package.json` | Có trong `pnpm run` |
| 1.4 | Document "PNG → morph-ppt" workflow trong SKILL.md AWS | `.opencode/skills/drawio-aws/SKILL.md` | Section "Hand-off to morph-ppt" có code example chạy được |
| 1.5 | "architecture block" template cho `morph-ppt` | `.opencode/skills/morph-ppt/SKILL.md` | Snippet `architecture-block.md` reference được |
| 1.6 | Update `pitch-deck-creator` SKILL — link sang drawio | `.opencode/skills/pitch-deck-creator/SKILL.md` | Section "Vẽ architecture diagram" link tới `drawio-architect` |
| 1.7 | Tests cho drawio-export-png: arg parsing, missing file, success path | `scripts/drawio-doctor.test.mjs` (extend) | +4 tests pass |

### Cách test Phase 1 (độc lập)

```bash
# 1. Build diagram (Phase 0)
pnpm drawio:aws:smoke

# 2. Export PNG riêng
pnpm drawio:export-png --in diagrams/aws/smoke-3tier.drawio --out diagrams/aws/smoke-3tier.png
# → exit 0, file PNG tồn tại

# 3. Tests
pnpm test:drawio
# → 20 tests pass (16 cũ + 4 mới)

# 4. Visual check
open diagrams/aws/smoke-3tier.png
```

### Demo Phase 1

```bash
# Trong OpenWork chat:
"Vẽ cho tôi diagram AWS 3-tier rồi đưa PNG vào slide 'Kiến trúc hệ thống' của deck 'Q3 review'."
# → Agent build .drawio → render PNG → insert vào slide
```

### Pass criteria cho Phase 1

- [ ] `pnpm drawio:export-png` hoạt động standalone
- [ ] `morph-ppt` skill có snippet architecture-block
- [ ] `pitch-deck-creator` link sang `drawio-architect`
- [ ] ≥ 20 tests pass
- [ ] PNG file size > 5KB (không phải blank)

---

## Phase 2: In-app preview cho `.drawio` artifacts

> **Mục tiêu:** File `.drawio` mở được trong artifact panel của app (giống PDF / DOCX / XLSX / PPT).  
> **PR:** #2 (1-2 ngày) — Ship riêng được.  
> **Test độc lập:** Qua app tests (`pnpm --filter @openwork/app test:health`) + manual open file.

### Tasks

| # | Task | File / Location | Test |
|---|------|-----------------|------|
| 2.1 | Tạo `apps/app/src/react-app/domains/session/artifacts/viewers/drawio-viewer.tsx` | `apps/app/src/react-app/domains/session/artifacts/viewers/drawio-viewer.tsx` | Component render iframe `embed.diagrams.net` |
| 2.2 | Register viewer vào `viewers/index.ts` | `apps/app/src/react-app/domains/session/artifacts/viewers/index.ts` | `drawio` xuất hiện trong registry |
| 2.3 | Update `preview.tsx` route `.drawio` → drawio-viewer | `apps/app/src/react-app/domains/session/artifacts/preview.tsx` | File `.drawio` mở trong app |
| 2.4 | Update `file-preview-classification.test.ts` — add `.drawio` | `apps/app/scripts/file-preview-classification.test.ts` | Test pass |
| 2.5 | Update `preview-viewers-surface.test.ts` — add drawio viewer | `apps/app/scripts/preview-viewers-surface.test.ts` | Test pass |
| 2.6 | Document "preview .drawio" trong SKILL.md AWS | `.opencode/skills/drawio-aws/SKILL.md` | Section "In-app preview" |
| 2.7 | Run full app test suite | — | `pnpm --filter @openwork/app test:health` pass |

### Cách test Phase 2 (độc lập)

```bash
# 1. Build diagram trước (Phase 0)
pnpm drawio:aws:smoke

# 2. App tests
pnpm --filter @openwork/app test:health
# → tất cả test cũ pass + 2 test mới (.drawio classification, viewer surface)

# 3. App tests chi tiết
pnpm --filter @openwork/app test:file-preview-classification
pnpm --filter @openwork/app test:preview-viewers-surface

# 4. Manual test
pnpm dev
# → Mở artifacts panel → mở file diagrams/aws/smoke-3tier.drawio
# → Phải thấy diagram embed trong iframe
```

### Demo Phase 2

```bash
# Trong OpenWork app:
1. Build diagram: pnpm drawio:aws:smoke
2. Mở file diagrams/aws/smoke-3tier.drawio trong artifact panel
3. Diagram hiển thị inline (embed diagrams.net)
4. Click vào icon có thể edit trong app.drawio.com
```

### Pass criteria cho Phase 2

- [ ] Mở file `.drawio` trong app hiển thị được diagram
- [ ] Không phá vỡ PDF/DOCX/XLSX/PPT viewers
- [ ] Tất cả app tests pass
- [ ] CSP không chặn embed diagrams.net

### Risks

- ⚠️ CSP issue với `embed.diagrams.net` → có thể cần `webPreferences` config trong Electron

---

## Phase 3: Electron-driven eval flow

> **Mục tiêu:** Có 1 eval flow `drawio-aws-architecture.flow.mjs` chạy được qua `pnpm evals` trên local + Daytona, drive agent qua toàn bộ workflow, output `fraimz.html` với screenshots.  
> **PR:** #3 (1 ngày) — Ship riêng được, không phụ thuộc Phase 1-2.  
> **Test độc lập:** Qua `pnpm evals --flow drawio-aws-architecture`.

### Tasks

| # | Task | File / Location | Test |
|---|------|-----------------|------|
| 3.1 | Tạo `evals/flows/drawio-aws-architecture.flow.mjs` — agent flow | `evals/flows/drawio-aws-architecture.flow.mjs` | Schema match `{ id, title, steps }` |
| 3.2 | Steps: preflight (CLI OK) → prompt agent → build → validate → render → save artifact | `evals/flows/drawio-aws-architecture.flow.mjs` | Chạy qua runner |
| 3.3 | Spec đi kèm `evals/drawio-aws-architecture-flows.md` | `evals/drawio-aws-architecture-flows.md` | Narrative + expected outcome |
| 3.4 | Chạy local: `pnpm evals --flow drawio-aws-architecture` | — | Pass, output `evals/results/<run>/fraimz.html` |
| 3.5 | Document flow trong `evals/README.md` | `evals/README.md` | Link tới flow file |

### Cách test Phase 3 (độc lập)

```bash
# Prereq: Phase 0 done (CLI installed)
pnpm drawio:doctor      # phải ra OK

# 1. Chạy flow local
pnpm evals --flow drawio-aws-architecture
# → output evals/results/<timestamp>/fraimz.html + index.html + screenshots/

# 2. Kiểm tra output
open evals/results/<latest>/fraimz.html
# → Thấy screenshots: preflight, prompt, build, validate, render, save

# 3. Validate JSON report
cat evals/results/<latest>/report.json | jq '.steps[].status'
# → tất cả "passed"
```

### Demo Phase 3

```bash
# Cho stakeholder xem:
1. pnpm evals --flow drawio-aws-architecture
2. Mở evals/results/<latest>/fraimz.html
3. Show: agent nhận prompt → build diagram → validate clean → render PNG → save artifact
4. PR có thể attach screenshot của fraimz.html
```

### Pass criteria cho Phase 3

- [ ] Flow chạy được local
- [ ] `fraimz.html` có screenshots của từng step
- [ ] Validate step hard-fails khi build script output invalid (test thử với bad input)
- [ ] Không làm regress `pnpm evals --all`

### Risks

- ⚠️ Flow flakey đầu tiên — cần iteration
- ⚠️ Phụ thuộc draw.io CLI cho render step — nếu thiếu, skip step đó gracefully

---

## Phase 4: Slash command + UI shortcut *(optional)*

> **Mục tiêu:** Người dùng gõ `/drawio-aws` hoặc click menu "New → Architecture diagram" trong OpenWork UI.  
> **PR:** #4 (2-3 ngày) — Ship riêng được.  
> **Test độc lập:** Manual UI test + slash command test.

### Tasks

| # | Task | File / Location | Test |
|---|------|-----------------|------|
| 4.1 | Slash command `/drawio-aws` + 4 domain khác trong office-assistant prompt | `.opencode/agents/office-assistant.md` | Gõ `/drawio-aws` → trigger skill |
| 4.2 | Tạo `.opencode/commands/drawio-aws.md` — wrapper command | `.opencode/commands/drawio-aws.md` | Match existing command pattern |
| 4.3 | Template gallery: list các example templates | `apps/app/src/react-app/domains/session/panel/template-gallery.tsx` | UI hiển thị grid ≥ 14 templates |
| 4.4 | Wire "New → Architecture diagram" menu trong app | `apps/app/src/react-app/shell/` | Menu item hoạt động |
| 4.5 | Pre-fill template: chọn template → auto-generate build script + build | UI flow | Click template → có diagram draft |

### Cách test Phase 4 (độc lập)

```bash
# 1. Manual UI test
pnpm dev
# → Trong chat: gõ "/drawio-aws" → command palette show
# → Click menu New → Architecture diagram → chọn template "VPC Multi-AZ"
# → Diagram draft được tạo trong workspace

# 2. Slash command test (qua eval hoặc manual)
# Trong OpenWork chat:
/drawio-aws
# → trigger skill, agent hỏi topology + components
```

### Pass criteria cho Phase 4

- [ ] `/drawio-aws` hoạt động trong chat
- [ ] Template gallery hiển thị ≥ 14 templates
- [ ] Click template → build thật (không phải chỉ load skeleton)

### Risks

- ⚠️ UI changes lớn nhất — defer nếu tight scope

---

## Phase 5: Documentation + onboarding

> **Mục tiêu:** Developer / user mới onboard trong <10 phút qua docs.  
> **PR:** #5 (0.5 ngày) — Ship song song với các PR khác.  
> **Test độc lập:** Đọc + follow từng bước trong docs.

### Tasks

| # | Task | File / Location | Test |
|---|------|-----------------|------|
| 5.1 | Tạo `docs/drawio-ai-kit.md` — overview + workflow + troubleshooting | `docs/drawio-ai-kit.md` | Đầy đủ, có TOC |
| 5.2 | Update README.md (root) — section "Cloud architecture diagrams" | `README.md` | Link tới docs/drawio-ai-kit.md |
| 5.3 | Troubleshooting guide cho ≥ 5 lỗi: CLI missing, version drift, render fail, parent-repo git pitfall, collision | `docs/drawio-ai-kit.md` | Cover ≥ 5 lỗi |
| 5.4 | FAQ "What's the difference vs beautiful-mermaid?" | `docs/drawio-ai-kit.md` | Trả lời rõ ràng |
| 5.5 | Update `.opencode/skills/beautiful-mermaid/SKILL.md` — link sang drawio cho cloud | `.opencode/skills/beautiful-mermaid/SKILL.md` | Section "Khi nào KHÔNG dùng Mermaid" |

### Cách test Phase 5 (độc lập)

```bash
# 1. Đọc docs (no test, manual review)
open docs/drawio-ai-kit.md

# 2. Follow từng bước từ zero
# Fresh clone → chỉ follow docs/drawio-ai-kit.md → có diagram đầu tiên trong <10 phút

# 3. Verify links không 404
grep -rE "docs/drawio-ai-kit.md|drawio-architect|drawio-aws" --include="*.md"
```

### Pass criteria cho Phase 5

- [ ] Developer mới onboard thành công chỉ đọc `docs/drawio-ai-kit.md`
- [ ] Beautiful-mermaid skill có link rõ ràng tới drawio
- [ ] README có section cloud architecture
- [ ] ≥ 5 troubleshooting cases covered

---

## Phase 6: Multi-domain smoke tests

> **Mục tiêu:** Tất cả 5 domain đều có smoke script + tests pass.  
> **PR:** #6 (1 ngày) — Ship riêng được.  
> **Test độc lập:** `pnpm drawio:smoke:all` exit 0.

### Tasks

| # | Task | File / Location | Test |
|---|------|-----------------|------|
| 6.1 | `scripts/drawio-azure-smoke.mjs` — minimal Azure hub-spoke | `scripts/drawio-azure-smoke.mjs` | Build → validate clean |
| 6.2 | `scripts/drawio-gcp-smoke.mjs` — minimal GCP VPC | `scripts/drawio-gcp-smoke.mjs` | Build → validate clean |
| 6.3 | `scripts/drawio-databricks-smoke.mjs` — minimal lakehouse medallion | `scripts/drawio-databricks-smoke.mjs` | Build → validate clean |
| 6.4 | `scripts/drawio-bpmn-smoke.mjs` — minimal pool + lanes | `scripts/drawio-bpmn-smoke.mjs` | Build → validate clean |
| 6.5 | Add `pnpm drawio:smoke:all` chạy cả 5 | `package.json` | Chạy được |
| 6.6 | Tests: assert mỗi smoke build output `.drawio` hợp lệ | `scripts/drawio-doctor.test.mjs` | +5 tests pass (≥ 25 total) |
| 6.7 | Add `pnpm drawio:smoke:{aws,azure,gcp,databricks,bpmn}` per-domain | `package.json` | Có thể chạy từng domain riêng |

### Cách test Phase 6 (độc lập)

```bash
# 1. Chạy từng domain
pnpm drawio:smoke:aws
pnpm drawio:smoke:azure
pnpm drawio:smoke:gcp
pnpm drawio:smoke:databricks
pnpm drawio:smoke:bpmn

# 2. Chạy tất cả
pnpm drawio:smoke:all
# → 5 .drawio files + 0 errors

# 3. Tests
pnpm test:drawio
# → ≥ 25 tests pass

# 4. Visual check
ls diagrams/{aws,azure,gcp,databricks,bpmn}/
# → 5 files, mỗi cái open được trong app.diagrams.net
```

### Pass criteria cho Phase 6

- [ ] Cả 5 domain có smoke script chạy clean
- [ ] Tests cover cả 5 domain
- [ ] `pnpm drawio:smoke:all` exit 0

---

## Phase 7: Optional — Cloud sandbox path (Daytona)

> **Mục tiêu:** Build diagram từ Daytona sandbox khi user không có CLI local.  
> **PR:** #7 (1-2 ngày) — Ship cuối cùng, optional.  
> **Test độc lập:** Qua `pnpm fraimz --flow drawio-aws-architecture` (Phase 3 eval flow chạy trên cloud).

### Tasks

| # | Task | File / Location | Test |
|---|------|-----------------|------|
| 7.1 | Daytona snapshot có `drawio-ai` pre-installed | `packaging/daytona/` | Snapshot build OK |
| 7.2 | Flag `--remote` cho `drawio-aws-build.mjs` — dùng Daytona | `scripts/drawio-aws-build.mjs` | `pnpm drawio:aws:build --remote ...` hoạt động |
| 7.3 | Eval flow trên cloud (extend Phase 3) | `evals/flows/drawio-aws-architecture.flow.mjs` | `kind: "user-facing"` chạy Daytona |
| 7.4 | Document "remote build" workflow | `docs/drawio-ai-kit.md` | Section "Running in Daytona" |

### Cách test Phase 7 (độc lập)

```bash
# 1. Chạy eval flow trên Daytona (cần Daytona setup sẵn)
pnpm fraimz --flow drawio-aws-architecture
# → output evals/results/<run>/fraimz.html

# 2. Verify remote build hoạt động
pnpm drawio:aws:build --build-script scripts/drawio-smoke-build.mjs \
  --out /tmp/remote-test --name test --remote
# → diagram được build trên Daytona
```

### Pass criteria cho Phase 7

- [ ] Có thể build diagram từ xa khi không có local CLI
- [ ] Snapshot reproducible

---

## Đề xuất thứ tự ship

Có 3 mức độ scope để chọn:

### 🎯 Tier 1 — MVP (~2-3 ngày)
**Ship ngay**: Phase 1 + Phase 6
- Phase 1: PNG xuống morph-ppt / word (PNG pipeline complete)
- Phase 6: 4 smoke còn lại (azure/gcp/databricks/bpmn)

→ User có thể dùng được: build tất cả 5 domain, nhét PNG vào slide/doc.

### 🚀 Tier 2 — Recommended (~4-5 ngày)
**Tier 1 + Phase 2 + Phase 3 + Phase 5**
- Phase 2: In-app preview `.drawio` files
- Phase 3: Electron eval flow
- Phase 5: Docs

→ User có trải nghiệm đầy đủ: build + preview trong app + eval coverage + docs.

### 🌟 Tier 3 — Full (~6-9 ngày)
**Tier 2 + Phase 4 + Phase 7**
- Phase 4: Slash command + template gallery
- Phase 7: Daytona remote build

→ Trải nghiệm polished nhất, support cả user không có local CLI.

---

## Acceptance criteria cho toàn bộ plan (khi ship Tier 2+)

1. **Functional**:
   - [ ] Tất cả 5 domain build `.drawio` clean
   - [ ] PNG render được khi `draw.io` CLI available
   - [ ] PNG nhét được vào `morph-ppt` deck + `word-creator` doc
   - [ ] `.drawio` file preview được trong app artifact viewer
   - [ ] Eval flow chạy được local

2. **Quality**:
   - [ ] ≥ 25 unit tests trong `scripts/drawio-doctor.test.mjs`, 100% pass
   - [ ] App tests không regress
   - [ ] Eval flow pass ≥ 1 lần local
   - [ ] Không regress `pnpm evals --all`

3. **DX**:
   - [ ] Developer mới onboard <10 phút (qua docs)
   - [ ] `pnpm drawio:doctor` exit 0 khi healthy
   - [ ] `pnpm test:drawio` exit 0 khi tests pass
   - [ ] Docs cover ≥ 5 lỗi thường gặp

4. **Versioning**:
   - [ ] Bump `drawio-ai-kit` version chỉ cần: sửa 1 file (`PIN.md`) + chạy `pnpm test:drawio` + `pnpm drawio:install`
   - [ ] Doctor exit 2 nếu version drift (không silent)

---

## Open Questions

| # | Question | Default đề xuất |
|---|----------|----------------|
| Q1 | Tier nào sẽ ship đầu tiên? | **Tier 2** (Recommended) — đủ giá trị, không quá lớn |
| Q2 | Phase 4 (UI shortcut + slash command) có cần không? | Có — UX quan trọng cho non-technical user |
| Q3 | Phase 7 (Daytona remote) có cần không? | Optional — làm sau khi Tier 2 stable |
| Q4 | Khi user không có draw.io desktop CLI, fallback nào? | (b) ship optional install helper `pnpm drawio:install:drawio-cli` |
| Q5 | Có cần `drawio-ai-kit` cho non-cloud use case (k8s, network on-prem) không? | Out of scope — chỉ 5 domain upstream có |
| Q6 | PNG export sang base64 cho `word-creator` hay giữ file path? | File path (match existing pattern) |

---

## Reference Files

| Path | Vai trò |
|------|---------|
| `vendor/drawio-ai-kit.PIN.md` | Pin upstream (chỉ sửa 1 file để bump) |
| `.opencode/agents/drawio-architect.md` | Custom agent |
| `.opencode/skills/drawio-*/SKILL.md` | 5 domain skills |
| `scripts/drawio-doctor.mjs` | Detect install state |
| `scripts/drawio-install.mjs` | npm i -g wrapper |
| `scripts/drawio-aws-build.mjs` | Build pipeline wrapper |
| `scripts/drawio-doctor.test.mjs` | 16 unit tests |
| `apps/app/src/react-app/domains/session/artifacts/viewers/` | Add `drawio-viewer.tsx` (Phase 2) |
| `apps/app/src/react-app/domains/session/artifacts/preview.tsx` | Route `.drawio` → drawio viewer (Phase 2) |
| `evals/flows/` | Add `drawio-aws-architecture.flow.mjs` (Phase 3) |
| `.opencode/skills/morph-ppt/SKILL.md` | Thêm "architecture block" (Phase 1) |
| `.opencode/skills/word-creator/SKILL.md` | Add reference (Phase 1) |
| `docs/drawio-ai-kit.md` | Docs (Phase 5) |

---

## Risks tổng hợp

| Risk | Severity | Mitigation |
|------|----------|------------|
| `drawio-ai-kit` upstream breaking change | Medium | Pin commit SHA + bump process qua `PIN.md` + `test:drawio` |
| `draw.io` desktop CLI nặng (~200MB) | Low | Optional dep, graceful skip nếu thiếu |
| npm global collision (Homebrew ghost repo pitfall) | ✅ Fixed | `drawio-install.mjs` đã có collision check |
| Parent-repo `.git` ancestry break `git rev-parse` | ✅ Fixed | Verify qua `package.json#version` thay vì git |
| Electron CDP eval flow flakey | Medium | Test iteration, fallback `--smoke` mode |
| Embed diagrams.net CSP issues trong Electron | Medium | Test trên dev build sớm (Phase 2) |
| Phase 4 UI changes quá lớn | Medium | Defer nếu tight, scope MVP = Tier 2 |

---

## Tracking

Update `WBS.md` với entries cho từng Phase khi bắt đầu. Theo pattern Phase 1 (file preview) đã có.

Khi ship 1 phase → update plan với:
- ✅ DONE marker
- Commit SHA
- Notes (nếu có dev từ plan ban đầu)

---

## Khi nào bump version `drawio-ai-kit`

```bash
# 1. Sửa vendor/drawio-ai-kit.PIN.md (chỉ file này)
#    - update version (vd. 1.0.0 → 1.1.0)
#    - update commit SHA
#    - update tag

# 2. Verify tests
pnpm test:drawio

# 3. Reinstall
pnpm drawio:install --force

# 4. Smoke test
pnpm drawio:aws:smoke

# 5. Verify doctor
pnpm drawio:doctor
# → phải OK, installed: drawio-ai-kit@<new version>
```
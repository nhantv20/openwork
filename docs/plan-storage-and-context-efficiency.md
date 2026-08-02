# Plan: Storage và Context Efficiency

> **Status:** Draft
> **Scope:** OpenCode session data, event storage, attachments, archive và request context.
> **Mục tiêu:** Giảm tăng trưởng DB, giảm payload lặp, giảm input token và vẫn giữ khả năng replay/restore session.

## Đánh giá hiện trạng

- Archive runner đã tồn tại và có thể export `session`, `messages`, `parts`, `session_input`, `events` thành các file JSON/JSONL, sau đó soft-archive, hard-delete và `VACUUM` DB.
- Archive hiện giữ nguyên dữ liệu JSONL và chưa có compression/checksum đầy đủ.
- Composer chuyển attachment thành `data:` URL trước khi gọi OpenCode. Việc này có nguy cơ làm phình request và part history, đặc biệt với PDF/image.
- Router nhận `message.updated` để cập nhật model/thinking; đây không phải bằng chứng rằng router là nơi persistence event chính.
- App gửi prompt hiện tại qua OpenCode. Việc provider nhận toàn bộ transcript hay context đã compact nằm ở OpenCode request path, cần đo bằng telemetry trước khi sửa.
- Client đã coalescing một phần delta để giảm chi phí render, nhưng việc này không tự giảm kích thước DB hoặc payload provider.

## Nguyên tắc thiết kế

1. Đo kích thước và token trước khi tối ưu.
2. Giữ state canonical riêng với event/audit log; không hy sinh khả năng replay chỉ để giảm bytes.
3. Attachment phải có identity, hash, metadata, quyền truy cập và lifecycle độc lập với message.
4. Mọi cơ chế truncate, summary, cache và retention phải có đường dẫn khôi phục hoặc thông báo rõ dữ liệu đã bị rút gọn.
5. Thay đổi phải tương thích archive cũ và có migration/version rõ ràng.

## Kiến trúc mục tiêu

```text
Composer
  -> Attachment storage (hash, metadata, dedupe)
  -> OpenCode message/part reference
  -> Context builder / compaction
  -> Provider request

Live OpenCode DB
  -> canonical session state
  -> compact event metadata / audit events
  -> archive exporter
  -> compressed archive + manifest/checksums
```

## Plan theo phase

### Phase 0: Baseline và xác định owner

- [ ] Lấy snapshot DB theo session/workspace: tổng bytes, bytes của `message.data`, `part.data`, `event.data`, số event và attachment.
- [ ] Đo tỷ lệ payload trùng lặp theo `event.type`, `message_id`, `part_id` và hash nội dung.
- [ ] Đo request input tokens, output tokens, latency và cache-read tokens theo session.
- [ ] Xác định chính xác lớp tạo/lưu event và lớp dựng provider request trong phiên bản OpenCode đang dùng.
- [ ] Thêm report JSON/CLI để có thể so sánh trước/sau.

**Exit criteria:** Có baseline cho ít nhất 20 session đại diện hoặc toàn bộ DB dev; mọi P0 đều có metric để chứng minh hiệu quả.

### Phase 1: Giảm tải tức thời và giới hạn an toàn

- [ ] Giới hạn tool output theo bytes và lines.
- [ ] Lưu output đầy đủ trong storage, trả preview + reference trong context.
- [ ] Truncate có metadata: `truncated`, original size, storage reference.
- [ ] Thêm cảnh báo khi một request hoặc session vượt quota bytes/token.
- [ ] Không thay đổi semantics của message history trong phase này.

**Exit criteria:** Request không thể bị phình vô hạn bởi một tool result; UI vẫn mở được full output qua reference.

### Phase 2: Tách và deduplicate attachment

- [ ] Tạo attachment record gồm `id`, SHA-256, size, MIME, filename, storage key, created time và retention state.
- [ ] Upload bytes vào storage trước khi tạo prompt part; không gửi lại base64 nếu file đã tồn tại.
- [ ] Deduplicate theo hash, có kiểm tra collision/error và giới hạn kích thước.
- [ ] Message/part chỉ giữ reference và metadata cần cho UI/provider.
- [ ] Thiết kế quyền đọc theo workspace/session; không dùng filename hoặc hash làm authorization.
- [ ] Xử lý cleanup attachment mồ côi, archive và hard-delete.

**Exit criteria:** Cùng một file chỉ lưu một bản trong storage; session vẫn render được attachment sau reload, archive và restore.

### Phase 3: Giảm event payload lặp

- [ ] Dùng baseline để xác định event nào chứa full state hoặc payload lớn.
- [ ] Tách event realtime tối thiểu khỏi canonical message/part state.
- [ ] Với delta event, bổ sung sequence, base revision, idempotency và checkpoint.
- [ ] Không xóa audit data trước khi có policy retention và archive tương ứng.
- [ ] Thêm test replay từ event stream và test event đến không đúng thứ tự.

**Exit criteria:** Replay tạo cùng canonical state; event bytes và tốc độ tăng DB giảm theo target baseline; reconnect không mất transcript.

### Phase 4: Context compaction và rolling summary

- [ ] Xác định context builder thực tế ở OpenCode/provider path.
- [ ] Định nghĩa context budget theo model/token, không cố định chỉ bằng số message.
- [ ] Ưu tiên context theo thứ tự: system/developer instructions, summary, message gần nhất, tool state liên quan và file được retrieve.
- [ ] Lưu summary version, source message range, model/version và thời điểm tạo.
- [ ] Giữ khả năng rebuild summary từ transcript/archive.
- [ ] Có kiểm thử các tình huống fork, revert, tool call chưa hoàn tất và attachment reference.

**Exit criteria:** Input tokens giảm mà agent vẫn truy xuất được quyết định, tool state và file context cần thiết; không tăng lỗi context/reasoning.

### Phase 5: Archive, retention và compression

- [ ] Chốt riêng policy cho live DB, archive, backup và user deletion.
- [ ] Giữ archive cũ đọc được; thêm archive schema version.
- [ ] Ghi checksum/size cho từng file và manifest; manifest chỉ ghi sau khi mọi file hoàn tất.
- [ ] Nén archive sau khi format ổn định, ưu tiên một format restore được trên macOS/Linux.
- [ ] Thêm orphan archive detection, retry và dry-run report.
- [ ] Không hard-delete session nếu archive thiếu hoặc checksum không hợp lệ.

**Exit criteria:** Restore được archive nén trong môi trường sạch; retention job không xóa nhầm dữ liệu và báo cáo được bytes reclaimed.

### Phase 6: Cache có điều kiện và health report

- [ ] Cache extract theo `file_hash + extractor_version + options`.
- [ ] Cache tool result chỉ cho thao tác read-only, với tool version, normalized input, workspace/file revision và TTL phù hợp.
- [ ] Không cache thao tác có side effect hoặc phụ thuộc quyền/runtime state chưa được đưa vào cache key.
- [ ] Health report gồm DB size, event bytes, archive size, attachment bytes, cache size, orphan count và quota usage.

## Thứ tự ưu tiên triển khai

```text
0. Baseline + telemetry
1. Tool output limits + quota cảnh báo
2. Attachment storage + dedupe
3. Event payload reduction
4. Context compaction / rolling summary
5. Retention contract + archive integrity
6. Archive compression
7. Extract/tool cache
8. Health report UI
```

Attachment và event reduction có thể phát triển song song sau Phase 0, nhưng nên dùng chung metrics và storage lifecycle. Context compaction không nên bắt đầu bằng thay đổi app request builder nếu chưa chứng minh app là owner của full transcript.

## Metrics và mục tiêu sơ bộ

| Nhóm | Metric | Mục tiêu ban đầu |
|---|---|---|
| DB | DB growth/day | Giảm 50% trên workload đại diện |
| Event | P95 event payload | Không có event đơn lẻ vượt ngưỡng định nghĩa |
| Attachment | Dedup ratio | Đo được và tăng dần theo workload thực tế |
| Provider | Input tokens/request | Giảm 30% mà không tăng lỗi context |
| Latency | P95 time-to-first-token | Không tăng quá 10% |
| Reliability | Replay/restore success | 100% trên fixture và archive test |

Các con số trên là target để thử nghiệm, cần chốt lại sau Phase 0.

## Rủi ro chính

- Delta event thiếu checkpoint có thể làm hỏng replay.
- Xóa hoặc truncate tool output có thể làm agent mất bằng chứng cần cho quyết định.
- External attachment storage tạo vấn đề quyền truy cập, orphan cleanup và backup.
- Summary có thể làm mất chi tiết quan trọng hoặc không tương thích giữa model/version.
- Retention không đồng nhất giữa DB, archive và backup có thể gây vi phạm policy hoặc mất dữ liệu.
- Cache sai key có thể trả dữ liệu cũ hoặc dữ liệu từ workspace khác.

## Deliverables

- Baseline report và dashboard/CLI metrics.
- Storage contract cho attachment và archive manifest.
- Migration/version plan cho message, part, event và archive.
- Unit/integration tests cho dedupe, truncation, replay, restore và retention safety.
- Một flow end-to-end: gửi attachment -> reload session -> archive -> restore -> đọc lại attachment và transcript.
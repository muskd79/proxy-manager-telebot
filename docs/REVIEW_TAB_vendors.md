# REVIEW — Tab "Vendors" + Wave 19 / 20

Ngày: 2026-04-28
Reviewer: Claude (review session)
Scope: `src/app/(dashboard)/vendors/*`, `src/app/api/vendors/*`, `src/lib/vendors/*`,
migrations 019–022 + follow-ups, so sánh VIA project.

---

## TL;DR

**Tab "Vendors" KHÔNG TỒN TẠI trong codebase hiện tại.**
Toàn bộ Wave 19 + Wave 20 (A/B/C/D-1) đã bị **rip out hoàn toàn** ở
**Wave 21A.5** (commit `571ba65`, 2026-04-26) bằng migration
`024_wave21a5_drop_vendor_api.sql`. Memory file
`vendor_reseller_status.md` + `wave_roadmap.md` đã **outdated 6 ngày** và
mô tả sai trạng thái hiện tại.

**Recommendation: đã ROLLBACK rồi, không có gì để FINISH.** Việc cần làm
duy nhất là **đồng bộ memory** + **drop pgsodium key sót lại** khi PITR
window đã pass.

---

## Q1: Vendor system có thật sự đang hoạt động không?

**KHÔNG. Schema chết, code chết, đã DROP.**

### Code/UI hiện trạng

| Path | Trạng thái |
|------|-----------|
| `src/app/(dashboard)/vendors/` | KHÔNG TỒN TẠI (ls dashboard: admins, api-docs, bot, bot-simulator, categories, chat, check-proxy, dashboard, history, logs, profile, proxies, requests, settings, trash, users) |
| `src/app/api/vendors/` | KHÔNG TỒN TẠI |
| `src/lib/vendors/` | KHÔNG TỒN TẠI |
| `src/components/vendors/` | KHÔNG TỒN TẠI |
| `src/lib/state-machine/vendor-order.ts` | KHÔNG TỒN TẠI |
| `src/app/api/cron/outbox-drain/route.ts` | KHÔNG TỒN TẠI |
| `cloudflare/workers/rate-limiter/` | KHÔNG TỒN TẠI |
| Sidebar nav "Vendors" | Đã xóa (`Wave 21A.5` commit message xác nhận) |
| Cron `outbox-drain` trong `vercel.json` | Đã xóa |

Grep `vendor` trong `src/`: chỉ còn 13 file, **toàn bộ là `vendor_label`
free-text** (cột TEXT denormalised trên `proxies` từ Wave 21A) hoặc
comment lịch sử. Không có adapter, không có saga, không có registry.

### DB hiện trạng

| Migration | Tác dụng | Trạng thái sau apply |
|-----------|----------|---------------------|
| `019_wave19_vendor_schema.sql` | Tạo 8 tables: `vendors`, `vendor_credentials`, `vendor_products`, `vendor_orders`, `vendor_allocations`, `vendor_renewal_schedule`, `vendor_webhook_events`, `vendor_usage_events`. Thêm 5 cols vào `proxies` (`source`, `vendor_id`, `vendor_product_id`, `vendor_order_id`, `vendor_allocation_id`) + CHECK `chk_proxies_vendor_consistency`. | **DROPPED** bởi mig 024 |
| `020_wave19_pgsodium.sql` | `CREATE EXTENSION pgsodium` + key `vendor_credentials_key` + 3 SECURITY DEFINER fns (`encrypt_vendor_cred`, `decrypt_vendor_cred`, `list_vendor_credentials`) + view `vendor_credentials_safe` (redacted). | Functions/view DROPPED. **pgsodium extension + key `vendor_credentials_key` CỐ Ý GIỮ LẠI** cho PITR safety (mig 024 SECTION 6) |
| `021_wave20a_saga_prereqs.sql` | Saga columns trên `vendor_orders` (`attempt_count`, `next_attempt_at`, `locked_by`, `locked_until`, `failure_category`, `dlq_at`, `last_error`), CHECK length idempotency_key, state-machine trigger, reconciler hot-path indexes. **CHƯA có outbox table riêng** — outbox được nhúng vào `vendor_orders` qua các saga columns. | **DROPPED gián tiếp** (table cha bị drop) |
| `022_wave20b_seed_vendors.sql` | Seed Evomi + Infatica (paused), deprecate IPRoyal. | **DROPPED** (vendors table biến mất) |
| `024_wave21a5_drop_vendor_api.sql` | Drop everything ở trên. Có DO-block VERIFY ở SECTION 7 — RAISE EXCEPTION nếu còn sót → guarantee clean DB. | Apply thành công → DB clean |

### RLS / pgsodium key access pattern

- Pattern thiết kế: chỉ `service_role` được gọi `decrypt_vendor_cred()`
  (SECURITY DEFINER, search_path lock). Admin UI đọc view
  `vendor_credentials_safe` (KHÔNG có plaintext, chỉ metadata).
  Adapter layer gọi decrypt server-side trong Vercel Node fn, KHÔNG log/return plaintext.
- Pattern ĐÚNG về security model — nhưng **moot** vì toàn bộ stack đã
  bị drop. Chỉ còn pgsodium extension + 1 key sót lại trong DB.

---

## Compare với VIA project

VIA project (`C:\Users\Admin\Documents\quản lý via, giao via và gửi via qua bot tele`)
**KHÔNG có vendor system.** Grep `vendor` trong `src/` của VIA: 0 hit.
VIA dùng model "via" / "request" / "warranty" (state machines), không
có khái niệm reseller-from-vendor.

Memory `via_project.md` liệt kê các thứ có thể port: service layer, csv,
crypto, audit, state machines, advisory lock — **không có vendor pattern.**
Wave 19 vendor system là **net-new** trong proxy project, không kế thừa
từ VIA.

---

## Q2: Nên ROLLBACK hay FINISH?

### Quyết định: **đã ROLLBACK xong rồi.** Không có lựa chọn FINISH.

Lý do user pivot (theo commit message `Wave 21A.5` + `Wave 21A`):

> "Most vendor sites don't have full APIs."
> "User-confirmed pivot: vendor API automation parked permanently."
> "The platform is manual-only from Wave 21A onward (lot/inventory model)."

ToS realities (memory `vendor_reseller_status.md`) củng cố quyết định:

- **3/4 vendor user đang dùng (Proxy-Seller / Youproxy / IPRoyal) RED** — cấm resale rõ ràng. Tự động hóa = vi phạm ToS.
- **Proxy-Cheap YELLOW** — white-label program tồn tại nhưng API là Beta v0.1 invite-only.
- **Vendor GREEN** (Infatica, Evomi, Torch, Rayobyte, HydraProxy, CyberYozh) đều **không phải vendor user đã có account.** Onboard = vetting 5–7 ngày + KYC + balance funding.

### Effort phân tích — nếu giả định FINISH (chỉ để cân nhắc)

| Component | Status pre-drop | Effort hoàn thành |
|-----------|----------------|-------------------|
| Schema 019/020/021/022 | Đã ship | 0 (đã có) — nhưng đã bị drop, phải re-apply |
| Adapter Webshare/Smartproxy | Scaffold | M — production hardening, retry, signature verify |
| Adapter Evomi/Infatica | Wave 20B kế hoạch (Evomi đã có code Wave 20B per commit `4affc71`, Infatica deferred Wave 20E) | M (Evomi finish) + L (Infatica from zero) |
| Purchase saga + outbox | Wave 20A đã ship (`b77edd1`) | S (đã có) — nhưng cần re-test sau pivot |
| CF Worker rate limiter | Wave 20C đã ship (`97203dc`) | 0 (đã có) — nhưng đã bị xóa, redeploy |
| /vendors/[id]/orders Buy modal | Wave 20D-1 đã ship (`175737e`) | 0 |
| Reconciler cron stuck orders | Wave 20A có `fn_release_stuck_vendor_orders` | 0 |
| **Vendor onboarding (KYC, balance funding, vetting)** | **CHƯA bắt đầu** | **L–XL** (out-of-code work, 5–7 ngày/vendor × 2 vendor minimum) |
| **ToS legal review** | **CHƯA** | **M** (cần lawyer/legal opinion cho mỗi vendor RED) |

→ Nếu FINISH: code effort M, **business effort XL** (KYC + ToS), và
sau khi xong vẫn vướng pivot rationale "most vendors lack APIs".

### Risk của ROLLBACK (đã thực hiện)

| Risk | Mitigation đã có |
|------|-----------------|
| Mất dữ liệu đã seed (Evomi/Infatica rows) | Không có dữ liệu khách hàng — chỉ là 2 row paused chưa từng có credential. Mất vô hại. |
| Production đã apply mig 019–023 | Mig 024 idempotent + DO-block VERIFY (SECTION 7) RAISE EXCEPTION nếu sót → safe |
| FK cascade phá vỡ proxies | Mig 024 SECTION 5 drop CHECK trước khi drop cols, thứ tự FK leaf-first → không vỡ |
| pgsodium key orphan | **Cố ý giữ** key `vendor_credentials_key` cho PITR window. Cần drop trong migration tương lai khi đã quá PITR retention. |
| Test suite gãy | Commit nói: 394/394 → 340/340 (54 vendor tests removed, no regression in kept code) |

→ Rollback **đã làm sạch, an toàn**.

---

## Bug list / Security issues còn sót

### CRITICAL
- (Không có) Stack đã drop hết, không còn surface area.

### HIGH
- **Memory drift** — `vendor_reseller_status.md` + `wave_roadmap.md` mô tả sai state hiện tại (vẫn nói Wave 19 ship + Wave 20 deferred). Người sau (kể cả AI) sẽ hiểu nhầm và thử "tiếp tục" Wave 20. **MUST UPDATE.**

### MEDIUM
- **pgsodium key `vendor_credentials_key` sót** trong DB. Mig 024 SECTION 6 cố ý giữ cho PITR. Nếu PITR window là 7 ngày (Supabase Pro default) thì sau 2026-05-03 là an toàn drop. Cần migration `041_drop_vendor_pgsodium_key.sql`.
- **`vendor_label` còn là free text trên `proxies`** (Wave 21A keep) — không validate enum, có thể typo `Webshare` vs `webshare` vs `web share`. Nếu muốn cost rollup chính xác cần normalize.

### LOW
- Migrations 019–022 vẫn nằm trong `supabase/migrations/` như "lịch sử". Không xóa (đúng pattern — migrations là append-only). Comment header trong mig 024 đã giải thích context.

---

## Recommendation cuối cùng

### KHÔNG FINISH. KHÔNG ROLLBACK THÊM. Chỉ làm 3 việc đồng bộ:

1. **[P0] Update memory files** (5 phút)
   - `vendor_reseller_status.md` → thêm header "STATUS: Vendor automation parked Wave 21A.5. Manual-only inventory model active." Giữ nội dung làm reference khi nào re-evaluate.
   - `wave_roadmap.md` → cập nhật "Shipped" list để bao gồm Wave 19 → 22S theo git log thực tế. Đặc biệt note Wave 21A.5 drop.
   - `MEMORY.md` index → thêm dòng "[Wave 21A.5 drop](wave_roadmap.md) — vendor automation pivot (manual-only from 2026-04-26)".

2. **[P1] Schedule pgsodium key drop** sau PITR window (sau 2026-05-03 nếu Supabase Pro 7-day PITR; sau 2026-05-26 nếu đã upgrade 30-day).
   - Tạo `supabase/migrations/041_drop_vendor_pgsodium_key.sql`:
     ```sql
     -- Drop orphan vendor_credentials_key sau khi PITR window đã pass.
     DO $$
     DECLARE v_id UUID;
     BEGIN
       SELECT id INTO v_id FROM pgsodium.valid_key WHERE name='vendor_credentials_key';
       IF v_id IS NOT NULL THEN
         PERFORM pgsodium.disable_key(v_id);
       END IF;
     END $$;
     ```
   - **Không drop pgsodium extension** — có thể dùng cho tính năng khác.

3. **[P2] Optional — normalize `vendor_label`** nếu user muốn cost rollup chính xác (Wave 22+):
   - Tạo bảng lookup `vendor_labels` (id, slug, display_name) hoặc enum.
   - Migration ALTER `proxies.vendor_label` → FK hoặc CHECK enum.
   - Ưu tiên thấp; chỉ làm khi user phản ánh data quality issue.

### KHÔNG làm các thứ sau (tránh re-introduce stack đã pivot):

- Không re-apply mig 019–022 hoặc tương đương.
- Không re-create `src/lib/vendors/` adapters.
- Không re-deploy CF Worker rate limiter cho vendor flow.
- Không add vendor onboarding tới khi user **explicitly** request và đã có legal/KYC clearance.

---

## Roadmap nếu user đổi ý sau này (FINISH path — chỉ tham khảo)

Nếu sau N tháng user thực sự muốn re-introduce vendor automation
(KYC done, ToS confirmed cho 2 vendor GREEN):

1. **Phase A — restore schema (S):** revive mig 019/020/021 nguyên văn; skip mig 022 cũ, viết seed mới chỉ cho vendor đã KYC.
2. **Phase B — adapter cho 1 vendor duy nhất (M):** chọn Evomi (đã có code Wave 20B làm reference từ git history `4affc71`). Test trên balance $20 trước khi scale.
3. **Phase C — saga + outbox (S):** restore Wave 20A code từ git history (`b77edd1`).
4. **Phase D — UI Buy modal (S):** restore Wave 20D-1 (`175737e`). Skip CF Worker phase 1 — dùng simple in-process token bucket.
5. **Phase E — QA + canary (M):** chạy 1 tuần trên dev với fake purchases; verify reconciler không leak; verify pgsodium key access path.
6. **Phase F — production rollout (S):** flip vendor.status=active; monitor first 100 orders manually.

Total: ~3–4 tuần dev + KYC vetting song song. **Vẫn không khuyến nghị**
trừ khi business case rõ ràng (manual model đang scale 10k proxies tốt).

---

## File paths đã review

- `supabase/migrations/019_wave19_vendor_schema.sql` (still in tree, historical)
- `supabase/migrations/020_wave19_pgsodium.sql` (still in tree, historical)
- `supabase/migrations/021_wave20a_saga_prereqs.sql` (still in tree, historical)
- `supabase/migrations/022_wave20b_seed_vendors.sql` (still in tree, historical)
- `supabase/migrations/024_wave21a5_drop_vendor_api.sql` (the rollback)
- `supabase/migrations/040_wave22s_drop_purchase_lots.sql` (purchase_lots also dropped Wave 22S)
- Git commits: `6dc867b` (W19), `b77edd1` (W20A), `4affc71` (W20B),
  `97203dc` (W20C), `175737e` (W20D-1), `ff9600c` (W21A), `571ba65` (W21A.5 drop)

---

## Summary 1-liner cho user

> "Tab Vendors đã bị rip out ở Wave 21A.5 (commit 571ba65, 2026-04-26).
> Memory files outdated 6 ngày. Pivot tới manual-only inventory đã
> hoàn tất sạch. Không cần FINISH — chỉ cần update memory + drop
> pgsodium key sót sau khi PITR window pass."

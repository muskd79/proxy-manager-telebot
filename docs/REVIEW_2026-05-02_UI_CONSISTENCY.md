# UI Consistency Review — 2026-05-02

Auditor: Claude (UI consistency mode). Phạm vi: scan thực tế `src/app/(dashboard)/**/*.tsx` + `src/components/**/*.tsx`. Mục tiêu: tìm button hỏng, dialog không nhất quán, toast text trộn ngôn ngữ, pattern không thống nhất giữa tab.

---

## Section 1 — Full button inventory

> Một số ô "Disabled state?" và "Loading state?" chỉ ghi cờ chính. Trùng lặp action button trong table-row đã gộp lại thành 1 dòng (vì cùng template).

### 1.1 Sidebar + Header (toàn cục)
| Tab | Button label | Action | File:line | Disabled | Loading | Confirm |
|---|---|---|---|---|---|---|
| Sidebar | (Logout icon) | `signOut` + redirect /login | sidebar.tsx:251-258 | — | — | NO |
| Sidebar | Collapse toggle (ChevronLeft) | toggle `collapsed` | sidebar.tsx:289-296 | — | — | — |
| Sidebar (mobile) | Menu | open Sheet | sidebar.tsx:309-313 | — | — | — |
| Header | Theme toggle (Sun/Moon) | `setTheme` | header.tsx:106-119 | — | — | — |
| Header | Bell (notifications) | **NO HANDLER** | header.tsx:122-138 | — | — | — |
| Header | Avatar dropdown trigger | open menu | header.tsx:141-154 | — | — | — |
| Header | Profile (dropdown item) | router push /profile | header.tsx:161-164 | — | — | — |
| Header | Logout (dropdown item) | `signOut` + redirect | header.tsx:166-169 | — | — | NO |
| LanguageSwitch | (icon dropdown) | toggle locale | language-switch.tsx | — | — | — |

### 1.2 Dashboard (`/dashboard`)
| Tab | Button label | Action | File:line | Disabled | Loading | Confirm |
|---|---|---|---|---|---|---|
| Dashboard | Refresh (RefreshCw) | `fetchStats` | dashboard/page.tsx:85-96 | `loading` | spin icon | — |
| Dashboard → Recent Requests | Approve (Check, icon-xs) | PUT status=approved | recent-requests.tsx:154-160 | — | — | **NO** |
| Dashboard → Recent Requests | Reject (X, icon-xs) | PUT status=rejected | recent-requests.tsx:162-168 | — | — | **NO** |

### 1.3 Proxies (`/proxies`)
| Tab | Button label | Action | File:line | Disabled | Loading | Confirm |
|---|---|---|---|---|---|---|
| Proxies | CSV (export) | `handleExport("csv")` | proxies/page.tsx:357-364 | — | — | — |
| Proxies | JSON (export) | `handleExport("json")` | proxies/page.tsx:365-372 | — | — | — |
| Proxies | Thêm proxy ▾ (dropdown) | open menu | proxies/page.tsx:382-391 | role gate | — | — |
| Proxies → DD item | Thêm đơn | open ProxyForm | proxies/page.tsx:393-401 | — | — | — |
| Proxies → DD item | Nhập hàng loạt | router /proxies/import?mode=paste | proxies/page.tsx:403-406 | — | — | — |
| Proxies → DD item | Nhập file (.txt) | router /proxies/import?mode=txt | proxies/page.tsx:407-410 | — | — | — |
| Proxies → DD item | Nhập CSV | router /proxies/import?mode=csv | proxies/page.tsx:411-414 | — | — | — |
| Proxies | Kiểm tra tất cả | `handleCheckAll` | proxies/page.tsx:425-442 | `checking` | Loader2 spin | — |
| Proxies | (bulk) Health check | `handleHealthCheck(selectedIds)` | proxies/page.tsx:460-467 | — | — | NO |
| Proxies | (bulk) Sửa | open ProxyBulkEdit | proxies/page.tsx:470-473 | — | — | — |
| Proxies | (bulk) Xoá | show AlertDialog | proxies/page.tsx:474-477 | — | — | YES (AlertDialog) |
| Proxies | (bulk) Bỏ chọn | `setSelectedIds([])` | proxies/page.tsx:480-487 | — | — | — |
| Proxies → Bulk delete dialog | Huỷ | close dialog | proxies/page.tsx:552 | — | — | — |
| Proxies → Bulk delete dialog | Xoá (Delete) | `handleBulkDelete` | proxies/page.tsx:553-561 | — | — | — |
| ProxyTable | Sort header (per col) | `onSort(col)` | proxy-table.tsx:121-132 | — | — | — |
| ProxyTable | … (MoreHorizontal mobile) | open dropdown | proxy-table.tsx:200-237 | — | — | — |
| ProxyTable → DD item | Xem chi tiết (Link) | router /proxies/[id] | proxy-table.tsx:214-219 | — | — | — |
| ProxyTable → DD item | Sửa | `onEdit(proxy)` | proxy-table.tsx:220-223 | — | — | — |
| ProxyTable → DD item | Kiểm tra sống/chết | `onHealthCheck` | proxy-table.tsx:224-227 | — | — | NO |
| ProxyTable → DD item | Xoá | `onDelete(proxy.id)` | proxy-table.tsx:229-235 | — | — | **NO (single delete!)** |
| ProxyTable | … (MoreHorizontal desktop) | open dropdown | proxy-table.tsx:406-443 | — | — | — |
| CredentialCell | Eye / EyeOff (password reveal) | toggle reveal | credential-cell.tsx:65-73 | — | — | — |
| CredentialCell | Copy | `clipboard.writeText` | credential-cell.tsx:75-86 | — | — | — |
| ProxyForm | Huỷ | close dialog | proxy-form.tsx:366-371 | — | — | — |
| ProxyForm | Tạo / Cập nhật (submit) | submit | proxy-form.tsx:373-375 | `saving` | text-only "Đang lưu..." | — |
| ProxyBulkEdit | Cancel | close dialog | proxy-bulk-edit.tsx:138 | — | — | — |
| ProxyBulkEdit | Update N Proxies | POST /api/proxies/bulk-edit | proxy-bulk-edit.tsx:139-142 | `loading` | Loader2 spin | NO |
| ProxyFilters | Xoá lọc | `clearFilters` | proxy-filters.tsx:256-261 | — | — | — |
| ProxyDetail | Copy | clipboard | proxy-detail.tsx:100-103 | — | — | — |
| ProxyDetail | Edit | `onEdit` | proxy-detail.tsx:104-107 | — | — | — |
| ProxyDetail | Health Check | `handleHealthCheck` | proxy-detail.tsx:108-120 | `checking` | Loader2 | — |
| ProxyDetail | Delete (destructive) | `onDelete` | proxy-detail.tsx:121-124 | — | — | **NO** |
| Pagination | First / Prev / Next / Last | `onPageChange` | pagination.tsx:114-171 | `!canGoPrev/!canGoNext` | — | — |
| Pagination | Page numbers (1..N) | `onPageChange(n)` | pagination.tsx:142-152 | — | — | — |
| Pagination | Go to (input) | `handleJump` Enter | pagination.tsx:177-186 | — | — | — |

### 1.4 Proxy import (`/proxies/import`)
| Tab | Button label | Action | File:line | Disabled | Loading | Confirm |
|---|---|---|---|---|---|---|
| Import | Auto-detect loại + alive | `handleProbe` | proxy-import.tsx:632-638 | `probing/importing/validCount===0` | Loader2 + % | — |
| Import | Import N | `handleImport` | proxy-import.tsx:639-645 | `importing/probing/validCount===0` | Loader2 | NO |

### 1.5 Categories (`/categories`)
| Tab | Button label | Action | File:line | Disabled | Loading | Confirm |
|---|---|---|---|---|---|---|
| Categories | Refresh | `load` | categories/page.tsx:185-195 | `loading` | spin | — |
| Categories | New category | open Form | categories/page.tsx:196-205 | — | — | — |
| Categories (row) | ArrowUp (move up) | `move(c, -1)` | categories/page.tsx:232-241 | `i===0` | — | — |
| Categories (row) | ArrowDown | `move(c, 1)` | categories/page.tsx:242-251 | `i===last` | — | — |
| Categories (row) | Eye/EyeOff | `toggleHidden` | categories/page.tsx:286-295 | — | — | NO |
| Categories (row) | Pencil (edit) | open form (editing) | categories/page.tsx:296-308 | — | — | — |
| Categories (row) | Trash2 (delete) | open ConfirmDialog | categories/page.tsx:309-318 | — | — | YES |
| EmptyState | Tạo danh mục đầu tiên | open form | categories/page.tsx:363-366 | — | — | — |
| ConfirmDialog | Cancel | close | categories/page.tsx (via shared) | — | — | — |
| ConfirmDialog | Delete category | `confirmDelete` | categories/page.tsx:348 | — | `loading` | text "..." |
| CategoryFormDialog | Huỷ | close | CategoryFormDialog.tsx:354-356 | `submitting` | — | — |
| CategoryFormDialog | Lưu / Tạo | `save` | CategoryFormDialog.tsx:357-360 | `!canSave` | Loader2 | — |
| CategoryFormDialog | (color preset, 8 buttons) | `setColor(c)` | CategoryFormDialog.tsx:209-222 | — | — | — |

### 1.6 Categorypicker (inline create dialog)
| Tab | Button label | Action | File:line | Disabled | Loading | Confirm |
|---|---|---|---|---|---|---|
| CategoryPicker | + Tạo danh mục mới (select item) | open dialog | category-picker.tsx:126-129 | — | — | — |
| CategoryPicker dialog | Huỷ | close | category-picker.tsx:158-165 | `creating` | — | — |
| CategoryPicker dialog | Tạo | POST /api/categories | category-picker.tsx:167-170 | `!newName.trim()` | Loader2 | — |

### 1.7 Users (`/users`)
| Tab | Button label | Action | File:line | Disabled | Loading | Confirm |
|---|---|---|---|---|---|---|
| Users | Export | `handleExport` (CSV download) | users/page.tsx:195-198 | — | — | NO (large download) |
| Users | Search (Kính lúp) | `handleSearch` | users/page.tsx:239 | — | — | — |
| Users | (bulk) Block | `setBulkAction("block")` | users/page.tsx:250-257 | — | — | YES (AlertDialog) |
| Users | (bulk) Unblock | `setBulkAction("unblock")` | users/page.tsx:258-264 | — | — | YES |
| Users | (bulk) Delete | `setBulkAction("delete")` | users/page.tsx:266-273 | — | — | YES |
| Users → Bulk dialog | Cancel | close | users/page.tsx:327 | — | — | — |
| Users → Bulk dialog | Confirm | `handleBulkAction` | users/page.tsx:328-336 | — | — | — |
| UserTable | Sort header (per col) | `toggleSort` | user-table.tsx:152-163 | — | — | — |
| UserTable | … (Settings icon) | open dropdown | user-table.tsx:266-269 | — | — | — |
| UserTable → DD | View Details (Link) | router /users/[id] | user-table.tsx:271-276 | — | — | — |
| UserTable → DD | Edit Rate Limits (Link) | router /users/[id]?tab=rate-limits | user-table.tsx:277-282 | — | — | — |
| UserTable → DD | Block / Unblock User | `handleBlockToggle` | user-table.tsx:284-296 | — | — | **NO (no confirm for block)** |
| UserTable → DD | Delete User | open AlertDialog | user-table.tsx:297-306 | — | — | YES |
| UserTable | Delete dialog Cancel | close | user-table.tsx:328 | — | — | — |
| UserTable | Delete dialog Delete | `handleDelete` | user-table.tsx:329-334 | — | — | — |
| UserDetail | Block / Unblock | `handleBlockToggle` | user-detail.tsx:160-173 | `isBlocking` | Loader2 | **NO** |
| UserInfoCard | Save Notes | PUT `/api/users/{id}` notes | user-info-card.tsx:162-167 | `isSavingNotes` | Loader2 | — |
| UserRateLimit | Save Changes | `handleSave` | user-rate-limit.tsx:251-258 | hierarchy invalid + `isSaving` | Loader2 | — |
| UserChatPanel | Load More (ChevronUp) | `loadMore` | user-chat-panel.tsx:141-153 | `isLoadingMore` | Loader2 | — |

### 1.8 Requests (`/requests`)
| Tab | Button label | Action | File:line | Disabled | Loading | Confirm |
|---|---|---|---|---|---|---|
| Requests | Filter (Lọc) | `handleSearch` | requests/page.tsx:227-230 | — | — | — |
| Requests | Batch Approve | open BatchApproveDialog | requests/page.tsx:243-247 | — | — | YES |
| Requests | Batch Reject | `handleBatchReject` (no dialog!) | requests/page.tsx:249-256 | — | — | **NO (silent destructive)** |
| RequestTable | Sort header | `toggleSort` | request-table.tsx:124-132 | — | — | — |
| RequestTable | … MoreHorizontal | open dropdown | request-table.tsx:248-251 | — | — | — |
| RequestTable → DD | View Details | `onView(req.id)` | request-table.tsx:253-256 | — | — | — |
| RequestTable → DD | Approve | `onApprove(req.id)` | request-table.tsx:260-263 | — | — | — |
| RequestTable → DD | Reject | `onReject(req.id)` | request-table.tsx:264-269 | — | — | — |
| ApproveDialog | Cancel | close | request-actions.tsx:159-160 | — | — | — |
| ApproveDialog | Approve | `handleApprove` | request-actions.tsx:162-168 | `isSubmitting/!selectedProxyId` | Loader2 | — |
| RejectDialog | Cancel | close | request-actions.tsx:247-248 | — | — | — |
| RejectDialog | Reject | `handleReject` | request-actions.tsx:250-257 | `isSubmitting` | Loader2 | — |
| BatchApproveDialog | Cancel | close | request-actions.tsx:323-324 | — | — | — |
| BatchApproveDialog | Approve All (N) | `handleBatchApprove` | request-actions.tsx:326-329 | `isSubmitting` | Loader2 | — |

### 1.9 Settings (`/settings`)
| Tab | Button label | Action | File:line | Disabled | Loading | Confirm |
|---|---|---|---|---|---|---|
| Settings | Lưu cài đặt | `requestSave` | settings/page.tsx:254-257 | `saving` | text "Đang lưu..." | YES (only if applyToExisting) |
| Settings | Test Connection | `handleTestBot` | settings/page.tsx:508-515 | `testingBot` | text "Testing..." | — |
| Settings | Copy webhook URL (icon) | clipboard | settings/page.tsx:570-572 | — | — | — |
| Settings | Go to Dashboard (no-perm fallback) | router push | settings/page.tsx:225-229 | — | — | — |
| ConfirmDialog Wave 22X | Áp dụng cho mọi user | `handleSave` | settings/page.tsx:585-600 | `loading` | text "..." | — |

### 1.10 Admins (`/admins`)
| Tab | Button label | Action | File:line | Disabled | Loading | Confirm |
|---|---|---|---|---|---|---|
| Admins | Refresh | `fetchAdmins` | admins/page.tsx:305-317 | `loading` | spin | — |
| Admins | Thêm quản trị viên (Dialog trigger) | open dialog | admins/page.tsx:255-259 | — | — | — |
| Admins → Invite dialog | Huỷ | close | admins/page.tsx:293-298 | — | — | — |
| Admins → Invite dialog | Gửi lời mời | `handleInvite` | admins/page.tsx:299-301 | `inviteLoading` | text "Đang gửi..." | — |
| Admins (row) | (role select) | `handleRoleChange` | admins/page.tsx:393-405 | — | — | YES (ConfirmDialog) |
| Admins (row) | Tạm khoá / Kích hoạt | `handleToggleActive` | admins/page.tsx:406-412 | — | — | YES (ConfirmDialog) |
| Admins (row) | Quản lý (Link) | router /admins/[id] | admins/page.tsx:414-418 | — | — | — |
| ConfirmDialog | Đổi vai trò | `confirmRoleChange` | admins/page.tsx:431-449 | — | — | — |
| ConfirmDialog | Tạm khoá / Kích hoạt | `confirmToggleActive` | admins/page.tsx:452-467 | — | — | — |
| Admins/[id] | Back (icon) | Link /admins | admins/[id]/page.tsx:236-240 | — | — | — |
| Admins/[id] | Save Changes | `handleSaveProfile` | admins/[id]/page.tsx:300-303 | `saving` | text "Saving..." | — |
| Admins/[id] | Reset (password) | open Dialog | admins/[id]/page.tsx:325-328 | — | — | YES (Dialog) |
| Admins/[id] | Disable 2FA (Force) | open AlertDialog | admins/[id]/page.tsx:340-343 | — | — | YES |
| Admins/[id] | Revoke (sessions) | open AlertDialog | admins/[id]/page.tsx:355-358 | — | — | YES |
| Admins/[id] | Delete (Hard) | open DangerousConfirmDialog | admins/[id]/page.tsx:369-372 | — | — | YES (type-to-confirm) |
| Admins/[id] | Generate random / Set specific | mode toggle | admins/[id]/page.tsx:388-401 | — | — | — |
| Admins/[id] | Cancel (reset pwd) | close | admins/[id]/page.tsx:413 | — | — | — |
| Admins/[id] | Reset password (submit) | `handleResetPassword` | admins/[id]/page.tsx:416-423 | `acting/<12 chars` | — | — |
| Admins/[id] | Done (generated pwd shown) | close | admins/[id]/page.tsx:456 | — | — | — |
| Admins/[id] | Copy (generated pwd) | clipboard | admins/[id]/page.tsx:442-452 | — | — | — |
| Admins/[id] | Cancel (disable 2FA) | close | admins/[id]/page.tsx:473 | — | — | — |
| Admins/[id] | Disable 2FA (action) | `handleDisable2FA` | admins/[id]/page.tsx:474-476 | `acting` | — | — |
| Admins/[id] | Cancel (revoke) | close | admins/[id]/page.tsx:492 | — | — | — |
| Admins/[id] | Revoke (action) | `handleRevokeSessions` | admins/[id]/page.tsx:493-495 | `acting` | — | — |

### 1.11 Profile (`/profile`)
| Tab | Button label | Action | File:line | Disabled | Loading | Confirm |
|---|---|---|---|---|---|---|
| Profile (Cá nhân) | Lưu thay đổi | `handleSave` (full_name+telegram_id) | profile/page.tsx:258-261 | `saving` | text "Đang lưu..." | — |
| Profile (Bảo mật → Pwd) | Đổi mật khẩu | `handleChange` | profile/page.tsx:349-356 | `loading/!currentPwd/!newPwd` | Loader2 | — |
| Profile (Bảo mật → Email) | Gửi link xác nhận | `handleChange` (email) | profile/page.tsx:423-430 | `loading/!pwd/!newEmail` | Loader2 | — |
| Profile (2FA) | Bật 2FA | `handleStart` | profile/page.tsx:557-560 | `loading` | — | — |
| Profile (2FA) | Xác nhận & Bật | `handleVerify` | profile/page.tsx:586-589 | `loading/code.length!==6` | — | — |
| Profile (2FA) | Tạo lại mã backup | open Dialog | profile/page.tsx:595-601 | `loading` | — | — |
| Profile (2FA) | Tắt 2FA | open Dialog | profile/page.tsx:602-608 | — | — | YES (password gate) |
| Profile (2FA Disable dialog) | Huỷ | close | profile/page.tsx:630-632 | — | — | — |
| Profile (2FA Disable dialog) | Tắt 2FA (action) | `handleDisable` | profile/page.tsx:633-639 | `loading/!disablePwd` | — | — |
| Profile (Regenerate dialog) | Huỷ | close | profile/page.tsx:662-664 | — | — | — |
| Profile (Regenerate dialog) | Tạo mã mới | `handleRegenerate` | profile/page.tsx:665-670 | `loading/!regeneratePwd` | — | — |
| Profile (Backup codes shown) | Sao chép tất cả | clipboard | profile/page.tsx:692-702 | — | — | — |
| Profile (Backup codes shown) | Đã lưu xong | close | profile/page.tsx:706 | — | — | — |
| Profile (Sessions) | Đăng xuất tất cả phiên khác | open ConfirmDialog | profile/page.tsx:782-794 | `revoking` | Loader2 | YES |
| Profile (Sessions ConfirmDialog) | Thu hồi | `handleRevoke` | profile/page.tsx:771-781 | — | — | — |

### 1.12 Logs / History
| Tab | Button label | Action | File:line | Disabled | Loading | Confirm |
|---|---|---|---|---|---|---|
| Logs | Xuất CSV | `handleExport` | logs/page.tsx:136-139 | — | — | — |
| Logs | Làm mới | `fetchLogs` | logs/page.tsx:140-150 | `loading` | spin | — |
| Logs | Trước | `setPage(p-1)` | logs/page.tsx:356-362 | `page<=1` | — | — |
| Logs | Sau | `setPage(p+1)` | logs/page.tsx:363-369 | `page>=totalPages` | — | — |
| History | Xuất CSV | `handleExport` | history/page.tsx:176-179 | — | — | — |
| History | Làm mới | `fetchHistory` | history/page.tsx:180-190 | `loading` | spin | — |
| History | Trước / Sau | `setPage` | history/page.tsx:344-359 | as logs | — | — |

### 1.13 Trash (`/trash`)
| Tab | Button label | Action | File:line | Disabled | Loading | Confirm |
|---|---|---|---|---|---|---|
| TrashProxies (row) | Restore | `handleRestore` | trash-proxies.tsx:155-162 | — | — | **NO** |
| TrashProxies (row) | Delete (AlertDialogTrigger) | open dialog | trash-proxies.tsx:164-167 | — | — | YES |
| TrashProxies dialog | Cancel | close | trash-proxies.tsx:179 | — | — | — |
| TrashProxies dialog | Delete permanently | `handlePermanentDelete` | trash-proxies.tsx:180-186 | — | — | — |
| TrashUsers (row) | Restore | `handleRestore` | trash-users.tsx:150-157 | — | — | **NO** |
| TrashUsers (row) | Delete | open dialog | trash-users.tsx:159-162 | — | — | YES |
| TrashRequests (row) | Restore | `handleRestore` | trash-requests.tsx:161-168 | — | — | **NO** |
| TrashRequests (row) | Delete | open dialog | trash-requests.tsx:170-173 | — | — | YES |

### 1.14 Bot
| Tab | Button label | Action | File:line | Disabled | Loading | Confirm |
|---|---|---|---|---|---|---|
| Bot landing | (BotCards link) | router | bot/page.tsx:84-106 | — | — | — |
| Bot config | Mở Cài đặt chung | router /settings | bot/config/page.tsx:60-65 | — | — | — |
| Bot Simulator | (commands grid, 12 buttons) | `sendCommand(cmd.name)` | bot/simulator/page.tsx:360-376 | `!selectedUserId/isSending` | — | — |
| Bot Simulator | Send (custom) | `handleCustomCommand` | bot/simulator/page.tsx:393-403 | `!selectedUserId/!cmd/isSending` | Loader2 | — |
| Bot Simulator | Clear | `clearHistory` | bot/simulator/page.tsx:442-450 | — | — | NO |
| Bot Simulator → InlineKeyboard | (per button) | `onCallbackClick` | bot/simulator/page.tsx:596-609 | `!callback_data/isSending` | — | — |
| Bot Simulator (no perm) | Về Quản lý Bot | router /bot | bot/simulator/page.tsx:269-274 | — | — | — |

### 1.15 Chat (`/chat`)
| Tab | Button label | Action | File:line | Disabled | Loading | Confirm |
|---|---|---|---|---|---|---|
| Chat → ChatWindow | Profile (link) | router /users/[id] | chat-window.tsx:116-119 | — | — | — |
| Chat → ChatWindow | Load older messages | `onLoadMore` | chat-window.tsx:130-143 | `isLoading` | Loader2 | — |
| Chat → ChatWindow | Send (icon) | `handleSendMessage` | chat-window.tsx:180-182 | `!replyText.trim()/sending` | Loader2 | — |

### 1.16 Check proxy (`/check-proxy`)
| Tab | Button label | Action | File:line | Disabled | Loading | Confirm |
|---|---|---|---|---|---|---|
| CheckProxy | Kiểm tra (lineCount) | `handleCheck` | check-proxy/page.tsx:261-268 | `submitting/lineCount===0` | Loader2 | — |
| CheckProxy | Xoá | `handleClear` | check-proxy/page.tsx:269-272 | `submitting` | — | — |
| CheckProxy | Xuất CSV | `handleExport` | check-proxy/page.tsx:337-340 | — | — | — |
| CheckProxy (no perm) | Về Quản lý proxy | router /proxies | check-proxy/page.tsx:216-221 | — | — | — |

**Tổng đếm button (giá trị thực tế tìm được):** ~140+ button (đã gộp các template repeated). File `<Button` xuất hiện 143 lần qua 49 file, `onClick=` xuất hiện 156 lần qua 46 file (Grep).

---

## Section 2 — Modal / Dialog inventory

| Modal | Trigger | Title | Footer buttons | Loading? | Validation? | Đóng-by-X? |
|---|---|---|---|---|---|---|
| ProxyForm (Dialog) | Sidebar "Thêm proxy → Thêm đơn" + table row Sửa | Sửa/Thêm proxy | Huỷ + Tạo/Cập nhật | YES (`saving`) | Zod schema (host/port/type) | Default Dialog X |
| ProxyBulkEdit (Dialog) | (bulk) Sửa | Bulk Edit N Proxies | Cancel + Update N | YES Loader2 | "No fields to update" toast | Default Dialog X |
| ProxyBulkDelete (AlertDialog) | (bulk) Xoá | proxies.deleteProxies | Huỷ + Xoá | NO loading state | text-only | NO X (AlertDialog không có) |
| ProxyTable (mobile) DD | (icon) | — | — | — | — | — |
| CategoryFormDialog (Dialog) | New / Edit | Sửa/Tạo danh mục | Huỷ + Lưu/Tạo | Loader2 | `name.trim().length>0` | Default Dialog X |
| ConfirmDialog (Categories delete) | row Trash2 | Delete category? | Cancel + Delete category | text "..." | — | swallow when loading |
| CategoryPicker → Tạo dialog (Dialog) | "+ Tạo danh mục mới" | Tạo danh mục mới | Huỷ + Tạo | Loader2 | `newName.trim()` | Default Dialog X |
| Users bulk action (AlertDialog) | bulk Block/Unblock/Delete | dynamic title | Cancel + Confirm | NO state shown | — | NO X |
| UserTable single delete (AlertDialog) | row DD → Delete User | Delete User | Cancel + Delete | NO | — | NO X |
| Approve (Dialog) | row Approve | Approve Request | Cancel + Approve | Loader2 | `selectedProxyId` required | Default Dialog X |
| Reject (Dialog) | row Reject | Reject Request | Cancel + Reject | Loader2 | optional reason | Default Dialog X |
| BatchApprove (Dialog) | bulk Batch Approve | Batch Approve Requests | Cancel + Approve All | Loader2 | — | Default Dialog X |
| Settings ConfirmDialog | requestSave (only if applyToExisting) | Áp dụng cho TẤT CẢ user hiện có? | Huỷ + Áp dụng cho mọi user | text "..." | — | swallow when loading |
| Admins Invite (Dialog) | Thêm quản trị viên | Mời quản trị viên | Huỷ + Gửi lời mời | text only | `inviteEmail` truthy | Default Dialog X |
| Admins ConfirmDialog (role) | Select onValueChange | Đổi vai trò? | Huỷ + Đổi vai trò | NO loading | — | swallow |
| Admins ConfirmDialog (active) | Tạm khoá/Kích hoạt | dynamic title | Huỷ + dynamic | NO loading | — | swallow |
| Admins/[id] Reset password (Dialog) | Reset button | Reset password for {email} | Cancel + Reset password | NO state | min 12 chars | Default X |
| Admins/[id] Generated pwd (Dialog) | (auto-open after reset) | New password generated | Done | — | — | Default X |
| Admins/[id] Disable 2FA (AlertDialog) | Disable button | Force-disable 2FA? | Cancel + Disable 2FA | `acting` | — | NO X |
| Admins/[id] Revoke (AlertDialog) | Revoke | Revoke all sessions? | Cancel + Revoke | `acting` | — | NO X |
| Admins/[id] Hard delete (DangerousConfirmDialog) | Delete | Xoá vĩnh viễn {email}? | Huỷ + Xoá vĩnh viễn | text "Đang xử lý..." | type email exact | swallow |
| Profile (Disable 2FA, Dialog) | Tắt 2FA | Tắt 2FA | Huỷ + Tắt 2FA | NO state | password not empty | Default X |
| Profile (Regenerate, Dialog) | Tạo lại mã backup | Tạo lại mã backup 2FA | Huỷ + Tạo mã mới | NO state | password not empty | Default X |
| Profile (Backup codes, Dialog) | (auto after enroll/regen) | Lưu mã backup của bạn | Đã lưu xong | — | — | Default X |
| Profile (Sessions, ConfirmDialog) | Đăng xuất tất cả | Thu hồi các phiên khác? | Huỷ + Thu hồi | text "..." | — | swallow |
| TrashProxies row (AlertDialog) | row Delete | Permanently delete? | Cancel + Delete permanently | NO | — | NO X |
| TrashUsers row (AlertDialog) | row Delete | Permanently delete? | Cancel + Delete permanently | NO | — | NO X |
| TrashRequests row (AlertDialog) | row Delete | Permanently delete? | Cancel + Delete permanently | NO | — | NO X |
| Sidebar (Sheet) | mobile Menu | — (sheet, not dialog) | — | — | — | swipe / X built-in |

**Tổng:** 27 modal/dialog rõ ràng + 1 mobile Sheet.

---

## Section 3 — Toast inventory

> Quy ước: severity = `success` | `error` | `info` | `warning`. "vi" = Tiếng Việt; "en" = English; "mix" = ngôn ngữ trộn (sẽ flag).

| Action | Toast text | Severity | File:line | Lang |
|---|---|---|---|---|
| Logout (sidebar) | Logged out successfully | success | sidebar.tsx:273 | en |
| Logout (header) | Logged out successfully | success | header.tsx:77 | en |
| Login | Login successful | success | login/page.tsx:46 | en |
| Login error | (error.message) | error | login/page.tsx:39 | dynamic |
| Login unexpected | An unexpected error occurred | error | login/page.tsx:50 | en |
| Reset password | Password has been reset successfully | success | reset-password/page.tsx:53 | en |
| Reset password unexpected | An unexpected error occurred | error | reset-password/page.tsx:56 | en |
| 2FA recover success | (body.message ?? "Đã gỡ 2FA") | success | recover-2fa/page.tsx:44 | vi (fallback) |
| 2FA recover error | (body.error ?? "Không khớp thông tin") | error | recover-2fa/page.tsx:46 | vi |
| ProxiesPage healthCheckComplete | t("proxies.healthCheckComplete") {count} | success | proxies/page.tsx:329 | i18n |
| ProxiesPage healthCheckFailed | t("proxies.healthCheckFailed") | error | proxies/page.tsx:334 | i18n |
| ProxiesPage noProxiesToCheck | t("proxies.noProxiesToCheck") | info | proxies/page.tsx:313 | i18n |
| ProxiesPage bulk delete success | Đã chuyển {ok} proxy vào Thùng rác | success | proxies/page.tsx:281 | vi |
| ProxiesPage bulk delete fail | Xoá thất bại cho cả {failed} proxy | error | proxies/page.tsx:283 | vi |
| ProxiesPage bulk delete partial | Xoá thành công {ok}/{n} ({failed} lỗi) | warning | proxies/page.tsx:285 | vi |
| Users bulk action complete | {bulkAction} completed for {n}/{total} users | success | users/page.tsx:123 | **en (and uses raw bulkAction key)** |
| Users export success | t("users.exportSuccess") | success | users/page.tsx:171 | i18n |
| Users export failed | t("users.exportFailed") | error | users/page.tsx:174 | i18n |
| Requests load failed | t("requests.loadFailed") | error | requests/page.tsx:96 | i18n |
| Requests batch reject result | t("requests.batchRejectResult") {success}/{total} | success | requests/page.tsx:183 | i18n |
| Approve dialog: select proxy | Please select a proxy to assign | error | request-actions.tsx:73 | en |
| Approve dialog: load fail | Failed to load available proxies | error | request-actions.tsx:58 | en |
| Approve dialog: success | Request approved | success | request-actions.tsx:89 | en |
| Approve dialog: api fail | (json.error ?? "Failed to approve request") | error | request-actions.tsx:94 | en |
| Approve dialog: catch | An error occurred | error | request-actions.tsx:98 | en |
| Reject dialog: success | Request rejected | success | request-actions.tsx:205 | en |
| Reject dialog: api fail | Failed to reject request | error | request-actions.tsx:211 | en |
| BatchApprove: result | {n}/{total} requests approved | success | request-actions.tsx:297 | en |
| BatchApprove: catch | An error occurred during batch approval | error | request-actions.tsx:302 | en |
| Settings: save | Đã lưu cài đặt | success | settings/page.tsx:163 | vi |
| Settings: save fail | (err.error ?? "Failed to save settings") | error | settings/page.tsx:166 | en (fallback) |
| Settings: bot connect | "Bot is connected!" / "Bot connection failed" | success | settings/page.tsx:188 | en |
| Settings: bot connect fail | Kết nối bot thất bại | error | settings/page.tsx:193 | vi |
| Settings: copy webhook | Đã chép URL webhook | success | settings/page.tsx:212 | vi |
| Admins invite success | Admin invited successfully | success | admins/page.tsx:125 | en |
| Admins invite fail | (err.error ?? "Failed to invite admin") | error | admins/page.tsx:131 | en (fallback) |
| Admins role change | Đã đổi vai trò: {email} → {role} | success | admins/page.tsx:172 | vi |
| Admins role change fail | Đổi vai trò thất bại | error | admins/page.tsx:176, 180 | vi |
| Admins toggle active | Đã tạm khoá/kích hoạt {email} | success | admins/page.tsx:207 | vi |
| Admins toggle active fail | Cập nhật thất bại | error | admins/page.tsx:215, 219 | vi |
| Admins/[id] profile saved | Profile updated | success | admins/[id]:139 | en |
| Admins/[id] generic fail | Failed | error | admins/[id]:142,169,186,202,218 | en |
| Admins/[id] copy generated pwd | Copied to clipboard | success | admins/[id]:447 | en |
| Categories: load fail | (body.error ?? "Failed to load categories") | error | categories:62 | en |
| Categories: reorder fail | (data.error ?? "Reorder failed") | error | categories:112,117 | en |
| Categories: visibility | Category visible / Category hidden | success | categories:133 | en |
| Categories: delete | Category deleted | success | categories:152 | en |
| Categories: form created | Category created/updated | success | CategoryFormDialog:160 | en |
| CategoryPicker: empty name | Tên danh mục không được trống | error | category-picker:77 | vi |
| CategoryPicker: created | Đã tạo danh mục "{name}" | success | category-picker:98 | vi |
| ProxyBulkEdit: no fields | No fields to update (status or notes required) | error | proxy-bulk-edit:63 | en |
| ProxyBulkEdit: result | Updated {ok}/{n} proxies | success | proxy-bulk-edit:79 | en |
| ProxyBulkEdit: fail | Failed to update proxies | error | proxy-bulk-edit:86 | en |
| ProxyImport: probe error per chunk | (body.error ?? `Probe failed at chunk {i}`) | error | proxy-import:272 | en |
| ProxyImport: probe summary | Probed {n} — {alive} alive, {dead} dead. Loại đã detect... | success | proxy-import:304 | **mix vi+en** |
| ProxyImport: import fail | (body.error ?? "Import failed") | error | proxy-import:366,370 | en |
| ProxyImport: no proxies | No proxies to import | error | proxy-import:322 | en |
| CheckProxy: max lines | Tối đa {N} dòng / lần check | error | check-proxy:143 | vi |
| CheckProxy: invalid lines | Không có dòng hợp lệ để kiểm tra | error | check-proxy:150 | vi |
| CheckProxy: probe fail | (body.error ?? "Probe thất bại") | error | check-proxy:170 | vi |
| CheckProxy: probe success | Đã kiểm tra {n} proxy — {alive} sống | success | check-proxy:176 | vi |
| CheckProxy: connect error | Lỗi kết nối khi kiểm tra | error | check-proxy:179 | vi |
| Profile: load fail | Tải hồ sơ thất bại | error | profile:89 | vi |
| Profile profile-tab saved | Đã cập nhật hồ sơ | success | profile:218 | vi |
| Profile pwd weak | Mật khẩu mới tối thiểu 12 ký tự | error | profile:278 | vi |
| Profile pwd mismatch | Mật khẩu không khớp | error | profile:282 | vi |
| Profile pwd success | (body.message ?? "Đã đổi mật khẩu...") | success | profile:297 | vi (fallback) |
| Profile email submit success | (body.message ?? "Đã gửi link xác nhận") | success | profile:383 | vi (fallback) |
| Profile 2FA enabled | Đã bật 2FA! | success | profile:479 | vi |
| Profile 2FA invalid code | (body.error ?? "Mã không hợp lệ") | error | profile:485 | vi (fallback) |
| Profile 2FA disabled | Đã tắt 2FA | success | profile:502 | vi |
| Profile 2FA backup regen | Đã cấp mã backup mới | success | profile:526 | vi |
| Profile copy backup | Đã chép toàn bộ mã | success | profile:697 | vi |
| Profile sessions revoked | Đã thu hồi các phiên khác | success | profile:747 | vi |
| BotSimulator: select user | Hãy chọn người dùng trước | error | bot/simulator:172 | vi |
| BotSimulator: cmd fail | (json.error ?? "Lệnh thất bại") | error | bot/simulator:184 | vi |
| BotSimulator: cmd send fail | Gửi lệnh thất bại | error | bot/simulator:188 | vi |
| BotSimulator: callback fail | Gửi callback thất bại | error | bot/simulator:213 | vi |
| BotSimulator: clear | Đã xoá lượt xem hội thoại | success | bot/simulator:234 | vi |
| BotSimulator: load users fail | Tải danh sách người dùng thất bại | error | bot/simulator:89 | vi |
| ChatWindow: send fail | Failed to send message | error | chat-window:61,65 | en |
| UserDetail: load fail | Failed to load user details | error | user-detail:54 | en |
| UserDetail: block toggle success | User blocked / User unblocked | success | user-detail:90 | en |
| UserDetail: block toggle fail | Failed to update user status | error | user-detail:93 | en |
| UserDetail: catch | An error occurred | error | user-detail:97 | en |
| UserInfoCard: notes saved | Notes saved | success | user-info-card:49 | en |
| UserInfoCard: notes fail | Failed to save notes | error | user-info-card:51,55 | en |
| UserRateLimit: saved | Rate limits updated successfully | success | user-rate-limit:69 | en |
| UserRateLimit: fail | Failed to update rate limits / An error occurred while saving | error | user-rate-limit:71,75 | en |
| CredentialCell: copied | Đã chép mật khẩu / Đã chép username | success | credential-cell:46 | vi |
| CredentialCell: fail | Không chép được | error | credential-cell:49 | vi |

**Tổng:** ~80+ toast unique. Quy tắc severity: hầu hết đúng (success/error/info/warning), chỉ proxies bulk-delete dùng `warning` cho partial — đây là pattern duy nhất trong codebase.

---

## Section 4 — Phát hiện hỏng (broken UI)

| # | Severity | File:line | Mô tả |
|---|---|---|---|
| B1 | HIGH | header.tsx:122-138 | Bell button hoàn toàn không có `onClick` — chỉ render badge số. User click chuông → không gì xảy ra. Phải route /requests hoặc mở popover. |
| B2 | HIGH | bot/config/page.tsx | Toàn page "Sắp ra mắt — Wave 22V" — có "Coming soon" badge trên /bot landing nữa (bot/page.tsx:91-94). Tab tồn tại trong sidebar/sub-tabs nhưng không cung cấp giá trị. |
| B3 | HIGH | proxy-table.tsx:229-235, proxy-detail.tsx:121-124 | Single-proxy delete (cả mobile + desktop dropdown + detail page) **KHÔNG có confirm dialog** — chỉ gọi `onDelete(id)` thẳng vào parent → DELETE /api/proxies/{id}. Bulk có dialog, single thì không → inconsistent + nguy hiểm. |
| B4 | HIGH | requests/page.tsx:249-256 | "Batch Reject" button → gọi `handleBatchReject` thẳng → loop PUT N requests → không confirm dialog. "Batch Approve" cùng vị trí thì có dialog. |
| B5 | HIGH | user-table.tsx:284-296 | Block/Unblock User trong dropdown → `handleBlockToggle(user)` → trực tiếp PUT, không confirm. Block là destructive (user mất truy cập). |
| B6 | HIGH | user-detail.tsx:160-173 | Block/Unblock button trên header user detail → trực tiếp gọi PUT, không confirm. |
| B7 | HIGH | trash-proxies.tsx:155-162, trash-users.tsx:150-157, trash-requests.tsx:161-168 | "Restore" trong trash gọi PUT thẳng → không confirm + không hiện toast (chỉ refetch). User không biết action đã chạy chưa. |
| B8 | HIGH | trash-proxies.tsx:81-92, trash-users.tsx:80-91, trash-requests.tsx:80-91 | `handlePermanentDelete` không hiển thị toast success/fail — silent. |
| B9 | HIGH | dashboard/recent-requests.tsx:154-168 | Approve/Reject trên dashboard widget — gọi thẳng API không confirm. Cùng action trong /requests có dialog (Approve), /requests batch reject cũng không có. **Triple inconsistent.** |
| B10 | HIGH | proxy-bulk-edit.tsx:114-121 | Country input trong bulk edit dialog **disabled** vĩnh viễn với placeholder "(deferred — not yet wired into bulk RPC)". Giữ trong UI là dead UI. |
| B11 | HIGH | bot/simulator/page.tsx:229-238 | "Clear" chỉ xoá local state, không xoá DB. User nghĩ đã xoá tin nhắn nhưng tin vẫn ở DB. Toast "Đã xoá lượt xem hội thoại" hơi mơ hồ — không nói rõ "chỉ xoá hiển thị". |
| B12 | HIGH | proxy-form.tsx:160-164 | `handleSubmit` catch error chỉ `console.error` — không hiện toast. User submit form → fail → không feedback. |
| B13 | HIGH | trash-proxies.tsx:66-79 | `handleRestore` catch chỉ console.error, không toast. |
| B14 | HIGH | settings/page.tsx:570-572 | Copy webhook URL: `navigator.clipboard.writeText` không có try/catch fallback (Safari/Firefox quyền clipboard có thể fail) → silent. CredentialCell có. |
| B15 | HIGH | check-proxy/page.tsx:185-202 | `handleExport` không có toast on success. CSV download silent. |
| B16 | HIGH | logs/page.tsx:91-114, history/page.tsx:107-135 | CSV export tương tự — không toast. |
| B17 | HIGH | user-info-card.tsx:40-59 | Save notes — không validate độ dài; ghi notes 100k ký tự cũng OK; server có thể reject mà UI không cảnh báo. |
| B18 | HIGH | bot/simulator/page.tsx:444-450 | "Clear" button không disabled khi `selectedUserId` null (nhưng panel cũng không hiện khi không chọn user, nên không gây lỗi nhưng dư thừa render). |
| B19 | HIGH | requests/page.tsx:163-167 | `handleView(id)` chỉ `setActiveRequestId` rồi đóng cả 2 dialog approve/reject → không mở dialog detail nào → action **không có UI hậu quả**. "View Details" trên dropdown bị hỏng. |
| B20 | HIGH | proxies/page.tsx:341-343 | `handleExport` mở `window.open(url)` — popup blocker chặn → không feedback; nên dùng anchor download như users page. |
| B21 | MEDIUM | user-chat-panel.tsx (entire) | Read-only chat panel ở /users/[id]?tab=chat — KHÔNG cho admin gửi tin nhắn. Trong khi /chat global lại có ChatWindow với reply input. Inconsistent. |
| B22 | MEDIUM | proxies/page.tsx:254-260 | `handleDelete(id)` cho single delete catch sai logic — không có try/catch, không toast. |
| B23 | MEDIUM | check-proxy/page.tsx:269-272 | "Xoá" button → `handleClear` → reset local state, không có confirm dù user đã probe 1000 dòng và có thể mất kết quả. |
| B24 | MEDIUM | sidebar.tsx:122 | `t("sidebar.checkProxy")` — i18n key tồn tại nhưng tab này quan trọng (Wave 22V). Nếu i18n bị missing → label trống. |
| B25 | MEDIUM | proxies/page.tsx (entire) | Refresh button **không có** trên trang Proxies (có ở Dashboard/Logs/History/Categories/Admins). Inconsistent — tab có nhiều data nhất lại không có manual refresh. |
| B26 | MEDIUM | requests/page.tsx (entire) | Refresh button không có. |
| B27 | MEDIUM | users/page.tsx (entire) | Refresh button không có. |
| B28 | MEDIUM | profile/page.tsx (Cá nhân) | "Lưu thay đổi" không validate Telegram ID format (chỉ ép Number). Ghi `telegram_id=0` có khả năng pass. |
| B29 | MEDIUM | request-actions.tsx:280-307 | BatchApproveDialog dùng for-loop tuần tự PUT — chậm và không tổng kết error count đẹp. ProxiesPage có dùng allSettled. |
| B30 | MEDIUM | settings/page.tsx:524 | Bot Token Input là `type="password"` nhưng không có nút Reveal/Hide hay Copy. CredentialCell pattern không được apply. |
| B31 | MEDIUM | profile/page.tsx:323-329 | Password input "Mật khẩu hiện tại" — không có reveal toggle (3 pwd input total). |
| B32 | MEDIUM | proxy-form.tsx:288-295 | "Mật khẩu" cho proxy là `type="password"` không có reveal — admin không thấy mình paste đúng pwd hay không. |
| B33 | MEDIUM | proxy-bulk-edit.tsx (entire) | Status select ko đầy đủ enum — thiếu `available/maintenance/banned` mà ProxyStatus có thể có thêm. Hard-coded 3 option. |

---

## Section 5 — Phát hiện không nhất quán (inconsistencies)

| # | Tiêu đề | Mô tả ngắn | Files |
|---|---|---|---|
| I1 | Confirm dialog: 3 patterns đồng tồn | (a) Native `<AlertDialog>` (proxies bulk delete, users bulk, trash items, admin/[id] disable2fa+revoke, user-table single delete); (b) shared `<ConfirmDialog>` (categories delete, settings apply-existing, admins role/active, profile sessions); (c) `<DangerousConfirmDialog>` (admin hard delete only). | shared/confirm-dialog.tsx, shared/dangerous-confirm-dialog.tsx, ui/alert-dialog.tsx |
| I2 | Single delete vs bulk delete | Bulk delete proxies/users có confirm dialog; single delete proxy KHÔNG có dialog (proxy-table dropdown + proxy-detail). User-table single delete CÓ. Logic flip-flop. | proxies/page.tsx, proxy-table.tsx, user-table.tsx |
| I3 | Toast lang mix | proxies/users/admins page mix vi/en theo hàm — admins/[id] toàn en, settings nửa vi nửa en, request-actions toàn en, check-proxy toàn vi. | xem section 3 |
| I4 | "Refresh" button không thống nhất | Có ở: Dashboard, Logs, History, Categories, Admins. Không có ở: Proxies, Users, Requests, Trash, Bot, Profile. | xem section 4 |
| I5 | Loading state cho submit button | (a) `Loader2 spin` (Profile, RequestActions, ProxyImport, CategoryFormDialog, ProxyBulkEdit); (b) text-only "Đang lưu..." (Settings, ProxyForm, Admins/[id]); (c) text "..." (ConfirmDialog default); (d) text "Đang xử lý..." (DangerousConfirmDialog). 4 patterns. | nhiều file |
| I6 | "Cancel" / "Huỷ" label | Mix tiếng: ProxyForm Huỷ, ProxyBulkEdit Cancel, Trash AlertDialog Cancel, Categories ConfirmDialog Cancel, Settings ConfirmDialog Huỷ, Admins/[id] Cancel (en), Profile Huỷ. | nhiều |
| I7 | Empty state component | Có shared `<EmptyState>` (logs, request-table, user-table). Không dùng: trash-proxies (`No deleted proxies`), trash-users, trash-requests, history (`Không tìm thấy lịch sử`), recent-requests (`No requests found`), user-proxies-tab (`No proxies assigned`), categories có riêng `<EmptyState>` local hand-rolled. | nhiều |
| I8 | Skeleton loading patterns | (a) `<TableSkeleton columns rows>` (proxies, users); (b) hand-rolled `Array.from(...).map(<Skeleton className=...>)` (admins, logs, history, trash-*, chat-window, recent-requests). Inconsistent. | shared/table-skeleton.tsx, nhiều |
| I9 | Pagination implementation | (a) shared `<Pagination>` component (proxies, users, requests); (b) hand-rolled "Trước/Sau" 2-button (logs, history); (c) hand-rolled "Load More" (chat-window, user-chat-panel). 3 patterns. | nhiều |
| I10 | Filter bar layout | (a) Top horizontal flex: proxies (multiple Select chips), logs Card-based, history Card-based, users top single Select+Input. (b) Sidebar/sheet — không có. Mỗi tab tự design. | nhiều |
| I11 | Date format | Mix: `format(date, "yyyy-MM-dd HH:mm")` (logs, history, admins), `format(..., "MMM d, HH:mm")` (request-table), `format(..., "MMM d, yyyy HH:mm")` (user-table requests), `toLocaleString` (chat), `toLocaleDateString("vi-VN")` (proxies expiry), `toLocaleDateString("en-US")` (proxy-detail Created). | nhiều |
| I12 | Status badge color | proxy-table dùng `proxyStatusBadges()` helper; proxy-detail có `statusColors` riêng (5 màu khác); user-table có `statusVariant` riêng; request-table có `statusVariant` riêng; trash-* hardcode `<Badge variant="secondary">{status}</Badge>`. Không 1 nơi nào reuse helper. | nhiều |
| I13 | Dropdown menu icon | Proxies/Users dùng `MoreHorizontal`. Users dùng `Settings` icon thay vì `MoreHorizontal`. Inconsistent affordance. | proxy-table.tsx:209,415, user-table.tsx:268, request-table.tsx:250 |
| I14 | "View Details" pattern | proxy-table: Link `/proxies/{id}` trong DropdownMenuItem; request-table: button onClick trigger; user-table: Link wrap inside DropdownMenuItem. | nhiều |
| I15 | Bulk action bar position | Proxies: container above table (rounded-lg border bg-muted/50). Users: cùng pattern. Requests: cùng pattern nhưng nested under TabsContent. → OK; nhưng style class lặp lại 3 lần thay vì shared `<BulkActionBar>`. | nhiều |
| I16 | Sub-tab layouts | UserSubTabs (chat + users tab links), BotSubTabs, ProxySubTabs, LogsSubTabs — 4 components riêng. Pattern lặp. Không 1 shared `<SubNavTabs items>`. | navigation/page-sub-tabs.tsx, …-sub-tabs.tsx |
| I17 | Table action column | Có column hiện "Actions" header, có "Thao tác", có để trống. Inconsistent across vi/en + admins (Thao tác), users (Actions), trash (Actions). | nhiều |
| I18 | Sort direction icon | proxy-table custom SortableHead có ArrowUpDown nhỏ. user-table dùng `<Button variant="ghost">` với ArrowUpDown. request-table cùng user-table. Không 1 component shared `<SortableHeader>`. | nhiều |
| I19 | Form validation feedback | proxy-form inline `<p role="alert">` + Zod. categories form không show errors inline (toast only). proxy-bulk-edit không show errors. user-rate-limit yellow card list. Mỗi tab tự design. | nhiều |
| I20 | Dialog `sm:max-w-` | proxy-form `sm:max-w-lg`; bulk-edit `max-w-md`; category dialog default; approve/reject `sm:max-w-md`; admin invite default; profile dialogs default. Inconsistent widths. | nhiều |
| I21 | Toast "✓ vs ✅" prefix | KHÔNG ai dùng prefix emoji — toast text raw. Tốt. Nhưng `toast.success/error` mặc định có icon từ Sonner; trong settings.page.tsx dùng `toast.success("Bot is connected!")` còn các nơi khác Vietnamese — tổng thể không emoji-loaded. |  |
| I22 | "Cancel" close vs X close | AlertDialog: KHÔNG có X (Base UI alert-dialog không render X). Dialog: render X mặc định. Khi `loading=true`, ConfirmDialog block close (đúng). Trash AlertDialog không block khi pending. | shared/confirm-dialog.tsx:64-67 |
| I23 | Đăng xuất / Logout | sidebar.tsx + header.tsx **CẢ 2** đều có Logout button. Trùng lặp affordance + mỗi nơi gọi `signOut` riêng (không qua shared hook). | sidebar.tsx:251, header.tsx:166 |
| I24 | Block toggle button variant | UserDetail header: `variant={user.status === "blocked" ? "default" : "destructive"}` → khi đang blocked dùng default (xanh) để Unblock; admins page tương tự nhưng với `variant={admin.is_active ? "destructive" : "outline"}` (outline thay vì default). Khác nhau. | user-detail.tsx:161, admins/page.tsx:407 |
| I25 | "Realtime sync" debounce time | DASHBOARD_POLL_INTERVAL_MS, debounce timeouts: dashboard 2000ms, proxies 2000ms, requests 2000ms, users 2000ms, header 2000ms. OK consistent. | nhiều |
| I26 | Spinner size | Loader2 size: `size-3.5`, `size-4`, `h-3.5 w-3.5`, `size-5`, `size-6`. Mix tailwind size utilities và h+w. | nhiều |
| I27 | Page padding | `p-6` (Profile, Logs Card-internal); `p-4 sm:p-6` (Proxies, Users); `flex-1 space-y-6 p-6` (Dashboard, Settings); `p-4 sm:space-y-6 sm:p-6` (Users, Proxies, Requests); `space-y-4 p-4 md:p-6` (Categories). Mix lung tung. | nhiều |
| I28 | "Số bản ghi" pagination footer | logs: "Trang X / Y (Z bản ghi)". history: cùng. shared Pagination: "Showing X - Y of Z items". Inconsistent text + Eng/Vi. | logs/page.tsx:352, shared/pagination.tsx:77-87 |
| I29 | Dropdown trigger pattern | Sidebar nav uses `<Link>` + `usePathname`. Header dropdown uses `<DropdownMenuTrigger>` + `aria-label`. ProxyTable + UserTable + RequestTable: `<DropdownMenuTrigger render={<Button .../>}>`. ProxiesPage "Thêm proxy ▾": `<DropdownMenuTrigger render={<Button .../>}>`. OK consistent. |  |
| I30 | "Coming soon" badge | bot/page.tsx: amber badge "Sắp ra mắt"; bot/config/page.tsx: full Card với CardDescription "Phase 2"; deprecated text in admin_telegram_ids of settings: "Deprecated: ...". 3 styles "không sẵn sàng". | nhiều |
| I31 | i18n usage | Một số tab dùng `useI18n` (proxies/users/requests/dashboard); tab khác hardcode (settings VN, admins/[id] EN, profile VN, logs VN, history VN, categories VN, admins VN). Mixed. | nhiều |
| I32 | Notes textarea | proxy-form notes — không có maxLength. user-info-card notes — không có maxLength. categories description — `maxLength={2000}`. Inconsistent. | nhiều |

---

## Section 6 — Per-tab inconsistency (so sánh từng tab)

### Dashboard
- Header pattern: title + lastUpdated + Refresh button. Không có sub-tabs.
- Empty state: hand-rolled `No requests found` (recent-requests).
- Skeleton: `Array.from({length:5}).map(<div className="h-10 animate-pulse rounded bg-muted" />)` — không dùng `<Skeleton>`.
- Error boundary: KHÔNG có. Phụ thuộc /(dashboard)/error.tsx parent.

### Proxies
- Header: title + count + 2 export Buttons + Thêm proxy dropdown. KHÔNG có Refresh button.
- Sub-tabs: ProxySubTabs (Quản lý / Danh mục / Thùng rác).
- Skeleton: `<TableSkeleton columns={7} rows={10}>` (shared).
- Empty state: hand-rolled "Chưa có proxy nào" (proxy-table.tsx:282).
- Mobile card view: có (md:hidden block).
- Error boundary: KHÔNG.

### Users
- Header: title + subtitle + Export button. KHÔNG Refresh.
- Sub-tabs: UserSubTabs.
- Skeleton: `<TableSkeleton columns={8} rows={10}>`.
- Empty state: shared `<EmptyState>` ✓ trong UserTable.
- Mobile card: KHÔNG (table only).
- Error boundary: KHÔNG.

### Requests
- Header: title + subtitle. KHÔNG Refresh, KHÔNG export.
- Sub-tabs: KHÔNG (dùng Tabs component cho pending/recent).
- Skeleton: `<TableSkeleton columns={7} rows={10}>`.
- Empty state: shared `<EmptyState>` ✓.
- Filter: Search + Filter button.
- Mobile card: KHÔNG.

### Categories
- Header: title + subtitle + 1 checkbox (Include hidden) + Refresh + New category.
- Sub-tabs: ProxySubTabs (3rd parent).
- Skeleton: `<Skeleton className="h-40 w-full">` — không dùng TableSkeleton.
- Empty state: hand-rolled local `<EmptyState>` function với button.
- Drag & drop: **KHÔNG hoạt động** — chỉ có ArrowUp/ArrowDown buttons (mig 028 có sort_order nhưng UI bằng button). Comment "Drag-and-drop is deferred — manual up/down covers ~95% of admin needs". User asked to spec.

### Trash
- Header: title + subtitle + amber alert card "30 ngày tự xoá".
- Sub-tabs: ProxySubTabs (parent).
- Tabs (proxy/users/requests).
- Skeleton: hand-rolled `Array.from({length:3})`. Không TableSkeleton.
- Empty state: hand-rolled "No deleted proxies" / "No deleted users" / "No deleted requests" (en, không vi).
- Restore không có toast. Không có confirm.

### Logs / History
- Header: title + subtitle + cross-link + Export CSV + Refresh.
- Sub-tabs: LogsSubTabs.
- Skeleton: hand-rolled `Skeleton h-4 w-full` per cell.
- Empty state: shared `<EmptyState>` (logs only); History dùng hand-rolled "Không tìm thấy lịch sử".
- Pagination: hand-rolled 2-button (Trước/Sau).

### Settings
- Header: title + subtitle + "Lưu cài đặt" button.
- Sub-tabs: KHÔNG.
- Skeleton: NONE — page-level `<RefreshCw spin>`.
- Empty state: NONE.
- Layout: nhiều Card stacked.
- Bot token UI: password input không có reveal/copy.

### Admins
- Header: title + subtitle + Thêm + Refresh.
- Sub-tabs: KHÔNG.
- Skeleton: hand-rolled per-cell `<Skeleton h-4 w-full>`.
- Empty state: hand-rolled "Chưa có quản trị viên".
- Mobile card: KHÔNG (overflow-x-auto only).

### Admins/[id]
- Header: Back button + title + badges.
- Sub-tabs: KHÔNG (cards stacked).
- Skeleton: page-level `<RefreshCw spin>`.
- Force actions: 4 destructive cards với border-destructive cảnh báo.

### Profile
- Header: title + subtitle.
- Sub-tabs: KHÔNG (shadcn Tabs internal: Cá nhân / Bảo mật / 2FA / Sessions).
- Skeleton: page-level `<RefreshCw spin>`.
- 2FA flow: enroll → QR → verify → backup codes (modal).

### Bot
- /bot landing: cards (2 active + 2 SoonCard).
- /bot/config: full "Coming soon" page (dead UI).
- /bot/simulator: 2-pane layout. Có role-gate (canWrite).

### Chat (/chat)
- 2-pane layout. KHÔNG sub-tabs riêng (UserSubTabs parent).
- Send reply input ✓. Khác `/users/[id]?tab=chat` (chỉ read-only).

### Check-proxy
- Top role-gate. Card with textarea + Kiểm tra/Xoá. SummaryCards 4-grid. Result table + Xuất CSV.
- KHÔNG sub-tabs.
- Skeleton: NONE.

---

## Section 7 — 20 priority UI fix

| Rank | Fix | Why | Effort |
|---|---|---|---|
| 1 | Wire Bell button → router /requests hoặc Popover gồm pending list | B1 — silent click, user confused | S |
| 2 | Confirm dialog cho single proxy delete (dropdown + detail) | B3 — destructive 1-click | S |
| 3 | Confirm dialog cho Batch Reject requests | B4 — bulk destructive | S |
| 4 | Confirm dialog cho user Block/Unblock (table + detail) | B5+B6 | S |
| 5 | Toast cho Restore action trong Trash 3 sub-components | B7 — silent | XS |
| 6 | Confirm dialog cho dashboard Approve/Reject hoặc gỡ widget action (chỉ link) | B9 | S |
| 7 | Gỡ field Country bị disabled trong ProxyBulkEdit (hoặc wire vào RPC) | B10 — dead UI | S |
| 8 | Toast khi save proxy form fail | B12 | XS |
| 9 | Refactor 3 confirm patterns → 1 unified ConfirmDialog (giữ DangerousConfirmDialog cho type-to-confirm) | I1 | M |
| 10 | Chuẩn hoá toast text → 100% Tiếng Việt qua i18n key (xoá toast EN trong request-actions, user-table, user-info-card, etc.) | I3 | M |
| 11 | Thêm Refresh button cho Proxies/Users/Requests | I4+B25/26/27 | XS |
| 12 | Chuẩn hoá Loading state submit → Loader2 spin (xoá text-only "Đang lưu..." pattern) | I5 | S |
| 13 | Chuẩn hoá Cancel/Huỷ → Huỷ (trừ pages auth EN) | I6 | XS |
| 14 | Replace tất cả hand-rolled empty state → `<EmptyState>` shared | I7 | S |
| 15 | Replace hand-rolled skeleton → `<TableSkeleton>` cho table-based pages | I8 | S |
| 16 | Wire chat send-message vào user detail tab=chat (port từ /chat ChatWindow) | B21 | M |
| 17 | Status badge — extract 1 helper `<StatusBadge variant>` cho proxy/user/request | I12 | M |
| 18 | Bot/config: gỡ link nav khỏi sidebar/sub-tabs cho tới khi sẵn sàng (hoặc redirect /settings) | B2 | XS |
| 19 | Bot Simulator Clear: rõ "Xoá hiển thị (vẫn lưu DB)" + KHÔNG copy về xoá DB | B11 | XS |
| 20 | "View Details" trong Requests dropdown — wire vào dialog hoặc route /requests/[id] | B19 | M |

---

## Section 8 — Self-critical: gì khó audit cho tool tự động?

Note: tool LLM tĩnh đọc TSX. Hạn chế thực tế:

1. **Behaviour at runtime**: tool không click thực tế, không thấy modal có thực sự render đúng không khi prop sai. Ví dụ `<DropdownMenuTrigger render={<Button .../>}>` Base UI có quirk khi children + render cùng có. Cần Playwright e2e mới detect thật.

2. **Visual regression** (theme/breakpoints/RTL): không capture screenshot từng button trên dark/light × mobile/desktop. Spacing/alignment chỉ nói được qua class. Không biết button có overflow trên 320px không.

3. **Focus management & keyboard a11y**: focus trap trong Dialog/AlertDialog — Base UI tự xử nhưng custom code (`onClick={() => onOpenChange(false)}` cho Cancel) có chuyển focus về trigger không? Không kiểm được tĩnh.

4. **Race condition giữa optimistic update + realtime + manual refetch**: code có debounce 2000ms (proxies/users/requests/dashboard/header), nhưng phải runtime test mới biết flicker khi 1000 mutations/s.

5. **i18n key thực tế tồn tại không**: `t("proxies.healthCheckComplete")` — tool không mở được lib/i18n.ts để verify. Nếu key missing → label trống render silent.

6. **Role gate UI vs server**: code có `if (!canWrite) return ...`. Nhưng nếu hook `useRole()` lỗi or trả undefined ban đầu → có flash UI dành cho admin xong server reject? Cần auth-context test.

7. **Toast queue / dedupe**: Sonner mặc định duplicate. proxies.bulk-delete bắn 3 toast (success/error/warning) tùy partial. Nếu 5 click rapid → spam. Không kiểm được tĩnh.

8. **Z-index conflicts**: Dialog, Sheet, Sonner toast, dropdown-menu — cùng portal? Ai đè ai trong 1000 lines. Browser DevTools mới rõ.

9. **Mobile gesture**: ProxyTable có mobile card view; nhưng AlertDialog không có swipe-to-close, Sheet có. Không test được mobile UX feel.

10. **Dialog state khi unmount**: TwoFactorCard mở 4 dialog `showDisable`, `showRegenerate`, etc. Nếu user đăng xuất giữa chừng → dialog state? Component unmount xử lý được không? Cần runtime React profiler.

11. **Realtime channel cleanup**: 5 useEffect subscribe Supabase realtime. Mỗi cái phải `removeChannel`. Tôi thấy code đúng nhưng không test được leak.

12. **Form persistence**: ProxyForm khi user gõ 50 field rồi click X → hết. Không có "save draft" hay confirm-before-close. Pattern thiếu chung.

13. **Optimistic update**: Restore button trong trash không cập nhật UI ngay — phải refetch. User thấy delay. Không phát hiện trong static scan trừ khi đi sâu.

14. **Dropdown chia hành động phá hoại**: Mục Delete trong dropdown menu thường ở đáy với separator. Tôi thấy code có `<DropdownMenuSeparator />`. OK consistent. Nhưng UI/UX chuẩn quốc tế cũng nên màu đỏ + kéo dài focus path — không kiểm được.

15. **Network resilience**: API 500 → toast error, OK. Nhưng API 401 → toast 401? Hay redirect login? Code mỗi nơi xử khác. Cần network mock.

16. **Confirm dialog "loading swallow close"**: ConfirmDialog có swallow khi loading. AlertDialog (TrashProxies/etc) không swallow → user vẫn ESC ra giữa lúc xoá → fetch vẫn chạy nhưng user nghĩ đã huỷ. Phát hiện được tĩnh, đã ghi I22.

---

## Tổng kết

- 14 trang/dashboard scanned + 25+ component scanned.
- 140+ button mapped, 28 modals/sheets, ~80 toast.
- 33 broken UI items + 32 inconsistencies + 20 fix priorities.
- Fixed bugs in this audit: 0 (đây là audit only).
- Estimated total fix work: 10–14 ngày dev (M effort items chiếm phần lớn).

File path: `C:\Users\Admin\Documents\quản lý proxy trên web và giao proxy qua bot tele cho user tele\proxy-manager-telebot\docs\REVIEW_2026-05-02_UI_CONSISTENCY.md`

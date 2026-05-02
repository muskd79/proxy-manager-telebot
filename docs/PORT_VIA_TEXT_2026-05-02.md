# PORT_VIA_TEXT — Port toàn bộ text VIA bot sang Proxy bot

**Ngày**: 2026-05-02
**Source paths**:
- VIA bot: `C:\Users\Admin\Documents\quản lý via, giao via và gửi via qua bot tele\src\lib\bot\`
- Proxy bot: `C:\Users\Admin\Documents\quản lý proxy trên web và giao proxy qua bot tele cho user tele\proxy-manager-telebot\src\lib\telegram\`

Mục tiêu: bê **chính xác** mọi text response của VIA bot sang proxy bot, đổi `via` → `proxy`. Sửa hết text tiếng Việt không dấu trong proxy bot. Tách `messages.ts` flat thành `i18n/` domain-split như VIA.

---

## TASK 1 — Map TEXT VIA bot 1-1

### 1.1. `i18n/getvia.ts` — Order flow (24 keys)

| i18n key | VIA vi | VIA en | File:line | Handler dùng | Vars |
|---|---|---|---|---|---|
| `getvia.title` | `*Yêu cầu Via*` | `*Request Via*` | `i18n/getvia.ts:4` | `handlers/callbacks/getvia.ts:116,127,158,199` | — |
| `getvia.available` | `Có *{count}* via sẵn sàng (tối đa *{max}*/lần)` | `*{count}* vias available (max *{max}*/request)` | `i18n/getvia.ts:5` | `handlers/callbacks/getvia.ts:115,126,197` | count, max |
| `getvia.enter_qty` | `Nhập số lượng via bạn cần:` | `Enter the number of vias you need:` | `i18n/getvia.ts:6` | `handlers/callbacks/getvia.ts:199` | — |
| `getvia.choose_cat` | `Chọn danh mục:` | `Choose category:` | `i18n/getvia.ts:7` | `handlers/callbacks/getvia.ts:116` | — |
| `getvia.all_cat` | `Tất cả danh mục` | `All categories` | `i18n/getvia.ts:8` | `handlers/callbacks/getvia.ts:85` | — |
| `getvia.free` | `Miễn phí` | `Free` | `i18n/getvia.ts:9` | `handlers/callbacks/getvia.ts:108` | — |
| `confirm.title` | `*Xác nhận yêu cầu*` | `*Confirm request*` | `i18n/getvia.ts:10` | `handlers/messages/index.ts:127` | — |
| `confirm.qty` | `Số lượng: *{qty}* via` | `Quantity: *{qty}* vias` | `i18n/getvia.ts:11` | `handlers/messages/index.ts:127` | qty |
| `confirm.cat` | `Danh mục: *{cat}*` | `Category: *{cat}*` | `i18n/getvia.ts:12` | `handlers/messages/index.ts:124` | cat |
| `confirm.available` | `Via sẵn sàng: *{count}*` | `Available: *{count}*` | `i18n/getvia.ts:13` | `handlers/messages/index.ts:125` | count |
| `confirm.ask` | `Xác nhận?` | `Confirm?` | `i18n/getvia.ts:14` | `handlers/messages/index.ts:127` | — |
| `confirm.yes` | `Xác nhận` | `Confirm` | `i18n/getvia.ts:15` | `keyboards.ts:53` | — |
| `confirm.no` | `Hủy` | `Cancel` | `i18n/getvia.ts:16` | `keyboards.ts:54` | — |
| `confirm.expired` | `Phiên đã hết hạn. Vui lòng thử lại.` | `Session expired. Please try again.` | `i18n/getvia.ts:17` | `handlers/callbacks/getvia.ts:209` | — |
| `confirm.cancelled` | `Đã hủy yêu cầu.` | `Request cancelled.` | `i18n/getvia.ts:18` | `handlers/callbacks/getvia.ts:254` | — |
| `success.delivered` | `*Đã giao {count} via!*` | `*Delivered {count} vias!*` | `i18n/getvia.ts:19` | `commands/getvia.ts:235` | count |
| `success.delivered_file` | `Đã giao <b>{count} via</b> qua file!\nMở file .txt để xem thông tin via.` | `Delivered <b>{count} vias</b> via file!\nOpen the .txt file to view via details.` | `i18n/getvia.ts:20` | `commands/getvia.ts:205` | count |
| `success.remaining` | `Còn lại: *{count}* via` | `Remaining: *{count}* vias` | `i18n/getvia.ts:21` | `commands/getvia.ts:242` | count |
| `success.request_more` | `Yêu cầu thêm` | `Request more` | `i18n/getvia.ts:22` | `commands/getvia.ts:187` | — |
| `success.submitted` | `*Yêu cầu {qty} via đã được gửi!*\nVui lòng chờ admin duyệt.` | `*Request for {qty} vias submitted!*\nPlease wait for admin approval.` | `i18n/getvia.ts:23` | `commands/getvia.ts:323` | qty |
| `getvia.cat_empty` | `Danh mục này hết hàng. Vui lòng chọn danh mục khác.` | `This category is out of stock.` | `i18n/getvia.ts:26` | `handlers/callbacks/getvia.ts:249` | — |
| `getvia.cat_max_qty` | `Danh mục này tối đa {max} via mỗi lần.` | `Max {max} vias per request for this category.` | `i18n/getvia.ts:27` | `handlers/messages/index.ts:101` | max |

### 1.2. `i18n/getvia.ts` — Custom order flow (12 keys)

| i18n key | VIA vi | VIA en | File:line | Handler | Vars |
|---|---|---|---|---|---|
| `custom.choose_type` | `Chọn loại đặt hàng:\n• Order nhanh: Tự động, giới hạn từng user\n• Order riêng: Cần admin duyệt yêu cầu\n\nDùng lệnh /status để xem giới hạn của mình` | `Choose order type:\n• Quick order: Automatic, per-user limit\n• Custom order: Requires admin approval\n\nUse /status to check your limits` | `i18n/getvia.ts:30-33` | `handlers/callbacks/getvia.ts:127,159` | — |
| `custom.btn_quick` | `Order nhanh` | `Quick order` | `i18n/getvia.ts:34` | `keyboards.ts` + `handlers/callbacks/getvia.ts:122,153` | — |
| `custom.btn_custom` | `Order riêng` | `Custom order` | `i18n/getvia.ts:35` | `handlers/callbacks/getvia.ts:123,154` | — |
| `custom.enter_qty` | `*Order riêng*\n\nNhập số lượng via bạn cần (không giới hạn):` | `*Custom order*\n\nEnter the number of vias you need (no limit):` | `i18n/getvia.ts:36` | `handlers/callbacks/getvia.ts:187` | — |
| `custom.enter_reason` | `Nhập lý do đặt hàng (hoặc gõ "skip" để bỏ qua):` | `Enter order reason (or type "skip" to skip):` | `i18n/getvia.ts:37` | `handlers/messages/index.ts:88,171` | — |
| `custom.confirm` | `*Xác nhận đơn hàng riêng*\n\nSố lượng: *{qty}* via{cat}{reason}\n\nXác nhận?` | `*Confirm custom order*\n\nQuantity: *{qty}* vias{cat}{reason}\n\nConfirm?` | `i18n/getvia.ts:38` | `handlers/messages/index.ts:191` | qty, cat, reason |
| `custom.submitted` | `Đơn hàng đặc biệt đã được gửi. Chờ admin duyệt.` | `Custom order submitted. Waiting for admin approval.` | `i18n/getvia.ts:39` | `handlers/callbacks/custom-order.ts:338,340` | — |
| `custom.auto_approved` | `Đơn hàng đã được tự động duyệt! ({count} via)` | `Order auto-approved! ({count} vias)` | `i18n/getvia.ts:40` | `handlers/callbacks/custom-order.ts:235,244` | count |
| `custom.approved` | `Đơn hàng đặc biệt đã được duyệt! ({count} via)` | `Custom order approved! ({count} vias)` | `i18n/getvia.ts:41` | `handlers/callbacks/custom-order.ts:532,544` | count |
| `custom.rejected` | `Đơn hàng đặc biệt đã bị từ chối.` | `Custom order has been rejected.` | `i18n/getvia.ts:42` | `handlers/callbacks/custom-order.ts:717` | — |
| `custom.over_limit` | `Số lượng yêu cầu ({qty}) vượt giới hạn ({max}/lần).\nĐơn hàng sẽ được gửi dưới dạng *order riêng* và cần admin duyệt.` | `Requested quantity ({qty}) exceeds limit ({max}/request).\nOrder will be submitted as *custom order* pending admin approval.` | `i18n/getvia.ts:44` | `handlers/messages/index.ts:86` | qty, max |
| `custom.validate_qty` | `Số lượng phải là số nguyên lớn hơn 0.` | `Quantity must be a positive integer.` | `i18n/getvia.ts:45` | `handlers/messages/index.ts:135` | — |
| `custom.qty_capped` | `Số lượng đã được giới hạn tối đa {max}. Đơn hàng sẽ xử lý với {max} via.` | `Quantity capped to maximum of {max}. Order will proceed with {max} vias.` | `i18n/getvia.ts:46` | `handlers/messages/index.ts:142` | max |
| `custom.label_category` | `Danh mục` | `Category` | `i18n/getvia.ts:49` | `handlers/messages/index.ts:182` | — |
| `custom.label_reason` | `Lý do` | `Reason` | `i18n/getvia.ts:50` | `handlers/messages/index.ts:184` | — |

### 1.3. `i18n/common.ts` — Welcome/menu/help/validate (40+ keys)

| i18n key | VIA vi | VIA en | File:line | Handler | Vars |
|---|---|---|---|---|---|
| `welcome` | `Xin chào *{name}*!\n\n*Via Manager Bot*\nBot hỗ trợ yêu cầu và nhận via.\nHiện có *{count}* via sẵn sàng.\n\nChọn chức năng bên dưới:` | `Hello *{name}*!\n\n*Via Manager Bot*\nBot for requesting and receiving vias.\nCurrently *{count}* vias available.\n\nChoose a function below:` | `i18n/common.ts:5` | `handlers/commands/start.ts:46` | name, count |
| `welcome_no_count` | `Xin chào *{name}*!\n\n*Via Manager Bot*\nBot hỗ trợ yêu cầu và nhận via.\n\nChọn chức năng bên dưới:` | `Hello *{name}*!\n\n*Via Manager Bot*\nBot for requesting and receiving vias.\n\nChoose a function below:` | `i18n/common.ts:6` | `handlers/commands/start.ts:44` | name |
| `welcome.default_name` | `bạn` | `friend` | `i18n/common.ts:66` | `handlers/commands/start.ts:39` | — |
| `menu.getvia` | `Yêu cầu Via` | `Request Via` | `i18n/common.ts:7` | `keyboards.ts:41` | — |
| `menu.myvia` | `Via đã nhận` | `Received Vias` | `i18n/common.ts:8` | `keyboards.ts:42` | — |
| `menu.status` | `Trạng thái` | `Status` | `i18n/common.ts:9` | `keyboards.ts:43` | — |
| `menu.report` | `Bảo hành Via` | `Warranty Via` | `i18n/common.ts:10` | `keyboards.ts:44` | — |
| `menu.help` | `Hướng dẫn` | `Help` | `i18n/common.ts:11` | `keyboards.ts:47` | — |
| `menu.lang` | `English` | `Tiếng Việt` | `i18n/common.ts:12` | `keyboards.ts:48` | — |
| `menu.checkuid` | `Kiểm tra UID` | `Check UID` | `i18n/common.ts:13` | `keyboards.ts:46` | — |
| `menu.history` | `Lịch sử` | `History` | `i18n/common.ts:14` | `keyboards.ts:45` | — |
| `menu.title` | `*Via Manager Bot*\nChọn chức năng bên dưới:` | `*Via Manager Bot*\nChoose a function below:` | `i18n/common.ts:15` | (after lang switch / fallback) | — |
| `menu.choose` | `Chọn chức năng bên dưới:` | `Choose a function below:` | `i18n/common.ts:16` | `handlers/messages/index.ts:199` | — |
| `help.title` | `*Hướng dẫn sử dụng*\n\n*Yêu cầu Via* — Nhập số lượng, xác nhận, nhận via\n*Via đã nhận* — Xem lại via gần đây\n*Kiểm tra UID* — Check live/die tất cả via\n*Trạng thái* — Kiểm tra yêu cầu mới nhất\n*Bảo hành* — Bảo hành via chết/lỗi\n*Lịch sử* — Xem lịch sử nhận via theo tháng\n*Hướng dẫn* — Xem trang này\n*English* — Đổi ngôn ngữ\n\nLệnh:\n\`/getvia\` \`/myvia\` \`/checkuid\` \`/status\`\n\`/report\` \`/history\` \`/help\` \`/lang\` \`/cancel\`` | `*How to use*\n\n*Request Via* — Enter quantity, confirm, receive via\n*Received Vias* — View recent vias\n*Check UID* — Check live/die status of all your vias\n*Status* — Check latest request\n*Warranty* — Warranty for dead/invalid via\n*History* — View monthly via history\n*Help* — View this page\n*Tiếng Việt* — Switch language\n\nCommands:\n\`/getvia\` \`/myvia\` \`/checkuid\` \`/status\`\n\`/report\` \`/history\` \`/help\` \`/lang\` \`/cancel\`` | `i18n/common.ts:17` | `commands/index.ts` showHelp | — |
| `blocked` | `Bạn đã bị chặn. Liên hệ hỗ trợ để biết thêm.` | `You have been blocked. Contact support for more info.` | `i18n/common.ts:18` | `handlers/commands/start.ts:32`, `handlers/callbacks/getvia.ts:29` | — |
| `cooldown` | `Vui lòng đợi {duration} trước khi thử lại.` | `Please wait {duration} before trying again.` | `i18n/common.ts:19` | `handlers/callbacks/getvia.ts:24` | duration |
| `pending.exists` | `Bạn đã có yêu cầu đang chờ xử lý.\nVui lòng đợi admin duyệt.` | `You already have a pending request.\nPlease wait for admin approval.` | `i18n/common.ts:20` | `handlers/callbacks/getvia.ts:47` | — |
| `pending.view` | `Xem trạng thái` | `View status` | `i18n/common.ts:21` | `handlers/callbacks/getvia.ts:48` | — |
| `no.via` | `Hiện không còn via nào. Vui lòng thử lại sau.` | `No vias available. Please try again later.` | `i18n/common.ts:22` | `handlers/callbacks/getvia.ts:55,75,158` | — |
| `no.via_category` | `Danh mục này đã hết via. Vui lòng chọn danh mục khác hoặc thử lại sau.` | `This category has no vias available. Please choose another category or try again later.` | `i18n/common.ts:23` | `commands/getvia.ts:290` | — |
| `no.via_category_partial` | `Danh mục này chỉ còn *{count}* via. Bạn muốn tiếp tục với *{count}* via?` | `This category only has *{count}* vias left. Continue with *{count}* vias?` | `i18n/common.ts:24` | `commands/getvia.ts:296` | count |
| `cancel` | `Hủy` | `Cancel` | `i18n/common.ts:25` | `keyboards.ts:59`, `handlers/callbacks/getvia.ts:113` | — |
| `back` | `Menu chính` | `Main menu` | `i18n/common.ts:26` | `keyboards.ts:63` | — |
| `back_short` | `Quay lại` | `Back` | `i18n/common.ts:27` | `handlers/callbacks/getvia.ts:48` | — |
| `validate.number` | `Vui lòng nhập một *số*. Ví dụ: \`1\`, \`3\`, \`5\`` | `Please enter a *number*. Example: \`1\`, \`3\`, \`5\`` | `i18n/common.ts:28` | `handlers/messages/index.ts:54` | — |
| `validate.positive` | `Số lượng phải *lớn hơn 0*.` | `Quantity must be *greater than 0*.` | `i18n/common.ts:29` | `handlers/messages/index.ts:59` | — |
| `validate.max` | `Tối đa *{max}* via mỗi lần yêu cầu. Nhập lại:` | `Maximum *{max}* vias per request. Try again:` | `i18n/common.ts:30` | (legacy / unused) | max |
| `validate.not_enough` | `Chỉ còn *{count}* via{cat}. Nhập số nhỏ hơn:` | `Only *{count}* vias{cat} remaining. Enter a smaller number:` | `i18n/common.ts:31` | `handlers/messages/index.ts:81,117,164` | count, cat |
| `error` | `Có lỗi xảy ra.` | `An error occurred.` | `i18n/common.ts:32` | nhiều handler | — |
| `error.qty` | `Số lượng phải lớn hơn 0.` | `Quantity must be greater than 0.` | `i18n/common.ts:33` | `commands/getvia.ts:41` | — |
| `error.max` | `Tối đa {max} via/lần.` | `Maximum {max} vias per request.` | `i18n/common.ts:34` | `commands/getvia.ts:42` | max |
| `error.pending` | `Bạn đã có yêu cầu đang chờ duyệt.` | `You already have a pending request.` | `i18n/common.ts:35` | `commands/getvia.ts:75,315` | — |
| `error.no_via` | `Không còn via. Thử lại sau.` | `No vias available. Try again later.` | `i18n/common.ts:36` | `commands/getvia.ts:168` | — |
| `lang.switched` | `Đã chuyển sang Tiếng Việt!` | `Switched to English!` | `i18n/common.ts:37` | `handlers/commands/utility.ts:86` | — |
| `limit.total` | `Bạn đã nhận {used}/{max} via tổng cộng.` | `You received {used}/{max} vias total.` | `i18n/common.ts:38` | `commands/getvia.ts:50` | used, max |
| `limit.total_remaining` | ` Còn lại: {remaining} via.` | ` Remaining: {remaining}.` | `i18n/common.ts:39` | `commands/getvia.ts:50` | remaining |
| `limit.total_reached` | ` Bạn đã đạt giới hạn tổng.` | ` You have reached the total limit.` | `i18n/common.ts:40` | `commands/getvia.ts:50`, `handlers/callbacks/custom-order.ts:49` | — |
| `limit.hourly` | `Bạn đã đạt giới hạn {max} yêu cầu/giờ. Vui lòng thử lại sau.` | `You have reached the limit of {max} requests/hour. Please try again later.` | `i18n/common.ts:41` | `commands/getvia.ts:58`, `handlers/callbacks/custom-order.ts:55` | max |
| `limit.daily` | `Bạn đã nhận {used}/{max} via hôm nay.` | `You received {used}/{max} vias today.` | `i18n/common.ts:42` | `commands/getvia.ts:68` | used, max |
| `limit.daily_remaining` | ` Còn lại: {remaining} via.` | ` Remaining: {remaining}.` | `i18n/common.ts:43` | `commands/getvia.ts:68` | remaining |
| `limit.daily_reached` | ` Vui lòng quay lại ngày mai.` | ` Please come back tomorrow.` | `i18n/common.ts:44` | `commands/getvia.ts:68`, `handlers/callbacks/custom-order.ts:61` | — |
| `unsupported.media` | `Bot chỉ hỗ trợ tin nhắn text. Gửi /help để xem hướng dẫn.` | `Bot only supports text messages. Send /help for instructions.` | `i18n/common.ts:47` | `handlers/unsupported.ts:32` | — |
| `unknown_command` | `Không hiểu lệnh này. Gửi /help để xem các lệnh.` | `Unknown command. Send /help for available commands.` | `i18n/common.ts:50` | `handlers/messages/index.ts:199` | — |

### 1.4. `i18n/whitelist.ts` (4 keys)

| i18n key | VIA vi | VIA en | File:line |
|---|---|---|---|
| `whitelist.pending` | `Tài khoản của bạn đang chờ admin duyệt.\nVui lòng đợi thông báo từ admin đã chia sẻ link bot.` | `Your account is pending admin approval.\nPlease wait for notification from the admin who shared this bot link.` | `i18n/whitelist.ts:4` |
| `whitelist.rejected` | `Tài khoản của bạn không được phê duyệt.\nLiên hệ admin đã chia sẻ link bot này để biết thêm.` | `Your account was not approved.\nContact the admin who shared this bot link for assistance.` | `i18n/whitelist.ts:5` |
| `whitelist.approved_notify` | `Tài khoản đã được duyệt! Bấm /start để bắt đầu.` | `Your account has been approved! Press /start to begin.` | `i18n/whitelist.ts:6` |
| `whitelist.rejected_notify` | `Tài khoản không được phê duyệt.` | `Your account was not approved.` | `i18n/whitelist.ts:7` |

### 1.5. `i18n/status.ts` (20 keys)

| i18n key | VIA vi | VIA en | File:line |
|---|---|---|---|
| `status.empty_new` | `Bạn chưa có yêu cầu nào.\nBấm "Yêu cầu Via" để bắt đầu!` | `You have no requests yet.\nTap "Request Via" to get started!` | `i18n/status.ts:18` |
| `status.overview_title` | `Tổng quan tài khoản` | `Account Overview` | `i18n/status.ts:9` |
| `status.latest_request` | `Yêu cầu gần nhất:` | `Latest request:` | `i18n/status.ts:10` |
| `status.recent_requests` | `Yêu cầu gần đây:` | `Recent requests:` | `i18n/status.ts:11` |
| `status.label_status` | `Trạng thái` | `Status` | `i18n/status.ts:12` |
| `status.label_qty` | `Số lượng` | `Quantity` | `i18n/status.ts:13` |
| `status.label_time` | `Thời gian` | `Time` | `i18n/status.ts:14` |
| `status.label_reason` | `Lý do từ chối` | `Rejection reason` | `i18n/status.ts:15` |
| `status.vias_received` | `Via đã nhận` | `Vias received` | `i18n/status.ts:16` |
| `status.warranty_pending` | `Bảo hành đang chờ` | `Pending warranty` | `i18n/status.ts:17` |
| `status.pending` | `Đang chờ duyệt` | `Pending` | `i18n/status.ts:6` |
| `status.approved` | `Đã duyệt` | `Approved` | `i18n/status.ts:7` |
| `status.rejected` | `Đã từ chối` | `Rejected` | `i18n/status.ts:8` |
| `status.limits_title` | `Giới hạn của bạn:` | `Your limits:` | `i18n/status.ts:19` |
| `status.limit_per_request` | `Mỗi lần yêu cầu: {value} via (tối đa)` | `Per request: {value} vias (max)` | `i18n/status.ts:20` |
| `status.limit_per_hour` | `Mỗi giờ: {value} yêu cầu` | `Per hour: {value} requests` | `i18n/status.ts:21` |
| `status.limit_per_day` | `Mỗi ngày: {value} via` | `Per day: {value} vias` | `i18n/status.ts:22` |
| `status.limit_total` | `Tổng: {max} via (đã nhận {used}/{max})` | `Total: {max} vias (received {used}/{max})` | `i18n/status.ts:23` |
| `status.btn_getvia` | `Yêu cầu Via` | `Request Via` | `i18n/status.ts:25` |

### 1.6. `i18n/checkuid.ts` (4 keys)

| i18n key | VIA vi | VIA en | File:line |
|---|---|---|---|
| `checkuid.checking` | `🔍 Đang kiểm tra *{count}* UID...` | `🔍 Checking *{count}* UIDs...` | `i18n/checkuid.ts:5-7` |
| `checkuid.summary` | `📊 *Kết quả kiểm tra UID*\n\n✅ Live: *{live}*\n❌ Die: *{die}*\n⚠️ Lỗi: *{error}*` | `📊 *UID Check Results*\n\n✅ Live: *{live}*\n❌ Die: *{die}*\n⚠️ Errors: *{error}*` | `i18n/checkuid.ts:9-12` |
| `checkuid.empty` | `Bạn chưa có via nào để kiểm tra.` | `You have no vias to check.` | `i18n/checkuid.ts:13-16` |
| `checkuid.die_list` | `\n\n🔴 *UID đã die:*\n{list}` | `\n\n🔴 *Dead UIDs:*\n{list}` | `i18n/checkuid.ts:17-20` |

### 1.7. `i18n/myvia.ts` (10 keys)

| i18n key | VIA vi | VIA en | File:line |
|---|---|---|---|
| `myvia.empty` | `Bạn chưa nhận via nào.` | `You have not received any vias.` | `i18n/myvia.ts:4` |
| `myvia.title` | `*Via đã nhận* ({count} gần nhất):` | `*Received vias* ({count} most recent):` | `i18n/myvia.ts:5` |
| `myvia.load_more` | `Xem thêm` | `Load more` | `i18n/myvia.ts:6` |
| `myvia.page_info` | `({from}-{to} / {total})` | `({from}-{to} / {total})` | `i18n/myvia.ts:7` |
| `myvia.prev` | `Trước` | `Previous` | `i18n/myvia.ts:8` |
| `myvia.choose` | `Bạn có {count} via đã nhận. Chọn cách xem:` | `You have {count} vias received. Choose view:` | `i18n/myvia.ts:9` |
| `myvia.btn_view_recent` | `Xem 10 via gần nhất` | `View 10 recent vias` | `i18n/myvia.ts:10` |
| `myvia.btn_view_paginated` | `Xem lần lượt` | `View one by one` | `i18n/myvia.ts:11` |
| `myvia.btn_download_all` | `Tải tất cả (.txt)` | `Download all (.txt)` | `i18n/myvia.ts:12` |
| `myvia.downloading` | `Đang tải...` | `Downloading...` | `i18n/myvia.ts:14` |

### 1.8. `i18n/history.ts` (5 keys, có sẵn trong VIA NHƯNG đã thiếu dấu — bug VIA)

| i18n key | VIA vi (sai dấu) | VIA en | File:line |
|---|---|---|---|
| `history.title` | `Lich su via theo thang` | `Monthly via history` | `i18n/history.ts:4` |
| `history.select_month` | `Chon thang can xem:` | `Select month to view:` | `i18n/history.ts:5` |
| `history.empty` | `Khong co via nao trong thang nay.` | `No vias received this month.` | `i18n/history.ts:6` |
| `history.summary` | `Via da nhan: *{total}*\nDang hoat dong: *{live}* | Die: *{die}* | Bao hanh: *{warranty}*` | (en có dấu chuẩn) | `i18n/history.ts:8-11` |

**LƯU Ý**: VIA bot history.ts còn lỗi không dấu — khi port phải SỬA luôn (đề xuất bản có dấu trong TASK 4).

### 1.9. `i18n/report.ts` — Warranty (tham khảo, proxy bot không có warranty đầy đủ ở Wave 23)

Skip cho proxy bot (Wave 24+).

### 1.10. Group / my_chat_member texts

| i18n key | VIA vi | VIA en | File:line |
|---|---|---|---|
| `admin.wl_new_group` | `Nhóm mới yêu cầu truy cập bot\n\nTên nhóm: {title}\nChat ID: {chatId}\nAdmin thêm bot: {addedBy}\nThời gian: {time}` | (en) | `i18n/common.ts:104-107` |
| `group.admin_only` | `Chỉ admin nhóm mới được dùng lệnh này.` | `Only group admins can use this command.` | `i18n/common.ts:108-111` |
| `admin.wl_new_user` | `User mới yêu cầu truy cập bot\n\nTên: {name}\nUsername: {username}\nID: {userId}\nThời gian: {time}` | (en) | `i18n/common.ts:93-96` |

---

## TASK 2 — Map TEXT proxy bot HIỆN TẠI

| key (proxy) | proxy vi | proxy en | File:line |
|---|---|---|---|
| `welcome` (cũ — slash dump) | (slash list, không nhân tính) | (slash list) | `messages.ts:8-45` |
| **welcome (mới — start.ts inline)** | `Xin chào *{firstName}*!\n\n*Proxy Bot*\nBot hỗ trợ yêu cầu và quản lý proxy.\nHiện có *{count}* proxy sẵn sàng.\n\nChọn chức năng bên dưới:` | `Hello *{firstName}*!\n\n*Proxy Bot*\nBot for requesting and managing proxies.\n*{count}* proxies available.\n\nPick an action below:` | `commands/start.ts:150-168` |
| `welcomeBack` | `Chào mừng bạn quay lại!` | `Welcome back!` | `messages.ts:46` |
| `help` | `*Huong dan su dung*` (không dấu) | `*Help & Commands*` | `messages.ts:50-89` |
| `selectProxyType` | `Chọn loại proxy bạn muốn:` | `Select the proxy type you want:` | `messages.ts:90` |
| `rateLimitExceeded` | `[!] Bạn đã vượt quá giới hạn yêu cầu. Vui lòng thử lại sau.` | (en) | `messages.ts:94` |
| `noProxyAvailable` | `[X] Hiện tại không có proxy nào khả dụng cho loại này.` | (en) | `messages.ts:98` |
| `proxyAssigned` | `[OK] Proxy đã được cấp!\n\n\`{host}:{port}:{username}:{password}\`\n\nLoại: {type}\nHết hạn: {expires}` | (en) | `messages.ts:102-119` |
| `requestPending` | `[i] Yêu cầu của bạn đã được tạo và đang chờ duyệt.\nID: \`{id}\`` | (en) | `messages.ts:120` |
| `noProxies` | `Bạn chưa được cấp proxy nào.` | (en) | `messages.ts:124` |
| `accountBlocked` | `[X] Tài khoản của bạn đã bị khóa. Liên hệ admin để biết thêm.` | (en) | `messages.ts:128` |
| `accountPendingApproval` | `[!] Tài khoản của bạn đang chờ admin duyệt. Bạn sẽ nhận thông báo khi được phê duyệt.` | (en) | `messages.ts:132` |
| `chooseOrderType` | `Chọn loại đặt hàng:\n• Order nhanh: Tự động, giới hạn từng user\n• Order riêng: Cần admin duyệt yêu cầu\n\nDùng lệnh /status để xem giới hạn của mình` | (en) | `messages.ts:138-141` |
| `languageSelect` | `Chọn ngôn ngữ / Select language:` | (en) | `messages.ts:142` |
| `languageChanged` | `[OK] Ngôn ngữ đã được đổi sang Tiếng Việt.` | (en) | `messages.ts:146` |
| `unknownCommand` | `[X] Lệnh không hợp lệ. Sử dụng /help để xem các lệnh.` | (en) | `messages.ts:150` |
| `maxProxiesReached` | `[!] Bạn đã đạt giới hạn proxy tối đa ({max_proxies}). Không thể yêu cầu thêm.` | (en) | `messages.ts:154` |
| `selectQuantity` | `Bạn cần bao nhiêu proxy?` | `How many proxies do you need?` | `messages.ts:158` |
| `bulkProxyAssigned` | `[OK] Đã cấp {count} proxy {type}!` | (en) | `messages.ts:162` |
| `bulkRequestPending` | `[i] Yeu cau {count} proxy {type} dang cho duyet.` (không dấu) | (en) | `messages.ts:166` |
| `pendingApproval` | `[i] Tai khoan cua ban dang cho admin duyet. Ban se duoc thong bao khi duoc phe duyet.` (không dấu) | (en) | `messages.ts:170` |
| `supportMessageReceived` | `Tin nhan da nhan. Admin se phan hoi som.` (không dấu) | (en) | `messages.ts:174` |
| `revokeConfirmAll` | `Ban co chac khong? Hanh dong nay se tra tat ca {count} proxy.` (không dấu) | (en) | `messages.ts:178` |
| `cancelConfirmPrompt` | `Huy tat ca?` (không dấu) | (en) | `messages.ts:182` |
| `noAuth` | `khong xac thuc` (không dấu) | `no auth` | `messages.ts:186` |
| `expiresSoon` | `[!] Sap het han!` (không dấu) | `[!] Expires soon!` | `messages.ts:190` |
| `errorOccurred` | `[X] Đã có lỗi xảy ra. Vui lòng thử lại hoặc liên hệ admin.` | (en) | `messages.ts:194` |
| `bulkPartialAssigned` | `[OK] {assigned}/{requested} proxy {type} da cap! ({missing} khong kha dung - thu lai sau)` (không dấu) | (en) | `messages.ts:198` |

### Inline text (KHÔNG qua messages.ts) trong proxy bot

| Vị trí | text vi | text en |
|---|---|---|
| `start.ts:50-58` (pending welcome) | `Xin chao! Ban da dang ky thanh cong.` (không dấu) | `Hello! You have been registered successfully.` |
| `start.ts:54` | `[i] Tai khoan cua ban dang cho admin duyet. Ban se duoc thong bao khi duoc phe duyet.` (không dấu) | (en) |
| `start.ts:56-57` | `/support - Ho tro\n/language - Doi ngon ngu` (không dấu) | (en) |
| `start.ts:104-109` (blocked) | `Tài khoản của bạn hiện đang bị khoá / chặn.\nMọi yêu cầu proxy sẽ bị từ chối.` (CÓ dấu) | (en) |
| `start.ts:152-167` (active welcome) | `Xin chào *{firstName}*!\n*Proxy Bot*\nBot hỗ trợ yêu cầu và quản lý proxy.\nHiện có *{N}* proxy sẵn sàng.\nChọn chức năng bên dưới:` (CÓ dấu) | (en) |
| `get-proxy.ts:71-78` (request title) | `*Yêu cầu Proxy*\nHiện có *{N}* proxy sẵn sàng.\nChọn loại proxy:` (CÓ dấu) | (en) |
| `get-proxy.ts:188-202` (after type select) | `*Yêu cầu Proxy — {TYPE}*\nCó *{N}* proxy {TYPE} sẵn sàng (tối đa *{max}*/lần)\n{chooseOrderType}` (CÓ dấu) | (en) |
| `get-proxy.ts:248-260` (order quick prompt) | `*Order nhanh — {TYPE}*\nNhập số lượng bạn cần (1–10):\nTự động cấp ngay nếu còn quota.` (CÓ dấu) | (en) |
| `get-proxy.ts:255-261` (order custom prompt) | `*Order riêng — {TYPE}*\nNhập số lượng bạn cần (không giới hạn):\nYêu cầu sẽ vào hàng chờ admin duyệt.` (CÓ dấu) | (en) |
| `custom-order.ts:53-54` (qty session expired) | `Phiên đặt proxy đã hết hạn. Bấm /start để bắt đầu lại.` (CÓ dấu) | (en) |
| `custom-order.ts:62-63` | `[!] Số không hợp lệ. Nhập một số nguyên dương (ví dụ: 3).` (CÓ dấu) | (en) |
| `custom-order.ts:71-78` (qty over max) | `[!] Order nhanh tối đa {QUICK_MAX}/lần. Dùng "Order riêng" cho số lớn hơn.` / `[!] Tối đa {CUSTOM_MAX} proxy/yêu cầu.` (CÓ dấu) | (en) |
| `status.ts:38-49` (vi block) | `*Trang thai tai khoan*\nTrang thai: *{status}*\nChe do duyet: *{mode}*\nProxy hien tai: *{n}* / {max}\n*Gioi han yeu cau:*\nTheo gio: ...\nTheo ngay: ...\nTong cong: ...` (KHÔNG DẤU) | (en) |
| `status.ts:71-74` (reset times) | `Reset theo gio: {n} phut\nReset theo ngay: {n} gio` (không dấu) | (en) |
| `my-proxies.ts:53,59,66,75` | `Het han`, `khong xac thuc`, `Sap het han!`, `*Proxy của bạn ({n}/{max}):*` (mix dấu & không dấu) | (en) |
| `history.ts:29` | `[i] Chua co yeu cau nao.` (không dấu) | (en) |
| `history.ts:33` | `*Lich su yeu cau (10 gan nhat):*` (không dấu) | (en) |
| `history.ts:39-43` (status map) | `Dang cho`, `Da duyet`, `Tu dong`, `Tu choi`, `Da huy` (không dấu) | (en) |
| `support.ts:24-29` | `*Ho tro*\nGui tin nhan bat ky trong chat nay, admin se doc va tra loi.\nLuu y: Admin co the mat vai phut de phan hoi.` (không dấu) | (en) |
| `cancel.ts:43-44` | `[i] Khong co yeu cau nao dang cho de huy.` (không dấu) | (en) |
| `cancel.ts:57` | `*Yeu cau dang cho:*` (không dấu) | (en) |
| `cancel.ts:64` | `Huy tat ca?` (không dấu) | (en) |
| `cancel.ts:68-69` | `Co` / `Khong` (không dấu) | (en) |
| `cancel.ts:96` | `Da huy.` (không dấu) | (en) |
| `cancel.ts:108` | `[i] Khong co yeu cau nao dang cho.` (không dấu) | (en) |
| `cancel.ts:119` | `[OK] Da huy {n} yeu cau dang cho.` (không dấu) | (en) |
| `revoke.ts:40-41` | `[i] Bạn không có proxy nào đang sử dụng.` (CÓ dấu via unicode) | (en) |
| `revoke.ts:58-59` | `[OK] Đã trả proxy ... thành công.` (CÓ dấu) | (en) |
| `revoke.ts:80` | `Trả tất cả` (CÓ dấu) | (en) |
| `revoke.ts:84` | `Chọn proxy muốn trả:` (CÓ dấu) | (en) |
| `revoke.ts:108-109` | `Ban co chac khong? Hanh dong nay se tra tat ca {n} proxy.` (KHÔNG DẤU) | (en) |
| `revoke.ts:113-114` | `Co` / `Khong` (không dấu) | (en) |
| `revoke.ts:152-153` | `Khong co proxy nao de tra.` (không dấu) | (en) |
| `revoke.ts:163-165` | `[OK] Đã trả tất cả {n} proxy thành công.` (có dấu via unicode) | (en) |
| `revoke.ts:187` | `Proxy không hợp lệ.` (CÓ dấu) | (en) |
| `revoke.ts:196-197` | `[OK] Đã trả proxy ... thành công.` (CÓ dấu) | (en) |
| `check-proxy.ts:33` | `[i] Ban khong co proxy nao.` (không dấu) | (en) |
| `check-proxy.ts:37` | `Dang kiem tra...` (không dấu) | (en) |
| `check-proxy.ts:57` | `*Ket qua kiem tra:*` (không dấu) | (en) |
| `handlers.ts:151,181,229` | `Đã huỷ.` / `Da huy.` mix | (en) |
| `handlers.ts:336-339` | `Tin nhan da nhan. Admin se phan hoi som.` / `Su dung /help de xem cac lenh co san.` (không dấu) | (en) |
| `handlers.ts:412-414` | `Bot chỉ hỗ trợ tin nhắn dạng văn bản. Gửi /help để xem các lệnh có sẵn.` (CÓ dấu) | (en) |

---

## TASK 3 — DIFF + PORT PLAN

### 3.1. Order flow

| VIA key | Proxy bot equivalent | Action |
|---|---|---|
| `getvia.title` `*Yêu cầu Via*` | `get-proxy.ts:73` `*Yêu cầu Proxy*` | **PORT** — đổi via→proxy. KEEP. |
| `getvia.available` `Có *{count}* via sẵn sàng (tối đa *{max}*/lần)` | `get-proxy.ts:192` `Có *{N}* proxy {TYPE} sẵn sàng (tối đa *{max}*/lần)` | **DIFF** (đã PORT đúng format VIA) — KEEP. |
| `getvia.enter_qty` `Nhập số lượng via bạn cần:` | `get-proxy.ts:251,257` `Nhập số lượng bạn cần (1-10):` / `(không giới hạn):` | **PORT** — text VIA chuẩn hơn, dùng `Nhập số lượng proxy bạn cần:` thuần. |
| `custom.choose_type` | `messages.ts:138-141` `chooseOrderType` | **KEEP** — đã port đúng. |
| `custom.btn_quick` `Order nhanh` | `keyboard.ts:131` `Order nhanh` | **KEEP** |
| `custom.btn_custom` `Order riêng` | `keyboard.ts:131` `Order riêng` | **KEEP** |
| `custom.enter_qty` `*Order riêng*\n\nNhập số lượng via bạn cần (không giới hạn):` | `get-proxy.ts:255-261` (block lớn 5 dòng) | **DIFF** — VIA gọn 2 dòng, proxy 5 dòng. Đề xuất: theo VIA gọn lại + kèm số "có N proxy sẵn sàng (tối đa M/lần)". |
| `confirm.title` `*Xác nhận yêu cầu*` | (KHÔNG có) | **PORT** — proxy bot bỏ confirm step, nhập qty → assign luôn. Cân nhắc thêm confirm như VIA. |
| `confirm.qty/cat/available/ask/yes/no` | (KHÔNG có) | **PORT** (nếu thêm confirm) |
| `confirm.expired` | `custom-order.ts:53` `Phiên đặt proxy đã hết hạn. Bấm /start để bắt đầu lại.` | **DIFF** — port lại text VIA gọn: `Phiên đã hết hạn. Vui lòng thử lại.` |
| `confirm.cancelled` `Đã hủy yêu cầu.` | `handlers.ts:151,181,229` `Đã huỷ.` / `Da huy.` | **PORT** — đổi `Đã huỷ.` → `Đã hủy yêu cầu.` (chuẩn VIA), bỏ bản không dấu. |
| `success.delivered` `*Đã giao {count} via!*` | `bulk-proxy.ts:87` `bulkProxyAssigned` `[OK] Đã cấp {count} proxy {type}!` | **DIFF** — VIA gọn `*Đã giao N proxy!*`, bỏ `[OK]` prefix → đề xuất: `*Đã giao {count} proxy!*`. |
| `success.remaining` `Còn lại: *{count}* via` | (KHÔNG có) | **PORT** — thêm để báo còn bao nhiêu trong kho. |
| `success.submitted` | `bulk-proxy.ts:143-146` `bulkRequestPending` (không dấu) | **PORT** — text VIA đẹp hơn: `*Yêu cầu {qty} proxy đã được gửi!*\nVui lòng chờ admin duyệt.` |
| `custom.over_limit` | `custom-order.ts:71-72` (không dấu, riêng biệt) | **PORT** — VIA xử lý trong cùng flow: vượt max → auto-route sang custom. Proxy bot reject với err. Đề xuất: đổi sang behavior VIA (auto-route). |
| `custom.qty_capped` | (KHÔNG có) | **PORT** — proxy bot phải có cap (CUSTOM_MAX=100). |
| `custom.label_category/reason` | (KHÔNG có — không có category/reason) | **SKIP** — proxy không có category yet. |
| `custom.submitted` | (proxy có `bulkRequestPending` không dấu) | **PORT** — `Đơn hàng đặc biệt đã được gửi. Chờ admin duyệt.` |
| `custom.auto_approved`/`approved`/`rejected` | (KHÔNG có) | **PORT** — admin approve flow proxy hiện inline-ish. |

### 3.2. Welcome / pending / blocked / unknown

| VIA key | Proxy bot equivalent | Action |
|---|---|---|
| `welcome` | `start.ts:152-167` (đã viết inline có dấu) | **DIFF** — proxy đã có format đẹp. Move text vào `i18n/common.ts`. |
| `welcome_no_count` | (proxy luôn show count) | **PORT** — thêm fallback. |
| `welcome.default_name` `bạn` / `friend` | (proxy fallback `""`) | **PORT** — match fallback VIA. |
| `whitelist.pending` | `start.ts:50-58` pending welcome (không dấu) | **PORT** — replace bằng text VIA có dấu. |
| `blocked` | `start.ts:104-109` blocked text (CÓ dấu) | **DIFF** — proxy verbose, VIA gọn `Bạn đã bị chặn. Liên hệ hỗ trợ để biết thêm.`. KEEP proxy hiện tại nếu admin muốn chi tiết. |
| `unknown_command` | `messages.ts:150` `unknownCommand` (CÓ dấu) | **KEEP** — đã đúng. |
| `unsupported.media` | `handlers.ts:412-414` (CÓ dấu) | **PORT** — match VIA: `Bot chỉ hỗ trợ tin nhắn text. Gửi /help để xem hướng dẫn.` (gọn hơn). |

### 3.3. Help / status / history / support

| VIA key | Proxy bot equivalent | Action |
|---|---|---|
| `help.title` | `messages.ts:50-89` `help` (KHÔNG DẤU) | **PORT** — phải có dấu hết. Format theo VIA: title + bullet command, lệnh ở cuối. |
| `status.overview_title` `Tổng quan tài khoản` | `status.ts:39` `*Trang thai tai khoan*` (không dấu) | **PORT** — sửa dấu. |
| `status.label_status/qty/time/...` | `status.ts:42-48` mix | **PORT** — sửa dấu. |
| `status.limit_per_request/hour/day/total` | `status.ts:46-48` `Theo gio/ngay/Tong cong` (không dấu) | **PORT** — text VIA: `Mỗi giờ: {value} yêu cầu`, etc. |
| `status.empty_new` | (proxy không có) | **PORT** — thêm cho user mới. |
| `history.title` (lỗi) | `history.ts:33` `*Lich su yeu cau (10 gan nhat):*` (không dấu) | **PORT + FIX** — bản chuẩn: `*Lịch sử yêu cầu (10 gần nhất):*`. |
| `history.empty` (lỗi) | `history.ts:29` `[i] Chua co yeu cau nao.` (không dấu) | **PORT + FIX** — `[i] Chưa có yêu cầu nào.`. |
| (status maps) | `history.ts:39-43` `Dang cho/Da duyet/...` (không dấu) | **PORT** — match `status.pending=Đang chờ duyệt`, `status.approved=Đã duyệt`, etc. |
| (support) | `support.ts:24-29` (không dấu) | **PORT** — text có dấu. |
| `cancel`/`back` | mix (không dấu) | **PORT** — `Hủy` / `Menu chính`. |

### 3.4. Validate / errors

| VIA key | Proxy bot equivalent | Action |
|---|---|---|
| `validate.number` | `custom-order.ts:62` `[!] Số không hợp lệ...` | **DIFF** — text proxy gần đúng. Đề xuất: dùng VIA `Vui lòng nhập một *số*. Ví dụ: \`1\`, \`3\`, \`5\``. |
| `validate.positive` | `custom-order.ts:62` (gộp chung với number) | **PORT** — tách riêng key VIA. |
| `validate.not_enough` | (proxy không kiểm) | **PORT** — kiểm available count rồi báo. |
| `error.qty/max/pending/no_via` | mix scattered | **PORT** — gom vào `i18n/common.ts`. |
| `cooldown` | (proxy không có) | **PORT** — VIA có cooldown 30s/getvia. |
| `lang.switched` | `messages.ts:146` `languageChanged` `[OK] Ngôn ngữ đã được đổi sang Tiếng Việt.` | **DIFF** — text VIA gọn `Đã chuyển sang Tiếng Việt!`. |

### 3.5. Mainmenu labels

| VIA key | Proxy bot label | Action |
|---|---|---|
| `menu.getvia` `Yêu cầu Via` | `Yêu cầu proxy` | **KEEP** (đã đổi sang proxy đúng) |
| `menu.myvia` `Via đã nhận` | `Proxy của tôi` | **DIFF** — VIA dùng "Via đã nhận". Proxy "Proxy của tôi" cũng OK, hoặc đổi `Proxy đã nhận` cho parallel. |
| `menu.status` `Trạng thái` | `Limit yêu cầu` | **DIFF** — VIA "Trạng thái" hơi mơ hồ; proxy "Limit yêu cầu" rõ hơn. KEEP proxy. |
| `menu.report` `Bảo hành Via` | `Bảo hành proxy` | **KEEP** |
| `menu.help` `Hướng dẫn` | `Hướng dẫn` | **KEEP** |
| `menu.lang` `English` / `Tiếng Việt` | `English` / `Tiếng Việt` | **KEEP** |
| `menu.history` `Lịch sử` | `Lịch sử` | **KEEP** |
| `menu.checkuid` `Kiểm tra UID` | `Kiểm tra proxy` | **KEEP** (đã đổi tên đúng) |

---

## TASK 4 — VIETNAMESE ACCENT SWEEP

### 4.1. File:line không dấu trong proxy bot (BẮT BUỘC SỬA)

| File:line | Text hiện tại (không dấu) | Đề xuất CÓ DẤU (chuẩn VIA) |
|---|---|---|
| `messages.ts:52` | `*Huong dan su dung*` | `*Hướng dẫn sử dụng*` |
| `messages.ts:54` | `/start - Bat dau va dang ky` | `/start - Bắt đầu và đăng ký` |
| `messages.ts:55` | `/getproxy - Yeu cau proxy (chon loai va so luong)` | `/getproxy - Yêu cầu proxy (chọn loại và số lượng)` |
| `messages.ts:56` | `/myproxies - Xem proxy duoc gan voi thong tin dang nhap` | `/myproxies - Xem proxy được gán với thông tin đăng nhập` |
| `messages.ts:57` | `/checkproxy - Kiem tra tinh trang proxy` | `/checkproxy - Kiểm tra tình trạng proxy` |
| `messages.ts:58` | `/status - Xem trang thai tai khoan va gioi han` | `/status - Xem trạng thái tài khoản và giới hạn` |
| `messages.ts:59` | `/history - Lich su yeu cau voi ma theo doi` | `/history - Lịch sử yêu cầu với mã theo dõi` |
| `messages.ts:60` | `/revoke - Tra proxy khong con su dung` | `/revoke - Trả proxy không còn sử dụng` |
| `messages.ts:61` | `/cancel - Huy yeu cau dang cho` | `/cancel - Hủy yêu cầu đang chờ` |
| `messages.ts:62` | `/support - Gui tin nhan cho admin` | `/support - Gửi tin nhắn cho admin` |
| `messages.ts:63` | `/language - Doi ngon ngu (Viet/Anh)` | `/language - Đổi ngôn ngữ (Việt/Anh)` |
| `messages.ts:64` | `/requests - Duyet yeu cau (Admin)` | `/requests - Duyệt yêu cầu (Admin)` |
| `messages.ts:65` | `/help - Hien thi tro giup` | `/help - Hiển thị trợ giúp` |
| `messages.ts:67` | `*Gioi han yeu cau:*` | `*Giới hạn yêu cầu:*` |
| `messages.ts:68` | `Moi nguoi dung co gioi han so proxy yeu cau theo gio, theo ngay va tong cong. Dung /status de xem chi tiet.` | `Mỗi người dùng có giới hạn số proxy yêu cầu theo giờ, theo ngày và tổng cộng. Dùng /status để xem chi tiết.` |
| `messages.ts:166-168` (`bulkRequestPending`) | `[i] Yeu cau {count} proxy {type} dang cho duyet.` | `[i] Yêu cầu {count} proxy {type} đang chờ duyệt.` |
| `messages.ts:170-172` (`pendingApproval`) | `[i] Tai khoan cua ban dang cho admin duyet. Ban se duoc thong bao khi duoc phe duyet.` | `[i] Tài khoản của bạn đang chờ admin duyệt. Bạn sẽ được thông báo khi được phê duyệt.` |
| `messages.ts:174-176` (`supportMessageReceived`) | `Tin nhan da nhan. Admin se phan hoi som.` | `Tin nhắn đã nhận. Admin sẽ phản hồi sớm.` |
| `messages.ts:178-180` (`revokeConfirmAll`) | `Ban co chac khong? Hanh dong nay se tra tat ca {count} proxy.` | `Bạn có chắc không? Hành động này sẽ trả tất cả {count} proxy.` |
| `messages.ts:182-184` (`cancelConfirmPrompt`) | `Huy tat ca?` | `Hủy tất cả?` |
| `messages.ts:186-188` (`noAuth`) | `khong xac thuc` | `không xác thực` |
| `messages.ts:190-192` (`expiresSoon`) | `[!] Sap het han!` | `[!] Sắp hết hạn!` |
| `messages.ts:198-200` (`bulkPartialAssigned`) | `[OK] {assigned}/{requested} proxy {type} da cap! ({missing} khong kha dung - thu lai sau)` | `[OK] Đã cấp {assigned}/{requested} proxy {type}! ({missing} không khả dụng — thử lại sau)` |
| `start.ts:52` | `Xin chao! Ban da dang ky thanh cong.` | `Xin chào! Bạn đã đăng ký thành công.` |
| `start.ts:54` | `[i] Tai khoan cua ban dang cho admin duyet. Ban se duoc thong bao khi duoc phe duyet.` | `[i] Tài khoản của bạn đang chờ admin duyệt. Bạn sẽ được thông báo khi được phê duyệt.` |
| `start.ts:56-57` | `/support - Ho tro\n/language - Doi ngon ngu` | `/support - Hỗ trợ\n/language - Đổi ngôn ngữ` |
| `status.ts:39` | `*Trang thai tai khoan*` | `*Trạng thái tài khoản*` |
| `status.ts:41` | `Trang thai: *{status}*` | `Trạng thái: *{status}*` |
| `status.ts:42` | `Che do duyet: *{mode}*` | `Chế độ duyệt: *{mode}*` |
| `status.ts:43` | `Proxy hien tai: *{n}* / {max}` | `Proxy hiện tại: *{n}* / {max}` |
| `status.ts:45` | `*Gioi han yeu cau:*` | `*Giới hạn yêu cầu:*` |
| `status.ts:46` | `Theo gio: ... reset moi gio` | `Theo giờ: ... (reset mỗi giờ)` |
| `status.ts:47` | `Theo ngay: ... reset moi 24 gio` | `Theo ngày: ... (reset mỗi 24 giờ)` |
| `status.ts:48` | `Tong cong: ... gioi han tron doi` | `Tổng cộng: ... (giới hạn trọn đời)` |
| `status.ts:71` | `Reset theo gio: {n} phut` | `Reset theo giờ: {n} phút` |
| `status.ts:72` | `Reset theo ngay: {n} gio` | `Reset theo ngày: {n} giờ` |
| `my-proxies.ts:53` | `Het han` (vi block) | `Hết hạn` |
| `my-proxies.ts:59` | `khong xac thuc` | `không xác thực` |
| `my-proxies.ts:66` | `Sap het han!` | `Sắp hết hạn!` |
| `history.ts:29` | `[i] Chua co yeu cau nao.` | `[i] Chưa có yêu cầu nào.` |
| `history.ts:33` | `*Lich su yeu cau (10 gan nhat):*` | `*Lịch sử yêu cầu (10 gần nhất):*` |
| `history.ts:39-43` | `Dang cho`/`Da duyet`/`Tu dong`/`Tu choi`/`Da huy` | `Đang chờ`/`Đã duyệt`/`Tự động`/`Từ chối`/`Đã hủy` |
| `support.ts:24` | `*Ho tro*` | `*Hỗ trợ*` |
| `support.ts:25` | `Gui tin nhan bat ky trong chat nay, admin se doc va tra loi.` | `Gửi tin nhắn bất kỳ trong chat này, admin sẽ đọc và trả lời.` |
| `support.ts:27` | `Luu y: Admin co the mat vai phut de phan hoi.` | `Lưu ý: Admin có thể mất vài phút để phản hồi.` |
| `cancel.ts:43-44` | `[i] Khong co yeu cau nao dang cho de huy.` | `[i] Không có yêu cầu nào đang chờ để hủy.` |
| `cancel.ts:57` | `*Yeu cau dang cho:*` | `*Yêu cầu đang chờ:*` |
| `cancel.ts:64` | `Huy tat ca?` | `Hủy tất cả?` |
| `cancel.ts:68-69` | `Co` / `Khong` | `Có` / `Không` |
| `cancel.ts:96` | `Da huy.` | `Đã hủy.` |
| `cancel.ts:108` | `[i] Khong co yeu cau nao dang cho.` | `[i] Không có yêu cầu nào đang chờ.` |
| `cancel.ts:119` | `[OK] Da huy {n} yeu cau dang cho.` | `[OK] Đã hủy {n} yêu cầu đang chờ.` |
| `revoke.ts:108-109` | `Ban co chac khong? Hanh dong nay se tra tat ca {n} proxy.` | `Bạn có chắc không? Hành động này sẽ trả tất cả {n} proxy.` |
| `revoke.ts:113-114` | `Co` / `Khong` | `Có` / `Không` |
| `revoke.ts:152-153` | `Khong co proxy nao de tra.` | `Không có proxy nào để trả.` |
| `check-proxy.ts:33` | `[i] Ban khong co proxy nao.` | `[i] Bạn không có proxy nào.` |
| `check-proxy.ts:37` | `Dang kiem tra...` | `Đang kiểm tra...` |
| `check-proxy.ts:57` | `*Ket qua kiem tra:*` | `*Kết quả kiểm tra:*` |
| `handlers.ts:181` | `Da huy.` (revoke:cancel branch) | `Đã hủy.` |
| `handlers.ts:336-337` | `Tin nhan da nhan. Admin se phan hoi som.` | `Tin nhắn đã nhận. Admin sẽ phản hồi sớm.` |
| `handlers.ts:338-339` | `Su dung /help de xem cac lenh co san.` | `Sử dụng /help để xem các lệnh có sẵn.` |

**TỔNG**: ~60 vị trí có text không dấu trong proxy bot. Bắt buộc sửa toàn bộ.

---

## TASK 5 — i18n ARCHITECTURE

### 5.1. Cấu trúc đề xuất `src/lib/telegram/i18n/`

```
src/lib/telegram/i18n/
├── index.ts          # bt(key, lang, vars), loadLang, saveLang, type SupportedLanguage
├── common.ts         # welcome, menu.*, blocked, pending, error.*, validate.*, lang.*, unsupported.media, unknown_command
├── getproxy.ts       # getproxy.*, confirm.*, success.*, custom.*, validate.not_enough, no.proxy
├── status.ts         # status.*, limit.*
├── myproxies.ts      # myproxies.* (former my-proxies in-line)
├── history.ts        # history.*, history status map
├── checkproxy.ts     # checkproxy.checking/summary/empty
├── support.ts        # support.title/note
├── revoke.ts         # revoke.*, revoke confirm/cancel
└── whitelist.ts      # whitelist.pending/rejected/approved_notify
```

### 5.2. Migration plan (không break 14 caller hiện có)

**Step 1** — Thêm `i18n/index.ts` mới NHƯNG GIỮ `messages.ts` cũ.
- `messages.ts` re-export `t` & `fillTemplate` từ `i18n/index.ts`.
- Caller hiện tại import từ `../messages` vẫn chạy.

**Step 2** — Tạo từng file domain (`common.ts`, `getproxy.ts`, ...) merge vào `botTexts` (như VIA `i18n/index.ts:139-148`).

**Step 3** — Map mọi key `msg.<key>` cũ → `bt('<key>')` mới. Ví dụ:
- `t('rateLimitExceeded', lang)` → `bt('error.rate_limit', lang)`.
- `t('noProxyAvailable', lang)` → `bt('no.proxy', lang)`.

**Step 4** — Migrate caller theo từng commit nhỏ:
1. `start.ts` — thay 4 inline blocks bằng `bt('welcome'/'whitelist.pending'/'blocked')`.
2. `help.ts` + `messages.ts:50-89` → `bt('help.title')`.
3. `status.ts` → `bt('status.*')`.
4. `history.ts` → `bt('history.*')`.
5. `support.ts` → `bt('support.*')`.
6. `cancel.ts` → `bt('cancel.*')` + `confirm.cancelled`.
7. `revoke.ts` → `bt('revoke.*')`.
8. `check-proxy.ts` → `bt('checkproxy.*')`.
9. `my-proxies.ts` → `bt('myproxies.*')`.
10. `get-proxy.ts` → `bt('getproxy.*')` + custom flow.
11. `custom-order.ts` (handleQtyTextInput) → `bt('custom.*')` + `validate.*`.
12. `bulk-proxy.ts` → `bt('success.*')` + `custom.submitted`.
13. `language.ts` → `bt('lang.*')`.
14. `handlers.ts` → `bt('unsupported.media')` + `unknown_command` + cancel branches.

**Step 5** — Sau khi mọi caller migrate xong, xóa `messages.ts` (hoặc giữ shim cho legacy import từ tests).

### 5.3. Effort estimate

- Step 1+2 (skeleton): **S** — 1-2h.
- Step 3 (key map): **S** — 30min.
- Step 4 (migrate 14 file): **M** — 4-6h, từng commit nhỏ.
- Step 5 (cleanup): **S** — 30min.
- **Total**: **M-L** — 1-1.5 ngày làm việc.

---

## TASK 6 — ACTION PLAN (25 task)

| # | Task | File:line | text vi mới | text en mới | Effort |
|---|---|---|---|---|---|
| 1 | Tạo `i18n/index.ts` skeleton (port `bt`, `loadLang`, `saveLang` từ VIA) | new file | — | — | S |
| 2 | Tạo `i18n/common.ts` (welcome, menu, blocked, pending, errors, validate, lang, unsupported, unknown) | new file | (xem TASK 1.3) | (xem TASK 1.3) | S |
| 3 | Tạo `i18n/getproxy.ts` (port toàn bộ getvia → getproxy, custom flow) | new file | (xem TASK 1.1, 1.2) | (xem TASK 1.1, 1.2) | S |
| 4 | Tạo `i18n/status.ts`, `history.ts`, `myproxies.ts`, `support.ts`, `revoke.ts`, `checkproxy.ts`, `whitelist.ts` | new files | (TASK 1.4-1.7) | (TASK 1.4-1.7) | S |
| 5 | Sửa `messages.ts:50-89` (`help`) → có dấu, format VIA | `messages.ts:50-89` | `*Hướng dẫn sử dụng*\n\n/start - Bắt đầu và đăng ký\n/getproxy - Yêu cầu proxy (chọn loại và số lượng)\n/myproxies - Xem proxy được gán\n/checkproxy - Kiểm tra tình trạng proxy\n/status - Trạng thái tài khoản\n/history - Lịch sử yêu cầu\n/revoke - Trả proxy\n/cancel - Hủy yêu cầu\n/support - Gửi tin cho admin\n/language - Đổi ngôn ngữ\n/help - Hiển thị trợ giúp\n\n*Giới hạn yêu cầu:*\nMỗi người dùng có giới hạn số proxy theo giờ, theo ngày và tổng cộng. Dùng /status để xem chi tiết.` | (giữ en gốc, chỉ sửa vi) | S |
| 6 | Sửa `messages.ts:8-45` (`welcome`) — đổi sang format VIA `welcome` (xin chào + count + chọn chức năng) | `messages.ts:8-45` | (xem TASK 1.3 `welcome`) | (xem TASK 1.3 `welcome`) | S |
| 7 | Sửa `messages.ts:166-168` (`bulkRequestPending`) | `messages.ts:166-168` | `[i] Yêu cầu {count} proxy {type} đang chờ duyệt.` | (giữ) | S |
| 8 | Sửa `messages.ts:170-172` (`pendingApproval`) | `messages.ts:170-172` | `[i] Tài khoản của bạn đang chờ admin duyệt. Bạn sẽ được thông báo khi được phê duyệt.` | (giữ) | S |
| 9 | Sửa `messages.ts:174-176` (`supportMessageReceived`) | `messages.ts:174-176` | `Tin nhắn đã nhận. Admin sẽ phản hồi sớm.` | (giữ) | S |
| 10 | Sửa `messages.ts:178-184,186-188,190-192,198-200` (`revokeConfirmAll`, `cancelConfirmPrompt`, `noAuth`, `expiresSoon`, `bulkPartialAssigned`) | `messages.ts:178+` | (xem TASK 4.1) | (giữ) | S |
| 11 | Sửa `start.ts:52-58` pending welcome → format VIA `whitelist.pending` | `start.ts:48-68` | `Tài khoản của bạn đang chờ admin duyệt.\nVui lòng đợi thông báo từ admin đã chia sẻ link bot.` | (giữ) | S |
| 12 | Sửa `status.ts:38-49,71-74` toàn bộ block vi → có dấu | `status.ts:38-74` | (xem TASK 4.1) | (giữ) | M |
| 13 | Sửa `history.ts:29,33,39-43` → có dấu (luôn cả status map) | `history.ts:29-43` | (xem TASK 4.1) | (giữ) | S |
| 14 | Sửa `support.ts:24-29` → có dấu | `support.ts:24-29` | (xem TASK 4.1) | (giữ) | S |
| 15 | Sửa `cancel.ts:43-44,57,64,68-69,96,108,119` → có dấu | `cancel.ts` | (xem TASK 4.1) | (giữ) | S |
| 16 | Sửa `revoke.ts:108-114,152-153` → có dấu | `revoke.ts` | (xem TASK 4.1) | (giữ) | S |
| 17 | Sửa `check-proxy.ts:33,37,57` → có dấu | `check-proxy.ts` | (xem TASK 4.1) | (giữ) | S |
| 18 | Sửa `my-proxies.ts:53,59,66` → có dấu | `my-proxies.ts:46-77` | `Hết hạn` / `không xác thực` / `Sắp hết hạn!` | (giữ) | S |
| 19 | Sửa `handlers.ts:181,229,336-339` → có dấu | `handlers.ts` | `Đã hủy.` / `Tin nhắn đã nhận. Admin sẽ phản hồi sớm.` / `Sử dụng /help để xem các lệnh có sẵn.` | (giữ) | S |
| 20 | Port `confirm.*` keys vào getproxy flow — thêm xác nhận sau khi nhập qty (như VIA `awaiting_confirm` step) | `commands/get-proxy.ts`, new state `awaiting_confirm` | `*Xác nhận yêu cầu*\n\nSố lượng: *{qty}* proxy\nLoại: *{type}*\n\nXác nhận?` | `*Confirm request*\n\nQuantity: *{qty}* proxies\nType: *{type}*\n\nConfirm?` | M |
| 21 | Port `success.remaining` — sau khi assign, hiển thị `Còn lại: N proxy` | `commands/bulk-proxy.ts:87-103` | `Còn lại: *{count}* proxy` | `Remaining: *{count}* proxies` | S |
| 22 | Port `success.submitted` cho custom order | `bulk-proxy.ts:143-146` | `*Yêu cầu {qty} proxy đã được gửi!*\nVui lòng chờ admin duyệt.` | `*Request for {qty} proxies submitted!*\nPlease wait for admin approval.` | S |
| 23 | Port `pending.exists` — chặn user có pending request rồi click /getproxy | `get-proxy.ts:38` (sau guard) | `Bạn đã có yêu cầu đang chờ xử lý.\nVui lòng đợi admin duyệt.` | (en) | M |
| 24 | Port `cooldown` 30s cho getproxy (như VIA `checkBotCooldown`) | `get-proxy.ts:40+` | `Vui lòng đợi {duration} trước khi thử lại.` | (en) | M |
| 25 | Port `validate.number/positive/not_enough` đầy đủ và split khỏi current `custom-order.ts:62` (1 message gộp 3 case) | `custom-order.ts:60-78` | `Vui lòng nhập một *số*. Ví dụ: \`1\`, \`3\`, \`5\`` / `Số lượng phải *lớn hơn 0*.` / `Chỉ còn *{count}* proxy{cat}. Nhập số nhỏ hơn:` | (en) | M |

### Tổng effort
- **S task**: 18 task × ~15-30 min = **5-9 giờ**
- **M task**: 7 task × ~30-60 min = **3.5-7 giờ**
- **Total**: **8-16 giờ** (1-2 ngày làm full focus). Khuyến nghị split sang 3 wave: (a) Vietnamese accent sweep — task 5-19, (b) i18n tách file — task 1-4, (c) Port behavior mới — task 20-25.

---

## Phụ lục — Khác biệt format mà USER YÊU CẦU

User confirm format chuẩn sau khi bấm `Order nhanh`/`Order riêng`:

```
Yêu cầu Proxy — Via cổ 2fa change full được

Có 286 via sẵn sàng (tối đa 2/lần)

Nhập số lượng via bạn cần:
```

Đây là format VIA được GHÉP từ:
- `getvia.title` `*Yêu cầu Via*` + ` — {category}` (callback `getvia.ts:158`)
- `getvia.available` `Có *{count}* via sẵn sàng (tối đa *{max}*/lần)` (callback `getvia.ts:115,126,197`)
- `getvia.enter_qty` `Nhập số lượng via bạn cần:` (callback `getvia.ts:199`)

Áp dụng cho proxy bot: thay `Via cổ 2fa...` → `{TYPE}` (HTTP/HTTPS/SOCKS5):

```
Yêu cầu Proxy — HTTP

Có 286 proxy sẵn sàng (tối đa 2/lần)

Nhập số lượng proxy bạn cần:
```

Hiện tại proxy bot `get-proxy.ts:248-261` đang in:
```
*Order nhanh — HTTP*

Nhập số lượng bạn cần (1–10):

Tự động cấp ngay nếu còn quota.
```

→ **Sửa lại theo format VIA** (task #20 + i18n key `getvia.title` + `getvia.available` + `getvia.enter_qty` ported sang `getproxy.*`).

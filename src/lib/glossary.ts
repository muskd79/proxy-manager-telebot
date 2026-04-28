/**
 * Wave 22M — single-source glossary for Vietnamese terms.
 *
 * Mục đích: chốt cứng 1 thuật ngữ cho mỗi concept để toàn dự án
 * không drift. Khi sửa text trong page, dùng `T.X` thay vì hardcode.
 *
 * Glossary chốt (5-agent review thống nhất):
 *   user (Telegram)        → "Người dùng"   (KHÔNG dùng "user" / "tele user")
 *   admin                  → "Quản trị viên" (sidebar) / "Admin" (technical context)
 *   active                 → "Hoạt động"
 *   inactive               → "Tạm khoá"
 *   delete                 → "Xoá"
 *   trash                  → "Thùng rác"
 *   approve                → "Duyệt"
 *   reject                 → "Từ chối"
 *   settings               → "Cài đặt"
 *   pending                → "Chờ duyệt"
 *   approved               → "Đã duyệt"
 *   rejected               → "Đã từ chối"
 *   expired                → "Hết hạn"
 *   banned                 → "Báo lỗi" / "Cấm"
 *   maintenance            → "Bảo trì"
 *   available              → "Sẵn sàng"
 *   assigned               → "Đã giao"
 *   hidden                 → "Đã ẩn"
 *   create                 → "Tạo"
 *   edit                   → "Sửa"
 *   save                   → "Lưu"
 *   cancel                 → "Huỷ"
 *   refresh                → "Làm mới"
 *   export                 → "Xuất"
 *   import                 → "Nhập"
 *   filter                 → "Lọc"
 *   search                 → "Tìm"
 *   loading                → "Đang tải..."
 *   no data                → "Chưa có dữ liệu"
 *   confirm                → "Xác nhận"
 *   close                  → "Đóng"
 */

export const T = {
  // Common actions
  create: "Tạo",
  edit: "Sửa",
  save: "Lưu",
  cancel: "Huỷ",
  delete: "Xoá",
  refresh: "Làm mới",
  export: "Xuất",
  import: "Nhập",
  search: "Tìm",
  filter: "Lọc",
  confirm: "Xác nhận",
  close: "Đóng",
  approve: "Duyệt",
  reject: "Từ chối",
  view: "Xem",
  details: "Chi tiết",
  more: "Thêm",
  back: "Quay lại",
  next: "Tiếp",
  previous: "Trước",
  submit: "Gửi",

  // States
  loading: "Đang tải...",
  loadingShort: "Đang tải",
  saving: "Đang lưu...",
  noData: "Chưa có dữ liệu",
  empty: "Trống",
  error: "Lỗi",
  retry: "Thử lại",
  success: "Thành công",
  failed: "Thất bại",

  // Common labels
  active: "Hoạt động",
  inactive: "Tạm khoá",
  hidden: "Đã ẩn",
  visible: "Hiển thị",
  enabled: "Bật",
  disabled: "Tắt",

  // Status (proxy lifecycle + request lifecycle)
  status: {
    available: "Sẵn sàng",
    assigned: "Đã giao",
    expired: "Hết hạn",
    expiringSoon: "Sắp hết hạn",
    valid: "Còn hạn",
    permanent: "Vĩnh viễn",
    banned: "Báo lỗi",
    maintenance: "Bảo trì",
    pending: "Chờ duyệt",
    approved: "Đã duyệt",
    rejected: "Đã từ chối",
    cancelled: "Đã huỷ",
    autoApproved: "Tự duyệt",
  },

  // Roles
  role: {
    super_admin: "Super admin",
    admin: "Quản trị viên",
    viewer: "Xem chỉ",
  },

  // Entity nouns
  entity: {
    proxy: "Proxy",
    proxies: "Proxy",
    user: "Người dùng",
    users: "Người dùng",
    admin: "Quản trị viên",
    admins: "Quản trị viên",
    request: "Yêu cầu",
    requests: "Yêu cầu",
    category: "Danh mục",
    categories: "Danh mục",
    setting: "Cài đặt",
    settings: "Cài đặt",
    log: "Nhật ký",
    logs: "Nhật ký",
    trash: "Thùng rác",
    chat: "Hộp thoại",
    history: "Lịch sử",
    profile: "Hồ sơ",
  },

  // Page titles
  page: {
    dashboard: "Trang chủ",
    proxies: "Proxy",
    categories: "Danh mục",
    users: "Người dùng",
    requests: "Yêu cầu",
    chat: "Hộp thoại bot",
    botSimulator: "Test bot (giả lập)",
    history: "Lịch sử",
    logs: "Nhật ký hệ thống",
    trash: "Thùng rác",
    admins: "Quản trị viên",
    settings: "Cài đặt",
    profile: "Hồ sơ cá nhân",
    apiDocs: "Tài liệu API",
  },

  // Common form labels
  field: {
    email: "Email",
    password: "Mật khẩu",
    currentPassword: "Mật khẩu hiện tại",
    newPassword: "Mật khẩu mới",
    confirmPassword: "Xác nhận mật khẩu",
    fullName: "Họ tên",
    phone: "Số điện thoại",
    role: "Vai trò",
    notes: "Ghi chú",
    description: "Mô tả",
    name: "Tên",
    createdAt: "Ngày tạo",
    updatedAt: "Cập nhật",
    expiresAt: "Ngày hết hạn",
    purchaseDate: "Ngày mua",
    purchasePrice: "Giá mua",
    salePrice: "Giá bán",
    country: "Quốc gia",
    city: "Thành phố",
    isp: "ISP (nhà mạng)",
    networkType: "Phân loại",
    type: "Loại",
    host: "Host",
    port: "Cổng",
    username: "Tên đăng nhập",
    telegramId: "Telegram ID",
    language: "Ngôn ngữ",
    actions: "Thao tác",
    lastLogin: "Đăng nhập cuối",
    enabled: "Đã bật",
    disabled: "Đã tắt",
  },

  // Common error messages (replace generic toast.error English)
  errors: {
    loadFailed: "Tải dữ liệu thất bại",
    saveFailed: "Lưu thất bại",
    deleteFailed: "Xoá thất bại",
    networkError: "Lỗi mạng — kiểm tra kết nối",
    unauthorized: "Không có quyền",
    notFound: "Không tìm thấy",
    validationFailed: "Dữ liệu không hợp lệ",
    unknown: "Đã có lỗi xảy ra",
  },

  // Confirmation prompts
  confirmPrompt: {
    delete: "Bạn có chắc muốn xoá?",
    deleteMany: (n: number) => `Xoá ${n} mục?`,
    leave: "Rời trang? Thay đổi chưa lưu sẽ mất.",
  },
} as const;

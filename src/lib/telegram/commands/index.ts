export { handleStart } from "./start";
export { handleGetProxy, handleProxyTypeSelection, handleOrderModeSelection } from "./get-proxy";
export { handleQtyTextInput, handleConfirmCallback } from "./custom-order";
export { handleMyProxies } from "./my-proxies";
export { handleStatus } from "./status";
export { handleRevoke, handleRevokeConfirm, handleRevokeSelection } from "./revoke";
export { handleCancel, handleCancelConfirm } from "./cancel";
export { handleLanguage, handleLanguageSelection } from "./language";
export { handleHelp, handleUnknownCommand } from "./help";
export { handleCheckProxy, handleCheckListInput } from "./check-proxy";
export { handleHistory } from "./history";
export { handleSupport } from "./support";
// Wave 23C-fix — AUP exports removed; aup.ts kept on disk as
// legacy reference but no longer wired into the dispatcher.
export {
  handleAdminRequests,
  handleAdminApproveCallback,
  handleAdminRejectCallback,
  handleAdminApproveUser,
  handleAdminBlockUser,
} from "./admin-approve";
// Wave 26-D-2B — bot warranty flow.
export {
  handleWarrantyClaim,
  handleWarrantyReason,
  handleWarrantyReasonText,
  handleWarrantyCancel,
} from "./warranty";

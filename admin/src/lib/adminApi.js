import { get, post, patch, del, api as storefrontApi } from "@shared/lib/api.js";

export { ApiError, setUnauthorizedHandler } from "@shared/lib/api.js";
export { getToken, setToken } from "@shared/lib/token.js";

// The admin surface, built on the storefront's HTTP layer (base URL
// resolution, 401 handling, error mapping) so there is exactly one of those
// in the codebase.
//
// Kept separate from the storefront's `api` object on purpose: the customer
// app should not ship a directory of every privileged endpoint, and this app
// has no use for wallet top-ups or redeem codes.
export const adminApi = {
  // --- auth ---------------------------------------------------------------
  login: (body) => post("/auth/login", body),
  me: () => get("/auth/me"),

  // --- users & roles ------------------------------------------------------
  listUsers: (query) => get("/admin/users", query),
  setUserStatus: (id, status) => patch(`/admin/users/${id}/status`, { status }),
  // Root only (the API enforces `admins.manage`). `staff_scopes` is 'root'
  // or any combination of FINANCE_ADMIN / USERS_ADMIN / CONTENT_ADMIN.
  setUserRole: (id, body) => patch(`/admin/users/${id}/role`, body),
  createAdmin: (body) => post("/admin/admins", body),
  roleCatalogue: () => get("/admin/roles"),
  // One person's referral network: sponsors above, the tree below.
  userNetwork: (id, query) => get(`/admin/users/${id}/network`, query),

  // --- site settings ------------------------------------------------------
  getSettings: () => get("/admin/settings"),
  // Public, unauthenticated and cached 30s server-side. The console reads it
  // to hide pages for features this deployment does not run at all.
  siteConfig: () => get("/site-config"),
  updateSettings: (body) => patch("/admin/settings", body),
  resetSetting: (key) => post(`/admin/settings/${key}/reset`, {}),

  // --- catalogue ----------------------------------------------------------
  listProducts: (query) => get("/products", query),
  getProduct: (id) => get(`/products/${id}`),
  createProduct: (body) => post("/products", body),
  updateProduct: (id, body) => patch(`/products/${id}`, body),
  updateProductPrice: (id, body) => patch(`/products/${id}/price`, body),
  updateProductStatus: (id, status) => patch(`/products/${id}/status`, { status }),
  // `costCents` is the per-unit cost of the batch being added; omit it for a
  // count correction (removing stock has no price).
  adjustStock: (id, delta, costCents) =>
    patch(`/products/${id}/stock`, costCents === undefined ? { delta } : { delta, cost_cents: costCents }),
  appendWarehouseCost: (id, body) => post(`/products/${id}/warehouse-cost`, body),
  getWarehouseCostHistory: (id) => get(`/products/${id}/warehouse-cost`),
  productImageUrl: (product) => product?.specs?.image_url ?? null,

  // --- commission policy --------------------------------------------------
  getCommissionPlan: (productId) => get(`/commission-plans/${productId}`),
  updateCommissionPlan: (productId, body) => patch(`/commission-plans/${productId}`, body),
  listRankTiers: (productId) => get(`/commission-plans/${productId}/rank-tiers`),
  createRankTier: (productId, body) => post(`/commission-plans/${productId}/rank-tiers`, body),
  updateRankTier: (productId, tierId, body) => patch(`/commission-plans/${productId}/rank-tiers/${tierId}`, body),
  listQuotaTiers: (productId) => get(`/commission-plans/${productId}/quota-tiers`),
  createQuotaTier: (productId, body) => post(`/commission-plans/${productId}/quota-tiers`, body),
  updateQuotaTier: (productId, tierId, body) => patch(`/commission-plans/${productId}/quota-tiers/${tierId}`, body),

  // --- orders -------------------------------------------------------------
  listOrders: (query) => get("/admin/orders", query),
  getOrder: (id) => get(`/admin/orders/${id}`),
  refundOrder: (id, body) => post(`/admin/orders/${id}/refund`, body),
  createManualOrder: (body) => post("/admin/orders/manual", body),

  // --- cheque register ----------------------------------------------------
  listCheques: (query) => get("/cheques", query),
  getCheque: (id) => get(`/cheques/${id}`),
  listOrderCheques: (orderId) => get(`/admin/orders/${orderId}/cheques`),
  addCheque: (orderId, body) => post(`/admin/orders/${orderId}/cheques`, body),
  updateCheque: (id, body) => patch(`/cheques/${id}`, body),
  setChequeStatus: (id, status) => post(`/cheques/${id}/status`, { status }),
  // Same-origin path, proxied to the API -- never an absolute URL, for the
  // same reason productImageUrl isn't one.
  chequeImageUrl: (id) => `/cheques/${id}/image`,

  // Needed to build links the browser opens directly (the proforma PDF);
  // same origin resolution as every request.
  baseUrl: () => storefrontApi.baseUrl(),

  // --- proformas & leases (sales queue) -----------------------------------
  listQuotes: (query) => get("/sales/quotes", query),
  getQuote: (id) => get(`/sales/quotes/${id}`),
  updateQuote: (id, body) => patch(`/sales/quotes/${id}`, body),

  // --- network ------------------------------------------------------------
  getNode: (id) => get(`/nodes/${id}`),
  setNodeStatus: (id, status) => patch(`/nodes/${id}/status`, { status }),
  getSpaceTree: (id) => get(`/spaces/${id}/tree`),

  // --- support requests ---------------------------------------------------
  listSupportRequests: (query) => get("/support/requests", query),
  getSupportRequest: (id) => get(`/support/requests/${id}`),
  updateSupportRequest: (id, body) => patch(`/support/requests/${id}`, body),

  // --- blog ---------------------------------------------------------------
  listPosts: (query) => get("/blog/admin/posts", query),
  getPost: (id) => get(`/blog/admin/posts/${id}`),
  createPost: (body) => post("/blog/admin/posts", body),
  updatePost: (id, body) => patch(`/blog/admin/posts/${id}`, body),
  deletePost: (id) => del(`/blog/admin/posts/${id}`),
  instagramFeed: () => get("/blog/instagram"),

  // --- assistant knowledge ------------------------------------------------
  listKnowledge: (query) => get("/ai/knowledge", query),
  createKnowledge: (body) => post("/ai/knowledge", body),
  updateKnowledge: (id, body) => patch(`/ai/knowledge/${id}`, body),
  deleteKnowledge: (id) => del(`/ai/knowledge/${id}`),
  listAnswerGaps: (query) => get("/ai/gaps", query),
  updateAnswerGap: (id, status) => patch(`/ai/gaps/${id}`, { status }),
  aiConversations: (query) => get("/ai/conversations", query),
  aiToolCalls: (query) => get("/ai/tool-calls", query),

  // --- network payouts ------------------------------------------------------
  payouts: (query) => get("/admin/payouts", query),
  payoutDetail: (userId, query) => get(`/admin/payouts/${userId}`, query),
  payoutHistory: (query) => get("/admin/payouts/history", query),
  settlePayout: (userId, body) => post(`/admin/payouts/${userId}/settle`, body),

  // --- operations ---------------------------------------------------------
  runJob: (name, body) => post(`/admin/jobs/${name}`, body || {}),
  listNotifications: (query) => get("/admin/notifications", query),
  retryNotification: (id) => post(`/admin/notifications/${id}/retry`, {}),
  overview: () => get("/admin/monitoring/overview"),
  trexNetReport: (query) => get("/admin/monitoring/reports/trex-net", query),
  reserveFundReport: () => get("/admin/monitoring/reports/reserve-fund"),
  auditInvariants: () => get("/admin/monitoring/reports/audit-invariants"),
  rankBonusPeriods: (query) => get("/admin/monitoring/reports/rank-bonus-periods", query),
  rankBonusPeriodDetail: (id) => get(`/admin/monitoring/reports/rank-bonus-periods/${id}`),
  logs: (query) => get("/admin/logs", query),

  _del: del,
};

import { onRequestPost as __sales__id__email_js_onRequestPost } from "C:\\Users\\mrive\\AndroidStudioProjects\\american-pos-backend\\functions\\sales\\[id]\\email.js"
import { onRequestPost as __auth_login_js_onRequestPost } from "C:\\Users\\mrive\\AndroidStudioProjects\\american-pos-backend\\functions\\auth\\login.js"
import { onRequestPost as __cash_close_js_onRequestPost } from "C:\\Users\\mrive\\AndroidStudioProjects\\american-pos-backend\\functions\\cash\\close.js"
import { onRequestGet as __cash_current_js_onRequestGet } from "C:\\Users\\mrive\\AndroidStudioProjects\\american-pos-backend\\functions\\cash\\current.js"
import { onRequestPost as __cash_movement_js_onRequestPost } from "C:\\Users\\mrive\\AndroidStudioProjects\\american-pos-backend\\functions\\cash\\movement.js"
import { onRequestPost as __cash_open_js_onRequestPost } from "C:\\Users\\mrive\\AndroidStudioProjects\\american-pos-backend\\functions\\cash\\open.js"
import { onRequestGet as __settings_business_js_onRequestGet } from "C:\\Users\\mrive\\AndroidStudioProjects\\american-pos-backend\\functions\\settings\\business.js"
import { onRequestPost as __settings_business_js_onRequestPost } from "C:\\Users\\mrive\\AndroidStudioProjects\\american-pos-backend\\functions\\settings\\business.js"
import { onRequestGet as __settings_payment_methods_js_onRequestGet } from "C:\\Users\\mrive\\AndroidStudioProjects\\american-pos-backend\\functions\\settings\\payment-methods.js"
import { onRequestPost as __settings_payment_methods_js_onRequestPost } from "C:\\Users\\mrive\\AndroidStudioProjects\\american-pos-backend\\functions\\settings\\payment-methods.js"
import { onRequestGet as __settings_rate_js_onRequestGet } from "C:\\Users\\mrive\\AndroidStudioProjects\\american-pos-backend\\functions\\settings\\rate.js"
import { onRequestPost as __settings_rate_js_onRequestPost } from "C:\\Users\\mrive\\AndroidStudioProjects\\american-pos-backend\\functions\\settings\\rate.js"
import { onRequest as __test_hello_js_onRequest } from "C:\\Users\\mrive\\AndroidStudioProjects\\american-pos-backend\\functions\\test\\hello.js"
import { onRequestDelete as __customers__id__js_onRequestDelete } from "C:\\Users\\mrive\\AndroidStudioProjects\\american-pos-backend\\functions\\customers\\[id].js"
import { onRequestPut as __customers__id__js_onRequestPut } from "C:\\Users\\mrive\\AndroidStudioProjects\\american-pos-backend\\functions\\customers\\[id].js"
import { onRequestDelete as __products__id__js_onRequestDelete } from "C:\\Users\\mrive\\AndroidStudioProjects\\american-pos-backend\\functions\\products\\[id].js"
import { onRequestPut as __products__id__js_onRequestPut } from "C:\\Users\\mrive\\AndroidStudioProjects\\american-pos-backend\\functions\\products\\[id].js"
import { onRequest as __users__id__js_onRequest } from "C:\\Users\\mrive\\AndroidStudioProjects\\american-pos-backend\\functions\\users\\[id].js"
import { onRequestGet as __customers_index_js_onRequestGet } from "C:\\Users\\mrive\\AndroidStudioProjects\\american-pos-backend\\functions\\customers\\index.js"
import { onRequestPost as __customers_index_js_onRequestPost } from "C:\\Users\\mrive\\AndroidStudioProjects\\american-pos-backend\\functions\\customers\\index.js"
import { onRequestGet as __dashboard_summary_js_onRequestGet } from "C:\\Users\\mrive\\AndroidStudioProjects\\american-pos-backend\\functions\\dashboard-summary.js"
import { onRequestGet as __debug_db_js_onRequestGet } from "C:\\Users\\mrive\\AndroidStudioProjects\\american-pos-backend\\functions\\debug-db.js"
import { onRequestPost as __debug_db_js_onRequestPost } from "C:\\Users\\mrive\\AndroidStudioProjects\\american-pos-backend\\functions\\debug-db.js"
import { onRequestGet as __products_index_js_onRequestGet } from "C:\\Users\\mrive\\AndroidStudioProjects\\american-pos-backend\\functions\\products\\index.js"
import { onRequestPost as __products_index_js_onRequestPost } from "C:\\Users\\mrive\\AndroidStudioProjects\\american-pos-backend\\functions\\products\\index.js"
import { onRequestGet as __sales_index_js_onRequestGet } from "C:\\Users\\mrive\\AndroidStudioProjects\\american-pos-backend\\functions\\sales\\index.js"
import { onRequestPost as __sales_index_js_onRequestPost } from "C:\\Users\\mrive\\AndroidStudioProjects\\american-pos-backend\\functions\\sales\\index.js"
import { onRequestGet as __users_index_js_onRequestGet } from "C:\\Users\\mrive\\AndroidStudioProjects\\american-pos-backend\\functions\\users\\index.js"
import { onRequestPost as __users_index_js_onRequestPost } from "C:\\Users\\mrive\\AndroidStudioProjects\\american-pos-backend\\functions\\users\\index.js"
import { onRequest as __hello_js_onRequest } from "C:\\Users\\mrive\\AndroidStudioProjects\\american-pos-backend\\functions\\hello.js"
import { onRequest as __inspect_schema_js_onRequest } from "C:\\Users\\mrive\\AndroidStudioProjects\\american-pos-backend\\functions\\inspect-schema.js"
import { onRequest as __restore_full_js_onRequest } from "C:\\Users\\mrive\\AndroidStudioProjects\\american-pos-backend\\functions\\restore-full.js"
import { onRequest as __restore_full_v2_js_onRequest } from "C:\\Users\\mrive\\AndroidStudioProjects\\american-pos-backend\\functions\\restore-full-v2.js"
import { onRequest as __test_index_js_onRequest } from "C:\\Users\\mrive\\AndroidStudioProjects\\american-pos-backend\\functions\\test\\index.js"
import { onRequest as ___middleware_js_onRequest } from "C:\\Users\\mrive\\AndroidStudioProjects\\american-pos-backend\\functions\\_middleware.js"

export const routes = [
    {
      routePath: "/sales/:id/email",
      mountPath: "/sales/:id",
      method: "POST",
      middlewares: [],
      modules: [__sales__id__email_js_onRequestPost],
    },
  {
      routePath: "/auth/login",
      mountPath: "/auth",
      method: "POST",
      middlewares: [],
      modules: [__auth_login_js_onRequestPost],
    },
  {
      routePath: "/cash/close",
      mountPath: "/cash",
      method: "POST",
      middlewares: [],
      modules: [__cash_close_js_onRequestPost],
    },
  {
      routePath: "/cash/current",
      mountPath: "/cash",
      method: "GET",
      middlewares: [],
      modules: [__cash_current_js_onRequestGet],
    },
  {
      routePath: "/cash/movement",
      mountPath: "/cash",
      method: "POST",
      middlewares: [],
      modules: [__cash_movement_js_onRequestPost],
    },
  {
      routePath: "/cash/open",
      mountPath: "/cash",
      method: "POST",
      middlewares: [],
      modules: [__cash_open_js_onRequestPost],
    },
  {
      routePath: "/settings/business",
      mountPath: "/settings",
      method: "GET",
      middlewares: [],
      modules: [__settings_business_js_onRequestGet],
    },
  {
      routePath: "/settings/business",
      mountPath: "/settings",
      method: "POST",
      middlewares: [],
      modules: [__settings_business_js_onRequestPost],
    },
  {
      routePath: "/settings/payment-methods",
      mountPath: "/settings",
      method: "GET",
      middlewares: [],
      modules: [__settings_payment_methods_js_onRequestGet],
    },
  {
      routePath: "/settings/payment-methods",
      mountPath: "/settings",
      method: "POST",
      middlewares: [],
      modules: [__settings_payment_methods_js_onRequestPost],
    },
  {
      routePath: "/settings/rate",
      mountPath: "/settings",
      method: "GET",
      middlewares: [],
      modules: [__settings_rate_js_onRequestGet],
    },
  {
      routePath: "/settings/rate",
      mountPath: "/settings",
      method: "POST",
      middlewares: [],
      modules: [__settings_rate_js_onRequestPost],
    },
  {
      routePath: "/test/hello",
      mountPath: "/test",
      method: "",
      middlewares: [],
      modules: [__test_hello_js_onRequest],
    },
  {
      routePath: "/customers/:id",
      mountPath: "/customers",
      method: "DELETE",
      middlewares: [],
      modules: [__customers__id__js_onRequestDelete],
    },
  {
      routePath: "/customers/:id",
      mountPath: "/customers",
      method: "PUT",
      middlewares: [],
      modules: [__customers__id__js_onRequestPut],
    },
  {
      routePath: "/products/:id",
      mountPath: "/products",
      method: "DELETE",
      middlewares: [],
      modules: [__products__id__js_onRequestDelete],
    },
  {
      routePath: "/products/:id",
      mountPath: "/products",
      method: "PUT",
      middlewares: [],
      modules: [__products__id__js_onRequestPut],
    },
  {
      routePath: "/users/:id",
      mountPath: "/users",
      method: "",
      middlewares: [],
      modules: [__users__id__js_onRequest],
    },
  {
      routePath: "/customers",
      mountPath: "/customers",
      method: "GET",
      middlewares: [],
      modules: [__customers_index_js_onRequestGet],
    },
  {
      routePath: "/customers",
      mountPath: "/customers",
      method: "POST",
      middlewares: [],
      modules: [__customers_index_js_onRequestPost],
    },
  {
      routePath: "/dashboard-summary",
      mountPath: "/",
      method: "GET",
      middlewares: [],
      modules: [__dashboard_summary_js_onRequestGet],
    },
  {
      routePath: "/debug-db",
      mountPath: "/",
      method: "GET",
      middlewares: [],
      modules: [__debug_db_js_onRequestGet],
    },
  {
      routePath: "/debug-db",
      mountPath: "/",
      method: "POST",
      middlewares: [],
      modules: [__debug_db_js_onRequestPost],
    },
  {
      routePath: "/products",
      mountPath: "/products",
      method: "GET",
      middlewares: [],
      modules: [__products_index_js_onRequestGet],
    },
  {
      routePath: "/products",
      mountPath: "/products",
      method: "POST",
      middlewares: [],
      modules: [__products_index_js_onRequestPost],
    },
  {
      routePath: "/sales",
      mountPath: "/sales",
      method: "GET",
      middlewares: [],
      modules: [__sales_index_js_onRequestGet],
    },
  {
      routePath: "/sales",
      mountPath: "/sales",
      method: "POST",
      middlewares: [],
      modules: [__sales_index_js_onRequestPost],
    },
  {
      routePath: "/users",
      mountPath: "/users",
      method: "GET",
      middlewares: [],
      modules: [__users_index_js_onRequestGet],
    },
  {
      routePath: "/users",
      mountPath: "/users",
      method: "POST",
      middlewares: [],
      modules: [__users_index_js_onRequestPost],
    },
  {
      routePath: "/hello",
      mountPath: "/",
      method: "",
      middlewares: [],
      modules: [__hello_js_onRequest],
    },
  {
      routePath: "/inspect-schema",
      mountPath: "/",
      method: "",
      middlewares: [],
      modules: [__inspect_schema_js_onRequest],
    },
  {
      routePath: "/restore-full",
      mountPath: "/",
      method: "",
      middlewares: [],
      modules: [__restore_full_js_onRequest],
    },
  {
      routePath: "/restore-full-v2",
      mountPath: "/",
      method: "",
      middlewares: [],
      modules: [__restore_full_v2_js_onRequest],
    },
  {
      routePath: "/test",
      mountPath: "/test",
      method: "",
      middlewares: [],
      modules: [__test_index_js_onRequest],
    },
  {
      routePath: "/",
      mountPath: "/",
      method: "",
      middlewares: [___middleware_js_onRequest],
      modules: [],
    },
  ]
declare namespace App {
  interface Locals {
    /** Prijavljeni admin, samo pod /admin (src/middleware.ts). */
    admin?: import("./lib/admin/sesija").Session;
  }
}

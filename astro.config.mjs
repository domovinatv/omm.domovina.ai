// @ts-check
import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";

export default defineConfig({
  site: "https://omm.domovina.ai",
  output: "server",
  adapter: cloudflare(),
});

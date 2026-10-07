/**
 * Writes the search-engine files at build time:
 * - the home page head tags and text section (into index.html)
 * - one <slug>.html per landing page, from the built index.html
 * - sitemap.xml, llms.txt and 404.html
 *
 * Cloudflare Pages serves dist/json-to-yaml.html at /json-to-yaml, and with a
 * 404.html it answers unknown paths with status 404 instead of the app.
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Plugin, ResolvedConfig } from "vite";
import { landingPages } from "./pages.ts";
import {
  applyTemplate,
  buildExample,
  render404,
  renderHomeContent,
  renderHomeHead,
  renderLlmsTxt,
  renderPageContent,
  renderPageHead,
  renderSitemap,
} from "./render.ts";

// The date of the last commit, or undefined when git is not available
function lastCommitDate(): string | undefined {
  try {
    const date = execSync("git log -1 --format=%cs", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined;
  } catch {
    return undefined;
  }
}

export function seoPages(): Plugin {
  let config: ResolvedConfig;
  return {
    name: "parsebox-seo-pages",
    configResolved(resolved) {
      config = resolved;
    },
    // Dev and build: the home page gets its head tags and text section
    transformIndexHtml(html) {
      return applyTemplate(html, renderHomeHead(), renderHomeContent());
    },
    async closeBundle() {
      if (config.command !== "build") return;
      const outDir = path.resolve(config.root, config.build.outDir);
      const indexHtml = readFileSync(path.join(outDir, "index.html"), "utf8");
      for (const page of landingPages) {
        const html = applyTemplate(indexHtml, renderPageHead(page), renderPageContent(page, await buildExample(page)));
        writeFileSync(path.join(outDir, `${page.slug}.html`), html);
      }
      writeFileSync(path.join(outDir, "sitemap.xml"), renderSitemap(lastCommitDate()));
      writeFileSync(path.join(outDir, "llms.txt"), renderLlmsTxt());
      writeFileSync(path.join(outDir, "404.html"), render404());
      config.logger.info(`seo: wrote ${landingPages.length} landing pages, sitemap.xml, llms.txt and 404.html`);
    },
  };
}

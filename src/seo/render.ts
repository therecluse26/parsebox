/**
 * The static HTML for search engines: the <head> tags and the text section
 * under the app, for the home page and each landing page, plus the sitemap,
 * llms.txt and the 404 page. Build time only (src/seo/vite-plugin.ts); the app
 * never imports this file.
 */
import type { LossReport } from "../lib/convert/types.ts";
import { runConversion } from "../lib/convert/pipeline.ts";
import { kindForCount } from "../lib/losses.ts";
import { formatCount, formatGroupLabels, formatOptions, type FormatGroup } from "../config/formats.ts";
import {
  SITE_URL,
  home,
  landingPages,
  pageGroupLabels,
  pageTitle,
  pageUrl,
  relatedPages,
  sampleFor,
  type LandingPage,
  type PageGroup,
} from "./pages.ts";

export const HEAD_START = "<!--seo:head-->";
export const HEAD_END = "<!--/seo:head-->";
export const CONTENT_START = "<!--seo:content-->";
export const CONTENT_END = "<!--/seo:content-->";

const OG_IMAGE = `${SITE_URL}/og-image.png`;

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// JSON-LD sits in a <script>; "</" in a string would end it early
const jsonLd = (data: object) =>
  `<script type="application/ld+json">${JSON.stringify(data).replace(/<\//g, "<\\/")}</script>`;

const webApplication = (name: string, url: string, description: string) => ({
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name,
  url,
  description,
  applicationCategory: "DeveloperApplication",
  operatingSystem: "Any",
  browserRequirements: "Requires JavaScript",
  isAccessibleForFree: true,
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  featureList: [
    `Convert between ${formatCount} formats`,
    "Auto-detect the input format",
    "Decode Base64, URL encoding and JWT",
    "Repair broken JSON",
    "Report what a conversion loses",
    "Generate TypeScript, Zod, Go, Rust, Python, C#, Kotlin, Swift and Java types",
    "Runs in the browser: data never leaves your machine",
  ],
});

interface HeadTags {
  title: string;
  description: string;
  url: string;
  structuredData: object[];
}

function renderHeadTags({ title, description, url, structuredData }: HeadTags): string {
  const t = escapeHtml(title);
  const d = escapeHtml(description);
  const u = escapeHtml(url);
  return [
    `<title>${t}</title>`,
    `<meta name="description" content="${d}" />`,
    `<link rel="canonical" href="${u}" />`,
    `<meta name="robots" content="index, follow" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="ParseBox" />`,
    `<meta property="og:title" content="${t}" />`,
    `<meta property="og:description" content="${d}" />`,
    `<meta property="og:url" content="${u}" />`,
    `<meta property="og:image" content="${OG_IMAGE}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${t}" />`,
    `<meta name="twitter:description" content="${d}" />`,
    `<meta name="twitter:image" content="${OG_IMAGE}" />`,
    ...structuredData.map(jsonLd),
  ].join("\n    ");
}

export function renderHomeHead(): string {
  const url = `${SITE_URL}/`;
  return renderHeadTags({
    title: home.title,
    description: home.description,
    url,
    structuredData: [
      // Google takes the site name shown above a result from WebSite
      { "@context": "https://schema.org", "@type": "WebSite", name: "ParseBox", url },
      webApplication("ParseBox", url, home.description),
    ],
  });
}

export function renderPageHead(page: LandingPage): string {
  const url = pageUrl(page);
  return renderHeadTags({
    title: pageTitle(page),
    description: page.description,
    url,
    structuredData: [
      webApplication(`ParseBox ${page.h1}`, url, page.description),
      {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "ParseBox", item: `${SITE_URL}/` },
          { "@type": "ListItem", position: 2, name: page.h1, item: url },
        ],
      },
    ],
  });
}

export interface Example {
  input: string;
  output: string;
  losses: LossReport | null;
}

/** Convert the page's sample with the app's own pipeline, so the example matches the app. */
export async function buildExample(page: LandingPage): Promise<Example> {
  const input = sampleFor(page);
  const result = await runConversion({
    id: 0,
    text: input,
    inputFormat: page.input,
    outputFormat: page.output,
    outputFormatLocked: true,
    options: { redactSecrets: false },
  });
  if (result.parseError || result.outputError) {
    throw new Error(`The ${page.slug} sample does not convert: ${result.parseError?.message ?? result.outputError}`);
  }
  return { input: input.trim(), output: result.output.trim(), losses: result.losses };
}

// Shared Tailwind classes; Tailwind scans this file, so they reach the CSS
const SECTION = "border-t bg-background text-foreground";
const INNER = "mx-auto max-w-4xl space-y-8 px-4 py-12 text-sm leading-relaxed md:px-7";
const H1 = "text-xl font-semibold tracking-tight md:text-2xl";
const H2 = "mb-3 text-base font-semibold";
const MUTED = "text-muted-foreground";
const PRE = "max-h-96 overflow-auto rounded border bg-card p-3 text-xs leading-relaxed";
const LINK = "underline-offset-4 hover:underline";
const LINK_GRID = "grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2 md:grid-cols-3";

const PRIVACY =
  "ParseBox runs entirely in your browser. Your text is never uploaded, logged or stored on a server, so it is safe to paste API responses, tokens and config files.";

const pageLink = (page: LandingPage) =>
  `<li><a class="${LINK}" href="/${page.slug}">${escapeHtml(page.h1)}</a></li>`;

function pageLinkGroups(): string {
  const groups = Object.keys(pageGroupLabels) as PageGroup[];
  return groups
    .map(
      (group) => `<div>
        <h3 class="mb-2 font-semibold">${escapeHtml(pageGroupLabels[group])}</h3>
        <ul class="${LINK_GRID}">${landingPages.filter((page) => page.group === group).map(pageLink).join("")}</ul>
      </div>`
    )
    .join("\n");
}

function formatList(): string {
  const groups = (Object.keys(formatGroupLabels) as FormatGroup[]).filter((group) => group !== "mode");
  return groups
    .map((group) => {
      const labels = formatOptions.filter((option) => option.group === group).map((option) => option.label);
      return `<li><span class="font-semibold">${escapeHtml(formatGroupLabels[group])}:</span> <span class="${MUTED}">${escapeHtml(labels.join(", "))}</span></li>`;
    })
    .join("");
}

export function renderHomeContent(): string {
  return `<section id="about" class="${SECTION}">
      <div class="${INNER}">
        <div class="space-y-3">
          <h1 class="${H1}">${escapeHtml(home.h1)}</h1>
          <p class="${MUTED}">${escapeHtml(home.intro)}</p>
          <p class="${MUTED}">${escapeHtml(PRIVACY)}</p>
        </div>
        <div>
          <h2 class="${H2}">Supported formats</h2>
          <ul class="space-y-1.5">${formatList()}</ul>
        </div>
        <div class="space-y-6">
          <h2 class="${H2}">Popular conversions</h2>
          ${pageLinkGroups()}
        </div>
      </div>
    </section>`;
}

function lossList(losses: LossReport | null): string {
  if (!losses) return "";
  const lines = [
    ...losses.items.map((item) => {
      const where = item.examples.length > 0 ? ` (${item.examples.map((path) => path || "the root").join(", ")})` : "";
      return `${item.count} ${kindForCount(item.kind, item.count)}${where}`;
    }),
    ...losses.rules,
  ];
  if (lines.length === 0) return "";
  return `<div>
          <h2 class="${H2}">What changes in this conversion</h2>
          <p class="mb-2 ${MUTED}">ParseBox shows this note under the output, so nothing is lost without a warning.</p>
          <ul class="list-disc space-y-1 pl-5 ${MUTED}">${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>
        </div>`;
}

export function renderPageContent(page: LandingPage, example: Example): string {
  const related = relatedPages(page);
  return `<section id="about" class="${SECTION}">
      <div class="${INNER}">
        <div class="space-y-3">
          <h1 class="${H1}">${escapeHtml(page.h1)}</h1>
          <p class="${MUTED}">${escapeHtml(page.intro)}</p>
        </div>
        <div>
          <h2 class="${H2}">Example</h2>
          <div class="grid gap-3 md:grid-cols-2">
            <figure class="min-w-0"><figcaption class="mb-1.5 text-xs ${MUTED}">Input</figcaption><pre class="${PRE}"><code>${escapeHtml(example.input)}</code></pre></figure>
            <figure class="min-w-0"><figcaption class="mb-1.5 text-xs ${MUTED}">Output</figcaption><pre class="${PRE}"><code>${escapeHtml(example.output)}</code></pre></figure>
          </div>
        </div>
        ${lossList(example.losses)}
        <div>
          <h2 class="${H2}">Private by design</h2>
          <p class="${MUTED}">${escapeHtml(PRIVACY)}</p>
        </div>
        ${
          related.length > 0
            ? `<div>
          <h2 class="${H2}">Related conversions</h2>
          <ul class="${LINK_GRID}">${related.map(pageLink).join("")}</ul>
        </div>`
            : ""
        }
        <p><a class="${LINK}" href="/">All ${formatCount} formats in ParseBox →</a></p>
      </div>
    </section>`;
}

/** Put the head tags and the content between the markers of the built index.html. */
export function applyTemplate(html: string, head: string, content: string): string {
  const replaceBetween = (source: string, start: string, end: string, value: string) => {
    const from = source.indexOf(start);
    const to = source.indexOf(end);
    if (from === -1 || to === -1 || to < from) throw new Error(`index.html is missing the ${start} markers`);
    return source.slice(0, from + start.length) + "\n    " + value + "\n    " + source.slice(to);
  };
  return replaceBetween(replaceBetween(html, HEAD_START, HEAD_END, head), CONTENT_START, CONTENT_END, content);
}

export function renderSitemap(lastmod?: string): string {
  const urls = [`${SITE_URL}/`, ...landingPages.map(pageUrl)];
  const entries = urls.map(
    (url) => `  <url>\n    <loc>${url}</loc>${lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ""}\n  </url>`
  );
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join("\n")}\n</urlset>\n`;
}

export function renderLlmsTxt(): string {
  const groups = Object.keys(pageGroupLabels) as PageGroup[];
  return [
    "# ParseBox",
    "",
    `> ${home.description}`,
    "",
    home.intro,
    "",
    PRIVACY,
    "",
    ...groups.flatMap((group) => [
      `## ${pageGroupLabels[group]}`,
      "",
      ...landingPages
        .filter((page) => page.group === group)
        .map((page) => `- [${page.h1}](${pageUrl(page)}): ${page.description}`),
      "",
    ]),
  ].join("\n");
}

/** A page without the app and with inline CSS, so it renders at any URL depth. */
export function render404(): string {
  const links = landingPages
    .slice(0, 12)
    .map((page) => `<li><a href="/${page.slug}">${escapeHtml(page.h1)}</a></li>`)
    .join("");
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="robots" content="noindex" />
    <title>Page not found | ParseBox</title>
    <link rel="icon" href="/favicon.ico" sizes="48x48" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <style>
      :root { color-scheme: dark light; --bg: #0b0c0e; --fg: #e8e6df; --muted: #8e8d86; --accent: #ff6b35; }
      @media (prefers-color-scheme: light) { :root { --bg: #f7f6f2; --fg: #16171a; --muted: #5d5c57; } }
      body { margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; }
      main { max-width: 40rem; margin: 0 auto; padding: 4rem 1rem; }
      h1 { font-size: 1.5rem; margin: 0 0 0.5rem; }
      p { color: var(--muted); }
      a { color: var(--accent); text-underline-offset: 4px; }
      ul { padding-left: 1.25rem; }
    </style>
  </head>
  <body>
    <main>
      <h1>Page not found</h1>
      <p>This page does not exist. <a href="/">Open ParseBox</a> to convert between ${formatCount} formats, or pick a popular conversion:</p>
      <ul>${links}</ul>
    </main>
  </body>
</html>
`;
}

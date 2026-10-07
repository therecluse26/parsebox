import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SITE_URL,
  findLandingPage,
  home,
  landingPages,
  pageTitle,
  pageUrl,
  relatedPages,
  sampleFor,
} from "../src/seo/pages.ts";
import {
  CONTENT_END,
  CONTENT_START,
  HEAD_END,
  HEAD_START,
  applyTemplate,
  buildExample,
  escapeHtml,
  renderHomeHead,
  renderPageContent,
  renderPageHead,
  renderSitemap,
} from "../src/seo/render.ts";
import { formatOptions, isInputOnly, isOutputOnly } from "../src/config/formats.ts";

const formatValues = new Set(formatOptions.map((option) => option.value));

test("slugs are unique kebab-case", () => {
  const slugs = landingPages.map((page) => page.slug);
  assert.equal(new Set(slugs).size, slugs.length);
  for (const slug of slugs) assert.match(slug, /^[a-z0-9]+(-[a-z0-9]+)*$/);
});

test("each page uses formats the selects accept in that direction", () => {
  for (const page of landingPages) {
    assert.ok(formatValues.has(page.input), `${page.slug}: unknown input ${page.input}`);
    assert.ok(formatValues.has(page.output), `${page.slug}: unknown output ${page.output}`);
    assert.ok(!isOutputOnly(page.input), `${page.slug}: ${page.input} is output only`);
    assert.ok(!isInputOnly(page.output), `${page.slug}: ${page.output} is input only`);
    assert.ok(sampleFor(page), `${page.slug}: no sample`);
  }
});

test("findLandingPage reads the slug from a URL path", () => {
  const page = landingPages[0];
  assert.equal(findLandingPage(`/${page.slug}`), page);
  assert.equal(findLandingPage(`/${page.slug}/`), page);
  assert.equal(findLandingPage(`/${page.slug}.html`), page);
  assert.equal(findLandingPage("/"), undefined);
  assert.equal(findLandingPage(""), undefined);
  assert.equal(findLandingPage("/not-a-page"), undefined);
});

test("titles and descriptions are unique and fit in a search result", () => {
  const titles = [home.title, ...landingPages.map(pageTitle)];
  const descriptions = [home.description, ...landingPages.map((page) => page.description)];
  assert.equal(new Set(titles).size, titles.length);
  assert.equal(new Set(descriptions).size, descriptions.length);
  for (const title of titles) assert.ok(title.length <= 65, `title over 65 characters: ${title}`);
  for (const description of descriptions) {
    assert.ok(description.length >= 100 && description.length <= 160, `description is ${description.length} characters: ${description}`);
  }
});

test("related pages exist and never include the page itself", () => {
  for (const page of landingPages) {
    const related = relatedPages(page);
    assert.ok(related.length <= 8);
    for (const other of related) {
      assert.notEqual(other, page);
      assert.ok(landingPages.includes(other));
    }
  }
});

test("every sample converts with the app's pipeline", async () => {
  for (const page of landingPages) {
    const example = await buildExample(page);
    assert.ok(example.output.length > 0, `${page.slug}: empty output`);
  }
});

test("a page head has its own title, canonical URL and valid JSON-LD", () => {
  const page = findLandingPage("/json-to-yaml")!;
  const head = renderPageHead(page);
  assert.ok(head.includes(`<link rel="canonical" href="${SITE_URL}/json-to-yaml" />`));
  assert.ok(head.includes(`<title>${escapeHtml(pageTitle(page))}</title>`));
  assert.ok(!head.includes("keywords"));
  const blocks = [...head.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)];
  assert.ok(blocks.length > 0);
  for (const [, json] of blocks) JSON.parse(json);

  const homeHead = renderHomeHead();
  assert.ok(homeHead.includes(`<link rel="canonical" href="${SITE_URL}/" />`));
  assert.ok(homeHead.includes('"@type":"WebSite"'));
});

test("page content escapes the example text", async () => {
  const page = findLandingPage("/xml-to-json")!;
  const content = renderPageContent(page, await buildExample(page));
  assert.ok(content.includes("&lt;order"));
  assert.ok(!content.includes("<order"));
});

test("applyTemplate replaces only the marked blocks", () => {
  const html = `<head>${HEAD_START}old head${HEAD_END}<link rel="icon"></head><body><div id="root"></div>${CONTENT_START}${CONTENT_END}</body>`;
  const out = applyTemplate(html, "NEW HEAD", "NEW CONTENT");
  assert.ok(out.includes("NEW HEAD") && out.includes("NEW CONTENT"));
  assert.ok(!out.includes("old head"));
  assert.ok(out.includes('<link rel="icon">') && out.includes('<div id="root"></div>'));
  assert.throws(() => applyTemplate("<head></head>", "a", "b"));
});

test("the sitemap lists the home page and every landing page", () => {
  const sitemap = renderSitemap("2026-10-07");
  assert.ok(sitemap.includes(`<loc>${SITE_URL}/</loc>`));
  for (const page of landingPages) assert.ok(sitemap.includes(`<loc>${pageUrl(page)}</loc>`), page.slug);
  assert.ok(sitemap.includes("<lastmod>2026-10-07</lastmod>"));
  assert.ok(!renderSitemap().includes("lastmod"));
});
